# Delegate hard-cap truncation to Pi

Pi Attach will import `truncateHead`, `DEFAULT_MAX_LINES`, and `DEFAULT_MAX_BYTES` from `@earendil-works/pi-coding-agent` and delete its own implementations instead of maintaining a local copy.

Pi's `truncateHead` is the same function the `read` tool uses for its hard cap. Delegating means attachment output and `read` output stay in parity, with no separate constant to keep in sync.

The current local implementation has a correctness defect: `enforceHardLimits` calls `truncateBytes`, which binary-searches code points with no regard for line boundaries and can cut mid-line. `truncateHead` guarantees it never returns a partial line.

The accepted cost is coupling to Pi's version: if Pi changes the truncation contract, attachment bounding changes too. This is worth the trade-off. The alternative — keeping a duplicate — means the attachment hard cap drifts from `read`'s hard cap, which is the behavior users would expect to be identical. The duplicate is also wrong today and nothing pins it, so there is no safety in keeping it.

Pi exports no binary-or-text detection utilities (`isBinaryFile`, `isTextFile`, `isBinary`, and `detectBinary` are all absent from the root), so `isText` stays local.
