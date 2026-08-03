# @hyxi/pi-toolchain Implementation Plan

## Status

Accepted design. This document is the implementation blueprint for a new workspace package at `packages/pi-toolchain`.

Related domain language and decisions:

- [Context](./CONTEXT.md)
- [ADR 0001: Preserve the original bash command](./adr/0001-preserve-original-bash-command.md)
- [ADR 0002: Portable user-space installation](./adr/0002-portable-user-space-installation.md)
- [ADR 0003: Built-in dependency catalog](./adr/0003-built-in-dependency-catalog.md)
- [ADR 0004: Ownership and health](./adr/0004-ownership-and-health.md)

## Objective

Add `@hyxi/pi-toolchain`, a Pi extension and CLI that:

1. Observes Pi `bash` tool calls before execution.
2. Finds supported bare command names throughout shell syntax.
3. Uses an existing usable system command when one is available.
4. Otherwise provisions the owning toolchain and its dependencies into a configurable, machine-local toolkit root.
5. Lets Pi execute the original bash command unchanged.
6. Routes installed commands through manifest-owned links to one canonical `pi-toolchain` shim.

Provisioning must not use `sudo`, a system package manager, `curl`, or `wget`. It must not add instructions, status, or inventory to model prompts or otherwise manipulate LLM context.

## Non-goals

- Replacing Pi's bash executor or rewriting shell commands.
- Installing a duplicate managed command merely to enforce routing preference during automatic interception.
- Supporting native Windows in v1.
- Repositioning or synchronizing installed toolkit files between machines or platforms.
- Supporting LLVM, C, or C++ toolchains in v1.
- Loading arbitrary installers, URLs, or toolchain definitions from JSON configuration.
- Providing a runtime registration API for third-party Pi extensions.
- Repeatedly downloading every real toolchain in CI.
- Managing global `pip`/`pip3` command shims.
- Managing Yarn or Bun in v1.

## User-visible behavior

### Automatic command provisioning

Given a bash call such as:

```bash
rg TODO src && fd package.json . | xargs rg '"private"'
```

The extension discovers `rg` and `fd`, maps them to `ripgrep` and `fd-find`, and checks for usable system commands outside Pi's shim and toolkit directories. Missing commands trigger dependency-aware provisioning. Both utility toolchains depend on `rust`; concurrent requests join the same Rust installation. When all required provisioning succeeds, the extension returns no replacement and Pi executes the exact original command.

LLMs commonly probe before execution. Query forms are intentional provisioning demand, so absent supported commands in `which rg`, `command -v rg`, or `type rg` trigger provisioning before the unchanged query runs. The query therefore succeeds against either the pre-existing system command or the newly managed command, and a later bash call can execute it without another installation.

A supported-platform provisioning failure blocks the bash call. The concise diagnostic includes:

- requested command and owning toolchain;
- failed phase and sanitized reason;
- whether the deadline expired;
- a recovery command, for example `pi-toolchain install ripgrep`;
- the toolchain's official installation URL.

A platform unsupported by that strategy is silent and fail-open during agent interception. Unsupported is a distinct non-failure outcome: provision any other supported branches in the same bash call, ignore unsupported branches, and then allow the original command to run. The unsupported command reports its normal command-not-found result. CLI use reports the unsupported platform and official URL.

### No routine update checks

A healthy installed toolchain does not contact the network during command detection or dispatch. Updates are explicit through `upgrade`, `reinstall`, or a repair of degraded owned state.

Stable installer/runtime managers, including `uv`, `rustup`, `cargo-binstall`, and `juliaup`, resolve latest whenever their owning toolchain is installed, reinstalled, repaired, or upgraded. A healthy dependency is probed but not upgraded merely because a dependent is installed.

For other applications, reinstall preserves the recorded version when both local version detection and an upstream version-addressable artifact are straightforward. Otherwise reinstall resolves latest and prints a notice before mutating in CLI mode. `upgrade` always resolves latest.

## Package shape

Create the package with this target structure. Exact file grouping may change when a module becomes deeper, but ownership boundaries should remain intact.

```text
packages/pi-toolchain/
  package.json
  README.md
  tsconfig.json
  vite.config.ts
  src/
    extension.ts                 Pi event adapter only
    cli.ts                       public CLI and hidden run dispatch
    config.ts                    global-only schema and loader
    catalog/
      types.ts                   exported definition contracts
      registry.ts                built-ins and graph validation
      pnpm.ts
      python.ts
      rust.ts
      julia.ts
      cargo-utility.ts           shared strict cargo-binstall strategy
      ripgrep.ts
      fd-find.ts
      bat.ts
      just.ts
      hyperfine.ts
    detection/
      detect-commands.ts         parser facade and fallback
      walk-bash-ast.ts           command-position traversal
      dispatchers.ts             command/which/xargs/find handlers
    provisioning/
      provisioner.ts             graph orchestration and state machine
      coordinator.ts             in-process promise joining
      dependency-graph.ts
      lock.ts                    cross-process lease
      transaction.ts             staging, commit, rollback
      probes.ts
    installation/
      process.ts                 subprocess execution and termination
      network.ts                 proxy-aware Node fetch
      archive.ts                 bounded archive extraction
      environment.ts             managed homes and PATH construction
      platform.ts
    state/
      paths.ts
      root-marker.ts
      manifests.ts
      health.ts
      shim-manifest.ts
    routing/
      executable-resolver.ts
      package-discovery.ts
      shim.ts
      run.ts
    output/
      diagnostics.ts
      json.ts
  test/
    fixtures/
      dummy-catalog.ts
      dummy-installer.ts
    unit/
    integration/
  docs/
    PLAN.md
    CONTEXT.md
    adr/
```

