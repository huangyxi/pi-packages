# Pi OpenSpec

Pi OpenSpec ships OpenSpec's agent skills and `/opsx-*` prompt templates as a Pi package, so installing the package replaces the per-project `openspec init` setup step for Pi.

## Language

**Workflow**:
A single OpenSpec unit of work (explore, propose, apply, update, sync, archive, ...), authored once in OpenSpec and distributed as both a skill and a command.
_Avoid_: Command, task

**Asset**:
A rendered skill or prompt file this package ships under `dist/`. Assets are derived artifacts, never authored or committed in this repository.
_Avoid_: Template, source

**Source package**:
The pinned `@fission-ai/openspec` devDependency whose modules render the assets at build time.
_Avoid_: Upstream, openspec

**Generated-by version**:
The `@fission-ai/openspec` version recorded in each skill's `generatedBy` frontmatter, identifying which source release produced the shipped assets.
_Avoid_: Package version

## Decisions

- Assets are rendered at build time from the installed source package, so skills and prompts always match the pinned OpenSpec release and cannot drift from it. See [ADR 0001](adr/0001-generate-openspec-assets-at-build-time.md).
