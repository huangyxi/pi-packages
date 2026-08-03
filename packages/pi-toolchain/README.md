# @hyxi/pi-toolchain

Pi extension and CLI for dependency-aware, user-space toolchain provisioning. It observes supported bare commands in Pi Bash calls, provisions missing supported tools, and lets Pi execute the original command unchanged.

## Install

Global Pi installation is the supported mode:

```bash
pi install npm:@hyxi/pi-toolchain
```

Node.js 24+, npm, and a Bash-compatible POSIX environment are required. Native Windows is unsupported. WSL is treated as Linux.

This release implements automatic lifecycle strategies for `pnpm`, Python through official uv plus managed CPython, Rust through checksummed rustup plus official cargo-binstall, and Julia through the official portable Juliaup release on Linux x64/arm64. `pnpm` also declares macOS x64/arm64 support through its npm distribution. The five strict cargo-binstall utility strategies are implemented but deliberately retain empty platform matrices until the required real `crate-meta-data` smoke proves that each upstream publishes a usable binary without compile or quick-install fallback. Agent interception silently leaves those unsupported utilities to Bash; the CLI reports exit code 3 and the official recovery URL.

## Behavior

The extension uses `@ericcornelissen/bash-parser` behind an internal AST facade for lists, pipelines, groups, functions, substitutions, and command positions. Unsupported or malformed syntax uses a conservative tokenizer fallback; parse failure alone never blocks. It detects supported dispatcher positions including `which`, `type`, `command -v`, `env`, `xargs`, and `find -exec`. Explicit paths, quoted command names, comments, redirect targets, assignment values, and heredoc bodies do not trigger provisioning. Detection never evaluates shell input and never rewrites the Bash command or adds model context.

Automatic provisioning uses an existing usable system command rather than installing a duplicate. Managed commands are routed through relative links in the Pi agent bin to one ownership-manifested `pi-toolchain` script. Foreign files and links are never adopted, overwritten, or broadly deleted.

Provisioning does not invoke `sudo`, a system package manager, `curl`, or `wget`. Direct downloads use a package-owned Undici dispatcher. Installer subprocesses use argument arrays and receive cancellation through process-group TERM/KILL handling.

## Configuration

Only the global file is read:

```text
${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/toolchain.json
```

```json
{
  "toolkitDirectory": "/absolute/path/to/toolchain",
  "toolResolutionOrder": "managed-first",
  "automaticInstallationTimeoutSeconds": 600
}
```

The toolkit default is `<agent-directory>/toolchain`. Relative toolkit paths resolve beneath the agent directory; `~` expands to the home directory. A non-empty `PI_CODING_AGENT_DIR` must be absolute. Timeout `0` disables the automatic deadline, not installation. CLI mutation commands have no deadline unless `--timeout` is supplied.

`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` are honored in uppercase and lowercase. Lowercase presence takes precedence; an empty lowercase value clears its uppercase counterpart. Credentials are redacted from diagnostics.

## CLI

```text
pi-toolchain install <name>... [--timeout <seconds>] [--json]
pi-toolchain upgrade [<name>...] [--timeout <seconds>] [--json]
pi-toolchain reinstall <name>... [--timeout <seconds>] [--json]
pi-toolchain uninstall <name>... [--timeout <seconds>] [--json]
pi-toolchain list [--json]
pi-toolchain status [<name>...] [--json]
pi-toolchain show <name> [--json]
pi-toolchain help [command]
```

Names may be canonical IDs or owned commands, such as `rg` for `ripgrep`. Uninstall requires the complete explicit dependent set; there is no implicit cascade. JSON mode emits exactly one schema-version-1 envelope to stdout and mutation progress to stderr.

Exit codes are 0 success, 2 usage/configuration, 3 unsupported, 4 dependency conflict, 5 deadline/lock wait, 6 lifecycle/probe failure, 7 root/manifest/foreign ownership conflict, and 130 cancellation.

## Package Discovery

The canonical Bash shim checks, in order:

1. Non-empty absolute `PI_TOOLCHAIN_PACKAGE_DIR` (development trust override).
2. `<agent-directory>/npm/node_modules/@hyxi/pi-toolchain`.
3. `<physical-current-directory>/.pi/npm/node_modules/@hyxi/pi-toolchain` exactly.

There is no ancestor search, and inherited `PWD` is not trusted. The project fallback executes project code; use it only in a trusted project.

## Ownership and Recovery

The toolkit is machine-local and must not be synchronized or repositioned. Its platform/machine root marker and installation manifests authorize mutation. A non-empty unmarked toolkit root, corrupt manifest, changed canonical shim, or unclaimed agent-bin entry is a conflict and remains untouched.

Inspect `pi-toolchain status` and move foreign entries aside manually before retrying. Cleanup should use explicit `pi-toolchain uninstall` commands so manifest containment checks are applied. Do not use broad `find` deletion against the toolkit or agent bin.

## Built-in Catalog

| ID          | Commands                                                | Dependency | Lifecycle status                            | Official site                         |
| ----------- | ------------------------------------------------------- | ---------- | ------------------------------------------- | ------------------------------------- |
| `pnpm`      | `pnpm`, optional `pnpx`                                 | none       | npm-prefix, latest; Linux/macOS x64/arm64   | https://pnpm.io/installation          |
| `python`    | `uv`, `uvx`, `python`, `python3`                        | none       | official uv + CPython; Linux x64/arm64      | https://docs.astral.sh/uv/            |
| `rust`      | `rustup`, `cargo`, `rustc`, `rustdoc`, `cargo-binstall` | none       | official checked artifacts; Linux x64/arm64 | https://rustup.rs/                    |
| `julia`     | `julia`, `juliaup`                                      | none       | official portable Juliaup; Linux x64/arm64  | https://julialang.org/install/        |
| `ripgrep`   | `rg`                                                    | `rust`     | release gate pending                        | https://github.com/BurntSushi/ripgrep |
| `fd-find`   | `fd`                                                    | `rust`     | release gate pending                        | https://github.com/sharkdp/fd         |
| `bat`       | `bat`                                                   | `rust`     | release gate pending                        | https://github.com/sharkdp/bat        |
| `just`      | `just`                                                  | `rust`     | release gate pending                        | https://github.com/casey/just         |
| `hyperfine` | `hyperfine`                                             | `rust`     | release gate pending                        | https://github.com/sharkdp/hyperfine  |

No real installer smoke downloads were run during this implementation. On 2026-08-02, bounded GitHub release-metadata inspection confirmed the runtime asset naming used for uv 0.12.1, cargo-binstall 1.21.1, and Juliaup 1.20.9 on Linux x64/arm64; this was metadata validation, not an installation smoke. The strict Rust utility entries remain platform-disabled until a dated isolated smoke confirms `--strategies crate-meta-data --disable-telemetry` succeeds without compilation or quick-install. The Linux declarations for Python, Rust, and Julia reflect implemented official artifact flows and fixture validation, but remain a release risk until the documented real smoke is performed. macOS declarations beyond pnpm remain absent pending official-flow review.
