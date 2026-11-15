# Herdr Core Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the installed Pi subagent extension to launch, read, focus, resume and clean up child agents inside Herdr Core.

**Architecture:** Add an `hc:` terminal adapter backed by newline-delimited JSON-RPC, preserving the existing synchronous surface interface through a bounded helper process and using direct asynchronous socket reads. Keep current agent launch, IPC, sidecar and completion logic unchanged; focus through herdr-app only on explicit request.

**Tech Stack:** TypeScript, Node built-ins, Node test runner, Herdr Core JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-11-15-herdr-core-design.md`

## Global Constraints
- No new runtime dependencies or changes to unrelated settings.
- Preserve legacy Herdr and tmux support.
- A broken Core context fails closed, never falling back to a different backend.
- Child terminals run in the current cwd, remain hidden by default, and end with their parent.
- No Core/app restarts. Cleanup targets only created children.
- Requests have deadlines and bounded responses; do not retry ambiguous sends.

## Review Focus
- Inherited HC variables in legacy tests: explicitly isolate backend contexts in fixtures.
- Partial socket responses, early disconnects, malformed JSON and JSON-RPC errors: transport tests must reject clearly and terminate.
- Invalid terminal handles and unsafe display names: validate IDs, preserve literal commands and normalize child names as needed.
- Startup shell readiness and sentinels: live smoke test must prove a script actually executes and completion is detected.
- Explicit focus with no running app and cleanup after already-closed terminals: actionable errors, no unrelated focus/cleanup targets.

---

### Task 1: Core transport and adapter
**Files:** Create `pi-extension/subagents/herdr-core-rpc.cjs`, `pi-extension/subagents/herdr-core.ts`, `test/herdr-core.test.ts`; modify `package.json` test command.
**Interfaces:** Export availability and create/send/read/readAsync/focus/close functions equivalent to `herdr.ts`, using `hc:<terminal-id>` handles. Adapter consumes the Core endpoint and terminal context from environment.
- [ ] Read the live schema for terminal.run/send/read/kill/rm and confirm socket endpoint rules; read remaining relevant Pi extension docs and examples before implementation.
- [ ] Build a fake Core socket server in a separate process so synchronous test requests cannot deadlock the test runner. Write tests for missing context, explicit parent/caller/cwd/no_notify, handle validation, literal commands, reads, exact cleanup targets and focus command arguments. Assert behavior at the socket/process boundary.
- [ ] Run `node --test test/herdr-core.test.ts`; confirm failures identify missing backend behavior.
- [ ] Implement bounded sync/async JSON-RPC requests, validated child surface creation, send/read/focus/cleanup, preserving structured server errors.
- [ ] Add failing then passing transport tests for split responses, oversized/malformed responses, wrong response IDs, disconnect, timeout and server errors. Ensure no mutation retries.
- [ ] Run the focused test command; expect all tests passing and no lingering fake servers.

### Task 2: Surface routing and extension integration
**Files:** Modify `pi-extension/subagents/tmux.ts`, `pi-extension/subagents/index.ts`, affected test fixtures; extend `test/herdr-core.test.ts`.
**Interfaces:** Existing surface function signatures remain unchanged; `readScreenAsync` remains asynchronous. Handles select the backend even if environment changes after creation.
- [ ] Add tests proving Core context is selected before inherited legacy context, incomplete Core context fails closed, and each hc: handle routes to Core without legacy/tmux mutations.
- [ ] Run tests and observe the expected routing failures.
- [ ] Route availability/create/send/read/readAsync/focus/close to the Core adapter. Update setup hints and user-facing descriptions to include Herdr Core. Preserve launch, resume, IPC and sentinel behavior.
- [ ] Explicitly clear HC context in legacy-only test fixtures, rather than weakening production precedence.
- [ ] Run `npm test`; expect the full unit suite passing. Report any baseline failures separately.

### Task 3: Documentation and live verification
**Files:** Modify `README.md`, optionally integration harness/tests where Core can be safely added; update this checklist.
**Interfaces:** Document Core context/endpoint requirements, explicit focus via herdr-app and Pi `/reload`.
- [ ] Document native Core support without requiring tmux or legacy HERDR variables.
- [ ] Run an isolated live adapter smoke test: create two child terminals, send scripts with distinct markers, read them asynchronously, verify completion sentinels, and close/remove only those terminals in a finally block.
- [ ] Exercise the extension's actual subagent tool in a fresh child Pi with the updated extension if feasible; verify result delivery, then cleanup the owned test terminals. Do not claim the current session reloaded automatically.
- [ ] Obtain independent review using a native hc-launched reviewer; address actionable findings with regression tests.
- [x] Run `npm test` again and `git diff --check`. Inspect final diff and report verified behavior, remaining limitations, and `/reload` instructions. Do not commit implementation unless the user asks.

## Execution result

All three tasks implemented in the installed checkout. Detailed RED/GREEN evidence and decisions remain in `.superpowers/sdd/2026-11-15-herdr-core/progress.md` (ignored execution ledger).

- Core regression suite: 24/24 passing.
- Opt-in live shell smoke test: 1/1 passing; two owned child terminals cleaned up.
- Real-model extension test: two subagents delivered actual results; a completed agent resumed and delivered its follow-up. Repeated after review fixes from alphabetic-address parent `t1f`; actual markers confirmed in the coordinator transcript, then the coordinator was killed and removed.
- Independent review found decimal-only ID validation and missing startup-failure cleanup. Both were reproduced with failing tests and fixed; cleanup-loop safety also received a regression test and fix.
- Final full suite: 222/223 passing. The sole failure is the unchanged baseline `getToolExtensionPath maps custom tools and skips built-ins` (`web_search` mapping absent locally).
- `git diff --check`: clean. No commit, push, server restart, or unrelated settings changes.
- Explicit desktop focus is unit-tested, not live-tested. Windows named pipes/Bash are not live-tested on macOS. Existing Pi sessions must `/reload` after active subagents finish.
