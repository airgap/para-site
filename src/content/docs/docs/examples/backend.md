---
title: Backend example
description: A WebSocket server in ParaScript with per-connection signals, an idle-timeout via a `when` block, and a server-wide reactive SSE stats endpoint. Runs on Node 18+.
---

A WebSocket server with per-connection reactive state, an idle-timeout implemented as a `when` block, and an HTTP `/stats` endpoint that streams server-wide counts as Server-Sent Events. Runs on Node 18+.

## Project layout

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

signal totalConnections = 0;
signal totalMessages = 0;

const server = createServer((req, res) => {
  if (req.url !== "/stats") return res.writeHead(404).end();

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });

  const stop = effect {
    res.write(`data: ${JSON.stringify({
      active: totalConnections,
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

  const ping = setInterval(() => lastSeen = lastSeen, 5_000);

  ws.on("message", buf => {
    messages++;
    totalMessages++;
    lastSeen = Date.now();
    ws.send(buf);
  });

  ws.on("close", () => {
    closed = true;
    clearInterval(ping);
    totalConnections--;
  });

  when idle && !closed {
    console.log(`[${id}] idle 60s, closing`);
    ws.close(1000, "idle timeout");
  }

  effect { console.log(`[${id}] msgs=${messages} idle=${idle}`); }
});

server.listen(8080, () => console.log("listening on :8080"));
```

### Notes on the source

- Module-level `signal` declarations (`totalConnections`, `totalMessages`) are server-wide state. Any tracked context that reads them recomputes when they change.
- `signal idle = (Date.now() - lastSeen) > 60_000` is a derived signal; it recomputes when `lastSeen` changes. The 5-second `setInterval` re-writes `lastSeen` to its current value to force re-evaluation, since the elapsed time depends on wall-clock state that signals don't observe directly.
- `when idle && !closed { ... }` fires once on the false→true transition. The 5-second tick that keeps re-evaluating `idle` does not re-fire the body unless the predicate transitions.
- `effect { res.write(...) }` inside the `/stats` handler creates one effect per connected client. The effect returns a stop function, which the request's `close` handler calls to detach.

## package.json

```json
{
  "name": "my-server",
  "type": "module",
  "scripts": {
    "build": "bun build src/server.pts --target node --outfile dist/server.js",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "ws": "^8",
    "parabun-browser-shims": "*"
  },
  "devDependencies": { "@types/ws": "*" }
}
```

The `bun build --target node` invocation handles `para:*` resolution by way of an esbuild-style plugin if you have one configured, or you can replace the imports in source with the explicit `parabun-browser-shims/<module>` path. Both work.

## Build and run

```bash
bun install
bun run build
node dist/server.js
```

The output is a single bundled JS file. For Lambda, upload `dist/server.js` as the handler.
