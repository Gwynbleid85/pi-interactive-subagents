import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as herdr from "../pi-extension/subagents/herdr.ts";

const bin = process.env.HERDR_BIN_PATH || "herdr";
let available = process.platform !== "win32";
try { execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 2000 }); } catch { available = false; }

it("submits exact requests through the installed Herdr CLI to an isolated socket", { skip: !available, timeout: 20_000 }, async () => {
  const savedEnv = { ...process.env };
  // Short Unix socket paths also work on macOS (104-byte sockaddr limit).
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const socket = join(dir, "s");
  const log = join(dir, "requests");
  const child = fork(fileURLToPath(new URL("./fixtures/herdr-socket-server.cjs", import.meta.url)), [socket, log], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  try {
    const ready = await once(child, "message", { signal: AbortSignal.timeout(5000) });
    assert.deepEqual(ready, ["ready", undefined]);
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = socket;
    process.env.HERDR_PANE_ID = "w7:p1";
    const surface = herdr.createHerdrSurface("worker 'one'; $HOME");
    assert.equal(surface, "herdr:w7:p9");
    herdr.sendHerdrCommand(surface, "printf '%s\\n' '$HOME'");
    assert.equal(herdr.readHerdrScreen(surface, 5), "literal $HOME\n__SUBAGENT_DONE_0__\n");
    assert.equal(await herdr.readHerdrScreenAsync(surface, 7), "literal $HOME\n__SUBAGENT_DONE_0__\n");
    herdr.focusHerdrSurface(surface);
    herdr.closeHerdrSurface(surface);
    const requests = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((request) => request.method !== "ping");
    assert.deepEqual(requests.map((r) => r.method), ["pane.get", "tab.create", "pane.send_input", "pane.read", "pane.read", "agent.focus", "pane.close"]);
    assert.equal(requests[0].params.pane_id, "w7:p1");
    assert.equal(requests[1].params.workspace_id, "w7");
    assert.equal(requests[1].params.focus, false);
    assert.equal(requests[1].params.label, "worker 'one'; $HOME");
    assert.equal(requests[2].params.text, "printf '%s\\n' '$HOME'");
    assert.deepEqual(requests[2].params.keys, ["Enter"]);
    assert.equal(requests[3].params.lines, 5);
    assert.equal(requests[4].params.lines, 7);
    assert.equal(requests[5].params.target, "w7:p9");
    assert.equal(requests[6].params.pane_id, "w7:p9");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    const exited = once(child, "exit");
    child.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
