# Implement Pi Envguard

## Goal

Add `@hyxi/pi-envguard` at `packages/pi-envguard`. The Pi extension reduces accidental disclosure of selected process-environment values by:

1. attempting to remove protected variables before an LLM-initiated Bash script body;
2. replacing exact protected values in configured tool-result text at Pi Envguard's interception point, before model context and persistence when later extension handlers preserve the transformed result; and
3. allowing a real user to grant a visible, temporary bypass for an input and its subsequent tool calls.

The extension is not a sandbox. It cannot prevent shell startup behavior, transformed or encoded disclosure, split values, hashes, indirect reads, network transmission, raw terminal display, or access to files containing secrets. Its subagent marker is propagation metadata, not authentication, and downstream result-transforming extensions can weaken redaction if they replace Envguard's output.

`user_bash` is entirely out of scope: no filtering, redaction, directives, or event handler.

## Package Shape

Create a package consistent with `packages/pi-attach`:

```text
packages/pi-envguard/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
|   ├── CONTEXT.md
│   ├── PLAN.md
│   └── adr/
├── src/
│   ├── bypass.ts
│   ├── config.ts
│   ├── directives.ts
│   ├── environment.ts
│   ├── extension.ts
│   ├── redaction.ts
│   ├── runtime.ts
│   ├── shell.ts
│   └── tool-guard.ts
└── test/
    ├── config.test.ts
    ├── directives.test.ts
    ├── extension.test.ts
    ├── redaction.test.ts
    └── shell.test.ts
```

Build one ESM extension entry with Vite, target Node 24, and expose `dist/extension.js` through the package's `pi.extensions`, `main`, and `exports` fields. Use the repository `defineExtensionConfig` helper so the root `@` alias, ESM library build, Node externals, and package banner remain shared with `pi-attach`; package configs declare only additional entries and package-specific externals. Follow the existing lint, typecheck, test, build, and smoke script conventions.

## Configuration

### Locations and trust

Read:

- global configuration from `~/.pi/agent/extensions/envguard.json`, respecting `PI_CODING_AGENT_DIR`; and
- project configuration from `.pi/extensions/envguard.json` only when the project is trusted.

An untrusted project file is not read and cannot block input. A missing file is valid and contributes nothing.

### Schema

Built-in defaults are:

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

Scalar fields use project-over-global-over-default precedence.

The four redaction-shape fields form one validation group:

- `minimumRedactionValueLength` is an integer at least `1`;
- `visiblePrefixLength` and `visibleSuffixLength` are nonnegative integers;
- their sum is less than `minimumRedactionValueLength`; and
- `redactionMarker` is a nonempty string.

Lengths count Unicode code points.

Validate the group transactionally after applying each scope to its inherited configuration. Defaults are valid by construction. Apply all global overrides, then validate the resulting group; an invalid combination is attributed to and invalidates the global file. Only after a valid global result should project overrides be applied and validated; an invalid resulting combination is attributed to and invalidates the project file. A later scope cannot repair an invalid earlier scope because any invalid loaded scope blocks input.

### Ordered environment rules

`protectedEnvironmentVariables` is an ordered string list. A rule supports only:

- `*` for zero or more characters;
- `?` for exactly one character; and
- literal matching for every other character.

Matching is case-sensitive and covers the complete variable name. A leading `!` makes the rule's decision unprotected and is removed before pattern compilation. The remaining pattern must be nonempty. Entries are not trimmed or deduplicated. The last matching rule wins; no match means unprotected.

Every entry must be a string. Any invalid entry invalidates its containing collection field. Empty lists are valid.

Only environment names matching `[A-Za-z_][A-Za-z0-9_]*` participate. Ignore all other process-environment entries for both filtering and redaction.

### Collection composition

Each global or project file may use:

```text
+protectedEnvironmentVariables   prepend
protectedEnvironmentVariables    replace
protectedEnvironmentVariables+   append
```

Prepend and append may coexist. The bare field may not coexist with either modifier. Each scope computes:

```text
scope prepend + inherited rules + scope append
```

Consequently, with both scopes extending defaults, the final order is:

```text
project prepend
+ global prepend
+ built-in defaults or global replacement
+ global append
+ project append
```

A later project replacement replaces the fully resolved global/default list before any project prepend or append would apply; because bare and modifiers cannot coexist in one scope, a replacing scope contributes only its bare list.

