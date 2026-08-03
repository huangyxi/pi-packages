# Provision portable toolchains without host package managers

Managed installations use official user-space installers, release artifacts, or official language-package channels and never invoke `sudo` or a system package manager. Direct downloads use the package's Node-based, proxy-aware fetch layer instead of `curl` or `wget`; stable upstream endpoints resolve latest artifacts at runtime so the source does not carry release-specific URL or checksum tables.

## Consequences

Linux and WSL are the primary supported environments. A catalog strategy supports macOS only when official documentation maps cleanly to the same model; native Windows and difficult platform/tool combinations fail open in agent mode and direct CLI users to the official installation site. The toolkit root is machine-local and is not portable across platforms.
