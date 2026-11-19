<div align="center">

<h1>pi-interactive-subagents</h1>

<p><strong>Delegate in parallel. Keep your focus. Get results back.</strong></p>

<p>Async subagents for <a href="https://github.com/badlogic/pi-mono">Pi</a>, running in their own terminals.<br>Spawn a worker, carry on in your main session, and receive its answer when it finishes.</p>

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <a href="#herdr-core-hc--the-new-desktop-app"><img src="https://img.shields.io/badge/backend-Herdr_Core-6366f1?style=flat-square" alt="Backend: Herdr Core"></a>
  <a href="#legacy-herdr"><img src="https://img.shields.io/badge/backend-Herdr-6366f1?style=flat-square" alt="Backend: legacy Herdr"></a>
  <a href="#tmux"><img src="https://img.shields.io/badge/backend-tmux-16a34a?style=flat-square" alt="Backend: tmux"></a>
</p>

<p>
  <a href="#quick-start">Quick start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#custom-agents">Custom agents</a> ·
  <a href="#status-widget--configuration">Configuration</a> ·
  <a href="#tests">Tests</a>
</p>

</div>

---

Run focused agents without giving up your main terminal:

- **Parallel work** — dispatch several agents; each result returns independently.
- **Background terminals** — keep your current focus and pane layout unchanged.
- **Live visibility** — track activity in a widget and open a worker when you need to.
- **Persistent conversations** — message a running agent or resume a finished one by name.
- **Explicit tool access** — define each agent's tool allowlist and permitted child agents.