Build ESM entries for `extension` and `cli`. Publish `dist`, `README.md`, and the public catalog type declarations. Declare a package `bin` entry named `pi-toolchain` as a convenience outside Pi, while the extension-managed agent-bin shim remains the reliable Pi path.

The Vite build prints a development hint using the actual package root, for example:

```bash
export PI_TOOLCHAIN_PACKAGE_DIR='/home/user/src/pi-packages/packages/pi-toolchain'
```

It does not write that absolute path into generated shims or artifacts.

## Shared configuration utility

Update `utils/config.ts` before adding toolchain configuration:

1. Add an exported `getAgentDirectory(env = process.env, home = homedir())` helper.
2. Expand a leading `~` in non-empty `PI_CODING_AGENT_DIR`, require the result to be absolute, and use it as the agent directory; treat undefined or empty as `${home}/.pi/agent`.
3. Report a non-empty relative value as invalid rather than resolving it against a mutable working directory.
4. Replace the hard-coded global config root in `readConfig` with this helper.
5. Add a global-only read option or `readGlobalConfig` function so `pi-toolchain` cannot accidentally consume project overrides.
6. Add a string-enum field helper for `toolResolutionOrder`.
7. Make unknown-field reporting opt-in so strict `pi-toolchain` diagnostics do not change existing package behavior unexpectedly.
8. Test unset, empty, relative rejection, tilde expansion, and valid absolute `PI_CODING_AGENT_DIR` cases.

The package reads only:

```text
${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/toolchain.json
```

Configuration schema:

```ts
interface ToolchainConfig {
  toolkitDirectory: string;
  toolResolutionOrder: 'managed-first' | 'system-first';
  automaticInstallationTimeoutSeconds: number;
}
```

Defaults:

```json
{
  "toolkitDirectory": "<agent-directory>/toolchain",
  "toolResolutionOrder": "managed-first",
  "automaticInstallationTimeoutSeconds": 600
}
```

Rules:

- `toolkitDirectory` expands `~` and resolves to an absolute path.
- The default is computed after agent-directory resolution, not frozen in the schema module.
- `automaticInstallationTimeoutSeconds` is a finite integer at least zero.
- Zero disables the automatic deadline; it does not disable automatic installation.
- Unknown or invalid fields produce one deduplicated UI warning in extension mode and a stderr warning in CLI mode, then fall back field-by-field.
- Configuration cannot define commands, dependencies, subprocesses, or URLs.

`toolResolutionOrder` only decides dispatch when both usable system and healthy managed copies exist. Automatic provisioning still declines to install when the requested command already has a usable system executable.

## Catalog contract

Export a strict interface along these lines; prefer data plus narrow hooks over a large command switch:

```ts
type ToolchainId = string;
type CommandName = string;

interface ToolchainDefinition {
  id: ToolchainId;
  displayName: string;
  description: string;
  commands: readonly CommandDefinition[];
  dependencies: readonly ToolchainId[];
  hostPrerequisites: readonly HostPrerequisite[];
  officialInstallUrl: string;
  platforms: readonly PlatformSupport[];
  installer: InstallerStrategy;
}

interface CommandDefinition {
  name: CommandName;
  versionArgs: readonly string[];
  executableLocations: (layout: ManagedLayout) => readonly string[];
}

interface InstallerStrategy {
  kind: string;
  install(context: InstallContext): Promise<InstallResult>;
  reinstall(context: InstallContext, current: InstallationManifest): Promise<InstallResult>;
  upgrade(context: InstallContext, current: InstallationManifest): Promise<InstallResult>;
  uninstall(context: UninstallContext, current: InstallationManifest): Promise<void>;
  probe(context: ProbeContext): Promise<ProbeResult>;
  ownedPaths(result: InstallResult): readonly string[];
}
```

Refine return types during implementation so callers receive structured phase, component version, source, artifact digest, and path data rather than parsing prose.

Registry validation runs at module initialization and in a dedicated test:

- unique toolchain IDs;
- unique command ownership across the catalog;
- all dependency IDs exist;
- dependency graph is acyclic;
- deterministic topological order;
- non-empty command and version probes;
- relative managed executable locations cannot escape the toolkit root;
- supported platform declarations include an official recovery URL;
- every installer kind implements all required lifecycle operations or explicitly declares an unsupported operation;
- public IDs and command aliases cannot be ambiguous in CLI lookup.

Runtime registration is not exposed in v1. Source contributors add a module and registry entry.

## Initial catalog

| Toolchain ID | Owned commands                                          | Managed dependencies | Strategy                                                         |
| ------------ | ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| `pnpm`       | `pnpm`, `pnpx` when shipped                             | none                 | Official npm package into a toolkit-scoped prefix, latest stable |
| `python`     | `uv`, `uvx`, `python`, `python3`                        | none                 | Official uv binary, then latest stable CPython through uv        |
| `rust`       | `rustup`, `cargo`, `rustc`, `rustdoc`, `cargo-binstall` | none                 | rustup stable/minimal plus official cargo-binstall binary        |
| `julia`      | `julia`, `juliaup`                                      | none                 | Juliaup with the `release` channel                               |
| `ripgrep`    | `rg`                                                    | `rust`               | strict `cargo binstall ripgrep`                                  |
| `fd-find`    | `fd`                                                    | `rust`               | strict `cargo binstall fd-find`                                  |
| `bat`        | `bat`                                                   | `rust`               | strict `cargo binstall bat`                                      |
| `just`       | `just`                                                  | `rust`               | strict `cargo binstall just`                                     |
| `hyperfine`  | `hyperfine`                                             | `rust`               | strict `cargo binstall hyperfine`                                |

