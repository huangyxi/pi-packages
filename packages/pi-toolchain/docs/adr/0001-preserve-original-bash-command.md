# Intercept bash calls and preserve the original command

`@hyxi/pi-toolchain` provisions missing commands in Pi's awaited `tool_call` preflight, then allows the original bash command to execute unchanged. Commands are routed by a canonical agent-bin shim and relative command links, not by rewriting shell text or adding instructions to the model context. This keeps shell semantics under Pi's normal bash implementation while allowing compound commands to wait for provisioning.

## Consequences

The extension must parse shell syntax only to discover command demand; parser failure must not alter the command. Managed routing depends on Pi's agent bin directory being on `PATH`, and explicit absolute or relative executable paths are not rerouted.
