---
title: "Effects, Lifecycle, Concurrency & Resource Scopes"
description: "Time- and scope-oriented control beyond steady-state reactivity: edge-triggered when/when not/when start/stop, defer LIFO cleanup, arena DeferGC…"
sidebar:
  order: 6
---

# Chapter: Effects, Lifecycle, Concurrency & Resource Scopes

&gt; **Status of this chapter:** Mixed. The edge-triggered `when`/`when not`/`when start`/`when stop` family, `defer`/`defer await`, `arena`, `parallel`/`para` (both forms), `memo`/`memo async`, and the `resource()`/`onDispose`/`alive`/`use` lifecycle are **Shipped** (in the ParaBun parser / `@lyku/para-transpile` mirror / `@lyku/para-signals` runtime today), with the noted partials called out per-construct. Everything in *Proposed Extensions* is **Proposed** (net-new surface, not in `src/language-surface.ts` or the parser).
&gt; **Cross-refs:** This chapter owns *time- and scope-oriented* control — "things that start, run, and tear down" plus concurrent composition. Steady-state `signal`/`derived`/`effect`, `batch`/`untrack`, `~>`/`->`, and the synchronous drain are [→ ch:reactivity-core]; this chapter builds on that core's `effect`/`when` machinery without redefining it. Async/native *sources* (`source`, `async signal`, `promiseSignal`, the `from*` adapters, `throttled`/`debounced`, `proxySignal`) are [→ ch:sources-async-and-native] — they **share** the `resource()`/`onDispose` lifecycle defined here, so this chapter is the lifecycle spine they cite. The `pure` marker, referential-transparency obligations, and `memo` cacheability *conditions* are [→ ch:purity-and-determinism] (this chapter owns `memo`'s runtime cache; that chapter owns *when caching is sound*). The `.pui` mount/unmount injection (`$effect.pre`, `onDestroy`, escape analysis) is [→ ch:pui-component-model]; this chapter specifies only the **Para-level scope semantics** a component lifecycle projects onto. The error-chain operators `..>`/`..!`/`..&` are [→ ch:lexical-and-expression-syntax]; this chapter cites them where `parallel` composes with per-RHS error isolation. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. The shape of the chapter — three lifetimes

[→ ch:reactivity-core] specifies the reactive graph as a *steady state*: a signal holds a value, deriveds recompute, effects re-run, and the whole thing settles synchronously. That model has no first-class notion of **time-as-edges** ("the moment a condition became true"), of **scope exit** ("run this when control leaves this block"), or of **structured concurrent composition** ("run these N things and join, or cancel the rest if one fails"). This chapter adds exactly those three lifetimes:

1. **Edge lifetimes** — `when EXPR { }` / `when not EXPR { }` / `when start { }` / `when stop { }`. A body that fires on the *transition* of a condition rather than on every change. Built on the core `effect` + a remembered previous value.
2. **Scope lifetimes** — `defer` (block-exit cleanup, LIFO), `arena` (a bounded allocation/GC region), and the `resource()`/`onDispose`/`alive`/`use` handle (an explicitly-disposed bundle of signals + teardown). These answer "when does this stop, and in what order do its pieces release?"
3. **Concurrent lifetimes** — `parallel`/`para` (fan-out join), `memo` (memoized call identity over time). These compose multiple computations whose lifetimes overlap.

The unifying property across all three is **explicit, ordered teardown** (I-principle 5 from [→ ch:overview-and-surfaces]: *effects are explicit; cleanup is `defer`/`onDestroy`/`return cleanup`, never implicit magic*). Every construct here has a single, named disposal moment and a stated ordering (LIFO unless noted), and every lowering is plain readable host code (I1).

&gt; **INV-effects-1 (LIFO teardown is the universal rule).** Wherever this chapter accumulates cleanups — `defer` statements in a block, `onDispose` registrations in a `resource` setup, child-task cleanups in the Proposed `scope`/`nursery` — they run in **reverse registration order** (last-registered first). This mirrors the host `using`/`await using` discipline `defer` lowers to (ES2024 disposal is LIFO), the `resource` runtime's `cleanups.splice(0).reverse()`, and the natural "release in the opposite order you acquired" invariant. A construct that disposes in a *different* order MUST say so explicitly; none in this chapter do.

&gt; **INV-effects-2 (idempotent disposal).** Every disposable in this chapter is safe to dispose more than once: the second and later `dispose()`/scope-exit is a no-op. `resource` guards this with a `disposed` latch; `defer`'s `using` binding is disposed exactly once by the host; the Proposed scopes carry the same latch. This is what lets a `resource` be both `defer`-scheduled *and* explicitly `.dispose()`-d without a double-free.

---

## 1. Edge-triggered `when` — firing on the transition

### 1.1 `when EXPR { }` and `when not EXPR { }`  `Shipped`

A `when` block runs its body on the **rising edge** of a boolean condition: the moment `EXPR` transitions from falsy to truthy. `when not EXPR { }` is the same machine over `!(EXPR)` — it fires on the moment `EXPR` becomes falsy. Unlike a bare `effect` (which re-runs on *every* dependency change), a `when` body fires only on the *transition*, and **re-arms**: after firing it waits for the condition to go false again before it can fire a second time.

**Grammar.**

```
WhenStmt   ::= "when" "not"? Expr Block
            |  "when" "start" Block WhenStop?
            |  "when" "stop"  Block            ⟨only as the trailing arm of a when … / when start⟩
WhenStop   ::= "when" "stop" Block
Block      ::= "{" Statement* "}"
```

**Lexical note.** `when` is contextual: the catalog fires `when-expr` only when `when` is followed by whitespace and a predicate-starting char (`[!A-Za-z_$(\d]`), and `when-not` only on the literal `when not` pair (`\b(when)\s+(not)\b`). At a statement boundary the canonical parser (and the `@lyku/para-transpile` mirror, `transformWhenBlocks`) requires the prior non-whitespace char to be a statement terminator (`;`, `{`, `}`, newline, or start-of-input) — a `when` *mid-expression* is left as a plain identifier. The predicate runs up to the first **top-level** `{` (paren/bracket depth tracked so an object literal or call inside the predicate does not prematurely end it). `start`/`stop` are recognized only as trailing block heads (`start` before `{`; `when stop` before `{`).

**Static semantics.** The predicate `EXPR` is an ordinary boolean-valued expression, type-checked as such; `when not EXPR` negates it (the lowering wraps it `!(EXPR)`, so `EXPR`'s own truthiness coercion is preserved). The body `Block` is an ordinary statement block with its own lexical scope. A `when` declaration is a **statement**, not an expression — it produces no value and may not appear in expression position. Reactive reads inside the predicate establish the dependency set exactly as a `derived`/`effect` would [→ ch:reactivity-core §5].

**Dynamic semantics.** A `when` lowers to a core `effect` that *remembers the previous truthiness of the predicate* and only invokes the body on a `false → true` step:

```
# Desugar:  when EXPR { BODY }
Para:
    when ready { connect(); }
TS:
    require("@lyku/para-signals").when(() => ready, () => { connect(); });

# Desugar:  when not EXPR { BODY }
Para:
    when not online { showOfflineBanner(); }
TS:
    require("@lyku/para-signals").when(() => !(online), () => { showOfflineBanner(); });
```

The `when(predicate, body)` runtime helper is the edge wrapper over `effect`. Its reference semantics (the contract every implementation MUST meet; the `@lyku/para-signals` shim form):

```ts
// Reference: the edge wrapper `when` lowers to.
export function when(predicate, body) {
  let prev = false;                       // pre-charge: condition assumed FALSE at t0
  return effect(() => {
    const now = !!predicate();            // tracked read — re-runs when deps change
    if (now && !prev) body();             // fire only on the false→true transition
    prev = now;
  });
}
```

1. On creation the wrapping `effect` runs once (synchronous, per INV-react-1). The pre-charge `prev = false` means: **if the predicate is already truthy at declaration time, the body fires immediately** (the initial run is itself a `false → true` step). If it is falsy, nothing fires and the edge is armed.
2. Each subsequent dependency change re-runs the tracked `effect`, recomputes `now`, and fires the body only when `now && !prev`. After firing, `prev = true` *disarms* — the body cannot fire again until the predicate goes false (re-arming) and true once more.
3. The body runs **inside the effect's tracking frame is suppressed** for the purpose of edges — i.e. the body's own reactive reads do not arm the predicate; only the predicate's reads drive re-evaluation. (Implementations SHOULD run `body()` so its reads are *not* added to the predicate effect's dependency set; the reference above relies on `body` not reading new predicate deps. A conforming implementation MAY `untrack(body)` to make this robust.)
4. Disposal: `when` returns the `effect`'s stop function. In `.pui` this is registered against `onDestroy` by the bridge [→ ch:pui-component-model]; in `.pts` it follows the enclosing scope's teardown discipline (`defer`, an enclosing `resource`, or manual stop).