CLI lookup accepts a toolchain ID or an unambiguous owned command, so `install rg` resolves to `ripgrep`, while human and JSON output always report the canonical toolchain ID.

Node.js and npm are host prerequisites. They are probed and diagnosed; they are not managed toolchain dependencies.

### pnpm strategy

- Use the official `pnpm` npm distribution and the assumed host npm.
- Install into isolated staging with an explicit prefix; never use system-global npm installation.
- Resolve latest stable on install, reinstall, repair, and upgrade.
- Publish only the command entries actually shipped by the resolved package.
- Disable lifecycle behavior that would edit shell startup files.
- Probe `pnpm --version`; probe `pnpx --version` only when exposed.
- Treat documented unsupported platform/architecture combinations as unsupported rather than falling back to a host package manager.

### Python strategy

- Resolve and download the latest official uv release artifact with the Node network layer; do not build uv from source.
- Redirect uv install, Python install, cache, tool, and tool-bin directories beneath the Python installation root or toolkit `bin` as appropriate.
- Set `UV_NO_MODIFY_PATH=1` for every uv lifecycle operation.
- Run the equivalent of `uv python install --default` for latest stable CPython.
- Publish `uv`, `uvx`, `python`, and `python3` only after all probes pass.
- Do not publish global `pip` or `pip3`; users may use uv or environment-local pip.
- Probe and record uv and CPython versions separately.

### Rust strategy

Use ordered internal phases under one public `rust` toolchain:

1. Download the target's official `rustup-init` artifact through Node fetch.
2. Verify the upstream checksum when the stable official flow publishes one.
3. Set managed `RUSTUP_HOME` and `CARGO_HOME`.
4. Run rustup non-interactively with no PATH/profile modification, stable default toolchain, and minimal profile.
5. Ensure the stable toolchain explicitly; do not rely only on bootstrap side effects.
6. Resolve and download the latest official cargo-binstall release artifact through Node fetch.
7. Install cargo-binstall into the managed Cargo home.
8. Probe `rustup`, `cargo`, `rustc`, `rustdoc`, and `cargo-binstall`.

`cargo-binstall` is package-managed auxiliary capability, not claimed as part of upstream rustup. Rust install, reinstall, repair, and upgrade always refresh rustup stable and cargo-binstall to latest.

### Cargo utility strategy

Every initial Rust utility invokes the managed cargo-binstall with equivalent arguments:

```bash
cargo binstall \
  --no-confirm \
  --disable-telemetry \
  --strategies crate-meta-data \
  --root <toolchain-specific-staging-root> \
  <crate-and-version>
```

Requirements:

- Never include `quick-install` or `compile` strategies.
- Never fall back to `cargo install`.
- Use a separate install root per utility to preserve ownership and independent uninstall.
- Pass managed `CARGO_HOME`, `RUSTUP_HOME`, and PATH.
- Confirm the expected command, not merely any installed binary.
- Reinstall the recorded crate version when addressable; upgrade resolves latest.
- If one-time authoring validation shows that strict crate metadata cannot provide an official repository binary for a selected utility/platform, implement a dedicated official-release strategy or remove that utility from the supported platform. Do not weaken the shared strategy.

### Julia strategy

- Bootstrap Juliaup through its official Unix installation/release flow, with every bootstrap download routed through the Node network layer. Do not execute `curl` or `wget` indirectly from the upstream bootstrap script; Juliaup's later release-channel downloads may use Juliaup's own HTTP client under the normalized proxy environment.
- Prefer direct official artifact resolution. If an upstream bootstrap must be retained, give it an installer-local, argument-constrained downloader adapter backed by the same Node fetch implementation and test that real `curl`/`wget` cannot be invoked.
- Install non-interactively to a custom managed path.
- Disable shell PATH edits, startup self-update, and background self-update.
- Install and select the `release` channel.
- Probe and record Juliaup and Julia versions separately.
- `upgrade julia` updates Juliaup and the release channel.
- User-added Juliaup channels are allowed inside the managed depot. Status reports them separately from the package-owned release channel.
- Explicit `pi-toolchain uninstall julia` is sufficient confirmation and removes the entire owned Julia depot; no interactive prompt or `--yes` mode is introduced.

## Platform policy

Normalize runtime support by Node platform, architecture, and Linux libc where artifact selection requires it.

- Linux x64 and arm64: primary support, including WSL.
- WSL: treated as Linux, with no Windows installer invocation.
- macOS x64 and arm64: declared per toolchain only when official documentation supports a straightforward user-space path. No recurring or required macOS tests.
- Native `win32`, including Git Bash: unsupported in v1.
- Other platform/architecture combinations: unsupported unless a definition explicitly supports them.

A one-time manual authoring smoke test establishes each initial strategy's Linux feasibility. Routine tests use dummy strategies. Platform declarations should be based on official documentation, not optimistic artifact-name guessing.

The toolkit root is machine-local. Its root marker records platform/architecture for diagnostics and refuses mutation after a detected mismatch. Cross-platform relocation and cloud synchronization of managed files are unsupported; add Pi/cloud-sync and repository ignore markers where available.

## Shell command detection

### Parser

Bundle a pure-JavaScript Bash parser. Start with `@ericcornelissen/bash-parser`, the maintained fork of `bash-parser`, but gate adoption on a corpus test covering all required syntax. If it cannot represent a required construct safely, isolate it behind `detect-commands.ts` so it can be replaced without changing provisioning.

Never use `eval`, invoke a shell, or expand variables while detecting commands.

### AST traversal

Walk command positions recursively through:

