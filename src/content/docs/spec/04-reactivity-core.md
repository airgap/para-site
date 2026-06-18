---
title: "Reactivity: Signals, Derived, Effects & the Reactive Graph"
description: "The Para-native synchronous reactive core, surface and runtime: signal/derived/effect declarations, the binding operators ~> and ->, batch/untrack, the…"
sidebar:
  order: 5
---

# Chapter: Reactivity — Signals, Derived, Effects & the Reactive Graph

&gt; **Status of this chapter:** Mixed. The reactive *core* — `signal`/`derived`/`effect` declarations, the `~>`/`->` binding operators, `batch`/`untrack`, and the synchronous push-pull graph (`WritableSignal`/`DerivedSignal`/`Effect`, empty-subs guard, dynamic re-subscription, eager drain) — is **Shipped**. The `signal NAME every MS` interval form is **Shipped**. Everything in *Proposed extensions* (§9) is **Proposed** (net-new surface, not in `language-surface.ts` today).
&gt; **Cross-refs:** This chapter owns the in-process reactive primitives and their `.pts`-family surface. The `.pui` runes *bridge* (`$state`/`$derived`/`$effect`, escape analysis, `$effect.pre`, HMR) is [→ ch:pui-component-model]; this chapter shows the bridge only where a desugaring requires it and defers its full rules there. Resource-tied and async producers (`source`/`async signal`/`promiseSignal`/`from*`/`proxySignal`-as-a-source) are [→ ch:sources-async-and-native]. Edge-triggered `when`/`when not`/`when start`/`stop`, `defer`, `arena`, and the `resource()`/`onDispose` lifecycle are [→ ch:effects-lifecycle-and-concurrency] — this chapter covers only **steady-state** `signal`/`derived`/`effect`. Purity of `derived` and `pure` computations is [→ ch:purity-and-determinism]. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. The over-time-shape pillar

A `schema` describes the shape of a value *at rest*; a `signal` describes that same value *changing over time within one process* [→ ch:overview-and-surfaces §0]. Reactivity is the verb that ties rest-shape to over-time-shape: it is the in-process member of the four-distances family (signal / sync / source) that shares one downstream convention — a reactive value is read, written, and observed — while the *projection* (in-process graph here; a reconciler for sync; a `peek/subscribe/dispose` adapter for sources) is chosen elsewhere.

This chapter specifies the **synchronous, glass-floor reactive core**: three declaration forms (`signal`, `derived`, `effect`), two binding operators (`~>`, `->`), two scoping combinators (`batch`, `untrack`), one interval form (`every`), and the runtime graph they all lower onto. Two invariants frame the whole chapter:

- **INV-react-1 (synchronous settle).** Para's core reactive graph settles **synchronously and eagerly**: when a write completes outside any batch, every effect transitively reachable from it has already re-run before the writing statement returns. There is no microtask defer, no scheduler tick, no "next frame" in the core (the `.pui` bridge schedules into the renderer's `$effect`; scheduling *annotations* are §9.5, Proposed). This is what makes a `.pts` reactive program reason like straight-line code.
- **INV-react-2 (acyclic graph).** The dependency graph (signals/deriveds as nodes, effects/deriveds as subscribers) is a **DAG**. A `derived`/`effect` whose evaluation writes a signal it transitively reads is a cycle; the core does not detect it statically (it is a runtime hazard — see §6.4), and the `pure` obligation on `derived` (§2, [→ ch:purity-and-determinism]) is the discipline that keeps it acyclic.

&gt; **Glass floor (I1).** Every form below lowers to plain calls into `@lyku/para-signals` (the `.pts` target) or to runes (the `.pui` target). The runtime is ~200 lines of readable JS (`signal`/`derived`/`effect`/`batch`/`untrack` + the three node classes); the lowering is a local rewrite. Nothing here is reflection-driven or `any`-degraded (I3). A developer can read the emitted `const count = signal(0)` and the `WritableSignal` it constructs.

---

## 1. `signal` — the writable reactive cell

A `signal` is a writable container whose reads, *inside a tracking context*, subscribe the active observer and whose writes invalidate subscribers.

### Grammar

```
SignalDecl ::= "signal" Ident TypeAnn? "=" Expr Interval? ";"
TypeAnn    ::= ":" Type
Interval   ::= "every" Expr                    ⟨§7⟩
```

- `Ident` — the cell name. After lowering it binds to a `WritableSignal<T>` value in `.pts`; in `.pui` it binds to a plain reactive identifier (the `.set`/`.get` are hidden by the bridge) [→ ch:pui-component-model].
- `TypeAnn` is optional; when present it annotates the *value* type `T`, not the cell type. `signal count: int = 0` means the cell holds an `int`; the lowering threads `T` so the inferred result is `WritableSignal<number>`.
- `Interval` (`every Expr`) makes the cell interval-driven; specified in §7.

**Lexical note (statement-position keyword detection).** `signal` is recognized as the keyword only before `NAME [=,;:!]` (catalog `signal-decl`: `\b(signal)\b(?=\s+[A-Za-z_$][\w$]*\s*[=,;:!])`). A bare value use — `const signal = makeSignal()`, `signal()` as a call, `obj.signal` — is *not* rewritten; this is what keeps the surface a strict superset [→ ch:overview-and-surfaces §1.1]. One `signal` statement MAY declare comma-separated declarators (`signal a = 1, b = 2;`); each is lowered independently (this matters for `.pui`, where escape analysis is per-name — §1.4).

### Static semantics

- **Binding structure.** `signal NAME = EXPR` introduces `NAME` into the enclosing scope as an immutable `const` binding (the *cell* is `const`; the *value* is mutable through `.set`). Re-declaring `NAME` is a host-level redeclaration error.
- **Type inference.** Absent `TypeAnn`, `T` is inferred from `EXPR` exactly as `const x = EXPR` would infer in the host, then lifted: `signal(EXPR): WritableSignal<typeof EXPR>`. With `TypeAnn`, `T` is fixed and `EXPR` must be assignable to it (a host assignability error otherwise — never a silent `any`, I3).
- **No reactive obligation on the RHS.** `EXPR` is evaluated **once, eagerly, untracked** at construction. Reads of other signals inside `EXPR` do *not* create a dependency — `signal x = y.get() + 1` snapshots `y` once. (To track `y`, use `derived` — §2. The Proposed bare-read sugar §9.1 does not change this: a `signal` RHS never subscribes.)

### Dynamic semantics

