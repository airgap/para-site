---
title: "Appendix A — Frontier / Proposed Directions"
description: "Appendix A — Frontier / Proposed Directions"
sidebar:
  order: 14
---

**Status: Proposed (entire chapter).** Nothing here is in a parser yet. Each construct carries a `# Desugar (proposed):` sketch so it stays glass-floor-compatible (I1): the forward vision is constrained to surface that *could* lower to readable, ejectable code on the existing substrate (`para-signals`, `para-sync`, the schema projections). This chapter is the answer to "where does the schema-is-the-application thesis go next?" — organized by the five themes that unify the new surface.

&gt; **The through-line.** Every idea below earns its place by being *unthinkable outside Para*: it is only expressible because signals and server-authoritative sync share **one reactive graph**, because the schema is a **temporal spine** and not just a shape, and because the reconciler's laws can be **lifted into the type system**. None of it is a bolt-on library; all of it is the composition of primitives the language already has.

---

## A.1 One graph, two authorities

*Signals and server-authoritative sync are the same reactive graph, so optimistic intent, time-travel, animation, and list identity all reconcile against the same `sequence` the reconciler enforces.* This is the lens, not a feature list — every construct in this section is a different read of "the local optimistic value and the server-authoritative value live in one graph."

### A.1.1 `transaction { }` — atomic optimistic mutation with schema-typed rollback

A first-class block fusing a burst of optimistic `signal`/`synced` writes into one **all-or-nothing intent**. On reject it rolls back to the last server-confirmed snapshot in LIFO order; crucially it **defers to any inbound sync `sequence`**, so rollback never clobbers a concurrent server write.

```pts
transaction checkout {
  cart.items   = []
  order.status = "placed"
  user.credits -= total
} commit await placeOrder(order)
  ..! e => toast(e)              // Err: LIFO rollback of all three writes

when checkout.rejected { /* edge-triggered */ }
derived spinning = checkout.pending
```

```
# Desugar (proposed):  transaction NAME { BODY } commit COMMIT
Para → TS:
    const __txn = beginTransaction([cart, order, user]);   // snapshots @ last confirmed seq
    batch(() => { cart.value = []; order.value = {...}; user.value = {...}; });
    __txn.commit(COMMIT)
         .then(() => __txn.confirm())
         .catch(() => __txn.rollback());   // restores snapshots iff no newer inbound seq
```

**Why only Para.** Promotes `batch()` from *coalesce drains* to *coalesce intent*, giving the Class-A reconciler `[→ ch:data-sync-and-authority]` a real intent boundary. Rollback that respects inbound `sequence` is only expressible because signals and sync share one graph — no generic optimistic-UI library can do it. Kills the partial-rollback / double-drain-flicker bug class.

### A.1.2 `history NAME = signal(...) keep N` — version-stamped time-travel as a cell capability

A modifier on any `signal`/`synced` declaration retaining a bounded ring of past values, **stamped with the same `(schema_version, sequence)` identity the sync layer already uses**. `undo`/`redo`/`at(seq)` are tracked reads.

```pts
history doc = signal(initialDoc) keep 50
doc.value = nextDoc                          // pushes a stamped frame
doc.undo(); doc.redo()
derived preview = doc.at(scrubber.value)     // tracked read at a sequence

sync board :: Board from key keep 200        // frames stamped by wire sequence
```

**Why only Para.** Reuses the `SyncEnvelope` sequence as the time axis, so undo on a *synced* cell is meaningful relative to **server truth**, not wall-clock — undo becomes a fresh optimistic intent through the Class-A path (composing directly with `transaction`). Rides `proxySignal` structural sharing for cheap frames. Time-travel as tracked reads, not a command stack bolted outside the graph.

### A.1.3 `motion NAME = signal(...) spring/tween` — animation as a derived reactive value

A cell modifier making a numeric/struct signal physically interpolate toward its target on a frame clock; the *animated* value is itself tracked. For synced cells the target is server truth, fusing the sync and animation loops.

```pts
motion x = signal(0) spring { stiffness: 0.15, damping: 0.8 }
x.value = 300                                // reads observe the in-flight value
effect onArrive when x.atRest { fireConfetti() }

motion scroll = synced(key) spring           // smooth-chase the server-authoritative value
```

