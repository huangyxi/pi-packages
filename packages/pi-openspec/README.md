# @hyxi/pi-openspec

A Pi package that registers the [OpenSpec](https://openspec.dev/) agent skills, and the `/opsx-*` prompt templates.

## Installation

```bash
pi install npm:@hyxi/pi-openspec
```

Install it globally (user settings), not per project: the package provides the shared `openspec` CLI, skills and prompt templates for every project the agent works in.

Requires Node.js 22.19 or later — the same minimum Pi itself needs.

## What It Provides

- **Skills** (`dist/skills/`): one skill per OpenSpec workflow (`openspec-explore`, `openspec-propose`, `openspec-apply-change`, ...). Like all Pi skills, they use progressive disclosure: only the skill name and description sit in the system prompt, and the full `SKILL.md` is read on demand — no per-project `AGENTS.md` injection.
- **Prompt templates** (`dist/prompts/`): one `/opsx-<workflow>` command per workflow (`/opsx-propose`, `/opsx-apply`, `/opsx-archive`, ...), matching what `openspec init --tools pi` generates in `.pi/prompts/`.
- **`/opsx-init` command** (extension): copies the package's skills and prompts into the current project's `.pi/` directory, so a project keeps the OpenSpec surface even when the package itself is not installed there.
- **`openspec` on PATH**: installing the package writes a wrap script to the agent's `$PI_CODING_AGENT_DIR/bin/openspec` (`~/.pi/agent/bin/openspec` by default) that runs the bundled `@fission-ai/openspec` CLI, so skills that shell out to `openspec` work without a separate global install.

The skills and prompts are generated from the pinned `@fission-ai/openspec` release at build time; the rendering version is recorded in each skill's `generatedBy` frontmatter.

## How It Works

On install (and on update) the package writes the `openspec` wrap script into the agent's bin directory (`~/.pi/agent/bin` by default) — a directory Pi prepends to the bash tool's PATH. A file already present at that path without the package's managed marker is treated as user-managed and left untouched.

## Development

- `pnpm run build` bundles the extension and renders the exact artifacts `openspec init --tools pi` writes for the `pi` tool from the installed `@fission-ai/openspec` package, placing everything under `dist/`. No skills or prompts are committed to the repository. The `postinstall` hook runs the built installer (`dist/installShim.js`); on a fresh checkout, before the first build, it skips with a note instead of failing.
- The wrap script is a plain Node script that locates the bundled CLI at run time (the agent's npm root, the working directory, npm's global install location, and the package path recorded in Pi's settings for local-path installs), so it keeps working if the agent directory moves to another machine. It is built as a plain JS entry from its TypeScript source (`src/openspec-shim.ts` to `dist/openspecShim.js`), because the installed file is extensionless and Node only type-strips `.ts` files. `@fission-ai/openspec` is a runtime dependency, not a dev-only one, so the CLI exists wherever the package is installed.
- For a local-path install (`pi install /path/to/pi-openspec`) Pi never runs npm, so the `postinstall` hook does not fire — run `node dist/installShim.js` once after `pnpm run build`.
- The package version tracks the pinned `@fission-ai/openspec` version. Dependabot opens pull requests for new releases, and the [Sync OpenSpec Version workflow](../../.github/workflows/sync-openspec-version.yml) aligns the package version with the pinned dependency.
