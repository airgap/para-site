---
title: Para docs
description: Para is two products. Lang is parse-time TypeScript syntax for pipelines, schemas, signals, and purity. Runtime (ParaBun) is a Bun fork with native modules for AI and device I/O. Neither requires the other.
---

Para is two independent products:

- **Lang** — parse-time TypeScript syntax. Purity (`pure`), error chains (`..>` / `..!` / `..&`), pipelines (`|>`), ranges (`a..b` / `a..=b`), reactive signals (`signal` / `derived` / `effect` / `when`), JSON Schema data shapes (`schema`), pattern matching (`match`), decimal literals (`0.1d`). Lowers to standard JavaScript at parse time — runs anywhere Node, Bun, Deno, or browsers run. Files end in `.pts` / `.ptsx` (or `.pjs` / `.pjsx` over plain JS).
- **Runtime (ParaBun)** — a fork of Bun with native modules linked into the binary: `parabun:llm` (CUDA / Metal inference), `parabun:speech` (Whisper STT + Piper TTS), `parabun:vision`, `parabun:gpu`, `parabun:camera`, `parabun:audio`, `parabun:gpio` / `i2c` / `spi`. Built for using one machine's hardware fully — single-node multi-GPU is in scope; distributed is not.

Neither requires the other. Lang compiles to JS that runs on stock Bun / Node / Deno; Runtime runs vanilla `.ts` / `.js` without any Para syntax. Pick one, both, or neither — they share a name because the design decisions reinforce each other, not because they depend on each other.

Try Lang in the browser at the **[Playground](/playground/)** — no install needed.

## Sections

- **[Install (Lang)](/docs/install-libs/)** — compile `.pts` to JS plus the `@lyku/para-*` runtime packages (cross-runtime: Node / Bun / Deno / browsers).
- **[Install (Runtime)](/docs/install-runtime/)** — single-script install for ParaBun on Linux / macOS.
- **[Language reference](/docs/language/)** — every Lang extension with the JavaScript it desugars to.
- **[Architecture](/docs/architecture/)** — how `@lyku/para-*` (cross-runtime npm) and `parabun:*` (native Runtime) split, with the full module index.
- **Modules** — API references in the sidebar. Cross-runtime: `@lyku/para-schema` · `signals` · `sync` · `kit` · `parallel` · `arena` · `lifecycle` · `simd` · `csv` · `arrow` · `rtp` · `mcp`. Runtime-only: `parabun:llm` · `speech` · `vision` · `image` · `video` · `audio` · `camera` · `gpu` · `gpio` · `i2c` · `spi` · `assistant`. Plus `@lyku/para-pipeline` and `@lyku/para-decimal` which back Lang's `|>` operator and `Nd`-literal features.
- **Examples** — worked projects across [frontend](/docs/examples/frontend/), [backend](/docs/examples/backend/), [edge](/docs/examples/edge/), [IoT](/docs/examples/iot-waterer/), [voice assistants](/docs/examples/voice-assistant/), and more.
