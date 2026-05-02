---
title: Para docs
description: Para is a set of TypeScript libraries (signals, parallel, pipeline, arena, simd, csv, arrow, rtp, mcp) plus an optional .pts syntax that compiles to JS calls into them.
---

Para is two things:

- **The libraries** — nine `@para/*` npm packages: `signals`, `parallel`, `pipeline`, `arena`, `simd`, `csv`, `arrow`, `rtp`, `mcp`. Pure JS / Wasm. Install only the ones your code uses; each works on any JS runtime.
- **The optional `.pts` syntax** — sugar over the libraries (`signal x = 0`, `effect { … }`, `~>`, `->`, `|>`, `..!`, `..&`, ranges, `pure`, `memo`, `defer`, `arena`). Compiles to standard JavaScript at parse time, which then imports from the libraries.

You can use the libraries from plain TypeScript or JavaScript without ever touching `.pts`. The syntax is there if you want fewer parens around reactive code.

## Sections

- **[Install](/docs/install/)** — install the `@para/*` packages and (if using `.pts` files) the parabun build step that compiles them.
- **Modules** — API reference for each library:
  - [`@para/signals`](/docs/signals/) — reactive cells, derived values, effects
  - [`@para/parallel`](/docs/parallel/) — `pmap` / `preduce` over a Worker pool
  - [`@para/pipeline`](/docs/pipeline/) — `|>` combinators with SIMD fusion
  - [`@para/arena`](/docs/arena/) — typed-array `Pool` + scope helper
  - [`@para/simd`](/docs/simd/) — Wasm v128 kernels
  - [`@para/csv`](/docs/csv/) — RFC 4180 streaming parser
  - [`@para/arrow`](/docs/arrow/) — in-memory tables + IPC + Parquet
  - [`@para/rtp`](/docs/rtp/) — RFC 3550 packet framing + jitter buffer
  - [`@para/mcp`](/docs/mcp/) — Model Context Protocol client
- **[Language reference](/docs/language/)** — every `.pts` extension, with the JavaScript it desugars to.
- **Examples** — three worked projects: [frontend](/docs/examples/frontend/) (DOM, Vite), [backend](/docs/examples/backend/) (Node WebSocket server), [edge](/docs/examples/edge/) (Cloudflare Workers).

## Related projects

[ParaBun](https://parabun.script.dev) is a fork of Bun that bundles Para and adds native modules for GPU compute, on-device LLM inference, V4L2 camera capture, ALSA audio, and GPIO / I²C / SPI on Linux. The libraries documented here run anywhere a JS engine runs; ParaBun is the runtime to reach for when you also need hardware.
