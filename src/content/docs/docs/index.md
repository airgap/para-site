---
title: ParaScript docs
description: Reference for ParaScript — a TypeScript dialect with reactive signals, integer ranges, a pipeline operator, edge-triggered handlers, error-chain operators, and compile-time purity.
---

ParaScript is a TypeScript dialect. Files end in `.pts`. The added syntax — signals and effects, `when` blocks, `~>` and `->` reactive bindings, `|>`, integer ranges, `..!` / `..&` / `..=`, `pure`, `memo`, `defer`, `arena` — desugars to standard JavaScript at parse time.

The desugared output imports a small npm package, `parabun-browser-shims`, which contains the runtime side of the language. There is no other ParaScript runtime layer; the output is plain JS.

## Sections

- **[Install](/docs/install/)** — set up the build pipeline. The compile step uses `bun build` today; the runtime side is the `parabun-browser-shims` package, aliased to the `para:*` specifier in your bundler.
- **[Language reference](/docs/language/)** — every extension, with the desugaring it emits.
- **Examples** — three worked projects: [frontend](/docs/examples/frontend/) (DOM, Vite), [backend](/docs/examples/backend/) (Node WebSocket server), [edge](/docs/examples/edge/) (Cloudflare Workers).
- **Modules** — API reference for each `para:*` import the language compiles into: [`signals`](/docs/signals/), [`arena`](/docs/arena/), [`parallel`](/docs/parallel/), [`pipeline`](/docs/pipeline/), [`simd`](/docs/simd/), [`arrow`](/docs/arrow/), [`csv`](/docs/csv/).

## Related projects

[Parabun](https://parabun.script.dev) is a fork of Bun that ships ParaScript natively, plus a stack of native runtime modules (GPU compute, on-device LLM inference, V4L2 camera capture, ALSA audio, GPIO/I²C/SPI). Use Parabun if you want hardware acceleration in TypeScript on a Linux SBC, NUC, or similar.

The standalone path documented here works on any host with a JavaScript engine — browsers, Lambda, Cloudflare Workers, Deno, Node 18+.
