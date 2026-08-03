import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readToolchainConfig } from '../../src/config';

describe('toolchain configuration', () => {
	test('uses dynamic agent default and ignores project configuration', async () => {
		const home = await mkdtemp(join(tmpdir(), 'toolchain-config-'));
		const agent = join(home, 'agent');
		await mkdir(join(agent, 'extensions'), { recursive: true });
		await writeFile(
			join(agent, 'extensions/toolchain.json'),
			JSON.stringify({
				toolResolutionOrder: 'system-first',
				automaticInstallationTimeoutSeconds: 0,
				unknown: true,
			}),
		);
		const issues: string[] = [];
		const value = await readToolchainConfig(
			(issue) => issues.push(issue),
			{ HOME: home, PI_CODING_AGENT_DIR: agent },
			home,
		);
		expect(value).toMatchObject({
			agentDirectory: agent,
			toolkitDirectory: join(agent, 'toolchain'),
			toolResolutionOrder: 'system-first',
			automaticInstallationTimeoutSeconds: 0,
		});
		expect(issues).toHaveLength(1);
	});
	test('rejects relative agent directory', async () => {
		await expect(
			readToolchainConfig(() => undefined, { PI_CODING_AGENT_DIR: 'relative' }, '/home/test'),
		).rejects.toThrow('absolute');
	});
});
