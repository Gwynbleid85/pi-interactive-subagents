# Bundled Question Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the working user-question and waiting-state fixes as default extensions in pi-interactive-subagents.

**Architecture:** Two standalone entry points beside the subagent extension. Preserve native blocked reporting for Core and event-bus compatibility for legacy Herdr. Port UI tests and use repository-installed modules.

**Tech Stack:** TypeScript, node:test, Pi 1.5.2 API, npm development aliases.

**Spec:** ../specs/2026-11-19-bundled-question-status-design.md

## Global Constraints
- No push, no global installation/settings changes, no changes to subagent orchestration semantics.
- No new runtime dependencies; Pi supplies extension imports.
- Default-load the question tool and legacy bridge; document duplicate-copy migration.

## Review Focus
- A package install must register all three entry points, not only add unused source files.
- Existing standalone ask_user_question copies can collide: instructions must cover removing/disabling them before reloading.
- Legacy bridge copies must not be double-loaded.
- Native custom-dialog blocked options must survive the port in both modes.
- Tests must not reference ~/.pi, this machine's release path, or the managed legacy reporter.

## Task 1: Package the tested tools

**Files:** create pi-extension/ask-user-question.ts, pi-extension/herdr-ui-prompts.ts, test/ask-user-question.test.ts, test/herdr-ui-prompts.test.ts, test/package-extensions.test.ts; modify package.json and README.md.

**Interfaces:** consume the approved local implementations; produce package default entry points plus ask_user_question. Retain existing ask_question unchanged.

- [x] Establish an isolated git worktree/branch, install development dependencies targeting current Pi, and run baseline tests. Record unavoidable baseline failures. User chose in-place branch feat/bundled-user-questions; approved continuing with the single pre-existing failure.
- [x] Port the global question tests to normal repository imports. Add manifest discovery and bridge ownership/headless tests. Run them and observe failure before copying implementations/registering entry points.
- [x] Copy the two approved implementations. Register both default entry points and include new suites in npm test. Preserve native blocked options exactly.
- [x] Add README version, tool distinction, legacy/native behavior and duplicate-copy migration instructions.
- [x] Run npm test and all repository top-level test/*.test.ts suites. Inspect npm package dry-run to ensure files are distributed. New tests 33/33; npm test 255/256 (known baseline failure); top-level glob 109/109; package includes both extensions.
- [x] Obtain independent review, fix substantive findings with failing tests, rerun full verification, and report branch/files/tests. No new blocking findings. Reviewer also confirmed actual Pi extension-loader success for all three entries. No push or global installation changes.
