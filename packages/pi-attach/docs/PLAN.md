# Pi Attach

## Goal

`@hyxi/pi-attach` turns explicit `@` mentions in a user's input into one persistent, bounded block of context, without altering the user's message and without a second model round trip. It exists to remove the reflexive first turn where the model asks to read a file the user already named.

The package resolves mentions, acquires content (local text read, local document conversion, URL fetch), bounds it, and renders it into a single Pi custom message before the agent starts; the original prompt remains untouched.

## Invariants

These hold for every input, and each is worth a test:

1. **The model's tool set never changes.** `getActiveTools()` and `getAllTools()` return identical values before and after Pi Attach loads. No `registerTool`, no `AgentTool`, no tool definition of any kind.
2. **The system prompt is byte-identical** to the prompt Pi would build without Pi Attach.
3. **Exactly one provider request per turn.** Attachment acquisition completes in `before_agent_start`; no nested agent loop or second LLM call.
4. **The user's text is unmodified.** Attachments arrive as a separate message, never as prompt rewriting.
5. **One message per input.** A single persisted custom message with `customType: "attach-context"`.
6. **No failure escalates to the turn.** Any unresolvable mention degrades to a skipped attachment plus a UI notice. Attachment processing never aborts the user's request.
7. **Extracted content is untrusted text.** Converted Markdown carries no instruction authority.

## Non-Goals

Written down because they keep resurfacing:

- Pi Attach does not expose tools, run agent loops, or add turns.
- It does not process content requiring a model to interpret it. Images and audio are not a target.
- It does not replace `read`. It reduces the _first_ read, not all reads.
- It is not a retrieval or indexing system. Only explicitly mentioned sources are attached.

## Ownership Boundary

Pi Attach owns what is specific to attaching mentioned sources, and delegates generic infrastructure to Pi.

**Owned, because Pi has no equivalent:**

- Mention syntax, scanning, and exclusion rules (code spans, math, quoted strings, `name@example.com`).
- Line selectors (`:12-24`, `#L12-24`), including range merging and overlap collapse.
- The resolver registry and its two resolvers (file, URL).
- Selection policy, preview budget policy, and concurrency bounding.
- The Markit conversion path and its private temporary directory lifecycle.
- `attach-context` rendering.

**Delegated to Pi:**

- Truncation mechanics. Pi exports `truncateHead`, `truncateTail`, `DEFAULT_MAX_LINES` (2000), and `DEFAULT_MAX_BYTES` (50 KB). Pi Attach imports these instead of reimplementing them.
- Configuration reading, UI notification, project-trust evaluation.

**Neither, and this is the load-bearing constraint:** executing tools. Pi Attach acquires sources through its own Node.js and conversion paths and never executes or registers a tool.

## Pipeline

Each stage is one design-level responsibility.

1. **Scan** (`scanner.ts`) — Find mention candidates in the raw input. Owns the exclusion rules. Emits `MentionCandidate` with position, value, and optional selector. Returns empty for inputs with no mentions, which short-circuits everything downstream.
2. **Resolve** (`resolvers/`) — Map each candidate to a `Resolution` through an ordered registry: URL, then file. Unresolvable candidates are dropped silently; a mention that means nothing is not an error.
3. **Coalesce** (`attachment-input.ts`) — Group candidates by resolved identity so a file mentioned three times is read once and its selectors merge. First-mention order is retained for stable output ordering.
4. **Acquire** (`processing/`) — Content-based routing, not extension-based: read the first 8192 bytes, apply `isText`, send text to the direct path and everything else to Markit. Bounded by `maxAttachmentConcurrency`; every acquisition threads the `AbortSignal` so `attachmentProcessingTimeoutSeconds` genuinely cancels work.
5. **Select** (`processing/preview.ts`) — Apply merged line ranges. Multi-range selections join with an explicit separator marker. Out-of-bounds ranges yield empty content plus a `warningForModel`.
6. **Bound** — Two distinct stages, described below.
7. **Render** (`rendering.ts`) — Emit `<attachments>` with a notice, one `<attachment>` element per source with provenance attributes, and an optional `<warnings>` element.

## Bounding: Two Stages, Not One

The distinction is the core of the design and the source of most past confusion.

**Preview budget** (`perAttachLength`, default 500) is Pi Attach's own policy: how much of an unselected source is worth spending recurring context on. It is measured in Unicode code points and it applies _only_ when the user gave no line selector. When the user writes `@file.ts:3-10`, they have already stated the bound; a second budget on top of it would silently discard what they asked for.

**Hard cap** (2000 lines / 50 KB) is Pi's unconditional limit, applied last, always, via `truncateHead`. It is not configurable and not bypassable.

Stage order: select → budget (conditional) → hard cap (unconditional). `ProcessedAttachment.truncated` is true if either stage fired.

Code points, not tokens or bytes, for the budget: the cost being controlled is per-turn recurring context, which tracks characters closely enough, and reinterpreting an existing config key's units would silently change behavior for current users. The 400× gap between the budget default and the hard cap is intentional — they answer different questions.

## Why Pi Attach Reads Files Itself

Pi Attach acquires mentioned sources through its existing Node.js processing path. Pi's extension interface exposes tool metadata but not executable tool definitions, so the active `read` implementation cannot be invoked by the extension.

The attachment notice warns that excerpts are insufficient for editing because the attachment is bounded context rather than a complete source.

Direct acquisition always happens in Pi Attach. URLs without a parsed path remain represented by the custom attachment message.

## Provenance and Round-Trip Economics

Each attachment reports where its content came from, which is what makes follow-up reads cheap:

- `path` — the mentioned source.
- `parsed_path` — for converted sources, the location of the generated `parsed.md`. This is the round-trip saver: a follow-up read targets the already-converted Markdown, so an expensive PDF conversion is never repeated.
- `source_bytes`, `content_chars`, `content_lines`, `requested_lines` — enough for the model to judge how much it has not seen.

For a `@report.pdf:3-10` mention the full flow is: user text preserved, PDF converted silently to a private `parsed.md`, lines 3-10 of the _converted Markdown_ previewed, and `parsed_path` published so any deeper read is a cheap text read. For `.ts` or `.py` the conversion stage is skipped by content routing while the rest is unchanged.

## Failure Handling

`processSourceGroups` wraps each group in try/catch and reports `could not attach ${mentions}` through `reportIssue`, which surfaces as a UI warning only when a UI is attached. Model-relevant problems that are not failures — out-of-bounds line requests — travel as `warningForModel` into the `<warnings>` element instead, because the model can act on those.

## Documentation Split

- **README.md** is the user-facing reference: mention syntax, supported formats, config keys and defaults, URL behavior.
- **PLAN.md** (this file) answers _why_: the boundary, the decisions, the rejected alternatives, the invariants. It points at README rather than duplicating values.
- **docs/CONTEXT.md** holds the domain language.
- **docs/adr/** records decisions with lasting consequences.
