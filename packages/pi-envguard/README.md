# @hyxi/pi-envguard

Pi Envguard reduces accidental disclosure of selected process-environment values in LLM-initiated tool use. It prepends a best-effort `unset` fragment to Bash commands and replaces exact protected values in configured text tool results before they enter model context and session persistence.

It is not a sandbox. Read the [security boundary](#security-boundary) before relying on it.

## Install

```sh
pi install npm:@hyxi/pi-envguard
```

## Configuration

Global configuration is read from `~/.pi/agent/extensions/envguard.json`, or from `$PI_CODING_AGENT_DIR/extensions/envguard.json` when that variable is set. A trusted project may add `.pi/extensions/envguard.json`. Untrusted project configuration is ignored.

Defaults:

```json
{
  "protectedEnvironmentVariables": [
    "*_TOKEN",
    "*_SECRET",
    "*_PASSWORD",
    "*_KEY"
  ],
  "filterBashEnvironment": true,
  "redactBashToolResults": true,
  "redactOtherBuiltinToolResults": false,
  "redactThirdPartyToolResults": false,
  "minimumRedactionValueLength": 8,
  "visiblePrefixLength": 4,
  "visibleSuffixLength": 0,
  "redactionMarker": "****"
}
```

| JSON key                         | Type                | Default                                      | Description                                                                                                                                                 |
| -------------------------------- | ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protectedEnvironmentVariables`  | ordered string list | `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_KEY` | Rules that select protected environment-variable names. The last matching rule wins; a leading `!` marks a match unprotected.                               |
| `+protectedEnvironmentVariables` | ordered string list | none                                         | Prepends rules to the inherited list in the current configuration scope. May coexist with the append modifier, but not with the bare replacement key.       |
| `protectedEnvironmentVariables+` | ordered string list | none                                         | Appends rules to the inherited list in the current configuration scope. May coexist with the prepend modifier, but not with the bare replacement key.       |
| `filterBashEnvironment`          | boolean             | `true`                                       | Prepends a same-line, best-effort `unset` fragment to LLM tool calls named `bash` when protected names exist.                                               |
| `redactBashToolResults`          | boolean             | `true`                                       | Redacts eligible text blocks returned by tools named `bash`, regardless of tool provenance.                                                                 |
| `redactOtherBuiltinToolResults`  | boolean             | `false`                                      | Redacts eligible text blocks returned by Pi built-in tools other than `bash`.                                                                               |
| `redactThirdPartyToolResults`    | boolean             | `false`                                      | Redacts eligible text blocks returned by SDK tools, extension tools, and tools with missing or unknown provenance.                                          |
| `minimumRedactionValueLength`    | integer >= 1        | `8`                                          | Minimum protected value length, measured in Unicode code points, that is eligible for output redaction. It does not affect Bash environment-name filtering. |
| `visiblePrefixLength`            | integer >= 0        | `4`                                          | Number of leading Unicode code points preserved when a protected value is redacted.                                                                         |
| `visibleSuffixLength`            | integer >= 0        | `0`                                          | Number of trailing Unicode code points preserved when a protected value is redacted.                                                                        |
| `redactionMarker`                | non-empty string    | `****`                                       | Fixed replacement text inserted between the visible prefix and suffix. It does not reveal the original value length.                                        |

Redaction can filter ordinary text when an enabled `redact*Results` setting covers the tool and a protected value is long enough to pass the threshold but also has ordinary meaning. Values are matched as exact, case-sensitive literal substrings without word-boundary or entropy checks. For example, a protected value such as `development` may occur in otherwise harmless prose and will still be replaced. Keep `minimumRedactionValueLength` high enough for your credential set, and avoid using common words as protected values when possible. A value shorter than the threshold is not text-redacted, but its environment variable name can still be removed from Bash.

$$ \text{visiblePrefixLength} + \text{visibleSuffixLength} < \text{minimumRedactionValueLength}. $$

Scalar settings use project-over-global-over-default precedence. Redaction lengths count Unicode code points. Prefix plus suffix must be less than the minimum redaction length, and the marker must not be empty.

Environment rules are case-sensitive, match the complete variable name, and support only `*` (zero or more characters) and `?` (one character). A leading `!` makes a match unprotected. Rules are evaluated in order and **the last matching rule wins**. Entries are neither trimmed nor deduplicated. Only valid shell environment names participate (i.e., environment variables like `ABC-KEY` are ignored).

A scope can replace the inherited list with `protectedEnvironmentVariables`, prepend with `+protectedEnvironmentVariables`, or append with `protectedEnvironmentVariables+`. Prepend and append may coexist; a replacement cannot coexist with either modifier.

For example, a global file can extend the defaults:

```json
{
  "+protectedEnvironmentVariables": ["COMPANY_*"],
  "protectedEnvironmentVariables+": ["!COMPANY_PUBLIC_TOKEN"]
}
```

A trusted project can then extend the resolved global list:

```json
{
  "+protectedEnvironmentVariables": ["PROJECT_CREDENTIAL"],
  "protectedEnvironmentVariables+": ["!PROJECT_TEST_KEY"],
  "redactOtherBuiltinToolResults": true
}
```

The final order is project prepend, global prepend, defaults or global replacement, global append, then project append. A project replacement replaces the entire globally resolved list.

Every existing loaded configuration file must be valid. Invalid JSON, unknown fields, invalid values, unreadable or unstable files, illegal list composition, and invalid cross-field combinations block input. Envguard reports all diagnostics without environment values. Fix or remove the named file and submit the input again; there is no last-known-good fallback.

## Temporary Bypass

A real interactive or RPC user can put one or more directives in a leading prompt header:

```text
<pi-envguard:skip-filter!>
<pi-envguard:skip-redaction!>
<pi-envguard:skip-all!>
```

Leading blank lines are allowed. Directive lines must match exactly after trimming and must be consecutive. Recognized header lines are removed before model delivery; identical text later in the prompt is ordinary text. Filter plus redaction is equivalent to all.

A non-steering input clears the previous bypass, then establishes the directive mode for that input and its subsequent tool calls. A steering header replaces the current mode for later tool calls; already-started calls retain their call-time snapshots. Tag-only steering is valid. Active mode appears persistently as `envguard: skip filter`, `envguard: skip redaction`, or `envguard: skip all`.

Bypass state clears on the next ordinary input, reload, session switch, fork, shutdown, or package disable/reload. Configuration validation, command cleanup, provenance classification, and diagnostics always remain active.

When `pi-subagents` starts a child with its documented `PI_SUBAGENT_CHILD=1` marker, active mode is propagated through `PI_ENVGUARD_BYPASS`. Envguard must also be loaded in the child; explicit extension allowlists must include it. The marker is advisory metadata, not authentication, and can be forged by another same-user process.

## Security Boundary

Bash filtering is best effort. Envguard prepends a same-line fragment such as:

```sh
unset -v -- 'API_KEY' 2>/dev/null || true; original command
```

The original command stays on physical line 1. Bash startup and `BASH_ENV` processing happen before this fragment. Readonly variables and other `unset` failures are suppressed so the requested command still runs. Filtering does not prevent indirect reads from files, parent processes, or other channels.

Redaction matches only exact, case-sensitive protected values as literal substrings in individual `text` blocks of intercepted tool results. There is no word-boundary or entropy check, so a common protected value can redact ordinary prose whenever the corresponding `redact*` setting is enabled. It does not redact transformed, encoded, split, hashed, or indirectly derived values. It does not change images, structured details, tool arguments, files on disk, or Bash full-output files. A value split across text blocks is not matched.

Pi tool-result handlers compose in extension load order. Load Envguard after other result-transforming extensions. Its result is protected before model context and persistence only when later handlers preserve the transformed content; a downstream handler can replace it with raw content.

Built-in Bash may stream raw partial output to the local TUI before the final `tool_result` event. The local display and full-output files can therefore contain unredacted values.

Envguard has no `user_bash` handler. Commands entered with `!` or `!!` receive no filtering, redaction, directive processing, or other Envguard behavior.

Envguard cannot prevent network transmission, shell startup disclosure, access to secret-bearing files, same-user process inspection, transformed disclosure, or malicious tool behavior. Use process isolation, least-privilege credentials, and a sandbox for enforceable containment.
