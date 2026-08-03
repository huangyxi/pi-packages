import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readlink, rm, symlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { withLease } from '../provisioning/lock';
import { atomicWriteJson, readJson } from '../state/json';

interface ShimManifest {
	schemaVersion: 1;
	scriptHash: string;
	commands: string[];
}
interface FileIdentity {
	dev: string;
	ino: string;
	uid: string;
	nlink: string;
}
interface ShimJournal {
	schemaVersion: 1;
	desired: ShimManifest;
	prior?: ShimManifest;
	script: string;
	priorScript?: string;
	priorIdentity?: FileIdentity;
	addedCommands: string[];
	removedCommands: string[];
}
const commandPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
function validCommand(command: string): boolean {
	return commandPattern.test(command) && command !== '.' && command !== '..';
}
function commandPath(bin: string, command: string): string {
	if (!validCommand(command)) throw new Error(`invalid shim command: ${command}`);
	const path = resolve(bin, command);
	const rel = relative(resolve(bin), path);
	if (rel !== command || rel.includes(sep)) throw new Error(`shim command escapes agent bin: ${command}`);
	return path;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const identity = (stat: Awaited<ReturnType<typeof lstat>>): FileIdentity => ({
	dev: String(stat.dev),
	ino: String(stat.ino),
	uid: String(stat.uid),
	nlink: String(stat.nlink),
});
const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
	left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.nlink === right.nlink;
function isManifest(value: unknown): value is ShimManifest {
	if (value === null || typeof value !== 'object') return false;
	const item = value as Partial<ShimManifest>;
	return (
		item.schemaVersion === 1 &&
		typeof item.scriptHash === 'string' &&
		Array.isArray(item.commands) &&
		item.commands.every((entry) => typeof entry === 'string' && validCommand(entry)) &&
		new Set(item.commands).size === item.commands.length
	);
}
function isFileIdentity(value: unknown): value is FileIdentity {
	if (value === null || typeof value !== 'object') return false;
	const item = value as Partial<FileIdentity>;
	return [
		item.dev,
		item.ino,
		item.uid,
		item.nlink,
	].every((entry) => typeof entry === 'string');
}
function isJournal(value: unknown): value is ShimJournal {
	if (value === null || typeof value !== 'object') return false;
	const item = value as Partial<ShimJournal>;
	return (
		item.schemaVersion === 1 &&
		isManifest(item.desired) &&
		typeof item.script === 'string' &&
		Array.isArray(item.addedCommands) &&
		Array.isArray(item.removedCommands) &&
		item.addedCommands.every((entry) => typeof entry === 'string' && validCommand(entry)) &&
		item.removedCommands.every((entry) => typeof entry === 'string' && validCommand(entry)) &&
		item.addedCommands.every((entry) => item.desired?.commands.includes(entry)) &&
		(item.prior === undefined || isManifest(item.prior)) &&
		(item.priorScript === undefined || typeof item.priorScript === 'string') &&
		(item.priorIdentity === undefined || isFileIdentity(item.priorIdentity)) &&
		digest(item.script) === item.desired.scriptHash &&
		new Set([...item.addedCommands, ...item.removedCommands]).size ===
			item.addedCommands.length + item.removedCommands.length
	);
}

export function canonicalShimScript(): string {
	return `#!/usr/bin/env bash\nset -euo pipefail\nagent="\${PI_CODING_AGENT_DIR:-\${HOME}/.pi/agent}"\ncase "$agent" in /*) ;; *) echo "pi-toolchain: PI_CODING_AGENT_DIR must be absolute" >&2; exit 2;; esac\nphysical="$(pwd -P)"\nfind_cli() {\n  for candidate in "\${PI_TOOLCHAIN_PACKAGE_DIR:-}" "$agent/npm/node_modules/@hyxi/pi-toolchain" "$physical/.pi/npm/node_modules/@hyxi/pi-toolchain"; do\n    [ -n "$candidate" ] || continue\n    case "$candidate" in /*) ;; *) continue;; esac\n    if node -e 'const fs=require("node:fs"),p=process.argv[1];try{const m=JSON.parse(fs.readFileSync(p+"/package.json","utf8"));process.exit(m.name==="@hyxi/pi-toolchain"&&fs.existsSync(p+"/dist/cli.js")?0:1)}catch{process.exit(1)}' "$candidate"; then printf '%s\\n' "$candidate/dist/cli.js"; return; fi\n  done\n  return 1\n}\ncli="$(find_cli)" || { echo "pi-toolchain: install @hyxi/pi-toolchain in the Pi global package directory" >&2; exit 1; }\nname="$(basename "$0")"\nif [ "$name" = pi-toolchain ]; then exec node "$cli" "$@"; else exec node "$cli" run "$name" -- "$@"; fi\n`;
}

async function exactLink(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isSymbolicLink() && (await readlink(path)) === 'pi-toolchain';
	} catch {
		return false;
	}
}
async function refreshDescriptor(path: string, content: string, expected?: FileIdentity): Promise<FileIdentity> {
	const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		const beforeIdentity = identity(before);
		if (!before.isFile() || before.nlink !== 1 || (process.getuid !== undefined && before.uid !== process.getuid()))
			throw new Error('canonical shim identity conflict');
		if (expected && !sameIdentity(beforeIdentity, expected)) throw new Error('canonical shim identity changed');
		await handle.truncate(0);
		await handle.writeFile(content);
		await handle.sync();
		const after = identity(await lstat(path));
		if (!sameIdentity(beforeIdentity, after)) throw new Error('canonical shim path changed during refresh');
		return after;
	} finally {
		await handle.close();
	}
}
async function createScript(path: string, script: string): Promise<FileIdentity> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o755);
	try {
		await handle.writeFile(script);
		await handle.sync();
	} finally {
		await handle.close();
	}
	return identity(await lstat(path));
}

