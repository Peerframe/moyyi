// Synthetic MCP stdio server for tests. Behavior is selected with MCP_FIXTURE_MODE.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.MCP_FIXTURE_MODE ?? "normal";
if (process.env.MCP_FIXTURE_PID_FILE)
  writeFileSync(process.env.MCP_FIXTURE_PID_FILE, String(process.pid));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const object = { type: "object", properties: { text: { type: "string" } } };
const page1 = [
  { name: "echo", description: "Echo text back.\u001b[31m red", inputSchema: object },
  { name: "Weird-Name.tool", description: "Odd name.", inputSchema: object },
  { name: "no_schema", description: "Not an object schema.", inputSchema: { type: "string" } },
];
const page2 = [
  { name: "fail", description: "Always reports an error.", inputSchema: object },
  { name: "slow", description: "Takes five seconds.", inputSchema: object },
  { name: "big", description: "Returns a lot of text.", inputSchema: object },
  { name: "mixed", description: "Returns several content types.", inputSchema: object },
  { name: "crash", description: "Exits the server.", inputSchema: object },
];
const cancelled = new Set();
process.stderr.write("fixture server started\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "notifications/cancelled") {
    cancelled.add(message.params.requestId);
    return;
  }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: mode === "bad-version" ? "1999-01-01" : message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      },
    });
    // A server request the client must answer without offering roots.
    send({ jsonrpc: "2.0", id: 900, method: "roots/list" });
    return;
  }
  if (message.method === "tools/list") {
    const second = message.params?.cursor === "page2";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: second ? { tools: page2 } : { tools: page1, nextCursor: "page2" },
    });
    return;
  }
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
    if (name === "echo")
      return reply({ content: [{ type: "text", text: `echo: ${args?.text ?? ""}` }] });
    if (name === "Weird-Name.tool") return reply({ content: [{ type: "text", text: "weird ok" }] });
    if (name === "fail")
      return reply({ content: [{ type: "text", text: "it broke" }], isError: true });
    if (name === "big") return reply({ content: [{ type: "text", text: "é".repeat(50_000) }] });
    if (name === "mixed")
      return reply({
        content: [
          { type: "text", text: "first" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "resource", resource: { uri: "file:///a.txt", text: "resource text" } },
          { type: "resource_link", uri: "file:///b.txt", name: "b" },
        ],
      });
    if (name === "slow") {
      setTimeout(() => {
        if (!cancelled.has(message.id)) reply({ content: [{ type: "text", text: "slow done" }] });
      }, 5000);
      return;
    }
    if (name === "crash") process.exit(3);
    return send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32602, message: "Unknown tool" },
    });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
});
