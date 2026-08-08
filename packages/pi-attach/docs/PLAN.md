# Pi Attach

## Goal

`@hyxi/pi-attach` turns explicit `@` mentions in a user's input into one persistent, bounded block of context, without altering the user's message and without a second model round trip. It exists to remove the reflexive first turn where the model asks to read a file the user already named.

The package resolves mentions, acquires content (local text read, local document conversion, URL fetch), bounds it, and renders it into a single Pi custom message before the agent starts. The handler returns `action: "continue"`, so the original prompt and images pass through untouched.

## Invariants

These hold for every input, and each is worth a test:

1. **The model's tool set never changes.** `getActiveTools()` and `getAllTools()` return identical values before and after Pi Attach loads. No `registerTool`, no `AgentTool`, no tool definition of any kind.
2. **The system prompt is byte-identical** to the prompt Pi would build without Pi Attach.
3. **Exactly one provider request per turn.** All work is deterministic and completes inside `before_agent_start`. No nested agent loop, no second LLM call.
4. **The user's text is unmodified.** Attachments arrive as a separate message, never as prompt rewriting.
5. **One message per input.** A single custom message with `customType: "attach-context"`. Nothing else is persisted.
6. **No failure escalates to the turn.** Any unresolvable mention degrades to a skipped attachment plus a UI notice. Attachment processing never aborts the user's request.
7. **Extracted content is untrusted text.** Converted Markdown carries no instruction authority.

## Non-Goals

Written down because they keep resurfacing:

- Pi Attach does not expose tools, run agent loops, add turns, or persist state beyond its one custom message.
- It does not process content requiring a model to interpret it. Images and audio are not a target.
- It does not replace `read`. It reduces the _first_ read, not all reads.
- It is not a retrieval or indexing system. Only explicitly mentioned sources are attached.

## Ownership Boundary

Pi Attach owns what is specific to attaching mentioned sources, and delegates generic infrastructure to Pi.

**Owned, because Pi has no equivalent:**

- Mention syntax, scanning, and exclusion rules (code spans, math, quoted strings, `name@example.com`).
- Line selectors (`:12-24`, `#L12-24`), including range merging and overlap collapse.
- The resolver registry and its three resolvers (file, URL, skill).
- Selection policy, preview budget policy, and concurrency bounding.
- The Markit conversion path and its private temporary directory lifecycle.
- `attach-context` rendering.

**Delegated to Pi:**

- Truncation mechanics. Pi exports `truncateHead`, `truncateTail`, `DEFAULT_MAX_LINES` (2000), and `DEFAULT_MAX_BYTES` (50 KB). Pi Attach imports these instead of reimplementing them.
- Configuration reading, UI notification, project-trust evaluation.

**Neither, and this is the load-bearing constraint:** executing the active `read` tool. See "Why Pi Attach Reads Files Itself".

## Pipeline

Each stage is one design-level responsibility.

1. **Scan** (`scanner.ts`) — Find mention candidates in the raw input. Owns the exclusion rules. Emits `MentionCandidate` with position, value, and optional selector. Returns empty for inputs with no mentions, which short-circuits everything downstream.
2. **Resolve** (`resolvers/`) — Map each candidate to a `Resolution` through an ordered registry: URL, then file, then skill. Unresolvable candidates are dropped silently; a mention that means nothing is not an error. The skill resolver returns fully-formed content, since a skill body needs no acquisition.
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

A reasonable expectation is that Pi Attach should invoke the _active_ `read` tool, so a user's or third-party extension's override of `read` (for example, one that prefixes lines with `LINE#HASH:` anchors) governs attachment output too. That is the right instinct and it is **not achievable** in `@earendil-works/pi-coding-agent` 0.84.0.

`AgentSession._toolDefinitions` is a single registry holding built-in and extension-registered tools together. Both `getAllTools()` and `getToolDefinition(name)` read it, and `getToolDefinition` returns the executable definition. The override therefore exists and is reachable — but not from an extension:

- `ExtensionActions`, the complete set of session capabilities passed to extensions, has 14 members. The tool-related ones are `getActiveTools`, `getAllTools`, `setActiveTools`, `refreshTools`. There is no `getToolDefinition`.
- `ExtensionRuntime extends ExtensionActions` and adds nothing tool-related.
- `ToolInfo`, what `getAllTools()` returns, is `Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & { sourceInfo }`. `execute` is deliberately stripped.
- `ExtensionRunner.getToolDefinition` exists, but it iterates only extension-registered tools, and the runner is unreachable from the `pi` object: `createExtensionAPI` closes over `extension`, `runtime`, `cwd`, and `eventBus` only.
- `EventBus` is `emit`/`on` over `unknown`. Cross-extension cooperation is possible in principle but requires the other extension to implement a matching protocol. None does.
- Pi Attach registering its own `read` would both clobber the override it is trying to respect and violate invariant 1.

So a "fall back to direct reads only if no `read` tool exists" strategy has one reachable branch. Direct reading is the only implementation, and the plan says so rather than implying a delegation that cannot be written.

**Forging a `read`-shaped preview is rejected, not merely unavailable.** If the active `read` emits `LINE#HASH:` anchors and `edit` addresses lines exclusively by those anchors, a fabricated preview would have to fabricate anchors it cannot compute. A wrong anchor does not fail loudly; it can address the wrong line. That converts a cosmetic improvement into an edit-corruption hazard, and it would land hardest on precisely the users whose customization motivated the idea.

This bounds the honest claim: **a preview saves the turn for comprehension, never for mutation.** Understanding what a file contains can come from an excerpt. Editing it requires genuine anchors that only the real `read` can mint. No preview format changes that.

## Detection Instead of Delegation

What _is_ reachable is metadata. `getAllTools()` provides each tool's `name`, `parameters`, and `sourceInfo` (`path`, `source`, `scope`, `origin`), and it is callable during `before_agent_start` — `resolvers/skill-resolver.ts` already calls `pi.getCommands()` in that same window.

Pi Attach uses this to make its notice true rather than assumed. The current notice hardcodes "Use the built-in `read` tool on a provided path", asserted unconditionally — wrong when `read` has been disabled through `setActiveTools`, and misleading when it has been replaced by a tool with different parameters. Instead: name the read-capable tool that actually exists, and when none does, omit the advice entirely. Tool origin stays out of the notice; the model gains nothing from knowing which extension supplied `read`.

The notice also states plainly that attachment content is an excerpt and that a real `read` is required before editing. One clause, and it closes the hazard that forging would have opened.

Genuine delegation remains blocked on exactly one upstream addition: `getToolDefinition` on `ExtensionActions`. Recorded so the option can be revisited without re-deriving the search.

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

---

# Amendments

> Standalone and self-contained. A later loop implements these, then deletes this entire section. What remains then describes the code as it stands.

## A1. Delegate truncation to Pi

`src/processing/preview.ts` reimplements Pi's truncation, imperfectly. It hardcodes `MAX_INJECTED_BYTES = 50 * 1024` and `MAX_INJECTED_LINES = 2_000`, then `enforceHardLimits` truncates bytes-first via `truncateBytes`, which binary-searches code points with no regard for line boundaries and can therefore cut mid-line. Pi's `truncateHead` guarantees "Never returns partial lines".

- Import `truncateHead`, `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES` from `@earendil-works/pi-coding-agent` (all root-exported).
- Delete `MAX_INJECTED_BYTES`, `MAX_INJECTED_LINES`, `truncateBytes`, `enforceHardLimits`.
- Keep `isText`, `mergeRanges`, `selectContext`, and `truncateCodePoints` — Pi exports no binary/text detection (`isBinaryFile`, `isTextFile`, `isBinary`, `detectBinary` are all absent from the root), so `isText` stays local.
- `TruncationResult` provides `content`, `truncated`, `truncatedBy`, `totalLines`, `totalBytes`, `outputLines`, `outputBytes`, `lastLinePartial`, `firstLineExceedsLimit`, `maxLines`, `maxBytes`.

