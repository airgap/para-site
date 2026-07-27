---
title: "@lyku/para-sync"
description: Server-authoritative sync — parse-gated client replicas reconciled by (schema_version, sequence), with keyed, query, and server-source channels, presence, and optimistic writes.
---

```ts
import { synced, syncedQuery, syncedOne, presence, createIntent } from "@lyku/para-sync";
```

Server-authoritative state replication: the server owns every value, clients
hold live read-only replicas, and **everything that crosses the wire is
parse-gated by a schema** before it can touch your UI. Each replica
reconciles envelopes by `(schema_version, sequence)` — stale and duplicate
deliveries are ignored, gaps trigger recovery refetch, breaking schema skews
are detected instead of applied. The reconciler is ~90 lines of
branch-on-`.tag` you can open and override per entity, not a merge engine.

In `.pui` components you rarely call this API directly — the `sync` /
`synced` / `presence` / `mutate` keywords lower to it (auto-imported,
auto-disposed on unmount). The [language page](/docs/language/#the-sync-family-pui)
lists the sugar; this page is the library underneath.

## The declaration forms (.pui)

```parabun
sync user  :: User from `user:${id}`;             // keyed — the authority pushes
sync user  :: User from query({ where: u => u.id == id });   // scalar typed query
sync feed  :: Post[] from query({ limit: 50 });   // collection (per-row reconcile)
sync stats :: Stats from server db.agg(orgId) every 30000;   // opaque server code
sync flags :  Flags from "flags:global";          // single `:` = trusted, NO parse gate
synced cart = `cart:${id}`, { seed, stream };     // full control over synced() opts

presence cursors :: Cursor in `doc:${docId}`;     // ephemeral peers, no reconcile

mutate rename of user {                           // Tier-2 optimistic write
  optimistic(name) { user.name = name; }
  rollback(name)   { /* rare: custom undo */ }
}
```

Every form binds a read-only reactive cell: the world writes it, the
component reads it. The `query(...)` and `server ...` forms bind inside a
**tracked scope** — change a value the spec reads (`id` above) and the
subscription re-keys, keeping the stale value on screen until the new
baseline arrives (never an `undefined` flash). Writing to the server is
never a side effect of assignment; it is the explicit `mutate` path.

## `synced(key, schema?, opts?)` — the keyed replica

```ts
const user = synced(`user:${id}`, User);          // parse-gated (the default)
user.value;                // reactive read        user.peek();   // untracked
user.status;               // "ok" | "stale" | "skew" | "refetching"
user.subscribe(v => …);    // change stream        user.dispose();
```

Omitting the schema is the **visible trusted opt-out** (the `sync x : T`
form) — a passthrough gate, deliberate, never the default. Options:
`transport`, `seed` (SSR hydration envelope), `refetch` (recovery snapshot),
`schemaVersion`, `cell`. App-wide delivery is configured once via
`configureSynced({ transport, … })`.

## Queries — `syncedQuery` and `syncedOne`

```ts
const feed = syncedQuery(Post, { where, orderBy, limit });   // reactive Post[]
const me   = syncedOne(User, { where: u => u.id == id });    // User | undefined
```

A collection is composed, not a new engine: one `createClientReplica` per
row (each row reconciles independently), plus a separate **membership**
channel for insert/remove/reorder — a reorder never re-parses rows.
`syncedOne` is the `limit: 1` degeneration with a **ready gate**: before the
first membership fact `peek()` is `undefined` and `subscribe` stays silent
(so a re-keyed binding keeps its stale value); after it, `undefined` is a
real "no row matches" — a deleted row is never silently retained.

Queries are **live because the server knows their read-sets**. The authority
side:

```ts
import { createQueryAuthority } from "@lyku/para-sync";

const auth = createQueryAuthority({
  transport,
  schema: User,
  keyOf: (u) => `user:${u.id}`,
  evaluate: (spec) => runSql(compile(spec)),      // your evaluator
  readSetOf: (spec) => ({ table: "users" }),      // precision optional
});
// wire a client:  syncedOne(User, { transport, membership: auth.subscribe(spec) })
auth.wrote({ table: "users", rowKey: "user:1" }); // the write-path hook
```

`wrote()` re-evaluates exactly the intersecting subscriptions, bumps per-row
sequences by one per **real** change (deep-equal short-circuit), and
publishes on their channels. Every evaluated row crosses the schema gate
*server-side* before publish — a server bug surfaces once at the boundary,
not as reconcile chaos on N clients. `readSetOf` precision is an
optimization contract: the default read-set is "everything", which
over-invalidates but never misses.

## Server sources — `createServerSource`

The `from server EXPR` form: opaque hand-written server code (an ORM call,
raw SQL, a third-party API) has no knowable read-set, so its refresh
contract is **declared, never faked** — `every MS`, `on KEY`, or `once`,
and omitting it is a compile error. The build extracts the expression into a
readable server artifact ([@lyku/para-kit](/docs/kit/) hosts it):

```ts
import { createServerSource, invalidate, subKey } from "@lyku/para-sync";

const src = createServerSource({
  key: subKey("routes/stats/+page.pui#stats", [orgId]),
  run: () => db.slowAggregate(orgId),
  schema: Stats,
  transport,
  on: "stats:bump",              // exactly one of: every | on | once
});
await src.start();               // seed + arm the policy
invalidate(transport, "stats:bump");   // the author-declared read-set
```

The client side is plain `synced(key, Stats)` — zero new client machinery.
Runs are serialized (mid-run triggers coalesce into one trailing re-run),
identical results publish nothing, and failures reach `onError` while
clients keep their last good value.

## Writes — `mutate`, queue, transactions

`mutate NAME of ENTITY { optimistic … }` lowers to `createIntent`
(`writer.js`): apply optimistically under an op-id, send, then
confirm/reject — a reject rolls back to the last server-confirmed snapshot
and always defers to inbound sequence. Runtime primitives for offline queues
(`createQueuedIntent`) and atomic multi-key transactions
(`createTransaction`) ship today; their surface sugar is still proposed
([spec §13.5–§13.6](/spec/08-data-sync-and-authority/)).

## Transports

A transport is a **dumb pipe**: `publish(key, envelope)` fans out to current
subscribers, `subscribe(key, handler)` hears future publishes — no
buffering, no validation, no dedupe (the replica owns all of that).
`InProcessTransport` covers monolith/edge/tests; `NatsTransport` covers
multi-service; [@lyku/para-kit](/docs/kit/) adds the browser-side
`SseTransport`. Presence (`presence.js`) rides the same pipes with
last-writer-wins per peer and disconnect GC — no sequences, deliberately not
an authoritative entity.

## Spec

The normative semantics live in the spec:
[ch. 08 — Data Sync, Replication & Authority](/spec/08-data-sync-and-authority/)
(the envelope, the reconcile machine, visibility projection, the full §13
surface) and [ch. 11 §2 P9](/spec/11-modules-projections-and-build/) (the
fullstack projection).
