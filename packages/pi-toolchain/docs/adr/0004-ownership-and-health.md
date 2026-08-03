# Separate ownership from health

Ownership manifests are the sole authority for files that `@hyxi/pi-toolchain` may update or delete, while catalog probes determine whether those files form a healthy installation. Installation and upgrade commit metadata and expose shims only after successful probes; upgrades must preserve the prior healthy version on failure.

## Consequences

Unmanaged files are never adopted or deleted, even when their names match catalog commands. Owned files with failing probes are degraded and repairable. Installer strategies that cannot preserve a working version during failed upgrade must use isolated versioned storage or remain non-upgradeable.
