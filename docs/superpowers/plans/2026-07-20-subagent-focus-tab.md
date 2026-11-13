# Subagent Focus Tab Cycling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cycle matching running subagent names with Tab, then focus with Enter.

**Architecture:** Retain the existing command completion provider and focus handler. Add TUI-only command-scoped terminal-input handling using supported Pi editor APIs, with session cleanup. Extract cycling state into a small module if useful for direct testing.

**Tech Stack:** TypeScript, Pi extension API, node:test.

**Spec:** `docs/superpowers/specs/2026-07-20-subagent-focus-tab-design.md`

## Global Constraints
- Only running agents participate, using their full names, including spaces.
- Enter invokes the existing focus handler.
- Other commands retain normal Tab handling.
- Register terminal handling only in TUI mode and clean up on shutdown/reload.
- Preserve the pre-existing package-lock.json modification.

## Review Focus
- Agents finish or start during a cycle: candidates must reflect live state.
- Editing a completed name or changing commands: reset the original prefix.
- Full names containing spaces: insert them intact.
- No matches: do not fall through to unrelated filesystem completions.
- Reload and non-TUI sessions: no stale listeners or unsupported UI calls.

## Task 1: Command-scoped cycling and regression tests

**Files:**
- Modify: `pi-extension/subagents/index.ts` (session lifecycle and focus command integration).
- Create if needed: `pi-extension/subagents/focus-completion.ts` (cycle state).
- Test: `test/focus-controls.test.ts` or a dedicated `test/focus-completion.test.ts`; include any new test file in `package.json` test script.
- Modify: `README.md` (document Tab behavior).

**Interfaces:** Consume `runningSubagents` names and Pi terminal-input/editor APIs; produce editor text updates on Tab without invoking focus.

- [x] Read the remaining extension docs and relevant terminal-input/editor examples; check repository instructions and current lifecycle implementation.
- [x] Add failing tests asserting first Tab, next Tab, wraparound, prefix retention, reset after editing/non-Tab input, live candidate updates, empty matches, names with spaces, unrelated command passthrough, Enter passthrough, TUI-only registration, and cleanup.
- [x] Run the focused test file; verify failures reflect missing cycling behavior rather than test setup errors.
- [x] Implement the smallest command-scoped cycling handler. Use current running names on every Tab. Reset cycle state after non-Tab input and session teardown. Do not alter focus behavior.
- [x] Run focused tests and `npm test`; report all failures and any skipped tests.
- [x] Document `/subagent-focus <prefix>` + repeated Tab + Enter in README.
- [x] Review the diff independently and resolve findings; rerun tests after changes. Do not commit unless requested.

## Verification result
Focus controls: 25/25 passing. Full suite: 173 passing, one pre-existing failure (`getToolExtensionPath maps custom tools and skips built-ins`), unchanged from baseline and explicitly accepted by the user. Independent review found Kitty release double-cycling, missing redraw, and prefix loss across an empty candidate set; each was reproduced RED then fixed GREEN. No commits made.