Do not deduplicate repeated patterns. Later duplicate or overlapping rules retain last-match precedence. Bare empty replaces with no rules; modified empty adds nothing.

### Fatal input validation

Any issue in an existing global or trusted-project file blocks the received input. Issues include:

- unreadable or unstable files;
- invalid JSON or a non-object root;
- unknown fields;
- invalid scalar values or redaction-shape combinations;
- invalid rule entries; and
- illegal coexistence of a bare collection field with a modifier.

Do not partially apply valid fields from an invalid file and do not retain a last-known-good version. An invalid project file does not fall back and continue with global policy; input remains blocked until every loaded scope is valid.

Use the shared loader's existing `reportIssue(message)` wording, such as:

```text
invalid configuration: /path/to/envguard.json
unknown redactBashToolsResults in /path/to/envguard.json
invalid visiblePrefixLength in /path/to/envguard.json
```

Collect all issues into one value-free notification for every blocked input. Use `ctx.ui.notify` when `ctx.hasUI`; Pi transports this to both TUI and RPC. Also write the diagnostic to stderr in print/JSON modes so a blocked child process does not fail silently.

A blocked non-steering interactive/RPC input clears the previous bypass but cannot establish a new one. A blocked steering input leaves bypass state unchanged and calls `ctx.abort()` to stop the active turn. Completed side effects cannot be undone. Extension-origin input never changes bypass state.

## Shared Config Reader

Deepen `src/utils/config.ts` with a reusable schema-bound reader and delete the former stateless readers once callers migrate. Tests exercise the production reader rather than retaining compatibility wrappers used only by Vitest:

```ts
const reader = createConfigReader(schema);
const result = await reader.read({ cwd, trusted, reportIssue });
```

The reader owns independent global/project caches. For each path it caches valid, invalid, and missing outcomes by a metadata signature containing `dev`, `ino`, `size`, `mtimeNs`, and `ctimeNs` from `stat(..., { bigint: true })`.

On every Pi `input` event, including steering, check both applicable paths. If metadata is unchanged, reuse the parsed result and replay cached issue messages through `reportIssue`. If a file changes during reading, compare metadata before and after, retry once, and then return an unstable-file issue if it changes again. Expose `invalidate()` for reload handling and tests. Do not use `fs.watch` or retain a last-known-good value.

Add a general ordered-list field/composition facility to the shared schema module rather than hard-coding `pi-envguard` field names there. The reader result must distinguish a valid resolved config from a configuration carrying issues so `pi-envguard` can block while existing callers retain their own issue policy.

Migrate `pi-attach` to a schema-bound reader without changing its current configuration semantics. Baseline measurements in this workspace for 100 trusted resolutions were approximately 26 ms with both files missing and 66 ms with both present; metadata checks were approximately 0.08-0.11 ms per path. Add deterministic cache tests rather than performance assertions.

## Environment Resolution

Compile environment-rule matchers when resolved configuration changes. Do not cache `process.env`: in-process extensions can mutate it and Pi provides no change event.

At each `tool_call`:

1. enumerate valid environment entries;
2. apply all ordered rules to each name;
3. collect protected names for Bash filtering;
4. collect eligible protected literal values for redaction; and
5. save the values and frozen call policy under `toolCallId`.

At `tool_result`, scan `process.env` again using the call-time rules and union those protected values with the call-time values. This catches values replaced or deleted during execution. Equal literal values are deduplicated. If any protected variable contains a value, that value is redaction-eligible even when an unprotected variable contains the same value.

Filtering considers protected names regardless of value length. Redaction ignores values shorter than `minimumRedactionValueLength` code points, including empty values.

## Bash Environment Filtering

### Injection

Intercept only LLM `tool_call` events whose tool name is exactly `bash`. Do not replace Pi's Bash tool. If `filterBashEnvironment` is enabled, filtering is not bypassed, and protected names exist, prepend one shell fragment without adding a newline:

```bash
unset -v -- 'A_KEY' 'B_KEY' 2>/dev/null || true; original first line
```

Use a shell-quoting helper even though accepted names are valid identifiers. The original first line remains physical line 1, preserving subsequent line numbers.

This filtering is intentionally best effort. Bash and `BASH_ENV` startup behavior occurs before the fragment. Readonly variables or other `unset` failures are suppressed, and the requested script still runs. Document this weaker guarantee prominently.

