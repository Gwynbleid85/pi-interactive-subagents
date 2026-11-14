# Native Herdr Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Pi subagents in native, unfocused Herdr tabs while preserving tmux and existing orchestration.

**Architecture:** Add a dedicated Herdr CLI adapter and dispatch the existing surface API to it for Herdr terminals. Keep shared command scripts and completion polling in the existing surface module, whose historical filename is `tmux.ts`, to minimize orchestration churn.

**Tech Stack:** TypeScript, Node child_process, node:test, Herdr 0.9.5 CLI, tmux.

**Spec:** `docs/superpowers/specs/2026-11-15-herdr-support-design.md`

## Global Constraints
- Target installed Herdr 0.9.5 and keep tmux working.
- Prefer Herdr when running in a Herdr terminal; otherwise select tmux. Explain missing terminal support clearly.
- Spawn one named, unfocused tab per child in the parent's workspace, without changing its layout.
- Preserve profiles, tool restrictions, result steering, parent questions, messaging, completion detection, and sandboxed resume.
- Close only the child terminal owned by this extension.
- Do not modify Herdr's managed `~/.pi/agent/extensions/herdr-agent-state.ts`.
- No new runtime dependencies; do not install packages or change user configuration during investigation.

## Review Focus
- Herdr and tmux variables both present: new children use Herdr, but existing tmux IDs still route to tmux.
- A different workspace/tab is focused: spawning still targets the parent's workspace, and never steals focus.
- Labels, prompts, and paths contain quotes, newlines, or shell metacharacters: arguments stay literal and no injection occurs.
- Missing socket/CLI, malformed JSON, server errors, or closed panes: fail clearly without backend fallback or unrelated cleanup.
- Completion sidecars and terminal sentinels on Herdr: deliver the existing result once, including nonzero exit outcomes.

---

### Task 1: Herdr terminal adapter

**Files:**
- Create: `pi-extension/subagents/herdr.ts`
- Create: `test/herdr.test.ts`
- Modify: `package.json` (include new tests in `npm test`)

**Interfaces:**
- Consumes: Herdr environment `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`; stable 0.9.5 CLI JSON/text responses.
- Produces: `isHerdrAvailable(): boolean`, `createHerdrSurface(name: string): string`, `sendHerdrCommand(surface: string, command: string): void`, `readHerdrScreen(surface: string, lines: number): string`, `readHerdrScreenAsync(surface: string, lines: number): Promise<string>`, `focusHerdrSurface(surface: string): void`, `closeHerdrSurface(surface: string): void`.
- Surface strings use `herdr:` followed by the exact returned pane ID; validate the prefix/ID before performing operations.

- [ ] **Step 1: Write failing adapter tests.** Use a temporary executable named `herdr` on PATH that records argv and provides stable 0.9.5 fixture responses. Assert: absent context is unavailable; creation resolves the parent pane, explicitly selects its workspace, uses `tab create --no-focus --label`, and returns the returned root pane ID. Assert spaces/quotes/metacharacters remain single literal arguments. Assert malformed JSON, missing IDs, nonzero exit, and timeouts fail without fallback.
- [ ] **Step 2: Run `node --test test/herdr.test.ts`.** Expect failure because adapter exports do not exist.
- [ ] **Step 3: Implement the adapter.** Verify exact stable response fields from `/tmp/herdr-stable-api.schema.json` and CLI help before encoding fixtures. Use bounded `execFileSync`/`execFile`, not interpolated shell commands. Use `pane run` to submit commands, `pane read` for plain recent output, `pane get` plus `tab focus` to focus the created child's tab, and `pane close` for cleanup. Root-only child tabs make tab focus sufficient; do not use directional pane focus. Propagate contextual errors and validate all parsed IDs.
- [ ] **Step 4: Add and run read/send/focus/close tests.** Assert sync and async reads return text with requested line count, focus resolves the child tab before changing selection, closed-pane errors do not focus another tab, and cleanup addresses only the supplied child pane. Run `node --test test/herdr.test.ts`; expect all passing.
- [ ] **Step 5: Register the tests and commit the independently tested adapter.** Run `npm test`; expect no new regressions. Commit only adapter, tests, and package script changes.

