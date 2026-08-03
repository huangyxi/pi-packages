# Pi Envguard

Pi Envguard limits accidental exposure of selected process-environment secrets through LLM-initiated tools. It provides environment filtering as the primary control and output redaction as defense in depth, without claiming to be a sandbox.

## Language

**Protected environment variable**:
A valid shell environment variable whose name is currently selected for protection by the ordered environment rules.
_Avoid_: Secret variable, blocked variable

**Environment rule**:
An ordered name pattern that marks matching environment variables as protected or unprotected. The last rule matching a variable determines its protection decision.
_Avoid_: Filter, glob entry

**Protection decision**:
The protected or unprotected classification produced for an environment variable by its last matching environment rule. A variable with no matching rule is unprotected.
_Avoid_: Match result, policy result

**Environment filtering**:
The best-effort removal of protected environment variables before an LLM-requested shell script begins.
_Avoid_: Environment sanitization, sandboxing

**Output redaction**:
Replacement of exact protected literal values in eligible tool-result text at Pi Envguard's interception point, intended to keep those values out of model context and session history in a cooperative extension pipeline.
_Avoid_: Output filtering, leak prevention

**Temporary bypass**:
A user-granted, input-scoped suspension of environment filtering, output redaction, or both for subsequently initiated tool calls. It expires at the next non-steering user input.
_Avoid_: Disable flag, command exception

**Bypass directive**:
An exact leading input line through which an interactive or RPC user grants a temporary bypass.
_Avoid_: Bash tag, model instruction

**Tool-result category**:
One of Bash, other Pi built-in, or third-party, used to decide whether output redaction applies to a tool result.
_Avoid_: Tool type, provenance
