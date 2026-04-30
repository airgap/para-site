---
title: Backend — reactive state on a plain Node server
description: A worked ParaScript example — WebSocket server with per-connection signals, edge-triggered idle timeout, and a reactive counter endpoint. Runs on plain Node, Bun, or Deno.
---

A WebSocket server where every connection has its own reactive state. Each socket gets a `messages` count and a `lastSeen` timestamp; an idle-timeout fires once per false→true transition of the predicate; an HTTP `/stats` endpoint streams server-wide counts via a derived signal.

## What you build

- A WebSocket endpoint at `ws://localhost:8080/ws` that echoes messages and tracks per-connection activity.
- An HTTP endpoint at `http://localhost:8080/stats` that returns server-wide live counts as Server-Sent Events.
- Edge-triggered idle disconnect (60s) per connection.
- An `effect { }` per connection that logs state changes — fires only when something actually changed, never on no-op writes.

## File layout

```
my-server/
├── src/server.pts
├── package.json
└── tsconfig.json
```

## src/server.pts

```pts
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

// Server-wide state
signal totalConnections = 0;
signal totalMessages = 0;
signal active = totalConnections;          // alias — derived from itself, just for the example

const server = createServer((req, res) => {
  if (req.url !== "/stats") return res.writeHead(404).end();

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });

  // Stream live updates as SSE. The `effect` tracks every signal it reads;
  // when any change, it re-runs and pushes a new SSE frame.
  const stop = effect {
    res.write(`data: ${JSON.stringify({
      active: active,
      total: totalConnections,
      messages: totalMessages,
    })}\n\n`);
  };

  req.on("close", () => stop());
});

const wss = new WebSocketServer({ server, path: "/ws" });

let nextId = 1;
wss.on("connection", (ws: WebSocket) => {
  const id = nextId++;
  totalConnections++;

  signal messages = 0;
  signal lastSeen = Date.now();
  signal idle = (Date.now() - lastSeen) > 60_000;
  signal closed = false;

  // Heartbeat tick — every 5s, re-write `lastSeen` so `idle` recomputes.
  // (No-op writes still trigger derived recomputation; the effect below
  // only fires when a *value* it reads actually changed.)
  const ping = setInterval(() => lastSeen = lastSeen, 5_000);

  ws.on("message", buf => {
    messages++;
    totalMessages++;
    lastSeen = Date.now();
    ws.send(buf);                // echo
  });

  ws.on("close", () => {
    closed = true;
    clearInterval(ping);
    totalConnections--;
  });

  // Edge-triggered: fires once per false→true of `idle`. Even though the
  // ping tick re-writes lastSeen every 5s, this only fires the FIRST time
  // it crosses the threshold.
  when idle && !closed {
    console.log(`[${id}] idle 60s, closing`);
    ws.close(1000, "idle timeout");
  }

  // Per-connection log line — re-fires only when one of the read values
  // genuinely changed. The microtask flush dedupes coalesced writes.
  effect { console.log(`[${id}] msgs=${messages} idle=${idle}`); }
});

server.listen(8080, () => console.log("listening on :8080"));
```

## package.json

```json
{
  "name": "my-server",
  "type": "module",
  "scripts": {
    "build": "bun build src/server.pts --target node --outfile dist/server.js",
    "start": "node dist/server.js",
    "dev": "bun build src/server.pts --watch --target node --outfile dist/server.js & nodemon dist/server.js"
  },
  "dependencies": {
    "ws": "^8",
    "parabun-browser-shims": "*"
  },
  "devDependencies": { "@types/ws": "*", "nodemon": "^3" }
}
```

For Node, the bundler alias is in your bundler step (esbuild, tsup, etc.) instead of Vite. With `bun build`, you can pre-resolve `para:*` by pointing imports at the shim package directly:

```ts
// In src/server.pts, swap:
//   import { signal } from "para:signals";    →    import { signal } from "parabun-browser-shims/signals";
// …or add a tiny resolver plugin to bun build. Both work.
```

## What's happening

- **Server-wide signals (`totalConnections`, `totalMessages`)** — module-level reactive state. Any tracked context that reads them gets re-evaluated on change.
- **Per-connection signals** — `messages`, `lastSeen`, `idle`, `closed` are scoped to the connection callback. They go out of scope (and are GC'd) when the socket closes.
- **`signal idle = (Date.now() - lastSeen) > 60_000`** — auto-promotes to a derived signal because the RHS reads `lastSeen`. The 5s ping tick re-writes `lastSeen` (even with the same value), which triggers a `derived` recompute and lets the `when idle` block re-evaluate.
- **`when idle && !closed { ... }`** — fires *once* per false→true transition of the predicate. Without this, you'd be tracking previous values by hand: `let wasIdle = false; if (idle && !wasIdle) { ... } wasIdle = idle;`.
- **`effect { res.write(...) }` inside the SSE handler** — when any of `active`, `totalConnections`, or `totalMessages` change, the effect fires and pushes a fresh SSE frame to that client. Each connected `/stats` client has its own `effect`, so disconnect cleanup is per-client (`stop()` on close).

## Without ParaScript

The reactive HTTP and WebSocket pattern in plain Node usually means either:

1. **Polling**: a `setInterval` that re-reads state and pushes if changed. You write change detection yourself.
2. **Event emitters**: `events.EventEmitter` per-resource, manual subscribe/unsubscribe in the request handler, manual `removeListener` on close. Verbose; easy to leak listeners.
3. **A reactive library**: RxJS, MobX, etc. Same downsides as the frontend story — boilerplate, no edge-detection primitive, no concise inline syntax.

The ParaScript version reads top-to-bottom: declare state, write the side-effect inline, the runtime handles tracking and dedup.

## Build &amp; ship

```bash
bun install
bun run build              # → dist/server.js (single bundled file)
node dist/server.js        # plain Node, no Bun runtime needed
```

For Lambda: same `bun build --target node` → upload the `dist/server.js` as the handler. The shim package gets bundled in. Works on Node 18+ (no syntax ES2022+ used).