&gt; **INV-effects-3 (edge, not level).** A `when` body fires **once per rising edge**, not once per truthy evaluation. Two consecutive writes that both leave the predicate truthy fire the body **zero** additional times. This is the defining difference from `effect { if (EXPR) … }`, which would run its body on every change while `EXPR` holds. The cost is one remembered boolean per `when`.

&gt; **Edge case (predicate truthy at t0).** Because the pre-charge is `false`, a `when alreadyTrue { … }` *does* fire on creation. If you want "fire only on a *future* rising edge, not the initial state," that is the Proposed `when start`/`when stop` pairing (§1.2) read in reverse, or — more precisely — you seed `prev` from the initial value; today the only surface for "skip the initial truthy" is to gate the body. This asymmetry is intentional and documented: edges are *cheap to arm late* but the default is "the moment it's true, including now."

&gt; **Edge case (synchronous self-falsification).** If the body, on firing, synchronously writes a signal that makes the predicate false again *within the same drain*, the effect re-runs, computes `now = false`, sets `prev = false`, and re-arms — all before control returns (INV-react-1). The body still fired exactly once for that edge. A body that toggles the predicate true→false→true in a tight loop is a program bug (a non-converging edge), surfaced as the same hang INV-react-2 describes for self-writing effects [→ ch:reactivity-core §6.4], not a silent miss.

**Example.**

```pts
// .pts
signal connected = false;
signal retries = 0;

when connected {
  retries.set(0);                 // fires the instant we go connected
  log("link up");
}

when not connected {
  retries.update(n => n + 1);     // fires the instant we drop
  log("link down");
}
```

```pts
// ✗ counter-example — when is a statement, not an expression
const x = when ready { 1 };       // ✗ error: `when` is a statement and yields no value
```

### 1.2 `when start { }` / `when stop { }` — the paired form  `Shipped (Partial)`

The paired form binds a **single condition's two edges** to two bodies without restating the predicate. `when start { }` is the rising-edge arm; an immediately-following `when stop { }` is the falling-edge arm of the *same* condition. The condition is the one established by the preceding `when EXPR` (or it is the implicit "this scope is alive" condition when `when start` stands alone as a lifecycle bracket).

**Grammar.** (restated from §1.1)

```
WhenPaired ::= "when" Expr Block ("when" "stop" Block)?      ⟨rising arm is the first block; stop is the falling arm⟩
WhenLife   ::= "when" "start" Block ("when" "stop" Block)?   ⟨lifecycle bracket: start at scope-enter, stop at scope-exit⟩
```

**Static semantics.** A `when stop { }` arm is legal **only** as the textual successor of a `when EXPR { }` (its falling-edge partner) or a `when start { }` (its scope-exit partner). A `when stop` with no preceding partner is a compile error (`when stop has no preceding when/when start to pair with`). The two arms share one predicate effect; they do not each re-evaluate.

**Pre-charge semantics.** The defining property of the paired form is **pre-charge**: the rising arm (`start`) participates in the same `prev`-seeded edge machine as §1.1, but the pairing makes the *falling* arm a first-class body rather than requiring a second `when not`. The semantics:

- `when start { }` fires on the `false → true` edge (including t0 if the condition is already true — same pre-charge as §1.1), exactly like `when EXPR`.
- `when stop { }` fires on the `true → false` edge, **and additionally on scope teardown if the condition was true at teardown** — this is the "pre-charge guarantees the stop runs" property: a `start` that fired guarantees its paired `stop` will run exactly once (either on a falling edge or on disposal), so the pair behaves like an acquire/release bracket. This is the LIFO-teardown invariant (INV-effects-1) applied to a condition's lifetime.

```
# Desugar:  when EXPR { START } when stop { STOP }
Para:
    when streaming { startMeter(); } when stop { stopMeter(); }
TS:
    require("@lyku/para-signals").whenPaired(
      () => streaming,
      () => { startMeter(); },          // rising arm
      () => { stopMeter();  },          // falling arm + teardown-if-active
    );
```

```ts
// Reference: the paired edge wrapper (extends §1.1's `when`).
export function whenPaired(predicate, onStart, onStop) {
  let prev = false;
  const stop = effect(() => {
    const now = !!predicate();
    if (now && !prev) onStart();
    if (!now && prev) onStop();
    prev = now;
  });
  // Teardown: if the condition is still active, run the stop arm once (pre-charge guarantee).
  return () => { if (prev) onStop(); stop(); };
}
```

**Dynamic semantics.** The single effect drives both arms off `prev`. The teardown closure enforces the pre-charge guarantee: a `start` that has not yet seen its `stop` gets one at disposal. This makes `when … { start } when stop { stop }` a **balanced bracket** — `start` and `stop` calls are always paired 1:1 over the lifetime, which is the property that makes it safe to acquire a resource in `start` and release it in `stop`.

