#!/usr/bin/env node
/**
 * Minimal MCP server example for testing the mcp-client.ts extension.
 * Implements the MCP protocol over stdio with one simple tool: "hello".
 *
 * Run directly:
 *   node mcp-server-example.js
 *
 * Or via the extension:
 *   export MCP_SERVER_COMMAND="node mcp-server-example.js"
 *   pi -e ./mcp-client.ts
 */

let buffer = "";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

process.stdin.on("data", (data) => {
  buffer += data.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      if (req.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "hello-mcp-server", version: "0.1.0" },
          },
        });
      } else if (req.method === "notifications/initialized") {
        // no-op
      } else if (req.method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            tools: [
              {
                name: "hello",
                description: "Greet someone by name",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Name to greet" },
                  },
                  required: ["name"],
                },
              },
              {
                name: "add",
                description: "Add two numbers",
                inputSchema: {
                  type: "object",
                  properties: {
                    a: { type: "number", description: "First number" },
                    b: { type: "number", description: "Second number" },
                  },
                  required: ["a", "b"],
                },
              },
            ],
          },
        });
      } else if (req.method === "tools/call") {
        const { name, arguments: args } = req.params;
        let result;
        if (name === "hello") {
          result = { content: [{ type: "text", text: `Hello, ${args.name}!` }] };
        } else if (name === "add") {
          result = { content: [{ type: "text", text: String(args.a + args.b) }] };
        } else {
          result = { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
        }
        send({ jsonrpc: "2.0", id: req.id, result });
      }
    } catch {
      // ignore
    }
  }
});
