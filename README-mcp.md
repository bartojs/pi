# Minimal pi MCP Client Extension

Connects pi to any local MCP (Model Context Protocol) server over stdio, discovers its tools, and registers them as pi tools so the LLM can call them.

## Files

- `mcp.ts` — the pi extension
- `mcp-server-example.js` — a minimal MCP server for testing

## Quick Test

```bash
# 1. Start the extension with the example server
export MCP_SERVER_COMMAND="node mcp-server-example.js"
pi -e ./mcp.ts

# 2. In pi, ask the LLM to use the MCP tools:
"Use the hello MCP tool to greet Alice"
"Add 3 and 5 using the add MCP tool"
```

## Using a Real MCP Server

```bash
# Example: filesystem server via npx
export MCP_SERVER_COMMAND="npx -y @anthropic-ai/mcp-server-filesystem /tmp"
pi -e ./mcp.ts

# Example: GitHub MCP server
export MCP_SERVER_COMMAND="npx -y @anthropic-ai/mcp-server-github"
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxx"
pi -e ./mcp.ts
```

## Install Globally

Copy `mcp.ts` to pi's global extensions directory so it's auto-loaded:

```bash
mkdir -p ~/.pi/agent/extensions
cp mcp.ts ~/.pi/agent/extensions/
```

Then set `MCP_SERVER_COMMAND` in your shell profile or before starting pi.

## How It Works

1. On startup, the extension spawns the MCP server process via stdio.
2. Sends the MCP `initialize` handshake and `tools/list` request.
3. For each discovered MCP tool, registers a pi tool named `mcp_<toolName>`.
4. When the LLM calls an `mcp_*` tool, the extension forwards it to the MCP server via `tools/call` and returns the result.
5. On `session_shutdown`, the MCP server process is terminated.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_SERVER_COMMAND` | Command to spawn the MCP server | `npx -y @anthropic-ai/mcp-server-filesystem /tmp` |

## Limitations

- Supports MCP servers that use **stdio** transport.
- Supports `text` and `image` content types from MCP tool results.
- MCP arguments are passed as a single JSON object (`arguments` parameter).
- No support for MCP resources or prompts (tools only).
