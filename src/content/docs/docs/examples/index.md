---
title: Examples
description: Worked Para projects across host environments and use cases — frontend, backend, edge, IoT, voice, data engineering, vision.
---

Each example is a complete project with file layout, source, build commands, and run notes. Pick one near your problem shape; every page links to the relevant module docs at the bottom.

## By host environment

- **[Frontend](/docs/examples/frontend/)** — todo list with reactive DOM updates. Vite + vanilla DOM. Output is static.
- **[Live dashboard](/docs/examples/live-dashboard/)** — fullstack sync in SvelteKit: keyed channels, a live typed query, an optimistic `mutate`, and a polled server aggregate, through `para-kit`'s emit + SSE loop.
- **[Backend](/docs/examples/backend/)** — WebSocket server with per-connection signals and an SSE stats endpoint. Node 18+.
- **[Edge](/docs/examples/edge/)** — Durable Object rate limiter with `when` blocks for once-per-window alerts. Cloudflare Workers.

## IoT and hardware

- **[Multi-plant auto waterer](/docs/examples/iot-waterer/)** — moisture sensors + pumps + tank-level sensor with `when`-block edge alerts. Real ADS1115 + Pi GPIO, plus a simulator that runs on any host.
- **[GPIO state over HTTP + SSE](/docs/examples/iot-http-state/)** — button + LED exposed as a live web surface. One `effect { }` block writes the LED AND broadcasts to every SSE client.

## Voice and ML

- **[Voice assistant](/docs/examples/voice-assistant/)** — wake-word → STT → LLM → TTS → speaker, with one grammar-constrained tool that flips a real GPIO LED. ~35 lines.
- **[Voice assistant + MCP](/docs/examples/voice-assistant-mcp/)** — same loop, bridged to a real MCP server (Context7 for live library docs, plus the official memory server for persistent recall). One `mcp.connect()` flattens every tool into the bot.
- **[Smart camera](/docs/examples/camera-motion/)** — V4L2 capture → motion detector → save a JPEG snapshot whenever motion fires. Three Parabun modules glued by an async iterator.

## Data engineering

- **[Streaming ETL](/docs/examples/streaming-etl/)** — 10M-element `|>` pipeline with SIMD primitives. ~5-6× over `.map().reduce()`. Cross-runtime.
- **[Parquet ETL](/docs/examples/parquet-etl/)** — synthesize 50K events, write Parquet with bloom filters, demonstrate row-group skip on targeted queries. Cross-runtime.

## Setup

```bash
# Install the @lyku/para-* packages your code uses, e.g.:
npm install @lyku/para-signals @lyku/para-parallel @lyku/para-arrow

# .pts / .pjs files compile with parabun build:
parabun build src/main.pts --outfile dist/main.js
```

Compiled output is standard JavaScript with `import "@lyku/para-foo"` statements — bundlers resolve those through `node_modules` with no additional config.

## Build targets

| Project | `parabun build` target | Runner |
| --- | --- | --- |
| Frontend / browser | `--target browser` | Vite, esbuild, etc. |
| Backend / Node | `--target node` | `node dist/...` |
| Edge / Workers | `--target browser` | Wrangler |
| IoT / voice / vision | (Parabun-only) | `parabun src/...` |
| Data ETL | any target | any host |
