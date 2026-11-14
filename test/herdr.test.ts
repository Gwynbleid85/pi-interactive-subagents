import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the real adapter at the external process boundary. The fake only
// replaces the Herdr server/CLI, which must not control a developer's session.
const adapter = await import("../pi-extension/subagents/herdr.ts").catch(() => ({} as any));

const pane = (pane_id = "w7:p1", tab_id = "w7:t1") => ({
  pane_id, terminal_id: "terminal-test", workspace_id: "w7", tab_id,
  focused: false, agent_status: "idle", revision: 1,
});
const tab = { tab_id: "w7:t9", workspace_id: "w7", number: 9,
  label: "worker", focused: false, pane_count: 1, agent_status: "idle" };

let dir: string;
let savedEnv: NodeJS.ProcessEnv;
function calls(): string[][] {
  const text = readFileSync(join(dir, "calls"), "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}
function response(value: unknown) {
  writeFileSync(join(dir, "response"), JSON.stringify(value));
}

describe("Herdr adapter", () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
    dir = mkdtempSync(join(tmpdir(), "pi-herdr-test-"));
    writeFileSync(join(dir, "calls"), "");
    writeFileSync(join(dir, "herdr"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('herdr 0.9.5'); process.exit(0); }
if (process.env.HERDR_TEST_FAIL) { console.error('server unavailable'); process.exit(1); }
if (process.env.HERDR_TEST_STALL) { setTimeout(() => {}, 10000); return; }
if (fs.existsSync(path.join(dir, 'response'))) {
 const value = JSON.parse(fs.readFileSync(path.join(dir, 'response'), 'utf8'));
 console.log(typeof value === 'string' ? value : JSON.stringify(value)); return;
}
if (args[0] === 'pane' && args[1] === 'get') {
 console.log(JSON.stringify({id:'test',result:{type:'pane_info',pane:args[2] === 'w7:p1' ? ${JSON.stringify(pane())} : ${JSON.stringify(pane("w7:p9", "w7:t9"))}}}));
} else if (args[0] === 'tab' && args[1] === 'create') {
 console.log(JSON.stringify({id:'test',result:{type:'tab_created',tab:${JSON.stringify(tab)},root_pane:${JSON.stringify(pane("w7:p9", "w7:t9"))}}}));
} else if (args[0] === 'pane' && args[1] === 'read') { console.log('answer\\n__SUBAGENT_DONE_0__'); }
else if (args[0] === 'pane' && args[1] === 'run') { /* CLI acknowledges with exit status, no stdout. */ }
else { console.log(JSON.stringify({id:'test',result:{type:'ok'}})); }
`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedEnv.PATH}`;
    delete process.env.HERDR_BIN_PATH;
    delete process.env.HERDR_TEST_FAIL;
    delete process.env.HERDR_TEST_STALL;
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = join(dir, "herdr.sock");
    process.env.HERDR_PANE_ID = "w7:p1";
    process.env.HERDR_WORKSPACE_ID = "w999"; // stale context must not choose workspace
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires complete Herdr context and an available binary", () => {
    assert.equal(typeof adapter.isHerdrAvailable, "function", "Herdr adapter is missing");
    assert.equal(adapter.isHerdrAvailable(), true);
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) {
      const saved = process.env[key]; delete process.env[key];
      assert.equal(adapter.isHerdrAvailable(), false, key);
      process.env[key] = saved;
    }
    process.env.HERDR_BIN_PATH = join(dir, "missing");
    assert.equal(adapter.isHerdrAvailable(), false);
  });

  it("creates an unfocused named tab in the parent's actual workspace", () => {
    assert.equal(typeof adapter.createHerdrSurface, "function", "Herdr creation is missing");
    assert.equal(adapter.createHerdrSurface("worker 'one'; $(touch /bad)"), "herdr:w7:p9");
    assert.deepEqual(calls().filter((args) => args[0] !== "--version"), [
      ["pane", "get", "w7:p1"],
      ["tab", "create", "--workspace", "w7", "--label", "worker 'one'; $(touch /bad)", "--cwd", process.cwd(), "--no-focus"],
    ]);
  });

  it("preserves command text as one literal argument and targets only the child", () => {
    assert.equal(typeof adapter.sendHerdrCommand, "function");
    adapter.sendHerdrCommand("herdr:w7:p9", "printf '%s\\n' 'hello';\necho '$HOME'");
    assert.deepEqual(calls(), [["pane", "run", "w7:p9", "printf '%s\\n' 'hello';\necho '$HOME'"]]);
  });

  it("reads plain text synchronously and asynchronously without moving focus", async () => {
    assert.equal(typeof adapter.readHerdrScreen, "function");
    assert.equal(adapter.readHerdrScreen("herdr:w7:p9", 5), "answer\n__SUBAGENT_DONE_0__\n");
    assert.equal(await adapter.readHerdrScreenAsync("herdr:w7:p9", 12), "answer\n__SUBAGENT_DONE_0__\n");
    assert.deepEqual(calls(), [
      ["pane", "read", "w7:p9", "--source", "recent-unwrapped", "--lines", "5", "--format", "text"],
      ["pane", "read", "w7:p9", "--source", "recent-unwrapped", "--lines", "12", "--format", "text"],
    ]);
  });

  it("focuses the exact live agent and only closes that child pane", () => {
    assert.equal(typeof adapter.focusHerdrSurface, "function");
    adapter.focusHerdrSurface("herdr:w7:p9");
    adapter.closeHerdrSurface("herdr:w7:p9");
    assert.deepEqual(calls(), [["agent", "focus", "w7:p9"], ["pane", "close", "w7:p9"]]);
  });

  it("rejects invalid handles without executing a CLI command", () => {
    assert.equal(typeof adapter.closeHerdrSurface, "function");
    for (const bad of ["%12", "herdr:", "herdr:--current", "herdr:w7:p9\n--current"]) {
      assert.throws(() => adapter.closeHerdrSurface(bad), /invalid.*surface/i);
    }
    assert.deepEqual(calls(), []);
  });

  it("rejects malformed, error, and missing-ID responses without changing focus", () => {
    assert.equal(typeof adapter.createHerdrSurface, "function");
    for (const value of ["not json", { result: {} }, { error: { message: "closed pane" } }, { result: { pane: { workspace_id: "--current" } } }]) {
      response(value);
      assert.throws(() => adapter.createHerdrSurface("worker"), /Herdr/i);
    }
    assert.ok(calls().every((args) => args[0] === "--version" || args[1] === "get"));
  });

  it("rejects creation responses without a root pane ID", () => {
    assert.equal(typeof adapter.createHerdrSurface, "function");
    // Supply a valid parent lookup, then a bad creation response.
    const script = readFileSync(join(dir, "herdr"), "utf8");
    writeFileSync(join(dir, "herdr"), script.replace(`root_pane:${JSON.stringify(pane("w7:p9", "w7:t9"))}`, 'root_pane:{}'));
    assert.throws(() => adapter.createHerdrSurface("worker"), /Herdr.*pane/i);
  });

  it("reports CLI failures with operation context without retrying mutations", async () => {
    assert.equal(typeof adapter.sendHerdrCommand, "function");
    process.env.HERDR_TEST_FAIL = "1";
    assert.throws(() => adapter.sendHerdrCommand("herdr:w7:p9", "hi"), /Herdr.*pane run.*server unavailable/s);
    assert.throws(() => adapter.focusHerdrSurface("herdr:w7:p9"), /Herdr.*agent focus.*server unavailable/s);
    await assert.rejects(adapter.readHerdrScreenAsync("herdr:w7:p9", 5), /Herdr.*pane read.*server unavailable/s);
    assert.equal(calls().filter((args) => args[1] === "run").length, 1);
  });

  it("bounds a stalled CLI command", () => {
    assert.equal(typeof adapter.closeHerdrSurface, "function");
    process.env.HERDR_TEST_STALL = "1";
    const start = Date.now();
    assert.throws(() => adapter.closeHerdrSurface("herdr:w7:p9"), /Herdr/i);
    assert.ok(Date.now() - start < 9000);
  });
});
