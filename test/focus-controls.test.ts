import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagentsExtension, { __test__ } from "../pi-extension/subagents/index.ts";
import * as surfaces from "../pi-extension/subagents/tmux.ts";
import { createStatusState } from "../pi-extension/subagents/status.ts";
import { visibleWidth } from "@mariozechner/pi-tui";

let hasTmux = true;
try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); } catch { hasTmux = false; }

describe("subagent focus controls", { skip: !hasTmux }, () => {
  let dir: string;
  let socket: string;
  let previousTmux: string | undefined;
  let previousPane: string | undefined;
  let parent: string;
  let child: string;
  let parentWindow: string;
  let commands: Map<string, any>;
  let shortcuts: Map<string, any>;
  let notices: string[];
  let ctx: any;
  const tmux = (...args: string[]) => execFileSync("tmux", ["-S", socket, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const activeWindow = () => tmux("list-windows", "-t", "parent", "-f", "#{window_active}", "-F", "#{window_id}");
  const registerAgent = (id: string, name: string, surface = child) => {
    const startTime = Date.now();
    __test__.runningSubagents.set(id, {
      id, name, surface, task: "test", startTime, sessionFile: "test.jsonl",
      statusState: createStatusState({ source: "pi", startTimeMs: startTime }), interactive: false,
    });
  };
  const command = () => {
    const result = commands.get("subagent-focus");
    assert.ok(result, "register /subagent-focus");
    return result;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-focus-test-"));
    socket = join(dir, "tmux.sock");
    previousTmux = process.env.TMUX;
    previousPane = process.env.TMUX_PANE;
    parent = tmux("-f", "/dev/null", "new-session", "-d", "-s", "parent", "-x", "160", "-y", "40", "-P", "-F", "#{pane_id}", "sleep 300");
    process.env.TMUX = tmux("display-message", "-p", "-t", parent, "#{socket_path},#{pid},0");
    process.env.TMUX_PANE = parent;
    parentWindow = activeWindow();
    child = surfaces.createSurface("worker one");
    commands = new Map();
    shortcuts = new Map();
    notices = [];
    __test__.runningSubagents.clear();
    subagentsExtension({
      on() {}, registerTool() {}, registerMessageRenderer() {},
      registerCommand(name: string, options: any) { commands.set(name, options); },
      registerShortcut(key: string, options: any) { shortcuts.set(key, options); },
    } as any);
    ctx = {
      mode: "tui", hasUI: true,
      ui: { notify(message: string) { notices.push(message); }, select: async () => undefined },
    };
  });

  afterEach(() => {
    __test__.runningSubagents.clear();
    if (previousTmux === undefined) delete process.env.TMUX; else process.env.TMUX = previousTmux;
    if (previousPane === undefined) delete process.env.TMUX_PANE; else process.env.TMUX_PANE = previousPane;
    try { tmux("kill-server"); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  it("focuses both the window and requested pane without changing the parent's layout", () => {
    tmux("split-window", "-d", "-h", "-t", parent, "sleep 300");
    const layout = tmux("display-message", "-p", "-t", parent, "#{window_layout}");
    const sibling = tmux("split-window", "-h", "-t", child, "-P", "-F", "#{pane_id}", "sleep 300");
    assert.notEqual(sibling, child);
    (surfaces as any).focusSurface(child);
    assert.equal(activeWindow(), tmux("display-message", "-p", "-t", child, "#{window_id}"));
    assert.equal(tmux("display-message", "-p", "-t", child, "#{pane_active}"), "1");
    assert.equal(tmux("display-message", "-p", "-t", parent, "#{window_layout}"), layout);
  });

  it("focuses the exact named agent including spaces instead of a prefix match", async () => {
    registerAgent("a", "worker one");
    registerAgent("b", "worker", parent);
    await command().handler(" worker one ", ctx);
    assert.equal(activeWindow(), tmux("display-message", "-p", "-t", child, "#{window_id}"));
    assert.deepEqual(notices, []);
  });

  it("opens a picker and focuses the selected running agent", async () => {
    registerAgent("a", "worker one");
    let choices: string[] = [];
    ctx.ui.select = async (_title: string, items: string[]) => { choices = items; return items[0]; };
    await command().handler("", ctx);
    assert.deepEqual(choices, ["worker one"]);
    assert.equal(activeWindow(), tmux("display-message", "-p", "-t", child, "#{window_id}"));
  });

  it("uses Ctrl+Alt+S to open the same picker", async () => {
    registerAgent("a", "worker one");
    ctx.ui.select = async (_title: string, items: string[]) => items[0];
    const shortcut = shortcuts.get("ctrl+alt+s");
    assert.ok(shortcut, "register Ctrl+Alt+S");
    await shortcut.handler(ctx);
    assert.equal(activeWindow(), tmux("display-message", "-p", "-t", child, "#{window_id}"));
  });

  it("does not switch focus when the picker is cancelled", async () => {
    registerAgent("a", "worker one");
    await command().handler("", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.deepEqual(notices, []);
  });

  it("does not focus a replacement agent if the chosen agent finishes while the picker is open", async () => {
    registerAgent("a", "worker one");
    ctx.ui.select = async () => {
      __test__.runningSubagents.delete("a");
      registerAgent("replacement", "worker one");
      return "worker one";
    };
    await command().handler("", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.equal(notices.length, 1);
  });

  it("warns without opening an empty picker when there are no running agents", async () => {
    ctx.ui.select = async () => assert.fail("must not open an empty picker");
    await command().handler("", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.equal(notices.length, 1);
  });

  it("warns for an unknown name without switching focus", async () => {
    registerAgent("a", "worker one");
    await command().handler("worker", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.equal(notices.length, 1);
  });

  it("reports a closed pane instead of falling back to the parent pane", async () => {
    registerAgent("a", "worker one");
    surfaces.closeSurface(child);
    await command().handler("worker one", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.equal(notices.length, 1);
  });

  it("never switches to a sibling when the target closes between separate focus commands", async () => {
    registerAgent("a", "worker one");
    const childWindow = tmux("display-message", "-p", "-t", child, "#{window_id}");
    tmux("split-window", "-d", "-h", "-t", child, "sleep 300");
    const realTmux = execFileSync("sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // Simulate an agent exit exactly at the process boundary after an isolated
    // select-pane call. A single server-side command queue has no such gap.
    writeFileSync(join(bin, "tmux"), `#!${process.execPath}\n` +
      `const { spawnSync } = require("node:child_process");\n` +
      `const args = process.argv.slice(2);\n` +
      `if (args[0] === "select-pane" && require("node:fs").existsSync(${JSON.stringify(join(dir, "close-before"))})) {\n` +
      `  spawnSync(${JSON.stringify(realTmux)}, ["kill-pane", "-t", args[2]], { stdio: "ignore" });\n` +
      `}\n` +
      `const result = spawnSync(${JSON.stringify(realTmux)}, args, { stdio: "inherit" });\n` +
      `if (args.length === 3 && args[0] === "select-pane" && result.status === 0) {\n` +
      `  spawnSync(${JSON.stringify(realTmux)}, ["kill-pane", "-t", args[2]], { stdio: "ignore" });\n` +
      `}\nprocess.exit(result.status ?? 1);\n`, { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      await command().handler("worker one", ctx);
      const panes = tmux("list-panes", "-t", childWindow, "-F", "#{pane_id}").split("\n");
      if (panes.includes(child)) {
        assert.equal(activeWindow(), childWindow);
        assert.equal(tmux("display-message", "-p", "-t", child, "#{pane_active}"), "1");
        // Also close the target after window lookup but before the queued
        // selection begins: the failed pane command must stop window selection.
        tmux("select-window", "-t", parentWindow);
        writeFileSync(join(dir, "close-before"), "");
        await command().handler("worker one", ctx);
        assert.equal(activeWindow(), parentWindow);
        assert.equal(notices.length, 1);
      } else {
        assert.equal(activeWindow(), parentWindow, "must not switch to the surviving sibling");
        assert.equal(notices.length, 1);
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("does not open the picker or change tmux focus outside TUI mode", async () => {
    registerAgent("a", "worker one");
    ctx.mode = "rpc";
    ctx.ui.select = async () => assert.fail("must not open a non-TUI picker");
    await command().handler("worker one", ctx);
    assert.equal(activeWindow(), parentWindow);
    assert.equal(notices.length, 1);
  });

  it("completes running agent names by prefix", () => {
    registerAgent("a", "worker one");
    registerAgent("b", "scout");
    assert.deepEqual(command().getArgumentCompletions("wor"), [
      { value: "worker one", label: "worker one" },
    ]);
    assert.equal(command().getArgumentCompletions("missing"), null);
  });

  it("shows a width-safe focus hint in the running-agent widget", () => {
    registerAgent("a", "worker one");
    const agents = Array.from(__test__.runningSubagents.values());
    const lines = __test__.renderSubagentWidgetLines(agents, 100);
    assert.ok(lines.some((line: string) => line.includes("Ctrl+Alt+S") && line.includes("/subagent-focus")));
    for (const width of [0, 1, 2, 16, 100]) {
      assert.ok(__test__.renderSubagentWidgetLines(agents, width).every((line: string) => visibleWidth(line) <= width));
    }
  });
});
