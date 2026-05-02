---
title: Examples
description: Three worked Para projects, one per host environment — frontend (DOM), backend (Node), edge (Cloudflare Workers).
---

Three worked projects. Each is a complete project: file layout, source, build commands, deploy notes.

- **[Frontend](/docs/examples/frontend/)** — todo list with reactive DOM updates. Vite + vanilla DOM. Output is static.
- **[Backend](/docs/examples/backend/)** — WebSocket server with per-connection signals and an SSE stats endpoint. Node 18+.
- **[Edge](/docs/examples/edge/)** — HTTP handler with per-request signal scope and a Durable Object rate limiter. Cloudflare Workers.

## Common setup

All three projects use the same setup:

```bash
# Install the @para/* packages your code uses, e.g.:
npm install @para/signals @para/parallel @para/pipeline
```

…plus a one-line bundler alias mapping `para:*` to `@para/*` (see the [install guide](/docs/install/) for the per-bundler snippets), and `parabun build` to transpile `.pts` files.

## Build targets

| Project | `parabun build` target | Bundler |
| --- | --- | --- |
| Frontend | `--target browser` | Vite |
| Backend | `--target node` | (`parabun build` alone) |
| Edge | `--target browser` | Wrangler |
