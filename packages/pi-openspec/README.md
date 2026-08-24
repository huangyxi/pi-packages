# @hyxi/pi-openspec

A Pi package that registers the OpenSpec agent skills and `/opsx-*` prompt templates, so spec-driven development works without running `openspec init` in every project.

## Installation

```bash
pi install npm:@hyxi/pi-openspec
```

## What It Provides

- **Skills** (`dist/skills/`): one skill per OpenSpec workflow (`openspec-explore`, `openspec-propose`, `openspec-apply-change`, ...). Like all Pi skills, they use progressive disclosure: only the skill name and description sit in the system prompt, and the full `SKILL.md` is read on demand — no per-project `AGENTS.md` injection.
- **Prompt templates** (`dist/prompts/`): one `/opsx-<workflow>` command per workflow (`/opsx-propose`, `/opsx-apply`, `/opsx-archive`, ...), matching what `openspec init --tools pi` generates in `.pi/prompts/`.

Both surfaces are generated from the pinned `@fission-ai/openspec` release at build time; the rendering version is recorded in each skill's `generatedBy` frontmatter.

## How It Works

`pnpm run build` renders the exact artifacts `openspec init --tools pi` writes for the `pi` tool (skills into `.pi/skills/`, commands into `.pi/prompts/`) from the installed `@fission-ai/openspec` package, and places them under `dist/`. The package manifest registers those directories, so Pi loads them directly. No skills or prompts are committed to the repository.

The [Bump OpenSpec workflow](../../.github/workflows/bump-openspec.yml) watches the npm registry and opens a pull request for new `@fission-ai/openspec` releases, verifying the bumped build before merge.