async function recoverJournal(bin: string): Promise<void> {
	const journalPath = join(bin, '.pi-toolchain-shims.journal.json');
	const raw = await readJson(journalPath);
	if (raw === undefined) return;
	if (!isJournal(raw)) throw new Error('invalid shim transaction journal');
	const journal = raw;
	const scriptPath = join(bin, 'pi-toolchain');
	let scriptIdentity: FileIdentity;
	try {
		const stat = await lstat(scriptPath);
		const currentIdentity = identity(stat);
		const current = await readFile(scriptPath, 'utf8');
		if (digest(current) !== journal.desired.scriptHash) {
			if (!journal.priorIdentity || !sameIdentity(currentIdentity, journal.priorIdentity))
				throw new Error('canonical shim changed during journal recovery');
			await refreshDescriptor(scriptPath, journal.script, journal.priorIdentity);
		}
		scriptIdentity = identity(await lstat(scriptPath));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		if (journal.prior) throw new Error('owned canonical shim disappeared during recovery');
		scriptIdentity = await createScript(scriptPath, journal.script);
	}
	void scriptIdentity;
	for (const command of journal.addedCommands) {
		const path = commandPath(bin, command);
		try {
			await symlink('pi-toolchain', path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await exactLink(path)))
				throw new Error(`foreign agent-bin entry during recovery: ${command}`);
		}
	}
	for (const command of journal.removedCommands) {
		const path = commandPath(bin, command);
		if (await exactLink(path)) await rm(path);
		else {
			try {
				await lstat(path);
				throw new Error(`owned shim changed during recovery: ${command}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
	}
	await atomicWriteJson(join(bin, '.pi-toolchain-shims.json'), journal.desired);
	await rm(journalPath, { force: true });
}

async function applyDesired(
	agentDirectory: string,
	requested: readonly string[],
	removeRequested: readonly string[] = [],
): Promise<void> {
	const bin = join(agentDirectory, 'bin');
	for (const command of [...requested, ...removeRequested]) commandPath(bin, command);
	await mkdir(bin, { recursive: true, mode: 0o700 });
	await withLease(join(bin, '.pi-toolchain-locks'), 'shims', undefined, 'shim-reconcile', async () => {
		await recoverJournal(bin);
		const manifestPath = join(bin, '.pi-toolchain-shims.json');
		const rawPrior = await readJson(manifestPath);
		const prior =
			rawPrior === undefined
				? undefined
				: isManifest(rawPrior)
					? rawPrior
					: (() => {
							throw new Error('invalid shim ownership manifest');
						})();
		const priorCommands = new Set(prior?.commands ?? []);
		const desiredCommands = new Set(priorCommands);
		for (const command of requested) desiredCommands.add(command);
		for (const command of removeRequested) desiredCommands.delete(command);
		const addedCommands = [...desiredCommands].filter((command) => !priorCommands.has(command));
		const removedCommands = [...priorCommands].filter((command) => !desiredCommands.has(command));
		for (const command of [...desiredCommands]) {
			const path = commandPath(bin, command);
			try {
				await lstat(path);
				if (!priorCommands.has(command) || !(await exactLink(path)))
					throw new Error(`foreign agent-bin entry: ${command}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		for (const command of removedCommands)
			if (!(await exactLink(commandPath(bin, command)))) throw new Error(`owned shim was modified: ${command}`);
		const script = canonicalShimScript();
		const desired: ShimManifest = {
			schemaVersion: 1,
			scriptHash: digest(script),
			commands: [...desiredCommands].sort(),
		};
		const scriptPath = join(bin, 'pi-toolchain');
		let priorScript: string | undefined;
		let priorIdentity: FileIdentity | undefined;
		try {
			const stat = await lstat(scriptPath);
			priorIdentity = identity(stat);
			priorScript = await readFile(scriptPath, 'utf8');
			if (digest(priorScript) !== prior?.scriptHash)
				throw new Error('foreign or modified canonical pi-toolchain shim');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			if (prior) throw new Error('owned canonical shim is missing');
		}
		const journal: ShimJournal = {
			schemaVersion: 1,
			desired,
			script,
			...(prior ? { prior } : {}),
			...(priorScript ? { priorScript } : {}),
			...(priorIdentity ? { priorIdentity } : {}),
			addedCommands,
			removedCommands,
		};
		await atomicWriteJson(join(bin, '.pi-toolchain-shims.journal.json'), journal);
		if (priorIdentity) await refreshDescriptor(scriptPath, script, priorIdentity);
		else await createScript(scriptPath, script);
		await chmod(scriptPath, 0o755);
		for (const command of addedCommands) await symlink('pi-toolchain', commandPath(bin, command));
		for (const command of removedCommands) await rm(commandPath(bin, command));
		await atomicWriteJson(manifestPath, desired);
		await rm(join(bin, '.pi-toolchain-shims.journal.json'), { force: true });
	});
}

export async function reconcileShims(agentDirectory: string, commands: readonly string[]): Promise<void> {
	await applyDesired(agentDirectory, commands);
}
export async function removeOwnedShim(agentDirectory: string, command: string): Promise<void> {
	await applyDesired(agentDirectory, [], [command]);
}
export async function recoverShims(agentDirectory: string): Promise<void> {
	const bin = join(agentDirectory, 'bin');
	await mkdir(bin, { recursive: true });
	await withLease(join(bin, '.pi-toolchain-locks'), 'shims', undefined, 'shim-recovery', () => recoverJournal(bin));
}

export async function rollbackShimPublication(agentDirectory: string): Promise<void> {
	const bin = join(agentDirectory, 'bin');
	await mkdir(bin, { recursive: true });
	await withLease(join(bin, '.pi-toolchain-locks'), 'shims', undefined, 'shim-rollback', async () => {
		const journalPath = join(bin, '.pi-toolchain-shims.journal.json');
		const raw = await readJson(journalPath);
		if (raw === undefined) return;
		if (!isJournal(raw)) throw new Error('invalid shim transaction journal');
		for (const command of raw.addedCommands) {
			const path = commandPath(bin, command);
			if (await exactLink(path)) await rm(path);
		}
		for (const command of raw.removedCommands) {
			const path = commandPath(bin, command);
			try {
				await symlink('pi-toolchain', path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await exactLink(path))) throw error;
			}
		}
		const scriptPath = join(bin, 'pi-toolchain');
		if (raw.prior && raw.priorScript && raw.priorIdentity) {
			const currentStat = await lstat(scriptPath);
			const currentIdentity = identity(currentStat);
			const currentHash = digest(await readFile(scriptPath, 'utf8'));
			if (!sameIdentity(currentIdentity, raw.priorIdentity) || currentHash !== raw.desired.scriptHash)
				throw new Error('canonical shim changed before rollback');
			await refreshDescriptor(scriptPath, raw.priorScript, raw.priorIdentity);
			await chmod(scriptPath, 0o755);
			await atomicWriteJson(join(bin, '.pi-toolchain-shims.json'), raw.prior);
		} else if (!raw.prior) {
			try {
				const stat = await lstat(scriptPath);
				if (!stat.isSymbolicLink() && digest(await readFile(scriptPath, 'utf8')) === raw.desired.scriptHash)
					await rm(scriptPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
			await rm(join(bin, '.pi-toolchain-shims.json'), { force: true });
		}
		await rm(journalPath, { force: true });
	});
}
