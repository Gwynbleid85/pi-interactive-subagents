import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupOwnedSurfaces } from "../helpers/owned-surfaces.ts";
import {
  createSurface, sendLongCommand, readScreenAsync, closeSurface, pollForExit,
} from "../../pi-extension/subagents/tmux.ts";

it("runs two native Core child surfaces and detects completion without a model or UI changes", {
  skip: process.env.HERDR_CORE_RUN_SMOKE !== "1",
  timeout: 30000,
}, async () => {
  assert.ok(process.env.HC_TERMINAL_ID, "Run inside a Core-managed terminal");
  const dir = mkdtempSync(join(tmpdir(), "pi-hc-smoke-"));
  const children: string[] = [];
  try {
    for (const name of ["alpha", "beta"]) {
      const surface = createSurface(`pi-hc-smoke-${name}`);
      children.push(surface);
      assert.match(surface, /^hc:t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/);
      sendLongCommand(surface, `printf '%s\\n' 'CORE_${name}_$HOME'; printf '__SUBAGENT_DONE_%s__\\n' 0`, {
        scriptPath: join(dir, `${name}.sh`),
      });
    }
    assert.notEqual(children[0], children[1]);
    const outcomes = await Promise.all(children.map(surface => pollForExit(surface, AbortSignal.timeout(15000), {interval:100})));
    assert.deepEqual(outcomes, [{reason:"sentinel",exitCode:0},{reason:"sentinel",exitCode:0}]);
    const screens = await Promise.all(children.map(surface => readScreenAsync(surface,50)));
    assert.match(screens[0], /CORE_alpha_\$HOME/);
    assert.match(screens[1], /CORE_beta_\$HOME/);
  } finally {
    try { cleanupOwnedSurfaces(children, closeSurface); }
    finally { rmSync(dir, { recursive:true, force:true }); }
  }
});