- simple commands;
- `&&`, `||`, and `;` lists;
- pipelines;
- grouped commands and subshells;
- command substitutions and process substitutions represented by the parser;
- function bodies when present in the submitted command;
- negation and redirections without treating redirect targets as commands.

Recognize registered commands after common dispatchers using explicit handlers:

- `command`, including `command -v` and `command --`;
- `env`, after options and assignments;
- `which` and `type` query arguments;
- `xargs`, after its options and optional separator;
- `find ... -exec`, `-execdir`, `-ok`, and `-okdir` up to `;` or `+`;
- shell wrappers only when their command argument can itself be parsed without evaluation.

Quoted strings, comments, assignment values, redirect targets, here-document bodies, and ordinary command arguments do not trigger. Bare command words only are provisionable. Explicit paths such as `/usr/bin/rg`, `./rg`, and `tools/rg` are not rerouted and do not trigger. Dynamic names produced by variables, aliases, or runtime string construction are outside detection scope.

Deduplicate discovered commands while preserving first appearance for diagnostics. Convert commands to unique owning toolchain IDs, then let graph planning determine dependencies.

### Parse failure fallback

A parse failure is not a reason to block or rewrite a bash call. Conservatively scan only obvious unquoted, uncommented registered bare names at shell token boundaries. A false-positive bounded installation is acceptable; command alteration and parse-only blocking are not.

Build a corpus with positive and negative cases for every supported construct, including malformed input and nested substitutions.

## System and managed command resolution

Before automatic installation of a requested command:

1. Enumerate PATH entries while excluding the real Pi agent bin directory, toolkit root, and duplicate/symlink aliases of those paths.
2. Find the requested bare command with platform-appropriate executable checks.
3. Run the command's bounded catalog health/version probe when required to establish usability.
4. If usable, return without installing any managed copy.

The check is for the requested command, not merely another command owned by the same toolchain. For example, a system `python3` does not satisfy a request for absent `uv`.

Explicit `install` and `reinstall` may install a managed copy even when a system command exists.

Dispatch from `pi-toolchain run` resolves both candidates independently:

- Managed candidates search `<toolkitDirectory>/bin` first, then the owning definition's registered executable locations. A candidate must agree with ownership metadata.
- System candidates use PATH with agent-bin and managed locations removed.
- Apply `toolResolutionOrder` only when both are healthy.
- Execute the selected absolute path directly; never re-enter PATH lookup for the selected command.
- Construct a deterministic child environment containing all required managed dependency homes and executable paths, while preserving unrelated user variables.
- Preserve stdin/stdout/stderr, argument boundaries, exit code, signals, and current working directory.

If an owned managed installation is degraded, dispatch returns an actionable repair diagnostic. Agent preflight should normally repair before the shim is reached.

## Canonical shim and package discovery

### Canonical script

`${agentDirectory}/bin/pi-toolchain` is the only generated Bash script. Its behavior is:

1. Determine its invocation basename.
2. Resolve a valid package CLI using the candidate order below.
3. If basename is `pi-toolchain`, execute `node <cli.js> "$@"`.
4. Otherwise execute `node <cli.js> run <basename> -- "$@"`.
5. Use `exec` so signals and exit status pass through.

Preserve `"$@"` exactly. Shell-quote all computed paths. The script contains no username-specific package path.

### Package candidate order

Try these candidates in exact order:

1. Non-empty `PI_TOOLCHAIN_PACKAGE_DIR`.
2. `${agentDirectory}/npm/node_modules/@hyxi/pi-toolchain`, where `agentDirectory` uses non-empty `PI_CODING_AGENT_DIR` or `$HOME/.pi/agent`.
3. `<physicalCurrentDirectory>/.pi/npm/node_modules/@hyxi/pi-toolchain` exactly, where the script obtains the directory from `pwd -P` and never trusts the inherited `$PWD` value.
4. Exit nonzero with a concise instruction to install `@hyxi/pi-toolchain` globally.

There is no ancestor walk. Validate that each candidate's `package.json` name is `@hyxi/pi-toolchain` and that its built CLI entry exists before selecting it. An empty environment override is skipped; an invalid non-empty candidate does not prevent trying later candidates. Apply the same absolute-path validation to `PI_CODING_AGENT_DIR` in the generated Bash shim as in Node.

The exact project-root fallback executes project-provided package code and package-name validation is not a trust boundary. README support is global-only and must warn users to invoke this fallback only in a project they trust. The environment override is an explicit development trust choice.

### Command links and ownership

After a toolchain commits, create relative symlinks such as:

```text
rg -> pi-toolchain
fd -> pi-toolchain
```

On extension load, create or refresh the canonical CLI script, then refresh only existing owned links. Do not create all catalog links preemptively. Keep links for degraded owned installations so diagnostics and repair remain available.

No unique comment tag is required. Store shim ownership metadata in `${agentDirectory}/bin/.pi-toolchain-shims.json` with schema version, canonical script content hash, and claimed command links. Serialize all shim mutations by cooperating package processes with an agent-bin lock and an atomic transaction journal in the same directory.

The safety boundary does not claim to defeat a malicious process intentionally mutating agent-bin entries while holding no cooperative lock. Within the supported boundary, creation is no-replace (`open` with exclusive create for the script and direct `symlink` creation that fails on `EEXIST`), never rename-over-path. Refresh an existing canonical script only through an open no-follow file descriptor whose `fstat` identity, link count, owner, and content hash match the manifest; write that descriptor, then verify the path identity again. Relative command links already have stable content and are never replaced during refresh. Recheck identity immediately before owned-link removal and verify the postcondition; any mismatch stops cleanup and remains an ownership conflict.

Shim commit/recovery protocol:

