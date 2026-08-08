# Detect the read tool without executing or impersonating it

Pi Attach will inspect `pi.getAllTools()` to learn whether a `read`-like tool is active and adapt its model-facing notice accordingly, but will acquire content itself through Node and will not format previews to look like `read` output.

Executing the active `read` is not possible in Pi 0.84. `AgentSession._toolDefinitions` holds built-in and extension-registered tools together, and `getAllTools()` and `getToolDefinition()` read the same registry — but only `getAllTools()` is reachable from an extension, and `ToolInfo` is `Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & { sourceInfo }`, which drops `execute`. `ExtensionActions` — the complete set of session capabilities handed to extensions — exposes `getActiveTools`, `getAllTools`, `setActiveTools`, and `refreshTools`, and nothing else tool-related. `ExtensionRuntime extends ExtensionActions`, so it adds nothing. `ExtensionRunner.getToolDefinition` exists but iterates only extension-registered tools, and `createExtensionAPI` closes over `extension`, `runtime`, `cwd`, and `eventBus` — no runner or session reference. The `EventBus` is `emit`/`on` over `unknown`, so cross-extension cooperation would require a protocol the third-party extension implements; none exists.

Impersonating `read` output is rejected on correctness grounds, not just feasibility. A third-party `read` override can emit line anchors that the `edit` tool uses as its only addressing mechanism. A synthesized preview cannot compute those anchors, and a wrong anchor does not fail loudly — it can address the wrong line. That converts a formatting nicety into an edit-corruption hazard, and it would harm precisely the users whose customization the detection is meant to respect.

The consequence is that a preview saves a turn for comprehension but never for mutation: editing requires genuine anchors that only the real `read` can mint. The notice therefore states that content is an excerpt and that a `read` on the path is required before editing.

Detection still earns its place. The current notice hardcodes "Use the built-in `read` tool on a provided path", asserted unconditionally even when `read` has been disabled through `setActiveTools` or replaced by an override with different parameters. Naming the tool that actually exists, and staying silent when none does, fixes an inaccuracy rather than adding a feature.

True delegation remains blocked on one upstream addition: `getToolDefinition` on `ExtensionActions`.
