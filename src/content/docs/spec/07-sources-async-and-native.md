---
title: "Sources, Async Data & Native/AI Integration"
description: "The 'value changing over time driven by the outside world' pillar: the source convention (peek/subscribe/dispose), source/async signal/using…"
sidebar:
  order: 8
---

# Chapter: Sources, Async Data & Native/AI Integration

&gt; **Status of this chapter:** Mixed. The *source convention* (`peek`/`subscribe`/`dispose`), the `source NAME = EXPR`, `async signal NAME = EXPR`, and `using NAME = EXPR` declaration forms, `promiseSignal`, the `from*` adapters (`fromAsyncIter`/`fromStream`/`fromEventTarget`/`fromStore`), the `throttled`/`debounced` rate-limiters, `proxySignal`, the `resource()`/`onDispose` handle, the `SourceHandle<T>` interface, and the `audioMeter` native-adapter pattern are all **Shipped** (in `@lyku/para-signals` / `@lyku/para-ui-native` / `para-preprocess` today). The 13 `parabun:*` native modules are **Shipped** runtime builtins; their *reactive surfacing through `source`* is **Shipped**, their *typed/constrained* surfacing is **Proposed** (§10.5). Everything in *Proposed Extensions* (§10) is **Proposed** (net-new surface, not in `language-surface.ts` today).
&gt; **Cross-refs:** This chapter owns binding **external / async / native** producers into reactive cells via the source convention. The in-process reactive graph (`signal`/`derived`/`effect`, `WritableSignal`/`DerivedSignal`/`Effect`, drain) is [→ ch:reactivity-core] — a `source` is read with the *same* bare-value semantics a `signal` is. The `resource()`/`onDispose`/`alive`/`arena` lifecycle and `defer` are [→ ch:effects-lifecycle-concurrency]; this chapter cites `resource()` because every `from*`/rate-limiter is built on it, but its scope semantics are defined there. The `.pui` runes *bridge* (`$state` + `$effect.pre` + `onDestroy`) that all source declarations lower through is [→ ch:pui-component-model §`prop`/bridge]; this chapter shows the bridge because the source forms *are* the bridge's reason to exist. Server-replicated state (`sync`/`synced`, the reconciler) is [→ ch:data-sync-and-authority] — it is **also** a source (a value changing over a trust boundary) but adds a `(schema_version, sequence)` reconcile machine, so it has its own chapter. Schema validation of payloads (`::`, `is`, `Schema.parse`) is [→ ch:type-and-schema-system] and [→ ch:errors-results-and-validation]; this chapter *uses* the parse gate to type AI/native outputs (§10.1–10.2) but does not define it. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. The outside-world pillar

A `schema` describes the shape of a value *at rest*; a `signal` describes that value *changing over time within one process*; **a source describes that value changing over time driven by the outside world** — a sensor, a model, a stream, a socket, the network [→ ch:overview-and-surfaces §0]. The source is the fourth distance of the one reactive idea: it shares the **downstream convention** of the family (a reactive value is read, written-by-the-world, and observed) but its *producer* is outside the in-process graph, so it carries an explicit **lifecycle** the in-process graph does not need — it must be *disposed*, because it owns an OS handle, a socket, a model context, or a pump loop.

The unifying contract is three methods:

```
SourceHandle<T>  ::=  { peek(): T;  subscribe(cb: (v: T) => void): () => void;  dispose(): void }
```

— `peek()` reads the current value without subscribing; `subscribe(cb)` registers an observer and returns an unsubscribe; `dispose()` releases the producer. This is **exactly** the surface a para `Signal<T>` already exposes for `peek`/`subscribe` (with `dispose` a no-op), which is why a bare signal, a wrapped microphone, and an LLM token stream are *the same thing* to component code: each lowers into a `$state` cell driven by `subscribe`, torn down by `dispose` on unmount.

This chapter specifies the four **declaration forms** that bind a source into a component (`source`, `async signal`, `using`, and — by cross-reference — `sync`/`synced`), the **runtime producers** that satisfy the convention (`promiseSignal`, the `from*` adapters, `throttled`/`debounced`, `proxySignal`, `resource()`), the **native adapter pattern** (`audioMeter` and its non-blocking-init / race-safe-dispose discipline), and the **`parabun:*` native module family** surfaced through `source`. Two invariants frame it:

- **INV-src-1 (lifecycle totality).** Every source bound by a declaration form has a teardown that runs **exactly once** on the owning scope's unmount (`onDestroy` in `.pui`; the enclosing `resource()`/`arena` in `.pts`). A source whose producer is started but never disposed is the one resource leak the surface is designed to make impossible — the declaration *owns* the dispose. Idempotent disposal (calling `dispose()` twice is a no-op) is required of every conforming handle.
- **INV-src-2 (read-only view).** `source`, `async signal`, `using`, and `sync`/`synced` bind a **read-only** reactive view of an external producer. Unlike `signal`, there is *deliberately no assignment rewrite* — `NAME = X` is not lowered to a `.set` (the world writes the cell, not the component). Writing *to* the world is a method call on the handle or, for sync, the (separate) write path [→ ch:data-sync-and-authority]. This is what distinguishes the over-time-shape (`signal`, writable) from the outside-world-shape (`source`, observed).

&gt; **Glass floor (I1).** Every form below lowers to plain calls into `@lyku/para-signals` / `@lyku/para-sync` plus the readable `$state` + `$effect.pre` + `onDestroy` runes bridge (`.pui`) or the `resource()`/`from*` constructor (`.pts`). Nothing is reflection-driven or `any`-degraded; a developer can read the emitted `const __src_meter = audioMeter(); let meter = $state(__src_meter.peek?.() ?? __src_meter); …` and the `SourceHandle` it drives (I3).

---

## 1. The source convention (`peek` / `subscribe` / `dispose`)

### 1.1 `SourceHandle<T>` — the contract every producer satisfies

```pts
// .pts — the convention the `.pui` `source` keyword consumes (@lyku/para-ui-native)
export interface SourceHandle<T> {
  peek(): T;                                 // current snapshot, no subscription
  subscribe(cb: (v: T) => void): () => void; // observe; returns unsubscribe
  dispose(): void;                           // release the producer (idempotent)
}
```

**Static semantics.** A value is a *source* for the purpose of a declaration form iff it is structurally assignable to `SourceHandle<T>` for some `T`, OR it is a bare para `Signal<T>` (which provides `peek`/`subscribe` and tolerates a no-op `dispose`), OR it is a plain value (degenerate source — `peek` falls back to the value, `subscribe`/`dispose` are absent and optional-chained away). The declaration lowerings call **all three methods optionally-chained** (`__src.peek?.()`, `__src.subscribe?.(…)`, `__src.dispose?.()`), so the convention is *all-optional and conservative*: a handle, a bare signal, and a constant all bind without error. The element type `T` flows from the handle's `peek()` return — `Infer` is not involved (sources are not schemas; their *payload* may be schema-validated, but that is §10.1's job).

&gt; **INV-src-3 (optional-chained convention).** Because every method is invoked optional-chained, the convention is **open by structural subtyping, not by nominal `implements`**. A producer need only supply the methods it has; missing ones degrade gracefully (`dispose?.()` on a bare signal is a no-op, `peek?.() ?? handle` falls back to the handle as its own value). This is what lets one keyword (`source`) bind "any native reactive thing, handle OR bare signal OR plain value" without a discriminated union of binders.

**Dynamic semantics.** `peek()` is called **once** at bind time to seed the `$state` cell (no subscription, so the seed read does not entangle the component's render in the producer's tracking). `subscribe(cb)` is called inside `$effect.pre` so the subscription is established before first paint and its returned unsubscribe is the effect's teardown. `dispose()` is called from `onDestroy`. The three are independent: a producer may be subscribed-to by several components, each holding its own unsubscribe, while `dispose()` is the *owner's* release — which is why `source` (single owner, auto-dispose) differs from `subscribe` (multi-observer, no ownership).

