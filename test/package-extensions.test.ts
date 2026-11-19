import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

test("default package discovery loads the subagent, user-question, and legacy bridge extensions", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const entries = manifest.pi.extensions;
  assert.ok(entries.includes("./pi-extension/subagents/index.ts"));
  assert.ok(entries.includes("./pi-extension/ask-user-question.ts"));
  assert.ok(entries.includes("./pi-extension/herdr-ui-prompts.ts"));
  assert.equal(new Set(entries).size, entries.length, "extension entries must be unique");
  const tools: string[] = [];
  const events: string[] = [];
  for (const entry of entries) {
    const { default: load } = await import(pathToFileURL(resolve(root, entry)).href);
    load({
      registerTool(tool: { name: string }) { tools.push(tool.name); },
      on(name: string) { events.push(name); },
      registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
      events: { on() {}, emit() {} },
    });
  }
  assert.equal(tools.filter(name => name === "ask_user_question").length, 1);
  assert.equal(tools.filter(name => name === "subagent").length, 1);
  assert.ok(events.includes("ui_prompt_start"));
  assert.ok(events.includes("ui_prompt_end"));
  assert.ok(events.includes("session_shutdown"));
});
