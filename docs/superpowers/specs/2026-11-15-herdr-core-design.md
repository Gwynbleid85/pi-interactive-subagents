# Herdr Core backend

## Intent and scope
Make the installed Pi interactive-subagents extension work in Herdr Core, where this session runs, without changing the agent profiles, launch scripts, result delivery, or resume behavior. The user approved this design and requested edits in the installed checkout rather than a worktree.

## Approaches
- **Chosen:** add a third backend using Core's documented JSON-RPC API. Preserve legacy Herdr and tmux and route existing surfaces by their handles.
- Wrap `hc` commands: simpler, but adds CLI parsing and subprocess overhead to every operation.
- Use tmux inside Core: unnecessary nesting and not native app integration.

## Design
Detect Core from `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` (with documented endpoint overrides accounted for). Prefer explicit Core context over inherited legacy context. A broken Core context must fail closed, not launch elsewhere.

Implement a small Core adapter and newline-delimited JSON-RPC transport. Preserve the existing synchronous terminal facade using a bounded helper process for synchronous socket calls; use a direct asynchronous socket request for asynchronous reads. This compatibility choice is the implementer's call and was explained before planning. No new runtime dependencies.

Represent Core surfaces with a distinct `hc:` prefix and validate explicit terminal IDs before every operation. Create child shell terminals with `terminal.run`, explicit parent/caller context, the current cwd, no UI focus changes, and no duplicate parent notifications. Submit existing launch scripts through `terminal.send`. Read using `terminal.read`. Clean up only the specified child with `terminal.kill` and `terminal.rm`.

Core does not manage windows. Explicit focus uses the documented `herdr-app do agent.focus --terminal <id>` command. Missing app support produces a helpful error, not a fallback to another terminal. Do not add layout labels or create visible tabs during background spawn.

Preserve current completion sidecars, sentinels, IPC and session tracking. Document Core support, requirements and reload steps. Add isolated fake-server tests and a live child-terminal smoke test.

## Safety and non-goals
No Core/app server restart, no changes to unrelated settings, no global template installation, no new dependencies, no unsolicited worker tabs, no replacement of the extension's orchestration or reporting with Core status guesses. Requests have deadlines and bounded response sizes. A send failure is not retried automatically because delivery may already have occurred. Preserve errors and avoid leaking child terminals if startup fails.