### 1.2 Why the convention, not just `signal`

A `signal` is sufficient for in-process state because there is nothing to release: the graph is GC'd. A *source* owns something the GC cannot reclaim deterministically — an open ALSA stream, a `/dev/gpiochip` fd, a model's KV-cache, a `ReadableStream` reader, an `AbortController`, a `setInterval`. The convention adds exactly one method (`dispose`) over the signal surface, and the declaration forms make calling it *non-optional* (INV-src-1): you cannot bind a source without also binding its teardown. This is the surface-level discharge of the resource-leak class of bugs.

---

## 2. `source NAME = EXPR` — bind a native handle into a component cell

**Status:** Shipped (`para-preprocess` `lowerSourceDecls`, LYK-895).

The primary form. `source NAME = EXPR` evaluates `EXPR` to a producer (a `SourceHandle`, a native module handle, or a bare signal), binds its current value into a **read-only, component-reactive** `$state` cell, subscribes for updates, and auto-disposes on unmount.

### 2.1 Grammar

```
SourceDecl ::= "source" Ident TypeAnn? "=" Expr ";"?
TypeAnn    ::= ":" Type
```

**Lexical note (statement-position keyword detection).** `source` fires as a keyword only before `NAME [=:]` — i.e. `source x =` / `source x :` — mirroring the catalog pattern `\b(source)\b(?=\s+[A-Za-z_$][\w$]*\s*[=:])`. An identifier named `source` used as a value (`source.peek()`, `const source = …`, `source()`) is **not** rewritten; `source` is contextual, not reserved [→ ch:overview-and-surfaces §1.1]. The form is **`.pui`-only** (it lowers through the runes lifecycle bridge and schedules `onDestroy`); see §9 for the `.pts` equivalent (`using` + `resource()`).

### 2.2 Static semantics