1. Preflight foreign entries and write a journal containing prior file identities, hashes/link shapes, and the complete desired state.
2. Write and fsync temporary manifest data; create new script/link entries with no-replace operations.
3. Refresh an existing owned canonical script only through the identity-checked descriptor protocol above; never publish it with an overwrite rename.
4. Rename the shim manifest into place last, then remove the journal.
5. On the next package load, recover a valid journal before classifying entries. Complete or roll back only entries whose current hash/link shape still matches the journal; a user-modified entry remains foreign.
6. A manifest-without-script or script-without-manifest state is recoverable only with matching manifest/journal evidence. Without that evidence it remains foreign.

Mutation rules:

- Canonical script ownership requires a matching shim manifest and recorded content hash.
- Command-link ownership requires a manifest claim and `lstat/readlink` confirmation that the entry is the exact relative link `pi-toolchain`.
- A matching-looking file or link without manifest evidence is foreign.
- Never follow command links during ownership checks or deletion.
- Preflight every requested new link for foreign conflicts before committing installation.
- If an installation manifest is healthy but its claimed command links are absent from shim metadata, reconciliation treats the committed installation manifest as recovery evidence and creates only currently absent links with no-replace operations. A present unclaimed entry is still foreign.
- Remove a link on uninstall only when no remaining installed toolchain owns the command.
- If an existing owned entry no longer matches its recorded shape, report degradation and do not overwrite/delete it blindly.

## Toolkit layout and ownership

Logical layout:

```text
<toolkitDirectory>/
  .pi-toolchain-root.json
  bin/
  installations/<toolchain-id>/...
  state/<toolchain-id>.json
  .locks/<toolchain-id>/
  .staging/<operation-id>/...
```

Exact installer homes may live under each toolchain installation directory. The shared `bin` directory contains only manifest-owned published command entries or installer outputs whose ownership is unambiguous.

### Root initialization

- Resolve the configured root and inspect with `lstat` before mutation.
- Accept an empty directory or an existing valid marked root.
- Refuse a non-empty unmarked directory.
- Reject filesystem root, home directory, the Pi agent directory itself, and the agent bin directory.
- Record schema, creator package, created time, and originating platform/architecture in the root marker.
- A mismatched platform marker is diagnostic and mutation-blocking; relocating installs is out of scope.

### Installation manifest

Use an atomically written, versioned JSON object containing at least:

```ts
interface InstallationManifest {
  schemaVersion: number;
  toolchainId: string;
  definitionVersion: number;
  status: 'installed' | 'degraded';
  platform: PlatformIdentity;
  installedAt: string;
  updatedAt: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  components: ComponentVersion[];
  dependencies: string[];
  commands: OwnedCommand[];
  shimCommands: string[];
  ownedPaths: string[];
  sources: SourceAudit[];
  installerKind: string;
}
```

Runtime source audits may record final URL, response metadata, and computed SHA-256. These are audit facts from that installation, not release-specific constants maintained in source and not proof beyond TLS when upstream supplied no trusted checksum.

Before any update or deletion, resolve every path and prove containment beneath the real toolkit root. Use `lstat`; never recursively follow a symlink. Delete only paths listed by a valid ownership manifest, deepest paths first, then prune empty package-owned parents.

An installation manifest commits its intended `shimCommands` before agent-bin publication. After a crash between those phases, extension load and every healthy `install` no-op first reconcile missing canonical/link entries from the valid installation manifest. Reconciliation may create an absent entry but never adopt or overwrite a present unclaimed entry.

Files without a valid ownership manifest are orphans. Report them but never adopt or delete them automatically.

## Provisioning coordinator

### Planning

For a set of requested toolchains:

1. Validate IDs against the catalog.
2. Expand transitive dependencies.
3. Topologically order the graph.
4. Probe each dependency and requested toolchain.
5. Skip healthy entries.
6. Schedule ready graph nodes; independent toolchains may run concurrently.
7. Publish command links only after each toolchain commits.

Within one process, track the active operation kind, shared `AbortController`, promise, and waiter set for each canonical toolchain ID. Only identical `ensure-healthy` operations may join. Every waiter retains its own signal and deadline: cancellation or deadline expiry detaches and rejects only that waiter. The shared underlying work is aborted only when no waiters remain; a longer-lived waiter therefore continues after a shorter waiter times out. Direct network/process phases still have bounded deterministic phase timeouts. A waiter arriving after shared abort starts a new operation.

Install of absent state and automatic repair are phases of `ensure-healthy`; repair invokes the strategy's `reinstall` policy. Explicit reinstall, upgrade, and uninstall never join a different lifecycle action: they queue, acquire the lock, re-read manifests and probes, then execute or return a state-based no-op. Remove settled entries in `finally`.

A single automatic bash preflight has one deadline covering lock wait, dependency provisioning, probes, and installation. Multiple graph branches may run concurrently under that deadline. A required supported branch's failure blocks the entire original bash call. `unsupported` is not a failure in agent mode; supported branches still provision and the call then proceeds.

### Cross-process lock

Use per-toolchain filesystem leases containing mode, PID, hostname, operation, start time, and a periodically refreshed heartbeat. Lifecycle mutation of a target requires its exclusive lease. Installing a dependent provisions dependencies first, then acquires shared leases for healthy dependencies plus an exclusive target lease in canonical ID order and re-probes under those leases. Concurrent dependents may share a healthy dependency; upgrade or uninstall of that dependency waits for readers. This prevents a dependency from disappearing while its dependent installs without serializing unrelated graph branches.

Waiters never assume the prior operation met their intent: after lease release they re-read state and perform their own lifecycle action if still needed. Dependency removal also validates dependent manifests while holding the exclusive dependency lease.

