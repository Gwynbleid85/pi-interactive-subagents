import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import extension from "../pi-extension/herdr-ui-prompts.ts";

function harness(mode = "tui") {
  const handlers = new Map<string, Function>();
  const bus = new EventEmitter();
  const emissions: Array<{ active: boolean; label?: string }> = [];
  bus.on("herdr:blocked", data => emissions.push(data));
  extension({
    events: bus,
    on(name: string, handler: Function) { handlers.set(name, handler); },
  } as any);
  return {
    emissions,
    emit(name: string, event: object = {}) {
      handlers.get(name)?.(event, { mode, hasUI: mode === "tui" || mode === "rpc" });
    },
  };
}

test("prompt lifecycle publishes a balanced blocked span with the title", () => {
  const h = harness();
  h.emit("ui_prompt_start", { kind: "editor", title: "Choose deployment" });
  assert.deepEqual(h.emissions, [{ active: true, label: "Choose deployment" }]);
  h.emit("ui_prompt_end");
  assert.deepEqual(h.emissions, [
    { active: true, label: "Choose deployment" }, { active: false },
  ]);
});

test("untitled custom prompts have a waiting label", () => {
  const h = harness();
  h.emit("ui_prompt_start", { kind: "custom" });
  assert.deepEqual(h.emissions, [{ active: true, label: "Waiting for user input" }]);
});

test("duplicate starts and unmatched ends cannot release another owner's blocker", () => {
  const h = harness();
  h.emit("ui_prompt_end");
  h.emit("ui_prompt_start");
  h.emit("ui_prompt_start");
  h.emit("ui_prompt_end");
  h.emit("ui_prompt_end");
  assert.deepEqual(h.emissions.map(data => data.active), [true, false]);
});

test("shutdown releases only the owned span and a new span can start", () => {
  const h = harness();
  h.emit("ui_prompt_start");
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  h.emit("ui_prompt_end");
  h.emit("ui_prompt_start");
  h.emit("ui_prompt_end");
  assert.deepEqual(h.emissions.map(data => data.active), [true, false, true, false]);
});

for (const mode of ["rpc", "json", "print"]) {
  test(`${mode} does not publish TUI blocked spans`, () => {
    const h = harness(mode);
    h.emit("ui_prompt_start");
    h.emit("ui_prompt_end");
    h.emit("session_shutdown");
    assert.deepEqual(h.emissions, []);
  });
}
