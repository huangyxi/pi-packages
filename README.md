# Pi Packages

Pi extensions and related packages maintained in this workspace.

## Installation

Install a published package with Pi's package manager. For example:

```bash
pi install npm:@hyxi/pi-attach
```

Pi installs packages globally by default. Add `-l` to install into the current project's `.pi/settings.json` instead.

## Packages

| Package                                   | Installation                       | Description                                                     |
| ----------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| [@hyxi/pi-attach](packages/pi-attach)     | `pi install npm:@hyxi/pi-attach`   | Bounded context from explicit file and URL attachment mentions. |
| [@hyxi/pi-envguard](packages/pi-envguard) | `pi install npm:@hyxi/pi-envguard` | Environment filtering and tool-result redaction.                |