If filtering is required but a tool named `bash` has no mutable string `command`, block execution and issue a value-free TUI/RPC diagnostic. Do not infer third-party argument shapes. Permit execution when filtering is disabled, no names are protected, or filter bypass is active.

### Composable cleanup

Do not save and later replace the whole command. Other extensions may transform it too. For every injected call, retain the mutable input reference and the exact `injectedSegment` under `toolCallId`.

At `tool_result`, find and remove one occurrence of only that exact segment from the current command, preserving all surrounding transformations. Perform the same cleanup over outstanding records from `context`, `turn_end`, and `session_shutdown` handlers. If the exact segment is already absent, do nothing. Rewriting the inside of another extension's injected fragment is outside the supported composition contract.

Pi persists the original assistant tool call before `tool_call` interception. Verify that ordering in integration tests. The cleanup paths ensure the transient execution command does not remain in live model context. Process failure leaves the already-persisted original command on disk.

## Output Redaction

### Category policy

Freeze category and redaction settings at `tool_call`. Category precedence is:

1. a tool named `bash` uses `redactBashToolResults`, regardless of provenance;
2. another tool with `sourceInfo.source === "builtin"` uses `redactOtherBuiltinToolResults`; and
3. SDK, extension, missing, and unknown provenance use `redactThirdPartyToolResults`.

Use `pi.getAllTools()` at call time rather than a hard-coded built-in-name list. If a result has no captured call state, apply a conservative current-policy fallback; if safe redaction policy cannot be established for an otherwise enabled category, withhold eligible text.

### Eligible content

Redact only string `text` values in result `content` blocks whose type is `text`, including error text. Process blocks independently. Never alter:

- images or other non-text content blocks;
- structured `details`;
- tool-call arguments;
- files on disk, including Bash full-output files; or
- `user_bash` output.

A value split across text blocks is not a literal occurrence within either block and is not matched.

Redaction is prospective. Process only tool results intercepted after `pi-envguard` loads. Do not scan or rewrite earlier session history in the `context` handler. A per-call bypassed result remains raw in later history.

### Literal replacement

Match exact, case-sensitive protected values. Deduplicate equal values and prefer the longest match at a position. Replace original occurrences in one non-recursive logical pass so generated prefix, suffix, and marker text are never rescanned.

For each match, preserve the configured number of leading and trailing Unicode code points and place `redactionMarker` between them. The marker has fixed configured length and does not reveal the original value length. With defaults, `abcdefgh1234` becomes `abcd****`.

Use a deterministic multi-literal matcher rather than dynamically executing user-controlled regular expressions. Do not add arbitrary secret-count or value-length limits in the initial release; cover large collections and output with tests.

If redaction throws for any eligible block in an enabled result, replace every eligible text block in that result with:

```text
[pi-envguard: output withheld because redaction failed]
```

Preserve `isError`, images, non-text blocks, and structured `details`. Notify TUI/RPC without values or output content.

### Visibility boundary

The final result is redacted at Pi Envguard's handler before model context and session-history persistence. `tool_result` handlers compose in extension order, so this guarantee requires later handlers to preserve the transformed content. Recommend loading Pi Envguard after other result-transforming extensions; a downstream handler that restores or replaces raw content is outside the protection guarantee.

Built-in Bash may already have streamed raw partial output to the local TUI before `tool_result`. Full-output files also remain raw. This package protects cooperative model/persisted result context, not the local display or filesystem.

## Temporary Bypass

### Directives

Recognize these fixed, case-sensitive tags:

```text
<pi-envguard:skip-filter!>
<pi-envguard:skip-redaction!>
<pi-envguard:skip-all!>
```

Only `interactive` and `rpc` input may alter bypass state. `extension` input neither activates nor clears it.

Recognize tags only in a leading directive header:

1. skip initial blank lines;
2. consume one or more consecutive lines that exactly equal a directive after line trimming;
3. stop at the first other nonblank line; and
4. leave identical lines later in the prompt untouched as ordinary text.

Remove recognized header lines before model delivery. Union multiple tags in one header; duplicate tags are harmless, filter plus redaction equals all, and all dominates. There is no reserved-prefix or malformed-tag handling: anything not exactly recognized is ordinary input.

