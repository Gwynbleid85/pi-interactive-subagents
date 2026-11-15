/** Newline-delimited JSON-RPC for Core; also a bounded sync-call helper. */
const { createConnection } = require("node:net");
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 5000;

function request(endpoint, method, params, options = {}) {
  return new Promise((resolve, reject) => {
    let socket;
    let bytes = 0;
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      error ? reject(error) : resolve(value);
    };
    // An absolute deadline, not a socket idle timeout: a trickling server
    // must not keep Pi blocked indefinitely.
    const timer = setTimeout(() => finish(new Error(`Herdr Core ${method} timed out`)), options.timeoutMs ?? TIMEOUT_MS);
    try { socket = createConnection(endpoint); }
    catch (error) { finish(error); return; }
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n"));
    socket.on("error", error => finish(error));
    socket.on("close", () => finish(new Error(`Herdr Core ${method}: connection closed before response`)));
    socket.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) return finish(new Error("Herdr Core response exceeds size limit"));
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response || response.jsonrpc !== "2.0" || response.id !== 1 ||
            (!Object.hasOwn(response, "result") && !response.error)) {
          throw new Error("Invalid Herdr Core JSON-RPC response or id");
        }
        if (response.error) {
          const error = new Error(`Herdr Core ${method}: ${response.error.message || "request failed"}${response.error.data?.hint ? ` (${response.error.data.hint})` : ""}`);
          error.kind = response.error.data?.kind;
          error.code = response.error.code;
          return finish(error);
        }
        finish(null, response.result);
      } catch (error) { finish(error); }
    });
  });
}
exports.request = request;
exports.MAX_BYTES = MAX_BYTES;
exports.TIMEOUT_MS = TIMEOUT_MS;

if (require.main === module) {
  // stdin avoids shell interpolation and command-line size limits.
  const input = require("node:fs").readFileSync(0, "utf8");
  const { endpoint, method, params } = JSON.parse(input);
  request(endpoint, method, params).then(
    result => process.stdout.write(JSON.stringify({ ok: true, result })),
    error => process.stdout.write(JSON.stringify({ ok: false, error: { message: error.message, kind: error.kind, code: error.code } })),
  );
}
