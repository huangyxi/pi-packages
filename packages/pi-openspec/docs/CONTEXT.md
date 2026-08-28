# Pi OpenSpec

Pi OpenSpec ships OpenSpec's agent skills, `/opsx-*` prompt templates, and an `/opsx-init` extension command as a Pi package, so installing the package replaces the per-project `openspec init` setup step for Pi.

## Language

**Workflow**:
A single OpenSpec unit of work (explore, propose, apply, update, sync, archive, ...), authored once in OpenSpec and distributed as both a skill and a command.
_Avoid_: Task, slash command

**Asset**:
A rendered skill or prompt file this package ships under `dist/`. Assets are derived artifacts, never authored or committed in this repository.
_Avoid_: Template, source

**Source package**:
The pinned `@fission-ai/openspec` runtime dependency whose modules render the assets at build time and whose CLI the skills invoke at run time.
_Avoid_: Upstream, openspec

**Wrap script**:
The Node script (node shebang) the package's `session_start` hook installs at the agent's bin directory (default `~/.pi/agent/bin/openspec`). It locates the bundled OpenSpec CLI at run time — from the agent's npm install root, falling back to the current working directory, to npm's default global install location, and, last, to the package path recorded in Pi's settings (local-path installs) — so `openspec` is on the agent's PATH.
_Avoid_: Shim, global install

**Generated-by version**:
The `@fission-ai/openspec` version recorded in each skill's `generatedBy` frontmatter, identifying which source release produced the shipped assets.
_Avoid_: Template version

**Init command**:
The `/opsx-init` extension command that copies the package's rendered skills and prompts into the current project's `.pi/` directory, mirroring what `openspec init` writes for the pi tool.
_Avoid_: Installer, setup

## Decisions

- Assets are rendered at build time from the installed source package, so skills and prompts always match the pinned OpenSpec release and cannot drift from it. See [ADR 0001](adr/0001-generate-openspec-assets-at-build-time.md).
- The source package is a runtime dependency and its wrap script is installed by the extension's `session_start` hook on install, update, and startup, because the shipped skills shell out to the `openspec` CLI. This also works when npm lifecycle scripts are disabled. See [ADR 0002](adr/0002-bundle-the-openspec-cli-behind-a-wrap-script.md).
- The package version tracks the pinned OpenSpec version, kept aligned by the Sync OpenSpec Version workflow.
