# Pi Packages

Pi extensions and related packages maintained in this workspace.

## Install

Install a published package with Pi's package manager. For example:

```bash
pi install npm:@hyxi/pi-attach
```

Pi installs packages globally by default. Add `-l` to install into the current project's `.pi/settings.json` instead.

## Packages

| Package                                     | Installation                        | Description                                                                                                        |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [@hyxi/pi-attach](packages/pi-attach)       | `pi install npm:@hyxi/pi-attach`    | Adds persistent, bounded context from explicit file, URL, and skill mentions without rewriting the user's message. |
| [@hyxi/pi-toolchain](packages/pi-toolchain) | `pi install npm:@hyxi/pi-toolchain` | Provisions supported user-space toolchains before unchanged Pi Bash calls and routes manifest-owned commands.      |
