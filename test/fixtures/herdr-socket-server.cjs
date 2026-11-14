// Isolated socket peer for testing the real Herdr CLI, never a user's server.
const net = require("node:net");
const fs = require("node:fs");
const [socketPath, logPath] = process.argv.slice(2);
const pane = (pane_id, tab_id) => ({ pane_id, tab_id, workspace_id: "w7", terminal_id: "test-terminal", focused: false, agent_status: "idle", revision: 1 });
const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      fs.appendFileSync(logPath, JSON.stringify(request) + "\n");
      let result;
      switch (request.method) {
        case "ping": result = { type: "pong", version: "0.9.5", protocol: 22, capabilities: null }; break;
        case "pane.get": result = { type: "pane_info", pane: pane("w7:p1", "w7:t1") }; break;
        case "tab.create": result = { type: "tab_created", tab: { tab_id: "w7:t9", workspace_id: "w7", number: 9, label: request.params.label, focused: false, pane_count: 1, agent_status: "idle" }, root_pane: pane("w7:p9", "w7:t9") }; break;
        case "pane.read": result = { type: "pane_read", read: { pane_id: "w7:p9", source: "recent-unwrapped", text: "literal $HOME\n__SUBAGENT_DONE_0__\n" } }; break;
        case "pane.send_input": result = { type: "ok" }; break;
        case "agent.focus": result = { type: "pane_focused", pane_id: "w7:p9", workspace_id: "w7" }; break;
        case "pane.close": result = { type: "pane_closed", pane_id: "w7:p9", workspace_id: "w7" }; break;
        default: socket.end(JSON.stringify({ id: request.id, error: { code: "method_not_found", message: request.method } }) + "\n"); continue;
      }
      socket.end(JSON.stringify({ id: request.id, result }) + "\n");
    }
  });
});
server.listen(socketPath, () => process.send("ready"));
process.on("disconnect", () => server.close());
