---
title: "Data Sync, Replication & Authority Model"
description: "The 'value changing across a trust boundary' pillar: sync/synced declarations, SyncEnvelope and the (schema_version, sequence) reconciler,…"
sidebar:
  order: 9
---

# Chapter: Data Sync, Replication & Authority Model

&gt; **Status of this chapter:** Mixed. The *read/reconcile* spine is **Shipped** (in `@lyku/para-sync` + `para-preprocess` today): the `sync NAME :: SCHEMA from KEY`, `sync NAME : TYPE from KEY`, and `synced NAME = ARGS` declaration forms; the `SyncedHandle` (`value`/`status`/`get`/`peek`/`subscribe`/`meta`/`stats`/`whenIdle`/`dispose`); `SyncEnvelope { value, schema_version, sequence }`; `createClientReplica` with its parse-gate / baseline / steady-state / gap rules; `ReplicaStatus` (`ok`/`stale`/`skew`/`refetching`); the `SyncTransport` contract with `InProcessTransport` / `NatsTransport`; the Class-A reconciliation default; and the domain-free visibility surface (`defineVisibility`/`classKeyOf`/`projectByClass`/`visibilityGate`/`createVisibilityCache`). *Proposed Extensions* (§13) is now mixed too (re-audited 2026-07-26): the Tier-2 write path (§13.1 `mutate` → `createIntent`), the array query surface (§13.3 → `syncedQuery`), and presence channels (§13.4 → `presence()`) are **Shipped** — `para-preprocess` lowering + `@lyku/para-sync` runtime, cataloged in `language-surface.ts` where a keyword applies; offline queued mutations (§13.5) and cross-entity transactions (§13.6) have shipped runtime primitives (`queue.js`, `transaction.js`) but no surface sugar, so their *surface* remains **Proposed**; per-field authority (§13.2) is fully **Proposed**; the scalar query form (§13.7: `syncedOne`, the tracked re-subscription bridge, and the `createQueryAuthority` liveness host) and server-source sync (§13.8: `createServerSource` + the `extractServerSources` escape analysis) **Shipped 2026-07-26**, with the lockstep-pg read-set adapter and the P9 emitter as the remaining integrations — implementation plan in `para-sync-query-plan.md` (para repo).
&gt; **Cross-refs:** This chapter owns the **fourth distance** of the one reactive idea — a value *changing across a trust boundary* [→ ch:overview-and-surfaces §0]. A `sync`/`synced` cell is **also a source** (§07's `peek`/`subscribe`/`dispose` convention) — it lowers through the *identical* `$state` + `$effect.pre` + `onDestroy` runes bridge [→ ch:sources-async-and-native §2, §07 INV-src-2] — but it adds a `(schema_version, sequence)` **reconcile machine** that a plain source has no need for, which is why it has its own chapter. The schema whose `parse` gate every envelope crosses, and the `schema_version` it carries, are defined in [→ ch:type-and-schema-system §`schema`, §`SchemaValue`]. The `::` / `is` parse-gate operators are [→ ch:type-and-schema-system, ch:errors-results-and-validation] — sync uses the gate in its **branch-on-`.tag`, never-throw** mode (a malformed delta triggers *recovery*, not a crash), the exact inverse of the throw-on-`Err` handler boundary. The `.pui` binding surface (how `sync`/`synced` bridge into a component, `prop`, the escape-analysis bridge) is [→ ch:pui-component-model]; this chapter shows the bridge only where the *reconcile* semantics depend on it. The **WRITE-path codegen** and the **wire codec** generation are [→ ch:modules-projections-and-build] — this chapter owns the read + reconcile *runtime and semantics*; the projections chapter owns the generation of the typed mutation call and the msgpack codec. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1]; the authority/transport configuration this chapter consumes (`authority { S => class-a }`, `transport nats {…}`) is declared once in the `.para` manifest [→ ch:overview-and-surfaces §5.1].

---

## 0. The trust-boundary pillar

A `schema` describes the shape of a value *at rest*; a `signal` describes that value *changing over time within one process*; a `source` describes it *changing over time driven by the outside world*; **sync describes that value changing over time across a trust boundary** — the same value, owned by a server, replicated into N untrusted clients, each holding an optimistic local view it must *reconcile* against the authoritative stream [→ ch:overview-and-surfaces §0]. This is the pillar `schema-is-the-application.md` §5 calls "the part that historically rots": realtime authority, optimistic update, and conflict are exactly where "sync baked in" turns to mush. Para's defensible move is not to invent a sync paradigm — it is to take the *de-facto* shape every realtime app already hand-rolls ("server-authoritative + optimistic local + server echo," done untyped over `any`) and make it **typed, correlated, reconciled, and readable** (`s5-reconciliation-spike.md`).

The pillar splits into two **tiers**, and the split is load-bearing:

- **Tier 1 — read-only replication (Shipped).** The client *receives* an authoritative value over an untrusted wire, parse-gates every delivery, reconciles by `(schema_version, sequence)`, and applies it into a reactive cell. The client **never writes** through this path. This is the entire Shipped surface: `sync`/`synced`, `createClientReplica`, the transports, the reconciler. It is a pure `receive → parse → version-check → apply` engine.
- **Tier 2 — the optimistic write path (Proposed, §13).** The client *mutates* an entity optimistically, tags the intent with a version and an op-id, and reconciles the server's confirm/reject/echo against its pending optimistic state. The design (`s5-reconciliation-spike.md`) bakes the **mechanical** state machine + a Class-A default policy and keeps the **policy delta** (the optimistic value, the rollback, the conflict resolution) as hand-written app code. This chapter specifies it as proposed surface; its codegen is [→ ch:modules-projections-and-build].

Three invariants frame the whole chapter:

- **INV-sync-1 (the parse gate is the trust boundary).** Every inbound value crosses a schema `parse` before it touches the cell. Unlike the `::` handler boundary (throw-on-`Err`), the sync gate **branches on `.tag` and never throws** — a malformed or schema-skewed delta must trigger *recovery* (refetch / skew status), not crash the apply. "A malformed delta must trigger recovery, not poison the cell" is the literal contract of `client.js`. This is the discharge of the §5 "KNOWN I3 HOLE" (the realtime payload was `any` at the context layer) — the wire payload is a schema projection, not an `any` socket.
- **INV-sync-2 (reconcile by `(schema_version, sequence)`, monotonic).** Authority is established by *two* keys, not one. `schema_version` distinguishes a compatible-but-behind replica from a different/breaking shape; `sequence` is the Postgres-authoritative monotonic ordering whose sole job is ordering + gap detection. The reconciler is a small, explicit, **readable** state machine over these two keys — never a hidden CRDT/OT (discharges falsification criterion §6.4: "sync correct only via hidden behavior").
- **INV-sync-3 (read-only Tier-1, no assignment rewrite).** A `sync`/`synced` cell is a **read-only reactive view** of a server-authoritative producer (the §07 INV-src-2 rule, inherited). The world writes the cell; the component reads it. There is *deliberately no assignment rewrite* — `user.name = x` on a synced cell is not lowered to a server write. Writing *to* the authority is the (separate, opt-in) Tier-2 path (§13.1), never an ambient side effect of a field set. This is the surface-level statement of "server-authoritative; clients hold an optimistic local view" (`schema-is-the-application.md` §5).

&gt; **Glass floor (I1).** Every form in §1–§7 lowers to plain calls into `@lyku/para-sync` (`synced(...)`, `createClientReplica(...)`, `new InProcessTransport()`) plus the readable `$state` + `$effect.pre` + `onDestroy` runes bridge (`.pui`). The reconciler is ~90 lines of branch-on-`.tag` and integer compares you can open and override per entity — *not* a merge engine. Nothing is reflection-driven or `any`-degraded; the visibility projection is a pure function over a class key, the cache a string-keyed `{get,set}`.

---

## 1. The `SyncEnvelope` — the unit that crosses the boundary

Everything in this chapter moves one shape across the wire:

```pts
// .pts — the change envelope (@lyku/para-sync transport.js)
interface SyncEnvelope {
  value: unknown;          // the FULL changed object — NOT validated by the transport
  schema_version: string;  // reconcile key #1: the model's version, e.g. "3.1"
  sequence: number;        // reconcile key #2: the object's monotonic, Postgres-authoritative seq
}
```

It is a **full-object delta** model, not a patch model: the new value travels *with* the reconcile key, so steady-state replication is `deliver → parse → apply` with **no refetch round-trip** (refetch is the `Err`/gap/skew fallback only). Three fields, three jobs:

- **`value`** — the complete current object. The transport treats it as opaque `unknown`; `parse`-gating is the *consumer's* job at the apply boundary (INV-sync-1). This is why the field is typed `unknown` and not `T`: it has not yet crossed the trust boundary when it is in the envelope.
- **`schema_version`** — a `"major.minor"` string. Distinguishes a *compatible-but-behind* replica (same major) from a *different/breaking* shape (major changed). The reconciler compares **majors only** (§3.2).
- **`sequence`** — a monotonic integer, authoritative at the database. Its sole job is **ordering + gap detection** (§3.4). Not a timestamp, not a vector clock — a single Postgres-sourced counter per object.

&gt; **INV-sync-4 (envelope totality).** An envelope carries *enough to apply or to detect that it cannot*. Because `value` is the full object, a gapped envelope already contains the complete current state — so committing it directly would be correct (a documented future optimization in `client.js`); the Shipped reconciler instead follows the explicit gap→refetch path (§3.4). There is no fourth field: identity is in the `key` (the transport's subscription key, §4), not the envelope.

**Why `schema_version` is in the envelope, not just a connect-time handshake.** A long-lived replica can outlive a server deploy that bumps the schema. Putting the version *on every envelope* means a breaking change is detected at the *first post-deploy delta*, per-object, without a reconnect — the version is the explicit, *earlier* signal than the parse gate (it says "different shape, refetch" rather than letting parse say "malformed, recover"). The two gates compose: version first (cheap, structural), parse second (authoritative, content).

---

## 2. The declaration forms

There are three source-position declaration forms. All three lower to a `synced(...)` runtime call bridged into a read-only, auto-disposed `$state` cell — the `__syn_` bridge — and all three are legal in `.pui` (component-scoped) and at `source` position generally [→ ch:pui-component-model]. They differ only in *how the schema and arguments are supplied*.

```
SyncFromDecl  ::= "sync" Ident "::" Schema "from" Key ";"      ⟨validated — the default⟩
                | "sync" Ident ":"  Type   "from" Key ";"      ⟨type-only — trusted opt-out⟩
SyncedDecl    ::= "synced" Ident TypeAnn? "=" Args ";"          ⟨full-control⟩
Schema        ::= Expr     ⟨a SchemaValue with a parse(v)⟩
Type          ::= Type     ⟨a TS type only; no runtime gate⟩
Key           ::= Expr     ⟨the synced key, usually a template string `user:${id}`⟩
Args          ::= Expr ("," Expr)*   ⟨the argument list to synced(): key, opts⟩
```

**Lexical note.** `sync` and `synced` are *distinct* contextual keywords, recognized only in disambiguating positions. `sync` fires on `sync NAME (::|:) … from …`; `synced` fires on `synced NAME =`. The `synced(...)` *call* the lowering emits is never re-matched as the keyword because the keyword regex requires `synced <ident> =`, not `synced(` (the same superset-closure guard that protects `signal`/`derived`, [→ ch:overview-and-surfaces §1.1]). The `from` keyword closes the annotation; the key extent runs to a top-level `;` (or, for `synced`, the comma-separated arg list's extent is found by the same `derivedInitEnd` continuation scan a `derived`/`async signal` initializer uses, so the key and opts object may span lines).

### 2.1 `sync NAME :: SCHEMA from KEY` — the validated form (the common case)

**Status:** Shipped (`para-preprocess` `lowerSyncFromDecls`).

The readable declarative default. `::` is a **runtime parse gate** — rhyming with Para's `value :: Schema` boundary operator [→ ch:type-and-schema-system §`::`] — threaded into `synced(key, SCHEMA)` so *every envelope* is parse-gated before apply (INV-sync-1). The key is the `from` source; delivery (the transport / stream) is inferred from `configureSynced` (§4.3) so the call site stays minimal.

```
# Desugar:  sync NAME :: SCHEMA from KEY
.pui source:
    sync user :: User from `user:${id}`;
Runes (.pui):
    const __syn_user = synced(`user:${id}`, User);
    let user = $state(__syn_user.peek?.() ?? __syn_user);
    $effect.pre(() => __syn_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __syn_user.dispose?.());
```

`SCHEMA` is passed as `synced`'s **second positional argument** — the ergonomic form (`synced.js` disambiguates a positional schema as "anything with a `parse` method"). The cell's type `T` is **inferred** from `synced<T>` via the schema (no annotation needed — the schema *is* the type source). `synced` is auto-imported from `@lyku/para-sync` (`import { synced } from "@lyku/para-sync";`).

**Static semantics.** `user` has type `Infer<typeof User>` (the schema's `T`, [→ ch:type-and-schema-system §`Infer`]). It is a **read-only view** (INV-sync-3): no assignment-rewrite is emitted, so `user.name = "x"` mutates the local `$state` snapshot only and is *not* a server write (and under a future `strict-totality` / per-field-authority regime, §13.2, writing an un-opted field is a compile error). When the `.para` manifest declares `authority { User => class-a }`, the declaration is type-checked against `__paraAuthority[User]` [→ ch:overview-and-surfaces §5.1 Interaction].

**Dynamic semantics.** `peek()` seeds the cell once at bind; `subscribe(cb)` (inside `$effect.pre`, before first paint) drives every subsequent apply; `dispose()` (in `onDestroy`) tears down the stream + reconciler exactly once (INV-sync-1 inherited from §07 INV-src-1). The *reconcile* behavior between `subscribe` firing and the cell updating is §3 — the parse gate, the version check, the sequence reconcile all live inside `synced`.

### 2.2 `sync NAME : TYPE from KEY` — the type-only / trusted form

**Status:** Shipped (`para-preprocess` `lowerSyncFromDecls`, single-colon branch).

The deliberate opt-out. A single `:` carries a **TS type only** — *no* runtime schema, *no* parse gate. Delivery is still from `configureSynced`; the cell is `synced(key)` with no second argument, so the gate is the `PASSTHROUGH_SCHEMA` (`parse: (value) => ({ tag: "Ok", value })`). Because no schema is present, `T` cannot be inferred from `synced<T>`, so the annotation is threaded onto the `$state` cell instead.

```
# Desugar:  sync NAME : TYPE from KEY
.pui source:
    sync flags : FeatureFlags from "flags:global";
Runes (.pui):
    const __syn_flags = synced("flags:global");
    let flags: FeatureFlags = $state(__syn_flags.peek?.() ?? __syn_flags);
    $effect.pre(() => __syn_flags.subscribe?.((__v: typeof flags) => { flags = __v; }));
    onDestroy(() => __syn_flags.dispose?.());
```

**Static semantics.** This is the **trusted / opt-out** mode and is a *visible* opt-out, not a silent `any` (I3): the single `:` is the deliberate mark that this stream is not parse-gated. `synced` replicates server-authoritative data over an *untrusted wire*, so the real gate (the `::` form) is the default; skipping it is an explicit author decision. A schema that is *present but malformed* (no `parse`) remains a hard error — that is a mistake, not an opt-out (`synced.js`: `synced: the provided schema has no parse(value) method`).

&gt; **Edge case (`::` vs `:` greediness).** The lowering's annotation regex captures the colon count with `(::?)`, greedy, so `::` wins over `:` — `sync x :: S from k` is *always* the validated form, never parsed as `: (:S)`. The annotation is single-line up to ` from `; the key (after `from`) may span lines.

### 2.3 `synced NAME = ARGS` — the full-control form

**Status:** Shipped (`para-preprocess` `lowerSyncedDecls`).

The escape hatch into the full `synced(...)` options object — used when you need a `stream`, a `transport` override, a `seed`, a `refetch`, an explicit `schemaVersion`, or a `cell`. `ARGS` is the **argument list to `synced()`** (`key, opts`) with no redundant inner `synced(` — mirroring how `signal x = V` wraps `signal(V)` and `async signal x = E` wraps `promiseSignal(() => (E))`.

```
# Desugar:  synced NAME = ARGS
.pui source:
    synced cart = `cart:${userId}`, { schema: Cart, refetch: () => api.getCart(userId), schemaVersion: "3.1" };
Runes (.pui):
    const __syn_cart = synced(`cart:${userId}`, { schema: Cart, refetch: () => api.getCart(userId), schemaVersion: "3.1" });
    let cart = $state(__syn_cart.peek?.() ?? __syn_cart);
    $effect.pre(() => __syn_cart.subscribe?.((__v: typeof cart) => { cart = __v; }));
    onDestroy(() => __syn_cart.dispose?.());
```

`ARGS` may span multiple lines (the opts object); its extent is found by the `derivedInitEnd` continuation scan (a top-level comma between `key` and `opts` is a *continuation*, not a terminator). To bind a **pre-built** handle instead of constructing one, use `source x = handle` [→ ch:sources-async-and-native §2] — `synced` is for *constructing* a replica; `source` is for *binding* any handle that already satisfies the convention.

### 2.4 The auto-dispose bridge (shared by all three)

All three forms emit the **identical four-line `__syn_` bridge** (`syncedBinding` in `para-preprocess`), which is the §07 source convention applied to a `synced` handle:

| Line | Code | Role |
|---|---|---|
| 1 | `const __syn_NAME = synced(...)` | construct the replica (the only line that differs across forms) |
| 2 | `let NAME = $state(__syn_NAME.peek?.() ?? __syn_NAME)` | seed the cell from the SSR snapshot (optional-chained: a bare value works) |
| 3 | `$effect.pre(() => __syn_NAME.subscribe?.((__v) => { NAME = __v; }))` | live updates before first paint; the unsubscribe is the effect teardown |
| 4 | `onDestroy(() => __syn_NAME.dispose?.())` | exactly-once teardown of stream + reconciler on unmount |

The `?.` on every method makes the convention **open by structural subtyping** (§07 INV-src-3): the handle, a bare signal, and a plain value all bind. This is *why* `synced`'s handle exposes `peek`/`subscribe`/`dispose` (§5) — so it slots into the *same* bridge a `source` uses, satisfying I2 (the bridge is renderer-swappable; the spine — `synced`, the reconciler — is not).

&gt; **Note (`.pts` vs `.pui`).** The bridge above is the `.pui` (runes) lowering. In a plain `.pts` source position, `synced(...)` returns the handle directly and the caller reads `.value`/`.status`/`.get()`; there is no `$state`/`onDestroy` injection because there is no component lifecycle — the owning `resource()`/`arena` disposes it [→ ch:effects-lifecycle-concurrency]. A reactive `sync`/`synced` declaration in a `<script module>` block is the same compile error as any reactive declaration there [→ ch:overview-and-surfaces §1.2 edge case].

---

## 3. `createClientReplica` — the reconcile engine

**Status:** Shipped (`@lyku/para-sync` `client.js`).

The heart of Tier 1: a pure `receive → parse → version-check → apply` engine. It takes the SSR seed and the stream of envelopes, gates every inbound value through the schema `parse`, reconciles by `(schema_version, sequence)`, and applies the authoritative value into a reactive cell so the DOM reacts. **What it is not:** it does not open the socket, does not run the connect-time handshake, and does not write. It is transport-agnostic — `synced` (§5) wires the stream into it.

```pts
// .pts — the replica options (@lyku/para-sync client.js)
createClientReplica({
  key,            // string — the synced key, e.g. "user:123"
  schema,         // SyncSchema — the parse gate ({ parse(v): Result })
  transport,      // SyncTransport — the change-envelope source
  seed?,          // SyncEnvelope — SSR-embedded initial envelope
  refetch?,       // () => Promise<SyncEnvelope> — Err/skew/gap fallback
  cell?,          // Cell — reactive cell ({ get, peek, set }); default: a para signal
  schemaVersion?, // string — the client's expected "major.minor"
});
```

The schema dependency is **structural, not nominal**: `SyncSchema = { parse(v: unknown): Result }` where `Result = { tag: 'Ok', value } | { tag: 'Err', error }`. The replica depends only on this shape, never on `para-schema` directly — which is *also why it branches on `.tag`* instead of the throw-on-`Err` `::` convention (INV-sync-1: a malformed delta must trigger recovery, not crash). The `Cell` is `{ get(): any, peek(): any, set(v): void }` — a para `signal()` satisfies it exactly and is the default; it is injectable for tests and for a Svelte-fork-backed cell.

### 3.1 The `ingest` state machine (normative ordering)

Every envelope enters `ingest(envelope, source)` where `source ∈ { 'hydration', 'receipt', 'refetch' }`. The gates run in this **fixed order**; the first that fires returns:

1. **Disposed guard.** If the replica is disposed, drop the envelope (no apply after teardown).
2. **Schema-version gate** (§3.2). If `schemaVersion` is set *and* the envelope's major differs → `schemaSkews++`, status `skew`, and (unless this is itself a refetch) start a recovery refetch. Return.
3. **Parse gate** (§3.3, INV-sync-1). `schema.parse(envelope.value)`; if `.tag !== 'Ok'` → `parseErrors++`, status `skew`, recover (unless this is a refetch — never refetch in response to a refetch result; avoids an `Err`→refetch loop). Return.
4. **Baseline (re)seed** (§3.4). If `source` is `'hydration'` or `'refetch'`, *or* the replica is not yet `initialized` → `commit` unconditionally (this is the new authoritative baseline). Return.
5. **Steady-state receipt reconcile** (§3.4). Compare `envelope.sequence` to the current applied `sequence`:
   - `<= cur` → `ignoredStale++` (stale / duplicate / out-of-order). Return without applying.
   - `=== cur + 1` → `commit` (in-order). Return.
   - `> cur + 1` → `gaps++`, start a refetch (one or more envelopes missed). Return.

`commit(value, envelope)` sets the cell, marks `initialized`, and writes `meta = { schemaVersion: envelope.schema_version, sequence: envelope.sequence, status: 'ok' }`, `applied++`.

&gt; **INV-sync-5 (gate order is normative).** Version *before* parse *before* sequence is the required order: the version gate is the cheap structural signal ("different shape, refetch"), the parse gate is the authoritative content signal ("malformed, recover"), and the sequence reconcile only runs on a value that already parsed against a compatible version. Reordering would let a malformed value reach the sequence compare, or a stale-but-valid value bypass the version check. A conforming implementation MUST run them in this order.

### 3.2 The schema-version gate (major-only, breaking-change detection)

```pts
// .pts — major-only comparison (client.js majorMismatch)
function majorMismatch(a, b) {
  const ma = /^(\d+)\./.exec(String(a ?? ""));
  const mb = /^(\d+)\./.exec(String(b ?? ""));
  if (ma === null || mb === null) return false;  // malformed → not a mismatch; let parse be the backstop
  return ma[1] !== mb[1];
}
```

**Static semantics.** `schemaVersion` is the *client's expected* `"major.minor"`. When set, an inbound envelope whose **major** differs is a *breaking* skew (different shape) — not applied, recovery refetched. A **minor** difference (same major) is *compatible* and falls through to the parse gate. A missing or malformed version returns `false` (no mismatch) — the design choice is to let the parse gate be the backstop rather than block on a version-format quirk.

**Dynamic semantics.** On a major mismatch from a `'hydration'` or `'receipt'` source: `status = 'skew'`, `schemaSkews++`, `startRefetch()`. On a major mismatch whose `source` is `'refetch'`: status `skew` but **no** further refetch (a refetch that itself returns the wrong major means the server genuinely has a breaking shape; looping would not help). This is the "explicit, earlier signal" of INV-sync-2: the version says *different shape, refetch* before the parse gate would say *malformed, recover*.

### 3.3 The parse gate (the trust boundary, branch-never-throw)

```pts
// .pts — every inbound value crosses parse (client.js ingest)
const res = schema.parse(envelope.value);
if (res.tag !== "Ok") {
  stats.parseErrors++;
  setMeta({ status: "skew" });
  if (source !== "refetch") startRefetch();   // recover — but never refetch a refetch result
  return;                                       // DO NOT poison the cell
}
```

This is INV-sync-1 in code. The gate is the trust boundary every envelope crosses; on `Err` the cell is **left untouched** (the last known-good value stays), status goes `skew`, and recovery is via a known-good snapshot (`refetch`). The `source !== "refetch"` guard prevents an `Err`→refetch→`Err`→refetch loop. This is the precise inverse of the `::` handler gate (throw-on-`Err`, [→ ch:errors-results-and-validation]): at a *write boundary* a bad value is a caller error to reject loudly; at a *replication boundary* a bad value is a transient skew to recover from quietly.

&gt; **Edge case (no `refetch` configured).** If `refetch` is omitted, `startRefetch()` sets `status = 'stale'` and returns — there is no recovery, the cell holds its last value, and the status truthfully reports the replica is behind. Omitting `refetch` is "no recovery available," surfaced, not hidden.

### 3.4 Baseline vs steady-state, and the gap rule

The reconciler distinguishes **(re)seeding the baseline** from **incremental steady-state**:

- **Baseline** — `'hydration'` (the SSR seed), `'refetch'` (a recovery snapshot), or the *very first* value the replica has seen (`!initialized`). Accepted **unconditionally** as the new authoritative baseline (no sequence check — a baseline *defines* the sequence). This is how an SSR-seeded replica starts, and how a gapped replica re-synchronizes.
- **Steady-state receipt** — a `'receipt'` on an already-`initialized` replica. Reconciled by sequence against the current applied `sequence` (`cur`):
  - **`sequence <= cur`** — stale, duplicate, or out-of-order. `ignoredStale++`, ignored. (The transport is a dumb pipe with no dedupe, §4.1 — the *reconciler* is where dedupe-by-sequence lives.)
  - **`sequence === cur + 1`** — exactly the next envelope. `commit`, in-order.
  - **`sequence > cur + 1`** — a **gap**: one or more envelopes were missed. `gaps++`, `startRefetch()` to fetch the full snapshot and re-baseline.

&gt; **INV-sync-6 (the gap rule, and its documented relaxation).** The Shipped reconciler follows the **explicit gap→refetch** path. Because the full-object delta model means a gapped envelope *already carries the complete current value* (§1, INV-sync-4), committing it directly would be correct *and* cheaper — a documented future optimization. A conforming implementation MAY adopt the direct-commit relaxation; it MUST NOT silently apply an out-of-order (`<= cur`) envelope, since that would let a stale value win.

```
# State diagram (Tier-1 ingest):
   ┌──────────── hydration / refetch / first value ────────────┐
   │                       (unconditional)                      ▼
 [stale] ──parse Ok──────────────────────────────────────────► [ok]
   ▲  ▲                                                   │  │   │
   │  │  parse Err / major skew (no refetch configured)   │  │   │ seq == cur+1
   │  └────────────────────────────────────────────────── │  │   └──► [ok]
   │                                                       │  │ seq <= cur → ignore (stay [ok])
 [skew] ◄── parse Err / major mismatch ────────────────────┘  │ seq  > cur+1 → gap
   │                                                            ▼
   └──────── startRefetch() ──────────────────────────► [refetching] ──snap──► (re-ingest as 'refetch')
```

---

## 4. The transport contract

**Status:** Shipped (`@lyku/para-sync` `transport.js`).

The transport is the **server-internal** mechanism that carries an envelope from the write handler to the listen handlers. `synced` and the parse gates build on top of it; it is a *pluggable interface* so the same primitive runs on a single box or across services.

```pts
// .pts — the pluggable contract (transport.js)
interface SyncTransport {
  publish(key: string, envelope: SyncEnvelope): void;
  subscribe(key: string, handler: (e: SyncEnvelope) => void): Unsub;  // Unsub idempotent
}
```

### 4.1 The dumb-pipe contract (every implementation honors)

The transport is, by contract, a **dumb pipe**:

- `publish(key, envelope)` delivers `envelope` to every *current* subscriber of `key`. Publishing to a key with **no subscribers is a no-op** (never throws).
- It does **NOT** retain the latest value, does **NOT** validate the envelope, and does **NOT** dedupe by sequence. A subscriber receives only publishes that happen **after** it subscribes — initial state arrives via the **SSR seed**, not the transport.
- `subscribe(key, handler)` returns an **idempotent** `Unsub`.

&gt; **INV-sync-7 (separation of concerns: transport carries, reconciler decides).** Retention, validation, and dedupe are deliberately *absent* from the transport and *present* in the reconciler: retention is the SSR seed's job, validation is the parse gate (§3.3), dedupe is the sequence reconcile (§3.4). A keyed emitter models "deliver future publishes to this handler" exactly — *without* the current-value-on-subscribe and `Object.is`-dedupe a signal would impose. This is why the transport is a plain emitter and not a per-key signal. Mixing reconcile logic into the transport would couple authority semantics to the pipe and break the InProcess↔NATS substitutability.

### 4.2 `InProcessTransport` — monolith / edge / IoT

A keyed pub/sub emitter (`Map<key, Set<handler>>`). No bus, no network, no serialization — the write and the listen happen in the **same process**, so delivery is a synchronous call. For monolith / edge / all-in-one / IoT deployments where there is no inter-service bus to stand up.

- **`publish`** snapshots the handler set (`Array.from`) before iterating, so a handler that subscribes/unsubscribes *during* delivery has well-defined semantics: handlers live at publish time receive the envelope; one added mid-delivery does not.
- **`subscribe`** GCs the empty key — the `Map` entry is deleted when its last subscriber leaves (no key leak). `keyCount()` is a leak diagnostic (a healthy server returns to a steady key count as sessions churn).
- **`Unsub`** is idempotent via an `active` flag: a second call is a no-op and will not remove a handler that re-subscribed in between.

### 4.3 `NatsTransport` — multi-service

For deployments where a write in the writer's service must reach listeners in *other* services over NATS. Honors the **same** dumb-pipe contract (deliver to current subscribers, no retention, idempotent unsub), and adds three things the cross-process boundary requires:

- **Subject mapping** — `key → NATS subject` (default `synced.${key}`, overridable via `subjectOf`).
- **The wire codec** — `encode` on publish, `decode` on receipt. NATS payloads are `Uint8Array`; production injects a **BON or msgpackr** codec (envelopes carry bigint IDs that JSON cannot represent — BON is the SSR/wire serializer for exactly this reason; A1). The default is identity (object passthrough) — fakes/tests only, **not** a real connection.
- **Local fanout** — N local subscribers to one key share **one** bus subscription; `decode` runs once, fans out to local handlers; the bus subscription is torn down when the *last local* subscriber leaves (the cross-service analog of subscriber-set GC).

&gt; **INV-sync-8 (client side is transport-invariant).** The **client** half — WS receive → parse → version-check → apply (§3) — is *identical* across both transports. Only the server-internal "how the write reaches the listen handler" differs, selected by deployment config (`transport in-process` vs `transport nats {…}` in the `.para` manifest, [→ ch:overview-and-surfaces §5.1]). This is the I2 statement for the transport layer: the reconcile spine is substrate-independent; the transport is the swappable substrate. A future third transport (e.g. a Redis stream) conforms by satisfying `SyncTransport` and the dumb-pipe contract — the reconciler does not change.

```
# Desugar:  the in-process objectfeed vs the per-object stream (synced.js resolution)
Para (app.para):    transport in-process;
Effect:             configureSynced({ transport: new InProcessTransport() })  — shared keyed transport;
                    its subscribe(key) IS the per-key stream (the "single objectfeed WS" end-state).
Para (app.para):    transport nats { url: "nats://bus:4222" };
Effect:             configureSynced({ transport: new NatsTransport({ connection, codec: bon }) }).
Fallback (today):   configureSynced({ resolveStream: (key) => api.stream*(key) }) — per-object endpoints;
                    each replica gets a PRIVATE InProcessTransport fed by the resolved stream.
```

---

## 5. The `SyncedHandle` — the client read surface

**Status:** Shipped (`@lyku/para-sync` `synced.js`).

`synced(key, schemaOrOpts, opts?)` wraps `createClientReplica` and adds the four pieces every adopter would otherwise hand-roll (a default transport, a stream→transport bridge, the tracked read surface, one teardown). It returns the **`SyncedHandle`** — the value the `__syn_` bridge (§2.4) drives:

```pts
// .pts — the handle (synced.js return shape)
interface SyncedHandle<T> {
  readonly value: T;            // tracked read — the rune's primary read surface
  readonly status: ReplicaStatus;  // tracked: 'ok' | 'stale' | 'skew' | 'refetching'
  get(): T;                     // tracked read, signal-style
  peek(): T;                    // untracked read
  subscribe(cb: (v: T) => void): () => void;  // the source-convention hook (drives the bridge)
  meta(): ReplicaMeta;          // tracked: { schemaVersion, sequence, status }
  peekMeta(): ReplicaMeta;      // untracked meta
  stats: ReplicaStats;          // observability counters — read directly
  whenIdle(): Promise<void>;    // resolves when no recovery refetch is in flight
  dispose(): void;              // stop stream + reconciler; idempotent
}
```

- **`value` / `get()`** — **tracked** reads of the default para-signal cell, so reading inside a reactive context (a `.pui` component, a `derived`, an `effect`) subscribes to live updates with **no manual effect**. `value` is the rune's primary surface (`{user.name}` in markup); `get()` is the signal-style equivalent.
- **`status`** — a tracked read of the reconcile `status`, so a `{#if user.status === 'skew'}` branch reacts to skew/refetch transitions the same way the value reacts.
- **`peek()` / `peekMeta()`** — untracked snapshots (for use *outside* a reactive context, or to read without subscribing).
- **`subscribe(cb)`** — fires with the current value now and on every apply; returns an unsubscribe. This is the §07 source-convention hook the bridge's `$effect.pre` consumes (line 3 of §2.4). It is a **no-op** when an injected cell has no `.subscribe` (a host store drives reactivity in that case).
- **`meta()`** — the full reconcile meta: `{ schemaVersion, sequence, status }` (tracked). The applied schema version, the applied sequence (`-1` if uninitialized), and the status.
- **`stats`** — observability counters, read directly: `{ applied, ignoredStale, gaps, parseErrors, refetches, schemaSkews }`. These are the §3 state-machine's edge counts, exposed for monitoring (a rising `gaps`/`refetches` means a lossy stream; a rising `schemaSkews` means a deploy-version mismatch).
- **`whenIdle()`** — resolves when no recovery refetch is in flight. A test/await aid (`await handle.whenIdle()` after seeding to drain any refetch).
- **`dispose()`** — closes the stream (`sock?.close?.()`, swallowing throws — teardown must not throw) and disposes the replica. Idempotent.

### 5.1 `ReplicaStatus` — the four states

```pts
type ReplicaStatus = 'ok' | 'stale' | 'skew' | 'refetching';
```

| Status | Meaning | Reached by |
|---|---|---|
| `ok` | last apply succeeded; replica is current | a successful `commit` (§3.1) |
| `stale` | uninitialized, or a refetch failed / none available | initial state; `refetch` absent or thrown |
| `skew` | an inbound value failed `parse` (malformed or schema-skew) | parse `Err` (§3.3) or major mismatch (§3.2) |
| `refetching` | a recovery refetch is in flight | `startRefetch()` while `refetch` is configured |

The status is a **first-class, tracked** part of the read surface precisely because skew is *visible and recoverable*, not hidden — a component can render a "reconnecting…" banner off `status === 'refetching'` and a "data may be stale" off `'skew'`, discharging the I1 "never opaque about the output" rule at runtime.

### 5.2 Call forms and default resolution

```pts
// .pts — two call forms (synced.js)
synced(key, schema, opts?);   // schema positional (the ergonomic form) — `synced(key, schema)` with config'd delivery
synced(key, opts);            // schema inside opts (the explicit form)
```

The positional schema is disambiguated structurally (anything with a `parse` method). Delivery resolves in a fixed precedence: an explicit `stream`/`transport` in `opts` wins; else the configured shared `transport` (the objectfeed); else a private `InProcessTransport` fed by the configured `resolveStream(key)`. The stream is opened **after** the replica subscribes (so no envelope is delivered to an unsubscribed key — `InProcessTransport` drops publishes with no subscribers, §4.1). The seed (SSR initial state) seeds the baseline; the stream carries only future changes (§3.4).

---

## 6. Visibility projection — field-level access control

**Status:** Shipped (`@lyku/para-sync` `visibility.js`).

The authority model has a second axis beyond *when* a value applies (the reconciler): **which fields a given viewer is allowed to see**. This is field-level access control, projected **per viewer-class**, and it is deliberately **domain-free**: the framework owns the *mechanism* (a tag→decision map + a gate + a cache); the app owns the *meaning* (what "friends"/"followers"/"subscribers" denote). Adding a brand-new relationship type touches **zero** framework code — it is one resolver entry in the app.

### 6.1 `defineVisibility` — register the domain vocabulary

```pts
// .pts — the ONLY place a domain relationship enters the sync layer (visibility.js)
defineVisibility({
  friends:   (viewer, owner) => areFriends(viewer, owner),       // sync or async
  followers: async (viewer, owner) => follows(viewer, owner),    // a DB lookup
});
```

A `VisibilityResolver` is `(viewer: bigint | undefined, owner: bigint) => boolean | Promise<boolean>`. It answers "may this viewer see a field tagged with my key?" An **unregistered tag denies** (fail-safe) — a typo or not-yet-defined tag never leaks. A **throwing** resolver is treated as **deny** (also fail-safe). `defineVisibility` merges into prior registrations; call once near init.

&gt; **INV-sync-9 (fail-safe visibility).** An unknown tag, a throwing resolver, and an unregistered relationship all resolve to **deny**. The default is *strip the field*, never *expose it* — a visibility bug fails closed, leaking nothing. This is the access-control analog of the parse gate's "never poison the cell": the projection never *over*-shares on error.

### 6.2 `classKeyOf` — the cache-sharding key (the scaling insight)

```pts
// .pts — the viewer's visibility CLASS for an object (visibility.js)
classKeyOf(viewer, owner): Promise<string>
//   self  → "self"   (owner sees the full record)
//   else  → the canonical (sorted, '+'-joined) set of SATISFIED tags, or "none"
//           e.g. "friends+followers", "followers", "none"
```

`classKeyOf` calls every registered resolver for `(viewer, owner)` and returns the **canonical sorted `+`-joined set of satisfied tags**. This string is the entire scaling argument:

&gt; **INV-sync-10 (class-keyed, not viewer-keyed — cardinality is bounded by realized classes).** Two viewers who satisfy the **same tag set** get the **identical** projection, so they **share one cache entry**. Cardinality is therefore bounded by the *realized tag combinations* (a handful — `{}`, `{friends}`, `{followers}`, `{friends+followers}`, …), **not** by the number of viewers. A million followers of one user collapse to *one* `followers` projection. This is the difference between an access-control cache that scales and one that explodes; it is why the class key, not the viewer id, is the shard.

The owner resolves to the `self` sentinel (full record). The function is domain-free — it calls the app resolvers but never *interprets* a tag.

### 6.3 `projectByClass` — the pure projection

```pts
// .pts — a PURE function (no resolver calls) (visibility.js)
projectByClass(value, fields, classKey)
//   fields: Record<gatedField, visibilityTagKey>  — e.g. { dateOfBirth: 'dateOfBirthVisibility' }
//   self → value untouched
//   else → keep a gated field iff its tag is in the class's satisfied set;
//          ALWAYS strip the visibility-setting keys (never expose the owner's setting)
```

Given a class key (the *satisfied* set), `projectByClass` keeps each gated field iff its visibility tag is satisfied, and **always strips the visibility-setting keys themselves** (`delete out[tagKey]`) — a viewer never sees *which* setting gated a field, only the result. It is **pure**: no resolver calls (those happened in `classKeyOf`), so it is the cacheable half. `self` returns the value untouched.

### 6.4 `visibilityGate` — the generic `authorize`

```pts
// .pts — replaces a hand-written per-model gate (visibility.js)
const authorize = visibilityGate({
  fields: { dateOfBirth: 'dateOfBirthVisibility', email: 'emailVisibility' },
  ownerOf: (user) => user.id,   // default: the synced key's id
});
//   owner → full;  else → { check: (value) => ({ project: (v) => projectByClass(...) }) }
```

`visibilityGate` builds a model's `authorize` from a per-field spec — the generic gate that replaces a hand-written one. Owner → full; everyone else → a per-field projection driven by their visibility class. **Domain-free.** This discharges the A4 risk (custom auth forcing an `any`): the gate is a typed projection of the schema's field-visibility annotations, not an ad-hoc handler check.

### 6.5 `createVisibilityCache` — the version-stamped scalable serve path

**Status:** Shipped (`@lyku/para-sync` `visibility.js`; commit `cbb3a59` — per-class version-stamped cache).

The scalable serve path. The cache key encodes the scaling discipline:

```
cacheKey = `${keyPrefix}${objectKey}:${classKey}:${version}`
//   e.g.  synced:user:123:friends+followers:42
```

Three properties make granular access control scale:

- **VERSION-STAMPED.** `version` is the object's version (the synced `sequence`). A data change bumps `version`, producing **new keys**; stale entries simply **LRU-evict** — no invalidation messaging, no fan-out. (Closes the cache-coherence problem: there is *nothing to invalidate*, only newer keys to write.)
- **CLASS-keyed** (not viewer-keyed). Cardinality is `objects × realized-classes` (a handful), not `objects × viewers` (INV-sync-10). Hot objects are cached once per class and shared; cold ones evict.
- **RELATIONSHIP CHURN IS FREE.** An unfriend/unfollow **never invalidates** a projection — the viewer simply resolves to a *different* `classKey` on the next read and hits a *different* (already-warm) entry. The expensive cache only changes on actual **data** change. (Relationship caching is the app resolvers' job, amortized per *owner*, not per *pair*.)

The backend is injected (domain- and store-agnostic): any `{ get, set }` over bytes — a Valkey/Redis adapter in production, a `Map` in tests. The owner's view is full and **uncached** (a one-off). A cache read failure falls through to compute; a cache write failure must not fail the read (the cache is an optimization, never a correctness dependency).

&gt; **INV-sync-11 (the version stamp ties visibility to the reconcile spine).** The cache `version` *is* the synced `sequence` (INV-sync-2's reconcile key #2). So the *same* monotonic counter that orders the reconciler's applies also stamps the visibility cache: a new authoritative value (new `sequence`) is, by construction, a new cache generation. The two halves of the authority model — *when* a value applies and *what fields it exposes* — are keyed by one number. This is what makes "field-level access control" a *projection of the same spine* (I3) rather than a bolt-on.

---

## 7. The Class-A / Class-B reconciliation taxonomy

**Status:** Class-A default — design-baked (`s5-reconciliation-spike.md`); the Tier-1 read reconciler (§3) is its read-side embodiment. Class-B opt-in — Proposed (§13.2).

The authority model's *write*-side conflict story (Tier 2, §13) is governed by a two-class taxonomy. The distinction is load-bearing because conflating them is exactly the Meteor trap:

- **Class A — sequenced single-writer reconciliation.** One client racing its *own* lagged/debounced server state: Like/Unlike spam, debounce-coalesced sends, stale echoes flipping the UI back. **This is baked, with a default policy.** It is the common real case and the precise inverse of the project's silent-drift footgun.
- **Class B — concurrent multi-writer field merge.** *Different* writers diverging on the same mutable field (CRDT/OT territory). **This stays explicit per-field opt-in policy.** Ambient auto-merge here is the genuine Meteor trap.

### 7.1 The Class-A default policy (baked, readable, no per-mutation policy)

The Class-A mechanism is **monotonic per-entity last-intent-wins + stale-echo suppression**:

- The optimistic local value flips instantly; a per-entity **logical version `v`** increments on each intent.
- The debounced sender coalesces intermediate flips and transmits only the *current* value tagged `(entityId, v)` — intermediate toggles never reach the wire (debounce made *correctness-aware*).
- The server applies and echoes `{ entityId, value, v }`.
- The state machine: **accept an echo iff its `v` ≥ the last sent version; drop any echo whose `v` is older than the current local intent** (kills the unlike-flicker); on server **reject**, roll back to the last server-confirmed value.

&gt; **INV-sync-12 (Class A is read-reconcile's write-side mirror).** The Tier-1 reconciler (§3) already *is* the read-side Class-A machine: `sequence` is the monotonic key, `<= cur` envelopes are the stale echoes it suppresses (`ignoredStale`), and the baseline re-seed is the "roll back to last server-confirmed." Tier 2 (§13.1) extends the *same* monotonic-last-intent-wins discipline to the write direction with an op-id for correlation. The two tiers share one reconcile philosophy: a single monotonic counter, stale-suppression, server-authoritative baseline — never a merge.

### 7.2 Why Class B stays explicit (the anti-Meteor boundary)

Class-B concurrent multi-writer merge is **only** reachable by a per-field schema opt-in (§13.2), and even then the merge function is a **readable hand-written delta** — no ambient magic. This is not a gap; it is the *correct boundary* (`s5-reconciliation-spike.md` "Honest negative result"):

&gt; The spine bakes typed transport + op-id correlation + the mechanical optimistic state machine + the Class-A default. It deliberately does **NOT** bake Class-B concurrent multi-writer merge. Class A (Like/Unlike-class) is handled *by default*; Class B is explicit per-field opt-in only. The thesis does **not** promise automatic *multi-writer* conflict resolution and must never be sold as such.

This discharges falsification criterion §6.4: the sync model is never "correct only via hidden behavior" — the mechanical machine is generated/readable, the policy is *literally your typed function*, and concurrent merge is opt-in with a visible merge fn. NO-GO is triggered *only* by a requirement for zero-policy automatic Class-B merge — which the surface refuses to pretend it does.

---

## 8. Worked example — a synced entity end to end

```pts
// .pts — the schema spine (the single source of truth)
schema User {
  id: UUID,
  name: string,
  email: Email,
  dateOfBirth: Date,
  dateOfBirthVisibility: string,   // holds the visibility TAG for dateOfBirth
}
```

```para
// app.para — declare the authority + transport once [→ ch:overview §5.1]
spine { "src/schema/**.pts"; }
authority { User => class-a; }       // single-writer; baked Class-A default
transport nats { url: "nats://bus:4222", subjectOf: "synced.${key}" };
```

```pts
// init.pts — the app's domain vocabulary + the server-side gate (run once)
defineVisibility({ friends: (v, o) => areFriends(v, o) });
const cache = createVisibilityCache({ backend: valkey, ttlSeconds: 300 });
const authorize = visibilityGate({ fields: { dateOfBirth: 'dateOfBirthVisibility' } });
```

```pui
<!-- profile.pui — the view consumes the synced entity as an ordinary reactive value -->
<script lang="ts">
  prop id: string;
  sync user :: User from `user:${id}`;   // validated replica — parse-gated every envelope
</script>

{#if user.status === 'refetching'}<span class="muted">reconnecting…</span>{/if}
<h1>{user.name}</h1>
{#if user.dateOfBirth}<time>{user.dateOfBirth}</time>{/if}   <!-- absent unless the viewer's class allows -->
```

```pts
// ✗ counter-example — Tier-1 is read-only (INV-sync-3)
sync user :: User from `user:${id}`;
user.name = "Mallory";   // ✗ NOT a server write — mutates the local $state snapshot only.
                         //   Writing to the authority is the Tier-2 path (§13.1), never a field set.
```

What is *not* hand-written anywhere: the parse gate (the `::` injects it), the reconcile machine (`createClientReplica`), the transport wiring (`configureSynced` from the manifest), the field-level access control (`visibilityGate` + the cache), the teardown (the `onDestroy` bridge). The `schema User` is the sole source; everything else is a projection of it (I3).

---

## 9. Edge cases & invariants summary

- **Empty-subscriber publish.** Publishing to a key with no subscribers is a no-op (§4.1); the SSR seed, not the transport, carries initial state — so a component that mounts after a publish is not stranded; it seeds from SSR and receives only *future* deltas.
- **Refetch-of-a-refetch.** A parse `Err` or skew whose `source` is `'refetch'` does **not** trigger another refetch (§3.3) — this breaks the `Err`→refetch loop. A refetch that genuinely returns a bad/wrong-major value leaves the replica `skew`/`stale`, surfaced honestly.
- **Disposed mid-flight.** A `dispose()` during an in-flight refetch is safe: the async refetch checks `!disposed` before re-ingesting (`client.js`). `dispose()` is idempotent on both the handle and the transport's `Unsub`.
- **Injected cell without `subscribe`.** The handle's `subscribe` is a no-op when the injected cell has no `.subscribe` — a host store (e.g. a Svelte-fork-backed `SvelteMap`) drives reactivity instead (§5).
- **Malformed version string.** `majorMismatch` returns `false` on a malformed `"major.minor"` — the parse gate is the backstop, not the version format (§3.2).
- **Visibility fail-safe.** Unknown tag / throwing resolver / unregistered relationship → deny / strip (INV-sync-9). The projection never over-shares on error.

| Invariant | Statement |
|---|---|
| INV-sync-1 | The parse gate is the trust boundary; branch on `.tag`, never throw — recover, don't poison. |
| INV-sync-2 | Reconcile by `(schema_version, sequence)`, monotonic; a readable state machine, never a hidden CRDT. |
| INV-sync-3 | Tier-1 is a read-only view; no assignment rewrite; writing is the separate Tier-2 path. |
| INV-sync-4 | The envelope carries the full object → enough to apply, or to detect it cannot. |
| INV-sync-5 | Gate order (version → parse → sequence) is normative. |
| INV-sync-6 | The gap rule is `> cur+1 → refetch`; a conforming impl may direct-commit but must never apply `<= cur`. |
| INV-sync-7 | Transport carries; reconciler decides (retain/validate/dedupe are not the transport's). |
| INV-sync-8 | The client side is transport-invariant; only the server-internal carry differs. |
| INV-sync-9 | Visibility fails closed: unknown/throwing/unregistered → deny/strip. |
| INV-sync-10 | Class-keyed cache cardinality is bounded by realized classes, not viewers. |
| INV-sync-11 | The cache `version` is the synced `sequence` — one counter keys *when* and *what*. |
| INV-sync-12 | Class A is read-reconcile's write-side mirror: monotonic, stale-suppressing, server-baseline; never merge. |

---

## 10. The schema is the application (this chapter's discharge)

This chapter is the §5 "part that historically rots" made into a projection. The discharges:

- **A1 (no binary wire) →** the NATS codec is BON/msgpackr-native (§4.3); envelopes carry bigint IDs JSON cannot represent. The wire format is a schema projection, not a "later."
- **A4 (custom auth forces `any`) →** `visibilityGate` + the version-stamped class cache (§6) make field-level access control a *typed, domain-free projection* of the schema's visibility annotations — not a hand-rolled `any` gate. The relationship vocabulary is the app's one resolver map; the mechanism is the framework's.
- **§5 "KNOWN I3 HOLE" (the realtime payload was `any` at the context layer) →** the parse gate (INV-sync-1) makes every envelope a schema-projected value; `sync x :: S from k` is the typed stream, the single `:` form is the *visible* trusted opt-out (never a silent `any`).
- **§6.4 (sync correct only via hidden behavior) →** the reconciler is a ~90-line branch-on-`.tag` machine (§3); the Class-A policy is fixed/readable/overridable; Class-B merge is opt-in with a visible merge fn (§7). Nothing implicit.
- **I2 (spine survives a renderer swap) →** the reconcile spine is transport-invariant (INV-sync-8) and bridges into runes through the *same* `__syn_` source bridge the swappable view uses (§2.4). The spine is `synced`/`createClientReplica`/the reconciler — not the bridge.

---

## 11. Relationship to adjacent chapters

- **A `synced` cell is a source** [→ ch:sources-async-and-native]. It satisfies `peek`/`subscribe`/`dispose` (§5) and lowers through the identical `$state` + `$effect.pre` + `onDestroy` bridge (§2.4). The *difference* is the `(schema_version, sequence)` reconcile machine — the reason this is a separate chapter. A bare `source x = handle` binds a *pre-built* handle; `synced` *constructs* the replica.
- **The schema and its `schema_version`** are [→ ch:type-and-schema-system]. This chapter *consumes* `Schema.parse` (the gate) and `schema_version` (the reconcile key); it does not define them. The proposed schema-versioning declaration (so `schema_version` is *authored*, not magic) is that chapter's §Proposes.
- **The `::` / `is` operators** are [→ ch:errors-results-and-validation]. Sync uses the gate in **branch-on-`.tag`, never-throw** mode (INV-sync-1) — the inverse of the throw-on-`Err` handler boundary. Same operator, two modes, selected by boundary kind.
- **The `.pui` bridge mechanics** (escape analysis, `$props()`, the runes lowering) are [→ ch:pui-component-model]. This chapter shows the bridge only where reconcile semantics depend on it.
- **The write-path codegen and the wire codec generation** are [→ ch:modules-projections-and-build]. This chapter owns the read + reconcile *runtime and semantics*; the projections chapter owns generating the typed mutation call (§13.1) and the msgpack codec.
- **The `.para` manifest** (`authority`, `transport`) is [→ ch:overview-and-surfaces §5.1]. It closes the otherwise-ambient authority-class and transport facts this chapter's runtime reads.

---

## 12. Conformance checklist (Tier 1)

An implementation is **Tier-1 conformant** iff:

1. Every inbound value crosses a `parse` gate that branches on `.tag` and never throws; on `Err` the cell is untouched and status is `skew` (INV-sync-1).
2. Reconciliation uses `(schema_version, sequence)` with major-only version comparison and monotonic sequence ordering, in the normative gate order (INV-sync-2, INV-sync-5).
3. Tier-1 cells are read-only views with no assignment rewrite (INV-sync-3).
4. The transport is a dumb pipe: no retention, no validation, no dedupe; empty-subscriber publish is a no-op; `Unsub` is idempotent (INV-sync-7).
5. The client reconcile path is identical across transports (INV-sync-8).
6. `ReplicaStatus` exposes `ok`/`stale`/`skew`/`refetching` as a tracked read; `stats` exposes the six edge counters.
7. Gap handling refetches (or direct-commits per the sanctioned relaxation) and never applies an out-of-order envelope (INV-sync-6).
8. Visibility (if implemented) fails closed and is class-keyed + version-stamped by the synced sequence (INV-sync-9, -10, -11).

---

## 13. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts` / the reconciler today). Each includes a desugaring sketch so it remains glass-floor-compatible (I1). They extend the **write** half (Tier 2) and the **shape** of what can be synced (collections, presence, transactions) — the surfaces `schema-is-the-application.md` §5 / `s5-reconciliation-spike.md` mark as designed-favorable-but-bounded. The governing rule throughout: **the mechanical machine is spec'd/generated; the policy is a hand-written typed delta** — concurrent multi-writer merge is *never* ambient (the anti-Meteor boundary, §7.2).

### 13.1 `mutate` — the Tier-2 optimistic write path  `Shipped`

&gt; **Shipped 2026-07:** `para-preprocess` lowers `mutate NAME of ENTITY { … }` to `createIntent` (`writer.js`); the arm set is `optimistic` / `rollback` / `confirm`, and `mutate` is cataloged in `language-surface.ts`. The desugar below is the shipped shape.

**Rationale.** Tier 1 is read-only; today the write half is hand-rolled over `any` (`s5-reconciliation-spike.md` "Ground truth": two uncoordinated `any` mutation streams racing on the same local state, no confirm, no rollback, no correlation). The spine should bake the **mechanical** state machine — optimistic apply → op-id correlation → server confirm/reject → stale-echo dedupe → rollback — and keep the **policy** (the optimistic value, the rollback, the conflict resolution) as a hand-written typed delta. This is the Class-A default (§7.1) extended to the write direction, and it kills *both* `as any`s in the flagship PlotGame flow.

**Grammar.**

```
MutateDecl  ::= "mutate" Ident "of" Key "{" MutateBody "}"
MutateBody  ::= OptimisticArm RollbackArm? ConfirmArm?
OptimisticArm ::= "optimistic" "(" Param ")" Block          ⟨the local value before the server answers — domain logic⟩
RollbackArm   ::= "rollback"   "(" Param ")" Block            ⟨how to revert; default: snapshot-restore⟩
ConfirmArm    ::= "confirm"    "(" Param ")" Block            ⟨optional: run on server confirm⟩
MutateCall  ::= Ident "(" Args ")"                            ⟨the lowered call form, returns a typed intent handle⟩
```

`mutate NAME of KEY { … }` declares a typed mutation against the synced entity at `KEY`. The `optimistic` arm is the **required** policy delta (what local state should be before the server answers); `rollback` defaults to snapshot-restore of the touched entity; `confirm` is optional post-confirm logic.

**Lexical note.** `mutate` fires at statement position before `NAME of`. `of` is a contextual keyword closing the entity binding (distinct from a property named `of`). The arms (`optimistic`/`rollback`/`confirm`) are block-keywords legal only inside a `mutate` body.

**Static semantics.** `KEY` must resolve to a `sync`/`synced` declaration in scope, and that entity's schema (`authority { S => class-a }` in the manifest) determines the **mechanical** machine the lowering emits. The `optimistic`/`rollback` arms are type-checked against `Infer<typeof S>`. Under a `class-a` entity, the write is monotonic-last-intent-wins with op-id dedupe (no extra policy). Under a `class-b` entity (§13.2), the per-field merge fn is *also* required. An intent whose optimistic arm writes a field not in the entity's `class-b` merge set (or any field of a `class-a` entity outside the optimistic arm) is a compile error (`field 'price' is not a writable field of Cart under its authority class`).

**Dynamic semantics / desugar.** The mutation lowers to: generate an op-id; apply the `optimistic` delta to the local cell with an incremented intent version `v`; send `{ key, value, v, opId }`; on **confirm** clear pending (+ run `confirm`); on **reject** invoke `rollback`; on an **echo carrying a known op-id** dedupe; on an echo with **stale `v`** suppress (§7.1). The generated reducer is small, explicit, readable — *not* a merge engine.

```
# Desugar (proposed):  mutate NAME of KEY { optimistic … rollback … }
Para (.pui):
    sync cart :: Cart from `cart:${id}`;
    mutate addItem of cart {
      optimistic(item) { cart.items = [...cart.items, item]; }   // policy delta (typed against Cart)
      rollback(snapshot) { cart = snapshot; }                    // default; shown explicit
    }
    // ... addItem({ sku: "X", qty: 1 })
TS (generated boundary + hand delta):
    const __m_addItem = createIntent({
      key: `cart:${id}`, replica: __syn_cart, authority: __paraAuthority.Cart,
      optimistic: (item, cur) => ({ ...cur, items: [...cur.items, item] }),  // ← hand delta
      rollback:   (snapshot, cur) => snapshot,                                // ← hand delta
    });
    function addItem(item) {
      const opId = __nextOpId(); const v = __syn_cart.nextIntent();
      __m_addItem.applyOptimistic(item, v);                 // local flip
      transport.publish(`cart:${id}`, { value: __m_addItem.peek(), v, opId, schema_version: "3.1", sequence: -1 });
      // confirm → clear pending; reject → rollback; echo(opId) → dedupe; echo(stale v) → suppress (§7.1)
    }
```

**Interaction.** The op-id is a typed field both directions (the existing `correlationId?` hook) → drift is a compile error (I3). The mechanical machine is generated; the `optimistic`/`rollback` arms are the hand-written delta (the I1 boundary/logic split). Composes with §13.2 (the entity's authority class selects which machine) and §13.5 (a queued mutation replays its `optimistic` arm deterministically against the sequence stream).

**Example.**

```pui
<!-- like.pui — the Class-A canonical case: Like/Unlike spam, handled by default -->
<script lang="ts">
  prop postId: string;
  sync post :: Post from `post:${postId}`;
  mutate toggleLike of post {
    optimistic(_) { post.liked = !post.liked; post.likeCount += post.liked ? 1 : -1; }
    // rollback defaults to snapshot-restore; no policy needed — Class-A monotonic last-intent-wins
  }
</script>
<button onclick={() => toggleLike()}>{post.liked ? '♥' : '♡'} {post.likeCount}</button>
```

### 13.2 Per-field authority/conflict-policy *in the schema*  `Proposed`

**Rationale.** Today the authority class is chosen per *schema* in the manifest (`authority { Cart => class-b { items } }`, [→ ch:overview-and-surfaces §5.1]), but conflict policy is a *field* property: a `Cart`'s `items` may need concurrent merge while its `total` is server-computed and its `note` is last-write-wins. Choosing the class **at the field** (not the call site, not coarsely per-entity) makes the authority model a *property of the data*, totality-checkable, and projected onto both the reconciler and the write path. This discharges the manifest's falsification criterion §6.4 at field granularity.

**Grammar.** A schema field may carry an authority annotation:

```
FieldAuthority ::= "@" AuthorityClass
AuthorityClass ::= "server"                          ⟨server-authoritative; client never writes⟩
                 | "lww"                              ⟨last-write-wins (Class-A default)⟩
                 | "merge" "(" MergeFn ")"            ⟨Class-B concurrent merge; explicit fn⟩
MergeFn        ::= Ident                              ⟨a pure, hand-written merge: (mine, theirs, base) => T⟩
```

**Static semantics.** `@server` fields are stripped from any Tier-2 optimistic arm (writing one is a compile error — INV-sync-3 at field granularity). `@lww` fields use the baked Class-A machine (§7.1). `@merge(fn)` opts a field into **Class-B** and *requires* a named merge fn `(mine, theirs, base) => T` that must be `pure` [→ ch:purity-and-determinism] — ambient auto-merge is forbidden; the merge is *literally your typed function* (§7.2). A field with no annotation defaults to `@server` (fail-safe: the client cannot write it without opting in).

```
# Desugar (proposed):  per-field authority
Para:
    schema Doc {
      title: string @lww,
      body:  string @merge(mergeText),     // Class-B: explicit pure merge
      views: int    @server,               // server-computed; client never writes
    }
TS (generated reconciler config):
    export const __paraAuthority_Doc = {
      title: { class: "A" },
      body:  { class: "B", merge: mergeText },   // mergeText: (mine, theirs, base) => string (pure)
      views: { class: "server" },
    };
```

**Interaction.** Drives both halves: the **reconciler** (§3) uses `@server`/`@lww` to know which fields a steady-state echo may overwrite; the **write path** (§13.1) uses them to gate the optimistic arm. Consistency-checked against the manifest's `authority { S => class-b { … } }` (the manifest's coarse class must agree with the fields' fine classes). This is the field-level statement of "Class B stays explicit" (§7.2): a `@merge` field is the *only* way concurrent multi-writer merge becomes reachable, and it is visible in the schema.

### 13.3 The typed subscription/query surface (`sync feed :: Post[] from query(...)`)  `Shipped (array form)`

&gt; **Shipped 2026-07:** `para-preprocess` lowers `sync NAME :: SCHEMA[] from query(SPEC)` to `syncedQuery(SCHEMA, SPEC)` (`feeds.js`). The scalar degeneration is §13.7; the authority-side read-set liveness is step 3 of `para-sync-query-plan.md`.

**Rationale.** Today `sync` replicates a *single keyed object*. Real apps sync *collections* — a feed, a filtered list, a paginated query — and today the stream payload of such a collection is the §5 `StreamTypes`/`SocketBase` `any` hole. Making a query a **schema projection** (the result type is `Post[]`, the filter is typed, the per-row deltas reconcile by row key) closes that `any` and makes collections first-class synced entities.

**Grammar.**

```
SyncQueryDecl ::= "sync" Ident "::" Type "from" "query" "(" QuerySpec ")" ";"
Type          ::= Schema "[" "]"                     ⟨the row schema, arrayed⟩
QuerySpec     ::= "{" QueryField ("," QueryField)* "}"
QueryField    ::= "where" ":" Expr | "orderBy" ":" Expr | "limit" ":" Expr | "key" ":" Expr
```

**Static semantics.** `sync feed :: Post[] from query({ where, orderBy, limit })` types `feed` as `Infer<typeof Post>[]`. The `query` projection generates a typed subscription whose deltas are **row-keyed** envelopes: each row reconciles by `(schema_version, sequence)` *independently* (the reconcile machine is per-row), and the collection's membership (insert/remove/reorder) is a separate, typed channel. The `where`/`orderBy` are typed against `Post`'s fields (a `where` on a nonexistent field is a compile error — totality, I3).

**Dynamic semantics / desugar.** The collection lowers to a `syncedQuery(...)` handle whose value is a reactive array and whose per-row reconcile reuses `createClientReplica` per row key. Membership deltas and value deltas are distinct envelope kinds so a reorder does not re-parse every row.

```
# Desugar (proposed):  sync feed :: Post[] from query(...)
Para (.pui):
    sync feed :: Post[] from query({ where: p => p.authorId == userId, orderBy: p => p.createdAt, limit: 50 });
Runes (.pui):
    const __syn_feed = syncedQuery(Post, {
      where: (p) => p.authorId == userId, orderBy: (p) => p.createdAt, limit: 50,
      key: (p) => `post:${p.id}`,        // per-row reconcile key (→ createClientReplica per row)
    });
    let feed = $state(__syn_feed.peek?.() ?? []);
    $effect.pre(() => __syn_feed.subscribe?.((__v: Post[]) => { feed = __v; }));
    onDestroy(() => __syn_feed.dispose?.());
```

**Interaction.** Each row is a §3 replica (the reconcile spine scales to a collection by composition, not a new engine). The visibility projection (§6) applies per row (a feed of users projects each row by the viewer's class). Closes the §5 `StreamTypes` `any` hole (the L1 mandatory flow's untyped seam). Composes with §13.5 (an offline-queued mutation against a query row replays by the row's key).

### 13.4 Presence / ephemeral-state channels  `Shipped`

&gt; **Shipped 2026-07:** `para-preprocess` lowers `presence NAME :: SCHEMA in CHANNEL` to `presence(CHANNEL, SCHEMA)` (`presence.js`).

**Rationale.** "Who is online," "who is typing," cursor positions, live viewer counts — **ephemeral** state that is *not* authoritative, *not* persisted, *not* reconciled by sequence (there is no Postgres-authoritative truth; the truth is "whoever is connected right now"). Forcing it through the synced-entity machine is wrong: it has no `sequence`, no durable baseline, and last-writer-disconnects is the correct GC. A distinct channel keeps the authoritative path clean and the ephemeral path honest.

**Grammar.**

```
PresenceDecl ::= "presence" Ident "::" Schema "in" Channel ";"
Channel      ::= Expr                                ⟨the presence room key, e.g. `doc:${id}`⟩
```

**Static semantics.** `presence cursors :: Cursor in `doc:${id}`` types `cursors` as a reactive **map** of `peerId → Infer&lt;typeof Cursor&gt;` (live members only). The schema gates each peer's published state (a peer cannot publish a malformed cursor). There is **no** `sequence` and **no** reconcile machine — presence is last-write-wins-per-peer with **disconnect-GC** (a peer's entry vanishes when it disconnects). Presence is explicitly *not* an authoritative synced entity (a compile error to `mutate` a presence channel — there is no server authority to confirm against).

**Dynamic semantics / desugar.** Lowers to a `presence(...)` handle over an ephemeral transport (the same `SyncTransport` shape, but with **no** seed, no refetch, no sequence — joins/leaves are the only events). Each peer publishes its own state; the local map mirrors all live peers; the local peer auto-publishes on change and auto-removes on `dispose`/disconnect.

```
# Desugar (proposed):  presence cursors :: Cursor in CHANNEL
Para (.pui):
    presence cursors :: Cursor in `doc:${docId}`;
    // ... cursors.set({ x, y })   — publish MY ephemeral state
Runes (.pui):
    const __pre_cursors = presence(`doc:${docId}`, Cursor);   // ephemeral; no seed/sequence/refetch
    let cursors = $state(__pre_cursors.peek?.() ?? new Map());  // peerId → Cursor (live members only)
    $effect.pre(() => __pre_cursors.subscribe?.((__v) => { cursors = __v; }));
    onDestroy(() => __pre_cursors.dispose?.());   // leave the room; my entry GC's for everyone
```

**Interaction.** Shares the transport contract (§4) and the parse gate (§3.3) — a peer's published state crosses the same trust boundary — but **not** the reconcile machine (no sequence). This is the clean separation the authority model needs: authoritative state reconciles by sequence and persists; ephemeral state is room-scoped, last-writer-per-peer, disconnect-GC'd. Keeping them distinct is what stops "is X typing" from polluting the durable `sequence` stream.

### 13.5 Offline / queued mutations with deterministic replay  `Proposed (runtime primitive shipped)`

&gt; The runtime machine exists (`queue.js`: `createQueuedIntent`); the `mutate queued` surface sugar does not yet.

**Rationale.** A client that goes offline (or races a slow network) accumulates optimistic mutations (§13.1) that have not been confirmed. On reconnect they must **replay deterministically** against the *current* server sequence — not blindly re-send (the server state moved) and not silently drop (the user's intent is lost). A queued-mutation model with replay-against-the-sequence-stream makes offline a first-class, deterministic case rather than an `any`-shaped reconnection hack.

**Grammar.** A `mutate` may be marked `queued`:

```
QueuedMutate ::= "mutate" "queued" Ident "of" Key "{" MutateBody "}"
```

**Static semantics.** A `queued` mutation's intents are **durable** (persisted to local storage with their op-id and intent version `v`). On reconnect, each queued intent is **re-based** against the current replica sequence: its `optimistic` arm is re-applied to the *current* server baseline (not the stale one it was created against), in op-id order, and re-sent. An intent whose re-based optimistic arm would violate the entity's authority class (e.g. a `@server` field moved) is surfaced as a typed **conflict** (the policy delta's job to resolve), never silently merged.

**Dynamic semantics / desugar.** The queue is a deterministic log keyed by op-id; replay is: (1) take the current confirmed baseline (the reconciler's last `commit`), (2) fold each pending `optimistic` arm in op-id order, (3) re-send each with a fresh `v` against the new baseline, (4) reconcile confirms/rejects as in §13.1. Determinism comes from the op-id ordering + the pure optimistic arms.

```
# Desugar (proposed):  mutate queued NAME of KEY
Para (.pui):
    mutate queued addItem of cart { optimistic(item) { cart.items = [...cart.items, item]; } }
TS (generated):
    const __mq_addItem = createQueuedIntent({
      key: `cart:${id}`, replica: __syn_cart, store: localMutationLog,   // durable
      optimistic: (item, cur) => ({ ...cur, items: [...cur.items, item] }),
    });
    // on reconnect: replayAgainstSequence(__syn_cart.peekMeta().sequence) →
    //   fold pending optimistic arms in op-id order onto the fresh baseline → re-send.
```

**Interaction.** Builds directly on §13.1 (a queued mutation *is* an optimistic mutation with a durable log) and §13.2 (re-base respects per-field authority). Replays against the §3 sequence stream (the reconciler's `sequence` *is* the replay anchor) and against §13.3 row keys for collection mutations. The deterministic, op-id-ordered, pure-arm replay is what keeps offline from being a silent-divergence footgun (the exact class the project exists to eliminate).

### 13.6 Cross-entity transactional sync (atomic multi-key intents)  `Proposed (runtime primitive shipped)`

&gt; The runtime machine exists (`transaction.js`: `createTransaction`); the `transaction` surface sugar does not yet.

**Rationale.** Some mutations span **multiple synced entities** atomically — move an item from `cart:A` to `cart:B`, transfer balance between two accounts, reassign a task across two boards. Applying them as independent §13.1 intents allows a torn state (one confirms, one rejects → the item exists in neither cart or both). An **atomic multi-key intent** makes the optimistic apply, the server confirm/reject, and the rollback span all keys as a unit — a transaction across the trust boundary.

**Grammar.**

```
TxMutate ::= "transaction" Ident "{" TxIntent+ "}"
TxIntent ::= "mutate" Ident "of" Key "{" MutateBody "}"   ⟨each touches one key; the set is atomic⟩
```

**Static semantics.** A `transaction { … }` groups N `mutate` arms over distinct keys. The optimistic arms apply **all-or-nothing** locally (a synthetic group op-id correlates all N); the server confirms/rejects the **group**; a group reject rolls back **all** N optimistic arms. Each arm is type-checked against its entity's schema and authority class (§13.2). A transaction spanning a `class-b` `@merge` field requires the merge to be defined for each such field (the group does not bypass per-field policy).

**Dynamic semantics / desugar.** Lowers to a `createTransaction(...)` over the group op-id: apply all optimistic arms behind one intent version; send a single grouped envelope (or N envelopes sharing the group op-id, depending on the transport); on group **confirm** clear all pending; on group **reject** roll back all; partial server echoes are buffered until the group resolves (no torn apply).

```
# Desugar (proposed):  transaction { mutate … of A; mutate … of B }
Para (.pui):
    transaction moveItem {
      mutate removeFrom of cartA { optimistic(_) { cartA.items = cartA.items.filter(i => i.id != item.id); } }
      mutate addTo     of cartB { optimistic(_) { cartB.items = [...cartB.items, item]; } }
    }
TS (generated):
    const __tx_moveItem = createTransaction({
      groupOpId: __nextOpId(),
      intents: [
        { key: keyA, replica: __syn_cartA, optimistic: (_, cur) => ({ ...cur, items: cur.items.filter(i => i.id != item.id) }) },
        { key: keyB, replica: __syn_cartB, optimistic: (_, cur) => ({ ...cur, items: [...cur.items, item] }) },
      ],
      // apply-all → send grouped → confirm-all clears / reject-all rolls back; partial echoes buffered.
    });
```

**Interaction.** The atomic boundary is the natural extension of §13.1's single-key op-id to a group op-id; it composes with §13.2 (each arm respects its field authority), §13.5 (a queued transaction replays as a unit), and the reconciler's sequence ordering (each key still reconciles by its own `sequence`; the *transaction* is the optimistic/confirm/rollback unit, not a new reconcile key). This keeps multi-key atomicity *explicit and visible* — never an ambient distributed-transaction magic, consistent with the §7.2 anti-Meteor boundary.

### 13.7 Scalar query sync (`sync NAME :: SCHEMA from query(...)`)  `Shipped (client spine)`

&gt; **Shipped 2026-07-26** (step 2 of `para-sync-query-plan.md`): `syncedOne` (`feeds.js` — the limit-1 composition over `syncedQuery`, 10 tests) and the `para-preprocess` tracked bridge (`lowerSyncOneDecls`, ordered between the feed pass and the single-object pass, 7 tests). The **ready gate** realizes the stale-seed rule: a fresh subscription's `peek()` returns `undefined` and its `subscribe` stays silent until the first membership fact, so a re-keyed binding keeps its stale cell value with no undefined flash — and after ready, `undefined` is a real "no row matches" fact. The authority-side liveness host also shipped (plan step 3, same day): `createQueryAuthority` (`query-authority.js`) — read-set registration, `wrote()`/`invalidate()` intersection re-evaluation, per-row `+1` sequences with deep-equal short-circuit, the outbound parse gate, and membership diffing; its `subscribe(spec)` returns exactly the `MembershipStream` the client binding consumes, proven live end-to-end (authority → transport → replica → cell) in tests. The host is **evaluator-agnostic**: `evaluate` (spec → rows) and `readSetOf` (spec → read-set) are deployment-supplied — the lockstep-pg adapter that compiles the typed spec to SQL and derives precise read-sets is the remaining integration piece, and read-set precision is an *optimization contract*: correctness never depends on it (the default read-set is "everything", which over-invalidates but never misses).

**Rationale.** §13.3 syncs collections; the equally common case is *one* entity selected by a typed predicate — "the user with this id", "the active session". Writing it as a one-element feed forces `[0]` indexing and array-shaped status onto a scalar value. The scalar form is the `limit: 1` degeneration of §13.3, sharing its entire machinery — and, crucially, it inherits the **liveness-by-read-set** property: because `query(SPEC)` is a typed spec over the schema spine (compilable by lockstep-pg), the authority knows exactly which rows the result depends on, so writes flowing through the authority (§13.1 intents, P4 handles) invalidate and re-publish *automatically*. No polling, no manual invalidation — the spine is what makes the query live.

**Grammar.**

```
ScalarQueryDecl ::= "sync" Ident "::" Schema "from" "query" "(" QuerySpec ")" ";"
                     ⟨Schema NOT arrayed — the absence of [] selects the scalar form⟩
```

**Static semantics.** The cell types as `Infer<S> | undefined`. `undefined` is a **membership fact** (no row matches — delivered on the membership channel), distinct from not-yet-loaded (`status: 'stale'` pre-baseline). A row deletion transitions the cell to `undefined`; it never silently retains a deleted row. `where` fields type against the spine (a predicate on a nonexistent field is a compile error — I3).

**Reactive re-subscription (normative, new — applies to §13.3 and §13.8 too).** The `QuerySpec` is evaluated in a **tracked scope**. Client-reactive values referenced in it are the subscription's *params*; `subKey = stableSerialize(declId, params)`. On tracked change: unchanged `subKey` ⇒ no-op; changed ⇒ bind a fresh handle, keep the old value in the cell as a stale seed (`status: 'refetching'`), dispose the old handle immediately, swap on the new baseline. The shipped `from KEY` form keeps its evaluate-once semantics (back-compat; extension is a v2 audit item).

**Dynamic semantics / desugar.**

```
# Desugar (shipped):  sync user :: User from query(...)
Para (.pui):
    sync user :: User from query({ where: u => u.id == id });
Runes (.pui):
    let user = $state(undefined as any);
    $effect.pre(() => {                                  // reads of `id` tracked → re-key on change
      const __sq_user = syncedOne(User, { where: u => u.id == id });
      const __ss_user = __sq_user.peek?.();              // ready-gated: undefined until membership
      if (__ss_user !== undefined) user = __ss_user;
      const __un_user = __sq_user.subscribe?.((__v: typeof user) => { user = __v; });
      return () => { __un_user?.(); __sq_user.dispose?.(); };
    });
```

The cell is deliberately **not reset** on re-key: it keeps the stale value while the fresh handle's ready gate keeps it silent until the new baseline — stale-while-revalidate falls out of the composition rather than needing explicit status plumbing in the binding.

**Interaction.** `syncedOne` is a degenerate one-row `syncedQuery` (§13.3) — same per-row `createClientReplica`, same two envelope kinds; no new reconcile engine. Params crossing into `SPEC` are parse-gated server-side (the reverse direction of §3.3's gate — *both* directions of the boundary are gated). Composes with §13.1 (a mutate against the selected entity confirms through the same replica). Implementation: `para-sync-query-plan.md` §2–§3.

### 13.8 Opaque server-source sync (`sync NAME :: SCHEMA from server EXPR + policy`)  `Shipped (extraction + host)`

&gt; **Shipped 2026-07-26** (plan step 4): `createServerSource` + `invalidate` + `subKey` in para-sync (`server-source.js`, 7 tests — policy exclusivity enforced at the host too, per-key `+1` sequences, deep-equal short-circuit, mid-run trigger coalescing, both-ends gating, E2E against stock Tier-1 `synced(key, S)`), and `extractServerSources` in para-preprocess (9 tests): the §4.2-style escape analysis with compile-error diagnostics (missing policy naming all three options, both-sides import, `this`), positional wire params re-keying via `subKey(declId, [params])`, the tracked client binding, and the readable ejectable server module (`__paraServerSources` — one `{ name, declId, schema, params, policy, run }` entry per declaration). The client emission and the server module share one `declId`, so client subKey ≡ host subKey by construction. P9 shipped the same day (plan step 5, `@lyku/para-kit`): the `para-kit emit` artifact/manifest emitter with `--check` drift gate, `createServerSourceHost` (one `createServerSource` per **live** subscription key — N clients on one key share one timer and one sequence stream), and the SSE bridge (`createSyncEndpoint` on web standards + the client `SseTransport`), proven end-to-end from an emitted artifact through a real `Response` stream into a `synced()` cell [→ ch:modules-projections-and-build §2 P9]. Param validators beyond the schema exemption remain the plan's open question.

**Rationale.** Not every value comes from the spine — hand-written SQL, an ORM call, a third-party API. The honest contract for an *opaque* server expression is fundamentally different from §13.7: the server **cannot know** when the result changes (no read-set), so liveness cannot be automatic. This form gives opaque sources the same replica machinery — SSR-seedable, parse-gated, reconciled — while making the refresh contract **syntactically mandatory**. A missing policy is a compile error naming the three options. This is the §2.2 visible-opt-out principle and the §7.2 anti-Meteor boundary applied to liveness: never fake it.

**Grammar.**

```
ServerSyncDecl ::= "sync" Ident "::" Schema "from" "server" Expr Policy ";"
Policy         ::= "every" DurationExpr        ⟨poll: shared timer per subscription key⟩
                 | "on" Expr                    ⟨re-run when invalidate(KEY) publishes on the transport⟩
                 | "once"                       ⟨seed only — a VISIBLE never-refreshes choice⟩
```

`server` is a **contextual keyword valid only after `from`** — the visible runtime-boundary marker. It is deliberately a keyword and never inferred from where an import resolves: implicit splitting is how server code leaks into client bundles. The runtime boundary is written in source exactly the way `::` writes the trust boundary.

**Static semantics (escape analysis, normative).** The free identifiers of `EXPR` partition: (1) module imports → hoisted into a generated server artifact; an import used by both server expressions and client code in one file is a compile error (no silent double-bundling). (2) Client-reactive bindings → **typed wire params**: JSON-profile serializable, validator derivable (spine column, schema-branded type, or primitive) — a param with no derivable validator is a compile error (I3). Param changes re-key the subscription (§13.7's rule). (3) Locals inside `EXPR` travel with the artifact. (4) Forbidden captures — closures as params, DOM/component refs, `this`, mutable module state — each with a targeted diagnostic.

**Both-ends gating.** The artifact's return value is parse-gated against `SCHEMA` **server-side before publish** (a server bug surfaces once at the boundary, not as reconcile chaos on N clients); envelopes parse-gate client-side exactly as §3.3; params parse-gate server-side on arrival. Neither end trusts the wire, in either direction.

**Dynamic semantics / desugar.**

```
# Desugar (proposed):  sync stats :: Stats from server db.slowAggregate(orgId) every 30s
Para (.pui):
    sync stats :: Stats from server db.slowAggregate(orgId) every 30s;
Client (runes, .pui):
    // identical bridge to §13.7 — the client cannot tell L-query from L-server
    let stats = $state(undefined);
    $effect.pre(() => { const h = synced(__subKey("stats@file.pui", [orgId]), Stats); … });
Server (generated <file>.server.pts — readable, ejectable):
    export async function stats({ orgId }: { orgId: bigint }, ctx: SecureContext<…>) {
      // param gate (inbound) → the opaque expression → schema gate (outbound)
      return Stats.parse(await db.slowAggregate(orgId));
    }
    // host wiring: one shared 30s timer per subKey; deep-equal short-circuit;
    // monotonic `sequence` per subKey on change → the §3 reconciler applies unchanged.
```

**Interaction.** The host publishes `SyncEnvelope`s, so §3's ingest machine, §4's transports, and §5's `SyncedHandle` apply verbatim — L-server differs from L-query *only* in who decides when to re-run. `on KEY` pairs with a one-line server helper `invalidate(KEY)` — the author-declared read-set. The fullstack projection (SvelteKit `+page.server.ts` seed loads via the shipped `seed` opt, an SSE endpoint speaking envelopes, POST endpoints for §13.1 intents) is specified as P9 in `para-sync-query-plan.md` §6 and lands in [→ ch:modules-projections-and-build] once proven. The pull-flavored client-only mirror (`derived NAME :: SCHEMA = EXPR`) is [→ ch:sources-async-and-native §10.7].

---

### Summary of proposed surface

| § | Construct | One-line |
|---|---|---|
| 13.1 | `mutate NAME of KEY { optimistic … rollback … }` | Tier-2 optimistic write: op-id correlation + confirm/reject/rollback, Class-A by default. |
| 13.2 | Per-field `@server` / `@lww` / `@merge(fn)` | Authority/conflict class chosen *at the field*, projected onto reconciler + write path. |
| 13.3 | `sync feed :: Post[] from query({ where, orderBy, limit })` | Typed collection sync; per-row reconcile; closes the `StreamTypes` `any` hole. |
| 13.4 | `presence NAME :: Schema in CHANNEL` | Ephemeral presence/typing/cursors — no sequence, disconnect-GC, distinct from authoritative entities. |
| 13.5 | `mutate queued NAME of KEY { … }` | Offline mutations with deterministic op-id-ordered replay against the sequence stream. |
| 13.6 | `transaction NAME { mutate … of A; mutate … of B }` | Atomic multi-key intents: all-or-nothing optimistic apply + group confirm/reject/rollback. |
| 13.7 | `sync user :: User from query({ where })` | Scalar query sync: `limit 1` degeneration of 13.3; live via spine read-sets; reactive re-subscription. |
| 13.8 | `sync stats :: Stats from server EXPR every/on/once` | Opaque server source: escape-analyzed server artifact, both-ends gating, *declared* refresh — never faked liveness. |