**Why only Para.** Schema-aware interpolation — *only numeric leaves animate*, guided by the schema spine — is impossible without "schema is the application." The frame driver is just `signal … every MS` with at-rest auto-pause `[→ ch:reactivity-core]`. A synced motion cell retargeting on each reconcile envelope (smooth-to-server-truth) is a capability no imperative animation island can express.

---

## A.2 The schema as a temporal spine

*"The schema is the application" extended over time and lifecycle.* The model projects not just shape but **conflict policy, legal ordering, and migration skew** — all diffable against the live DB (I3). These four constructs make `[→ ch:type-and-schema-system]` a four-dimensional source of truth.

### A.2.1 State-machine schemas — lifecycle as declared transitions

A `schema … states { }` declares a finite state machine where each state projects a **different field shape**, transitions become typed server handles with guards, and the reconciler enforces legal ordering on top of `sequence`.

```pts
schema Order states {
  Cart    { items, total }
  Placed  { ...Cart, placedAt, payment }
  Shipped { ...Placed, tracking }
  Cancelled { reason }

  Cart   -> Placed  on place @guard(items.length > 0)
  Placed -> Shipped on ship  @authority(server-only)
}

match order.state {
  Shipped(o) => render(o.tracking),   // o.tracking in scope only here
  _          => render(o.summary),
}
// ✗ order.tracking outside a `Shipped` arm  →  compile error: field absent in current state
```

**Why only Para.** Generalizes §5 authority from "one value reconciles" to "a *lifecycle* reconciles": an inbound envelope whose transition is illegal from the current state is a **gap (refetch)**, not silently applied. Fuses `match` narrowing `[→ ch:errors-results-and-validation]`, `Handles<M>` server projection, and the sequence reconciler. The hardest L4-class stressor, expressed totally.

### A.2.2 Relations as schema edges

Declare references with `->` / `->>` edges. **One edge projects to four facts at once:** a FK + migration, a typed `.with()` join, a cascading dependent sync subscription, and a `promiseSignal`-backed `.pui` async boundary.

```pts
schema Post {
  id: UUID @pk
  author:   -> User @on_delete(cascade)
  comments: ->> Comment.post
}

const feed = Post.where(_.published).with(author, comments);   // typed join, no N+1
sync post :: Post.with(author) from `post:${id}`;              // author live-syncs too
```

**Why only Para.** Makes the join, FK, cascade, and dependent sync the **same fact** — you cannot have a relation in the join but not the migration. Reuses brand-type intersections (totality across the join, no `as`) and para-sync's reconciler + InProcessTransport for dependent replicas, so relations are a *sync projection*, not a separate ORM. The schema-spine answer to the L2 feed-load flagship.

### A.2.3 `where` clauses — refinement predicates and cross-field invariants in the schema body

Arbitrary refinements and multi-field invariants written as `where` clauses. **One predicate projects identically to three enforcement sites:** reactive client form-validation, the server `::` parse gate, and a SQL `CHECK` constraint.

```pts
schema Booking {
  start: DateTime
  end:   DateTime
  seats: int { minimum: 1 }

  where end > start          @msg("end must be after start")
  where seats <= venue.capacity  @async(loadVenue)
  refine Slug as str { pattern: "^[a-z0-9-]+$" }
}
```

**Why only Para.** Closes the cross-field gap field-by-field JSON Schema cannot express — the A2/L3 validation failure where invariants get hand-rolled in handlers, invisible to client and DB. The client projection is literally a `derived` over the field signals, so a `.pui` form's validity is a **native reactive value**: schema and reactivity fused, no enforcement site can silently disagree.

### A.2.4 `schema … evolves { }` — migrations and live-replica skew as one version chain

Schema evolution written *in the schema*: a versioned delta chain projecting simultaneously to a reversible SQL migration **and** the runtime `schema_version` skew reconciler, so wire and DB can never disagree about what a version means.

```pts
schema User @version("3.2") { id: bigint @pk; name: str; email: Email }
evolves {
  from "3.1": add email default backfill(legacyEmail)   // minor — compatible, parse-through
  from "2.x": rename fullName -> name
  from "1.x": split name into first: str, last: str     // MAJOR — breaking boundary
}
```

