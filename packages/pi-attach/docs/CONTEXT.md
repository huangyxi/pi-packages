# Pi Attach

Pi Attach resolves explicit `@` mentions in a user's input into bounded context delivered before the agent starts.

## Language

**Mention candidate**:
A raw `@` token plus its optional line selector, extracted from the user's input by the scanner. A candidate is unresolved until a resolver accepts it.
_Avoid_: Attachment (before it resolves), reference, file mention

**Line selector**:
An optional `:N`, `:N-M`, `#LN`, or `#LN-M` suffix on a mention that restricts the preview to one or more source lines. A mention with no selector is called an unselected mention.
_Avoid_: Line filter, range specifier, offset

**Attachment**:
A single resolved, bounded, previewed source unit, delivered in the `attach-context` message. An attachment corresponds to one resolved source, not one mention — a file mentioned three times becomes one attachment.
_Avoid_: Attachment mention, resolved mention

**Attachment provenance**:
The origin classification of an attachment's content: direct text read, Markit conversion (for non-text sources), or URL fetch. Determines which acquisition path ran and whether a `parsed_path` is present.
_Avoid_: Source type, attachment kind

**Preview budget**:
The `perAttachLength` config limit, measured in Unicode code points, that caps how much of an unselected source is included in an attachment preview. Applies only when the user gave no line selector.
_Avoid_: Truncation limit, content limit, preview size

**Hard cap**:
Pi's unconditional 2000-line / 50 KB ceiling, enforced last via `truncateHead` regardless of budget or selector. Not configurable.
_Avoid_: Safety cap (suggests the budget is unsafe), limit

**Source group**:
A resolved source (file or URL) together with all mention candidates that named it, coalesced so the source is acquired once. First-mention order is retained.
_Avoid_: Merged mention, grouped attachment

**attach-context message**:
The single Pi custom message with `customType: "attach-context"` that Pi Attach appends before the agent starts. Holds all attachment previews for one input. There is exactly one per triggering input.
_Avoid_: Attachment context, attach message, context message

**parsed_path**:
The filesystem location of the `parsed.md` file produced by a Markit conversion, published in the `attach-context` message so the model can read the already-converted Markdown instead of re-running conversion.
_Avoid_: Converted path, Markit output

**`before_agent_start` window**:
The synchronous extension event in which all attachment work — scanning, resolving, acquiring, bounding, rendering — must complete. Nothing in Pi Attach runs after this window.
_Avoid_: Extension hook, startup event
