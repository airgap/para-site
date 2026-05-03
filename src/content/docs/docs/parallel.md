---
title: para:parallel
description: pmap / preduce / run over a persistent worker pool. AbortSignal, timeout, transferables, recycling, stats.
---

```ts
import parallel from "para:parallel";
```

A persistent worker pool. Functions are serialized via `fn.toString()`, so callbacks must be **pure** — no closures, no outer references, no `this`. TypedArray inputs auto-transfer their chunk-slice buffers; non-TypedArray inputs structured-clone.

## Functional API (process-wide singleton)

```ts
import { pmap, preduce, run } from "para:parallel";

const scores = await pmap(score, rows, { concurrency: 8 });
const total  = await preduce((a, b) => a + b, scores, 0);
const blob   = await run(crunch, [largeInput], { transfer: [largeInput.buffer] });
```

| Call | Shape |
| --- | --- |
| `pmap(fn, items, opts?)` | Parallel map — `(value, index) => result`, sync or async. |
| `preduce(fn, items, init, opts?)` | Parallel reduce — `(acc, value, index) => acc`. Reducer must be associative. Optional `mapFn` fuses a per-element map into the worker pass. |
| `run(fn, args?, opts?)` | One-off off-thread call: ship `fn` and the `args` array, await its result. The "do this CPU-bound thing without blocking" call. |
| `disposeWorkers()` | Tear down the singleton pool (mostly for tests / hot reload). |

## Pool API (explicit lifetime + config)

```ts
import { createPool } from "para:parallel";

await using pool = createPool({ concurrency: 8, maxTasksPerWorker: 1000 });

const out = await pool.pmap(score, rows);
const r   = await pool.run(crunch, [input]);
console.log(pool.stats()); // { workers, busy, idle, queued, waiting, completed, sequential }
```

| Config | Default | Description |
| --- | --- | --- |
| `concurrency` | `navigator.hardwareConcurrency` (or `os.availableParallelism()`) | Worker count. |
| `maxTasksPerWorker` | `Infinity` | Recycle a worker (terminate + respawn) once it has completed this many tasks. Defends against memory growth in long-lived pools. |

`pool` exposes `.pmap`, `.preduce`, `.run`, `.stats()`, `.dispose()`. `dispose()` rejects every queued and in-flight task with a "pool is disposed" error so awaiting callers don't hang.

## Per-call options

| Option | Description |
| --- | --- |
| `signal` | An `AbortSignal`. Aborting before the call: rejects immediately with `AbortError`. Aborting mid-flight: terminates the worker holding the task, replaces it with a fresh one, and rejects the call. The pool stays usable. |
| `timeout` | Milliseconds. Same forceful termination as `signal` if the worker exceeds it; rejects with `TimeoutError`. |
| `concurrency` | (`pmap` / `preduce`) Maximum slots used for this call. Capped to the pool's configured concurrency. |
| `transfer` | (`run`) `Transferable[]` to send zero-copy alongside `args`. Use when `args` includes an `ArrayBuffer` you don't need on the calling side. |

`pmap` / `preduce` already auto-transfer the chunk-slice buffer for TypedArray inputs — a 100 MB `Float32Array` splits into N transferred chunks rather than N copies.

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5000);
try {
  const out = await pool.run(longCalc, [job], { signal: ctrl.signal, timeout: 30_000 });
} catch (e) {
  if (e.name === "AbortError") /* user cancelled */;
  if (e.name === "TimeoutError") /* exceeded 30s */;
}
```

## Constraints

- **Functions must be pure.** They cross to the worker via `fn.toString()` and rehydrate with `new Function(…)`. Closures over outer scope, references to outer `this`, and impure globals don't survive the transfer.
- `preduce`'s reducer must be associative — chunks reduce in parallel and the final fold combines partials. The reducer is invoked for the final fold as `fn(acc, partial)` (no index argument), so don't depend on `i`.

## Tuning

The pool wins clearly when:

- The function body is real work (matrix ops, image kernels, parsing big strings).
- The input is large enough that per-chunk worker dispatch (~50 µs per hop) is amortized.

It loses when:

- The function is cheap arithmetic — main-thread JS is faster than crossing the worker boundary.
- Inputs aren't typed arrays — structured-clone copy of plain arrays makes the pool's overhead grow with input size.

For small payloads or trivial functions, [`para:simd`](/docs/simd/) on the main thread is almost always the right choice.

## Sequential fallback

In environments without `Worker` / `Blob` / `URL` (or where strict CSP blocks `new Function`), the pool transparently runs sequentially. `pool.stats().sequential` reports which mode you're in. `signal` and `timeout` still apply in the sequential path — the abort is observed between iterations.
