# Subagent focus Tab cycling

## Intent and approved behavior
Make `/subagent-focus ` work like shell completion: repeated Tab presses insert the next matching running subagent name, wrapping to the first. Enter invokes the existing focus handler. A typed prefix limits the cycle; editing resets it. Other commands retain normal Tab handling. The user approved this behavior in the session.

## Approaches
- Existing argument-completion API: retains native suggestions, but does not provide repeated-Tab cycling by itself.
- Command-scoped terminal-input handling (implementation choice): supports the approved cycle without changing Pi globally. Keep the existing suggestions and focus handler.
- Immediate focus on Tab: offered and not selected; Enter must remain the focus action.

## Constraints and non-goals
Only running agents participate, using their full names, including spaces. Reconcile candidates against live running state. No changes to tmux layout, agent launch, other commands, or global keybindings. Register terminal handling only in TUI mode and clean up on shutdown/reload.

## Builder decisions
Use Pi's supported terminal-input/editor APIs. Tests must cover cycling, wraparound, prefix filtering, edits/reset, changing running agents, no matches, names with spaces, unrelated input, and lifecycle cleanup. Preserve existing focus tests and the pre-existing package-lock.json modification.