A non-steering tagged input must retain nonblank text or at least one image after removal. Tag-only steering is valid: update state, return `action: "handled"`, and do not send an empty steer to the model.

### Lifetime and call snapshots

A non-steering interactive/RPC input clears the previous mode and then may establish a new mode for its work. Steering does not clear state; a steering header replaces the active mode with the union from that header. The mode expires at the next non-steering interactive/RPC input.

Display a persistent status while active:

```text
envguard: skip filter
envguard: skip redaction
envguard: skip all
```

Clear status with the mode. Do not add bypass messages to model context.

Snapshot bypass at `tool_call`. Later steering or follow-up input affects subsequent calls, not already-started calls. `skip-filter!` suspends Bash environment filtering only; `skip-redaction!` suspends all configured result categories; `skip-all!` suspends both. Bypass never disables configuration validation, directive parsing, command cleanup, provenance classification, notifications, or other internal checks.

Clear bypass on `/reload`, session switch, fork, shutdown, and package disable/reload.

### Subagent propagation

While bypass is active, maintain a non-secret `PI_ENVGUARD_BYPASS` process marker with value `filter`, `redaction`, or `all`. Remove it when state clears.

A root session ignores an ambient preexisting marker. Trust it only when `PI_SUBAGENT_CHILD=1`, the documented `pi-subagents` child marker. A child keeps inherited mode through its initial task input; its next non-steering interactive/RPC input clears it. Nested children inherit their immediate parent's current marker. Already-running children retain the environment copy received at spawn when the parent later clears its marker.

A parent steering activation affects children spawned afterward, not already-running child processes. An existing child must receive a directive through its own steering channel.

Support is conditional on `pi-envguard` being loaded in the child. Ambient subagents normally satisfy this; explicit extension allowlists must include it. Do not couple to `pi-subagents` implementation beyond its documented environment marker.

This propagation is advisory, not authenticated. An LLM-requested shell process or another same-user process can forge `PI_SUBAGENT_CHILD` and `PI_ENVGUARD_BYPASS` when launching a nested Pi process. Preventing that requires a sandbox or authenticated process-launch channel and is outside this package's accidental-exposure boundary.

## Runtime State

Keep extension-instance state explicit and divide runtime ownership by responsibility:

- `extension.ts` constructs one runtime and registers Pi event hooks;
- `runtime.ts` owns resolved configuration, compiled rules, and input/session lifecycle;
- `bypass.ts` owns active bypass, inherited-child initialization, status, and process-marker ownership; and
- `tool-guard.ts` owns the per-call records and all Bash/result interception.

The tool guard retains this call record shape:

```ts
interface ToolCallRecord {
  input: { command?: unknown };
  injectedSegment?: string;
  policy: FrozenToolPolicy;
  protectedValuesAtCall: readonly string[];
}
```

Maintain:

- the latest valid resolved configuration and compiled rules;
- active bypass and inherited-child initialization state;
- a `Map<string, ToolCallRecord>` keyed by `toolCallId`; and
- status ownership and process-marker ownership.

Delete call records after `tool_result`; use `turn_end` as fallback cleanup. Lifecycle handlers must clean command fragments, status, and owned process markers without disturbing values owned by another instance.

Parallel tool calls must have independent records. Avoid mutable turn-global policy for result decisions.

## Failure Policy

- Invalid loaded configuration: block input; abort an active turn discovered through steering.
- Required Bash filtering with malformed Bash input: block the tool call.
- `unset` failure: suppress and continue; filtering is best effort.
- Redaction failure: withhold all eligible text in that result.
- Missing tool-call snapshot: prefer redaction or withholding over passing potentially eligible raw text.
- Notification: TUI/RPC through `ctx.ui.notify`; stderr fallback without UI.
- Diagnostics: include paths, field names, tool names, and environment variable names when needed, but never environment values or raw tool output.

## Shared Utility Work

Modify `src/utils/config.ts` and its tests to add:

1. schema-bound metadata-cached readers;
2. cache invalidation and stable-read retry;
3. ordered string-list fields with prepend/replace/append composition;
4. issue collection/replay suitable for caller-selected fatal behavior; and
5. cross-field validation groups.