The cell is a `WritableSignal` with `_value` and a `_subs: Set` of subscribers (effects and deriveds). Its operations:

1. **`get()`** — calls `track(this)`: if a tracking context is active (`currentEffect ≠ null`), adds `this` to the observer's `_deps` and the observer to `this._subs` (bidirectional edge). Returns `_value`. A `get()` with no active context is a plain read — *no* subscription (this is what `peek`/`untrack` exploit, §4, §8).
2. **`peek()`** — returns `_value` with **no** `track` call. Always non-subscribing, regardless of context.
3. **`set(v)`** — `Object.is`-guarded (§6.1): if `Object.is(v, _value)`, returns immediately (no notification). Otherwise stores `v`, then runs the **empty-subs guard** (§6.2): if `_subs.size === 0`, returns (the value is stored; later reads observe it; there is nothing to invalidate). Otherwise enters a batch (`batchDepth++`), invalidates a *snapshot* of `_subs` (`Array.from(this._subs)` — so re-subscription during invalidation doesn't mutate the iteration), then `batchDepth--` and, at depth 0, `drain()`s the effect queue (§3).
4. **`update(fn)`** — `set(fn(_value))`; sugar for read-modify-write. (`update` is a runtime method, not Para surface; reachable from the glass floor.)

&gt; **INV-react-3 (write is settle).** A `set()` at `batchDepth === 0` with non-empty subs returns only *after* the synchronous drain completes (INV-react-1). Inside a `batch`/during an in-flight drain, `set()` enqueues and returns; the enclosing drain absorbs it.

### Desugar

```
# Desugar:  signal NAME = EXPR
Para (.pts):
    signal count = 0;
TS (.pts):
    const count = require("@lyku/para-signals").signal(0);
```

&gt; The canonical ParaBun lowering and the `@lyku/para-transpile` mirror both emit the `require("@lyku/para-signals").signal(EXPR)` form verbatim (this is the parity-asserted byte target — `transformSignalDecls`). A module that prefers an `import` binding ejects the `require` per the glass floor; the spec asserts only the *referenced helper* (`signal`), not the import style.

The `.pui` lowering differs because the cell must bridge into the renderer's `$state`. The full rules (escape analysis, HMR) are [→ ch:pui-component-model]; the two shapes are previewed in §1.4 because a desugaring that omitted them would mislead.

### Examples

```pts
// .pts
signal count = 0;
signal name: string = "ada";
count.set(count.get() + 1);          // explicit get/set in .pts (bare-read is §9.1, Proposed)
count.update(n => n + 1);
console.log(count.peek());           // non-subscribing read
```

```pts
// ✗ counter-example
signal total: int = "0";             // ✗ host error: string not assignable to int — no silent any (I3)
```

### 1.4 `.pts` vs `.pui` shape (preview; full rules → ch:pui-component-model)

In `.pts`, a `signal` *is* a `WritableSignal` value: you call `.get()`/`.set()`/`.peek()` (or use §9.1 bare-read, Proposed). In `.pui`, the same keyword **bridges to runes** so the value reads as a plain variable in markup. Escape analysis (LYK-886) picks one of two shapes:

```
# Desugar:  signal NAME = EXPR   (.pui, two shapes — full rules → ch:pui-component-model)
Para (.pui):
    signal count = 0;
Runes (.pui, INLINED — count provably component-local):
    let count = $state(0);                                        // assignments stay native; no para bridge
Runes (.pui, BRIDGED — count escapes via signalOf/context/export):
    const __sig_count = signal(0);
    let count = $state(__sig_count.peek());
    $effect.pre(() => __sig_count.subscribe((__v: typeof count) => { count = __v; }));
    // assignments rewrite to __sig_count.set(EXPR); subscription cleanup runs onDestroy
```

The bridge keeps a `WritableSignal` alongside the `$state` cell *only when an external Para observer can see it* (the conservative fallback — over-inlining would silently drop cross-system updates, a correctness bug). This is the I2 seam: the **keyword is identical across surfaces**; only the lowering target differs. This chapter treats `signal` as its `.pts` `WritableSignal` meaning; the bridge is the view-substrate's business.

---

## 2. `derived` — the read-only computed cell

A `derived` is a lazily-memoized read-only cell whose value is a function of other reactive reads, re-computed on demand when any dependency changes.

### Grammar

```
DerivedDecl ::= "derived" Ident TypeAnn? "=" Expr ";"      ⟨expression form⟩
              | "derived" Ident Block                       ⟨block form → $derived.by⟩
```

**Lexical note.** `derived` fires before `NAME [=,;:!{]` (catalog `derived-decl`). The `{` alternative distinguishes the **block form** (`derived NAME { … }`) from the **expression form** (`derived NAME = EXPR`). The block form's body is a statement list ending in an implicit/explicit value; it exists for multi-statement computations that an expression cannot express. As with `signal`, the expression's end is scanned ASI-aware (`derivedInitEnd`) so a ternary/binary/member-chain can wrap across lines.

### Static semantics

- **Read-only binding.** `NAME` binds to a `DerivedSignal<T>` (or, in `.pui`, a `$derived`/`$derived.by` value). There is **no `.set`** — assigning a derived is a compile error in surface terms (the lowered value has no `set`; the type carries no writer). This is the structural difference from `signal`.
- **`T` inference.** Expression form infers `T` from `EXPR`; block form infers from the block's result expression. `TypeAnn` fixes `T` and the body must produce it.
- **Purity obligation.** A `derived` body SHOULD be pure (referentially transparent, no side effects, no writes to reactive cells) — it may run zero, one, or many times and its result is memoized. Writing a signal from a `derived` body risks INV-react-2 (cycle) and yields undefined ordering. The `pure` marker and its checking are [→ ch:purity-and-determinism]; this chapter states the obligation, that chapter enforces it.

### Dynamic semantics

A `DerivedSignal` carries `_value`, `_dirty` (starts `true`), `_subs`, and `_deps`. It is **lazy** (computes on first read) and **push-dirty / pull-recompute**:

1. **`get()`** — if `_dirty`, `_recompute()`; then `track(this)` (a derived is *also* a node — effects that read it subscribe to it) and return `_value`.
2. **`_recompute()`** — clears its old dep edges (`for d of _deps: d._subs.delete(this)`; `_deps.clear()`), sets `currentEffect = this` (the derived plays the tracking role), runs `_compute()`, restores `currentEffect`, clears `_dirty`. Because tracking is re-established *every* recompute, the dependency set is **dynamic** (§5): a branch not taken this run drops its subscription.
3. **`_invalidate()`** — if already `_dirty`, returns (idempotent — the empty-cascade short-circuit). Otherwise marks `_dirty` and propagates `_invalidate()` to its own `_subs` (effects/deriveds reading it). Note: invalidation is *push* (eager dirty-marking) but recomputation is *pull* (lazy, on next read) — a derived nobody reads is never recomputed.
4. **`peek()`** — recomputes if dirty, returns `_value`, but does **not** `track`. The non-subscribing read of a derived.

&gt; **Edge case (diamond / derived-through-derived).** When `set()` invalidates a signal that feeds *both* an effect directly *and* a derived the same effect reads, the `set()` wraps the whole invalidation cascade in a `batch` (`batchDepth++` around the `_subs` loop). This guarantees the derived is marked dirty *before* the effect drains, so the effect recomputes against the fresh derived — never a stale read. This batched-invalidation is why `signal.set` enters the batch machinery even for a single write with a diamond downstream.

### Desugar

```
# Desugar:  derived NAME = EXPR   (expression form)
Para (.pts):
    derived doubled = count.get() * 2;
TS (.pts):
    const doubled = require("@lyku/para-signals").derived(() => count.get() * 2);
```

```
# Desugar:  derived NAME { BODY }   (block form)
Para (.pui):
    derived summary {
      const items = cart.items;
      return items.length === 0 ? "empty" : `${items.length} items`;
    }
Runes (.pui):
    const summary = $derived.by(() => {
      const items = cart.items;
      return items.length === 0 ? "empty" : `${items.length} items`;
    });
```

&gt; The expression form wraps the RHS in `() => EXPR` and routes through `derived(...)` (`.pts`) / `$derived(...)` (`.pui`); the block form routes through `$derived.by(() => { … })` (LYK-892). In `.pts` the block form lowers to `derived(() => { … })` (a statement-bodied arrow). If `EXPR` reads no signals, the result is a derived that never re-fires — Para does *not* error (mirroring `signal x = LITERAL`); the user is explicit. The §9.1 bare-read sugar makes `derived doubled = count * 2` read without `.get()`; §9.4 adds a custom-equality form.

### Examples

```pts
// .pts
signal first = "Ada";
signal last  = "Lovelace";
derived full = first.get() + " " + last.get();   // recomputes when either changes
console.log(full.peek());                          // "Ada Lovelace", computed on demand
```

```pts
// ✗ counter-example
derived d = count.get();
d.set(5);          // ✗ error: DerivedSignal has no `set` — a derived is read-only
```

---

## 3. The reactive graph & synchronous drain

The three node kinds share one shape so that `signal.set` can treat every subscriber uniformly. Their relationship and the drain protocol are the heart of INV-react-1.

### Node roles

| Node | Reads track? | Has subs? | Has deps? | Re-runs? |
|---|---|---|---|---|
| `WritableSignal` | source (read tracks the observer) | yes | no | n/a — written, not run |
| `DerivedSignal` | source *and* observer | yes | yes | recomputes lazily on read after dirty |
| `Effect` | observer only | no (leaf) | yes | re-runs eagerly when a dep changes |

An **effect** is a leaf: it observes but nothing observes it, so its invalidation must *do* something immediately rather than wait to be pulled. A **derived** is a hinge: it observes (so it has `_deps`) and is observed (so it has `_subs`), letting it sit between signals and effects and absorb diamonds (§2 edge case).

### Tracking

```
currentEffect  : the active observer (Effect or DerivedSignal), or null
track(node)    : if currentEffect, add node→currentEffect._deps and currentEffect→node._subs
```

`track` is the single funnel through which *every* dependency edge is formed. It is called by `WritableSignal.get` and `DerivedSignal.get`, never by `peek`. This is the entire subscription mechanism — there is no decorator, no compile-time dependency extraction; deps are discovered **by running the body and seeing what it reads** (§5).

### The queue and the eager drain

```
queue      : Set<Effect>       (de-dups — an effect invalidated twice runs once per drain)
batchDepth : int               (suppresses drains while > 0)
flushing   : bool              (prevents re-entrant drains)
```

The protocol (numbered, since ordering is normative):

1. `effect._invalidate()` → `enqueue(effect)`: `queue.add(effect)`; if `batchDepth === 0 && !flushing`, call `drain()`.
2. `drain()` sets `flushing = true`, then **loops while the queue is non-empty**: snapshot `pending = Array.from(queue)`, `queue.clear()`, run each non-disposed effect's `_execute()`. The loop re-checks `queue.size` so an effect *scheduled during the drain* (because it ran and a downstream `set` enqueued another effect) is absorbed in the same drain — not deferred to a microtask.
3. `flushing = false` in a `finally`.

&gt; **Edge case (re-entrant scheduling).** A `set()` *inside* an effect body does not start a nested drain: `flushing` is `true`, so `enqueue` just appends. The outer `drain()`'s `while (queue.size)` picks it up. This is how the core stays synchronous yet single-pass — there is exactly one live drain at a time, and it runs to fixpoint.

&gt; **Edge case (drain order is not topological).** The queue is a `Set`; effects drain in **insertion order**, not a computed topological order. Correctness does not depend on effect *order* because deriveds are dirtied eagerly *before* any effect runs (the batched invalidation, §2 edge case), so whatever order effects fire in, each reads up-to-date derived values. Order among independent effects is therefore insertion order and SHOULD NOT be relied upon for semantics (an effect that needs another effect's write is a smell — model it as a derived).

### Effect re-run protocol

`Effect._execute()` (also the constructor's first action — effects run **once eagerly** on creation):

1. If disposed, return.
2. If a cleanup from the prior run exists (`typeof _cleanup === "function"`), run it (swallowing throws), null it.
3. Clear old dep edges (`for d of _deps: d._subs.delete(this)`; `_deps.clear()`) — the precondition for dynamic re-subscription (§5).
4. Set `currentEffect = this`, run `fn()`. If `fn` returns a function, store it as `_cleanup`. Restore `currentEffect`.

`Effect.dispose()` runs the final cleanup and severs all dep edges; idempotent.

---

## 4. `effect` — the imperative subscriber

An `effect` runs a body immediately and re-runs it whenever any reactive value it *read* changes. It is the only core form that performs side effects.

### Grammar

```
EffectDecl ::= "effect" Block          ⟨statement-bodied; explicit return cleanup⟩
             | "effect" Expr ";"        ⟨expression-bodied; implicit-return cleanup⟩
```

**Lexical note (statement-position disambiguation).** `effect` is the keyword only at statement position followed by `{` *or* whitespace + an identifier-start (catalog `effect`: `\b(effect)\b(?=\s*\{|\s+[A-Za-z_$])`). The forms `effect(`, `effect.`, `effect[`, `effect=`, `effect:`, `effect;` keep `effect` as a **plain identifier** — so `const effect = …; effect(x)` is untouched (superset closure). The single-statement form is scanned with the same ASI-aware `derivedInitEnd` end-finder as `derived`.

### Static semantics

- **Block vs expression cleanup channel.** Both forms register a teardown the same way — *if the body's value is a function, it is the cleanup* — but they differ in how that value arises:
  - **Block form** `effect { … }`: cleanup is an **explicit** `return someFn` inside the block. No return ⇒ no cleanup.
  - **Expression form** `effect EXPR`: the expression's value *is* the (possible) cleanup. `effect useKeybind("ctrl+s", save)` registers `useKeybind`'s returned unsubscribe as the cleanup — the implicit-return channel. This is the precise reason the expression form lowers to an **expression-bodied** arrow `() => EXPR` (preserving the value) rather than a statement-bodied `() => { EXPR }` (which would discard it).
- **No type obligation.** An effect produces no binding (it returns a dispose handle in `.pts` — `effect(...)` returns `() => e.dispose()` — but the surface form is a statement, not a declaration). Its body is type-checked as ordinary host code.
- **Purity is *not* required** (unlike `derived`) — effects are exactly where side effects live (I-principle 5: effects are explicit and tracked).

### Dynamic semantics

Governed by §3's `Effect._execute`. Key consequences:

1. **Eager first run.** The body runs synchronously at the point of declaration, establishing the initial dependency set.
2. **Cleanup-before-rerun (LIFO within an effect).** On each re-run, the *prior* run's cleanup fires **before** the body re-executes (step 2 of `_execute`) — so an effect that opens a subscription closes the old one before opening the new. On dispose, the last cleanup fires once.
3. **Re-subscription each run** (§5): the dep set is rebuilt every execution; a dependency only read on the not-taken branch is dropped.

### Desugar

```
# Desugar:  effect { BODY }   (block form)
Para (.pts):
    effect {
      console.log("count is", count.get());
      return () => console.log("cleanup");
    }
TS (.pts):
    require("@lyku/para-signals").effect(() => {
      console.log("count is", count.get());
      return () => console.log("cleanup");
    });
```

```
# Desugar:  effect EXPR   (expression form — implicit-return cleanup)
Para (.pts):
    effect useKeybind("ctrl+s", save);
TS (.pts):
    require("@lyku/para-signals").effect(() => useKeybind("ctrl+s", save));
    //                                    ^ expression-bodied: the return value (an unsubscribe)
    //                                      becomes the effect's cleanup — NOT discarded.
```

&gt; `.pui` lowers `effect` to `$effect(() => { … })` (and `$effect.pre` for the cross-system bridge cases) [→ ch:pui-component-model]. The expression-vs-block distinction and the implicit-return cleanup channel are identical across surfaces.

### Examples

```pts
// .pts
signal count = 0;
effect {
  console.log("count =", count.get());     // runs now (count=0), and on every change
}
count.set(1);                              // synchronously logs "count = 1" before this returns (INV-react-1)
```

```pts
// .pts — implicit-return cleanup
signal el = document.body;
effect addResizeListener(window, onResize);   // unsubscribe returned by addResizeListener is the cleanup
```

```pts
// ✗ counter-example (disambiguation)
const effect = make();
effect(x);          // NOT lowered — `effect(` keeps `effect` as a plain identifier (superset closure)
```

---

## 5. Dynamic dependency tracking

Dependencies are **discovered by execution, not declared**, and **rebuilt on every run**. This is the property that makes conditional reactivity correct without a static dependency graph.

### Mechanism

Each observer (`Effect` or `DerivedSignal`) holds `_deps: Set`. On every `_execute`/`_recompute`:

1. The observer first **tears down** its existing edges (`for d of _deps: d._subs.delete(this); _deps.clear()`).
2. Sets `currentEffect = this`.
3. Runs the body. Every `signal.get()` / `derived.get()` reached *this run* calls `track`, re-adding the edge.
4. Restores `currentEffect`.

Because the set is cleared and rebuilt, the dependency set is exactly **the cells read on the most recent run** — no more, no less.

### Why it matters (conditional dependencies)

```pts
// .pts
signal showName = true;
signal name = "Ada";
signal id = 42;
effect {
  if (showName.get()) console.log(name.get());   // depends on showName + name
  else console.log(id.get());                    // depends on showName + id
}
```

- Initial run (`showName=true`): deps = `{showName, name}`. A write to `id` does **not** re-run the effect.
- `showName.set(false)`: re-runs; deps rebuilt to `{showName, id}`. Now `name` writes are ignored and `id` writes re-run it.

&gt; **INV-react-4 (no stale subscriptions).** After any observer run, its `_subs` membership on each former dependency is removed unless that dependency was read again. There is no leak of a no-longer-relevant edge — `name` cannot wake an effect that no longer reads it.

&gt; **Edge case (read a signal you also write in the same effect).** An effect that both reads and writes the *same* signal will, on the write, attempt to re-enqueue itself. The `Object.is` guard (§6.1) stops this when the value is unchanged; when it genuinely changes, the effect re-runs once more (drained in the same loop) and either converges (next value equal → guard stops) or loops. This is the runtime face of the acyclic obligation (INV-react-2): the *language* does not forbid it, the *discipline* (deriveds for computed values, effects for genuine side effects) does. A non-converging self-write is a program bug, surfaced as a hang, not a silent miss.

---

## 6. Change detection, guards, and batching

### 6.1 `Object.is` change detection

`WritableSignal.set(v)` short-circuits when `Object.is(v, _value)`. Consequences:

- `signal x = 0; x.set(0)` — no notification, no drain. `NaN` is handled correctly (`Object.is(NaN, NaN) === true`); `+0`/`-0` are distinguished (`Object.is(+0, -0) === false`).
- **Reference, not structural, equality for objects.** `x.set({...x.peek()})` notifies even if the new object is field-equal, because it is a different reference. To suppress notification on a structurally-equal object, use the Proposed custom-equality derived (§9.4) or replace with a value the `Object.is` guard accepts.

### 6.2 Empty-subs guard

If `_subs.size === 0`, `set()` stores the value and returns *before* entering the batch/drain machinery. Rationale and guarantees:

- **Why it is safe.** The new value is already stored, so later `get()`/`peek()` observe it. And whenever `batchDepth === 0` the queue is already empty (writes drain eagerly), so the skipped `drain()` was always a no-op on the unobserved-write path.
- **Why it exists.** It elides the `Array.from(_subs)` snapshot + the `batchDepth` dance + the `drain()` call on the hot *unobserved-write* path — measured (per the synced-mirror bench) as the bulk of the per-mirror update tax (~5.3% of update cost; ~168 ns/mirror). A signal that nobody is currently observing is a pure store.

&gt; **INV-react-5 (empty-subs transparency).** The empty-subs guard is semantically invisible: for any observation sequence, a signal with the guard and one without are indistinguishable. It is an optimization, asserted by a test that counts `drain()` invocations (`__test.drainCount`) and verifies a subscriber-less `set` performs **zero** drains.

### 6.3 `batch(fn)` — coalesced transactions

```
# Desugar:  batch — runtime helper (no surface keyword)
TS:
    batch(() => { a.set(1); b.set(2); c.set(3); });   // effects depending on a,b,c run once total
```

`batch(fn)` increments `batchDepth`, runs `fn`, decrements, and at depth 0 `drain()`s. While `batchDepth > 0`, every `set` enqueues its subscribers (via the invalidation cascade) but no drain fires; the single drain at the end runs each affected effect **once**, against the fully-updated values. Batches **nest** (depth-counted) — only the outermost exit drains.

&gt; **Dynamic semantics (batch + diamond).** Inside a batch, deriveds are still invalidated eagerly (dirty-marked) on each `set`, but recomputed lazily when an effect finally reads them in the post-batch drain — so a derived feeding two batched signals recomputes at most once.

### 6.4 Glitch freedom & the cycle hazard

- **Glitch freedom.** Because `signal.set` batches its own invalidation cascade (§2 edge case) and deriveds dirty-mark before effects drain, an effect never observes a *partially-updated* derived (a "glitch"). Within a single `set` (or a `batch`), all reachable deriveds are dirtied before any reachable effect runs.
- **Cycles (INV-react-2).** A `derived`/`effect` that writes a signal it transitively reads forms a cycle. The core does **not** detect it statically; at runtime it either converges via the `Object.is` guard or diverges (hang). The structural defense is the purity obligation on `derived` ([→ ch:purity-and-determinism]) and the discipline that effects produce side effects, not feedback into their own inputs.

### 6.5 `untrack(fn)` — read without subscribing

```
# Desugar:  untrack — runtime helper
TS:
    effect(() => {
      const live = a.get();                  // tracked: re-runs when a changes
      const once = untrack(() => b.get());   // read b WITHOUT subscribing
      log(live, once);
    });
```

`untrack(fn)` saves `currentEffect`, sets it to `null`, runs `fn`, restores. Any `get()` inside `fn` finds no active observer and therefore does not `track`. Use it to read a value an effect should *use but not depend on*. The §9.3 Proposed `peek`/`tracked` surface makes this a first-class read syntax rather than a wrapping call.

---

## 7. `signal NAME every MS` — the interval-driven signal

### Grammar

```
SignalDecl ::= "signal" Ident TypeAnn? "=" Expr Interval? ";"
Interval   ::= "every" Expr                  ⟨MS — the interval in milliseconds⟩
```

**Lexical note.** `every` is a **postfix** keyword: it is recognized only when preceded by a `)`/digit/identifier-char and followed by a number/`(`/identifier (catalog `every-postfix`: `(?<=[\)\d\w$])\s+(every)\s+(?=\d|[A-Za-z_$\(])`). This keeps an identifier beginning with `every` from being mis-lexed. `MS` (`Expr`) may itself be reactive or a unit literal (the §90 `100ms` proposal, [→ ch:lexical-and-expression-syntax]).

### Static & dynamic semantics

- The cell is an ordinary `WritableSignal<T>` whose **value is re-evaluated from `EXPR` on a timer** of period `MS`. `EXPR` is re-run every `MS` ms (untracked, like the initial RHS) and the result `set()` into the cell; the `Object.is` guard suppresses no-op ticks.
- The interval is **owned by the declaration's scope**: in `.pui` it is auto-cleared on component unmount (the bridge registers an `onDestroy` clear); in `.pts` it follows the enclosing scope's teardown discipline ([→ ch:effects-lifecycle-and-concurrency] for explicit-scope cases).
- The canonical use is a clock or poll: `signal now = Date.now() every 1000` ticks once a second.

### Desugar

```
# Desugar:  signal NAME = EXPR every MS
Para (.pts):
    signal now = Date.now() every 1000;
TS (.pts):
    const now = require("@lyku/para-signals").signal(Date.now());
    const __int_now = setInterval(() => now.set(Date.now()), 1000);
    // teardown: clearInterval(__int_now) at scope exit (onDestroy in .pui)
```

&gt; The interval form is *not* a new node kind — it is a `WritableSignal` plus a timer that writes it. Everything downstream (deriveds, effects, the empty-subs guard) behaves identically; the only difference from a hand-written `setInterval(() => now.set(…))` is that Para owns the teardown (glass floor: a developer reads the `setInterval` and can eject it).

### Example

```pui
<!-- .pui -->
<script lang="ts">
  signal now = Date.now() every 1000;
  derived clock = new Date(now).toLocaleTimeString();
</script>
<p>{clock}</p>
```

---

## 8. Binding operators `~>` and `->`

Two operators lower a common pattern — "keep a sink in step with a reactive source" — to an `effect`. They are *expression-position* operators that emit a statement-position effect.

### Grammar

```
ReactiveBind ::= Expr "~>" Expr        ⟨A ~> B  : B is the sink, A the source⟩
CallBind     ::= Expr "->" Expr        ⟨A -> fn : fn(A) on every change⟩
```

**Lexical note.** `~>` (catalog `rbind-op`) and `->` (catalog `callbind-op`) are multi-char and unambiguous against `<`. `->` carries a negative lookbehind guarding against `-->`, `=>`, and `<-` (`(?<![\-=<])->`); the scanner additionally rejects a following `>`/`=`. Both bind at *assign* precedence — looser than `||`/`&&`, tighter than the comma operator — and their operand bounds are found by walking balanced parens to the nearest statement delimiter (`;`, top-level `,`, `)`, `]`, `}`, newline). LHS/RHS may span template literals (the scanner is string-aware).

### Static & dynamic semantics

- **`A ~> B` (reactive-bind / assignment binding).** Lowers to an `effect` that assigns `B = A`. Any reactive read inside `A` is tracked (because the assignment runs in an effect body), so the binding re-fires on dependency change and keeps `B` synchronized to `A`. `B` is the sink (an lvalue); `A` is an arbitrary expression.
- **`A -> fn` (call-bind).** Lowers to an `effect` that calls `fn(A)`. `fn` must be a *callable target* (identifier, property access, or index access) — the canonical parser rejects arrow literals and bare calls as the RHS. (The JS mirror does not re-check this; a non-callable `fn` throws at first dependency change.) Use it to push a reactive value into an imperative sink (`level -> meter.setValue`).
- Both inherit all `effect` semantics: eager first run, dynamic re-subscription, synchronous settle.

### Desugar

```
# Desugar:  A ~> B   (reactive-bind)
Para (.pts):
    count.get() * 2 ~> doubled;
TS (.pts):
    require("@lyku/para-signals").effect(() => { doubled = count.get() * 2; });
```

```
# Desugar:  A -> fn   (call-bind)
Para (.pts):
    level.get() -> meter.setValue;
TS (.pts):
    require("@lyku/para-signals").effect(() => { meter.setValue(level.get()); });
```

### Example

```pts
// .pts
signal celsius = 20;
let fahrenheit = 0;
celsius.get() * 9/5 + 32 ~> fahrenheit;     // fahrenheit tracks celsius reactively
celsius.get() -> console.log;               // logs on every change
```

&gt; Note the asymmetry that motivates the Proposed two-way bind (§9.2): `~>` is **one-directional** — it drives `B` from `A` but a write to `B` does not flow back to `A`. A genuine two-way binding requires the paired-effect, loop-suppressed lowering of `<~>`.

---

## 9. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts`/the parser today). Each includes a desugaring sketch so it remains glass-floor-compatible (I1) and lowers onto the *existing* runtime (`signal`/`derived`/`effect`/`batch`/`untrack`/`proxySignal`) — none requires a new node kind. They are gathered here because each is a reactive-core surface concern.

### 9.1 Bare-read sugar — `count` ⇒ `count.get()`  `Proposed`

**Rationale.** In `.pts`, a signal read today is an explicit `count.get()`; in `.pui` the bridge already hides it. The asymmetry is a papercut and a legibility tax (A3 — heavy syntax breeds avoidance). Bare-read sugar lets `.pts` read a signal by name *inside tracked contexts*, matching `.pui` and Svelte runes, **without** making the rule ambient (an un-principled "every identifier is a signal read" would be unreadable and break superset closure). The existing transpile mirror explicitly defers this to "v0.2 — it requires real scope analysis"; this section specifies the triggering rule that makes it sound.

**Grammar (sugar).** No new tokens. The sugar is a *read rewrite* keyed on a name's binding:

```
BareRead ::= Ident                         ⟨only when Ident resolves to a signal/derived binding
                                              AND appears in a tracked read position⟩
```

**The triggering rule (principled, not ambient).** A bare `Ident` rewrites to `Ident.get()` **iff** all hold:
1. `Ident` resolves (lexically) to a binding introduced by `signal`/`derived`/`every`/`source`/`async signal` in scope (a *reactive binding* — the rewriter has this set from the declarations it lowered).
2. The occurrence is in a **value (read) position** — not the LHS of an assignment, not the cell-name in its own declaration, not after `.`/in a member-access head where it is the object being `.get`-ed already, and not inside `peek(...)`/`tracked(...)` (§9.3) or `untrack(...)`.
3. It is **not** in a position that wants the cell itself — passing the signal to `signalOf(x)`, `x.subscribe(...)`, `x.set(...)`, or `effect(... x ...)` where `x` is used as the handle. The rule: **bare name = value; explicit `.set`/`.subscribe`/`signalOf` = handle.**

A write uses `count = EXPR` (Proposed assignment sugar → `count.set(EXPR)`) or the explicit `count.set(EXPR)`.

**Static semantics.** The rewrite is purely syntactic and scope-resolved; it introduces no `any` and changes no types (`count` had type `WritableSignal<number>`; `count.get()` has type `number` — the sugar yields the value type, which is what every read site wanted). Shadowing is respected: a local `const count = …` shadowing a signal disables the sugar for that scope (rule 1 fails).

**Dynamic semantics / desugar.** Identical to writing `.get()` by hand — so tracking, the empty-subs guard, everything is unchanged.

```
# Desugar (proposed):  bare-read sugar
Para (.pts):
    signal count = 0;
    derived doubled = count * 2;          // count ⇒ count.get()
    effect { console.log(count); }        // count ⇒ count.get() (tracked)
    count = count + 1;                     // LHS handle + RHS read ⇒ count.set(count.get() + 1)
TS (.pts):
    const count = signal(0);
    const doubled = derived(() => count.get() * 2);
    effect(() => { console.log(count.get()); });
    count.set(count.get() + 1);
```

**Counter-example.**

```pts
//#![bare-read]   (Proposed: opt-in per file so superset closure is preserved for legacy .pts)
signal count = 0;
const handle = count;          // ✗ error under bare-read: bare `count` is a VALUE; to take the handle write `signalOf(count)` or read via .get explicitly
count.subscribe(log);          // ok — explicit handle method, not rewritten
```

&gt; **Why opt-in (the superset tension).** Making bare-read *unconditional* would mean a pure-host `.pts` where a non-signal happens to share a name is unaffected (rule 1 gates it), but a file mixing a signal and a same-named plain read could shift meaning. To keep INV-overview-4 (superset closure) exact, bare-read is gated by a `//#![bare-read]` pragma (the §-overview pragma machinery); inside the pragma the rule above is total. `.pui` keeps its existing always-on bridge (the substrate already owns the read).

### 9.2 Two-way bind `A <~> B` — paired effects with loop-suppression  `Proposed`

**Rationale.** `~>` is one-directional (§8); a two-way binding (form field ⇄ model, replica ⇄ local edit) today needs two hand-written, manually loop-guarded effects. `<~>` makes the bidirectional case one operator, with the loop-suppression that naive paired effects get wrong (each effect's write would re-trigger the other forever).

**Grammar.**

```
TwoWayBind ::= LValue "<~>" LValue          ⟨both sides are reactive lvalues⟩
```

**Lexical note.** `<~>` is multi-char, unambiguous against `~>`/`<~`/`<=`. Both operands MUST be assignable reactive cells (signals or bridged `$state`); binding a derived (read-only) on either side is an error (`'<~>' requires writable cells; <name> is derived/read-only`).

**Static & dynamic semantics.** Lowers to **two** effects, one each direction, sharing a *loop-suppression latch*: when one direction is mid-write, the other direction's effect is inhibited so the echo does not bounce back. After both settle, an `Object.is` guard on each side prevents a no-op write (so a value that round-trips equal terminates). Initialization seeds **right-to-left** by convention (`A` takes `B`'s value on creation — the model is the source of truth), documented so the initial direction is not surprising.

```
# Desugar (proposed):  A <~> B
Para (.pts):
    model.field <~> input.value;
TS (.pts):
    {
      let __bind_lock = false;
      effect(() => {                                 // B → A
        const v = input.value;                       // tracks input.value
        if (__bind_lock) return;
        __bind_lock = true;
        try { if (!Object.is(model.field, v)) model.field = v; } finally { __bind_lock = false; }
      });
      effect(() => {                                 // A → B
        const v = model.field;                       // tracks model.field
        if (__bind_lock) return;
        __bind_lock = true;
        try { if (!Object.is(input.value, v)) input.value = v; } finally { __bind_lock = false; }
      });
    }
```

&gt; The `__bind_lock` latch is the loop-suppression: a write inside one effect sets the latch, so the *other* effect — which the write would schedule via the synchronous drain — early-returns instead of writing back. The `Object.is` guards make even a latch-missed echo a no-op. This is the smallest lowering that is glass-floor-readable; an implementation may instead suppress at the signal level (skip the reverse effect's enqueue during the forward write) for fewer guard checks.

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  signal name = "";
  // two-way: typing updates `name`, and a programmatic name.set updates the field
  name <~> formState.name;
</script>
<input value={name} oninput={e => name = e.target.value} />
```

### 9.3 First-class `peek` / `tracked` read syntax  `Proposed`

**Rationale.** `untrack(() => x.get())` is the only way today to read-without-subscribing inside an effect, and it is a wrapping call that nests awkwardly mid-expression. A postfix read syntax makes "depend on this" vs "use but don't depend" a *local, legible* choice at the read site — the dual of bare-read (§9.1).

**Grammar.**

```
PeekRead    ::= "peek" Ident            ⟨non-subscribing read — Ident.peek()⟩
TrackedRead ::= "tracked" Ident         ⟨explicit subscribing read — Ident.get(); the default under bare-read⟩
```

**Lexical note.** `peek`/`tracked` are contextual prefix keywords recognized only before a reactive `Ident` (same binding-set gate as §9.1), so `const peek = …` is untouched. `peek x` is sugar for `x.peek()`; `tracked x` is sugar for `x.get()` — useful inside an `untrack` block to *re-opt-into* tracking for one read.

**Static & dynamic semantics.** `peek x` reads the current value with no `track` (no subscription); `tracked x` forces a tracked read even where the surrounding context untracks. Both yield the value type. They compose with bare-read: under `//#![bare-read]`, `x` is `tracked x` by default and `peek x` is the explicit opt-out.

```
# Desugar (proposed):  peek / tracked
Para (.pts):
    effect {
      const live = total;          // bare-read ⇒ tracked ⇒ total.get()  (re-runs on change)
      const snap = peek limit;     // peek ⇒ limit.peek()                 (no subscription)
      check(live, snap);
    }
TS (.pts):
    effect(() => {
      const live = total.get();
      const snap = limit.peek();
      check(live, snap);
    });
```

**Example.**

```pts
// .pts — read `config` once without making the effect depend on it
effect {
  const cfg = peek config;             // use config but don't re-run when it changes
  applyTheme(theme, cfg);              // re-runs only when `theme` changes
}
```

### 9.4 `derived` with custom equality — cut spurious notifications  `Proposed`

**Rationale.** A `derived` notifies its subscribers whenever its recomputed value fails `Object.is` against the prior value — but for object/array results, a structurally-equal recompute is a *different reference* and fires a spurious cascade. A custom-equality form lets a `derived` declare "notify only when *this* comparison says different," cutting downstream effect churn (the most common reactive-perf footgun).

**Grammar.**

```
DerivedDecl ::= … | "derived" Ident "by" EqFn "=" Expr ";"
              |     "derived" Ident "by" EqFn Block
EqFn        ::= Ident | ArrowExpr        ⟨(prev: T, next: T) => boolean — true ⇒ EQUAL ⇒ suppress⟩
```

**Lexical note.** `by` is a contextual infix keyword legal only between the derived's name and its `=`/`{` (it cannot shadow an identifier in value position). `EqFn` returning `true` means "equal — suppress notification."

**Static & dynamic semantics.** The derived stores its last value and, on recompute, calls `EqFn(prev, next)`; if `true`, it keeps `prev` as `_value` and does **not** invalidate `_subs` (the recompute happened — laziness is unchanged — but the propagation is suppressed). `EqFn` must be pure and total over `T`; an impure equality is a correctness hazard (it could suppress a real change). The default (no `by`) is `Object.is`. The runtime gains one comparator field on `DerivedSignal`; the change-suppression rides the *existing* `_invalidate` short-circuit.

```
# Desugar (proposed):  derived NAME by EQ = EXPR
Para (.pts):
    derived visible by shallowEqual = items.get().filter(i => i.active);
TS (.pts):
    const visible = derivedWith(shallowEqual, () => items.get().filter(i => i.active));
    // derivedWith(eq, compute): a DerivedSignal whose _recompute compares
    //   eq(prevValue, nextValue); when true, _value stays and _subs are NOT invalidated.
```

**Example.**

```pts
// .pts — a sorted view that only notifies when the SET of ids changes
derived ids by (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  = rows.get().map(r => r.id).sort();
effect { render(ids.get()); }     // does NOT re-render when rows change but the id list is identical
```

&gt; **Interaction.** Custom equality is the `derived` counterpart to §6.1's reference-equality note: where a `signal` write can be made a no-op by reusing the value, a `derived` cannot control its recomputed reference — `by EQ` is how it regains the suppression. It composes with §9.1 bare-read (`ids` reads as a value).

### 9.5 Effect scheduling annotations — `pre`/`post`/`idle`/`raf`  `Proposed`

**Rationale.** The core drains effects synchronously and eagerly (INV-react-1) — correct for logic, but some effects *want* a phase: a DOM-measuring effect must run *after* paint, a layout-writing effect *before* it, an expensive recompute can wait for idle. `.pui` already exposes `$effect.pre`; lifting a small, closed annotation set to the `.pts` surface makes phase a declared, glass-floor property rather than a manual `requestAnimationFrame` wrap.

**Grammar.**

```
EffectDecl ::= "effect" Phase? Block
             | "effect" Phase? Expr ";"
Phase      ::= "pre" | "post" | "idle" | "raf"
```

**Lexical note.** `pre`/`post`/`idle`/`raf` are recognized only immediately after `effect` and before the body (`{` or expression). Absent a `Phase`, the effect is **synchronous** (today's default, INV-react-1) — the annotations are strictly additive.

**Static & dynamic semantics.**
- **`pre`** — runs *before* the renderer commits (maps to `$effect.pre` in `.pui`; in `.pts` it is a synchronous pre-flush, same as default but ordered before `post`/`raf` effects in the same drain).
- **`post`** — runs *after* the synchronous drain settles, in a `queueMicrotask` (or the renderer's after-commit phase in `.pui`).
- **`idle`** — schedules via `requestIdleCallback` (falling back to a timeout); for non-urgent work.
- **`raf`** — schedules via `requestAnimationFrame`; for visual/measurement work aligned to paint.

Crucially, **dependency tracking is unchanged** — the *body still runs in a tracking context and re-subscribes per run* (§5); only *when* the (re-)run is scheduled changes. A `post`/`idle`/`raf` effect coalesces multiple invalidations within its window into one run (natural debouncing).

```
# Desugar (proposed):  effect PHASE { BODY }
Para (.pts):
    effect raf { positionTooltip(anchor.get()); }
TS (.pts):
    effectScheduled("raf", () => { positionTooltip(anchor.get()); });
    // effectScheduled(phase, fn): builds an Effect whose _invalidate enqueues onto the
    //   phase's scheduler instead of the synchronous queue; tracking/_deps unchanged.
```

**Example.**

```pui
<!-- .pui -->
<script lang="ts">
  signal items = [];
  effect pre  { reserveScrollAnchor(); }        // before commit ($effect.pre)
  effect post { measureAndCache(listEl); }      // after commit (DOM is laid out)
  effect idle { prefetchNext(items); }          // when idle
</script>
```

&gt; **Interaction.** Scheduling annotations are the bridge to [→ ch:pui-component-model]'s `$effect.pre` and to [→ ch:effects-lifecycle-and-concurrency] (which owns the teardown of scheduled callbacks). They do **not** weaken INV-react-1 for *unannotated* effects — the synchronous-settle guarantee is the default and the annotations are an explicit opt-out, per phase, readable in the lowering.

### 9.6 Reactive collections — signalled Map/Set/array on `proxySignal`  `Proposed`

**Rationale.** A `signal` holding an array notifies only on *reference* replacement (`arr.set([...])`), so `arr.peek().push(x)` is silently non-reactive — a sharp footgun. The runtime already ships `proxySignal` (deep-reactive object/array via a tracking Proxy, mirroring Svelte 5 `$state`); this proposal lifts it to **surface** for Map/Set/array, so element-level reads and structural mutations are reactive without a manual `.set([...spread])`.

**Grammar.**

```
SignalDecl ::= … | "signal" Ident TypeAnn? "=" CollectionLit ";"
CollectionLit ::= ArrayLit | "new" "Map" Args? | "new" "Set" Args? | ObjectLit
```

The *same* `signal` keyword; the RHS being a collection selects the `proxySignal` lowering (a collection literal is the trigger — no new keyword).

**Static & dynamic semantics.** Lowers to `proxySignal(EXPR)` rather than `signal(EXPR)`. Then:
- **Reads track per-element/per-key.** Reading `state.items[0]` subscribes only to that index; reading `state.count` subscribes to that key — leaf writes notify only that key's signal.
- **Structural changes bump a `version` signal.** `push`/`delete`/new-key/`length` changes notify effects that iterated (`for…of`, `Object.keys`, `in`) — those reads subscribe to `version`.
- **Arrays keep a `length` signal** in sync so `arr.length` reads are reactive across `push`/`pop`/`splice`.
- **Non-plain values pass through unwrapped** (`Date`/`Map`-instance/`Set`-instance/class instances stay as-is — their methods rely on `this`-binding that a Proxy breaks). For Map/Set the surface form wraps the *container* reactively (size + membership via version), but element identity inside is the host's.

```
# Desugar (proposed):  signal NAME = <collection>
Para (.pts):
    signal state = { count: 0, items: ["a"] };
TS (.pts):
    const state = proxySignal({ count: 0, items: ["a"] });
    // state.count, state.items[0], state.items.push("b") are all reactive — no .set spread.
```

**Example.**

```pts
// .pts
signal cart = { items: [] as Item[], coupon: null };
effect { console.log("item count:", cart.items.length); }   // tracks length
cart.items.push(newItem);                                   // length signal fires → effect re-runs
cart.coupon = "SAVE10";                                     // key write → only coupon-readers re-run
```

```pts
// ✗ counter-example (the footgun this fixes)
signal arr = [1, 2, 3];          // (today, with plain signal()) 
arr.peek().push(4);              // ✗ silently non-reactive — no notification; proxySignal form fixes this
```

&gt; **Interaction.** Reactive collections are a `.pts`/`.pui` surface over the *existing* `proxySignal` runtime — no new node kind, just a different constructor selected by RHS shape. They compose with §9.1 (a proxied object read is a bare value), §9.4 (a `derived by shallowEqual` over a reactive collection cuts churn), and the sources chapter (`proxySignal` is *also* listed there as a source adapter; this section owns its **in-process signal** surface, the sources chapter owns its use as an external-producer sink) [→ ch:sources-async-and-native].

---

## 10. Chapter invariants (summary)

- **INV-react-1 (synchronous settle).** A write outside a batch settles the whole reachable graph before returning. §0, §3.
- **INV-react-2 (acyclic graph).** The graph is a DAG; cycles are a runtime hazard the purity discipline averts. §0, §6.4.
- **INV-react-3 (write is settle).** A non-empty-subs `set` at depth 0 returns only after its drain. §1.
- **INV-react-4 (no stale subscriptions).** Dynamic re-subscription drops edges not re-read. §5.
- **INV-react-5 (empty-subs transparency).** The empty-subs guard is observationally invisible. §6.2.

Every form in §§1–8 lowers to readable `@lyku/para-signals` calls or runes (I1); the keyword is surface-uniform and only the lowering target differs across `.pts`/`.pui` (I2); no form introduces a silent `any` (I3).

