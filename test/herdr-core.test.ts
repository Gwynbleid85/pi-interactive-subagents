import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as surfaces from "../pi-extension/subagents/tmux.ts";
import subagentsExtension, { __test__ } from "../pi-extension/subagents/index.ts";
import { registerName, writeSubagentLoadout } from "../pi-extension/subagents/session.ts";

import * as core from "../pi-extension/subagents/herdr-core.ts";
import * as rpc from "../pi-extension/subagents/herdr-core-rpc.cjs";
import { cleanupOwnedSurfaces } from "./helpers/owned-surfaces.ts";

// The real adapter talks to an external test server, never the user's Core.
let dir: string;
let server: ReturnType<typeof fork>;
let savedEnv: NodeJS.ProcessEnv;
function config(value: object) { writeFileSync(join(dir, "config"), JSON.stringify(value)); }
function calls() { return readFileSync(join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }

describe("Herdr Core adapter", () => {
  beforeEach(async () => {
    savedEnv = { ...process.env };
    dir = mkdtempSync(join(tmpdir(), "pi-hc-"));
    writeFileSync(join(dir, "calls"), "");
    config({});
    writeFileSync(join(dir, "server.cjs"), `
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
net.createServer(socket => {
 let data = '';
 socket.on('error', () => {});
 socket.on('data', chunk => {
  data += chunk;
  if (!data.includes('\\n')) return;
  const req = JSON.parse(data.split('\\n')[0]);
  data = '';
  fs.appendFileSync(path.join(dir, 'calls'), JSON.stringify(req) + '\\n');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config'), 'utf8'));
  if (cfg.mode === 'stall') return;
  if (cfg.mode === 'disconnect') return socket.end();
  if (cfg.mode === 'malformed') return socket.end('not json\\n');
  if (cfg.mode === 'oversized') return socket.end('x'.repeat(4*1024*1024+1));
  let result = {address: 't8', state: 'live', parent: 't1'};
  if (req.method === 'terminal.read') result = {text:'literal $HOME\\n__SUBAGENT_DONE_0__\\n', complete:true, how:'history'};
  if (cfg.result !== undefined) result = cfg.result;
  const error = cfg.error || (req.method === cfg.failMethod ? {code:-32000,message:'already gone',data:{kind:cfg.kind || 'not_found'}} : undefined);
  const msg = JSON.stringify({jsonrpc:'2.0',id:cfg.mode === 'wrong-id' ? 999 : req.id,...(error ? {error} : {result})})+'\\n';
  if (cfg.mode === 'split') { socket.write(msg.slice(0,12)); setTimeout(() => socket.end(msg.slice(12)), 10); }
  else socket.end(msg);
 });
}).listen(path.join(dir, 'core.sock'), () => process.send('ready'));
`);
    server = fork(join(dir, "server.cjs"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    await once(server, "message");
    process.env.HC_TERMINAL_ID = "t1";
    process.env.HC_TERMINAL_SOCKET = join(dir, "core.sock");
    delete process.env.HC_SOCKET;
    delete process.env.HERDR_ENV;
    delete process.env.TMUX;
  });
  afterEach(async () => {
    if (server && server.exitCode === null) {
      const exited = once(server, "exit"); server.kill(); await exited;
    }
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires managed terminal context and its endpoint, not a legacy CLI", () => {
    assert.equal(typeof core?.isHerdrCoreAvailable, "function", "Core availability is missing");
    assert.equal(core.isHerdrCoreAvailable(), true);
    delete process.env.HC_TERMINAL_ID;
    assert.equal(core.isHerdrCoreAvailable(), false);
    process.env.HC_TERMINAL_ID = "--bad";
    assert.equal(core.isHerdrCoreAvailable(), false);
    process.env.HC_TERMINAL_ID = "t1";
    delete process.env.HC_TERMINAL_SOCKET;
    assert.equal(core.isHerdrCoreAvailable(), false);
  });

  it("creates a hidden child shell with explicit parent, cwd, no duplicate notes and a safe unique name", () => {
    assert.equal(typeof core?.createHerdrCoreSurface, "function", "Core creation is missing");
    assert.equal(core.createHerdrCoreSurface("Worker 'one'; $(touch /bad)"), "hc:t8");
    const req = calls().find(x => x.method === "terminal.run");
    assert.equal(req.params.parent, "t1"); assert.equal(req.params.caller, "t1");
    assert.equal(req.params.cwd, process.cwd()); assert.equal(req.params.wait, false);
    assert.equal(req.params.no_notify, true); assert.equal(req.params.outlive_parent, false);
    assert.deepEqual(req.params.argv, ["bash", "--noprofile", "--norc", "-i"]);
    assert.match(req.params.name, /^[a-z0-9_-]{1,32}$/);
    assert.deepEqual(req.params.labels ?? {}, {});
  });

  it("preserves literal command text and reads only the exact child synchronously and asynchronously", async () => {
    assert.equal(typeof core?.sendHerdrCoreCommand, "function", "Core sending is missing");
    const text = "printf '%s\\n' '$HOME';\necho done";
    core.sendHerdrCoreCommand("hc:t8", text);
    assert.equal(core.readHerdrCoreScreen("hc:t8", 12), "literal $HOME\n__SUBAGENT_DONE_0__\n");
    assert.equal(await core.readHerdrCoreScreenAsync("hc:t8", 5), "literal $HOME\n__SUBAGENT_DONE_0__\n");
    assert.deepEqual(calls().map(x => [x.method,x.params]), [
      ["terminal.send", {terminal:"t8",caller:"t1",text,wait:false}],
      ["terminal.read", {terminal:"t8",caller:"t1",lines:12}],
      ["terminal.read", {terminal:"t8",caller:"t1",lines:5}],
    ]);
  });

  it("rejects malformed handles and never sends commands to or closes the parent", () => {
    assert.equal(typeof core?.closeHerdrCoreSurface, "function", "Core cleanup is missing");
    for (const handle of ["hc:","hc:t8; rm -rf /", "herdr:t8", "hc:t1"]) {
      assert.throws(() => core.closeHerdrCoreSurface(handle), /Invalid|parent/);
      assert.throws(() => core.sendHerdrCoreCommand(handle, "bad"), /Invalid|parent/);
    }
    assert.deepEqual(calls(), []);
  });

  it("kills then removes only its child, including an already-missing child", () => {
    assert.equal(typeof core?.closeHerdrCoreSurface, "function", "Core cleanup is missing");
    core.closeHerdrCoreSurface("hc:t8");
    assert.deepEqual(calls().map(x => [x.method,x.params.terminal]), [["terminal.kill","t8"],["terminal.rm","t8"]]);
    config({failMethod:"terminal.kill",kind:"not_found"});
    core.closeHerdrCoreSurface("hc:t8");
    config({failMethod:"terminal.kill",kind:"unavailable"});
    assert.throws(() => core.closeHerdrCoreSurface("hc:t8"), /already gone/);
    assert.equal(calls().at(-1).method, "terminal.kill");
  });

  it("rejects invalid creation results, including the parent's address", () => {
    assert.equal(typeof core?.createHerdrCoreSurface, "function", "Core creation is missing");
    for (const result of [{}, {address:"t1"}, {address:"bad value"}]) {
      config({result}); assert.throws(() => core.createHerdrCoreSurface("worker"), /address|parent/);
    }
  });

  it("focuses through the desktop app using an explicit terminal ID", () => {
    assert.equal(typeof core?.focusHerdrCoreSurface, "function", "Core focus is missing");
    const app = join(dir, "herdr-app");
    writeFileSync(app, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(dir,"focus"))}, JSON.stringify(process.argv.slice(2)));\nconsole.log('{}');\n`, {mode:0o755});
    process.env.HERDR_APP_BIN_PATH = app;
    core.focusHerdrCoreSurface("hc:t1b");
    assert.deepEqual(JSON.parse(readFileSync(join(dir,"focus"),"utf8")), ["do","agent.focus","--terminal","t1b"]);
    process.env.HERDR_APP_BIN_PATH = join(dir,"missing");
    assert.throws(() => core.focusHerdrCoreSurface("hc:t8"), /Herdr.*app|herdr-app/);
  });

  it("accepts Core's alphabetic parent and child addresses across create/send/read/close", async () => {
    process.env.HC_TERMINAL_ID = "t1b";
    assert.equal(core.isHerdrCoreAvailable(),true);
    config({result:{address:"t2z",state:"live",parent:"t1b"}});
    assert.equal(core.createHerdrCoreSurface("worker"),"hc:t2z");
    config({});
    core.sendHerdrCoreCommand("hc:t2z","echo marker");
    assert.match(core.readHerdrCoreScreen("hc:t2z"),/literal/);
    assert.match(await core.readHerdrCoreScreenAsync("hc:t2z"),/literal/);
    core.closeHerdrCoreSurface("hc:t2z");
    assert.deepEqual(calls().map(x => [x.method,x.params.caller]), [
      ["terminal.run","t1b"],["terminal.send","t1b"],["terminal.read","t1b"],
      ["terminal.read","t1b"],["terminal.kill","t1b"],["terminal.rm","t1b"],
    ]);
    assert.throws(() => core.closeHerdrCoreSurface("hc:t1b"),/parent/);
  });

  function registeredTools() {
    const tools = new Map<string,any>();
    subagentsExtension({
      on() {}, registerTool(tool:any) { tools.set(tool.name,tool); },
      registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
    } as any);
    return tools;
  }

  function launchContext(sessionDir = join(dir,"sessions")) {
    return {cwd:dir,sessionManager:{getSessionFile:()=>join(dir,"parent.jsonl"),getSessionId:()=>"core-failure-test",getSessionDir:()=>sessionDir}};
  }

  it("cleans up the created child after artifact preparation fails without tracking a running agent", async () => {
    const blocked = join(dir,"blocked"); writeFileSync(blocked,"not a directory");
    process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "0";
    const tools = registeredTools();
    await assert.rejects(tools.get("subagent").execute("test",{agent:"worker",name:"failure-test",task:"Do not run"},new AbortController().signal,()=>{},launchContext(blocked)), /ENOTDIR/);
    assert.deepEqual(calls().map(x => [x.method,x.params.terminal || x.params.parent]), [["terminal.run","t1"],["terminal.kill","t8"],["terminal.rm","t8"]]);
    assert.equal(__test__.runningSubagents.size,0);
  });

  for (const resume of [false,true]) {
    it(`cleans up a child after ${resume ? "resume" : "initial launch"} send rejection without retrying`, async () => {
      process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "0";
      const tools = registeredTools();
      const ctx = launchContext();
      if (resume) {
        const session = join(dir,"child.jsonl");
        writeFileSync(session,JSON.stringify({type:"session",id:"old-child",cwd:dir})+"\n");
        writeSubagentLoadout(session,{agent:"worker",toolAllowlist:"read",model:null,thinking:null,systemPromptMode:null,identity:null,spawnable:null,autoExit:true,cwd:dir,agentDir:null});
        registerName(join(ctx.sessionManager.getSessionDir(),"artifacts","core-failure-test"),"failure-test",{sessionFile:session,sessionId:"old-child"});
      }
      config({failMethod:"terminal.send",kind:"blocked"});
      const tool = tools.get(resume ? "subagent_message" : "subagent");
      const params = resume ? {name:"failure-test",message:"Follow up"} : {agent:"worker",name:"failure-test",task:"Do not run"};
      await assert.rejects(tool.execute("test",params,new AbortController().signal,()=>{},ctx),/already gone/);
      assert.deepEqual(calls().map(x => [x.method,x.params.terminal || x.params.parent]), [["terminal.run","t1"],["terminal.send","t8"],["terminal.kill","t8"],["terminal.rm","t8"]]);
      assert.equal(__test__.runningSubagents.size,0);
    });
  }

  it("retains the original startup failure and records a cleanup failure", async () => {
    const blocked = join(dir,"blocked"); writeFileSync(blocked,"not a directory");
    process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "0";
    config({failMethod:"terminal.kill",kind:"unavailable"});
    const tools = registeredTools();
    await assert.rejects(tools.get("subagent").execute("test",{agent:"worker",name:"failure-test",task:"Do not run"},new AbortController().signal,()=>{},launchContext(blocked)), (error:any) => /ENOTDIR/.test(error.message) && /cleanup failed/i.test(error.message) && /already gone/.test(error.cleanupError));
    assert.deepEqual(calls().map(x => x.method),["terminal.run","terminal.kill"]);
    assert.equal(__test__.runningSubagents.size,0);
  });

  it("attempts cleanup of every owned smoke-test child even when the first cleanup fails", () => {
    assert.equal(typeof cleanupOwnedSurfaces,"function","Safe smoke-test cleanup is missing");
    const attempted:string[] = [];
    assert.throws(() => cleanupOwnedSurfaces(["hc:t8","hc:t9"],(surface:string) => {
      attempted.push(surface);
      if (surface === "hc:t8") throw new Error("first child unavailable");
    }), /cleanup/i);
    assert.deepEqual(attempted,["hc:t8","hc:t9"]);
  });

  it("requires an endpoint on Windows as well as Unix", () => {
    assert.equal(typeof core?.isHerdrCoreAvailable, "function");
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process,"platform",{value:"win32"});
      delete process.env.HC_TERMINAL_SOCKET;
      assert.equal(core.isHerdrCoreAvailable(),false);
    } finally { Object.defineProperty(process,"platform",platform); }
  });

  it("honors HC_SOCKET override instead of silently using another Core endpoint", () => {
    assert.equal(typeof core?.isHerdrCoreAvailable, "function", "Core availability is missing");
    process.env.HC_SOCKET = join(dir,"missing.sock");
    assert.equal(core.isHerdrCoreAvailable(), false);
  });

  it("selects Core before inherited legacy contexts and fails closed on incomplete Core context", () => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w99:p1";
    process.env.TMUX = "/bad/tmux,1,1";
    assert.equal(surfaces.isMuxAvailable(), true);
    assert.equal(surfaces.createSurface("worker"), "hc:t8");
    delete process.env.HC_TERMINAL_ID;
    assert.equal(surfaces.isMuxAvailable(), false);
    assert.throws(() => surfaces.createSurface("worker"), /Herdr Core/);
    assert.equal(calls().filter(x => x.method === "terminal.run").length, 1);
  });

  it("routes existing Core handles by prefix rather than legacy backend preference", async () => {
    process.env.HERDR_ENV = "1";
    surfaces.sendCommand("hc:t8", "echo marker");
    assert.match(surfaces.readScreen("hc:t8"), /__SUBAGENT_DONE_0__/);
    assert.match(await surfaces.readScreenAsync("hc:t8"), /__SUBAGENT_DONE_0__/);
    const script = join(dir, "launch.sh");
    assert.equal(surfaces.sendLongCommand("hc:t8", "echo safe", {scriptPath:script}), script);
    assert.match(readFileSync(script,"utf8"), /echo safe/);
    surfaces.closeSurface("hc:t8");
    assert.deepEqual(calls().map(x => x.method), ["terminal.send","terminal.read","terminal.read","terminal.send","terminal.kill","terminal.rm"]);
  });

  it("assembles split JSON-RPC responses", async () => {
    assert.equal(typeof rpc?.request, "function", "Core RPC is missing");
    config({mode:"split"});
    const result = await rpc.request(process.env.HC_TERMINAL_SOCKET, "terminal.get", {terminal:"t8"});
    assert.equal(result.address,"t8");
  });

  for (const [mode, pattern] of [["malformed",/JSON|response/i],["oversized",/large|limit/i],["wrong-id",/id|response/i],["disconnect",/closed|disconnect/i],["stall",/timeout|timed out/i]] as const) {
    it(`rejects ${mode} responses with a bounded request`, async () => {
      assert.equal(typeof rpc?.request, "function", "Core RPC is missing");
      config({mode});
      await assert.rejects(rpc.request(process.env.HC_TERMINAL_SOCKET, "terminal.get", {terminal:"t8"}, {timeoutMs:200}), pattern);
      assert.equal(calls().length,1);
    });
  }

  it("preserves structured server errors without retrying sends", async () => {
    assert.equal(typeof rpc?.request, "function", "Core RPC is missing");
    config({error:{code:-32000,message:"approval needed",data:{kind:"blocked",hint:"ask user"}}});
    await assert.rejects(rpc.request(process.env.HC_TERMINAL_SOCKET,"terminal.send",{terminal:"t8",text:"hi"}), (e:any) => e.kind === "blocked" && /approval needed/.test(e.message));
    assert.equal(calls().length,1);
  });
});