### Task 2: Dispatch existing subagent surfaces to Herdr

**Files:**
- Modify: `pi-extension/subagents/tmux.ts`
- Modify: `pi-extension/subagents/index.ts`
- Modify: `test/herdr.test.ts`
- Modify where necessary: `test/tmux-window.test.ts`, `test/focus-controls.test.ts`

**Interfaces:**
- Consumes: Task 1 adapter exports.
- Produces: Existing `isMuxAvailable`, `muxSetupHint`, `createSurface`, `sendCommand`, `sendLongCommand`, `readScreen`, `readScreenAsync`, `focusSurface`, `closeSurface`, and `pollForExit` signatures unchanged.

- [ ] **Step 1: Add failing dispatch tests.** Assert Herdr-only context supports `isMuxAvailable()` and creation; both contexts prefer Herdr for creation; `herdr:` IDs dispatch to Herdr and `%` IDs remain tmux operations. Assert incomplete Herdr context cannot silently target an active workspace. Isolate/restore Herdr environment in real tmux tests so results do not depend on how the test runner launched.
- [ ] **Step 2: Run `node --test test/herdr.test.ts`;** expect new dispatch tests to fail against tmux-only behavior.
- [ ] **Step 3: Implement narrow dispatch.** Keep tmux-only primitives unchanged for tmux IDs. Route shared script submission and completion polling through selected read/send functions. Do not expand unused split support: preserve the existing tmux split helper and keep ordinary Herdr spawning tab-based. Make index.ts availability errors, message-delivery failures, focus failures, and command descriptions terminal-neutral. Leave loadout, registry, question handling, and resume semantics untouched.
- [ ] **Step 4: Test existing completion behavior with Herdr reads.** Assert `pollForExit` recognizes `__SUBAGENT_DONE_0__`, nonzero sentinel exits, error `.exit` sidecars, and cancellation. Verify the full script invocation routes through the new backend without modifying sandbox flags. Run `npm test` and `node --test test/system-prompt-mode.test.ts`; expect passing.
- [ ] **Step 5: Commit dispatch and its regression tests.** Review diff for unrelated orchestration changes before committing.

### Task 3: Document and verify the supported workflow

**Files:**
- Modify: `README.md`
- Modify: `package.json` (description only)
- Create: `test/integration/herdr.test.ts` if live testing can be safely automated
- Update: this plan's checkboxes and verification notes

**Interfaces:**
- Consumes: Existing subagent tools and the dispatched surface API from Task 2.
- Produces: Accurate setup/reload instructions and recorded verification results, without configuration changes or edits to Herdr-managed files.

- [ ] **Step 1: Update README and package description.** Replace tmux-only claims with Herdr/tmux support. Explain backend preference, background child tabs, explicit focus, automatic cleanup, Herdr 0.9.5 requirement, and the unchanged tmux setup. Explain restarting or reloading Pi to activate the updated installed extension.
- [ ] **Step 2: Probe for an available Herdr server using read-only CLI commands.** Read `herdr --skill` before controlling live terminals. If available, add an opt-in smoke test that creates only its own unfocused tab, verifies literal send/read and completion, focuses/restores only when safe, and cleans up its own pane in `finally`. If unavailable, record the limitation rather than claiming end-to-end success.
- [ ] **Step 3: Run fresh verification.** Run `npm test`, `node --test test/system-prompt-mode.test.ts`, and `npm run test:integration`. Distinguish pre-existing failures, skipped environment-dependent tests, and new regressions. Inspect `git diff --check` and repository status.
- [ ] **Step 4: Obtain an independent whole-change review.** Address concrete correctness issues with regression tests, then rerun affected checks. Commit documentation/verification changes; report changed paths, verified behavior, and any remaining live-Herdr limitation.

## Execution notes
Implementation has not started. The installed extension checkout was clean before these planning documents were created. Execution should use an isolated worktree; activation into the installed checkout must preserve any user changes and happen only after verification. Do not push remote changes.
