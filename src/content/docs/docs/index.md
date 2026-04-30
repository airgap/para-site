---
title: ParaScript docs
description: A portable JavaScript dialect — reactive signals, edge-triggered handlers, ranges, pipelines, purity. Compile with bun build, run anywhere V8/JSC runs.
---

ParaScript is a TypeScript dialect that adds the things JavaScript still doesn't have built in: fine-grained reactivity, edge-triggered handlers, integer ranges, a pipeline operator, error-chain operators, and compile-time purity. Files end in `.pts`. Every extension desugars to standard JavaScript at parse time — there is no ParaScript runtime layer beyond the small modules the desugarings call into (`para:signals`, `para:arena`, `para:pipeline`, etc.), and those ship as plain JS too.

That means a ParaScript file is portable. Compile with `bun build`, alias `para:*` in your bundler to [`parabun-browser-shims`](https://www.npmjs.com/package/parabun-browser-shims), and the result runs in a browser, on a Lambda, on Cloudflare Workers, on Deno, or on Node — anywhere a JavaScript engine runs.

## What you write

```pts
signal count = 0;
signal doubled = count * 2;          // derived — re-runs when count changes

effect { console.log(doubled); }     // logs every change

when count >= 10 {                   // edge-triggered: fires once per 0→1 of the predicate
  alert("ten!");
}

count++;                             // bare-read sugar: count.set(count.get() + 1)
```

Three other shapes worth seeing on the way in:

```pts
// Pipelines collapse a typed-array map chain into a single SIMD pass
const out = pixels |> map(p => p * 1.2) |> map(p => Math.min(255, p));

// Ranges
for (const i of 0..n) doSomething(i);
const evens = 0..=20 |> filter(i => i % 2 === 0);

// Error chains without nested .then()
const data = await fetch(url).then(r => r.json()) ..! err => fallback;
```

## What it compiles to

Standard JavaScript with a handful of import calls into the runtime modules listed in the sidebar:

```js
const __s = require("para:signals");
const count = __s.signal(0);
const doubled = __s.derived(() => count.get() * 2);
__s.effect(() => { console.log(doubled.get()); });
__s.onRising(() => count.get() >= 10, () => { alert("ten!"); });
count.set(count.get() + 1);
```

No magic, no virtual DOM, no compiler runtime. The `para:*` modules are small, normal JS — see [`para:signals`](/docs/signals/) for the entire reactive engine.

## Sidebar

- **Guides** — [Install](/docs/install/) + the build recipes for browser / Lambda / Workers / Node, and the full [Language reference](/docs/language/).
- **Examples** — three complete worked projects, one per host: [Frontend (DOM)](/docs/examples/frontend/), [Backend (Node)](/docs/examples/backend/), [Edge (Workers)](/docs/examples/edge/). Full file layouts, build commands, deploy notes — none require Parabun the runtime.
- **Modules** — every `para:*` module that ParaScript desugars into. These are the runtime pieces you ship with your app.
- **Hardware (Parabun runtime)** — for the Bun-fork runtime that bundles GPU compute, on-device LLM inference, V4L2 capture, GPIO/I²C/SPI, and the rest, see [parabun.script.dev](https://parabun.script.dev/docs/).

## Two ways to run it

1. **Use Parabun.** Drop a `.pts` file in your project; Parabun's parser handles the rest, and every `para:*` import resolves to a built-in module. Use this on the server side or anywhere you control the runtime — see [parabun.script.dev](https://parabun.script.dev) for the all-batteries pitch.
2. **Use ParaScript anywhere else.** Compile with `bun build foo.pts`, then point your bundler at `parabun-browser-shims` for the `para:*` resolutions. The output is plain JS — ship it to a browser, an edge function, a Lambda, or any Node runtime. The [Install guide](/docs/install/) walks the recipes.

A standalone npm-installable transpiler (so users without Bun can build `.pts` files) is in progress; until then, `bun build` is the recommended path and works on every host that can install Bun for the build step.

## Other reading

- [LLMs.md](https://github.com/airgap/parabun/blob/main/LLMs.md) — full grammar + architecture document, kept in sync with the parser.
- [GitHub](https://github.com/airgap/parabun) — source, issues, releases.
