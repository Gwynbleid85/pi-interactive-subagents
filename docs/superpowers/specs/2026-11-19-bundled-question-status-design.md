# Bundled User Questions and Herdr Waiting Status

## Intent
Version-control and distribute the locally verified user-question tool and Herdr waiting-state fixes through pi-interactive-subagents. User selected loading both extensions by default.

## Approach
Add standalone sibling extension entry points to the package manifest rather than mixing UI code into subagent orchestration. Copy the existing question tool with both native blocked options intact, and the legacy Herdr prompt lifecycle bridge. Keep ask_question (worker to orchestrator) distinct from ask_user_question (agent to human).

Alternatives: optional extras were offered and rejected by the user; embedding into the subagents index adds unrelated coupling and risks child-only extension behavior.

## Scope
- pi-extension/ask-user-question.ts: existing tested UI, shared UI mutex, structured answers, single/multi select and free text. Choice dialogs pass native blocked kind question/message to Pi.
- pi-extension/herdr-ui-prompts.ts: balanced TUI-only bridge to the existing legacy reporter. No socket implementation or app mods.
- package.json: discover both by default alongside subagents/index.ts; tests must run from a clean checkout without absolute user-install paths.
- Development dependencies target the current Pi 1.5.2 API with legacy package-name aliases for existing code. Document Pi 1.5.2+ for this bundle.
- Port the local question interaction tests; add packaging and bridge tests. Do not depend on the untracked global Herdr-managed reporter in repository tests.
- README: tool distinction, waiting-status behavior, version requirement, and migration away from duplicate standalone copies.

## Non-goals and constraints
No changes to subagent ask_question protocol, terminal launch, cleanup, focus, or result delivery. No push. Do not alter the user's currently working global files or settings; migration instructions only. Avoid new runtime dependencies. Native Core fix already passed a user live test for appearance and notifications; integration tests must not claim a fresh live check.

## Acceptance
Default manifest discovers all three extension entry points. Question interaction and native blocked payload regression tests pass. Bridge balances starts/ends/shutdown and ignores headless modes. All existing repository tests run; report failures/skips without omission. Fresh reviewer checks integration and duplicate-registration guidance.