**Why only Para.** Closes the loop between the DB-diff (the I3 anchor) and para-sync's `schema_version`/`sequence` reconciler: a *minor* delta marks versions compatible (parse-through, no refetch) while a *major* boundary is exactly the `majorMismatch` skew that triggers refetch+resync — provably consistent with the actual migration. Versioning-as-language makes "the schema is the application" true **over time**, not just at one instant.

---

## A.3 Reconciler invariants made type-visible

*The para-sync laws lifted into the type system as phantom ordinals, viewer-indexed field presence, and affine native-handle lifetimes* — turning runtime guarantees into compile errors with **no silent `any`** (I3). This is `[→ ch:type-and-schema-system]` discharging the sync chapter's runtime obligations statically.

### A.3.1 Authority clauses — server-truth reconciliation as a per-field projection

Declare optimistic/authoritative reconciliation policy **inside the schema, per field**, so the §5 authority model is generated code you read — never ambient magic.

```pts
schema Message {
  id: UUID @pk
  body:      str { maxLength: 4000 }  authority last-write-wins
  reactions: ArrayOf<str>            authority merge concurrent   // Class-B, explicit
  pinned:    bool                    authority server-only
  editedAt:  DateTime                authority derive from body   // stripped from wire (A1)
}
```

**Why only Para.** Promotes §5 — the highest-rot surface — from runtime config into the schema spine, lowering to the real Class-A/Class-B policy table. Class-B can never be *accidentally* ambient because it is a visible keyword (the Meteor-trap guard). `derive from` strips the field from the wire codec. Makes I3 hold for **behavior**, not just shape.

### A.3.2 Visibility-indexed types — the type knows who is looking

A schema whose field set is a **function of the viewer class**, so a record fetched as a stranger cannot statically be read as if you were the owner. A stripped field is a *compile error*, not a runtime `undefined`.

```pts
schema Profile {
  id: UUID @owner
  handle: Slug
  @visible(self)     dateOfBirth: Date
  @visible("friend") email: Email
}

sync them :: Profile@viewer from `profile:${otherId}`
match them.class {
  friend => render(them.email),     // ok
  _      => render(them.handle),    // them.email here  →  ✗ COMPILE ERROR
}
```

**Why only Para.** Carries para-sync's domain-free visibility (`classKeyOf` / `projectByClass` / version-stamped cache) up to the type level: runtime projection and static type are two faces of the **same class function**, so they cannot drift. Field-level authorization becomes a property of the type — the literal I3 "no silent any" applied to access control.

### A.3.3 Sequence-monotone types — sync ordering encoded in the type

A synced cell's value is branded with a phantom `sequence` ordinal, so code that assumes "newer" can only run on values the reconciler has **proven** are newer; the only proof source is the reconciler's own commit edge.

```pts
sync cart :: Cart from `cart:${id}`

fun applyDiscount(before:: Cart@seq, after:: Cart@seq where after > before) { … }

applyDiscount(snapA, snapB)                  // ✗ no proof snapB.seq > snapA.seq
on cart advance (prev, next) { applyDiscount(prev, next) }   // proof in scope

when cart.status is Ok { useFreely(cart.value) }   // .value is T only inside `status is Ok`
```

**Why only Para.** Makes the reconciler's law (apply iff `sequence === current + 1`) **leak upward into application code**, turning "which snapshot is newer?" from a runtime guess into a discharged obligation — exactly where stale-echo flicker bugs are born. Lifts `ReplicaStatus` to a sum type so `.value` is `T` only inside a `status is Ok` block.

### A.3.4 Linear native handles — use-after-dispose is a type error

`source` / `using` handles become **affine**: the type system tracks aliveness so a `peek`/`subscribe` after dispose, a double-dispose, or a leaked undisposed handle fails to compile.

```pts
using gpu = device.acquire()
gpu.submit(work)
dispose gpu                    // gpu now consumed
gpu.submit(more)               // ✗ use of disposed handle 'gpu'
// a source/using that escapes its arena without dispose  →  compile error
```

**Why only Para.** Turns the existing source/using auto-dispose-on-unmount convention from a runtime guarantee into a static one, tying the affine lifetime to the `arena`/DeferGC scope already in the language `[→ ch:effects-lifecycle-concurrency]`. Directly hardens the `parabun:gpu`/`llm`/`audio` native handles where use-after-free is a real hazard — the `peek/subscribe/dispose` contract becomes a typed law, not a documented convention.

