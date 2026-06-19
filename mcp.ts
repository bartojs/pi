/**
 * Minimal MCP Client Extension for pi
 *
 * Connects to a local MCP server over stdio, discovers its tools,
 * and registers them as pi tools so the LLM can call them.
 *
 * Usage:
 *   export MCP_SERVER_COMMAND="npx -y @modelcontextprotocol/server-filesystem /tmp"
 *   pi -e ./mcp-client.ts
 *
 * Or copy to ~/.pi/agent/extensions/ for auto-discovery.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

let requestId = 0;

function makeRequest(method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: ++requestId, method, params };
}

function makeNotification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

// ── MCP types ──────────────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

type McpContent = McpTextContent | McpImageContent;

interface McpCallToolResult {
  content: McpContent[];
  isError?: boolean;
}

// ── MCP Client ─────────────────────────────────────────────────────────────

class McpClient {
  private proc: ChildProcess;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private initialized = false;

  constructor(private command: string, private args: string[]) {
    const [cmd, ...cmdArgs] = command.split(" ");
    this.proc = spawn(cmd, [...cmdArgs, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString("utf8");
      this.flush();
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      // MCP servers may log to stderr; we ignore it unless debugging
      console.error("[mcp stderr]", data.toString("utf8").trimEnd());
    });

    this.proc.on("error", (err) => {
      console.error("[mcp] process error:", err);
    });
  }

  private flush() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        if ("id" in msg && msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  private send(msg: JsonRpcRequest | JsonRpcNotification) {
    const line = JSON.stringify(msg) + "\n";
    this.proc.stdin?.write(line);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const req = makeRequest(method, params);
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.send(req);
    });
  }

  async initialize() {
    if (this.initialized) return;
    const result = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-mcp-client", version: "0.1.0" },
    })) as { protocolVersion: string };

    if (result.protocolVersion !== "2024-11-05" && result.protocolVersion !== "2024-10-07") {
      throw new Error(`Unsupported MCP protocol version: ${result.protocolVersion}`);
    }

    this.send(makeNotification("notifications/initialized"));
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = (await this.request("tools/list")) as { tools?: McpTool[] };
    return result.tools ?? [];
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpCallToolResult> {
    await this.initialize();
    return (await this.request("tools/call", { name, arguments: arguments_ })) as McpCallToolResult;
  }

  stop() {
    this.proc.stdin?.end();
    if (!this.proc.killed) {
      this.proc.kill("SIGTERM");
      setTimeout(() => {
        if (!this.proc.killed) this.proc.kill("SIGKILL");
      }, 5000);
    }
  }
}

// ── Convert JSON Schema → TypeBox schema (minimal) ─────────────────────────

function schemaToTypeBox(schema: Record<string, unknown>): any {
  // Minimal conversion: we pass the raw JSON Schema shape through.
  // TypeBox's Type.Unsafe() accepts a JSON Schema object and validates it.
  return Type.Unsafe<unknown>(schema as any);
}

// ── Extension ────────────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  const cmd = process.env.MCP_SERVER_COMMAND ?? "npx -y @anthropic-ai/mcp-server-filesystem /tmp";
  const [program, ...args] = cmd.split(" ");

  const client = new McpClient(program, args);

  let mcpTools: McpTool[] = [];
  try {
    mcpTools = await client.listTools();
    console.log(`[mcp] Discovered ${mcpTools.length} tool(s)`);
  } catch (err) {
    console.error("[mcp] Failed to list tools:", err);
    client.stop();
    return;
  }

  for (const tool of mcpTools) {
    const mcpToolName = tool.name;
    const piToolName = `mcp_${mcpToolName}`;

    pi.registerTool({
      name: piToolName,
      label: `MCP: ${mcpToolName}`,
      description: tool.description ?? `MCP tool: ${mcpToolName}`,
      promptSnippet: `MCP tool ${mcpToolName}: ${tool.description ?? mcpToolName}`,
      parameters: Type.Object({
        // Pass all arguments as a single JSON object.
        // The LLM will fill it with the schema the MCP server expects.
        arguments: schemaToTypeBox(tool.inputSchema),
      }),

      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const result = await client.callTool(mcpToolName, params.arguments as Record<string, unknown>);

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled" }] };
        }

        const textParts = result.content
          .filter((c): c is McpTextContent => c.type === "text")
          .map((c) => c.text);

        const imageParts = result.content
          .filter((c): c is McpImageContent => c.type === "image")
          .map((c) => ({ type: "image" as const, source: { type: "base64" as const, mediaType: c.mimeType, data: c.data } }));

        const content = [
          ...textParts.map((t) => ({ type: "text" as const, text: t })),
          ...imageParts,
        ];

        if (result.isError) {
          throw new Error(content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n"));
        }

        return {
          content,
          details: { mcpTool: mcpToolName, raw: result },
        };
      },
    });
  }

  pi.on("session_shutdown", async () => {
    client.stop();
  });

  pi.on("session_start", async (_event, ctx) => {
    const names = mcpTools.map((t) => t.name).join(", ");
    ctx.ui.notify(`MCP connected: ${mcpTools.length} tool(s) — ${names}`, "info");
  });
}
