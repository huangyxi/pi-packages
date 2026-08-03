# Keep the runtime catalog built in and dependency-aware

Toolchains implement exported `ToolchainDefinition` and `InstallerStrategy` interfaces in a validated built-in catalog. Dependencies are explicit toolchain IDs forming an acyclic graph; host prerequisites such as Node.js are probes rather than managed dependencies. Version 1 does not load installer commands, URLs, or third-party registrations from configuration because provisioning is a privileged arbitrary-code boundary.

## Consequences

Adding a toolchain requires a source change, registry validation, tests, and a one-time installer smoke check. The public interfaces make additions and isolated tests straightforward without committing to a runtime plugin trust model.
