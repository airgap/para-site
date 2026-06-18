---
title: "Modules, Projections, Codegen & Build Model"
description: "How Para programs are composed and how the spine becomes running code: module/import semantics across surfaces, the projection generators (DB…"
sidebar:
  order: 12
---

# Chapter: Modules, Projections, Codegen & Build Model

&gt; **Status of this chapter:** Mixed. The **projection model** (db/api/client/handles/validation/sync/wire/auth as readable, ejectable schema projections), the **I1 boundary/logic split** (generated boundary in `lockstep-{pg,handles-ts,client-ts}` + a separate hand-written logic tree regeneration never touches), the **`Handles<M,Ctx>` / `SecureContext<Model>`** handler-type model, the **msgpack-native wire codec** as a schema projection, the **lockstep-pg drift/introspection** totality check, the **`.pts`/`.pui` build pipeline** (markup → script → reactivity → `Bun.Transpiler`/esbuild → Svelte compiler), and the **parser-as-truth + versioned JS-mirror parity** contract (B1–B3) are **Shipped** (in lockstep, `para-preprocess`, `@lyku/para-transpile`, and ParaBun today; cited as evidence of feasibility). Everything in *Proposed Extensions* (§12) — the formal `eject` operation, projection-override hooks, the typed auth/middleware composition surface, diff-as-compile-error, incremental/partial projection, and the schema-bearing-library distribution model — is **Proposed** (net-new surface, not in `language-surface.ts` or the generators today).
&gt;
&gt; **Cross-refs:** This chapter owns the **outward projection** of the schema spine and **program assembly** — how the model becomes db/api/client/codec/reconciler/handles code, and how `.pts`/`.pui` sources become running artifacts. The **schema itself** (the spine these projections read) is [→ ch:type-and-schema-system]; this chapter projects it, never redefines it. The **sync runtime and reconcile semantics** (read path, `(schema_version, sequence)` machine, transports, authority classes) are [→ ch:data-sync-and-authority]; this chapter owns the *codegen* of the reconciler boundary and the write-path call, not the runtime. The **surface dispatch and the spec↔implementation framing** are introduced in [→ ch:overview-and-surfaces §3, §4] and *deepened* here (this chapter is where the build pipeline and parity contract are specified in full). The `.pui` **reactivity-lowering pass** (step 3 of the pipeline) belongs to [→ ch:pui-component-model]; this chapter asserts the dispatch and ordering and the parity gate, not the per-keyword rules. The **LSP projection and the conformance notion** are [→ ch:tooling-diagnostics-and-conformance]; this chapter owns the *build* path, that chapter owns the *editor* path and how an implementation proves conformance. The **`.para` manifest** (`spine`/`authority`/`transport`/`project`/`surface`/`view`) that names the spine, the authority model, and the projection targets is [→ ch:overview-and-surfaces §5]; this chapter consumes it (`project { … }` is the declared input to §3–§4's generators). The keyword catalog this chapter and its tools conform to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. One spine, many projections — the chapter in one sentence

"The schema is the application" is a claim about **direction of derivation**: a Para program is a set of `schema` declarations (the spine) plus a set of deliberately-written deltas (handler bodies, components, library modules), and *everything else* — the database model and its migrations, the API routes and their request/response contracts, the typed client, the server-handle types, boundary validation, the wire codec, and the client⇄server sync reconciler — is **generated as a readable, ejectable projection of that spine** [→ schema-is-the-application §2, §4]. This chapter specifies that generation: the projection table (§2), the boundary/logic split that makes regeneration safe (§1), the wire codec as a schema projection (§5), the handler-type model the generated boundary hands to hand-written logic (§6), the live-DB drift check that makes "all data accounted for" mechanical (§7), the build pipeline that turns `.pts`/`.pui` into running code (§3–§4), and the parity contract that pins the JS mirrors to the canonical parser (§8). §9 states the invariants; §12 proposes the net-new surface that closes the remaining ejectability, auth, drift, incrementality, and distribution gaps.

Three invariants frame the whole chapter — the three global invariants, read *from the projection side*:

- **INV-mpb-1 (every projection is glass-floor — I1).** Each projection in §2 lowers to **plain, readable, ejectable** code: a formatted `.ts`/`.d.ts`/`.sql` artifact a developer could have written by hand, never reflection-driven or `any`-degraded. The lockstep generators already emit formatted code (`formatCode`/prettier/SQL) — readable *by construction* [→ schema-is-the-application §9]. If a generated artifact cannot be opened, read, and overridden per-site, it does not ship. This is the load-bearing constraint of the whole projection model.
- **INV-mpb-2 (the boundary is generated; the logic is hand-written, separate, untouched — the I1 split).** The generators produce *only* the typed **boundary** (factories, types, transport shapes, the reconciler skeleton). Application **logic** lives in a **separate hand-written tree** (`libs/routes/src/**/handlers/*.ts`) that regeneration **never** touches [→ schema-is-the-application §9]. "The schema is the application" means every byte db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state is either *in the spine* or *in a visible delta* — there is no third, untyped place (I3).
- **INV-mpb-3 (the spine is diffable against the live DB — I3, A5).** "All data accounted for" is not aspirational: `lockstep-pg`'s drift/introspection diffs the projected DB model against the real database, so a field in a projection but not in the DB (or vice-versa) is **detectable** — and §12.4 promotes that diff to a compile error. This is the mechanical totality anchor of the entire thesis [→ schema-is-the-application §3 I3].

---

## 1. The boundary/logic split — why regeneration is safe

The single most load-bearing structural fact in this chapter, established by the I1 audit of lockstep [→ schema-is-the-application §9], is the **generated-boundary / hand-written-logic split**:

```
        ┌─────────────────────────── the spine ───────────────────────────┐
        │   schema declarations  (.pts, [→ ch:type-and-schema-system])     │
        └───────────────────────────────┬──────────────────────────────────┘
                                         │  projection generators (§2, §3)
        ┌────────────────────────────────┴─────────────────────────────────┐
        │ GENERATED BOUNDARY (clean-regenerated, all-or-nothing per target) │
        │  db model · migrations · route contracts · typed client ·         │
        │  Handles<M> types · wire codec · reconciler skeleton              │
        └────────────────────────────────┬─────────────────────────────────┘
                                         │  imported by
        ┌────────────────────────────────┴─────────────────────────────────┐
        │ HAND-WRITTEN LOGIC TREE  (regeneration NEVER touches this)        │
        │  handler bodies · .pui components · reconcile-policy deltas ·     │
        │  the FYP-fallback ternary · the typed reducer · library modules  │
        └────────────────────────────────────────────────────────────────────┘
```

The two trees are **physically separate directories**, not interleaved regions of one file. The generated boundary is written to a `gen/`-style output tree (named per-target by the `.para` manifest's `project { … }` block, [→ ch:overview-and-surfaces §5.4]); the logic tree is hand-authored app code that *imports* the boundary. This is what makes "the schema is the application" a totality claim rather than a slogan:

- **The boundary is regenerated atomically.** A schema change re-emits the *entire* boundary target (the whole `client.ts`, the whole `codec.ts`) — there is **no per-file eject inside the boundary**, because anything durable hand-edited *inside* a clean-regenerated file would be silently clobbered on the next regen. The Shipped rule is blunt: **nothing durable may live in the generated boundary** [→ schema-is-the-application §9]. (§12.1 introduces a *declared* `eject` that lifts an artifact *out* of the boundary into the logic tree precisely so it can be durably hand-owned — the only sanctioned way to override a projection.)
- **The logic tree is never regenerated.** Handler bodies, `.pui` components, and reconcile-policy deltas are hand-written and stable across every regen. The boundary changes shape under them (a renamed field becomes a type error at the import); the logic itself is preserved.

&gt; **INV-mpb-4 (durability lives only in the logic tree).** A piece of code is durable (survives regeneration) **iff** it lives in the hand-written logic tree. The generated boundary is ephemeral and clean-regenerated; the logic tree is durable and never regenerated. The *only* mechanism for making a piece of the boundary durable is to **eject** it — moving it from the boundary tree to the logic tree (§12.1), after which the generator must not re-emit it. This is the formal statement of "outgrowing an opinion = override one projection, never rewrite the app" (I1).

**What goes where — the line is "transport vs intent".** The audit line, applied uniformly across L1/L2/§5 [→ lighthouse-l1, lighthouse-l2, s5-reconciliation-spike]:

| Concern | Side | Example |
|---|---|---|
| Type-gated method surface, codec, `Bearer` threading, conditional-type auth discrimination | **boundary** | the projected client (`api.listForYouPosts`) |
| Acquiring the session (reading the cookie/auth store) | **logic** | `cookies.get('sessionId')` then `.authed(session)` |
| `Handles<M>` request/response type, validation parse-gate injection | **boundary** | the handler factory signature |
| The handler *body* (business rules, the size/enum checks A2 demands be schema-projected) | **logic** | `trackAnalytic.ts`'s logic |
| The reconciler state machine, op-id correlation, the Class-A default policy | **boundary** | the generated reducer-of-reducers [→ ch:data-sync-and-authority] |
| The optimistic value, the rollback, the Class-B merge function | **logic** | the typed policy delta |
| The "FYP empty → fall back to hot posts" rule | **logic** | one hand-written ternary composing typed calls |

The rule is mechanical: **if generating it would hide behavior the developer must be able to inspect and override, it is logic; if it is pure typed transport, it is boundary.** Generating the *policy* (the reconcile merge, the optimistic value) is the Meteor trap the thesis exists to avoid [→ s5-reconciliation-spike]; generating the *plumbing* (the typed call, the dedupe, the codec) is the win.

---

## 2. The projection table — the spine's eight outputs

Every artifact below derives from the *same* `schema` spine. None is hand-declared in parallel; a field that exists in a projection but not in a schema is the I3 gap this whole chapter forbids (INV-mpb-3). Each projection's glass-floor output (I1) is a readable, ejectable artifact.

| # | Projection | Source of truth | Generator (Shipped evidence) | Glass-floor output (I1) | Status |
|---|---|---|---|---|---|
| P1 | **DB model / migrations** | `schema` | `lockstep-pg` | readable table mapping + reversible SQL migration | Shipped |
| P2 | **API routes / contracts** | `schema` (handler models) | `lockstep-core/generators/generateApiTypes` | readable route contract types | Shipped |
| P3 | **Typed client** | `schema` (handler models + `authenticated`) | `lockstep-core/generators/generateClient` → `@lyku/monolith-ts-api` | prettier-emitted client module, no runtime reflection | Shipped |
| P4 | **Server handles** | `schema` + handler deltas | `lockstep-handles-ts` `generateHandles` | `formatCode`-formatted `.js`/`.d.ts` factories | Shipped |
| P5 | **Boundary validation** | `schema` (`::`, `is`) | the `::` parse-injection ([→ ch:type-and-schema-system §8]) | inline `Type.parse(...)` | Shipped |
| P6 | **Wire codec** | `schema` | the msgpack codec projection (§5) | msgpack-native pack/unpack, identical types both sides | Shipped |
| P7 | **Sync reconciler** | `schema` + authority model | `@lyku/para-sync` `createClientReplica` ([→ ch:data-sync-and-authority]) | ~90-line branch-on-`.tag` reducer, ejectable per entity | Shipped |
| P8 | **Auth / middleware context** | `schema` + context model (§6) | `SecureContext<Model>` + the P-A4 client projection | typed `Ctx` threaded end-to-end, **zero `any`** | Shipped (server) / Shipped-pending P-A4 (client) |

The table is the *concrete content* of "the schema is the application": eight projections, one spine. The remainder of this chapter specifies the generation mechanics (P1–P4 here; P5 cross-ref; P6 in §5; P7 cross-ref; P8 in §6), and §12 closes the ejectability/auth/drift/incrementality/distribution gaps the table leaves open.

### 2.1 P1 — DB model & migrations

`lockstep-pg` projects each `schema` to a Postgres table mapping and emits a **reversible SQL migration** as readable `.sql`. The projection is the same model `lockstep-pg`'s drift/introspection (§7) diffs against the live DB — so the migration and the totality check read the *same* spine, which is exactly the A5 "one chain, diffable against the real DB" closure.

```pts
// .pts — the spine
schema Order { id: bigint, total: int(0..), placedAt: DateTime }
```

```sql
-- gen/migrations/0007_create_order.sql  (readable, ejectable, reversible — P1 glass floor)
-- up
CREATE TABLE "order" (
  "id"        BIGINT       PRIMARY KEY,
  "total"     INTEGER      NOT NULL CHECK ("total" >= 0),
  "placed_at" TIMESTAMPTZ  NOT NULL
);
-- down
DROP TABLE "order";
```

&gt; **Edge case (DB column ≠ schema field name).** The projection lowercases + snake_cases field names by default (`placedAt` → `placed_at`). The *mapping* is part of the generated boundary (readable in the migration); a field whose DB column the projection cannot derive (a reserved word, a collision) is a generation error surfaced at build, not a silent rename (I3). §12.4 makes a *live-DB* mismatch on this mapping a compile error too.

### 2.2 P2/P3 — API contracts & the typed client

A handler model is the F4 anonymous-schema record `{ request: schema {…}, response: schema {…} }` [→ ch:type-and-schema-system §1, §7.4]. `generateApiTypes` projects each model to a route **contract type** (P2); `generateClient` projects a **typed client method** per endpoint (P3), keyed on the handler name — so the client method name *is* the handler identity, and a rename is a compile error, not a silent 404 (the exact L2 drift surface eliminated by construction, [→ lighthouse-l2]).

```pts
// .pts — the spine (handler model; the boundary, not the body)
const listForYouPosts = {
  request:  schema { limit: int(1..100) },
  response: schema { posts: ArrayOf<Post>, nextCursor: str },
};
```

```ts
// gen/client.ts  (prettier-emitted — P3 glass floor; readable, ejectable, NO reflection)
export interface LykuClient {
  /** POST /list-for-you-posts — typed req+res, msgpack codec (§5) */
  listForYouPosts(req: { limit: number }): Promise<{ posts: Post[]; nextCursor: string }>;
}
export function createLykuClient(opts: ClientOptions): LykuClient {
  return {
    listForYouPosts: (req) =>
      __post("/list-for-you-posts", __codec.listForYouPosts.encodeReq(req))
        .then(__codec.listForYouPosts.decodeRes),   // decoded value IS the response type
  };
}
```

The client is **ejectable**: it is plain TS you can open, read, and (per §12.1) detach for a custom transport. Crucially the decoded payload *is* the response type — there is no `unpack() as Record<string,unknown>` and no `as unknown[]` cast, because the codec (§5) is a projection of the *same* response schema (A1, eliminating the L2 codec hole).

### 2.3 P4 — server handles

`generateHandles` projects each handler model to a typed **factory** (`handle*`) plus its `.d.ts`. The factory types the boundary — request validation, response shape, context threading — and the hand-written **body** hangs off it in the logic tree. This is the I1 split at the handler granularity, audit-confirmed:

```pts
// gen/handles.d.ts  (formatCode-emitted — P4 glass floor)
export declare function handleListForYouPosts(
  body: (req: { limit: number }, ctx: SecureContext<typeof listForYouPosts>)
        => Promise<{ posts: Post[]; nextCursor: string }>,
): RegisteredHandler;
```

```pts
// libs/routes/src/social/handlers/listForYouPosts.ts  (HAND-WRITTEN logic — never regenerated)
export default handleListForYouPosts(async (req, ctx) => {
  const posts = await feedFor(ctx.requester, req.limit);   // business logic, the delta
  return { posts, nextCursor: cursorOf(posts) };
});
```

The factory is regenerated whenever the model changes; the body is preserved. A renamed `request` field becomes a *type error at the body's parameter*, not a silent drift — the compiler is the drift detector (I3).

---

## 3. The build pipeline — `.pts` family (Para → TS)

The `.pts`-family build is a single source-to-source pass followed by an ordinary TS/JS toolchain. Dispatch is by extension [→ ch:overview-and-surfaces §4.1]; this section specifies the *pipeline*.

```
# Build pipeline:  .pts family
.pts   →  Para→TS lowering  →  .ts   →  (tsc / Bun strip)  →  .js
.ptsx  →  Para→TS lowering  →  .tsx
.pjs   →  Para→JS lowering  →  .js
.pjsx  →  Para→JS lowering  →  .jsx
```

**Canonical vs mirror.** The Para→TS rewrite has two implementations that must agree (§8):

- **Canonical** — the ParaBun parser (`src/js_parser/*`, historically Zig, ported to Rust per `parabun-rust-rebase-strategy.md`). This is the behavioral source of truth at the *implementation* level (B1).
- **Mirror** — `@lyku/para-transpile`, a pure-JS source-to-source Para→TS pass with its own scanner, so the language runs without the binary (editors, Node). It is **parity-gated** against the canonical parser.

**Static semantics.** The pass rewrites Para constructs to host code referencing runtime helpers (`signal`, `derived`, `__paraFromSchema`, `synced`, `__paraDec`, …) [→ ch:overview-and-surfaces §1.1], injects the minimal helper-import preamble (only when ≥1 construct fired), and leaves a pure-host file a fixed point (superset closure, [→ ch:overview-and-surfaces INV-overview-4]). The result is plain TS handed to a standard toolchain. **No path emits opaque or `any`-degraded code** — the glass floor at the build level (I1).

---

## 4. The build pipeline — `.pui` (multi-pass Para → runes → Svelte)

`.pui` runs a fixed, **ordered** multi-pass lowering. Order is normative because later passes consume earlier passes' output [→ ch:overview-and-surfaces §4.2].

```
# Build pipeline:  .pui  (order is NORMATIVE)
1. Markup lowering      — inline JSX  →  {#snippet …}        (para-inline-snippets)
2. Script lowering      — general Para syntax (match, |>, ranges, leading-dot, …)
3. Reactivity lowering  — signal/derived/effect/prop/provide/inject/using/
                          source/async signal/sync/synced  →  Svelte runes
4. TS strip             — Bun.Transpiler (operators already gone; generic strip)
   (Node fallback)      — esbuild TS strip only (step 3 already produced standard TS)
5. Svelte compiler      — standard Svelte 5 runes component
```

**Why step 3 is the I2 seam.** Steps 1–2 are Para→TS (the same flat transform `.pts` performs). Step 3 is a *substrate* transform: it bridges spine keywords into the **view substrate** (forked Svelte's runes today), injecting `$state` cells, `$effect.pre` bridges, `onDestroy` teardown, and `$props()` merges [→ ch:pui-component-model]. Because it bridges into runes — a target the canonical parser does not produce — `lowerPuiReactivity` is **outside** the B1 parity contract (there is no canonical byte-target to equal, §8.3). Its build path delegates *generic* TS-stripping to `Bun.Transpiler` only *after* step 3 has already produced standard TS — so the comment in `para-preprocess` holds: "after this pass the content is standard TS; parabun's transpile sees nothing parabun-specific" [→ para-parabun-boundary]. Any Bun (or the Node/esbuild fallback) yields correct output; `para-preprocess` needs **no** pinned binary.

**Why the order is the only valid order** [→ ch:overview-and-surfaces §4.2 edge case]: a Para *operator* inside a reactive declaration's RHS (`signal x = a |> f`) is already host TS by the time step 3 matches the declaration head (step 3 sees `signal x = f(a)`); and the contextual guards (§1.1) keep reactive keywords inert to step 2. The passes compose in exactly this order and no other.

&gt; **INV-mpb-5 (build/LSP reactivity parity).** Step 3 is the **same** `lowerPuiReactivity` function the editor (LSP) path uses — not a copy. A test suite enforces byte-parity on the reactivity output, with only three sanctioned deltas: (1) operator desugars the parser does at build time but the LSP must do itself, (2) import placement (LSP injects inside `<script>` for sourcemap line accuracy; build emits before the tag), (3) a whitespace-only difference on an unterminated trailing `effect EXPR`. The mapping detail is [→ ch:tooling-diagnostics-and-conformance].

---

## 5. The wire codec — msgpack-native, a schema projection (P6, A1)

The wire codec is the projection that discharges **A1** (the sharpest *transport* anti-requirement: a schema/IDL system with no binary/msgpack support is disqualifying for an msgpack-end-to-end app) [→ schema-is-the-application §4a]. The codec is **not** a hand-rolled `pack`/`unpack` with an `as` cast on the decode — it is a **schema projection**, generated from the same model the client and handler read, with **identical types on both sides**.

### 5.1 The codec is a projection, not a cast

The L2 codec hole is `pack(body)` / `unpack(…) as Record<string,unknown>` done by hand — the decoded payload is fully untyped, the `as` is the totality hole [→ lighthouse-l2]. Under the spine, the codec is generated per endpoint/entity from the request/response schema:

```pts
// gen/codec.ts  (P6 glass floor — msgpack-native, both sides import THIS)
import { encode, decode } from "@msgpack/msgpack";

export const listForYouPosts = {
  encodeReq: (req: { limit: number }): Uint8Array => encode(req),
  decodeRes: (buf: Uint8Array): { posts: Post[]; nextCursor: string } => {
    const r = ListForYouPostsResponse.parse(decode(buf));   // parse gate — NOT an `as` cast
    if (r.tag === "Err") throw new CodecError(r.error);      // malformed wire → typed error value
    return r.value;                                          // decoded value IS the response type
  },
};
```

Decode runs the payload through the response schema's `parse` gate ([→ ch:type-and-schema-system §7.1]) — the decoded value *is* the typed response, with **no `as`** anywhere. The same `gen/codec.ts` is imported by the client (P3, §2.2) and the server handler boundary (P4, §2.3), so the two sides cannot disagree about a field's wire shape (I3). A field rename in the schema re-emits the codec on both sides; a stale consumer is a compile error.

### 5.2 Identical types both sides — the structural guarantee

Because the codec is *one generated module imported by both ends*, "identical types both sides" is not a discipline but a structural fact: there is a single `decodeRes` whose return type is the response schema's `Infer`, used identically by client and server. This is the A1 closure: the wire format the model projects is msgpack-native, total, and `as`-free — never a "later."

&gt; **Edge case (sync wire payload — closing the §5 I3 hole).** The same codec discipline applies to the sync `SyncEnvelope.value` and to stream-event payloads. The realtime `event: any` / `socket as any` hole [→ s5-reconciliation-spike, lighthouse-l1] is closed by projecting the stream-event schema (a discriminated union) into a typed codec for the socket payload — the A1 codec discipline applied to the socket, not just HTTP. The reconcile semantics over the decoded value are [→ ch:data-sync-and-authority]; the *codec* that types the payload is this projection.

---

## 6. The handler-type & auth/context model (P4/P8)

The generated boundary hands hand-written logic a **typed handler signature** built from two pieces defined in [→ ch:type-and-schema-system §7.4]: `Handles<M,Ctx>` (the request/response projection) and the `Ctx` type parameter (where the auth/middleware context threads).

### 6.1 `Handles<M,Ctx>` is the boundary type a handler body hangs from

```ts
// [→ ch:type-and-schema-system §7.4] — repeated for the codegen view
export type Handles<M extends { request: Schema; response: Schema }, Ctx = unknown> = (
  req: Infer<M["request"]>,
  ctx: Ctx,
) => Promise<Infer<M["response"]>> | Infer<M["response"]>;
```

The generated factory (P4) is *typed by* `Handles<typeof M, SecureContext<typeof M>>`. The body — the delta — is hand-written against that type. `req` is the validated request; the return must satisfy the response schema; `ctx` carries auth. This is the codegen face of the boundary/logic split: **`Handles` types the boundary, the body is the logic** (INV-mpb-2).

### 6.2 `SecureContext<Model>` — typed auth, zero `any` (the A4 closure on the server)

The single sharpest anti-requirement is **A4**: in prior model-driven API tooling, typed custom auth was so hard that `any` became the path of least resistance [→ schema-is-the-application §4a]. Para's server side is **A4-clean today**:

```ts
// the server context model (route-helpers/Contexts.ts shape)
type SecurityContextFragment = { requester: bigint; session: string };
type SecureContext<Model extends HandlerModel> =
  Model & HttpContextFragment & SecurityContextFragment;
```

Because `Ctx` in `Handles<M,Ctx>` is an ordinary type parameter the application substitutes, a custom-auth context is **typed end-to-end with no `any`** — the spine never forces an escape. Custom auth is a first-class *typed fragment* derived from the handler model, not an `any` socket. §12.3 generalizes this to a *typed middleware-composition surface* so the A4 closure holds for arbitrary middleware stacks, not just the built-in security fragment.

### 6.3 The client half (P8 — P-A4)

The server projects typed auth; the **client** must thread a typed session that the server receives as the *same* schema-derived type, custom-auth composable, **no `any`**. The Shipped gap is bounded: the model carries `authenticated?: boolean` per endpoint but the client generator does not yet project it into a typed session-threading surface — which is *why* hand-written loads (the L2 `fyp`) hand-wire `Bearer ${sessionId}` [→ p-a4-client-auth-projection]. The fix is **P-A4**, a bounded, no-`any`, I1-clean generator extension: project `authenticated` into a type-gated surface where an authenticated method is **unreachable without a typed `session`**:

```ts
// gen/client.ts  (P-A4 shape (c) — anonymous vs authenticated surfaces)
export function createLykuClient(opts: ClientOptions): AnonClient;   // only authenticated:false methods
interface AnonClient {
  authed(session: string): AuthedClient;   // adds the authenticated:true methods, typed
}
```

```pts
// logic tree — session ACQUISITION is the app delta; THREADING is generated
const session = cookies.get('sessionId') ?? '';            // logic
const api = createLykuClient({ baseUrl }).authed(session); // boundary (typed surface)
const r = await api.listForYouPosts({ limit: 20 });        // authenticated call — unreachable without session
```

"Forgot auth" becomes a **compile error**, not a silent 401 — the strongest available answer to the sharpest anti-requirement, and the path of least resistance *is* the typed path. The I1 split holds exactly: session **acquisition = logic**, session **threading + type-gating = boundary**.

---

## 7. The drift/introspection totality check (P1, INV-mpb-3, A5)

`lockstep-pg`'s drift/introspection is the **mechanical** anchor of I3. The DB-model projection (P1) is diffable against the *live* database: the introspector reads the real schema, the generator reads the spine, and the diff is the ground-truth answer to "is all data accounted for?" — verifiable, not aspirational [→ schema-is-the-application §3 I3, §4a A5].

Today the diff is a **report** (a build/CI artifact a developer reads). The Shipped guarantee is: the same model the client trusts (the response schema's fields) derives from DB tables, and the drift check confirms that response schema still matches the DB (the C7 totality check, [→ lighthouse-l2 §6]). What the diff does *not* yet do is **block the build** — a drift surfaces in a report, not as a compile error. §12.4 promotes it to a first-class build gate with a readable migration proposal, which is the mechanical form of "drift is a compile error" the global I3 invariant demands.

&gt; **INV-mpb-6 (the diff is the totality check, not a separate model).** The drift check diffs the *projected* DB model (P1) against the live DB — it does not introduce a second source of truth. "Accounted for" is exactly "the projection of the spine equals the live DB"; any inequality is a gap. This is why the totality claim is mechanical: it is a diff of two artifacts that both derive from (or describe) the one spine.

---

## 8. Parser-as-truth & the versioned JS-mirror parity contract (B1–B3)

The projections and the build pipeline rest on a desugaring that has two implementations (canonical parser, JS mirror) which must agree. This section specifies the contract and frames the spec-vs-implementation authority direction.

### 8.1 Spec authority vs implementation truth — the honest framing

&gt; **INV-mpb-7 (Para-the-spec is authoritative over meaning; the parity contract pins the *implementation* mirror to the *implementation* parser).** Para — this document — is the source of truth for **what** a construct *means*: its grammar, its static and dynamic semantics, its lowering shape. ParaBun (the parser) and `@lyku/para-transpile` (the JS mirror) are **conforming implementations** of that meaning; where this spec cites a ParaBun lowering it is **evidence of feasibility**, not the boundary of what Para may specify [→ ch:overview-and-surfaces §3.1]. *Within* the ParaBun implementation, the parser is pinned as the canonical byte-target the JS mirror must equal (B1) — that is an *implementation-internal* consistency contract that keeps two ParaBun-family artifacts from drifting, **not** a statement that the parser outranks the spec. The intended end state is **spec-authoritative**: a conformance corpus derived from *this document* against which any implementation (ParaBun or otherwise) is checked [→ ch:tooling-diagnostics-and-conformance]. Today's parity contract pins the parser because ParaBun is the only implementation and its parser is the most precise existing artifact; the spec-authority direction is the model these mechanics are migrating toward, not a contradiction of them.

So: read B1 below as "the canonical *ParaBun* desugaring is the byte-target *its own* JS mirror must match," operating *under* the spec, which is authoritative over what that desugaring should be in the first place.

### 8.2 B1 — the canonical parser is the implementation's source of truth

&gt; **INV-mpb-8 (B1).** Within ParaBun, the parser is the single source of truth for Para→TS desugaring; the JS mirror (`@lyku/para-transpile`) must match it. A parity mismatch means the *mirror* is wrong (or a deliberate parser change not yet mirrored) — never "fix" parity by mutating the corpus to match a wrong mirror [→ para-parabun-boundary B1].

The keyword/operator/refinement/primitive **catalog** lives in one file, `src/language-surface.ts`, from which every auxiliary surface (TextMate grammars, LSP allowlist, ts-plugin recognizers, snippets, docs) is generated via `scripts/codegen/`. The parser is the *behavioral* implementation; the catalog is the *design surface*. A CI gate (`scripts/codegen/check-clean.ts`) fails any change that adds a catalog entry without regenerating the auxiliary surfaces — so the catalog and the tools never drift [→ ch:overview-and-surfaces §3.1].

### 8.3 B2/B3 — the versioned, CI-blocking pin

Several JS packages mirror the canonical desugaring so the language runs without the binary:

- **`@lyku/para-transpile`** — Para→TS, own scanner. **The one true parser mirror; parity-gated.**
- **`para-preprocess` `lowerPuiReactivity`** — the `.pui` reactive→runes bridge. Bridges into Svelte runes, a transform the parser does not perform, so it is **outside** the B1 parity contract (no canonical byte-target). Its build path delegates generic TS-strip to `Bun.Transpiler` only *after* its own Para lowering produced standard TS [→ para-parabun-boundary "para-preprocess is NOT a parser mirror"].
- **`editors/lsp` `pui-transform`** — the `.pui` LSP projection, composing the above [→ ch:tooling-diagnostics-and-conformance].

&gt; **INV-mpb-9 (B2/B3).** The coupling is **versioned, explicit, and CI-blocking**: an implementation pins an exact parser release (`.parabun-pin` = `{version, sha256, asset-url-pattern}`, stored as the published `@lyku/parabun-bin` carrier so the lockfile *is* the pin); the `parity` nx project runs the corpus two ways — canonical (pinned binary) and mirror (`@lyku/para-transpile`) — and asserts equality. **Byte-equality** where the corpus asserts it (the harness emits synthetic names matching the parser: `__pm`, `__pcv`, `__sig_`, `__syn_`, `__src_`, `__as_`, `__pu`, `__pb0…`, `__paraDefer0`), **semantic equality** where noted. Drift surfaces *at the pin bump*, in one reviewable PR. A **nightly canary** runs the corpus against the *latest* parabun release and reports (does not fail) divergence — early warning for stale-but-green pin drift [→ para-parabun-boundary B2/B3, P2-d].

&gt; **Edge case (three disagreement classes, adjudicated differently).** (1) **byte mismatch on a parity-asserted fixture** — the mirror is wrong, fix the mirror; (2) **byte mismatch where the corpus asserts only semantic equality** (import placement, trailing whitespace) — sanctioned, recorded in fixture metadata, not a failure; (3) **the mirror produces valid output the parser would not, or vice-versa** — a parser/spec ambiguity, escalated as a spec bug, never silently absorbed [→ ch:overview-and-surfaces §3.2]. The corpus scoping matters: only the ~25 *syntax-lowering* `parabun-*.test.js` (`extensions`/`lexer`/`parser`/`match`/`pipeline`/`pure`/`is`/`range`/`schema-dsl`/…) are the B1 contract and migrate to `parity`; the ~40 *runtime-module* tests (`gpu-*`/`llm*`/`image`/`audio`/`simd`/…) test the binary's runtime, have no JS mirror, and stay in the fork [→ para-parabun-boundary §Mechanism].

### 8.4 How a non-ParaBun implementation conforms

This parity discipline is the seed of the spec-authority direction (§8.1): a future implementation conforms by **passing the parity corpus against the canonical desugaring**, and ultimately against a corpus derived from this spec. The full conformance notion — capability levels, the corpus as a normative artifact — is [→ ch:tooling-diagnostics-and-conformance]; this chapter establishes that the *mechanism* (a versioned, CI-blocking, two-way corpus) already exists and is what a conformance claim will be built on.

---

## 9. Build & projection invariants (summary)

- **INV-mpb-1 (glass floor — I1).** Every projection lowers to readable, ejectable code; no reflection, no `any`-degradation.
- **INV-mpb-2 (boundary/logic split).** Generators emit only the typed boundary; logic lives in a separate hand-written tree regeneration never touches.
- **INV-mpb-3 (diffable spine — I3, A5).** The DB projection is diffable against the live DB; that diff is the mechanical totality check.
- **INV-mpb-4 (durability ⇔ logic tree).** Code is durable iff it lives in the hand-written tree; the only way to make a boundary artifact durable is to eject it (§12.1).
- **INV-mpb-5 (build/LSP reactivity parity).** Step 3 of the `.pui` pipeline is the *same* function the LSP uses; byte-parity is enforced.
- **INV-mpb-6 (diff is the totality check).** The drift check diffs the projected model against the live DB — no second source of truth.
- **INV-mpb-7 (spec-authoritative direction).** The spec is authoritative over meaning; the parity contract is an implementation-internal mirror pin migrating toward spec-derived conformance.
- **INV-mpb-8/9 (B1–B3).** The canonical parser is the implementation's desugaring truth; the JS mirror is versioned-pinned and CI-blocking, with byte-equality where asserted.

---

## 10. Module & import semantics across surfaces

Para adds **no new module-resolution semantics** at the value level — imports/exports are host-language ESM [→ ch:overview-and-surfaces §2.2]. What this chapter owns is the *surface stratification* the projections depend on:

- A `.pui` file **imports** spine artifacts (`schema` values, the typed client, synced cells) from `.pts` files and consumes them as ordinary reactive values. A `.pts` file **never imports** a `.pui` component's runtime — components are leaves of the dependency graph (the view depends on the spine, never the reverse).
- **Type-only** imports cross the boundary freely (a `.pts` may `import type` a component's prop shape) because they erase.
- The generated boundary tree is imported by both the logic tree (handlers, components) and other generated artifacts (the client imports the codec, the handler imports the codec). The boundary tree imports *nothing* from the logic tree — generation cannot depend on hand-written code (or regen would be order-dependent).

&gt; **INV-mpb-10 (acyclic surface + boundary/logic stratification).** The import relation is a DAG: `.pui` strictly downstream of `.pts` (a spine file importing a view component's runtime is a compile error, I2 [→ ch:overview-and-surfaces INV-overview-5]); and the **generated boundary** strictly upstream of the **logic tree** (the boundary never imports logic). The two stratifications compose: spine → generated boundary → hand-written logic (handlers/components) → (nothing). This is the file-model precondition that lets the boundary be clean-regenerated and the view-renderer be swapped, both without touching what is downstream.

---

## 11. The build, end to end (worked example)

Tying the pipeline to the projections, here is one `schema` producing the full set of artifacts:

```pts
// src/schema/order.pts — the spine (one declaration)
schema Order { id: bigint, total: int(0..), placedAt: DateTime }

const placeOrder = {
  request:  schema { items: ArrayOf<Item> },
  response: Order,
};
```

```
# What the build emits from that one spine (the project{} block names the paths)
gen/migrations/0007_create_order.sql   — P1 (readable, reversible SQL)
gen/routes/placeOrder.contract.ts      — P2 (route contract type)
gen/client.ts                          — P3 (typed client method `placeOrder`)
gen/handles.d.ts                       — P4 (`handlePlaceOrder` factory type)
gen/codec.ts                           — P6 (msgpack pack/unpack, both sides)
gen/reconcile.ts                       — P7 (Order reconciler skeleton)
                                       — P5 (`::` parse-gate injected at the handler entry)
                                       — P8 (auth Ctx threaded via SecureContext<typeof placeOrder>)

libs/routes/src/.../placeOrder.ts      — HAND-WRITTEN body (logic tree; never regenerated)
src/routes/order/+page.pui             — HAND-WRITTEN component (logic tree)
```

A rename `placedAt → placed` in the schema re-emits **every** generated artifact and turns the stale references in the *logic tree* into compile errors (the migration, the codec field, the client return shape, the handler parameter) — drift made a compile error across all eight projections from one edit (I3). The `lockstep-pg` drift check (§7) catches the case the spine and the *live DB* disagree, the one drift the compiler alone cannot see.

---

## 12. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts` or the generators today). Each carries a `# Desugar (proposed):` sketch so it stays glass-floor-compatible (I1) and a rationale naming the gap it closes. They are introduced *here* because each concerns the *projection of the spine into running code* — ejectability, override, auth-composition, drift-gating, incrementality, distribution — rather than a single spine construct. They are distinct from the frontier directions of [→ ch:frontier-proposed-directions], which extend the *spine itself* (relations, authority-in-schema, temporal modeling); this section extends the *generator and build model*.

### 12.1 `eject` — per-projection, per-site detachment  `Proposed`

**Rationale.** I1's whole promise is "outgrowing an opinion = override one projection, never rewrite the app." But INV-mpb-4 says the generated boundary is all-or-nothing clean-regenerated, with **no per-file eject inside it** — so *today there is no sanctioned mechanism to durably override one artifact* [→ schema-is-the-application §9 "no per-file eject … nothing durable may live in it"]. The `.para` manifest's `project { … ejected }` flag [→ ch:overview-and-surfaces §5.4] records *that* a target is ejected but not *how* to perform the ejection cleanly. `eject` is the operation that lifts exactly one projected artifact **out of the boundary tree into the logic tree**, where INV-mpb-4 makes it durable — the rest of the boundary stays generated. It is the formal mechanism behind the I1 slogan.

**Grammar.** `eject` is a manifest-level directive (a refinement of the `project` block's `EjectFlag`), naming the target and the entity/site it detaches:

```
EjectDecl ::= "eject" Target ("of" SchemaRef)? "to" OutSpec EjectMode?
Target    ::= "db" | "api" | "client" | "codec" | "reconciler" | "migrations" | "handles"
EjectMode ::= "frozen" | "tracked"                  ⟨default: tracked⟩
SchemaRef ::= Ident      ⟨omit to eject the whole target; present to eject one entity's slice⟩
OutSpec   ::= StringLit  ⟨destination in the LOGIC tree, not the boundary tree⟩
```

**Lexical note.** `eject` is a manifest-local keyword (not in the general catalog, so it cannot shadow an identifier in `.pts`/`.pui`). `of SCHEMA` narrows the ejection to one entity's slice of a target (eject only `Order`'s reconciler, keep every other entity's generated); omitting it ejects the whole target. `frozen` vs `tracked` selects the post-eject regen behavior (static semantics below).

**Static semantics.** `eject T of S to PATH` asserts the artifact for target `T`, entity `S`, now lives (hand-owned) at `PATH` in the **logic tree**. The generator:

1. **performs the lift once** — on first build after the `eject` directive, it writes the *current* generated artifact to `PATH` (a clean starting point the developer then edits) and stops emitting it into the boundary tree;
2. **never regenerates `PATH` thereafter** (it is now logic — INV-mpb-4);
3. under **`tracked`** (default), still computes what it *would* generate and **diffs** it against `PATH`, surfacing a *warning* (or, under §12.4, a build gate) when the spine has drifted from the ejected copy — so an ejected projection that has fallen behind a schema change is *visible*, not silently stale;
4. under **`frozen`**, suppresses even the diff (the developer has fully taken ownership; use sparingly).

A target ejected `of S` still generates for every *other* entity — ejection is per-site, not per-target-global (the central improvement over the binary `project … ejected` flag). The boundary's *type contract* is still enforced: the ejected artifact must still satisfy the boundary type (a hand-owned `reconciler` for `Order` must still produce an `Order`), so ejection detaches *implementation*, not *type* — the glass floor stays typed (I3).

**Dynamic semantics / desugar.** No runtime cost; `eject` is a build-time routing decision. The desugar is a generator manifest entry plus the one-time lift:

```
# Desugar (proposed):  eject reconciler of Cart to "src/sync/cart-reconcile.ts" tracked
Para (app.para):
    project web { reconciler -> "gen/reconcile.ts"; }
    eject reconciler of Cart to "src/sync/cart-reconcile.ts" tracked;
TS (.para.config.ts):
    export const __paraEject = [
      { target: "reconciler", of: "Cart", out: "src/sync/cart-reconcile.ts", mode: "tracked" },
    ];
    // build: lift gen-of-Cart-reconciler → src/sync/cart-reconcile.ts ONCE;
    //        thereafter generate every OTHER entity's reconciler into gen/reconcile.ts,
    //        skip Cart, and (tracked) diff the would-generate Cart reconciler vs the ejected file.
```

**Interaction.** `eject` is the operation `project … ejected` (§5.4) declares the *result* of; this gives it `of S` granularity and a `tracked`/`frozen` regen policy. It composes with §12.2 (an override hook is the *lighter* tool — keep the artifact generated, inject one custom function; `eject` is the *heavier* tool — take the whole artifact). Under §12.4 a `tracked` eject's drift becomes a compile error (the ejected copy is part of the totality surface). It is the literal discharge of falsification criterion §6.3 ("outgrowing an opinion required editing the app, not overriding a projection") — `eject` *is* the per-projection override that §6.3 says must exist [→ schema-is-the-application §6].

**Example.**

```para
// app.para — eject ONE entity's client method for a bespoke transport; rest stays generated
project web {
  client     -> "gen/client.ts";
  reconciler -> "gen/reconcile.ts";
}
eject client of LiveScore to "src/net/live-score-client.ts" tracked;   // custom SSE transport
// every other endpoint's client method stays in gen/client.ts, regenerated normally
```

```para
// ✗ counter-example
eject reconciler to "gen/reconcile.ts";   // ✗ error: eject destination must be in the LOGIC tree,
                                          //   not the generated boundary path (would be clobbered)
```

### 12.2 Projection-override hooks — custom handler/codec/reconciler for one entity, no fork  `Proposed`

**Rationale.** `eject` (§12.1) is the heavy tool: it detaches a whole artifact into hand-ownership. But most overrides are *surgical* — "use my conflict-resolution function for `Message.reactions`," "encode `Blob` fields with my codec," "wrap this one handler in my rate-limiter" — and ejecting the whole `reconciler.ts`/`codec.ts` to change one function loses all the generated rest. An **override hook** keeps the artifact generated and injects **one named function** at a declared seam — overriding a projection *without* forking the generator. This is the granular middle between "fully generated" and "fully ejected."

**Grammar.** An override is a `.pts`-level declaration (in the logic tree) that registers a typed function against a projection seam:

```
OverrideDecl ::= "override" Seam "of" SchemaRef "=" Expr ";"
Seam         ::= "codec" "." ("encode" | "decode")
               | "reconcile" "." ("merge" | "rollback" | "conflict")
               | "handler" "." ("before" | "after")
               | "migration" "." "sql"
```

**Lexical note.** `override` is a contextual keyword firing only on `override SEAM of NAME =` (so `const override = …` is untouched — the superset-closure guard, [→ ch:overview-and-surfaces §1.1]). The `SEAM` is a closed, dotted enumeration of the *declared seams* a generator exposes (not arbitrary — a generator without a `reconcile.conflict` seam rejects an override for it: `'reconcile.conflict' is not an override seam of the reconciler projection`).

**Static semantics.** `override SEAM of S = FN` registers `FN` as the implementation of seam `SEAM` for entity `S`; the generator emits the rest of the artifact normally but calls `FN` at the seam instead of its default. `FN` is **fully typed against the seam's contract** derived from `S`'s schema (a `reconcile.merge of Cart` must be `(local: Cart, incoming: Cart) => Cart`; a `codec.decode of Order` must be `(buf: Uint8Array) => Result<Order,string>`) — a type-mismatched override is a compile error (no `any`, I3). An override lives in the **logic tree** (it is hand-written), so it is durable (INV-mpb-4); the generated artifact that *calls* it stays in the boundary tree, regenerated freely. At most one override per (seam, entity); a missing override leaves the generated default.

**Dynamic semantics / desugar.** The generator wires the override at the seam; the override itself is an ordinary function call at runtime.

```
# Desugar (proposed):  override reconcile.merge of Cart = mergeCart
Para (logic tree, src/sync/overrides.pts):
    override reconcile.merge of Cart = (local, incoming) =>
      ({ ...incoming, items: dedupeById([...local.items, ...incoming.items]) });
TS (registered into the generated reconciler):
    import { __registerOverride } from "@lyku/para-sync";
    __registerOverride("Cart", "reconcile.merge",
      (local: Cart, incoming: Cart): Cart =>
        ({ ...incoming, items: dedupeById([...local.items, ...incoming.items]) }));
    // gen/reconcile.ts emits:  const merged = __override("Cart","reconcile.merge")
    //                                          ?? __defaultClassAMerge(local, incoming);
```

**Interaction.** Override hooks are the *fine* tool; `eject` (§12.1) is the *coarse* tool — both are sanctioned per-site projection overrides (I1), and the build prefers an override (artifact stays generated, only the seam is custom) and reserves `eject` for when the whole artifact must be owned. The `reconcile.merge`/`reconcile.conflict` seams are exactly the Class-B per-field merge the sync chapter keeps explicit-opt-in [→ ch:data-sync-and-authority §13.2] — an override hook is the glass-floor way to supply that merge function without an `any` (the s5 "Class-B stays an explicit hand-written delta" rule made a typed surface). It composes with §12.3 (`handler.before`/`handler.after` seams are the typed-middleware injection points).

### 12.3 Typed auth/middleware composition — schema-aware, zero `any` (discharges A4)  `Proposed`

**Rationale.** A4 — "custom auth/middleware forces an `any`" — is the *sharpest* anti-requirement, and §6 shows the server context (`SecureContext<Model>`) is typed today. But **composition** of middleware (auth → rate-limit → audit → handler) is still ad-hoc: each layer widens `ctx`, and without a typed composition surface the widening degrades to `any` at the first untyped layer [→ schema-is-the-application §4a A4, §6.6]. A **typed middleware-composition surface** makes the `Ctx` that `Handles<M,Ctx>` threads the *result of a typed pipeline of context transforms*, each schema-aware, so the composed context is total — no `any` at any layer.

**Grammar.**

```
MiddlewareDecl ::= "middleware" Ident "(" CtxIn ")" "->" CtxOut Block
PipelineDecl   ::= "pipeline" Ident "=" Ident ("|>" Ident)* ";"
ApplyDecl      ::= "use" PipelineRef "on" (SchemaRef | "*") ";"
CtxIn          ::= Type        ⟨the context this layer requires⟩
CtxOut         ::= Type        ⟨the context this layer produces (a refinement/extension of CtxIn)⟩
```

**Lexical note.** `middleware` / `pipeline` / `use … on` are contextual: `middleware NAME (` fires the declaration; a value named `middleware` survives. The composition operator reuses `|>` [→ ch:lexical-and-expression-syntax] — a middleware pipeline is literally the pipeline operator over context transforms, so "compose middleware" reads as "thread the context through each layer," its existing meaning.

**Static semantics.** A `middleware NAME (CtxIn) -> CtxOut` is a **typed context transform**: it requires a context assignable to `CtxIn` and produces `CtxOut` (which must extend or refine `CtxIn` — a layer may *add* `requester`, never *drop* a guarantee). A `pipeline P = auth |> rateLimit |> audit` composes them, **type-checking each junction**: the `CtxOut` of one layer must satisfy the `CtxIn` of the next, or it is a compile error (`middleware 'audit' requires { session } but 'rateLimit' produces { requester }; insert a layer or reorder`). `use P on S` (or `on *`) sets `Handles<typeof S, CtxOut<P>>` for the matched handlers — so the handler body's `ctx` is the *fully composed, fully typed* context. **No layer may widen to `any`**; a middleware whose `CtxOut` is `any` (or that returns an untyped context) is rejected under the totality check (discharges A4 mechanically). This is the composition generalization of §6.2: §6.2 types one fragment, §12.3 types an arbitrary stack of them.

**Dynamic semantics / desugar.** The pipeline lowers to function composition over the context; each layer runs in order at request entry, before the handler body; a layer returning an `Err` short-circuits (errors-as-values, [→ ch:errors-results-and-validation]).

```
# Desugar (proposed):  pipeline + use on
Para (logic tree):
    middleware auth (HttpCtx) -> SecureContext<any> {
      const session = req.headers.authorization;
      return session ? Ok({ ...ctx, requester: resolve(session), session }) : Err(401);
    }
    middleware rateLimit (SecureContext<any>) -> SecureContext<any> {
      return underLimit(ctx.requester) ? Ok(ctx) : Err(429);
    }
    pipeline secured = auth |> rateLimit;
    use secured on *;
TS (woven into the generated handler boundary):
    const __ctx_secured = (req, base) =>
      __chain(base, [auth, rateLimit]);   // each: (ctx) => Result<NextCtx, HttpError>
    // generated factory now types ctx as SecureContext, threads __ctx_secured before the body;
    // an Err short-circuits with the status, never reaching the hand-written body.
```

**Interaction.** This surface *is* the A4 discharge at the composition level — it is why the `Ctx` parameter of `Handles<M,Ctx>` (§6.1) was made an open type parameter in the first place: so an arbitrary typed pipeline can substitute for it. It composes with §12.2 (the `handler.before`/`handler.after` seams are where a pipeline weaves in for *one* entity rather than `on *`), with §6.3/P-A4 (the client's typed-session surface is the *other half* — server composes the typed context, client threads the typed session, neither side an `any`), and with the `surface server { … }` capability matrix [→ ch:overview-and-surfaces §5.3] (a `server`-only middleware physically cannot be imported into a client bundle, so the auth context can never leak to or be forged on the client — the structural half of A4).

### 12.4 Diff-as-compile-error — live-DB drift as a first-class build gate  `Proposed`

**Rationale.** INV-mpb-3 / §7 establish that the spine is *diffable* against the live DB and that the diff is the mechanical totality check — but today that diff is a **report**, not a **gate**: a drift surfaces in a CI artifact a developer reads, not as a build failure. The global I3 invariant says "**drift is a compile error**" [→ ch:overview-and-surfaces I3]; this construct makes it literally one, and pairs it with a **readable migration proposal** so the gate is actionable, not just obstructive.

**Grammar.** A manifest-level gate declaration binds a live-DB connection to a profile and sets the drift policy:

```
DriftGate ::= "drift" DriftPolicy ("against" ConnRef)? ("propose" "to" OutSpec)?
DriftPolicy ::= "error" | "warn" | "off"
ConnRef     ::= StringLit | Ident      ⟨a connection string or a named env binding⟩
```

**Lexical note.** `drift` is a manifest-local keyword (alongside `spine`/`authority`/`transport`, [→ ch:overview-and-surfaces §5.1]). `against` names the live DB; absent it, the gate uses the workspace's configured connection. `propose to PATH` writes the generated migration proposal there.

**Static semantics.** Under `drift error`, the build introspects the live DB (via the P1 generator's introspector, §7) and diffs the projected model against it. **Any divergence is a build error** — a table/column in the spine but not the DB, in the DB but not the spine, or a type/constraint mismatch — with the diagnostic naming the exact field (`drift: schema Order has column 'placed_at TIMESTAMPTZ' not present in live DB table "order"; apply migration 0007 or eject the divergence`). Crucially the gate also **proposes the migration**: it emits the readable, reversible SQL that would reconcile the spine and the DB (the §7 P1 migration, but surfaced *as the fix for the gate*). Under `drift warn` it reports without failing; `off` disables (for environments with no DB reachable — the gate must fail *loud and clear* on an unreachable DB, never silently pass, [→ para-parabun-boundary risks]). A `tracked`-ejected artifact (§12.1) whose ejected copy has drifted from the spine is *also* a drift under this gate — so ejection does not create a totality blind spot.

**Dynamic semantics / desugar.** No runtime effect — `drift` is a build/CI gate. The desugar is a build-config entry plus the introspect-and-diff step.

```
# Desugar (proposed):  drift error against DATABASE_URL propose to gen/migrations/
Para (app.para):
    drift error against env.DATABASE_URL propose to "gen/migrations/";
TS (.para.config.ts):
    export const __paraDrift = { policy: "error", conn: process.env.DATABASE_URL,
                                 proposeTo: "gen/migrations/" };
    // build step: introspect(conn) → diff(projectedModel) →
    //   if drift && policy==="error": write proposed migration to proposeTo, FAIL build
    //   if drift && policy==="warn":  write proposal, warn
    //   if conn unreachable: FAIL with "live DB unreachable; drift gate cannot run" (never silent-pass)
```

**Interaction.** This promotes §7's report to the compile error the I3 invariant demands, and is the mechanical form of falsification criterion §6.7 ("the DB-diff totality check can't be wired → I3 unverifiable") turned into a *passing* gate [→ schema-is-the-application §6.7]. It composes with §12.1 (`tracked` ejects are in the drift surface) and with the `project { db -> … }` / `migrations` targets (§5.4) — the gate diffs exactly those projections. Under a `strict-totality` workspace [→ ch:overview-and-surfaces §5.2] the gate is implied `error` (a strict-totality workspace cannot have un-gated drift). It is the build-time twin of the compiler's own drift detection (§11): the compiler catches spine↔logic drift, the drift gate catches spine↔live-DB drift — together, no drift anywhere is silent.

### 12.5 Incremental / partial projection — regenerate only what changed  `Proposed`

**Rationale.** A large spine (hundreds of schemas, the 940-handler corpus) regenerating *all* eight projections on every edit is slow and noisy (a one-field change re-emits every artifact, churning diffs). The boundary is already partitioned by entity and target; an **incremental projection** model regenerates only the projections whose *inputs* changed, keying off a content hash of each schema and each generator — making the build fast and the diff minimal, without weakening the all-or-nothing-*within-an-artifact* rule (INV-mpb-4).

**Grammar.** Incrementality is a profile-level mode on the `project` block plus an optional per-target granularity:

```
IncrementalDecl ::= "incremental" Granularity? ;
Granularity     ::= "entity" | "target" | "field"   ⟨default: entity⟩
```

**Lexical note.** `incremental` is a manifest-local modifier inside a `project { … }` block. `entity` (default) re-emits an artifact when *that entity's* schema hash changes; `target` re-emits a whole target when *any* input changes (coarse); `field` (finest) re-emits only the affected field's slice where the generator supports field-granular output.

**Static semantics.** The build maintains a **projection cache** keyed by `(target, entity, schemaHash, generatorVersion)`. On a build, for each (target, entity) it recomputes the key; an unchanged key **reuses the cached artifact** (no regen, no diff churn); a changed key **regenerates that (target, entity) slice only**. Correctness obligation: the cache key must include *every* input that can affect the output — the schema content, the generator version, and any cross-entity dependency (a relation [→ ch:frontier-proposed-directions A.2.2] makes `Post`'s client depend on `User`'s schema, so `User`'s hash is in `Post`'s key). A missed dependency would produce a stale artifact — so the key derivation is itself part of the totality surface (a generator declares its input set; an under-declared input is a generator bug caught by a periodic full rebuild that must byte-match the incremental result, the same parity discipline as §8). Incrementality **never** changes *what* is generated (the full-rebuild result is the spec; incremental is an optimization that must equal it), only *whether* a given slice is recomputed.

**Dynamic semantics / desugar.** Build-time only. The desugar is the cache plus the per-slice regen decision.

```
# Desugar (proposed):  incremental entity
Para (app.para):
    project web { ... } incremental entity;
TS (.para.config.ts):
    export const __paraIncremental = { granularity: "entity" };
    // build: for each (target, entity): key = hash(schema, deps, generatorVersion);
    //        cache hit → reuse artifact; miss → regenerate THIS slice, update cache.
    //        periodic full rebuild must byte-equal the incremental result (parity gate).
```

**Interaction.** Incremental projection is the performance counterpart to the boundary/logic split: because the boundary is partitioned by (target, entity) and the logic tree is never regenerated, the *only* thing a build must reconsider is which boundary slices changed. It composes with §12.1 (an ejected slice is *removed* from the regen set entirely — it is logic now, so it is never in the incremental recompute), §12.4 (drift-gating runs only against the regenerated DB slices, plus a full check on demand), and the parity discipline of §8 (the "full rebuild byte-equals incremental" obligation is the same "two ways must agree" contract as canonical-vs-mirror parity — a stale incremental artifact is the projection-cache analog of a parity mismatch). It must never trade incrementality for a silent stale artifact (that would reintroduce exactly the silent-drift class the thesis exists to kill).

### 12.6 Schema-bearing library distribution — extended vs standard brand-variant selection per consumer  `Proposed`

**Rationale.** A Para library *exports schemas* (a shared `User`, a `Money` brand, a domain model). Distributing schema-bearing code raises a problem the single-app case hides: the **extended-vs-standard brand variant** [→ ch:type-and-schema-system §5]. The *extended* variant carries full constraint brands into the TS type (`StringOf<{format:"email"}>`) — total but heavy on tsc; the *standard* variant collapses brands to base types (`string`) — light but lossy. A library author picks one at build; a consumer may need the other (an app under `strict-totality` wants extended; a casual consumer wants standard for compile speed). Today that choice is global and baked at the library's build — a consumer cannot select. A **distribution model** lets a schema-bearing package ship *both* projections and the consumer select per-import, so the brand variant is a *consumer* decision, not a publish-time lock-in.

**Grammar.** A manifest-level package declaration plus a per-dependency variant selection:

```
PackageDecl  ::= "package" Ident "{" PackageItem* "}"
PackageItem  ::= "exports" GlobPattern ";"           ⟨the schema-bearing modules⟩
               | "variants" VariantSet ";"           ⟨which variants this package ships⟩
VariantSet   ::= ("extended" | "standard") ("," ("extended" | "standard"))*
ConsumeDecl  ::= "consume" Ident "as" Variant ";"    ⟨a consumer's per-dependency choice⟩
Variant      ::= "extended" | "standard"
```

**Lexical note.** `package` / `exports` / `variants` / `consume … as` are manifest-local. A `package` block declares (in the *library's* `.para`) what it ships; a `consume DEP as VARIANT` (in the *consumer's* `.para`) selects which shipped variant to resolve.

**Static semantics.** A `package P { exports "src/schema/**"; variants extended, standard; }` builds **both** brand projections of every exported schema into the published artifact (an `extended` entry point and a `standard` entry point, e.g. via export conditions). A consumer's `consume P as extended` resolves `P`'s imports to the extended projection; `as standard` to the standard one. A package that ships only one variant and a consumer that requests the other is a resolution error (`package 'P' ships only the standard variant; cannot consume as extended — ask the author to publish 'variants extended, standard'`). The selection is **per dependency** (an app may consume its own domain library extended for totality and a third-party library standard for compile speed). Because both variants project from the *same* schema source, `Infer<typeof X>` yields the right data type under either (the data shape is variant-stable; only the *constraint brand carried into the type* differs — INV-schema-6, [→ ch:type-and-schema-system §5]) — so consuming as standard is a *visible, declared* totality reduction, never a silent `any` (I3): a `strict-totality` consumer (§5.2) consuming a dependency `as standard` is a warning (`consuming 'P' as standard under strict-totality drops constraint brands; consume as extended or acknowledge`).

**Dynamic semantics / desugar.** Distribution/build-time; no runtime effect — both variants erase to the same `__paraFromSchema` calls differing only in the *type-level* brand. The desugar is the package manifest plus the consumer's resolution map.

```
# Desugar (proposed):  package (library) + consume (consumer)
Para (lib money/.para):
    package money { exports "src/schema/**.pts"; variants extended, standard; }
Para (app/.para):
    consume money as extended;     // this app wants full constraint brands
    consume legacy-models as standard;   // tsc-speed over brand fidelity here
TS (published lib — both entry points):
    // money/extended.d.ts → schemas with StringOf<…>/NumberOf<…> brands
    // money/standard.d.ts → same schemas, brands collapsed to string/number
    // package.json "exports": { ".": { "extended": "./extended.js", "standard": "./standard.js" } }
TS (app .para.config.ts):
    export const __paraConsume = { money: "extended", "legacy-models": "standard" };
    // build resolves each dependency's import to the selected variant entry point.
```

**Interaction.** This is the distribution-scale generalization of the extended/standard collapse that §5 of the schema chapter defines for a single workspace — it makes the variant a *consumer* axis, which is the only way a shared schema library can serve both a totality-strict app and a compile-speed-sensitive one without forking. It composes with §5.2 `strict-totality` (which implies `as extended` resolution, so the brands are present to enforce) and with §12.4/§7 (a consumed library's schemas still participate in the consumer's drift check if they back DB tables — a library schema is spine like any other). It closes the last open question the projection model leaves: the spine is the application *across package boundaries*, with the totality/legibility trade-off (A3) made an explicit per-consumer choice rather than a publish-time lock-in.

---

### Summary of proposed surface

| § | Construct | One-line |
|---|---|---|
| 12.1 | `eject TARGET of SCHEMA to PATH [frozen\|tracked]` | Per-projection, per-site detachment: lift one artifact from the boundary into the durable logic tree; rest stays generated. |
| 12.2 | `override SEAM of SCHEMA = FN` | Surgical projection override: keep the artifact generated, inject one typed custom function at a declared seam — no fork. |
| 12.3 | `middleware`/`pipeline`/`use … on` | Typed, schema-aware auth/middleware composition; each layer's `Ctx` total — zero `any` (discharges A4 at the composition level). |
| 12.4 | `drift error against CONN propose to PATH` | Live-DB drift as a first-class build gate with a readable migration proposal — "drift is a compile error" made literal. |
| 12.5 | `project { … } incremental [entity\|target\|field]` | Regenerate only changed projection slices; full rebuild must byte-equal the incremental result (parity discipline). |
| 12.6 | `package { exports; variants }` + `consume DEP as VARIANT` | Schema-bearing library distribution: ship both brand variants, consumer selects extended (total) vs standard (light) per dependency. |