Delete the former `readConfig` and `readGlobalConfig` wrappers after migrating callers; test compatibility behavior through `createConfigReader` instead of retaining production code or exports used only by Vitest. Migrate `pi-attach` to the cached reader separately and preserve its user-visible fallback/reporting behavior. Do not touch unrelated current changes in `packages/pi-attach`.

## Test Plan

### Shared configuration

- default, global, project, trusted, and untrusted resolution;
- prepend, append, both modifiers, bare replacement, and bare/modifier conflict;
- cross-scope order and duplicate preservation;
- empty collections and invalid entries;
- scalar precedence and grouped redaction validation;
- unknown fields and malformed/unreadable files;
- missing, valid, and invalid cache entries;
- metadata invalidation, atomic replacement, one retry, unstable-file failure, and explicit invalidation;
- cached issue replay on every blocked input; and
- unchanged `pi-attach` behavior after migration.

### Rules and environment

- anchored literal, `*`, and `?` matching;
- leading `!`, last-match wins, overlap, duplicates, and no match;
- invalid shell names ignored;
- protected-name filtering independent of value length;
- result-time union after add, replace, and delete mutations;
- duplicate literal values with redaction-preferred resolution; and
- Unicode code-point minimum lengths.

### Shell interception

- exact minimal fragment and shell quoting;
- no added newline and preserved `$LINENO` behavior;
- best-effort readonly-variable behavior;
- no injection when disabled, bypassed, or no names match;
- malformed third-party Bash input blocked;
- exact-segment removal preserving earlier and later third-party transforms;
- already-removed segment tolerated;
- parallel `toolCallId` isolation; and
- cleanup at result, context, turn end, reload, and shutdown.

### Redaction

- defaults, category toggles, and Bash name precedence;
- built-in, SDK, extension, and missing provenance;
- exact case-sensitive matching and values embedded in larger text;
- duplicates, prefix values, longest match, overlap, and non-recursion;
- prefix/suffix Unicode slicing and fixed markers;
- call/result environment union;
- errors redacted while images/details/arguments/files remain unchanged;
- separate text-block behavior;
- bypass snapshots and prospective-only behavior;
- whole-result withholding on injected matcher failure; and
- large value sets and large output without brittle timing assertions.

### Input and lifecycle

- interactive, RPC, and extension origins;
- leading blanks, multiple-header union, later tag text, malformed text, and tag-only steer;
- non-steering clear-before-set and steering replace-without-clear;
- persistent status and TUI/RPC notifications;
- invalid-config input blocking and steering abort;
- root ambient marker ignored;
- child initial-input inheritance, nested inheritance, and later clearing;
- children spawned before and after parent state changes; and
- reload, switch, fork, disable, and shutdown cleanup.

### Pi integration

Use focused integration fixtures around Pi's real extension runner/event ordering to verify:

- the original assistant tool call is persisted before mutation;
- final tool-result text is transformed before persistence and next model context;
- `tool_result` sees the mutable command path used at `tool_call`;
- parallel tool calls do not cross state;
- `ctx.ui.notify` reaches RPC extension UI; and
- abort behavior stops an active turn after invalid steering configuration.

Run package tests, root shared-config tests, typechecks, lint, build, smoke import, and the repository check suite where practical.

## Documentation

The package README must include:

- installation and enablement;
- complete default and composed configuration examples;
- rule/list and modifier semantics;
- directive syntax, lifetime, and status behavior;
- the conditional subagent integration requirement;
- the complete security boundary;
- explicit absence of `user_bash` support;
- raw TUI streaming/full-output-file limitations;
- best-effort `unset` behavior and Bash startup caveat; and
- troubleshooting for fatal configuration diagnostics.

## Acceptance Criteria

The implementation is complete when:

1. Valid protected Bash variables are targeted by a same-line best-effort `unset` fragment without changing original line numbers.
2. Only Pi Envguard's exact injected segment is removed, preserving other extensions' command changes.
3. Enabled final tool-result text is transformed at Pi Envguard's handler and remains redacted before model context and persistence when downstream handlers preserve it; forbidden structures remain untouched.
4. Rules, scope composition, scalar precedence, fatal validation, and metadata caching match this plan.
5. Bypass headers, lifetime, call snapshots, status, and subagent propagation behave as specified.
6. No `user_bash` handler or setting exists.
7. All failure paths avoid including environment values or raw output in diagnostics.
8. Unit and Pi integration tests cover the security-sensitive ordering and cleanup behavior.