Because toolkit storage is machine-local, a hostname mismatch in root/lease metadata is an unsupported-copy diagnostic rather than normal distributed locking. On the same host, reclaim only when the PID is no longer alive and the heartbeat is stale. Never delete a live or indeterminate lease merely because a caller timeout elapsed.

Lock acquisition and waiting obey the caller's deadline. CLI without `--timeout` waits indefinitely but still fails immediately on deterministic platform, config, graph, permission, root-marker, or foreign-shim errors.

### Transaction and rollback

Every installer strategy must satisfy:

- First install stages isolated files where possible.
- Probes run against staged or unpublished paths.
- Ownership manifest and agent-bin command links become visible last.
- Failed first install is never reported installed and is cleaned up best-effort.
- Upgrade preserves the previous healthy installation and manifest until the candidate passes probes.
- Commit uses same-filesystem atomic rename where possible plus atomic temp-file/write/fsync/rename for manifests.
- If an upstream layout embeds absolute install paths, install into an immutable final candidate path and switch an owned indirection only after validation rather than renaming it unsafely.
- A strategy unable to preserve the previous version is not upgradeable until redesigned.
- Abandoned operation data remains identifiable under `.staging` and is eligible for ownership-checked cleanup.

Probe-gated state rules:

- Manifest plus successful probes: healthy.
- Manifest plus failed/missing probes: degraded and eligible for repair.
- Files without manifest: orphaned.
- Manifest with missing owned files: stale/degraded and removable through uninstall.

## Network and process policy

### Proxy-aware fetch

Use one package-owned network client based on Node/Undici fetch and an environment proxy dispatcher. Honor uppercase and lowercase forms of:

- `HTTP_PROXY` / `http_proxy`;
- `HTTPS_PROXY` / `https_proxy`;
- `NO_PROXY` / `no_proxy`;
- `ALL_PROXY` / `all_proxy` when supported by the dispatcher.

For package-owned direct requests, lowercase variables take precedence by presence over uppercase variables; an explicitly present empty lowercase value clears its uppercase counterpart. For HTTP requests use effective `http_proxy`, then effective `all_proxy`; for HTTPS use effective `https_proxy`, then effective `all_proxy`. Effective `no_proxy` is lowercase by presence, otherwise uppercase, and bypasses any selected proxy. Reject malformed non-empty proxy URLs.

Build a normalized child environment that sets both cases of each proxy name to the effective value, or removes both when explicitly cleared, so upstream managers receive the same policy despite case differences. Apply the package network client to direct installer scripts, release metadata, redirects, checksums, signatures, and artifacts. Downloads performed internally by `uv`, `rustup`, `cargo-binstall`, Juliaup, or npm use those tools' own HTTP clients under the normalized proxy environment; they are not falsely claimed as Node fetches. Do not mutate process-global fetch state if a per-client dispatcher is practical.

Never log proxy credentials; sanitize URLs and environment diagnostics.

### Download integrity

- Use stable official HTTPS installer or release API entry points.
- Do not maintain version-specific artifact URLs or digest tables in source or CI.
- Select assets at runtime from platform metadata and reject ambiguity.
- Constrain redirects to HTTPS and an explicit official-service host policy.
- Verify upstream-published checksums or signatures when naturally available in the official flow.
- When no trusted digest exists, record final URL and computed digest for audit without calling it authenticated.
- Save scripts before execution; never pipe response bodies directly into a shell.
- Apply bounded response/header timeouts and strategy-appropriate size limits.
- Extract archives with a bundled, path-safe implementation; reject absolute paths, `..` traversal, device entries, and escaping symlink/hardlink targets.
- Test installer strategies with `curl` and `wget` replaced by failing sentinels to prove they are not invoked.

### Child processes

Spawn commands with argument arrays, never shell-concatenated strings. Use a fresh process group for installer work. Thread the caller's `AbortSignal` through fetches, waits, probes, and subprocesses. On timeout or cancellation, send TERM, wait a short fixed grace period, then KILL the process group. Capture bounded stdout/stderr for diagnostics while allowing optional TTY progress in explicit CLI mode.

Child environments start from the inherited environment so authentication and proxies work, then set managed homes and no-profile/no-PATH-modification flags. Do not replace `HOME` unless an audited installer absolutely requires it; prefer its documented directory variables.

## CLI contract

Expose:

```text
pi-toolchain install <toolchain-or-command>... [--timeout <seconds>] [--json]
pi-toolchain upgrade [<toolchain-or-command>...] [--timeout <seconds>] [--json]
pi-toolchain reinstall <toolchain-or-command>... [--timeout <seconds>] [--json]
pi-toolchain uninstall <toolchain-or-command>... [--timeout <seconds>] [--json]
pi-toolchain list [--json]
pi-toolchain status [<toolchain-or-command>...] [--json]
pi-toolchain show <toolchain-or-command> [--json]
pi-toolchain help [<command>]
```

`upgrade` with no names targets all installed toolchains. Mutating commands have no default timeout; `--timeout 0` also means no deadline. Invalid or negative timeout values fail before mutation. Automatic interception uses only the config timeout.

Keep `run <command> -- <args...>` as an internal but testable dispatch subcommand. It must not parse managed command flags as CLI flags after `--`.

### Command semantics