Net effect: a deletion in `src/processing/`, plus a correctness fix nothing currently pins. `test/rendering.test.ts` asserts only the `truncated` flag, so today's mid-line cut is unpinned behavior.

Accepted trade-off: attachment bounding now tracks Pi's version. Worth it for parity with `read` and for deleting a subtly wrong duplicate. Record as ADR 0001.

## A2. Split `createPreview` into two steps

`createPreview(content, limit)` currently receives `Number.POSITIVE_INFINITY` as a sentinel from both `text.ts` and `converted.ts` to mean "no budget". Replace with two explicit steps: an optional budget step and an unconditional hard-cap step. The sentinel disappears along with the duplicated comment in both callers.

Put the shared budget decision in one helper beside the preview logic; `text.ts` and `converted.ts` currently duplicate the same expression with different local variable names (`budget` vs `limit`). The rule is identical for direct and Markit-converted sources.

## A3. Retire `limitExplicitLines`

Dead once the budget never applies to explicit selections. Remove from `src/config.ts`, `src/processing/text.ts`, `src/processing/converted.ts`, and the README config table and JSON example.

## A4. Handle `firstLineExceedsLimit`

A minified bundle can be one line longer than 50 KB, where `truncateHead` returns empty content. Accept the empty preview and surface a `warningForModel` so the model learns why, rather than silently attaching nothing.

## A5. Make the notice conditional and honest

In `src/rendering.ts`, `ATTACHMENTS_NOTICE` is a module constant asserting the built-in `read` unconditionally. Replace with a notice built per render from `pi.getAllTools()`:

- A read-capable tool is active → name it, without origin.
- None is active → omit the read advice entirely.
- Always → state that content is an excerpt and that a `read` on the path is required before editing.

This requires threading tool metadata from `extension.ts` into `renderContext`. Keep the plumbing minimal: `renderContext` should receive the resolved notice or the tool name, not the `pi` object, so `test/rendering.test.ts` keeps working without a session. Record the detection-instead-of-delegation reasoning as ADR 0002.

## A6. Add `truncatedBy` as a rendering attribute

`TruncationResult.truncatedBy` distinguishes a line-count cut from a byte cut. Expose it as an attachment attribute only. It does not participate in any decision.

## A7. Remove image and audio from the README

`src/` contains no image or audio handling — routing is content-based and such files simply fall through to Markit. The claims exist only in `README.md`. Delete the Images and Audio rows from the supported-formats table and the sentence "Image and audio attachments include the metadata available without an LLM." Adjust the lead-in sentence, which currently promises "documents, images, audio, and archives".

Documentation-only. Behavior is unchanged, because actively rejecting these types would mean _adding_ code for a case that is not a target. `.zip` and the document formats stay.

## A8. Create the docs

- `docs/CONTEXT.md` — domain language, in `pi-envguard`'s format. Terms worth defining: preview budget, hard cap, mention candidate, line selector, attachment provenance, attach-context message, source group.
- `docs/adr/0001-delegate-truncation-to-pi.md` — the coupling trade-off from A1.
- `docs/adr/0002-detect-read-tool-without-executing-it.md` — the boundary finding and the anchor-forgery rejection.

## Acceptance

- `test/attachment-input.test.ts` and `test/rendering.test.ts` pass, modified only where A5 changes `renderContext`'s signature.
- `getActiveTools()`, `getAllTools()`, and the system prompt are unchanged before and after load.
- Exactly one provider request per turn.
- Net line deletion in `src/processing/`.
- A preview is never cut mid-line, except where a single line alone exceeds the byte cap.
