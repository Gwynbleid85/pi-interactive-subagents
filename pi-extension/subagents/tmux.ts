/**
 * Terminal surface facade for tmux, legacy Herdr tabs and Herdr Core children.
 * The historical filename is retained for compatibility with existing imports.
 *
 * Everything the extension does to a pane goes through the small API in this
 * file: create a background window or split, type a command into it, read its screen, close
 * it, and poll for exit. Keeping the tmux calls isolated here means index.ts
 * stays testable without a multiplexer running.
 *
 * Core uses `hc:<terminal-id>`, legacy Herdr uses `herdr:<pane-id>`;
 * tmux uses pane ids (e.g. `%12`).
 * Backend routing follows the handle, not whichever terminal is now preferred.
 * Subagent tmux windows target
 * the parent pi's session via `$TMUX_PANE`, without changing keyboard focus
 * or the parent window's layout.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  isHerdrAvailable, createHerdrSurface, sendHerdrCommand,
  readHerdrScreen, readHerdrScreenAsync, focusHerdrSurface, closeHerdrSurface,
} from "./herdr.ts";

import {
  hasHerdrCoreContext, isHerdrCoreAvailable, createHerdrCoreSurface,
  sendHerdrCoreCommand, readHerdrCoreScreen, readHerdrCoreScreenAsync,
  focusHerdrCoreSurface, closeHerdrCoreSurface,
} from "./herdr-core.ts";

const execFileAsync = promisify(execFile);

// ── Availability ──

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

/**
 * True when running inside tmux with the tmux binary on PATH.
 * `TMUX` is set by tmux in every process it spawns (shell or pane).
 */
export function isTmuxAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

export function isMuxAvailable(): boolean {
  // A broken managed context must not launch into a different session.
  if (hasHerdrCoreContext()) return isHerdrCoreAvailable();
  return process.env.HERDR_ENV === "1" ? isHerdrAvailable() : isTmuxAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside Herdr Core (HC_TERMINAL_ID and HC_TERMINAL_SOCKET), legacy Herdr (0.9.5+ with its CLI and socket), or tmux (`tmux new -A -s pi 'pi'`).";
}

function requireTmux(): void {
  if (!isTmuxAvailable()) {
    throw new Error(`tmux is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Surface primitives ──

/**
 * Create an unfocused, named window in the parent pi's session.
 * Returns its initial pane id (e.g. `%12`) for communication and cleanup.
 */
export function createSurface(name: string): string {
  if (hasHerdrCoreContext()) return createHerdrCoreSurface(name);
  if (process.env.HERDR_ENV === "1") return createHerdrSurface(name);
  requireTmux();

  const args = ["new-window", "-d", "-n", name];
  if (process.env.TMUX_PANE) {
    const session = execFileSync(
      "tmux",
      ["display-message", "-p", "-t", process.env.TMUX_PANE, "#{session_id}"],
      { encoding: "utf8" },
    ).trim();
    // new-window requires a window target, not a pane ID. An empty window
    // index allocates the next available slot in the parent's session.
    args.push("-t", `${session}:`);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux new-window output: ${pane}`);
  }
  return pane;
}

/**
 * Create a new split in the given direction from an optional source pane.
 * Returns the new pane id (e.g. `%12`).
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  requireTmux();

  const args = ["split-window", "-d"];
  if (direction === "left" || direction === "right") {
    args.push("-h");
  } else {
    args.push("-v");
  }
  if (direction === "left" || direction === "up") {
    args.push("-b");
  }
  if (fromSurface) {
    args.push("-t", fromSurface);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }

  return pane;
}

/**
 * Send a command string to a pane and execute it.
 * Typed literally (`-l`) so special characters are not interpreted as keys,
 * then submitted with Enter.
 */
export function sendCommand(surface: string, command: string): void {
  if (surface.startsWith("hc:")) return sendHerdrCoreCommand(surface, command);
  if (surface.startsWith("herdr:")) return sendHerdrCommand(surface, command);
  requireTmux();
  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], { encoding: "utf8" });
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { encoding: "utf8" });
}

