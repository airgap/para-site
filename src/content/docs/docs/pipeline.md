---
title: para:pipeline
description: Chained iterators that fuse adjacent kernels into one pass. Lifts to parabun:gpu when the input is large enough.
---

```ts
import pipeline from "para:pipeline";
```

`para:pipeline` is a small streaming-iterator toolkit shaped like RxJS / IxJS but specialized for typed arrays. The win is *fusion*: a chain of `para:simd` kernels (`mulScalar`, `add`, `relu`, …) collapses into a single pass at `.run()` time, so the intermediate arrays don't get allocated. If the input is large enough that GPU dispatch wins (`gpu.winsForSize(...)`), the fused chain runs as one [`parabun:gpu`](/docs/gpu/) `simdMap` instead.

## Stage operators

Each operator is a transducer — a function `Iterable → Iterable` (sync or async). Chain with `pipe` or call them positionally.

| Operator | Description |
| --- | --- |
| `map(fn)` | `(x, i) => y`. |
| `filter(fn)` | Keep when `fn(x, i)` is truthy. |
| `take(n)` / `drop(n)` | Window the iteration. |
| `takeWhile(fn)` / `dropWhile(fn)` | Window by predicate. |
| `flat()` / `flatMap(fn)` | Flatten one level / map+flatten. |
| `chunk(n)` | Non-overlapping arrays of size `n` (last group may be short). |
| `windowed(n, step?)` | Sliding window of size `n`, advancing by `step` (default 1). |
| `pairwise()` | Yields `[prev, curr]` tuples. |
| `enumerate()` | Yields `[index, value]`. |
| `scan(fn, init)` | Running fold — emits each intermediate accumulator. |
| `distinct(keyFn?)` | Drop repeats anywhere in the stream. |
| `distinctUntilChanged(eqFn?)` | Drop adjacent repeats only. |
| `tap(fn)` | Side effect; passes items through. |
| `delay(ms)` | Sleep `ms` between yields. |
| `throttle(ms)` | Emit at most once per `ms` window. |
| `debounce(ms)` | Emit only after `ms` of upstream silence. |
| `catchError(handler)` | Recover from upstream errors with a value or substitute stream. |
| `retry(times)` | Restart the source on error up to `times` times. |

## Sinks

| Sink | Description |
| --- | --- |
| `collect()` | Materialize as a plain `Array`. |
| `toFloat32Array()` / `toFloat64Array()` | Materialize as a typed array. |
| `reduce(fn, init)` | Fold. |
| `forEach(fn)` | Side-effect-only consumer. |
| `count()` | Count items. |
| `sum()` | Numeric sum (Kahan-compensated). |
| `first(pred?)` / `last(pred?)` / `find(pred)` | Selector terminals. |
| `min(keyFn?)` / `max(keyFn?)` | Extreme by numeric key. |
| `every(pred)` / `some(pred)` | Universal / existential. |
| `toMap(keyFn, valueFn?)` / `toSet` | Collect into `Map` / `Set`. |
| `groupBy(keyFn)` | `Map<K, T[]>`. |
| `partition(pred)` | `[matched[], unmatched[]]`. |

## Sources

### `range(start, end, step?)`

Lazy range generator. Useful as a chain head when you want a numeric stream without materializing.

```ts
import pipeline from "para:pipeline";

const evenSquares = pipeline.range(0, 1_000)
  .filter(x => x % 2 === 0)
  .map(x => x * x)
  .toFloat32Array();
```

### Other sources

| | |
| --- | --- |
| `of(...values)` | Wrap arguments as a one-shot iterable. |
| `from(source)` | Identity wrapper — handy in dynamic chains. |
| `empty()` | Yields nothing. |
| `concat(...sources)` | Run sources end-to-end. |
| `merge(...sources)` | Race-style interleave across async sources. |
| `zip(...sources)` | Lockstep tuples; stops at the shortest source. |
| `repeat(source, n?)` | Replay a source `n` times (default infinite). |

### Bring your own

Any iterable / async iterable works as a source — typed arrays, [`para:csv`](/docs/csv/) row streams, [`parabun:audio`](/docs/audio/) capture frames, anything.

```ts
for (const piece of pipeline.range(0, 1000).filter(x => x % 2).map(x => x * x).chunk(100)) {
  process(piece);
}
```

## `pipe(source, ...stages)`

Compose without method-chain awareness — useful when stages are passed dynamically:

```ts
import { pipe, map, filter, sum } from "para:pipeline";

const total = pipe(
  data,
  filter(x => x > 0),
  map(x => x * 2),
  sum(),
);
```

## `pipeParallel(source, ...stages)`

Same shape, but the iterable is consumed across [`para:parallel`](/docs/parallel/)'s worker pool. Each worker processes a chunk through the entire stage chain, then results are merged. Stages must be pure (same constraint as `pmap`).

## Fusion + GPU lift

When every stage in a chain is a `para:simd` kernel (the documented set: `mulScalar`, `addScalar`, `add`, `mul`, `Math.*` body via `simdMap`), the call to `.toFloat32Array()` walks the chain and emits a single `simdMap` call covering the composed function. No intermediates allocated.

If `gpu.winsForSize` returns true at the chain's input size, the fused chain runs on GPU instead of CPU SIMD — same call site, dispatched.

```ts
const ys = pipeline.range(0, 1_000_000)
  .map(x => x * 2)
  .map(x => x + 1)
  .map(x => Math.sqrt(x))
  .toFloat32Array();
// → single GPU simdMap kernel: x => Math.sqrt(x * 2 + 1)
```

## Limits

- Fusion only collapses arithmetic + `Math.*` + ternary bodies. Branchy or stateful operators (`filter`, `chunk`, anything that breaks the 1-in-1-out shape) act as fusion barriers.
- `pipeParallel` adds the worker-pool overhead — see [`para:parallel`](/docs/parallel/) for when that pays off.
- The chain executes lazily — operators don't run until a sink pulls. If you `tap(console.log)` and never call a sink, nothing prints.