`source NAME = EXPR` introduces `NAME` as a read-only reactive binding of type `T` where `T` is the element type of the producer `EXPR` (the `peek()` return, or the producer's value type if it is a bare value). The optional `: TypeAnn` annotates the `$state` cell directly (used when the producer is too dynamic for inference). **There is no assignment rewrite** (INV-src-2): a later `NAME = X` line is *not* lowered into a `.set` on the source (the lowering does not add `NAME` to `signalNames`, unlike `signal`); the world writes `NAME`, the component reads it. A component-side write to `NAME` is therefore a plain (non-reactive, and usually mistaken) `$state` reassignment — the *anti-pattern* §10.5 makes a compile error for typed actuator sources.

`source` is **independent of escape analysis** (`buildEscapeChecker`) — it is not a `signal` cell, so the `signalOf`/context/`export` escape vectors do not apply; it always emits the full subscribe bridge because an external producer *always* escapes (the world is the observer on the other side).

### 2.3 Dynamic semantics & desugar

```
# Desugar:  source NAME = EXPR
Para (.pui):
    source meter = audioMeter();
Runes (.pui):
    const __src_meter = audioMeter();
    let meter = $state(__src_meter.peek?.() ?? __src_meter);
    $effect.pre(() => __src_meter.subscribe?.((__v: typeof meter) => { meter = __v; }));
    onDestroy(() => __src_meter.dispose?.());
```

Numbered lifecycle (the order is normative):

1. **Construct.** `const __src_NAME = EXPR;` — the producer is created once, eagerly, at the declaration site. Native handles must be *non-blocking* at construction (§7) so this line never stalls render.
2. **Seed.** `let NAME = $state(__src_NAME.peek?.() ?? NAME);` — the cell is seeded synchronously from `peek()` (or the handle itself if it has no `peek`). No subscription is taken yet, so the seed does not entangle render in producer tracking.
3. **Subscribe.** `$effect.pre(() => __src_NAME.subscribe?.((__v) => { NAME = __v; }));` — runs before first paint; `subscribe`'s returned unsubscribe is the `$effect.pre` teardown (so the cross-system subscription does not leak across re-runs or unmount). Each producer notification writes the `$state` cell, which drives the DOM the normal Svelte way.
4. **Dispose.** `onDestroy(() => __src_NAME.dispose?.());` — releases the producer exactly once on unmount (INV-src-1). `onDestroy` is auto-imported from the runtime (`@lyku/para-ui` or `svelte`).

&gt; **Edge case (synchronous `peek` vs async producer).** A native module's real API is often *async* (a mic `capture()` returns a `Promise`). The producer must therefore present a **synchronous façade**: construct immediately, seed `peek()` at a sentinel (e.g. `0`, `null`, `pending`), and forward the native signal into its internal cell once the async init resolves. This is the **non-blocking init** discipline (§7); `source` never awaits.

&gt; **Edge case (`source` over a bare signal).** `source busy = llm.busy` binds a native module's *status signal* (a bare `Signal<boolean>`) into component reactivity. `Signal` has `peek`/`subscribe` and *no* `dispose`, so step 4's `dispose?.()` no-ops — correct, because a status signal owned by a long-lived module must **not** be torn down by one component's unmount. `source` is thus the single primitive for "bind any native reactive thing, handle OR bare signal" (LYK-897).

### 2.4 Example

```pui
<!-- .pui -->
<script lang="ts">
  import { audioMeter } from "@lyku/para-ui-native";
  source level = audioMeter();          // live mic peak, 0..1; auto-disposed on unmount
  source fps   = camera.frameRate;      // a native module's bare status signal
</script>

<meter min="0" max="1" value={level}></meter>
<small>{fps} fps</small>
```

```pui
<!-- ✗ counter-example -->
<script lang="ts">
  source level = audioMeter();
  // level = 0.5;   // ✗ no effect: `source` is read-only (INV-src-2); the world writes it,
  //                //   not the component. (Under §10.5 typed sources this is a compile error.)
</script>
```

---

## 3. `async signal NAME = EXPR` — promise → `{ data, error, pending }` cell

**Status:** Shipped (`para-preprocess` `lowerAsyncSignalDecls` + `promiseSignal`, LYK-891).

`async signal NAME = EXPR` lifts a promise-producing expression into a reactive **suspense cell** with three fields — `data`, `error`, `pending` — that re-renders as the promise settles and **aborts/drops the in-flight request on unmount** (no stale state, no setState-after-unmount leak).

### 3.1 Grammar

```
AsyncSignalDecl ::= "async" "signal" Ident TypeAnn? "=" Expr ";"?
```

**Lexical note.** The head is the two-token sequence `async signal` (the `async` modifier immediately before the `signal` keyword); it is distinct from the bare `signal` form [→ ch:reactivity-core §1] and from `async {` (the async-block expression [→ ch:lexical-and-expression-syntax]). Like `source`, it is **`.pui`-only** and read-only (no assignment rewrite).

### 3.2 Static semantics

`async signal NAME = EXPR` binds `NAME` to a value of shape `{ data: T | undefined, error: unknown, pending: boolean }`, where `T` is the resolved type of `EXPR` (`Awaited<typeof EXPR>`). Exactly one of `data`/`error` is populated once settled; `pending` is `true` until then. Component code reads `NAME.pending` / `NAME.data` / `NAME.error` as ordinary reactive fields (each read tracks). The cell is read-only (INV-src-2). The payload `data` is **not** schema-validated by this form — to parse-gate an async result, use the proposed `:: Schema` modifier (§10.1) or call `Schema.parse` in the component; this form owns *lifecycle*, not *validation* (boundary with [→ ch:type-and-schema-system]).

### 3.3 Dynamic semantics & desugar

```
# Desugar:  async signal NAME = EXPR
Para (.pui):
    async signal user = fetch(`/api/user/${id}`).then(r => r.json());
Runes (.pui):
    const __as_user = promiseSignal(() => (fetch(`/api/user/${id}`).then(r => r.json())));
    let user = $state(__as_user.peek?.() ?? __as_user);
    $effect.pre(() => __as_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __as_user.dispose?.());
```

The lowering is **byte-identical in shape** to `source` (§2.3) — it reuses the exact source bridge — with the producer fixed to `promiseSignal(() => (EXPR))`. `promiseSignal` is auto-imported from `@lyku/para-signals`. The thunk `() => (EXPR)` defers evaluation by one synchronous step but `promiseSignal` invokes it **synchronously** at construction (so the request fires immediately, no wasted microtask), tolerating a synchronous throw by routing it to `error`:

```pts
// @lyku/para-signals — promiseSignal (abridged; the runtime producer behind `async signal`)
export function promiseSignal(thunk) {
  const state = new WritableSignal({ data: undefined, error: undefined, pending: true });
  const ac = new AbortController();
  let disposed = false;
  let p;
  try { p = Promise.resolve(thunk(ac.signal)); } catch (error) { p = Promise.reject(error); }
  p.then(
    data  => { if (!disposed) state.set({ data, error: undefined, pending: false }); },
    error => { if (!disposed) state.set({ data: undefined, error, pending: false }); },
  );
  return {
    peek: () => state.peek(),
    subscribe: cb => state.subscribe(cb),
    dispose: () => { disposed = true; ac.abort(); },   // abort the request AND drop a late settle
  };
}
```

Numbered settle (normative ordering):

1. Construct: `pending: true`, the thunk fires synchronously, the `AbortController` is live.
2. On resolve (and `!disposed`): one `set({ data, error: undefined, pending: false })`.
3. On reject (and `!disposed`): one `set({ data: undefined, error, pending: false })`.
4. On `dispose()` (unmount): set `disposed = true` **and** `ac.abort()`. The `disposed` guard drops a settle that lands after unmount (no stale write); `abort()` cancels the underlying request *if* the thunk threaded the signal.

&gt; **Edge case (component cancel vs network cancel).** The keyword form passes `() => (EXPR)` — the thunk **ignores** the abort signal, so unmount drops the *result* (no stale state) but does not cancel the *network*. For true network cancellation, call `promiseSignal` directly and thread the signal: `source user = promiseSignal(s => fetch(url, { signal: s }))`. The keyword sugar covers the common case (component-side drop); the explicit form covers the abortable case. Both lower through the same bridge.

&gt; **Edge case (re-fire on dependency change).** `async signal user = fetch(\`/api/user/${id}\`)…` is constructed **once** at declaration; it does **not** re-fire when `id` changes, because the producer is constructed outside any effect. To refetch on `id`, wrap the source in a `derived`/keyed pattern or use the proposed `retry`/keyed-source surface (§10.3). The Shipped form is fire-once-per-mount; this is a deliberate scope boundary (re-keying is reactivity, not the source's job). The first-class re-keying form is the proposed query-derived cell, `derived NAME :: SCHEMA = EXPR` (§10.7).

### 3.4 Example

```pui
<!-- .pui -->
<script lang="ts">
  prop id: string;
  async signal user = fetch(`/api/user/${id}`).then(r => r.json() as Promise<User>);
</script>

{#if user.pending}<Spinner/>
{:else if user.error}<Error message={String(user.error)}/>
{:else}<Profile user={user.data}/>
{/if}
```

---

## 4. `using NAME = EXPR` — dispose-on-unmount, lighter than `source`

**Status:** Shipped (`para-preprocess` `lowerUsingDecls`).

`using NAME = EXPR` binds `NAME` to a resource and registers its `dispose()` on unmount — **without** the seed/subscribe bridge. It is the right form when you need the resource's **lifecycle** (auto-dispose) but read it via *its own* reactive surface (its signals/handles), not as a single replicated cell.

### 4.1 Grammar & desugar

```
UsingDecl ::= "using" Ident TypeAnn? "=" Expr ";"?
```

```
# Desugar:  using NAME = EXPR
Para (.pui):
    using mic = openMic();
Runes (.pui):
    const mic = openMic();
    onDestroy(() => mic.dispose?.());
```

### 4.2 Semantics

**Static.** `NAME` has the full type of `EXPR` (the resource handle itself, *not* a projected cell). You read `mic.peak.get()`, `mic.alive.get()`, call `mic.use(fn)` — the handle's own surface ([→ ch:effects-lifecycle-concurrency §`resource()`]). **Dynamic.** Exactly one cleanup is registered: `onDestroy(() => NAME.dispose?.())`. `dispose` is optional-chained so a non-disposable value (a handle that returns no `dispose`) does not crash unmount.

### 4.3 `source` vs `async signal` vs `using` — the decision

| Form | Producer | What `NAME` is | Bridge | Use when |
|---|---|---|---|---|
| `source NAME = E` | `SourceHandle`/bare signal | a single **read-only cell** (latest value) | seed + subscribe + dispose | you want *one value* that re-renders |
| `async signal NAME = E` | a promise | a `{data,error,pending}` cell | same bridge over `promiseSignal` | you await *one async result* |
| `using NAME = E` | a `resource()` handle | the **handle itself** | dispose only | you read the handle's *own* multi-signal surface |

`using` is the *lightest* (no extra `$state`, no `$effect.pre`); `source` is the *most ergonomic* (the value reads as a bare cell); `async signal` is `source` specialized to promises. All three discharge INV-src-1.

---

## 5. Runtime producers — `promiseSignal`, `from*`, `resource()`

The declaration forms (§§2–4) are *binders*; the values they bind are **producers** from `@lyku/para-signals`. Every producer satisfies the source convention (directly, or via a `resource()` handle that exposes `.value` + `.peek`/`.subscribe`).

### 5.1 `resource(setup)` — the lifecycle substrate (cross-ref)

`resource(setup)` builds a handle that owns one or more signals plus `onDispose` cleanups; `dispose()` flips `.alive` to `false`, runs cleanups in **reverse-registration (LIFO)** order, and stops `.use(fn)` effects. Its full semantics are [→ ch:effects-lifecycle-concurrency]; this chapter cites it because **every `from*` adapter and both rate-limiters are built on `resource()`** — so their dispose is the resource's LIFO teardown, and `source x = fromStream(s)` inherits race-safe cleanup for free.

### 5.2 The `from*` adapters

These lift a host async primitive into a resource-tied source exposing `.value` (the latest emission). All are Shipped.

```
fromAsyncIter(src: AsyncIterable<T>, initial?): resource          // iterator.return() on dispose
fromStream(stream: ReadableStream<T>, initial?): resource         // reader.cancel() on dispose
fromEventTarget(target, eventName, { initial?, map? }): resource  // removeEventListener on dispose
fromStore(store: { subscribe(cb): () => void }): SourceHandle<T>  // Svelte-store bridge; dispose is a no-op
```

**Static semantics.** Each maps a producer kind to the convention: an `AsyncIterable` (sensor tick stream, generator), a `ReadableStream` (fetch body, file), an `EventTarget` (DOM/Node/Bun event), or a Svelte store (migration bridge). `T` is the element/event type; `fromEventTarget`'s `map` projects the `Event` to `T` (defaults to the `Event`). **Dynamic semantics.** Each spins an internal async pump (or attaches a listener) inside `resource()`, writing each value into an internal `signal`; `onDispose` releases the underlying primitive (`iterator.return()`, `reader.cancel()`, `removeEventListener`). An iterator/stream that *throws* stops the pump silently — `.alive` stays `true` (the resource was not formally disposed), so consumers detect end-of-data by absence of further updates, not by an error field (use `async signal` / §10.1 when you need an error channel).

```
# Desugar:  source NAME = fromStream(STREAM)
Para (.pui):
    source chunks = fromStream(response.body);
Runes (.pui):
    const __src_chunks = fromStream(response.body);          // a resource() handle
    let chunks = $state(__src_chunks.peek?.() ?? __src_chunks);
    $effect.pre(() => __src_chunks.subscribe?.((__v: typeof chunks) => { chunks = __v; }));
    onDestroy(() => __src_chunks.dispose?.());                // resource dispose → reader.cancel()
```

&gt; **Edge case (`fromStore` — the migration bridge, not a blessed idiom).** `fromStore` converts a `svelte/store` into the source convention so the **existing** `source` keyword consumes it (`source x = fromStore(legacyStore)`), with `dispose` a no-op (the store outlives the component; `$effect.pre`'s unsubscribe is the real teardown). This is the chosen `.pui` migration path (LYK-899): a store is rewritten to a signal-backed source *at migration time*, rather than blessing `$store` auto-subscription as a Para idiom. Stores stay a Svelte implementation detail, never a Para concept (I2 — the spine does not depend on the view substrate's store mechanism).

### 5.3 `throttled` / `debounced` — rate-limiters as source modifiers

**Status:** Shipped. Hardware and the network emit faster than a UI wants; both adapters wrap a source and return a new resource-tied source.

```
throttled(source, ms): resource    // leading edge + trailing flush: ≤1 emit per `ms` window
debounced(source, ms): resource    // emit only after `ms` of silence
```

**Dynamic semantics.** `throttled` emits the first change after a silent window *immediately* (leading edge), coalescing further changes within the window into a single trailing emit at window end; `lastEmit` is committed **only when a real emit occurs** (so the initial no-op effect run does not eat the first real change's leading edge). `debounced` resets a timer on every change and emits the latest value after `ms` of quiet. Both subscribe to the upstream source via an internal `effect`, store the timer in the resource, and clear it on dispose (no dangling timer after unmount).

```pui
<!-- .pui -->
<script lang="ts">
  import { audioMeter, throttled } from "@lyku/para-ui-native";  // throttled re-exported from para-signals
  source level = throttled(audioMeter(), 100);   // mic peak, but at most 10 updates/sec
</script>
<meter value={level}></meter>
```

&gt; **Edge case (composition is plain nesting).** `throttled`/`debounced` take a *source* and return a *source*, so they compose by nesting (`debounced(throttled(s, 50), 200)`) and bind through the *same* `source` keyword — there is no special "modifier" syntax in the Shipped surface. §10.4 proposes postfix modifier sugar (`source x = … throttle 100ms`) that lowers to exactly this nesting.

### 5.4 `proxySignal` — deep-reactive object/array as a source sink

**Status:** Shipped. `proxySignal(initial)` wraps a plain object/array in a `Proxy` where every property read tracks the active observer and every write notifies — so `state.user.name = "x"` re-runs effects that read `state.user.name`, with nested objects/arrays auto-proxied on first access and a `version` signal backing `for…of`/`Object.keys`/`in`. Non-plain values (`Date`/`Map`/`Set`/class instances) pass through unwrapped (their methods rely on `this`-binding a Proxy breaks).

`proxySignal` is documented as an **in-process signal surface** in [→ ch:reactivity-core §9.5] (the reactive-collections form). It appears **here** in its *source role*: it is the natural **sink** for a structured external producer whose payload is a nested object/array — e.g. a websocket delivering JSON documents, where you want field-grained reactivity over the assembled document rather than a single replaced cell.

```pts
// .pts — proxySignal as a structured sink for an external producer
const doc = proxySignal({ title: "", body: "", meta: { rev: 0 } });
fromStream(ws.readable).use(({ value }) => Object.assign(doc, value()));  // field-grained re-renders
```

This chapter owns its **use as an external-producer sink**; the reactivity chapter owns its **in-process signal** surface. The two are the same runtime (one constructor selected by RHS shape); the boundary is which producer drives the writes.

---

## 6. The native adapter pattern — `audioMeter` and its discipline

**Status:** Shipped (`@lyku/para-ui-native`). A `parabun:*` native module's real API is **async + multi-signal** (an audio capture stream resolves a `Promise`, then exposes a `peakLevel` signal, a `close()`, …). The adapter's job is to wrap that into the **synchronous, single-value** `SourceHandle<T>` the `source` keyword consumes. `audioMeter` is the reference implementation; every native adapter follows its three rules.

```pts
// @lyku/para-ui-native — audioMeter (the canonical native-adapter pattern)
export function audioMeter(opts: AudioMeterOptions = {}): SourceHandle<number> {
  const level = signal(0);                       // (1) synchronous seed — return immediately at 0
  const capture = opts._capture ?? defaultCapture;
  let unsub: (() => void) | undefined, stream: CaptureLike | undefined, disposed = false;

  capture({ channels: 1, ...(opts.device ? { device: opts.device } : {}) })
    .then(c => {
      if (disposed) { c.close?.(); return; }     // (2) race-safe: disposed before resolve → close on arrival
      stream = c;
      unsub = c.peakLevel.subscribe(v => level.set(v));   // forward the native signal into ours
    })
    .catch(() => { /* (3) device unavailable — meter stays at 0, NOT fatal */ });

  return {
    peek: () => level.peek(),
    subscribe: cb => level.subscribe(cb),
    dispose: () => { disposed = true; unsub?.(); stream?.close?.(); },
  };
}
```

The three rules (each load-bearing):

1. **Non-blocking init (INV-src-1 precondition).** The adapter returns a working handle **synchronously**, seeded at a sentinel (`0`), and forwards the native signal once the async `capture()` resolves. `source` never awaits (§2.3 step 1); a blocking adapter would stall render.
2. **Race-safe dispose.** `dispose()` may run **before** the async init resolves (fast unmount). The `disposed` flag is checked in the `.then` so a stream that arrives *after* dispose is `close()`d on arrival, never leaked — and the unsubscribe/close in `dispose()` itself is idempotent. This is the concrete shape of INV-src-1 for async-initialized producers.
3. **Device-unavailable is non-fatal.** A missing device (no ALSA, no camera) routes to `.catch` and leaves the meter at its sentinel — the component renders, just at `0`. Hardware absence is a *value* (the sentinel), not an exception that unmounts the tree.

&gt; **INV-src-4 (adapter façade).** Every `parabun:*` reactive adapter presents the synchronous `SourceHandle<T>` façade over an async/multi-signal native handle, observing the three rules above. This is what lets `source level = audioMeter()` look identical to `source count = someSignal` despite one owning an OS capture stream and the other owning nothing — the façade absorbs the asymmetry.

---

## 7. The `parabun:*` native module family

**Status:** the 13 modules are Shipped runtime builtins; their reactive surfacing through `source` is Shipped (via adapters like §6); their *typed* surfacing is Proposed (§10.5).

Para's implementation (ParaBun) ships **13 `parabun:*` native modules** — the outside-world producers that motivate this whole chapter. They are plain ESM imports (`import audio from "parabun:audio"`) exposing handles whose reactive parts (status signals, frame streams, level meters) are surfaced into components through `source` / `using` + an adapter.

| Module | Surface | Reactive shape (surfaced via `source`) | Port class |
|---|---|---|---|
| `parabun:gpio` | `/dev/gpiochip*` ioctl | pin `value` signal, edge events → `fromEventTarget` | B (C++ re-bind) |
| `parabun:i2c` | `/dev/i2c-*` ioctl | register-read signals, polled via `every` | B |
| `parabun:spi` | `/dev/spidev*` ioctl | transfer-result stream | B |
| `parabun:camera` | V4L2 `/dev/video*` | `frameRate` signal, frame stream → `fromAsyncIter` | B |
| `parabun:audio` | ALSA/PortAudio + codecs | `peakLevel` signal (→ `audioMeter`), capture stream | B (×2) |
| `parabun:image` | jpeg/png/webp codecs | decode result (one-shot → `async signal`) | B |
| `parabun:llm` | FFI: llama/whisper | token `AsyncIterable`, `busy` signal, final value | A (FFI) |
| `parabun:assistant` | FFI: llama/whisper/onnx | conversation stream, `busy` signal | A |
| `parabun:vision` | FFI: onnx | detection stream per frame | A |
| `parabun:speech` | FFI: whisper/onnx | transcript `AsyncIterable` (partial → final) | A |
| `parabun:gpu` | FFI: vulkan/CUDA | compute-result promise (→ `async signal`) | A |
| `parabun:video` | FFI: ffmpeg | frame/packet stream → `fromAsyncIter` | A |
| `parabun:csv` | pure TS | row `AsyncIterable` → `fromAsyncIter` | C (pure) |

**Surfacing patterns** (each is the existing surface, no new keyword):

- A **status signal** (`busy`, `value`, `fps`, `active`) → `source x = mod.busy` (§2.3, bare-signal path; module-owned, `dispose` no-ops).
- A **frame/token/row stream** (`AsyncIterable`/`ReadableStream`) → `source x = fromAsyncIter(mod.frames())` / `fromStream(...)` (§5.2).
- A **one-shot async** (decode, GPU compute) → `async signal x = mod.decode(buf)` (§3).
- An **event source** (GPIO edge) → `source x = fromEventTarget(mod.pin(17), "edge", { map: e => e.level })`.

```pui
<!-- .pui — a temperature display from an I2C sensor, polled and rate-limited -->
<script lang="ts">
  import i2c from "parabun:i2c";
  const sensor = i2c.open(1, 0x48);
  using bus = sensor;                                    // auto-close the bus on unmount
  source raw = sensor.readReg(0x00) every 1000;          // poll register every 1s (`every`, §ch:reactivity-core)
  derived celsius = raw * 0.0625;
</script>
<p>{celsius.toFixed(2)} °C</p>
```

&gt; **Boundary (server-only).** Most `parabun:*` modules are **server-only** (they touch `/dev`, FFI, hardware). Surfacing them in a `.pui` is legal only in a server/SSR component; a client bundle that imports `parabun:gpio` is the misuse the proposed capability matrix makes a compile error [→ ch:overview-and-surfaces §5.3, `surface server { parabun:gpio; … }`]. This chapter assumes the producer is reachable in the rendering context; the *bundle-split* enforcement is the overview/projections chapters.

---

## 8. Sync as a source (cross-reference)

`sync NAME :: SCHEMA from KEY`, `sync NAME : TYPE from KEY`, and `synced NAME = ARGS` are **also** source declarations — they bind a value that changes over time, lower through the **same** `peek`/`subscribe`/`dispose` runes bridge (`syncedBinding` emits the identical seed + `$effect.pre` + `onDestroy` shape as `source`), and auto-dispose on unmount. The difference is the producer: a `synced(...)` replica carries a **`(schema_version, sequence)` reconciler** and an authority model the other sources do not. Because that reconcile/authority machine is the highest-risk surface in the language, it has its own chapter [→ ch:data-sync-and-authority]; this chapter only records that **sync is a source with a reconciler**, and that the binding lowering is shared (one bridge, four producers: `source`/`async signal`/`using`/`synced`).

```
# Desugar:  sync NAME :: SCHEMA from KEY   (shape shared with `source`; reconcile is ch:data-sync-and-authority)
Para (.pui):
    sync user :: User from `user:${id}`;
Runes (.pui):
    const __syn_user = synced(`user:${id}`, User);
    let user = $state(__syn_user.peek?.() ?? __syn_user);
    $effect.pre(() => __syn_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __syn_user.dispose?.());
```

The `::`/`:` annotation (validated vs type-only) is the parse-gate that §10.1 generalizes to *all* sources: a synced replica parse-gates every envelope today, and the proposed streaming-LLM source borrows exactly that gate so AI output crosses the boundary like any other replicated value.

---

## Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts` / the parser today). Each carries a desugaring sketch (`# Desugar (proposed):`) so it stays glass-floor-compatible (I1), lowers with no silent `any` (I3), and keeps the spine substrate-independent (I2). They are grouped here because each extends the *source* surface — binding the outside world into reactive cells — rather than a single existing construct.

### 10.1 Typed streaming-LLM source — tokens, tool-calls & final value schema-projected  `Proposed`

**Rationale.** An LLM is the archetypal outside-world producer: it emits a **token stream**, then optional **tool-calls**, then a **final structured value**. Today that final value is an untyped blob — the A2 ("limited typing → hand-rolled validation") and A1 ("untyped payload") holes, exactly the gap the schema spine exists to close. Para already has the machine to fix it: the `::` parse gate ([→ ch:type-and-schema-system, ch:errors-results-and-validation]) and the source convention. A **typed streaming-LLM source** unifies them — the stream binds like any `source`, and its terminal value crosses the parse gate like any boundary, so AI output is *total*, not `any`.

**Grammar.**

```
LlmSource     ::= "source" Ident "=" LlmCall ProjectClause? ";"?
LlmCall       ::= Expr                                ⟨a parabun:llm/assistant streaming call⟩
ProjectClause ::= "::" SchemaRef                       ⟨parse-gate the FINAL value⟩
SchemaRef     ::= Ident
```

The cell `NAME` is a struct source: `{ text: string, tokens: string[], toolCalls: ToolCall[], data: T | undefined, error: unknown, pending: boolean }`, where `T = Infer<typeof SchemaRef>`. `text` accumulates as tokens arrive (live, for streaming UIs); `data` is populated **only** once the final value parses against `SchemaRef`; a parse failure populates `error` (never a half-typed `data`).

**Static semantics.** `:: SchemaRef` requires `SchemaRef` to be an in-scope `schema`; `data` then has type `Infer<typeof SchemaRef> | undefined` (I3 — no `any` reaches the component). Without `::`, `data` is `string` (the raw completion) and a warning suggests adding a schema (`LLM output is untyped; add ':: Schema' to parse-gate the result`). Tool-call shapes are themselves schemas (each `ToolCall` is `{ name, args: Infer<typeof ToolSchema> }`), so the tool boundary is also total (§10.2).

**Dynamic semantics / desugar.** The call returns a producer combining `fromAsyncIter` (the token stream) with a terminal `Schema.parse` on the assembled value; it satisfies the source convention, so it reuses the §2.3 bridge unchanged.

```
# Desugar (proposed):  source NAME = llm.complete(PROMPT) :: SCHEMA
Para (.pui):
    source answer = llm.complete(prompt) :: AnswerSchema;
Runes (.pui):
    const __src_answer = __paraLlmSource(llm.complete(prompt), AnswerSchema);
    let answer = $state(__src_answer.peek?.() ?? __src_answer);
    $effect.pre(() => __src_answer.subscribe?.((__v: typeof answer) => { answer = __v; }));
    onDestroy(() => __src_answer.dispose?.());            // abort generation + free KV-cache

# __paraLlmSource — the glass-floor producer (readable, ejectable)
TS:
    function __paraLlmSource<T>(gen: LlmStream, schema: Schema<T>): SourceHandle<LlmCell<T>> {
      const cell = signal({ text: "", tokens: [], toolCalls: [], data: undefined, error: undefined, pending: true });
      (async () => {
        for await (const ev of gen) {                     // fromAsyncIter-style pump
          if (ev.kind === "token")    cell.set({ ...cell.peek(), text: cell.peek().text + ev.t, tokens: [...cell.peek().tokens, ev.t] });
          else if (ev.kind === "tool") cell.set({ ...cell.peek(), toolCalls: [...cell.peek().toolCalls, ev.call] });
          else if (ev.kind === "final") {
            const r = schema.parse(ev.value);             // the parse gate — :: semantics
            cell.set({ ...cell.peek(), pending: false, ...(r.tag === "Ok" ? { data: r.value } : { error: r.error }) });
          }
        }
      })();
      return { peek: () => cell.peek(), subscribe: cb => cell.subscribe(cb), dispose: () => gen.abort() };
    }
```

**Interaction.** `::` here is the *same* operator as the handler boundary gate and the sync envelope gate (§8) — the parse gate appears at handler entry, at the sync boundary, and now at the AI boundary, uniformly. It composes with §10.3 (`retry`/`timeout` on a flaky model call) and §10.5 (a tool whose actuator side-effects are typed). The streaming `text` feeds a UI before `data` parses, so a chat UI streams *and* stays total.

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  import { llm } from "parabun:llm";
  schema Answer { summary: str, confidence: float, sources: str[] }
  prop prompt: string;
  source answer = llm.complete(prompt) :: Answer;
</script>

<p>{answer.text}</p>                          <!-- streams live, char by char -->
{#if answer.data}<Confidence value={answer.data.confidence}/>{/if}
{#if answer.error}<Warn>model output failed validation</Warn>{/if}
```

```pui
<!-- ✗ counter-example -->
<script lang="ts">
  source answer = llm.complete(prompt);       // ⚠ warning: untyped LLM output; add ':: Schema'
  // answer.data has type `string`; reading answer.data.confidence is a type error (no schema)
</script>
```

### 10.2 Declarative model & tool binding  `Proposed`

**Rationale.** §10.1 types the *output*; an agent also needs typed *tools* (the functions the model may call) and a declared *model*. Today tool wiring is hand-rolled JSON-schema dictionaries passed imperatively — A2/A4 territory (untyped args, ad-hoc dispatch). Binding tools **declaratively**, with each tool's args a `schema` and its handler a `pure`/effectful `fun`, makes the tool boundary total: the model can only call a tool with parse-gated args, and the call dispatch is generated, not hand-written.

**Grammar.**

```
ModelBind ::= "model" Ident "=" Expr ToolList? ";"?
ToolList  ::= "tools" "{" ToolBind* "}"
ToolBind  ::= Ident "::" SchemaRef "=>" Expr ";"    ⟨name :: args-schema => handler⟩
```

`model answer = llm("…")` binds a configured model; the optional `tools { … }` block declares each tool as `name :: ArgsSchema => handler`. A `source` over that model (§10.1) then surfaces `toolCalls` whose `args` are `Infer<typeof ArgsSchema>` and whose dispatch is the bound `handler`.

**Static semantics.** Each `ToolBind` requires `SchemaRef` to be an in-scope `schema`; the `handler` must accept `Infer<typeof SchemaRef>` (checked structurally). The generated tool descriptor passed to the model is the JSON-Schema *projection* of `SchemaRef` [→ ch:type-and-schema-system] — one source of truth (the schema), projected to both the model's tool spec and the handler's parameter type, so the two cannot drift (A5 at the tool boundary). A tool handler returning a value crossing back to the model is itself schema-typed (no `any` round-trips).

**Dynamic semantics / desugar.** Erases to a config object + a dispatch table; the model call threads them.

```
# Desugar (proposed):  model + tools
Para (.pts):
    schema WeatherArgs { city: str, units: "c" | "f" }
    model assistant = llm("claude-haiku-4.5") tools {
      getWeather :: WeatherArgs => (a) => weatherApi(a.city, a.units);
    };
TS:
    const assistant = {
      model: llm("claude-haiku-4.5"),
      tools: {
        getWeather: { schema: WeatherArgs, handler: (a: Infer<typeof WeatherArgs>) => weatherApi(a.city, a.units) },
      },
    };   // tool descriptor = WeatherArgs.toJsonSchema(); dispatch parses args before handler runs
```

**Interaction.** Pairs with §10.1: `source reply = assistant.complete(prompt) :: ReplySchema` surfaces typed `toolCalls`, each dispatched through the bound, arg-parsed handler. It discharges A4 at the agentic boundary — a tool's effect/auth context is a typed `fun`, never an `any` middleware blob. Tool args parse-gate exactly as `::` does everywhere (§8, §10.1).

**Example.**

```pts
// .pts
schema SearchArgs { query: str, limit: int }
model agent = llm("claude-opus-4.5") tools {
  search :: SearchArgs => (a) => db.search(a.query, a.limit);   // a.query: string, a.limit: int — total
};
```

### 10.3 Uniform `retry` / `timeout` / `fallback` modifiers  `Proposed`

**Rationale.** Every outside-world producer can fail, hang, or flake — the network, a model, a device. Today each call site hand-rolls retry loops and timeout races (scattered, untyped, inconsistent). A **uniform postfix modifier set** on `async signal` and `source` lifts the three universal resilience policies into surface, lowering to readable wrapper functions.

**Grammar.**

```
ResilientDecl ::= ("async" "signal" | "source") Ident TypeAnn? "=" Expr Modifier* ";"?
Modifier      ::= "retry" Expr             ⟨attempt count, or { n, backoff } object⟩
                | "timeout" DurationExpr    ⟨abort + error after the duration⟩
                | "fallback" Expr           ⟨value or thunk used if all attempts fail⟩
DurationExpr  ::= Expr                       ⟨ms number, or a unit literal — 100ms/5s, [→ ch:lexical-and-expression-syntax]⟩
```

Modifiers are postfix on the declaration (read as English: `async signal user = fetch(u) retry 3 timeout 5s fallback guestUser`). Order is normative innermost-first: `timeout` wraps the call, `retry` wraps the timeout, `fallback` wraps the retry (so a timed-out attempt is retried, and exhaustion yields the fallback).

**Static semantics.** `retry N` requires `N: int`; `timeout D` a duration; `fallback V` a value (or thunk) **assignable to the producer's resolved type** `T` — so the fallback cannot smuggle an off-type value (I3). The cell's `error` is populated only after retries *and* fallback are exhausted (if no `fallback`, the last error surfaces). The modifiers do not change the cell's static shape — `async signal` stays `{data,error,pending}`, `source` stays its element type.

**Dynamic semantics / desugar.** Pure wrapper composition over the existing producer; nothing new in the bridge.

```
# Desugar (proposed):  async signal NAME = E retry N timeout D fallback F
Para (.pui):
    async signal user = fetchUser(id) retry 3 timeout 5s fallback GUEST;
Runes (.pui):
    const __as_user = promiseSignal(s =>
      __paraFallback(GUEST, () =>
        __paraRetry(3, () =>
          __paraTimeout(5000, s, () => (fetchUser(id))))));   // timeout threads the abort signal
    let user = $state(__as_user.peek?.() ?? __as_user);
    $effect.pre(() => __as_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __as_user.dispose?.());
```

`__paraRetry`/`__paraTimeout`/`__paraFallback` are ~5-line readable helpers (a loop, a `Promise.race` with the abort, a `catch`-to-default). `timeout` threads the source's `AbortController` signal so a timed-out attempt actually cancels (not just ignores) the slow call.

**Interaction.** Composes with §10.1 (`source answer = llm.complete(p) :: Schema retry 2 timeout 30s` — resilient *and* typed) and §10.5 (a flaky sensor read with a fallback last-known value). The duration literal (`5s`, `100ms`) is the proposed unit-literal surface from [→ ch:lexical-and-expression-syntax]; until that lands, `timeout 5000` (ms number) is the form.

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  prop id: string;
  async signal user = fetchUser(id) retry { n: 3, backoff: "exponential" } timeout 5s fallback null;
</script>
{#if user.data}<Profile user={user.data}/>{:else if user.pending}<Spinner/>{:else}<Guest/>{/if}
```

### 10.4 `bufferedSink` — backpressure as a first-class source modifier  `Proposed`

**Rationale.** A producer can outrun its consumer — a camera at 60fps feeding a model that processes 10fps, a sensor faster than the render loop. `throttled`/`debounced` *drop* values; sometimes you must *buffer* (process every frame, just behind) with an explicit bound and an overflow policy. Today that is a hand-rolled queue. A first-class `bufferedSink` modifier makes backpressure a declared, bounded, glass-floor property of the source.

**Grammar.**

```
BufferedSource ::= "source" Ident "=" Expr "buffered" "{" BufferOpts "}" ";"?
BufferOpts     ::= "size" ":" Expr ("," "overflow" ":" OverflowPolicy)?
OverflowPolicy ::= "drop-oldest" | "drop-newest" | "block"
```

`source frames = camera.stream() buffered { size: 30, overflow: "drop-oldest" }` binds a bounded ring buffer between producer and the reactive cell. The cell exposes `{ value: T, depth: int, dropped: int }` — the latest value, the live buffer depth, and a dropped-count for observability.

**Static semantics.** `size: N` requires `N: int > 0` (a zero/negative buffer is a compile error — `buffer size must be a positive int`). `overflow` defaults to `drop-oldest`; `block` is legal **only** when the producer is pull-based (an `AsyncIterable` whose `next()` can be deferred) — a `block` policy on a push producer (`EventTarget`/native signal) is a compile error (`'block' overflow requires a pull-based producer; an EventTarget cannot be back-pressured — use drop-oldest`), because you cannot back-pressure a source that does not await.

**Dynamic semantics / desugar.** A `resource()`-tied ring buffer; `dispose` drains and releases.

```
# Desugar (proposed):  source NAME = E buffered { size: N, overflow: P }
Para (.pui):
    source frames = camera.stream() buffered { size: 30, overflow: "drop-oldest" };
Runes (.pui):
    const __src_frames = bufferedSink(camera.stream(), { size: 30, overflow: "drop-oldest" });
    let frames = $state(__src_frames.peek?.() ?? __src_frames);
    $effect.pre(() => __src_frames.subscribe?.((__v: typeof frames) => { frames = __v; }));
    onDestroy(() => __src_frames.dispose?.());     // drain buffer, release producer (resource LIFO)
```

`bufferedSink` is a `resource()` that pumps the upstream into a bounded array, applies the overflow policy on overrun (bumping `dropped`), and emits `{ value, depth, dropped }`. For `block`, the pump *awaits* a slot before pulling the next item (true backpressure to a pull producer).

**Interaction.** Complements §5.3 — `throttled` is "buffer of 1, drop-oldest, time-gated"; `bufferedSink` generalizes to depth-N with an explicit policy. Composes with §10.1 (buffer model tokens while a slow renderer catches up) and §10.5 (a typed sensor with a bounded history). The `dropped` count is the observability surface a hand-rolled queue usually lacks.

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  import camera from "parabun:camera";
  using cam = camera.open(0);
  source frames = cam.stream() buffered { size: 30, overflow: "drop-oldest" };
</script>
<Canvas frame={frames.value}/>
<small>buffer {frames.depth}/30 · dropped {frames.dropped}</small>
```

### 10.5 Sensor/actuator schema layer — typed, constrained native handles  `Proposed`

**Rationale.** A `gpio`/`i2c`/`camera` handle today is an untyped surface — `pin.write(257)` (out of range), `i2c.readReg("0x00")` (wrong type), `camera.setFps(1000)` (unsupported) are all runtime failures the schema spine should catch at compile time. The same `schema` that types DB rows and API payloads can type **hardware surfaces**: a `sensor`/`actuator` schema declares the read shape, the write shape, and the *constraints* (a refinement on the value range), so a native handle carries a typed, constrained surface like any other boundary (I3 reaches the metal).

**Grammar.**

```
HardwareSchema ::= ("sensor" | "actuator") Ident "{" HwField* "}"
HwField        ::= ("read" | "write") Ident ":" ConstrainedType ";"
ConstrainedType ::= Type Refinement?                  ⟨e.g. int @range(0, 1023)⟩
```

A `sensor` declares `read` fields (the values the device produces); an `actuator` declares `write` fields (the commands it accepts); a device with both is declared with both blocks. `ConstrainedType` reuses the schema refinement surface (`int @range(...)`, `float @min/@max`) [→ ch:type-and-schema-system] so the constraint is the *same* brand machinery DB columns use.

**Static semantics.** Binding a native module to a `sensor`/`actuator` schema (`source temp :: TempSensor = i2c.open(1, 0x48)`) types its `read` accessors as `Infer` of the read fields and its `write` accessors against the write fields' constrained types. A write outside the declared constraint is a **compile error** where statically known (`pin.set(257)` against `write level: int @range(0, 255)` → `257 exceeds the @range(0,255) of actuator field 'level'`); a dynamic write parse-gates at runtime (`:: ` semantics) and surfaces an `Err` rather than faulting the device. Crucially, an `actuator` source is the **one place `source` permits writes** — but only through the typed `write` accessors, never the bare-reassignment anti-pattern of §2.4 (which stays a compile error: `'temp' is a sensor source; assign via its actuator surface, not reassignment`).

**Dynamic semantics / desugar.** Erases to a typed wrapper over the native handle; reads bind through the §2.3 source bridge, writes call the device's command method after a constraint parse.

```
# Desugar (proposed):  sensor/actuator schema + typed source
Para (.pts):
    sensor TempSensor   { read celsius: float @min(-40) @max(125); }
    actuator Fan        { write speed: int @range(0, 255); }
Para (.pui):
    source temp :: TempSensor = i2c.open(1, 0x48);
    using fan :: Fan = gpio.pwm(18);
    // fan.speed = 200;     ✓ ok (200 ∈ 0..255), lowers to fan.set("speed", 200) after a range parse
    // fan.speed = 300;     ✗ compile error: 300 exceeds @range(0,255) of actuator field 'speed'
TS:
    const __src_temp = __paraSensor(i2c.open(1, 0x48), TempSensor);   // typed read view, source-convention
    const fan = __paraActuator(gpio.pwm(18), Fan);                    // typed write surface, range-gated
```

**Interaction.** Closes the I3 loop at the hardware boundary — the same `schema` + refinement that types a DB column types a PWM duty cycle, so "all data is accounted for end-to-end" includes the data flowing to/from `/dev`. Composes with §10.4 (a buffered, typed sensor stream), §10.3 (a sensor read with a fallback last-known value), and the capability matrix [→ ch:overview-and-surfaces §5.3] (these schemas are inherently `server`). The refinement brands are projected exactly as schema constraints are [→ ch:type-and-schema-system].

**Example.**

```pts
// .pts — a thermostat spine: typed sensor + typed actuator
sensor Thermometer { read celsius: float @min(-40) @max(125); }
actuator Heater    { write on: bool; write target: int @range(40, 90); }
```

```pui
<!-- .pui -->
<script lang="ts">
  import i2c from "parabun:i2c";
  import gpio from "parabun:gpio";
  source temp :: Thermometer = i2c.open(1, 0x48);
  using heater :: Heater = gpio.relay(23);
  effect { heater.on = temp.celsius < 18; }   // typed write; `temp.celsius` is float, `heater.on` is bool
</script>
<p>{temp.celsius.toFixed(1)} °C — heat {heater.on ? "on" : "off"}</p>
```

### 10.6 Suspense & streaming-SSR integration  `Proposed`

**Rationale.** `async signal` (§3) is client-shaped: it fires on mount and shows `pending` until settle. For server rendering, the server should **await** the result (or stream it), emit HTML with the data already present, and **seed** the client cell so hydration does not refetch — the same seed model the sync chapter uses for replicas. Without this, every `async signal` double-fetches (once server, once client) or flashes a spinner the server could have filled. A declared **suspense/SSR mode** makes `async signal` and `source` participate in server-render and hydration.

**Grammar.**

```
SuspendModifier ::= ("async" "signal" | "source") Ident TypeAnn? "=" Expr SsrMode? ";"?
SsrMode         ::= "await"          ⟨block SSR until settled, seed HTML + client cell⟩
                  | "stream"          ⟨flush a placeholder, stream chunks as they settle (out-of-order)⟩
                  | "client"          ⟨skip on the server, fire only on the client (default today)⟩
```

`async signal user = fetchUser(id) await` blocks the server render of that subtree until `user` settles, emits the resolved HTML, and serializes the value into the hydration seed; `stream` flushes a placeholder immediately and streams the resolved chunk when ready (out-of-order streaming SSR); `client` is today's mount-fire behavior (the default, named for completeness).

**Static semantics.** The modifier does not change the cell's static shape. `await`/`stream` require the producer to be SSR-safe (no client-only API in `EXPR`); a `source` over a client-only `EventTarget` cannot be `await`ed (compile error — `'await' SSR mode requires a server-evaluable producer; window/DOM sources must be 'client'`). The serialized seed is schema-typed when the source is `::`-gated (§10.1/§10.5) — the seed crosses the server→client boundary through the *same* parse gate sync uses, so a tampered seed is rejected on hydration, not trusted (I3 across the SSR boundary).

**Dynamic semantics / desugar.** On the server, the producer is awaited (or registered with the streaming renderer) and its value pushed into a per-request seed map keyed by the cell's stable id; on the client, the bridge's `peek()` reads the seed *before* re-subscribing, so the cell hydrates with the server value and only re-fires if stale.

```
# Desugar (proposed):  async signal NAME = E await   (SSR seed + hydration)
Para (.pui):
    async signal user = fetchUser(id) await;
Runes (.pui), server:
    const __as_user = promiseSignal(() => (fetchUser(id)));
    await __paraSsrAwait(__as_user, "user@" + __ssrId);     // block, settle, write into the seed map
    let user = $state(__as_user.peek());                     // resolved HTML emitted with data present
Runes (.pui), client:
    const __as_user = promiseSignal(() => (fetchUser(id)));
    let user = $state(__paraHydrationSeed("user@" + __ssrId) ?? __as_user.peek?.());  // seed-first, no flash
    $effect.pre(() => __as_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __as_user.dispose?.());
```

**Interaction.** Unifies the source pillar with the sync chapter's **seed model** [→ ch:data-sync-and-authority]: an SSR-seeded `async signal` is the one-shot analogue of a synced replica's initial baseline, and both serialize through the schema's wire codec [→ ch:modules-projections-and-build]. Composes with §10.1 (a streaming-LLM source with `stream` SSR flushes tokens server-side) and §10.3 (`await` + `timeout` so a slow SSR fetch does not hang the response). The hydration parse gate is the same `::` gate as everywhere else, so the SSR boundary is total.

**Example.**

```pui
<!-- .pui — server-rendered, no spinner flash, hydration-seeded -->
<script lang="ts">
  prop id: string;
  schema User { id: UUID, name: str }
  async signal user = fetchUser(id) :: User await;   // SSR-awaited, schema-gated seed
</script>
<h1>{user.data?.name}</h1>                            <!-- present in server HTML; hydrates without refetch -->
```

### 10.7 Query-derived cell (`derived NAME :: SCHEMA = EXPR`)  `Proposed`

**Rationale.** §3.3's edge case draws a deliberate scope boundary: `async signal` is fire-once-per-mount, and "re-keying is reactivity, not the source's job" — the refetch-on-dependency-change case is deferred to "a derived/keyed pattern." This section is that pattern, made first-class. It is the **pull mirror** of sync's push: client-initiated, tracked, latest-wins, parse-gated — a value fetched *by* the client whenever its inputs change, with the same trust-boundary discipline an inbound sync envelope gets. No sequence reconcile, no authority — this is a source with a parse gate, which is why it lives in this chapter and not [→ ch:data-sync-and-authority].

**Grammar.**

```
QueryDerivedDecl ::= "derived" Ident "::" Schema "=" Expr ";"
```

The `::` after the name is currently unused on `derived` — its presence is the whole discriminator: async initializer, tracked re-run, gated settle. Plain `derived x = expr` is untouched. The gate is **annotation-position** (on the cell) rather than the §10.1 expression-position spelling (`EXPR :: SCHEMA`) because the initializer *re-runs* — the gate is part of the cell's contract, not of one evaluation. Both spellings rhyme with `value :: Schema` [→ ch:type-and-schema-system] and gate identically.

**Static semantics.** The cell types `{ data: Infer<S> | undefined, error, pending }` — the §3 `async signal` shape — with **stale-while-revalidate**: on re-run, `data` retains the previous value while `pending` flips true (contrast `async signal`, whose `data` starts `undefined` and never re-runs). A parse failure is a *state*, not a crash: the `Err` lands in `error`, branch-never-throw, the same inbound-gate mode sync uses [→ ch:data-sync-and-authority §3.3].

**Dynamic semantics / desugar.** Signals read inside `EXPR` are tracked; any change re-runs it. Each run holds a run-id and an `AbortController` (the `promiseSignal` threading convention, §3.3): a superseded run is aborted and its settle discarded — no out-of-order clobber.

```
# Desugar (proposed):  derived NAME :: SCHEMA = EXPR
Para (.pui):
    derived user :: User = graphql.userById(id);
Runes (.pui):
    let user = $state({ data: undefined, error: undefined, pending: true });
    $effect.pre(() => {                                   // reads of `id` tracked → re-run on change
      const q = querySignal(s => (graphql.userById(id)), User);   // latest-wins + abort + parse gate
      const seed = q.peek?.(); if (seed !== undefined) user = seed;
      const un = q.subscribe?.((__v: typeof user) => { user = __v; });
      return () => { un?.(); q.dispose?.(); };            // abort in-flight run before re-key/unmount
    });
```

`querySignal` is `promiseSignal`'s tracked, gated sibling and lives beside it in `@lyku/para-signals` — it is client-pull with no reconcile, so it does **not** belong to `@lyku/para-sync`. The lowering is the standard bridge with the construct site moved *inside* `$effect.pre` (the re-keying §3.3 declined to give `async signal`).

**Interaction.** Composes with §10.3 (`derived user :: User = fetchUser(id) retry 3 timeout 5s` — the modifiers wrap the producer inside each run). The push-flavored mirrors are [→ ch:data-sync-and-authority §13.7–§13.8] — the full taxonomy: `derived :: S =` (pull, gate) · `sync :: S from query()` (push, gate + reconcile, live) · `sync :: S from server … policy` (push, gate + reconcile, declared refresh). Implementation plan: `para-sync-query-plan.md` §5 (step 1 of the build order — fully client-side, ships independently of everything sync-side).

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  prop id: string;
  derived user :: User = graphql.userById(id);    // refetches when `id` changes; response gated by User
</script>
{#if user.data}<Profile user={user.data}/>{:else if user.pending}<Spinner/>{:else}<Err e={user.error}/>{/if}
```

---

## 11. Chapter invariants (summary)

- **INV-src-1 (lifecycle totality).** Every bound source has a teardown that runs exactly once on its owning scope's unmount; idempotent disposal is required. §0, §2.3, §6.
- **INV-src-2 (read-only view).** `source`/`async signal`/`using`/`sync(ed)` bind a read-only view — no assignment rewrite; the world writes the cell (the typed-actuator exception, §10.5, writes only through constrained accessors). §0, §2.2.
- **INV-src-3 (optional-chained convention).** The `peek`/`subscribe`/`dispose` convention is open by structural subtyping — every method is invoked optional-chained, so a handle, a bare signal, and a plain value all bind. §1.1.
- **INV-src-4 (adapter façade).** Every `parabun:*` reactive adapter presents the synchronous `SourceHandle<T>` façade over an async/multi-signal native handle, observing non-blocking init, race-safe dispose, and non-fatal device-absence. §6.

Every form in §§1–8 lowers to readable `@lyku/para-signals` / `@lyku/para-sync` calls plus the `$state` + `$effect.pre` + `onDestroy` runes bridge (I1); the keyword is surface-uniform — one bridge serves four producers (`source`/`async signal`/`using`/`synced`) and only the producer differs (I2); and no form lets an external or AI payload reach the component as a silent `any` — the parse gate (`::`) is the boundary, the same gate handlers and sync already use (I3).

