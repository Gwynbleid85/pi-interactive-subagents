import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSurface, closeSurface } from "../pi-extension/subagents/tmux.ts";
import { withoutCoreContext } from "./helpers/core-context.ts";

let hasTmux = true;
try {
  execFileSync("tmux", ["-V"], { stdio: "ignore" });
} catch {
  hasTmux = false;
}

it("creates unfocused named windows in the parent's session without changing its layout", {
  skip: !hasTmux,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-test-"));
  const socket = join(dir, "tmux.sock");
  const restoreCore = withoutCoreContext();
  const previousTmux = process.env.TMUX;
  const previousPane = process.env.TMUX_PANE;
  const previousHerdr = process.env.HERDR_ENV;
  delete process.env.HERDR_ENV;
  const tmux = (...args: string[]) => execFileSync("tmux", ["-S", socket, ...args], {
    encoding: "utf8",
  }).trim();
  try {
    const parent = tmux("-f", "/dev/null", "new-session", "-d", "-s", "parent", "-x", "160", "-y", "40", "-P", "-F", "#{pane_id}", "sleep 300");
    tmux("split-window", "-d", "-h", "-p", "30", "-t", parent, "sleep 300");
    const parentWindow = tmux("display-message", "-p", "-t", parent, "#{window_id}");
    const layout = tmux("display-message", "-p", "-t", parent, "#{window_layout}");
    // A different, more recently used session must not receive the agents.
    tmux("new-session", "-d", "-s", "other", "sleep 300");
    process.env.TMUX = tmux("display-message", "-p", "-t", parent, "#{socket_path},#{pid},0");
    process.env.TMUX_PANE = parent;

    const first = createSurface("worker one");
    const second = createSurface("worker-two");
    assert.match(first, /^%\d+$/);
    assert.notEqual(first, second);
    const firstWindow = tmux("display-message", "-p", "-t", first, "#{window_id}");
    assert.notEqual(firstWindow, parentWindow, "agent must have its own window, not split the parent");
    assert.notEqual(tmux("display-message", "-p", "-t", second, "#{window_id}"), firstWindow);
    assert.equal(tmux("display-message", "-p", "-t", first, "#{session_name}"), "parent");
    assert.equal(tmux("display-message", "-p", "-t", second, "#{session_name}"), "parent");
    assert.equal(tmux("display-message", "-p", "-t", first, "#{window_name}"), "worker one");
    assert.equal(tmux("list-panes", "-t", firstWindow, "-F", "#{pane_id}"), first);
    assert.equal(tmux("list-windows", "-t", "parent", "-f", "#{window_active}", "-F", "#{window_id}"), parentWindow);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(tmux("display-message", "-p", "-t", parent, "#{window_layout}"), layout);

    // Existing tmux handles must not switch backend when Herdr is preferred.
    process.env.HERDR_ENV = "1";
    closeSurface(first);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(tmux("display-message", "-p", "-t", parent, "#{window_layout}"), layout);
    assert.equal(tmux("list-windows", "-t", "parent", "-F", "#{window_id}").split("\n").length, 2);
    assert.equal(tmux("display-message", "-p", "-t", second, "#{pane_id}"), second);
    closeSurface(second);
    assert.equal(tmux("list-windows", "-t", "parent", "-F", "#{window_id}"), parentWindow);
  } finally {
    restoreCore();
    if (previousHerdr === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previousHerdr;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
    if (previousPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = previousPane;
    try { tmux("kill-server"); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
