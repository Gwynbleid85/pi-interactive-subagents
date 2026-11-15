/** Native Herdr Core child terminals. Layout belongs to herdr-app, not Core. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { request, MAX_BYTES, TIMEOUT_MS } from "./herdr-core-rpc.cjs";

const RPC_HELPER = fileURLToPath(new URL("./herdr-core-rpc.cjs", import.meta.url));
// Core addresses count t1..t9, t10..t19, t1b.. using a 30-symbol alphabet.
const validId = (value: unknown): value is string => typeof value === "string" && /^t[1-9][0-9bcdfghjkmnpqrstvwxyz]{0,31}$/.test(value);

function endpoint(): string {
  const value = process.env.HC_SOCKET || process.env.HC_TERMINAL_SOCKET;
  if (!value) throw new Error("Herdr Core requires HC_TERMINAL_SOCKET (or HC_SOCKET).");
  return value;
}

export function hasHerdrCoreContext(): boolean {
  return process.env.HC_TERMINAL_ID !== undefined || process.env.HC_TERMINAL_SOCKET !== undefined;
}

export function isHerdrCoreAvailable(): boolean {
  if (!validId(process.env.HC_TERMINAL_ID)) return false;
  try {
    const path = endpoint();
    return process.platform === "win32" || existsSync(path);
  } catch { return false; }
}

function caller(): string {
  if (!validId(process.env.HC_TERMINAL_ID)) throw new Error("Herdr Core requires a valid HC_TERMINAL_ID.");
  return process.env.HC_TERMINAL_ID;
}

function terminal(surface: string, mutate = false): string {
  const id = surface.startsWith("hc:") ? surface.slice(3) : "";
  if (!validId(id)) throw new Error(`Invalid Herdr Core surface: ${JSON.stringify(surface)}`);
  if (mutate && id === caller()) throw new Error("Refusing to mutate the parent Herdr Core terminal.");
  return id;
}

function rpc(method: string, params: Record<string, unknown>): any {
  const output = execFileSync(process.execPath, [RPC_HELPER], {
    input: JSON.stringify({ endpoint: endpoint(), method, params }),
    encoding: "utf8", timeout: TIMEOUT_MS + 1000, maxBuffer: MAX_BYTES + 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = JSON.parse(output);
  if (!response.ok) {
    const error = new Error(response.error.message);
    Object.assign(error, { kind: response.error.kind, code: response.error.code });
    throw error;
  }
  return response.result;
}

export function createHerdrCoreSurface(name: string): string {
  if (!isHerdrCoreAvailable()) throw new Error("Herdr Core requires a managed terminal and reachable socket path.");
  const parent = caller();
  // Core names are restricted and globally unique, unlike Pi display names.
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 22) || "worker";
  const result = rpc("terminal.run", {
    argv: ["bash", "--noprofile", "--norc", "-i"],
    name: `${slug}-${randomUUID().slice(0, 8)}`,
    cwd: process.cwd(), caller: parent, parent,
    wait: false, no_notify: true, outlive_parent: false,
  });
  if (!validId(result?.address)) throw new Error("Herdr Core creation returned no valid terminal address.");
  if (result.address === parent) throw new Error("Herdr Core creation returned the parent's address.");
  return `hc:${result.address}`;
}

export function sendHerdrCoreCommand(surface: string, command: string): void {
  rpc("terminal.send", { terminal: terminal(surface, true), caller: caller(), text: command, wait: false });
}

function readParams(surface: string, lines: number): Record<string, unknown> {
  return { terminal: terminal(surface), caller: caller(), lines: Number.isFinite(lines) ? Math.max(1, Math.floor(lines)) : 50 };
}

function screen(result: any): string {
  if (typeof result?.text !== "string") throw new Error("Herdr Core terminal.read returned no screen text.");
  return result.text;
}

export function readHerdrCoreScreen(surface: string, lines = 50): string {
  return screen(rpc("terminal.read", readParams(surface, lines)));
}

export async function readHerdrCoreScreenAsync(surface: string, lines = 50): Promise<string> {
  return screen(await request(endpoint(), "terminal.read", readParams(surface, lines)));
}

export function focusHerdrCoreSurface(surface: string): void {
  const id = terminal(surface);
  try {
    execFileSync(process.env.HERDR_APP_BIN_PATH || "herdr-app", ["do", "agent.focus", "--terminal", id], {
      encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new Error(`Herdr Core focus requires the running herdr-app and its CLI: ${detail.stderr?.trim() || detail.message}`);
  }
}

export function closeHerdrCoreSurface(surface: string): void {
  const params = { terminal: terminal(surface, true), caller: caller() };
  for (const method of ["terminal.kill", "terminal.rm"]) {
    try { rpc(method, params); }
    catch (error) {
      if ((error as { kind?: string }).kind !== "not_found") throw error;
    }
  }
}