- `install`: install managed copies explicitly, including dependencies, even if system commands exist; healthy managed targets are no-ops, while degraded owned targets invoke `reinstall` as repair.
- `upgrade`: resolve latest and upgrade selected installed targets; a missing explicit target fails with an `install` suggestion.
- `reinstall`: replace selected targets according to their version policy.
- `uninstall`: validate the entire explicit removal set, then remove in reverse topological order. The explicit command is confirmation; all modes are non-interactive and there is no `--yes`.
- `list`: show all catalog entries and summary state.
- `status`: probe selected or all installed entries and report healthy, degraded, orphan-related, or unsupported state.
- `show`: display catalog details, commands, dependency graph, platform support, versions, paths, ownership, source audits, and recovery actions.
- `help`: static usage and exit-code documentation without network access.

### Dependency-safe uninstall

There is no `--cascade`. Accept multiple explicit targets and validate the set as a whole. Removal is legal only if every installed dependent of a removed dependency is also in the removal set.

For example, with installed `rust -> ripgrep` dependency direction represented as `ripgrep` depends on `rust`:

```text
pi-toolchain uninstall rust
```

fails, shows the relevant graph, and suggests:

```text
pi-toolchain uninstall ripgrep rust
```

The user may include more dependents in the same command. Delete dependents before dependencies. A partial failure reports exactly what was removed and what remains; do not falsify manifests to make the operation appear atomic.

### JSON and diagnostics

Support global `--json` for every command. In JSON mode, mutating commands emit progress to stderr and exactly one final envelope to stdout; read-only commands emit only the envelope. Non-TTY human mode suppresses animated progress.

```ts
interface CliEnvelope<T> {
  schemaVersion: 1;
  ok: boolean;
  command: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    toolchainId?: string;
    recovery?: string[];
    details?: unknown;
  };
}
```

Read-only payloads contain the documented catalog/state fields. Mutating payloads contain an ordered `results` array with toolchain ID, requested action, final action, prior/final state, versions, and diagnostics. Additive fields are allowed within schema version 1; removing/changing field meaning requires a schema increment.

Exit codes:

|  Code | Meaning                                         |
| ----: | ----------------------------------------------- |
|   `0` | success                                         |
|   `2` | usage or configuration error                    |
|   `3` | unsupported platform/strategy                   |
|   `4` | dependency removal conflict                     |
|   `5` | lock wait or deadline expired                   |
|   `6` | installation, upgrade, repair, or probe failure |
|   `7` | root, manifest, or foreign ownership conflict   |
| `130` | cancellation/interrupt                          |

Do not expose secrets or unbounded upstream output.

## Pi extension integration

Follow `pi-attach` package conventions but keep the extension adapter thin.

- Register `tool_call` and inspect only bash tool calls.
- Read the command string from the typed event shape; fail open if Pi changes the shape unexpectedly, with a once-per-session UI warning.
- Parse and map commands without adding context messages.
- Check system availability before provisioning each requested command.
- Await one provisioning operation for all required toolchains, passing `ctx.signal` through dependency planning, lease waits, probes, Node fetches, and child-process management.
- Return no replacement on success.
- Return Pi's blocking result with the concise recovery diagnostic on supported-platform failure.
- For unsupported platform/strategy, return no block and no notification in agent mode.
- Use Pi UI status/progress when interactive. Successful provisioning may notify the user, but must not inject an assistant/user/system message.
- Never provision in response to non-bash tools.

Confirm against the installed Pi type definitions while implementing. Add focused adapter tests demonstrating that the handler awaits provisioning, propagates `ctx.signal`, terminates cancelled installer work, and preserves the original command byte-for-byte.

## Documentation

Create `packages/pi-toolchain/README.md` with:

- global installation as the supported mode;
- requirement for Node.js/npm and a Bash-compatible POSIX environment;
- Linux/WSL support and per-tool macOS documentation status;
- native Windows behavior;
- config path and all fields;
- default machine-local toolkit and agent-bin paths, respecting non-empty `PI_CODING_AGENT_DIR`;
- proxy variables;
- automatic timeout and CLI timeout distinctions;
- CLI examples, JSON contract, dependency-safe uninstall, and probe-trigger behavior for `which`, `command -v`, and `type`;
- exact package-discovery order and development environment variable;
- no ancestor search;
- foreign shim/root conflict recovery;
- no system package managers, sudo, curl, or wget;
- official upstream URLs and security limitations;
- warning not to synchronize/reposition toolkit files;
- cleanup instructions driven by ownership manifests rather than broad `find` deletion.

Document each built-in with owned commands, dependencies, version policy, supported platform declarations, official site, and one-time smoke-check date/result.

## Verification plan

### Unit tests

Configuration:

- non-empty, empty, and unset `PI_CODING_AGENT_DIR`, including relative-path rejection and tilde expansion;
- global-only loading and dynamic toolkit default;
- enum, timeout, unknown-field, and invalid-field behavior.

Catalog and graph:

- duplicate IDs/commands;
- missing dependencies and cycles;
- deterministic topological and reverse removal order;
- command alias lookup;
- whole-set uninstall validation and suggested command.

Detection:

- positive provisioning behavior for `which`, `command -v`, and `type`, including a later execution call;
- quoted/comment/argument/heredoc negatives;
- explicit path and dynamic-name negatives;
- malformed parse fallback;
- deduplication and stable ordering.

Resolution and routing:

- exclude agent and managed paths from system lookup;
- requested-command-specific system satisfaction;
- both resolution orders;
- root `bin` before registered managed locations;
- argument, cwd, stdio, signal, and exit-code preservation;
- managed dependency environment construction.

State and ownership:

- root initialization and dangerous roots;
- containment and archive traversal attacks;
- manifest atomicity and corrupted schemas;
- orphan/stale/degraded classification;
- shim journal recovery, no-replace creation, descriptor identity refresh, post-install link reconciliation, and the documented non-cooperating-writer boundary;
- foreign conflict non-mutation;
- shared-command link retention if ever introduced.

