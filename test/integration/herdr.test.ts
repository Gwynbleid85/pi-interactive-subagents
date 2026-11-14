/** Opt-in, no-model smoke test. Run from a Herdr-managed terminal. */
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSurface, sendLongCommand, readScreen, pollForExit, closeSurface, shellEscape } from "../../pi-extension/subagents/tmux.ts";

const enabled = process.env.HERDR_RUN_SMOKE === "1" && process.env.HERDR_ENV === "1";
it("runs commands and detects completion in its own unfocused Herdr tab", {
  skip: !enabled && "Set HERDR_RUN_SMOKE=1 inside Herdr to enable this test", timeout: 30_000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-herdr-smoke-"));
  let surface: string | undefined;
  try {
    surface = createSurface(`pi-smoke-${Date.now()}`);
    assert.match(surface, /^herdr:/);
    // Leave the user's focused terminal untouched. Allow the new shell to load.
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS ?? "2500")));
    const marker = join(dir, "executed");
    sendLongCommand(surface, [
      `printf '%s\\n' 'literal $HOME' > ${shellEscape(marker)}`,
      `printf '%s\\n' 'literal $HOME'`,
      `printf '%s\\n' '__SUBAGENT_DONE_0__'`,
    ].join("\n"), { scriptPath: join(dir, "smoke.sh") });
    assert.deepEqual(await pollForExit(surface, AbortSignal.timeout(15_000), { interval: 100 }), { reason: "sentinel", exitCode: 0 });
    assert.equal(readFileSync(marker, "utf8"), "literal $HOME\n");
    assert.match(readScreen(surface, 30), /literal \$HOME/);
  } finally {
    try {
      if (surface) closeSurface(surface);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
