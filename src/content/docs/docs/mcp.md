---
title: para:mcp
description: Model Context Protocol — client and server. Stdio + WebSocket transports. Composes with parabun:assistant's tool dispatch.
---

```ts
import mcp from "para:mcp";
```

A Model Context Protocol implementation. **Client and server**, both shapes of the spec. Two transports — stdio (subprocess over newline-delimited JSON-RPC 2.0) and ws (WebSocket text frames; client only) — plus the structural surface [`parabun:assistant`](/docs/assistant/) reuses for its `tools:` option.

## Client

### `mcp.connect(transport, target, opts?)`

Connects to a remote MCP server. Performs the `initialize` handshake, sends `notifications/initialized`, prefetches the catalogs the server advertises (`tools` / `resources` / `prompts`), and returns a connection object whose catalog arrays are populated.

```ts
// Stdio: spawn a server process, talk over its stdin/stdout
await using conn = await mcp.connect("stdio", "/path/to/server", {
  args: ["--config", "/etc/server.toml"],
  env: { ...process.env, FOO: "bar" },
});

// WebSocket: connect to a long-running daemon
await using conn = await mcp.connect("ws", "ws://hub.local:8080/mcp");
```

The connection is `AsyncDisposable` — `await using` releases the transport at scope exit. `close()` is also explicit and idempotent.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `protocolVersion` | `"2025-03-26"` | Override the spec version sent in `initialize`. |
| `clientInfo` | `{ name: "para:mcp", version: "0.1.0" }` | Client identifier sent in `initialize`. |

Stdio transport adds:

| Option | Default | Description |
| --- | --- | --- |
| `args` | `[]` | argv for the subprocess. |
| `env` | inherited | Environment for the subprocess. |
| `cwd` | inherited | Working directory. |

### Connection surface

```ts
conn.tools;             // ToolDescriptor[] — { name, description?, inputSchema }
conn.resources;         // ResourceDescriptor[] — { uri, name?, description?, mimeType? }
conn.prompts;           // PromptDescriptor[] — { name, description?, arguments? }
conn.serverInfo;        // { name, version } | null
conn.protocolVersion;   // resolved spec version
conn.serverCapabilities;// raw capabilities object from initialize

// Tools
await conn.call(name, args);            // → ToolCallResult
await conn.refreshTools();              // re-fetch catalog (auto on list_changed)

// Resources
await conn.readResource(uri);           // → ReadResourceResult
const off = await conn.subscribeResource(uri); // server pushes "updated" events
await off();                            // unsubscribe
await conn.refreshResources();

// Prompts
await conn.getPrompt(name, args);       // → GetPromptResult
await conn.refreshPrompts();

// Server-pushed notifications
const cancel = conn.on("notifications/resources/updated", ({ uri }) => {
  console.log("resource changed:", uri);
});
cancel();

await conn.close();                      // tear down transport (idempotent)
```

The catalog arrays are kept in sync automatically — when the server emits `notifications/{tools,resources,prompts}/list_changed`, the connection refetches the corresponding list before fan-out to any `on()` listeners.

`call` / `readResource` / `getPrompt` reject with an `MCPError` (with `name`, `code`, `data` fields matching the JSON-RPC error response) when the server returns an error.

## Server

### `mcp.serve(opts)`

```ts
const server = mcp.serve({ name: "weather", version: "0.1.0" });

server.tool(
  "get_temp",
  {
    description: "Current temperature for a US ZIP",
    inputSchema: {
      type: "object",
      properties: { zip: { type: "string" } },
      required: ["zip"],
    },
  },
  async ({ zip }) => ({
    content: [{ type: "text", text: `${zip}: 72°F` }],
  }),
);

server.resource(
  "weather://current",
  { name: "current", mimeType: "application/json" },
  async uri => ({
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ tempF: 72 }) }],
  }),
);

server.prompt(
  "forecast",
  {
    description: "Generate a forecast paragraph",
    arguments: [{ name: "location", required: true }],
  },
  async ({ location }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Write a forecast for ${location}` } }],
  }),
);

// Resolves when the transport closes (stdin EOF).
await server.listen("stdio");
```

The server only advertises a capability (`tools` / `resources` / `prompts`) when at least one entry is registered, so a tools-only server doesn't claim resource support. `tool()` / `resource()` / `prompt()` registered after `listen()` automatically push the corresponding `notifications/.../list_changed` event.

To push a `notifications/resources/updated` after the data behind a registered resource has changed:

```ts
server.notifyResourceUpdated("weather://current");
```

### Throwing from handlers

Throw `mcp.MCPError({ code, message, data? })` to send a specific JSON-RPC error code to the client. Any other throw is wrapped as `-32603 (Internal error)` with the error's message string.

## Composing with `parabun:assistant`

The connection object is structurally compatible with `parabun:assistant`'s `tools:` option — the assistant flattens every tool the connection exposes into its own catalog and routes calls back through `conn.call`.

```ts
import assistant from "parabun:assistant";

await using conn = await mcp.connect("stdio", "home-assistant-mcp");
await using bot = await assistant.create({
  llm: "/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  stt: "/models/ggml-tiny.en.bin",
  tts: "/models/en_US-lessac-medium.onnx",
  tools: [conn],
});
await bot.run();
```

You can mix MCP connections with inline `{ name, schema, run }` tools in the same `tools:` array — the assistant flattens both into a single catalog.

## Limits

- HTTP / SSE transports aren't shipped. The stdio + WebSocket pair covers the common deployment shapes.
- Sampling (server-initiated `sampling/createMessage`) and Completions (`completion/complete`) are not implemented.
- WebSocket transport is client-only and assumes text frames carrying one JSON-RPC message each. Binary frames are silently dropped.
