# Native Herdr support

Approved in conversation on 2026-11-15.

## Intent
Run the existing Pi interactive subagent extension in native Herdr tabs, without nesting tmux or replacing the subagent system.

## Approaches
1. Add a Herdr terminal backend to the extension (selected): native tabs and existing orchestration, with tmux retained.
2. Run tmux inside Herdr: no extension change, but subagents are not native Herdr terminals.
3. Separate Herdr plugin: unnecessary for the required terminal operations; would duplicate existing orchestration.

## Goals and constraints
- Target installed Herdr 0.9.5 and keep tmux working.
- Prefer Herdr when running in a Herdr terminal; otherwise select tmux. Explain missing terminal support clearly.
- Spawn one named, unfocused tab per child in the parent's workspace, without changing its layout.
- Preserve profiles, tool restrictions, result steering, parent questions, messaging, completion detection, and sandboxed resume.
- Implement command submission, screen reads, focus, and cleanup through the selected terminal backend.
- Close only the child terminal owned by this extension.
- Do not modify Herdr's managed `~/.pi/agent/extensions/herdr-agent-state.ts`.

## Implementation calls
Use the existing TypeScript/Node stack, with no new runtime dependencies. Isolate Herdr CLI operations in a dedicated module and retain the existing surface API to avoid changing orchestration behavior. Scope commands to explicit pane/workspace IDs rather than the user's current selection. Preserve both synchronous and asynchronous reads and existing sidecar/sentinel completion semantics.

Herdr pane IDs must remain distinguishable from tmux pane IDs so operations cannot accidentally address the wrong backend. Resolve the parent's workspace from its reported pane rather than guessing from the active UI. Validate creation responses before accepting IDs. Bound CLI execution and report failures rather than silently falling back to another terminal after a Herdr operation fails.

## Non-goals and anti-goals
No Herdr fork, replacement agent system, dashboard plugin, or new orchestration semantics. Do not steal focus on spawn, alter the main pane layout, weaken tool isolation, or close unrelated terminals.

## Verification
Automated fake-CLI tests exercise backend selection, explicit scoping, safe argument handling, malformed/error responses, send/read/focus/close, completion detection, and existing orchestration. Run the existing tmux regression suite. If a live Herdr server is available, run an isolated smoke test and restore focus/clean up only created resources; otherwise explicitly report that end-to-end verification remains outstanding.