Concurrency and transactions:

- identical ensure callers with different deadlines/signals detach independently, and underlying work aborts only after the last waiter leaves;
- incompatible lifecycle operations serialize and re-read state instead of joining;
- independent graph nodes run concurrently;
- shared dependency leases prevent install/uninstall races while allowing concurrent dependents;
- cross-process lease contention and stale same-host PID recovery;
- deadline includes lock wait and dependency work;
- failed first install publishes nothing;
- failed upgrade leaves prior executable and manifest active;
- interruption releases locks and leaves identifiable staging data.

Network and process:

- uppercase/lowercase proxy precedence, explicit empty clearing, scheme fallback, and `NO_PROXY`;
- normalized proxy propagation to child managers;
- redirect rejection and credential redaction;
- checksum-present and checksum-absent audit behavior;
- archive path safety;
- timeout process-group termination;
- failing `curl`/`wget` sentinels.

CLI and extension:

- every command's human and JSON output;
- stdout/stderr separation;
- exit categories;
- hidden run delimiter handling;
- unsupported platform CLI versus silent agent behavior, including a mixed supported/unsupported compound call;
- `ctx.signal` cancellation propagation;
- no prompt/context API calls;
- original bash command unchanged.

### Dummy integration tests

Build a dummy catalog with tiny local installer strategies to exercise end to end:

- `base` dependency and two dependent commands;
- concurrent provisioning and cross-process locking;
- install, repair, reinstall, upgrade, and explicit-set uninstall;
- staged failure and rollback;
- foreign agent-bin entries;
- package discovery in environment, global, physical exact project-root, spoofed `PWD`, and missing cases;
- canonical shim basename dispatch through relative links.

Use temporary HOME, agent directory, toolkit root, PATH, and local HTTP proxy/server fixtures. Tests must never write the developer's actual Pi directories.

### One-time real installer validation

During implementation, manually smoke each built-in strategy once on Linux for the repository's available architecture. Record command, date, resolved versions, official source, and outcome in package documentation. For cargo utilities, prove `--strategies crate-meta-data --disable-telemetry` succeeds and no compile/quick-install path is used.

Do not put real toolchain downloads in routine unit/CI runs. macOS requires official-documentation review only, not execution.

### Repository checks

Run at minimum:

```bash
pnpm --filter @hyxi/pi-toolchain build
pnpm --filter @hyxi/pi-toolchain check
pnpm check:type
pnpm check:eslint
pnpm check:prettier
pnpm check:test
```

Add a dist smoke check that imports the extension and runs `dist/cli.js help` and `dist/cli.js --json list` against isolated temporary directories.

## Implementation sequence

1. **Shared config foundation**
   Add agent-directory resolution and global-only/strict config support to `utils/config.ts`; update existing tests before introducing the package.

2. **Package skeleton and contracts**
   Add workspace metadata, build entries, exported catalog interfaces, config, platform identity, diagnostics, and JSON envelopes.

3. **Registry and dummy catalog**
   Implement registry validation, command lookup, dependency expansion, topological planning, and uninstall-set validation entirely against dummy definitions.

4. **Filesystem/state foundation**
   Implement paths, dangerous-root checks, root marker, atomic JSON, manifests, shim manifest, containment, and health classification.

5. **Canonical shim and routing**
   Implement package discovery, canonical script generation, relative links, foreign conflict behavior, executable resolution, environment construction, and hidden `run` dispatch.

6. **Shell detection**
   Validate and integrate the JS Bash parser, implement recursive traversal and dispatcher handlers, then add conservative fallback and the full corpus.

7. **Coordinator and transactions**
   Implement in-process joining, dependency scheduling, filesystem leases, caller deadlines, staging, commit, rollback, and process-group cancellation with dummy installers.

8. **Network and archive layer**
   Add proxy-aware fetch, redirect/integrity policy, safe extraction, source audits, and tests. Prove no curl/wget dependency.

9. **Core toolchains**
   Implement and manually validate `pnpm`, `python`, `rust`, and `julia` one at a time. Do not proceed past a strategy whose failed upgrade cannot preserve the old healthy version.

10. **Rust utility toolchains**
    Add the shared strict cargo-binstall strategy and validate `ripgrep`, `fd-find`, `bat`, `just`, and `hyperfine`, including the real `rust` dependency path.

11. **CLI**
    Complete public commands, JSON output, timeout behavior, dependency-safe uninstall diagnostics, and stable exit categories.

12. **Pi extension adapter**
    Wire awaited bash preflight, UI progress, supported failure blocking, and unsupported fail-open behavior. Verify no context manipulation.

13. **Documentation and final validation**
    Write README/catalog smoke records, run repository checks, inspect package contents, and exercise a clean temporary-agent installation through both CLI and Pi adapter fixtures.

## Completion criteria

The package is ready when:

- a missing supported bare command in a compound Pi bash call is detected and provisioned before the unchanged call executes;
- an existing usable system command prevents automatic duplicate installation;
- dependency concurrency installs Rust once for simultaneous Rust-utility requests;
- strict cargo-binstall never compiles or uses quick-install;
- proxies are honored by direct fetches and inherited by child installers;
- failed install/upgrade, timeout, and process interruption satisfy ownership and rollback invariants;
- explicit uninstall sets protect installed dependents and suggest a complete command;
- foreign files and links are never overwritten or removed;
- unsupported environments differ correctly between silent agent mode and actionable CLI mode;
- no extension path adds to or rewrites LLM context;
- automated dummy/unit suites pass without downloading real toolchains;
- each built-in has one documented Linux authoring smoke result and macOS support is based only on official documentation.