---

## A.4 Declarative scheduler & flow contracts

*Lane priorities, windowed streams, and transition coherence extend Para's existing declarative markers* (`pure`/`memo`/`every`/`promiseSignal`) so timing, backpressure, and concurrency are **contracts the runtime reads**, never imperative wiring.

### A.4.1 `transition NAME = derived(...) lane low/high` — concurrent reactive values with priority lanes

Mark a `derived` (or signal read) as a low-priority transition that **holds its previous value** while an expensive recompute yields off the synchronous drain, with a reactive `.pending`/`.stale` flag. `useTransition` as a typed reactive cell.

```pts
signal query = ""
transition results = derived expensive(query)   // never blocks the drain
derived dimmed = results.pending

transition feed = derived buildFeed(filters) lane low
signal cursor = 0 lane high                      // input stays crisp under load
```

**Why only Para.** `lane` is the reactive-time analog of the `pure`/`memo` markers — a *scheduler contract the user declares*, not imperative wiring. The drop-stale-in-flight / hold-prior coherence reuses `promiseSignal`'s abort-on-supersede discipline verbatim, and high-lane = today's synchronous drain — so it *extends* Para's "reactivity is declarative relationships" identity rather than bolting on a scheduler.

### A.4.2 `stream NAME from SOURCE over last … / fold … by …` — windowed reactive streams

Turn any `AsyncIterable` / native source / synced sequence into a reactive **stream signal** with declarative sliding/tumbling windows, `fold` aggregates, and principled drop-oldest backpressure — bridging point-in-time signals and event histories.

```pts
stream ticks  from priceFeed()
stream window = ticks over last 5s
stream candle = ticks fold ohlc by 1m
derived vwap  = window |> meanBy(_.price)

stream edits from synced(boardKey) since cursor   // replay the sync sequence as a log
```

**Why only Para.** Composes three existing natives — the `from*` adapters, the `signal … every MS` interval driver (window eviction), and uniquely the **synced `sequence` as a replayable event log** (`since cursor`). Only Para can say "a sync replica and a microphone are both stream sources" because both satisfy the `SourceHandle` `peek/subscribe/dispose` convention `[→ ch:sources-async-and-native]`. Completes the story: **signals for state, streams for flow.**

---

## A.5 Glass-floor projection multiplicity

*Each new surface lowers one declaration to several readable, ejectable artifacts* — making cross-layer drift a **compile error** instead of a hand-kept invariant. This is the unifying I1 property of §A.2/§A.3: one source, many projections, all openable.

### A.5.1 Keyed `each … by @identity` — schema-identity list reconciliation

Promote list reconciliation to the schema's declared `@identity` key, exposing per-item `enter`/`move`/`exit` as reactive edges and guaranteeing stable per-item signal cells across reorders **and** full-array sync reseeds.

```pts
schema Task { id: UUID @identity, title: str, done: bool }

{#each tasks as task (keyof Task)}
  <Row {task} on:enter={fadeIn} on:exit={fadeOut} on:move={slide} />
{/each}

each task in tasks {
  signal expanded = false      // one cell per identity — survives a sync reseed
}
```

**Why only Para — load-bearing for the read-only sync model.** Synced cells deliver *full-object array* envelopes, so without schema-identity reconciliation every push blows away per-row local state. With it, synced lists become fine-grained for free, exit-unmount ties to the transition promise, and per-item cells get arena-scoped GC. It is the list projection of "identity is a schema fact."

---

## A.6 The frontier as one sentence

Para's existing pillars — schema, signals, sync, native — already compose into one reactive graph over a single schema spine. The frontier is what happens when you take that composition seriously **in three directions at once**: *forward in time* (`transaction`, `history`, `motion`, `transition`, `stream`), *across the schema's lifecycle* (`states`, edges, `where`, `evolves`, `authority`), and *up into the type system* (`@viewer`, `@seq`, affine handles, `@identity`). Each is a different read of the same fact — the local optimistic value and the server-authoritative value are one value — and each lowers to readable, ejectable code. That is the whole bet: not more features, but the *same* spine, projected into more dimensions, with drift a compile error in every one.

