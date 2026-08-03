# Use transparent same-shell Bash injection

Pi Envguard will prepend a same-line, best-effort `unset -v` fragment to the mutable command of the existing `bash` tool instead of replacing that tool or launching a nested shell. This preserves custom Bash implementations, cancellation, output handling, and original script line numbers, at the cost of secrets reaching Bash startup and readonly/unset failures being suppressed; the package therefore promises accidental-exposure reduction, not spawn-time isolation or sandboxing.
