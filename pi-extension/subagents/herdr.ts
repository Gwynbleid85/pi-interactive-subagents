/** Native Herdr 0.9.5 terminal operations. All targets are explicit IDs. */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 4 * 1024 * 1024;

function binary(): string {
  return process.env.HERDR_BIN_PATH || "herdr";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,255}$/.test(value);
}

function paneId(surface: string): string {
  if (!surface.startsWith("herdr:") || !validId(surface.slice(6))) {
    throw new Error(`Invalid Herdr surface: ${JSON.stringify(surface)}`);
  }
  return surface.slice(6);
}

function cliError(args: string[], error: unknown): Error {
  const detail = error as { stderr?: string; message?: string };
  return new Error(`Herdr ${args.slice(0, 2).join(" ")} failed: ${detail.stderr?.trim() || detail.message || String(error)}`);
}

function run(args: string[]): string {
  try {
    return execFileSync(binary(), args, {
      encoding: "utf8", timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw cliError(args, error);
  }
}

function request(args: string[]): Record<string, any> {
  const text = run(args);
  try {
    const response = JSON.parse(text);
    if (response.error || !response.result || typeof response.result !== "object") {
      throw new Error(response.error?.message || "missing result");
    }
    return response.result;
  } catch (error) {
    throw cliError(args, error);
  }
}

export function isHerdrAvailable(): boolean {
  if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH || !validId(process.env.HERDR_PANE_ID)) {
    return false;
  }
  try {
    run(["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function createHerdrSurface(name: string): string {
  if (!isHerdrAvailable()) {
    throw new Error("Herdr requires a managed pane, socket, and available herdr CLI.");
  }
  const parent = request(["pane", "get", process.env.HERDR_PANE_ID!]).pane;
  if (!validId(parent?.workspace_id)) {
    throw new Error("Herdr parent pane response has no valid workspace ID.");
  }
  const created = request([
    "tab", "create", "--workspace", parent.workspace_id,
    "--label", name, "--cwd", process.cwd(), "--no-focus",
  ]);
  if (!validId(created.root_pane?.pane_id)) {
    throw new Error("Herdr tab creation response has no valid root pane ID.");
  }
  return `herdr:${created.root_pane.pane_id}`;
}

export function sendHerdrCommand(surface: string, command: string): void {
  // pane run prints nothing on success. Do not insert a `--` separator:
  // older 0.9.5 CLIs treat it as part of the command text.
  run(["pane", "run", paneId(surface), command]);
}

function readArgs(surface: string, lines: number): string[] {
  const count = Number.isFinite(lines) ? Math.max(1, Math.floor(lines)) : 50;
  return ["pane", "read", paneId(surface), "--source", "recent-unwrapped", "--lines", String(count), "--format", "text"];
}

export function readHerdrScreen(surface: string, lines = 50): string {
  return run(readArgs(surface, lines));
}

export async function readHerdrScreenAsync(surface: string, lines = 50): Promise<string> {
  const args = readArgs(surface, lines);
  try {
    const { stdout } = await execFileAsync(binary(), args, {
      encoding: "utf8", timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (error) {
    throw cliError(args, error);
  }
}

export function focusHerdrSurface(surface: string): void {
  // Agent focus validates the live occupant and selects its exact pane in one
  // server operation. A separate pane lookup + tab focus could select a sibling
  // after the requested child exits, and would not select a split child pane.
  request(["agent", "focus", paneId(surface)]);
}

export function closeHerdrSurface(surface: string): void {
  request(["pane", "close", paneId(surface)]);
}
