---
title: Examples
description: Worked ParaScript examples for the host environments people actually ship to — frontend, backend, edge.
---

Three worked examples, one per host environment people actually ship to. Each is a complete project — file layout, full source, build commands, deploy notes — not a snippet.

- **[Frontend](/docs/examples/frontend/)** — a todo list with reactive signals and edge-triggered handlers. Static output ships to any CDN.
- **[Backend](/docs/examples/backend/)** — a Node WebSocket server with per-connection signals, idle-timeout, and a reactive SSE stats endpoint.
- **[Edge](/docs/examples/edge/)** — a Cloudflare Worker with per-request signal scope and a Durable Object rate limiter using edge-triggered alerting.

All three share the same setup: `npm install parabun-browser-shims`, alias `para:*` to it in your bundler, write `.pts` files, build with `bun build`. None require Parabun the runtime.

## What's the same across all three

- **`signal x = …`** declarations, with auto-promotion to `derived()` when the RHS reads other signals.
- **`effect { … }`** blocks that re-fire when their tracked deps change.
- **`when EXPR { … }`** blocks that fire once per false→true transition (or `when not EXPR { }` for the falling edge).
- **The bare-read sugar** — `x` inside a tracked context reads `.get()`, `x = …` writes `.set(…)`, `x++` is `x.set(x.get() + 1)`.
- **`..=` await-assign** in async paths.

## What's different

| | frontend | backend | edge |
| --- | --- | --- | --- |
| host runtime | browser | Node 18+ / Bun | V8 isolate (Workers) |
| state lifetime | per-tab | per-process + per-connection | per-request + Durable Object |
| reactivity drives | DOM updates | log lines + SSE pushes | response shape + rate limit alerts |
| build target | `--target browser` | `--target node` | `--target browser` |

## Patterns worth noting

- **Per-connection / per-request signals** — declare them inside the connection or request callback, let them go out of scope when the unit ends. No manual cleanup of subscriptions.
- **Effects double as cleanup binders** — `effect()` returns a stop function (`const stop = effect { … }; req.on("close", stop)` in the SSE example).
- **Edge-triggered handlers replace previous-value tracking** — the "first time we crossed this threshold" pattern that you'd otherwise hand-roll with `let wasFoo = false; if (foo && !wasFoo) { … } wasFoo = foo;` becomes `when foo { … }`.
- **Auto-promoted derived signals** — `signal y = x * 2` becomes a `derived()` whenever the RHS reads tracked state. Lazy, dedup'd, no manual recompute calls.

## What ParaScript intentionally doesn't give you

- **A virtual DOM, JSX runtime, or component model.** ParaScript is a language extension, not a UI framework. Pair it with vanilla DOM (the frontend example), or with Lit, Solid, or anything else that consumes signals — the `parabun-browser-shims` signals are a normal observable interface.
- **A scheduler beyond the microtask flush.** Effects run on the next microtask after a write. If you need a frame-aligned scheduler (`requestAnimationFrame`-batched), wrap the effect call.
- **A standalone transpiler binary.** Today the build step needs Bun installed (the parser is in Bun's source). An npm-installable `@parascript/transpile` package is on the roadmap.