/**
 * Send a long command to a pane by writing it to a script file first.
 * This avoids terminal line-wrapping issues that break commands exceeding the
 * pane's column width when sent character-by-character via sendCommand.
 *
 * By default the script is written to a temp directory, but callers can pass a
 * stable path (for example under session artifacts) so the exact invocation is
 * preserved for debugging.
 *
 * Returns the script path.
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    // Metadata is never executable shell. Names and paths can contain physical
    // newlines, so comment every line, not just the caller's template lines.
    scriptParts.push(options.scriptPreamble.trimEnd().split(/\r\n?|\n/)
      .map((line) => `# ${line.replace(/^# ?/, "")}`).join("\n"));
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", {
    mode: 0o755,
  });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * Read the screen contents of a pane (sync).
 */
export function readScreen(surface: string, lines = 50): string {
  if (surface.startsWith("hc:")) return readHerdrCoreScreen(surface, lines);
  if (surface.startsWith("herdr:")) return readHerdrScreen(surface, lines);
  requireTmux();
  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    {
      encoding: "utf8",
    },
  );
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  if (surface.startsWith("hc:")) return readHerdrCoreScreenAsync(surface, lines);
  if (surface.startsWith("herdr:")) return readHerdrScreenAsync(surface, lines);
  requireTmux();
  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

/**
 * Focus a subagent's window and pane. Resolve the target before changing focus
 * so a closed pane cannot fall back to the caller's current window.
 */
export function focusSurface(surface: string): void {
  if (surface.startsWith("hc:")) return focusHerdrCoreSurface(surface);
  if (surface.startsWith("herdr:")) return focusHerdrSurface(surface);
  requireTmux();
  const window = execFileSync(
    "tmux",
    ["display-message", "-p", "-t", surface, "#{session_id}:#{window_id}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  // Queue both nonblocking commands in one tmux request. Separate processes
  // leave a gap where the pane can exit and the cached window can select a
  // surviving sibling instead. A failed select-pane stops this command queue.
  execFileSync("tmux", ["select-pane", "-t", surface, ";", "select-window", "-t", window], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string): void {
  if (surface.startsWith("hc:")) return closeHerdrCoreSurface(surface);
  if (surface.startsWith("herdr:")) return closeHerdrSurface(surface);
  requireTmux();
  execFileSync("tmux", ["kill-pane", "-t", surface], { encoding: "utf8" });
}

/** Release a terminal whose launch never handed ownership to its watcher.
 * Never retry a send: an ambiguous delivery is cleaned up, not resubmitted.
 * Keep the launch error primary, but surface any failed cleanup as well.
 */
export function failSurfaceStartup(surface: string, error: unknown): never {
  try {
    closeSurface(surface);
  } catch (cleanupError) {
    const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    const failure = new Error(
      `${error instanceof Error ? error.message : String(error)}\nTerminal cleanup failed: ${detail}`,
      { cause: error },
    );
    Object.assign(failure, { cleanupError: detail });
    throw failure;
  }
  throw error;
}

// ── Exit polling ──

export interface PollResult {
  /** How the subagent exited */
  reason: "done" | "sentinel" | "error";
  /** Shell exit code (from sentinel). 0 for file-based exits. */
  exitCode: number;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
}

/**
 * Interpret an `.exit` sidecar payload (written by the error path in
 * subagent-done.ts). Centralized so both the fast and slow paths in
 * pollForExit decode the payload the same way. Clean completions write no
 * sidecar and are detected via the terminal sentinel instead.
 *
 * Note: ask_question does NOT write a `.exit` sidecar — it keeps the session
 * open and signals the parent via a separate `.ask` file (see deliverPendingQuestion).
 */
function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

/**
 * Poll until the subagent exits. Checks for a `.exit` sidecar file first
 * (written by the error path), falling back to the terminal sentinel for
 * clean-completion and crash detection.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();
  let consecutiveReadErrors = 0;

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Fast path: check for .exit sidecar file (written by the error path)
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    // Check Claude sentinel file (written by plugin Stop hook)
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // Slow path: read terminal screen for sentinel (crash detection)
    try {
      const screen = await readScreenAsync(surface, 5);
      consecutiveReadErrors = 0;
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch (error) {
      // Surface may have been destroyed — check if .exit file appeared in the meantime
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
      if (options.sentinelFile && existsSync(options.sentinelFile)) {
        return { reason: "sentinel", exitCode: 0 };
      }
      // A short outage can recover, but a closed pane or unavailable server
      // must not leave a child registered as running forever.
      if (++consecutiveReadErrors >= 3) {
        throw new Error(`Terminal read failed after 3 consecutive attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