> [!NOTE]
> This fork supports **Herdr Core, legacy Herdr, and tmux**. The [upstream project](#acknowledgements) also supports cmux, zellij, and WezTerm.

## Quick start

### 1. Check prerequisites

You need [Pi 1.5.2+](https://github.com/earendil-works/pi), a configured model provider, and one supported terminal backend. The bundled question UI uses the current Pi TUI and prompt-lifecycle APIs:

- [Herdr Core](https://github.com/herdrdev/herdr-core) — start Pi in a Core-managed terminal.
- Legacy [Herdr](https://github.com/herdrdev/herdr) **0.9.5+** — start Pi in a Herdr-managed terminal.
- [tmux](https://github.com/tmux/tmux) — start Pi inside a tmux session.

See [Backend setup](#backend-setup) for environment variables and focus requirements. The [bundled agents](#bundled-agents) use OpenRouter models; configure access to those models or [define your own agents](#custom-agents) before spawning.

### 2. Install this fork

```bash
pi install git:github.com/Gwynbleid85/pi-interactive-subagents
```

This installs the subagent extension, `ask_user_question`, and the legacy Herdr prompt bridge by default. If you previously installed standalone copies of the question tool or bridge, follow [Migrating standalone question extensions](#migrating-standalone-question-extensions) before reloading.

In an existing Pi session, wait for active subagents to finish, then run `/reload` or restart Pi.

### 3. Delegate a task

In Pi, run:

```text
/subagent scout Analyze the authentication module and summarize its entry points
```

Keep working while the scout runs. Its result returns to your main session automatically. Press **Ctrl+Alt+S** to open a running agent, or use `/subagent-focus`.

## How it works

`subagent()` returns immediately. Each worker runs in its own terminal, while a widget above the input tracks its activity. When a worker finishes, the extension steers its result into the main session as a notification that triggers a new turn. No polling is needed.

| Backend | Where workers run | Focus and layout |
| --- | --- | --- |
| Herdr Core | Named child terminals linked to the parent | Hidden until explicitly focused; parent layout stays unchanged |
| Legacy Herdr | Background tabs in the parent's workspace | Active tab and parent layout stay unchanged |
| tmux | Named background windows in the parent's session | Active window and parent layout stay unchanged |

```text
╭─ Subagents ──────────────────────────── 2 running ─╮
│ 00:23  scout      active · bash 7m                 │
│ 00:45  scout-2    waiting 2m                       │
╰────────────────────────────────────────────────────╯
```

Spawn several in parallel — they run concurrently and steer results back independently as each finishes.

Each legacy Herdr tab/tmux window starts with one pane; Core uses an independent child terminal. Switch to it to inspect or interact with the agent; automatic cleanup closes that pane (and its tab/window if it is the last pane). The extension does not rebalance the parent's layout on spawn or exit.

### Open a running subagent

- Press **Ctrl+Alt+S** to choose a running subagent with ↑/↓, then **Enter** to show its Core terminal, legacy Herdr tab/pane, or tmux window/pane. **Escape** cancels.
- Run **`/subagent-focus`** to open the same picker.
- Run **`/subagent-focus <name>`** to switch directly. After `/subagent-focus `, press **Tab** repeatedly to cycle through running agent names, wrapping back to the first; press **Enter** to focus the selected agent. Type a prefix to cycle only matching names. Editing resets the cycle, and names containing spaces work without quotes.

These controls work in both regular and fullscreen interactive Pi mode, without mouse capture. If an agent finishes or its pane closes before selection, Pi shows a notification instead of focusing another pane. Completed agents are not reopened. Core focus uses `herdr-app do agent.focus` and requires the running desktop app and its CLI on `PATH` (or `HERDR_APP_BIN_PATH` pointing to it); headless spawning and result delivery do not require the app. In Herdr, select the main session's tab to return. In tmux, use its last-window binding (normally **Ctrl+B, L**). Herdr focus requires the child to be detected as a running agent; if it is still starting, try again once Pi appears.

If your shell startup is slow and launch commands get dropped before the prompt is ready, raise the delay:

```bash
export PI_SUBAGENT_SHELL_READY_DELAY_MS=2500   # default: 500
```

## Usage

### Tools

| Tool | Description |
| --- | --- |
| `subagent` | Spawn a sub-agent in a dedicated Core terminal, legacy Herdr tab, or tmux window (async) |
| `subagent_message` | Message a sub-agent by name — steers it if running, resumes its session if finished |
| `subagents_list` | List available agent definitions |
| `ask_question` | *(sub-agent sessions only)* Ask the orchestrator a question and wait for the reply |
| `ask_user_question` | Ask the human user one question using free text, a single choice, or multiple choices |

There is also a `/subagent <agent> <task>` command for spawning directly.

### User questions and waiting status

`ask_user_question` is separate from `ask_question`: the former opens a human-facing dialog in the current Pi session; the latter sends a worker's question to its parent agent. It does not change the worker-to-parent protocol or grant extra tools to restricted workers.

For `ask_user_question`, provide a `question`, optional `details`, and optional `options` containing labels, values, and descriptions. Omit options for free-text input; set `multiSelect: true` for multiple choices. Choice dialogs always include an **Other** field for a custom answer. **Escape** cancels. Only one popup is shown at a time through the shared UI mutex.

In **Herdr Core**, the choice dialogs explicitly request Pi's native blocked status (`kind: question`) while visible. Pi restores the appropriate status when they close. Free-text questions use Pi's built-in editor, which already handles native waiting status. This lets Core apply its waiting appearance and notifications, subject to your notification settings.

In **legacy Herdr**, `herdr-ui-prompts.ts` forwards Pi's blocking prompt lifecycle to the `herdr:blocked` event bus. This requires Herdr's managed `herdr-agent-state.ts` integration; the bridge does not install or replace it. It covers other extensions' blocking dialogs too, ignores non-TUI sessions, and balances its own signal on completion or shutdown. It does not send native status reports or require a Herdr app mod.

### Migrating standalone question extensions

Load only **one** copy of each extension. If you previously installed `ask-user-question.ts` and `herdr-ui-prompts.ts` directly in `~/.pi/agent/extensions/`, move those copies outside extension discovery before using the bundled versions. For the default Pi config directory:

```bash
mkdir -p ~/.pi/agent/extension-backups
for file in ask-user-question.ts herdr-ui-prompts.ts; do
  if [ -f "$HOME/.pi/agent/extensions/$file" ]; then
    mv -i "$HOME/.pi/agent/extensions/$file" "$HOME/.pi/agent/extension-backups/$file"
  fi
done
```

If Pi uses a custom config directory, adjust those paths. Also remove any explicit settings/CLI references to the standalone copies, then run `/reload` or restart Pi. **Keep Herdr's managed `herdr-agent-state.ts`**—it is not a duplicate of the bridge. No changes to your global files happen automatically when this repository is edited.

### Spawning

```typescript
subagent({ agent: "scout", task: "Analyze the auth module" });
subagent({ agent: "worker", name: "dark-mode", task: "Implement the dark mode toggle" });
```

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `agent` | string | required | Which agent to spawn (must be known and permitted) |
| `task` | string | required | Task prompt |
| `name` | string | agent name | Display name for the pane and widget. Must be unique — duplicates are auto-suffixed (`scout`, `scout-2`, …) |
| `model` | string | agent's model | Override the model for this spawn |
| `cwd` | string | agent's `cwd` | Working directory (see [Role folders](#role-folders)) |

### Messaging

`subagent_message` is addressed **by name only**. Names are unique per session and persist after a sub-agent finishes, so the same name works either way:

```typescript
subagent_message({ name: "scout", message: "Also check the auth middleware" });
```

- **Running** — the message is typed into the live pane (newlines flattened) and picked up at the next turn boundary. The call returns immediately; the eventual completion still arrives as a steer message.
- **Finished** — the session is resumed with the message as the follow-up task, like a fresh spawn: fire-and-forget, always autonomous, result steered back later. The resumed run reclaims its original name.

Terminal cleanup failures appear as warnings without replacing the child's answer, exit code, or session metadata. Three consecutive terminal-read failures end the watcher with the original diagnostic; successful reads reset that error budget.

Every spawn records name → session file in `artifacts/<sessionId>/subagent-registry.json`, so names stay addressable across pi restarts. A nested sub-agent that spawns children gets its own registry keyed by its own session id. Resume is refused with a clear error (listing known names) if the name isn't registered, the session file is gone, or the session predates sandboxed resume.

**Resume replays the original sandbox.** At spawn time the fully-resolved loadout — tool allowlist, backing extensions, model, thinking level, system prompt, spawn whitelist, cwd — is snapshotted to `<session>.loadout.json`. Resume rebuilds the exact same restricted process from that snapshot rather than relaunching unrestricted.

### Asking the orchestrator

A sub-agent can ask its orchestrator a single freeform question when requirements are ambiguous or a decision materially affects the work. The session **stays open** (parked as `waiting`) instead of exiting; the parent is notified with the sub-agent's name, replies via `subagent_message({ name, message })`, and the reply arrives as the sub-agent's next turn. Parallel questions are supported — each waiting sub-agent has its own name.

If the reply arrives while the sub-agent is still mid-turn, it is absorbed into the current turn — either way the question is marked answered and the session exits normally when the work is done. If the parent never replies, the pane stays open until a human closes it. Only available inside sub-agent sessions.

## Bundled agents

| Agent | Model | Tools | Role |
| ----- | ----- | ----- | ---- |
| **scout** | `openrouter/z-ai/glm-5.3` | `read`, `grep`, `find`, `ls` | Fast read-only codebase recon |
| **researcher** | `openrouter/z-ai/glm-5.3` | `web_search`, `web_fetch`, `safe_bash` | Web research, synthesized into a sourced brief |
| **worker** | `openrouter/z-ai/glm-5.3` | `read`, `write`, `edit`, `bash`, `web_search`, `web_fetch` + spawning | General implementer; may spawn `scout` and `researcher` |

All three are autonomous (`auto-exit: true`) and carry their identity in the system prompt (`system-prompt: append`).

## Custom agents

Place a `.md` file in `.pi/agents/` (project) or `~/.pi/agent/agents/` (global). Discovery priority: **project > global > package-bundled** — a project-local file overrides a bundled agent with the same name.

```markdown
---
name: my-agent
description: Does something specific
model: openrouter/z-ai/glm-5.3
thinking: medium
tools: read, edit, write, safe_bash, web_search
session-mode: lineage-only
auto-exit: true
---

You are a specialized agent that does X...
```

### Frontmatter reference

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Agent name (used in `agent: "my-agent"`) |
| `description` | string | Shown in `subagents_list` |
| `model` | string | Default model |
| `thinking` | string | `minimal`, `low`, `medium`, or `high` |
| `tools` | string | Strict tool allowlist. Built-ins: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Extension-backed: `web_search`, `web_fetch`, `safe_bash`, `video_extract`, `youtube_search`, `google_image_search`. Only the extensions backing the listed tools are loaded into the child |
| `subagent_agents` | string | Comma-separated agent names this agent may spawn. **Presence of this field grants the spawning toolset** (`subagent`, `subagent_message`, `subagents_list`) and restricts spawn targets to the list. Omit it and the agent cannot spawn at all |
| `skills` | string | Comma-separated skill names to auto-load |
| `session-mode` | string | `standalone` (default), `lineage-only`, or `fork` — see below |
| `system-prompt` | string | `append` or `replace`: pass the body as the child's `--append-system-prompt` / `--system-prompt`. Omit and the body is prepended to the task prompt instead |
| `auto-exit` | boolean | Auto-shutdown when the agent finishes (see below) |
| `interactive` | boolean | Whether stall/recovery transitions wake the parent (see below) |
| `cwd` | string | Default working directory |
| `disable-model-invocation` | boolean | Hide from `subagents_list`; still spawnable by explicit name |
| `cli` | string | `claude` runs the agent via the Claude Code CLI instead of pi |

### session-mode

- `standalone` — fresh session, no lineage link to the caller (default)
- `lineage-only` — fresh session with `parentSession` linkage for discovery/fork UX, but no copied turns
- `fork` — child session seeded with the caller's conversation context

### auto-exit

With `auto-exit: true`, the session shuts down when the agent's turn ends — the agent just writes its final message and stops (there is no "done" tool). The last assistant message becomes the summary returned to the parent. Recommended for all autonomous agents.

Notes:

- **Manual input does not strand an auto-exit sub-agent.** If a human types into the pane, the session still closes once that turn completes normally — only an escape/abort leaves it open.
- **Auto-exit is suppressed while work is in flight:** the session parks as `waiting` instead of exiting when an `ask_question` is still unanswered, or when the agent's own child sub-agents are still running (a worker can stop after dispatching children and stays open until the last result returns).

### interactive

Controls whether `stalled`/`recovered` status transitions send a steer message to the parent session. Defaults to the inverse of `auto-exit`: autonomous agents get stall pings; user-driven agents stay quiet (the user is already working in that pane — the widget still updates). Set explicitly to override.

## Tool access control

Access is **whitelist-only**. Every sub-agent process is launched with `--no-extensions` (extension discovery disabled) and `--tools <allowlist>`; only the extensions backing the listed tools are loaded back in explicitly. There is no default toolset and no deny-list — an agent gets exactly what its frontmatter lists. The restriction survives resume via the loadout snapshot.

Spawns must name a known agent at **every** depth. A top-level session may spawn anything discoverable; a sub-agent may only spawn the agents in its `subagent_agents` list (enforced via `PI_SUBAGENT_ALLOWED`). There is no agentless spawn route, so a child can never escalate to a full-toolset profile by omitting its agent.

Extensions can register additional tools for sub-agents at runtime via `registerToolExtension(name, path)` on the `__pi_interactive_subagents` process global.

## Role folders

`cwd` starts a sub-agent in a directory with its own config, so role-specific setups (CLAUDE.md, skills, extensions) apply:

```text
project/
└── agents/
    ├── game-designer/   ← CLAUDE.md, .pi/…
    └── sre/             ← CLAUDE.md, .pi/…
```

```typescript
subagent({ agent: "worker", cwd: "agents/sre", task: "Review the deployment pipeline" });
```

Set a per-agent default with `cwd:` in frontmatter.

## Status widget & configuration

The widget tracks each sub-agent from a runtime activity snapshot written by the child: `starting`, `active` (turn/provider/tool work), `waiting` (open for input or another stage), `stalled` (no valid snapshot for too long), or `running` (fallback). Sub-agent sessions also show their own tools widget — toggle it with `Ctrl+Alt+O`. Completion messages expand with `Ctrl+O`.

Status display is configured via `config.json` in the extension directory (copy `config.json.example`; it's gitignored):

```json
{
  "status": { "enabled": true }
}
```

## Backend setup

The extension selects the backend from the current terminal's environment, in this order: **Herdr Core → legacy Herdr → tmux**. Start Pi in the backend you want to use. Incomplete Core or Herdr context produces an error rather than silently falling back to another backend.

### Herdr Core (`hc` / the new desktop app)

Start Pi in a Core-managed terminal. Core supplies `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET`; `HC_SOCKET` can explicitly override the socket endpoint. The extension uses Core's public newline-delimited JSON-RPC API directly, with bounded requests. No legacy `HERDR_*` variables, nested tmux, or agent templates are required.

Core context takes precedence over inherited legacy Herdr/tmux context. Incomplete context or API failures produce an error rather than launching in another session. Each worker has an explicit parent, starts in the current directory, stays hidden by default, and ends with its parent. The extension keeps its own result delivery and completion detection, so it does not depend on Core recognizing the child's status. Cleanup kills and removes only the child terminal.

The current Core adapter launches a Bash shell, matching the extension's existing Bash launch scripts; Bash must be available on `PATH`. It is tested against Core 0.1.21's protocol-generation-1 API. Explicit focus additionally needs `herdr-app`, as described above.

### Legacy Herdr

Start `pi` in a Herdr-managed terminal. The extension uses Herdr's CLI to create unfocused child tabs in the parent's workspace. No separate Herdr plugin or nested tmux is needed.

Herdr must provide `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID`, with `herdr` on `PATH` (or `HERDR_BIN_PATH` pointing to it). Legacy Herdr takes precedence over tmux when no Core context is present. Incomplete Herdr context or CLI/server failures produce an error rather than silently creating terminals in tmux or the currently focused workspace.

Herdr's managed `herdr-agent-state.ts` integration reports Pi status separately. This extension does not modify it or add it to sandboxed child loadouts.

### tmux

Outside Core or legacy Herdr, start Pi inside tmux as before:

```bash
tmux new -A -s pi 'pi'
```

After updating the extension, wait for active subagents to finish, then run `/reload` in Pi or restart Pi to load the new backend.

## Tests

```bash
npm test                       # unit tests, fake Core API tests, isolated tmux/legacy tests
npm run test:surfaces           # real tmux terminals; no model calls
npm run test:integration        # includes real Pi/model lifecycle tests; requires credentials
```

The CLI contract test uses the installed Herdr executable with an isolated test socket, never your live Herdr session. It skips if Herdr is not installed (or on Windows, where the test fixture is Unix-only).

For a no-model Core smoke test, run this **inside a Core terminal**:

```bash
HERDR_CORE_RUN_SMOKE=1 node --test test/integration/herdr-core.test.ts
```

It creates and removes two hidden child terminals, checks literal command execution and completion detection, and does not change the app layout or focus. It makes no model calls and is opt-in.

For a no-model legacy Herdr smoke test, run this **inside a legacy Herdr terminal**:

```bash
HERDR_RUN_SMOKE=1 node --test test/integration/herdr.test.ts
```

It creates and removes one background tab, checks command execution and completion detection, and leaves focus unchanged. This is a terminal smoke test, not a real-model spawn/messaging/resume test. The normal integration run skips it unless explicitly enabled.

## Acknowledgements

Forked from [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents), which originated the subagent architecture, the multi-multiplexer surface layer, and the status widget; its supervision features were inspired by [RepoPrompt](https://repoprompt.com/).

## License

[MIT](./LICENSE)
