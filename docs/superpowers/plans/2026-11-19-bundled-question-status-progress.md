# Execution ledger — plan: 2026-11-19-bundled-question-status.md

## Task 1
- Branch: feat/bundled-user-questions, base b9e8231.
- Pre-flight: one task, no inter-task interfaces.
- Ruling: user explicitly chose in-place feature branch over worktree; preserve supplied checkout path. Cost: changes visible in that checkout until switched/committed.
- Baseline npm ci + npm test: 222 passed, 1 failed. Existing getToolExtensionPath web_search assertion assumes a standalone global web-search extension. User explicitly approved continuing without fixing it. Cost: npm test remains red for that known environmental assumption.
- Development deps updated to npm aliases of current Pi 1.5.2. Baseline re-run: same 222 passed, 1 failed. npm install audit: 0 vulnerabilities.
- RED: new suites fail before implementation: missing both files, missing manifest registration.
- GREEN: added copied implementations, native blocked options preserved, legacy bridge type import aligned to repo alias. New suites: 33 passed, 0 failed.
- All tests use repository-installed dependencies; no local Pi release paths, jiti aliases or managed reporter required.
- README covers Pi requirement, default registration, ask_question versus ask_user_question, native/legacy status, and moving standalone copies out of discovery.
- npm test: 255 passed, 1 failed (same known baseline assertion).
- node --test test/*.test.ts: 109 passed, 0 failed; includes standalone system-prompt script reporting 21 internal checks passed. This glob does not match test/test.ts, so npm test remains the authority for that baseline failure.
- npm pack --dry-run --json: succeeds; both pi-extension/ask-user-question.ts and pi-extension/herdr-ui-prompts.ts included. npm warns existing absence of .npmignore and falls back to .gitignore.
- No active global installation/settings modified. Nothing pushed.
- Independent review complete: bundled-questions-review found no concrete new blocking issues. Independently confirmed 33 new tests, npm test 255/256 with the same approved baseline failure, top-level glob 109/109, clean diff check, and package inclusion. Actual Pi 1.5.2 extension loader loaded all three entries without errors.
- Reviewer first inherited worker PI_SUBAGENT_* identity, which affected existing tests; clearing worker identity reproduced the approved baseline. No production change needed.
- Task 1: complete within the approved scope. No fresh live notification check of the packaged copy; the source matches the previously live-confirmed global tool. Changes remain local on the feature branch; no push or global activation.
