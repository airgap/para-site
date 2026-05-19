---
title: "@lyku/para-sort"
description: Typed-array sort with automatic serial / parallel / GPU tier dispatch, plus a stable argsort. Numeric specialization — not a generic comparator sort.
---

```ts
import sort from "@lyku/para-sort";
```

Typed-array sort whose entire point is numeric specialization — this is **not** a generic comparator sort (that's what `.sort()` is for, and why it's slow). It dispatches by size and input shape across tiers, and you can hard-pin a tier for benchmarks.

```ts
const out = sort.f32(arr);          // new sorted Float32Array (input untouched)
const idx = sort.argF32(scores);    // Uint32Array of indices — sort {id,score} by gathering this
const big = await sort.u32Async(huge, { backend: "parallel" });
```

## Tiers

1. **serial** — LSD radix. Synchronous, deterministic, beats `TypedArray.prototype.sort()` above a measured per-kind crossover. Always available.
2. **parallel** — delegates to [`@para/parallel`](/docs/parallel/) `psort` (tuned SAB histogram+scatter radix across a worker pool). Resolvable only on the ParaBun runtime. **Async only** (`*.f32Async`) — a worker pool can't be synchronous, and forcing the whole API async would make every tiny serial sort `await`.
3. **gpu** — Phase 2. `backend:"gpu"` throws today.

## API

| | |
| --- | --- |
| `sort.f32 / u32 / i32` | Sync value sort → a new sorted typed array. |
| `sort.f32Async / u32Async / i32Async` | Same; the auto tier may use native parallel. |
| `sort.argF32 / argU32 / argI32` | Stable argsort → `Uint32Array` of indices. The real-world form: sort objects by a field = argsort the field, then gather. |
| `sort.describe()` / `sort.describe(arr)` | Active tier + thresholds / per-input recommendation. |

### Options

| Option | Meaning |
| --- | --- |
| `backend: "serial" \| "parallel" \| "gpu"` | Hard-pin; errors if unavailable. `"parallel"` is async-only; `"gpu"` always throws in v0. |
| `prefer` | Try a tier, fall back silently. |
| `workers` | Worker count for the parallel tier. |
| `minParallel` | Override the serial→parallel size threshold while staying auto. |
| `stable` | Argsort stability hint. LSD radix is always stable — accepted as a no-op. |

## Thresholds (measured, not guessed)

Below a per-kind floor, the C++ engine sort beats radix (histogram/scatter setup + ping-pong allocations don't amortize):

| kind | radix floor | at/above the floor |
| --- | --- | --- |
| `f32` | 8192 (the float→sortable-key transform adds 2 passes, so its crossover is higher than ints) | ~1.3× at 10K → ~4× at 5M |
| `u32` / `i32` | 4096 | ~2–2.8× |

Below the floor `sort.*` returns the engine sort (value) / a stable comparator index sort (argsort). f32 `NaN` sorts to the end; `-0`/`+0` relative order is unspecified. The returned array is always a fresh copy (non-mutating).

## Status

`private:true / 0.0.0-dev` — pending the workspace split. See [parabun.script.dev](https://parabun.script.dev) for the runtime-bundled story today.