&gt; **Status — Partial.** The `when-start` / `when-stop` catalog entries (`src/language-surface.ts`) ship as *recognized, highlighted* surface and the rising-arm lowering is exercised; the `whenPaired` runtime with the teardown-pre-charge guarantee is specified here as the normative contract and is the form a conforming implementation MUST emit. The standalone *lifecycle-bracket* `when start { }` (no preceding `when EXPR`, bracketing the enclosing scope's own alive/dead lifetime) is the thinnest part of the surface today and is hardened by §2.3's `resource` model, into which it most naturally lowers.

**Example.**

```pts
// .pts — acquire on the rising edge, release on the falling edge OR on teardown
signal recording = false;

when recording {
  const handle = openMic();        // acquire
  micHandle.set(handle);
} when stop {
  micHandle.peek()?.close();       // release — runs on stop edge, AND on dispose if still recording
  micHandle.set(null);
}
```

---

## 2. Scope lifetimes — `defer`, `arena`, and `resource`

### 2.1 `defer EXPR` / `defer await EXPR` — block-exit cleanup, LIFO  `Shipped`

`defer` schedules an expression to run when control leaves the **enclosing block**, in **LIFO** order relative to other `defer`s in the same block. It is Para's surface for the acquire-here/release-at-block-exit pattern, and it lowers directly onto the host's ES2024 `using` / `await using` disposal machinery — so the LIFO ordering is *the language's own scope-exit semantics*, not a bespoke stack.

**Grammar.**

```
DeferStmt ::= "defer" "await"? Expr ";"
```

**Lexical note.** `defer` fires (catalog `defer-stmt`: `\b(defer)\b(?=\s+[A-Za-z_$])`) at statement position followed by whitespace and an identifier-start; `defer(`/`defer.`/`defer=` keep `defer` as a plain identifier. The expression runs to the next **top-level** `;` (paren/bracket/brace depth tracked; strings/comments/regex skipped via region scanning — `transformDefer`). The optional `await` selects the async-disposal form.

**Static semantics.** `defer EXPR` is a statement; it yields no value. `EXPR` is evaluated **at block exit**, not at the `defer` site — so it captures variables by reference (the closure sees their values at teardown time, not at scheduling time). `defer await EXPR` requires the enclosing function to be `async` (it lowers to `await using`, which is only legal in an async context); using it in a sync function is a host-level error surfaced through the lowering. Multiple `defer`s in one block are legal and stack.

**Dynamic semantics.** Each `defer` lowers to a uniquely-named `using` binding wrapping the expression in a `Symbol.dispose` (or `Symbol.asyncDispose`) shape. The host runs `[Symbol.dispose]()` for `using` bindings **in reverse declaration order at block exit** — which gives LIFO for free (INV-effects-1):

```
# Desugar:  defer EXPR
Para:
    defer file.close();
TS:
    using __paraDefer0 = __parabunDefer0(() => file.close());

# Desugar:  defer await EXPR
Para:
    defer await conn.drain();
TS:
    await using __paraDefer1 = __parabunAsyncDefer0(async () => conn.drain());
```

```ts
// Runtime shims (bun:wrap / parabun-browser-shims): the disposal shape.
export const __parabunDefer0      = thunk => ({ [Symbol.dispose]:      thunk });
export const __parabunAsyncDefer0 = thunk => ({ [Symbol.asyncDispose]: thunk });
```

1. At the `defer` site, only the `using` binding is created — the thunk is **not** run.
2. When control leaves the block by **any** path (fall-through, `return`, `break`/`continue`, or a thrown exception), the host invokes `[Symbol.dispose]()` on every `using` binding in the block, **last-declared first**.
3. `await using` disposal is awaited in sequence at block exit, so async cleanups complete before the async function's frame is released.
4. The synthesized binding name uses a per-transpile counter (`__paraDefer0`, `__paraDefer1`, …) so multiple defers in a scope never collide.

&gt; **INV-effects-4 (defer runs on every exit path, including throw).** Because `defer` lowers to `using`, its cleanup runs on a thrown exception just as on a normal return — this is the whole point versus a trailing statement. A `defer` is the Para-idiomatic replacement for a `try { … } finally { … }` whose only job is cleanup.

&gt; **Edge case (`defer` captures at teardown, not at scheduling).** `defer log(x);` logs `x`'s value *at block exit*. If you need the value *at the defer site*, bind it first: `const snap = x; defer log(snap);`. This matches Go's `defer` argument-evaluation-vs-call distinction inverted — Para evaluates the *whole expression* lazily, so capture explicitly when you want a snapshot.

&gt; **Edge case (block granularity).** `defer` is scoped to its **immediately enclosing block** `{ … }`, not the enclosing function. A `defer` inside an `if` block, a `for` body, or a bare `{ }` fires at *that* block's exit. To defer to function exit, place the `defer` at the function's top-level block.

**Example.**

```pts
// .pts — LIFO teardown across exit paths
async fun process(path: string) {
  const file = await open(path);
  defer await file.close();        // runs LAST (declared first)

  const lock = acquire();
  defer lock.release();            // runs FIRST (declared last)

  if (corrupt(file)) return;       // both defers still run, lock.release() before file.close()
  transform(file);                 // throw here? both defers still run
}
```

### 2.2 `arena { }` — a bounded scope  `Shipped (Partial)`

`arena { BODY }` delimits a **scope** whose intent is bounded allocation/GC: allocations made inside the arena are conceptually released together at arena exit. On hosts that expose GC control it is a region; on hosts that do not (browsers, the current JS runtime) it is a transparent passthrough that runs the body inline and returns its value.

**Grammar.**

```
ArenaExpr ::= "arena" Block
```

**Lexical note.** `arena` fires (catalog `arena-block`: `\b(arena)\b(?=\s*\{)`) only immediately before a brace; `arena(`/`arena.` keep it as an identifier. The body is brace-matched (string-aware).

**Static / dynamic semantics.** `arena { BODY }` lowers to a call to the arena runtime's `scope(thunk)`; the body runs as the thunk, the arena's value is the thunk's return value, and the arena's lifetime is exactly the `scope(...)` call:

```
# Desugar:  arena { BODY }
Para:
    arena { const buf = alloc(1 << 20); return crunch(buf); }
TS:
    require("@lyku/para-arena").scope(() => { const buf = alloc(1 << 20); return crunch(buf); });
```

```ts
// Reference (browser/JS shim, @lyku/para-arena): a transparent passthrough.
// Browsers expose no GC control, so running the body inline preserves
// observable behavior — same return value, same side effects, same exceptions.
export function scope(fn) { return fn(); }
```

On a host with real region control (a native ParaBun build with a DeferGC arena), `scope` allocates a region, runs the body, and frees the region wholesale at exit; the *observable* behavior (return value, side effects, exception propagation) is identical to the passthrough, so a program is correct under either lowering. The semantic guarantee Para makes is therefore narrow and honest: **`arena` is observably a no-op around its body** except for memory-reclamation timing, which is not observable through the value model.

&gt; **Status — Partial, and the `scope` export collision.** The shipped `arena` lowering targets `@lyku/para-arena`'s exported function **`scope`** (note: this is the *runtime* `scope`, a region-runner — **not** the Proposed structured-concurrency `scope` keyword of §3.1, which is a *different concept and a different namespace*). The current `scope` is a passthrough on every JS host; a real region allocator is gated on the native build. The Proposed §3.7 generalizes `arena` to a *typed region with escape annotations*, at which point the no-op-passthrough guarantee tightens into a checked one. The keyword-vs-export name clash between `arena`'s runtime `scope` and the Proposed `scope` keyword is addressed head-on in §3.1.

**Example.**

```pts
// .pts — bounded scratch work; the buffer's region is reclaimed at arena exit
const histogram = arena {
  const scratch = alloc(width * height * 4);
  buildScratch(scratch, image);
  return reduceToHistogram(scratch);     // value escapes; scratch's region does not
};
```

### 2.3 `resource(setup)` / `onDispose` / `alive` / `use` — the lifecycle handle  `Shipped`

`resource(setup)` is the **load-bearing lifecycle primitive** of this chapter and the one every async/native source [→ ch:sources-async-and-native] is built on. It bundles one or more signals together with the teardown logic needed to release an underlying source (a mic, a camera, an open socket, a subscription) into a single **handle** with one explicit disposal moment.

It is not surface syntax — it is a runtime constructor called from lowered code and directly by library authors — but its *semantics* are normative because `source`, `async signal`, the `from*` adapters, `throttled`/`debounced`, and the Proposed scopes all rely on them.

**Setup contract.**

```
resource(setup) where setup : (ctx) => Exports
ctx = { signal, derived, onDispose, alive }
```

- `ctx.signal` / `ctx.derived` — the core constructors [→ ch:reactivity-core], handed in so the setup creates signals owned by this resource.
- `ctx.onDispose(fn)` — register a teardown callback. Callbacks run at disposal in **reverse registration order** (INV-effects-1).
- `ctx.alive` — a `WritableSignal<boolean>`, `true` until disposal, flipped to `false` (one final notification) on dispose.
- The setup returns an `Exports` object; its own keys (typically signals) become **public properties on the handle**. The handle layers `alive`, `dispose`, `[Symbol.dispose]`, `[Symbol.asyncDispose]`, and `use` on top.

**Static semantics.** `resource<E>(setup)` infers the handle type as `E & { alive: WritableSignal<boolean>; dispose(): void; use(fn): () => void } & Disposable & AsyncDisposable`. Because the handle implements `[Symbol.dispose]`, it is directly usable as a `using` binding and therefore as the target of a `defer` (§2.1) — `defer res.dispose()` and `using res = resource(…)` are equivalent disposal schedulings.

**Dynamic semantics.**

1. **Setup** runs synchronously. It creates the resource's signals, opens the underlying source, and registers `onDispose` cleanups. `alive` starts `true`.
2. **Setup failure is total.** If `setup` throws, any `onDispose` cleanups registered *before* the throw run (in reverse order) and the error re-raises — callers get either a working handle or an exception, never a half-built handle.
3. **`use(fn)`** runs `fn` as a core `effect` bound to the resource: it fires immediately and on every dependency change, and its stop is pushed onto the cleanup stack so it is **auto-disposed when the resource closes**.
4. **`dispose()`** is idempotent (INV-effects-2): a `disposed` latch makes the second call a no-op. On the first call it (a) flips `alive` to `false` — one final notification to any effect observing it — then (b) runs all `onDispose` cleanups **and** `use`-effect stops in reverse registration order.

```
# Desugar:  (no surface keyword — resource is a runtime constructor; shown for fidelity)
Para (a hand-written native source):
    const mic = resource(({ signal: sig, onDispose }) => {
      const peak = sig(0);
      const handle = openMic();
      handle.onPeak(v => peak.set(v));
      onDispose(() => handle.close());
      return { peak };
    });
Usage:
    mic.peak.get();                              // current level
    mic.alive.get();                             // true until disposed
    mic.use(() => render(mic.peak.get()));       // auto-stops on dispose
    mic.dispose();                               // close mic, fire cleanups LIFO, mark inert
```

&gt; **INV-effects-5 (`alive` is the disposal signal).** A resource's `alive` is the canonical way to observe its lifetime reactively. The idiomatic pattern is to read `alive` in the *same* effect that reads the resource's data signals, so the consumer re-runs (and can branch on dead-ness) at the disposal edge. `alive` flips exactly once, `true → false`, and never back — a resource does not resurrect.

&gt; **INV-effects-6 (disposal order within a resource).** `onDispose` cleanups and `use`-effect stops share **one** cleanup stack and run in a single reverse pass. So a `use(fn)` registered after an `onDispose(close)` is stopped *before* `close` runs — the effect can read the source one last time during its own teardown before the source closes, never after. Register the source-closing cleanup *first* (earliest) so it runs *last*.

**Interaction with `defer` and the scopes.** Because the handle is `Disposable`, the three scope mechanisms compose: `defer res.dispose()` schedules block-exit disposal; an enclosing `resource`'s `onDispose(() => child.dispose())` nests lifetimes; and the Proposed `scope`/`nursery` (§3.1) disposes its child resources on scope exit. This is the single lifecycle currency the whole chapter trades in.

**Example.**

```pts
// .pts — a resource composed of a child resource, disposed LIFO
fun openSession(url: string) {
  return resource(({ onDispose }) => {
    const sock = openSocket(url);
    onDispose(() => sock.close());              // runs LAST

    const heartbeat = setInterval(() => sock.ping(), 1000);
    onDispose(() => clearInterval(heartbeat));  // runs FIRST

    return { send: (m) => sock.send(m) };
  });
}

// using-binding disposal: dispose() fires at block exit, clearInterval before sock.close()
{
  using session = openSession("wss://x");
  session.send("hi");
}   // ← clearInterval(heartbeat) then sock.close()
```

---

## 3. Concurrent composition — `parallel`/`para` and `memo`

### 3.1 `parallel` / `para` — fan-out join  `Shipped`

`parallel` (and its interchangeable shorthand `para`, mirroring the `fun`/`function` precedent) composes several promise-producing expressions into a single `Promise.all` join with **name preservation** and **per-RHS error-chain isolation**. There are two forms.

**Grammar.**

```
ParallelExpr ::= ("parallel" | "para") "{" ParObjBody "}"          ⟨expression form⟩
ParallelStmt ::= ("parallel" | "para") ("let" | "const") ParDeclList ";"   ⟨statement form⟩
ParObjBody   ::= (ParEntry ("," ParEntry)*)?
ParEntry     ::= Key ":" Expr
Key          ::= Ident | StringLit | "[" Expr "]"
ParDeclList  ::= ParDecl ("," ParDecl)*
ParDecl      ::= Ident TypeAnn? "=" Expr
```

**Lexical note.** Disambiguation (matching `transformParallel`): `parallel`/`para` immediately before `{` is the **expression form** (the body is an *object literal* of `key: promise` entries — not a statement block); `parallel let` / `parallel const` (or `para let`/`para const`) is the **statement form** (a comma-separated decl list). Any other continuation leaves the keyword as a plain identifier. The expression form fires at *any* position (after `await`, `=`, `(`, `,`, `:` in an object) — its safety gate is "in code, not in a string/comment, and the prior char is not an identifier char." The statement form fires at a statement boundary. Statement form is lowered **before** expression form so the two shapes never cross-contaminate.

#### Form A — expression form (`parallel { k: p, … }`)

Lowers to a `Promise.all` over the entry values, re-projected back onto the original keys via positional temporaries:

```
# Desugar:  parallel { K0: E0, K1: E1 }
Para:
    const data = await parallel { user: fetchUser(id), posts: fetchPosts(id) };
TS:
    const data = await Promise.all([fetchUser(id), fetchPosts(id)])
      .then(([__pb0, __pb1]) => ({ user: __pb0, posts: __pb1 }));
```

- **Name preservation.** The keys survive the round-trip: the result is an object with exactly the declared keys, populated from positional temporaries `__pb0`, `__pb1`, … (one per entry, in source order). Identifier, string-literal, and computed `[expr]` keys are all supported.
- **Empty form.** `parallel {}` lowers to `Promise.all([]).then(() => ({}))` — resolves to `{}`.

#### Form B — statement form (`parallel let|const a = p, b = q;`)

Lowers to a destructured `await Promise.all`:

```
# Desugar:  parallel let A = EA, B = EB;
Para:
    parallel let user = fetchUser(id), posts = fetchPosts(id);
TS:
    const [user, posts] = await Promise.all([fetchUser(id), fetchPosts(id)]);
```

- **Surface `let`, lowered `const`.** `let` is kept as the surface keyword (mirroring the multi-decl `let a = …, b = …` shape) but the binding lowers to `const` — the names bind to an awaited tuple, so rebinding does not fit. The names *are* in scope as `const`s after the statement.
- **TS type annotations** on a decl (`parallel let u: User = fetchUser(id), …`) are accepted and erased into the tuple destructuring (the `: TYPE` is skipped up to the `=` at depth 0).

#### Per-RHS error-chain isolation (both forms)

Each entry/RHS is independently passed through the error-chain transform (`..>`/`..!`/`..&` → `.then`/`.catch`/`.finally` [→ ch:lexical-and-expression-syntax]) **before** the values are joined with commas into the `Promise.all` array. This is load-bearing: the error-chain pass does not treat a top-level `,` as a chain boundary, so joining first and transforming the joined string would collapse multiple `..!`-bearing RHSes into one mis-scoped `.catch`. Transforming per-RHS keeps each chain attached to its own promise:

```
# Desugar:  parallel { a: pA ..! fallbackA, b: pB }
Para:
    const r = await parallel { a: load() ..! useCache(), b: fetch2() };
TS:
    const r = await Promise.all([ load().catch(useCache), fetch2() ])
      .then(([__pb0, __pb1]) => ({ a: __pb0, b: __pb1 }));
```

**Static semantics.** Both forms are typed exactly as their `Promise.all` lowering: Form A's result is `{ k0: Awaited<typeof E0>, … }`, Form B binds each name to `Awaited<typeof Ei>`. Neither introduces an `any` (I3). The statement form requires an `async` context (it emits a top-level `await`); the expression form is an `await`-able value usable anywhere a promise is.

**Dynamic semantics.** Standard `Promise.all` semantics: all entries start **eagerly and concurrently** (each RHS expression is evaluated to a promise at the point the array literal is constructed), and the join settles when all resolve. **Rejection is `Promise.all`'s fail-fast**: the first rejection rejects the whole join; the *other* in-flight promises are **not cancelled** (JS has no implicit promise cancellation) — they run to completion and their results are discarded. This non-cancellation is precisely the gap the Proposed structured-concurrency `scope` (§3.4) closes.

&gt; **INV-effects-7 (eager, ordered start; positional join).** `parallel` evaluates its RHS expressions **left-to-right at construction** (so any synchronous side effect in an RHS happens in source order) but *awaits* them concurrently. The result mapping is **positional** — temporary `__pbN` indices match entry order — so reordering entries reorders the temporaries but not the named result. This is the property that makes `parallel` a pure refactor of a hand-written `Promise.all` destructuring.

&gt; **Edge case (`parallel` is not a scheduler).** `parallel` adds **no** concurrency limit, no cancellation, no error aggregation beyond `Promise.all`'s fail-fast. It is sugar for the join, nothing more. For bounded concurrency, mutual cancellation, or all-errors aggregation, see the Proposed `scope`/`nursery` (§3.4) and `race`/`select` (§3.6).

**Example.**

```pts
// .pts — both forms, with per-RHS error isolation
async fun loadDashboard(id: UUID) {
  parallel let
    profile = fetchProfile(id),
    feed    = fetchFeed(id) ..! emptyFeed();    // feed failure → cached, profile unaffected

  return parallel {
    profile,
    feed,
    unread: countUnread(id) ..! constant(0),
  };
}
```

### 3.2 `memo` / `memo async` — memoized call identity  `Shipped`

`memo` wraps a function (or arrow) in an **identity-keyed cache**: calls with the same argument *identities* return the cached result without re-running the body. It is the time-axis dual of `derived` — where `derived` memoizes a *reactive computation* keyed by dependency change, `memo` memoizes a *function* keyed by argument identity.

**Grammar.**

```
MemoDecl  ::= "export"? "memo" "async"? Ident "(" Params ")" RetType? Block
MemoArrow ::= "memo" "async"? ArrowFn
ArrowFn   ::= ("(" Params ")" | "<" TypeParams ">" "(" Params ")" | Ident) RetType? "=>" (Expr | Block)
```

**Lexical note.** Disambiguation (matching `transformMemo`): `memo NAME(` at a statement/`export` start is the **declaration** form; `memo (`, `memo <T>(`, or `memo IDENT =>` is the **arrow-expression** form. `memo(5)` (call), `memo.foo` (property), `memo = 1` (assignment), `memo(a, b)` with no trailing `=>` all leave `memo` as a plain identifier.

**Static semantics.** The wrapped function/arrow keeps its parameter and return types. In the **declaration** form the inner function is rendered **anonymous** (`function (args) { … }`) so a recursive self-call resolves through the outer `const NAME` — the memoized wrapper — rather than self-binding past the cache. The second argument the lowering passes, **arity**, is the formal parameter count (rest params count toward arity but always take the multi-arg runtime path):

```
# Desugar:  memo NAME(ARGS): T { BODY }
Para:
    memo fib(n: int): int { return n < 2 ? n : fib(n-1) + fib(n-2); }
TS:
    const fib = __parabunMemo(function (n: number): number {
      return n < 2 ? n : fib(n - 1) + fib(n - 2);   // recurses through the cached `fib`
    }, 1);

# Desugar:  memo async NAME(ARGS) { BODY }
Para:
    memo async load(id: UUID) { return await db.get(id); }
TS:
    const load = __parabunMemo(async function (id: string) { return await db.get(id); }, 1);

# Desugar:  memo (ARGS) => BODY  (arrow expression form)
Para:
    const sq = memo (x: int) => x * x;
TS:
    const sq = __parabunMemo((x: number) => x * x, 1);
```

**Dynamic semantics — the cache, keyed by arity.** `__parabunMemo(fn, arity)` selects a cache strategy by arity:

1. **Arity 0** — a single cached slot (`has`/`cached`). The first call runs `fn`; later calls return the cached value. `.forget()`/`.clear()` reset it.
2. **Arity 1** — a `Map<arg, result>` keyed by the **single argument's identity** (`Map` key equality = `SameValueZero`). `.forget(a)` evicts one key; `.clear()` empties the cache.
3. **Arity ≥ 2** — a **trie** of nested `Map`s, one level per argument, terminated by a sentinel — so the key is the *tuple of argument identities* in order.

Every strategy is **promise-aware**: if the cached value is a thenable, a rejection handler evicts the entry, so a failed async call is **not** cached (the next call retries). Each wrapper also exposes `.forget(...args)`, `.clear()`, and `.bypass(...args)` (run `fn` ignoring the cache).

&gt; **INV-effects-8 (identity keying, not structural).** `memo`'s cache compares arguments by **identity** (`SameValueZero`), not structure: `memo f` called with two structurally-equal-but-distinct objects is **two** cache misses. This is correct and cheap for primitive/interned keys and stable references; for value-keyed memoization use the Proposed explicit-cache-key form (§3.5). This is also why `memo` is only *sound* on a referentially-transparent (`pure`) function — caching a side-effecting function silently drops its effects on a hit. The purity *condition* is [→ ch:purity-and-determinism]; this chapter owns the cache *mechanism*.

&gt; **Edge case (anonymous inner function preserves recursion).** Declaration-form `memo fib(...)` MUST emit an *anonymous* `function` so `fib`'s recursive calls hit the memoized `const fib`. A named inner `function fib(...)` would self-bind and every recursive call would bypass the cache — turning a memoized O(n) `fib` back into exponential. This is the one non-obvious property of the lowering and is normative.

&gt; **Edge case (failed promises are not cached).** Because a rejected thenable evicts its own cache entry, `memo async load(id)` caches only *successful* loads; a transient failure does not poison the cache. A consumer that wants to cache failures must catch-and-return a value (so the cached result is a settled non-rejecting promise).

**Example.**

```pts
// .pts
memo async resolveUser(id: UUID) {            // dedupes concurrent + repeat loads by id
  return await db.users.find(id);
}

memo distance(a: Point, b: Point): float {    // identity-keyed: same (a,b) refs reuse the result
  return Math.hypot(a.x - b.x, a.y - b.y);
}

resolveUser.forget(staleId);                  // evict one id after a write
```

---

## Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `src/language-surface.ts` or the parser today). Each gives full grammar, static + dynamic semantics, a `# Desugar (proposed):` sketch (so it stays glass-floor-compatible, I1), an example, and a rationale. They share the lifecycle currency of §2.3 (`resource`/`onDispose`/`alive`) and the LIFO-teardown invariant (INV-effects-1), so every one of them lowers onto machinery this chapter already specifies — no new runtime concept is invented, only composed.

### 3.4 Structured concurrency: `scope` / `nursery { }` — child cancellation + error aggregation  `Proposed`

**Rationale.** `parallel` (§3.1) is unstructured: a rejection fail-fasts the join but leaves the *other* in-flight promises running (orphaned work, leaked resources, late side effects) and aggregates **no** errors beyond the first. Structured concurrency fixes both: a **nursery** owns a set of child tasks, **cancels its still-running children when one fails (or when the scope is left)**, and **aggregates all errors** into one. It is `parallel` with a lifetime and a cancellation story — and it lowers directly onto the §2.3 `resource` model (a nursery *is* a resource whose `onDispose` cancels its children).

**The name collision (addressed).** `@lyku/para-arena` already exports a function named **`scope`** (the region-runner `arena` lowers to, §2.2). Introducing a *keyword* `scope` for structured concurrency would visually collide with that runtime symbol. Resolution: **`nursery` is the primary keyword; `scope` is an accepted alias only in statement-head position**, and the alias never appears in a lowering — the nursery lowers to a `nursery(...)` runtime call from `@lyku/para-async`, leaving `@lyku/para-arena`'s `scope` export untouched in its own namespace. Because Para keywords are contextual (recognized only in disambiguating positions, [→ ch:overview-and-surfaces §1.1]), `scope` as a *keyword* fires only as `scope { … }` / `scope NAME { … }` at statement head; `arena`'s runtime `scope(fn)` is a *call expression* in *lowered* code and is never written by the user, so the two never occupy the same syntactic slot. A bare identifier `scope` used as a value remains a plain identifier (superset closure, INV-overview-4). **Recommendation:** the spec MAY ship `nursery` only and reserve `scope` to avoid even the cosmetic clash; the alias is offered because `scope { }` reads well and the contextual lexer makes it unambiguous.

**Grammar.**

```
NurseryExpr ::= ("nursery" | "scope") CancelBind? "{" NurseryBody "}"
CancelBind  ::= "cancel" Ident                         ⟨bind the scope's AbortSignal (§3.5)⟩
NurseryBody ::= (SpawnStmt | Statement)*
SpawnStmt   ::= "spawn" (Ident "=")? Expr ";"          ⟨launch a child task; optional result binding⟩
```

**Lexical note.** `nursery`/`scope` fire only immediately before `{` (or before `cancel IDENT {`). `spawn` is a statement-head keyword legal **only inside a nursery body**; outside one it is a plain identifier (and a `spawn` outside any nursery is a compile error: `spawn is only legal inside a nursery/scope block`).

**Static semantics.** A `nursery { }` is an **async expression** evaluating to the tuple/record of its `spawn` results (named spawns project to a record by binding name; bare spawns to a positional tuple — mirroring `parallel`'s two projections). Each `spawn EXPR` types as `Awaited<typeof EXPR>`. The optional `cancel tok` binds `tok: AbortSignal` (§3.5) in scope for every spawn body to thread cancellation. The nursery requires an `async` context. A nursery introduces a child-task lifetime that is **strictly nested** in its lexical scope: no spawned task may outlive the `}` (the join awaits them all, or cancels and awaits their teardown).

**Dynamic semantics.**

1. Entering the block constructs a `resource`-backed nursery handle with an internal `AbortController`; `cancel tok` binds `controller.signal`.
2. Each `spawn` starts its task **eagerly and concurrently** (like `parallel`), registering the task's promise and any teardown with the nursery's cleanup stack.
3. **Join:** the block awaits all spawned tasks.
   - If all settle successfully, the nursery resolves to the results record/tuple and disposes (running spawn teardowns LIFO).
   - If **any** task rejects, the nursery **aborts its `AbortController`** (signalling cancellation to every still-running, abort-aware child), awaits all children's settlement/teardown, then rejects with an **aggregated** error (`AggregateError` of every error that occurred — fail-fast *triggers* cancellation but does not discard the other failures).
4. **Scope-exit cancellation:** leaving the block by `return`/`break`/throw *before* the join (e.g. an early return in the body) also aborts and awaits all children — no orphan outlives the scope (INV-effects-1 teardown).

```
# Desugar (proposed):  nursery cancel tok { spawn a = EA; spawn b = EB; }
Para:
    const { a, b } = await nursery cancel tok {
      spawn a = fetchA(tok);
      spawn b = fetchB(tok);
    };
TS:
    const { a, b } = await (async () => {
      using __n = require("@lyku/para-async").nursery();   // resource: onDispose aborts + awaits
      const tok = __n.signal;                              // the scope's AbortSignal
      const __t0 = __n.spawn(() => fetchA(tok));
      const __t1 = __n.spawn(() => fetchB(tok));
      const [a, b] = await __n.join();   // all-settled join: abort+aggregate on first reject
      return { a, b };
    })();
```

`nursery()` is a thin `resource` (§2.3): `spawn(fn)` records `fn()`'s promise and pushes its teardown onto the cleanup stack; `join()` is the abort-on-first-error all-settled await; the `using __n` binding guarantees `onDispose` (abort + await children) runs on **every** exit path (INV-effects-4) — the structural guarantee `parallel` lacks.

&gt; **INV-effects-9 (no task outlives its nursery).** Control does not pass the closing `}` of a `nursery` until every spawned task has either completed or been cancelled-and-torn-down. This is the structured-concurrency contract (Trio/Kotlin nurseries) and the precise property that turns `parallel`'s orphan-on-reject (§3.1 dynamic semantics) into a guarantee.

**Example.**

```pts
// .pts — first failure cancels the siblings; all errors aggregated
async fun assemble(id: UUID) {
  return await nursery cancel tok {
    spawn header = fetchHeader(id, { signal: tok });   // if body() throws,
    spawn body   = fetchBody(id, { signal: tok });     // tok aborts the other two
    spawn footer = fetchFooter(id, { signal: tok });
  };   // resolves { header, body, footer } or rejects AggregateError, no orphans
}
```

### 3.5 Cancellation tokens / `AbortSignal` as a first-class `cancel` binding  `Proposed`

**Rationale.** Cancellation in JS is `AbortController`/`AbortSignal` threaded by hand through every async call — verbose, easy to forget, and invisible in the reactive graph. Para already *has* cancellation internally (`promiseSignal` aborts its `AbortController` on dispose, [→ ch:sources-async-and-native]), but it is not surface. A first-class `cancel` binding threads an `AbortSignal` through `async` chains, `parallel`, and nurseries, and ties cancellation to scope exit (§2) so it is automatic.

**Grammar.**

```
CancelDecl  ::= "cancel" Ident ("on" Expr)? ";"        ⟨declare a cancel token; optional auto-cancel trigger⟩
CancelBind  ::= "cancel" Ident                         ⟨bind a scope/nursery's signal (§3.4)⟩
CancelStmt  ::= Ident "." "cancel" "(" Expr? ")"       ⟨trigger cancellation (ordinary method; shown for completeness⟩
```

**Lexical note.** `cancel IDENT` at statement head declares a token; `cancel IDENT` after `nursery`/`scope`/`parallel` heads binds that construct's signal. `on EXPR` is an optional trailing trigger (auto-cancel when the reactive `EXPR` becomes truthy — an edge, reusing §1.1's `when`).

**Static semantics.** `cancel tok;` binds `tok: AbortSignal` (the readable half) and an implicit controller (the writable half, reachable as `tok` for `.cancel()` sugar). A `cancel tok on EXPR;` additionally wires a `when EXPR { tok.cancel(); }` edge so the token fires when a reactive condition holds (e.g. `cancel tok on routeChanged;`). The token threads into any `parallel`/`nursery`/`async` call that accepts `cancel tok`.

**Dynamic semantics.** `cancel tok;` lowers to an `AbortController`; `tok` is its `.signal`. Disposal of the enclosing scope (§2) aborts it automatically (a `defer`-registered abort), so a token is cancelled on scope exit even if never triggered explicitly — no leaked listeners.

```
# Desugar (proposed):  cancel tok on EXPR;  …  parallel cancel tok { … }
Para:
    cancel tok on navigatedAway;
    const r = await parallel cancel tok {
      page: fetchPage(tok),
      meta: fetchMeta(tok),
    };
TS:
    const __ac = new AbortController();
    const tok = __ac.signal;
    using __tokDispose = __parabunDefer0(() => __ac.abort());          // abort on scope exit
    require("@lyku/para-signals").when(() => navigatedAway, () => __ac.abort());  // edge trigger
    const r = await Promise.all([fetchPage(tok), fetchMeta(tok)])
      .then(([__pb0, __pb1]) => ({ page: __pb0, meta: __pb1 }));
```

&gt; **Interaction.** `cancel` is the thread §3.4's nursery exposes and §3.1's `parallel` opts into. Threading a `cancel tok` into a `parallel` makes the otherwise-unstructured fan-out *cooperatively* cancellable (the RHS calls must honour `tok`); threading it into a `nursery` is automatic (the nursery owns the controller). A token bound `on EXPR` ties cancellation to the reactive graph — "cancel these requests the moment the user navigates away" becomes one declarative line.

**Example.**

```pts
// .pts — a request that auto-cancels when its component's route changes
async fun search(q: signal<string>) {
  cancel tok on q.changed;            // re-search cancels the prior request
  return await fetch(`/s?q=${q.get()}`, { signal: tok }) ..! [];
}
```

### 3.6 `when` debounce/throttle modifiers and `when … for DURATION` sustained edges  `Proposed`

**Rationale.** Edge handlers (§1) fire on the *instant* of transition, but real conditions are noisy (a sensor crossing a threshold, a resize, a scroll). Today the rate-limiting lives in *source* operators (`throttled`/`debounced`, [→ ch:sources-async-and-native]) applied to the *value*, not the *edge*. Surfacing the modifiers on `when` itself lets the edge be debounced/throttled inline, and a new `for DURATION` modifier expresses the common "fire only if the condition has held continuously for D" (sustained-condition edge) — long-press, debounced-online, "stable for 500 ms."

**Grammar.**

```
WhenMod    ::= "when" "not"? Expr EdgeMod* Block
EdgeMod    ::= "debounce" Duration
            |  "throttle" Duration
            |  "for" Duration
Duration   ::= Expr            ⟨ms number, or a duration literal `500ms` per [→ ch:lexical-and-expression-syntax §90]⟩
```

**Static semantics.** `EdgeMod`s attach to the edge, not the predicate. `debounce D` fires the body only after the predicate has stayed at its new edge value for `D` of silence; `throttle D` fires at most once per `D` window (leading edge + trailing flush — the §source `throttled` semantics); `for D` (the new one) fires the body only when the predicate has been **continuously truthy** for `D` (a *sustained* rising edge), and pairs naturally with `when stop` (fires when it *stops* being sustained). Modifiers are mutually composable in the obvious way (`throttle` then `for` is rejected as contradictory — `for` is sustained, `throttle` is rate-limited; the checker flags the combination).

**Dynamic semantics.** Each modifier lowers to the edge wrapper composed with a timer, reusing the §1.1 `when` machine plus the rate-limit timing already proven in `throttled`/`debounced`:

```
# Desugar (proposed):  when EXPR for DURATION { BODY }
Para:
    when pressed for 500ms { fireLongPress(); }
TS:
    require("@lyku/para-async").whenFor(() => pressed, 500, () => { fireLongPress(); });
    // whenFor: on the rising edge start a 500ms timer; if the predicate goes
    // false before it elapses, cancel the timer (no fire); if it elapses while
    // still true, fire once. Re-arms on the next rising edge.

# Desugar (proposed):  when EXPR debounce DURATION { BODY }
Para:
    when scrolling debounce 200ms { snapToGrid(); }
TS:
    require("@lyku/para-async").whenDebounced(() => scrolling, 200, () => { snapToGrid(); });
```

`whenFor`/`whenDebounced`/`whenThrottled` are `resource`-backed (§2.3) so their internal timers are cleared on scope teardown (INV-effects-1) — a half-elapsed `for` timer does not fire after its scope is gone.

&gt; **Interaction.** `for DURATION` is the sustained-edge dual of the instantaneous edge: `when online { … }` fires on *any* blip to online; `when online for 3s { … }` fires only on a *stable* connection. Combined with the paired form, `when online for 3s { markStable(); } when stop { markUnstable(); }` is a complete debounced-connectivity bracket. The timers honour `cancel` tokens (§3.5) when one is in scope.

**Example.**

```pts
// .pts — long-press, stable-online, and debounced-resize, all as edges
when buttonHeld for 600ms { openContextMenu(); }
when connected   for 3s   { syncQueue.flush(); } when stop { syncQueue.pause(); }
when resizing    debounce 150ms { recomputeLayout(); }
```

### 3.7 `memo` with explicit cache key, TTL, and custom equality  `Proposed`

**Rationale.** `memo` (§3.2) is **identity-keyed** with an **unbounded, never-expiring** cache — sound only for pure functions over stable/interned arguments, and a memory leak for large key spaces or value-keyed calls. Three modifiers close the gap without changing the default: an explicit **cache key** (memoize by a derived value, not argument identity), a **TTL** (entries expire), and a **custom equality** (treat structurally-equal arguments as cache hits).

**Grammar.**

```
MemoDecl   ::= "export"? "memo" MemoOpts? "async"? Ident "(" Params ")" RetType? Block
MemoOpts   ::= "{" MemoOpt ("," MemoOpt)* "}"
MemoOpt    ::= "key" ":" Expr           ⟨(…args) => K — derive the cache key⟩
            |  "ttl" ":" Duration        ⟨entry lifetime⟩
            |  "eq"  ":" Expr            ⟨(a, b) => boolean — argument equality⟩
            |  "max" ":" Expr            ⟨LRU capacity⟩
```

**Lexical note.** `memo { … } NAME(` places an options object *between* `memo` and the function — distinguishable from `memo NAME(...)` because the brace precedes the name. (`memo` alone before `{` is not a thing today — `memo` is always followed by a name or arrow — so the options-brace is unambiguous.)

**Static semantics.** `key: (…args) => K` makes the cache `Map<K, Result>` keyed by the derived `K` (with `eq` applied if given); without `key`, the default arity-keyed behavior (§3.2) is preserved. `ttl: D` stamps each entry with an expiry; a read past expiry is a miss. `eq` overrides identity comparison for keys/args. `max: N` bounds the cache to `N` entries (LRU eviction). All modifiers are erasable into the runtime wrapper's options argument — no change to the surface of the wrapped function.

**Dynamic semantics.** Lowers to a `__parabunMemo` variant taking an options object; the cache strategy is selected by the options rather than purely by arity:

```
# Desugar (proposed):  memo { key: K, ttl: D, eq: EQ } NAME(ARGS) { BODY }
Para:
    memo { key: (u) => u.id, ttl: 60_000, eq: sameId } lookup(u: User) { return expensive(u); }
TS:
    const lookup = __parabunMemoKeyed(function (u) { return expensive(u); }, {
      key: (u) => u.id,
      ttl: 60_000,
      eq: sameId,
    });
    // __parabunMemoKeyed: Map<K, {value, at}>; on call compute K = key(...args),
    // hit iff present AND (now - at) < ttl AND eq-matched; else run, store {value, now}.
    // LRU-evict past `max`. Promise-aware eviction preserved from §3.2.
```

&gt; **INV-effects-10 (TTL and `eq` do not change soundness conditions).** Adding `ttl`/`eq`/`key` changes *which* calls hit the cache, never *whether* caching is sound — that remains the referential-transparency condition (INV-effects-8, [→ ch:purity-and-determinism]). A `ttl` makes a *slowly-changing* pure-enough function cacheable (recompute at most once per window); it does not license memoizing a side-effecting function.

&gt; **Interaction.** `key` + `eq` together give value-keyed memoization (`memo { key: hashOf, eq: deepEqual } …`) — the structural counterpart to the default identity keying. `ttl` + `max` bound the cache in time and space, making `memo` safe for large/unbounded key spaces (request dedup with expiry). The promise-aware failed-eviction of §3.2 is preserved under all modifiers.

**Example.**

```pts
// .pts — request dedup with a 30s TTL and a 1000-entry LRU bound
memo { key: (id) => id, ttl: 30_000, max: 1000 } async loadProfile(id: UUID) {
  return await api.profile(id);
}

// value-keyed memo: structurally-equal queries hit the same cache slot
memo { key: (q) => JSON.stringify(q), max: 256 } plan(q: Query): Plan {
  return optimize(q);
}
```

### 3.8 `race` / `select` — first-settled structured combinator  `Proposed`

**Rationale.** `parallel`/`nursery` are *all*-join combinators (wait for everyone). The dual — *first*-settled (wait for the winner, cancel the rest) — has no surface today; hand-writing it is `Promise.race` plus manual `AbortController` plumbing to cancel the losers (which `Promise.race` does **not** do). `race`/`select` is the structured first-settled join: it returns the first result **and cancels the losing branches** (closing the orphan gap `Promise.race` shares with `parallel`).

**Grammar.**

```
RaceExpr   ::= ("race" | "select") CancelBind? "{" RaceArm+ "}"
RaceArm    ::= Label ":" Expr ";"           ⟨a labelled branch; the winning label is reported⟩
Label      ::= Ident
```

**Lexical note.** `race`/`select` fire only before `{`. `select` is offered as the readable alias (Go-`select`-flavoured); both lower identically. Arms are `label: expr;` — like a `parallel` object but the result carries *which* arm won.

**Static semantics.** A `race { }` is an async expression resolving to a tagged result `{ tag: Label, value: Awaited<typeof Expr> }` — a discriminated union over the arm labels (so the consumer can `match` on the winner, [→ ch:type-and-schema-system]). The result type is the union of each arm's `{ tag: "label_i", value: T_i }`. Like the nursery, it owns an `AbortController` bound by `cancel tok` and threaded into every arm.

**Dynamic semantics.**

1. All arms start eagerly and concurrently (each labelled expression evaluated to a promise, threading the scope `AbortSignal`).
2. The **first arm to settle** (resolve *or* reject) wins. On the winner settling, the scope **aborts the controller**, cancelling the losing arms, then awaits their teardown (INV-effects-9 — no orphan losers).
3. The result is `{ tag: winningLabel, value }` on a resolve; a winning *rejection* rejects the `race` (first-settled includes failure — use `..!` per-arm to convert a rejection into a value if "first success" is wanted instead).

```
# Desugar (proposed):  race cancel tok { fast: EA; slow: EB; }
Para:
    const r = await race cancel tok { fast: fromCache(tok), slow: fromNet(tok) };
    match r { { tag: "fast", value } => use(value), { tag: "slow", value } => use(value) }
TS:
    const r = await (async () => {
      using __n = require("@lyku/para-async").nursery();
      const tok = __n.signal;
      return await __n.select([
        ["fast", () => fromCache(tok)],
        ["slow", () => fromNet(tok)],
      ]);   // resolves { tag, value } of the first to settle; aborts + awaits losers
    })();
```

&gt; **INV-effects-11 (the losers are cancelled and awaited).** `race`/`select` does not pass its `}` until the losing arms have been signalled to cancel **and** torn down. This is the property that distinguishes it from a bare `Promise.race`, which abandons the losers (they run to completion, leak their resources, and may fire late side effects). `race` is `Promise.race` made structured — exactly as `nursery` is `Promise.all` made structured.

&gt; **Interaction.** `race` is the first-settled sibling of §3.4's all-settled `nursery`; both are thin `resource`-backed combinators over the same `nursery()` handle, differing only in `join()` (all) vs `select()` (first). Threading `cancel tok` and per-arm `..!` lets the common patterns — "first success, ignore failures" (`fast: a ..! never(); slow: b ..! never();`) and "timeout race" (`work: doWork(tok); timeout: sleep(5000, tok);`) — be expressed directly.

**Example.**

```pts
// .pts — cache-or-network race with a timeout arm; losers are cancelled
async fun fetchFastest(id: UUID) {
  const r = await race cancel tok {
    cache:   fromCache(id, tok),
    network: fromNetwork(id, tok),
    timeout: sleep(3000, tok) ..> throwTimeout,
  };
  return match r {
    { tag: "cache",   value } => value,
    { tag: "network", value } => value,
    { tag: "timeout"        } => Err("slow"),
  };
}
```

### 3.9 `arena` generalized to a typed region allocator with escape annotations  `Proposed`

**Rationale.** Today's `arena` (§2.2) is observably a no-op around its body — its only effect is *unobservable* memory-reclamation timing, so the language makes no checked promise. To make `arena` carry real weight (the native DeferGC region it was named for), the region must be **typed** (allocations are tagged with the region) and the spec must guarantee that **no region-allocated value escapes the arena** — otherwise wholesale region free is a use-after-free. The Proposed form adds an **escape annotation** so the checker proves the safety the native lowering needs, turning the "observably a no-op" honesty (§2.2) into a checked region discipline.

**Grammar.**

```
ArenaExpr  ::= "arena" RegionBind? Block
RegionBind ::= "<" RegionId ">"                ⟨name the region, so allocations can be typed in it⟩
EscapeAnn  ::= "escape" Expr                    ⟨mark a value as outliving the region (copied out)⟩
```

(`escape EXPR` is a unary expression-position annotation usable inside an arena body — typically on the arena's result.)

**Static semantics.** `arena<r> { … }` introduces a region `r`. A value allocated in `r` (via region-aware allocators that take `r`) carries a *region brand* in the type system (`InRegion<T, r>`). The checker enforces the **escape rule**: a value of type `InRegion<T, r>` may **not** flow out of the `arena<r>` block — as a return value, an assignment to an outer binding, a captured closure, or a thrown value — **unless** it is wrapped `escape EXPR`, which lowers to a copy out of the region. An un-escaped region value crossing the boundary is a compile error (`value allocated in region 'r' escapes the arena without `escape`; it would be freed at arena exit (use-after-free)`). This is the static guarantee that makes wholesale region free sound.

**Dynamic semantics.** On a host with region control, `arena<r> { … }` allocates region `r`, runs the body, and frees `r` at exit; `escape EXPR` copies its value out of `r` before the free. On a host without region control (browsers/current JS), it remains the §2.2 passthrough — `escape` is the identity, the region brand erases, and behavior is unchanged. So the *typed* arena is glass-floor-identical to today's on JS, and *checked-safe* on the native target:

```
# Desugar (proposed):  arena<r> { …; escape RESULT }
Para (native target):
    const out = arena<r> {
      const scratch = allocIn(r, 1 << 20);
      build(scratch, input);
      escape reduce(scratch);          // copied out of r before r is freed
    };
TS (native):
    const out = require("@lyku/para-arena").region(r => {
      const scratch = r.alloc(1 << 20);
      build(scratch, input);
      return r.escape(reduce(scratch));   // copy out, then region freed at region() exit
    });
TS (browser/JS — unchanged from §2.2):
    const out = require("@lyku/para-arena").scope(() => {
      const scratch = alloc(1 << 20);
      build(scratch, input);
      return reduce(scratch);             // escape erases to identity; no region
    });
```

&gt; **INV-effects-12 (region values do not escape unescaped).** Every value that crosses an `arena<r>` boundary is either region-free (allocated outside `r`) or explicitly `escape`-copied. This is the type-system precondition that lets the native lowering free the whole region at arena exit without a use-after-free — the checked tightening of §2.2's unchecked "observably a no-op" guarantee.

&gt; **Interaction.** The typed arena composes with `defer` (a `defer` inside an `arena` runs before the region frees — its cleanup may read region values; it is sequenced *inside* the `region()` call) and with `resource` (a `resource` whose signals hold region values must `escape` them or be disposed inside the arena). It is the §05 counterpart to [→ ch:overview-and-surfaces §5.5]'s view-substrate seam: where that proves the *view* is swappable, the typed arena proves the *memory region* is bounded — both are "make an ambient fact checkable." On JS hosts the whole feature erases to today's passthrough (I1: the glass floor is unchanged), so adopting it is zero-cost until a native target exists to honour it.

**Example.**

```pts
// .pts — a bounded image-processing region; only the histogram escapes
fun histogramOf(image: Image): Histogram {
  return arena<r> {
    const scratch = allocIn(r, image.width * image.height * 4);   // lives in r
    decode(image, scratch);
    const hist = reduceToHistogram(scratch);                       // also in r
    escape hist;        // copied out of r; `scratch` and the un-escaped `hist` original freed
  };
}

// ✗ counter-example — un-escaped region value escapes
fun leak(image: Image) {
  return arena<r> {
    const scratch = allocIn(r, 1024);
    return scratch;     // ✗ error: value allocated in region 'r' escapes without `escape` (use-after-free)
  };
}
```

---

## 4. Construct summary

A consolidated map of this chapter's surface, its lifetime class, its lowering target, and its teardown rule. (Non-normative; each row is specified above.)

| Construct | Class | Status | Lowers to | Teardown |
|---|---|---|---|---|
| `when EXPR { }` / `when not EXPR { }` | edge | Shipped | `signals.when(pred, body)` | effect stop (scope) |
| `when start { } when stop { }` | edge (paired) | Partial | `signals.whenPaired(pred, on, off)` | stop-on-edge **or** on teardown (pre-charge) |
| `defer EXPR` / `defer await EXPR` | scope-exit | Shipped | `using __paraDeferN = __parabunDefer0(…)` | block exit, **LIFO**, all paths |
| `arena { }` | region | Partial | `arena.scope(() => …)` | region free (no-op on JS) |
| `resource(setup)` / `onDispose` / `alive` / `use` | handle | Shipped | runtime constructor | `dispose()` idempotent, **LIFO** cleanups |
| `parallel`/`para { }` & `let`/`const` | fan-out join | Shipped | `Promise.all([...]).then(…)` | none (orphans on reject) |
| `memo` / `memo async` | call-cache | Shipped | `__parabunMemo(fn, arity)` | `.forget()`/`.clear()` |
| `nursery`/`scope { spawn … }` | structured join | Proposed | `nursery()` resource + `join()` | abort + await children, **LIFO** |
| `cancel tok` / `cancel tok on EXPR` | cancellation | Proposed | `AbortController` + `defer abort` | abort on scope exit |
| `when … debounce`/`throttle`/`for D` | rate-limited edge | Proposed | `whenFor`/`whenDebounced`/… resource | timer cleared on teardown |
| `memo { key, ttl, eq, max }` | bounded cache | Proposed | `__parabunMemoKeyed(fn, opts)` | TTL/LRU eviction |
| `race`/`select { }` | first-settled join | Proposed | `nursery().select([...])` | abort + await losers, **LIFO** |
| `arena<r> { … escape e }` | typed region | Proposed | `arena.region(r => …)` | region free + escape-copy |

Every row's teardown obeys INV-effects-1 (LIFO) and INV-effects-2 (idempotent); every Shipped/Proposed lowering is plain, readable, ejectable host code (I1), and introduces no `any` (I3).

