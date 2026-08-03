# Pi Toolchain Context

`@hyxi/pi-toolchain` gives Pi sessions access to managed, portable command-line toolchains without requiring host package-manager privileges.

## Language

**Toolchain**:
A catalog entry that owns one or more commands, an installation lifecycle, and optional dependencies on other toolchains.
_Avoid_: Ecosystem, package, runtime

**Command**:
An executable name owned by exactly one toolchain and recognized in shell command position.
_Avoid_: Tool, binary name

**Installer strategy**:
The catalog-defined policy for acquiring, probing, upgrading, repairing, and removing a toolchain on a supported platform.
_Avoid_: Install script, recipe

**Catalog**:
The validated, built-in set of toolchain definitions available to the extension and CLI.
_Avoid_: Plugin registry, package index

**Managed installation**:
Files that have committed ownership metadata under the configured toolkit root and pass the owning toolchain's health probes.
_Avoid_: Local install, cached tool

**System command**:
A usable executable found outside Pi's shim directory and outside managed toolkit storage.
_Avoid_: Global tool, host tool

**Shim**:
An agent command entry through which managed command invocation is routed.
_Avoid_: Wrapper binary, alias

**Toolkit root**:
The dedicated, machine-local directory containing managed installations, state, staging data, and locks.
_Avoid_: Toolchain, agent directory

**Provisioning**:
Dependency-aware work that makes a requested toolchain healthy before its command is invoked.
_Avoid_: Bootstrap, setup

**Ownership manifest**:
Committed metadata that identifies files and command links owned by a managed installation.
_Avoid_: Lockfile, receipt

**Health probe**:
A catalog-defined command check that establishes whether an owned installation is currently usable.
_Avoid_: Presence check, version lookup

**Degraded installation**:
An installation with ownership metadata whose required health probes no longer pass.
_Avoid_: Missing tool, partial install

**Foreign shim**:
An agent command entry that is not owned by `@hyxi/pi-toolchain`.
_Avoid_: Conflicting tool
