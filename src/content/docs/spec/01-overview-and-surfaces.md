---
title: "Language Overview, Surfaces & File Model"
description: "The map of Para: the two surfaces (.pts/.ptsx/.pjs/.pjsx TypeScript superset; .pui Svelte-5 superset), how a Para program is structured, the…"
sidebar:
  order: 2
---

# Chapter: Language Overview, Surfaces & File Model

&gt; **Status of this chapter:** Mixed. The surface dispatch, lowering pipeline, and parity contract are **Shipped**; the manifest, pragma, capability matrix, projection-target surface, surface-graph, derived-extension, and conformance-fixture forms in *Proposed extensions* are **Proposed**.
&gt; **Cross-refs:** This chapter is the map; every construct it names is *defined elsewhere*. Reactivity [→ ch:reactivity-core], schema spine [→ ch:type-and-schema-system], sync [→ ch:data-sync-and-authority], component bridge [→ ch:pui-component-model], codegen/projections [→ ch:modules-projections-and-build], tooling/conformance [→ ch:tooling-diagnostics-and-conformance], errors/validation [→ ch:errors-results-and-validation], sources [→ ch:sources-async-and-native].

---

## 0. What Para is (and the one sentence everything hangs from)

Para is a full-stack reactive language *family* in which **the schema is the application**. A Para program is not a stack you assemble (DB + API + client + validation + transport + live state) but **a single declared model (`schema`) plus the deliberately-written deltas** around it. Every other artifact — table migrations, route contracts, the typed client, boundary validation, the wire codec, and client⇄server state sync — is a **projection** of that one schema spine [→ ch:modules-projections-and-build].

This chapter specifies the *outermost* layer: the file surfaces a program is written in, how a source file is dispatched to a lowering path, the relationship between **Para (the spec)** and **ParaBun (an implementation)**, and the three load-bearing invariants (I1–I3) that constrain every later chapter. It does **not** specify any construct's behavior — reactivity, schema, sync, purity, etc. each have their own chapter. Where a construct is named here it is *forward-referenced*, never defined.

### Global invariants (cited by tag throughout the spec)

- **I1 — Glass floor.** Every projection and every desugaring lowers to **plain, readable, ejectable** code (Para→TS, `.pui`→runes, schema→readable migration/handler/reconciler). Outgrowing an opinion means *reading the lowering and overriding that one projection* — never rewriting the application. If a generated artifact cannot be opened, read, and overridden per-site, it does not ship.
- **I2 — Spine at the Para layer, not the view.** Reactivity, schema, sync, and native are substrate-independent core. The view (`.pui`'s forked-Svelte renderer) is the swappable thing; the data/sync spine is the durable thing. Every design decision must survive a renderer swap with the spine untouched.
- **I3 — Totality without silent `any`.** All data is accounted for end-to-end (db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state). Any gap is *explicit and visible* — never a silent `any`, an unmodeled blob, an `as`-cast escape hatch. The model is **diffable against the live database**, so "accounted for" is verifiable; drift is a compile error.

The anti-requirements **A1–A5** and falsification criteria from `schema-is-the-application.md` are discharged across the projection chapters; this chapter cites them where a *surface* decision discharges one. For reference, they are: **A1** no binary/msgpack wire support; **A2** limited typing → hand-rolled handler validation; **A3** heavy/confusing model syntax → silent degradation (legibility is a correctness property); **A4** middleware/custom-auth forces `any` (the sharpest); **A5** db ⇄ api ⇄ types must be one chain, diffable against the real DB.

---

## 1. The two surfaces

Para has exactly **two** authoring surfaces, distinguished by file extension. Both are strict supersets of a host language: every legal host-language file is a legal Para file in the corresponding surface, and Para only *adds* keywords, operators, and declaration forms that lower away.

| Surface | Host language | Extensions | Lowers to | Role |
|---|---|---|---|---|
| **`.pts` family** | TypeScript (+ JSX) | `.pts`, `.ptsx`, `.pjs`, `.pjsx` | TS / TSX / JS / JSX | Logic, schema, server handlers, libraries — the **spine** |
| **`.pui`** | Svelte 5 (runes) | `.pui` | a Svelte-class component (runes + template) | Components — the **view** (swappable per I2) |

### 1.1 The `.pts` family (TypeScript-superset surface)

The `.pts` family is a **source-to-source** TypeScript superset. There are four extensions, differing only in the host dialect they target:

```
PtsExtension ::= ".pts" | ".ptsx" | ".pjs" | ".pjsx"
```

- `.pts` — TypeScript, no JSX. Lowers to `.ts`.
- `.ptsx` — TypeScript + JSX. Lowers to `.tsx`.
- `.pjs` — JavaScript, no JSX. Lowers to `.js`.
- `.pjsx` — JavaScript + JSX. Lowers to `.jsx`.

**Lexical note (statement-position keyword detection).** Para keywords are recognized *contextually*, not reserved. `fun`, `signal`, `effect`, `match`, etc. fire only in disambiguating positions (e.g. `fun` only before `[A-Za-z_$*(<]`; `signal` only before `NAME [=,;:!]`; `effect` only at statement position followed by whitespace + identifier and **not** `effect(` / `effect.` / `effect[` / `effect=`). This is what makes the surface a true superset: an identifier named `signal` used as a value is *not* rewritten. The full set of these guards lives in [→ ch:lexical-and-expression-syntax]; this chapter only asserts that surface-superset status depends on them.

&gt; **INV-overview-4 (superset closure).** For every Para surface S with host H, the identity transform on a pure-H file is a fixed point of S's lowering: `lower_S(h) ≡ h` for any file `h` containing no Para construct (modulo the runtime-import preamble, which is only injected when at least one construct fires). This is the formal statement of "strict superset" and is the property the parity corpus' *host-passthrough* fixtures pin.

**Static semantics.** A `.pts`-family file is type-checked as if it were its lowered host file. The Para constructs it contains contribute *additional* static obligations (totality of `match`, purity of `pure`, no-silent-`any` at `::` boundaries) defined in their own chapters. There is no `any`-valued escape introduced by any surface construct (I3). The extension selects two orthogonal axes: **JSX-enabled** (`x` variants) and **strip-target** (TS-typed for `.pts/.ptsx`, untyped for `.pjs/.pjsx`); these are independent (any of the four combinations is legal).

**Dynamic semantics.** Identical to the lowered host file. Para is **erasable at the value level** except for the runtime helpers it references (`signal`, `derived`, `__paraFromSchema`, `__paraDec`, `synced`, …), which are ordinary imported functions [→ ch:reactivity-core, ch:type-and-schema-system]. The preamble is injected **once per file** and only when ≥1 construct that needs a helper fired; the import list is the minimal set of helpers actually referenced (no blanket import).

```pts
// .pts — a spine file: schema + handler delta, lowering to plain .ts
schema User { id: UUID, email: Email, age: int }

pure fun normalize(name: string) { return name.trim().toLowerCase(); }

fun handle(req:: User) {            // :: injects boundary validation
  return req.email;                 // req is a validated User
}
```

### 1.2 `.pui` (Svelte-5-superset surface)

`.pui` is a Svelte 5 superset for **components**. A `.pui` file is a Svelte component (one or more `<script>` blocks + markup + `<style>`) in which the `<script lang="ts">` body may use Para reactive declarations (`signal`/`derived`/`effect`/`source`/`async signal`/`using`/`sync`/`synced`/`prop`/`provide`/`inject`) and the markup may use inline-snippet sugar. Everything Para adds **lowers to Svelte 5 runes** (`$state`/`$derived`/`$effect`/`$props`) and standard `{#…}` blocks [→ ch:pui-component-model].

```
PuiExtension ::= ".pui"
```

**Why `.pui` is a distinct surface, not a fifth `.pts` extension.** The `.pts` family lowers **Para→TS** (a flat source-to-source transform). `.pui` additionally lowers **Para reactive keywords → Svelte runes** — a *substrate* transform the TS lowering never performs (it injects `$state` cells, `$effect.pre` bridges, `onDestroy` teardown, and `$props()` merges). This bridge is the swappable seam of I2: the view substrate (forked Svelte today) can be replaced and the *spine* keywords (`signal`/`schema`/`sync`) keep their Para-native meaning, because the spine is defined at the Para layer and merely *bridged into* runes, not defined as runes.

**Implicit script flavor.** Inside `.pui`, a `<script>` whose `lang` attribute is in `PUI_IMPLICIT_LANGS = { "" , "ts", "typescript", "js", "javascript" }` is treated as Para-flavored — Para keywords are recognized without an opt-in attribute. This is the rule `.pui` is parabun-flavored *by extension*. A `<script>` with any other `lang` (e.g. `lang="scss"`, a foreign DSL) is **not** Para-lowered and passes through verbatim.

&gt; **Edge case (multiple script blocks).** Svelte permits a `<script module>` (module-scope) block alongside the instance `<script>`. Both are Para-lowered if their `lang` is implicit, but reactive declarations (`signal`/`sync`/`prop`/…) in a `<script module>` block are a compile error — module scope has no component instance to bind a `$state` cell or schedule `onDestroy` against: `reactive declaration in <script module>; module scope has no component lifecycle`. Only pure value/`fun`/`schema`/operator forms are legal there.

```pui
<!-- .pui — a view file: synced state + props, lowering to runes -->
<script lang="ts">
  prop id: string;
  sync user :: User from `user:${id}`;   // server-authoritative replica
  signal count = 0;                       // bridges to $state
</script>

<h1>{user.name}</h1>
<button onclick={() => count = count + 1}>{count}</button>
```

&gt; **Note (`sync` vs `synced`).** Both lower to a `synced(...)` runtime call bridged through `__syn_`. `sync NAME :: SCHEMA from KEY` is the **validated** form (the `::` schema is threaded into `synced(key, { schema: SCHEMA })`, parse-gating every envelope); a bare `sync NAME : T from KEY` is the **type-only** form (no runtime schema, delivery from `configureSynced`). `synced NAME = EXPR` wraps an arbitrary replica-producing expression. The reconcile/authority semantics of all three are [→ ch:data-sync-and-authority]; this chapter asserts only that all three are `.pui`/source-position declarations that bridge identically into the runes lifecycle.

### 1.3 Surface relationship (one diagram)

```
                    schema spine  (defined in .pts, [→ ch:type-and-schema-system])
                          │
        ┌─────────────────┼──────────────────────────────┐
        │ projections (codegen, [→ ch:modules-projections-and-build])
   db model · api routes · typed client · wire codec · sync reconciler
        │                                                  │
   .pts family  ──Para→TS──►  TS/JS                  .pui  ──Para→runes──►  Svelte component
   (logic/spine)                                     (view; swappable per I2)
```

---

## 2. The Para program & application model

### 2.1 Spine-and-deltas

A Para *application* is, definitionally:

```
Application ::= Schema+ Delta*
Delta       ::= Handler | Component | Module      ⟨deliberately-written code that is NOT a projection⟩
```

The **schema spine** is the set of `schema` declarations [→ ch:type-and-schema-system]. The **deltas** are the hand-written code that the spine does *not* generate: business-logic handler bodies, `.pui` components, library modules. The projection generators [→ ch:modules-projections-and-build] produce the *boundary* (factories, types, transport shapes, reconcilers); application logic lives in a **separate hand-written tree that regeneration never touches** (the I1 boundary/logic split). This is what makes "the schema is the application" a totality claim (I3) rather than a slogan: every byte of data flowing db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state is either *in the spine* or *in a visible delta*; there is no third, untyped place for it to hide.

### 2.2 File model & module structure

- A Para program is a set of files under the four `.pts`-family extensions and `.pui`.
- Imports/exports are host-language modules (ESM); Para adds no new module-resolution semantics at this layer (module/import specifics, including cross-surface imports, are [→ ch:modules-projections-and-build]).
- A `.pui` file **imports** spine artifacts (`schema` values, typed clients) from `.pts` files and consumes synced state as ordinary reactive values; a `.pts` file **never imports** a `.pui` file's runtime (components are leaves of the dependency graph).
- There is no project-global Para state at this layer; the *Proposed* `.para` manifest (§5) introduces a single declared place for spine-and-authority configuration.

&gt; **INV-overview-5 (acyclic surface stratification).** The import relation, projected onto surfaces, is a DAG with `.pui` strictly downstream of `.pts`: a `.pts` module importing the *runtime value* of a `.pui` component is a compile error (`spine file imports a view component's runtime; the spine must not depend on the view (I2)`). Type-only imports across the boundary are permitted (a `.pts` may `import type` a component's prop shape) because they erase. This is the file-model enforcement of I2 — the view depends on the spine, never the reverse — and is the precondition that lets the renderer be swapped without touching the spine.

---

## 3. Para ↔ ParaBun: spec vs implementation

**Para** is the language *specification* (this document). **ParaBun** is *one* implementation — a Bun fork whose lexer/parser is the canonical desugaring engine.

### 3.1 The canonical parser is the source of truth (B1)

&gt; **INV-overview-1 (B1).** The ParaBun parser is the **single source of truth** for Para→TS desugaring. JS-side mirrors must match it. A parity mismatch means the *mirror* is wrong (or a deliberate parser change not yet mirrored) — never "fix" parity by mutating the corpus to match a wrong mirror.

The keyword/operator/refinement/primitive **catalog** lives in one file, `src/language-surface.ts`, which is the *design surface* every auxiliary tool is generated from (TextMate grammars, the LSP allowlist, ts-plugin recognizers, snippets, docs) via `scripts/codegen/`. The parser (`src/ast/*` / `src/js_parser/*`, historically Zig, ported to Rust per `parabun-rust-rebase-strategy.md`) is the *behavioral* implementation. A CI gate (`scripts/codegen/check-clean.ts`) fails any change that adds a catalog entry without regenerating the auxiliary surfaces.

**Spec authority direction.** Para the spec is authoritative over *what* a construct means; where this spec cites a ParaBun lowering it is **evidence of feasibility**, not the boundary of what Para may specify. Where the spec proposes net-new surface not yet in the parser, its lowering is marked `# Desugar (proposed):`.

### 3.2 The JS-mirror parity contract (B2/B3)

Several JS packages *mirror* the canonical desugaring so the language can run without the binary in editors and Node:

- **`@lyku/para-transpile`** — source-to-source Para→TS (own scanner). **This is the one true parser mirror; it is parity-gated.**
- **`para-preprocess` `lowerPuiReactivity`** — the `.pui` reactive→runes lowering. This bridges into **Svelte runes**, a transform the parser does not perform, so it is **outside** the B1 parity contract (there is no canonical byte-target to equal). Its build path delegates *generic* TS-stripping to `Bun.Transpiler` only *after* the Para lowering has already produced standard TS.
- **`editors/lsp` `pui-transform`** — the `.pui` LSP projection, composing the above for type-checking [→ ch:tooling-diagnostics-and-conformance].

&gt; **INV-overview-2 (B2/B3).** The coupling is **versioned and explicit and CI-blocking**: an implementation pins an exact parser release (`.parabun-pin` = `{version, sha256, asset-url-pattern}`); the `parity` suite runs the corpus two ways — canonical (pinned binary) and mirror (`@lyku/para-transpile`) — and asserts equality. Byte-equality where the corpus asserts it (the harness deliberately emits synthetic names matching the parser: `__pm`, `__pcv`, `__sig_`, `__syn_`, `__src_`, `__as_`, `__pu`, `__pb0…`, `__paraDefer0`), semantic equality where noted. Drift surfaces *at the pin bump*, in one reviewable PR.

This parity discipline is **how a future, non-ParaBun implementation conforms** to Para: pass the parity corpus against the canonical desugaring. The conformance notion is detailed in [→ ch:tooling-diagnostics-and-conformance].

&gt; **Edge case (mirror-vs-canonical disagreement classes).** Three disagreement classes exist and are adjudicated differently: (1) **byte mismatch on a parity-asserted fixture** — the mirror is wrong, fix the mirror; (2) **byte mismatch where the corpus asserts only semantic equality** (e.g. import placement, trailing whitespace) — sanctioned, recorded in the fixture's metadata, not a failure; (3) **the mirror produces *valid* output the canonical parser would not, or vice-versa** — a parser/spec ambiguity, escalated as a spec bug, never silently absorbed by either side.

---

## 4. The lowering pipeline (file → running code)

This section specifies *dispatch* — which path a file takes by extension — not the per-construct lowerings (those live in each construct's chapter).

### 4.1 `.pts`-family path (Para → TS)

```
# Desugar:  .pts-family dispatch
.pts   →  Para→TS lowering  →  .ts    (TS strip → .js)
.ptsx  →  Para→TS lowering  →  .tsx
.pjs   →  Para→JS lowering  →  .js
.pjsx  →  Para→JS lowering  →  .jsx
```

A single source-to-source pass (canonical: the ParaBun parser; mirror: `@lyku/para-transpile`) rewrites Para constructs to host-language code referencing runtime helpers. The result is then handled by an ordinary TS/JS toolchain.

**Static semantics of dispatch.** The extension selects (a) whether JSX is enabled (`x` variants) and (b) the host strip target (TS for `.pts/.ptsx`, none for `.pjs/.pjsx`). For tooling, the LSP maps `.pts→.ts`, `.ptsx→.tsx`, `.pjs→.js`, `.pjsx→.jsx` so the host type-checker accepts the file [→ ch:tooling-diagnostics-and-conformance].

&gt; **Edge case (JSX vs generic-type angle bracket).** In `.ptsx`/`.pjsx` the host disables TS generic arrow syntax `<T>(x) => …` exactly as TSX does; Para inherits this restriction unchanged (a Para `pure arrow` with a leading type param is written `<T,>(x) => …` in JSX-enabled extensions). Para introduces no new `<`-sensitivity beyond the host's; the `~>`/`->`/range operators are multi-char and unambiguous against `<`.

### 4.2 `.pui` path (multi-pass Para → runes → Svelte)

`.pui` runs a fixed, ordered multi-pass lowering. **Order is normative** because later passes consume earlier passes' output (e.g. `effect` blocks must lower before a later `derived` regex could match an effect body).

```
# Desugar:  .pui dispatch (build path)
1. Markup lowering        — inline JSX  →  {#snippet …}            (para-inline-snippets)
2. Script lowering        — general Para syntax (match, |>, leading-dot, ranges, …)
3. Reactivity lowering    — signal/derived/effect/prop/provide/inject/
                            using/source/async signal/sync/synced  →  runes
4. Bun.Transpiler         — operators already gone; generic TS strip
   (Node fallback)        — esbuild TS strip only (step 3 already ran)
5. Svelte compiler        — standard Svelte 5 runes
```

The reactivity-lowering pass (step 3) is the substrate bridge of I2. Its exhaustive per-keyword rules are [→ ch:pui-component-model]; this chapter asserts only the dispatch and ordering.

&gt; **INV-overview-3 (build/LSP parity).** The build path and the editor (LSP) path use the **same** reactivity-lowering function (not a copy); a test suite enforces byte-parity on the reactivity output. The only sanctioned deltas are (1) operator desugars the parser does at build time but the LSP must do itself, (2) import placement (LSP injects inside `<script>` for sourcemap line accuracy; build emits before the tag), and (3) a whitespace-only difference on an unterminated trailing `effect EXPR`. Details and the sourcemap composition (`.pui ↔ lowered ↔ TSX`) are [→ ch:tooling-diagnostics-and-conformance].

&gt; **Edge case (pass-2 / pass-3 ordering hazard).** Because script lowering (pass 2) runs before reactivity lowering (pass 3), a Para *operator* appearing *inside* a reactive declaration's RHS is already host TS by the time pass 3 matches the declaration head — i.e. `signal x = a |> f` is seen by pass 3 as `signal x = f(a)`. Conversely, a reactive keyword must **not** be eligible for pass-2 rewriting; the contextual guards (§1.1) guarantee `signal`/`derived`/`effect` are inert to the general-syntax pass. The two passes are therefore composable in exactly this order and no other.

### 4.3 Glass-floor / ejectability (I1) at the surface level

Every dispatch path above produces **readable, ejectable** output: a `.pts` file's lowering is the TS a developer could have written by hand; a `.pui` file's lowering is idiomatic runes. No path emits opaque, reflection-driven, or `any`-degraded code. This is the surface-level statement of I1; each construct chapter restates it for its own lowering, and the *projection* chapter restates it for codegen.

### 4.4 Interaction summary (how the surface composes with the spine pillars)

A consolidated, non-normative map of how this chapter's surface decisions touch the four spine pillars (each detailed in its own chapter):

- **Signals/derived/effects** — `.pts` lowers them to `@lyku/para-signals` calls; `.pui` *bridges* the same keywords to `$state`/`$derived`/`$effect` via escape analysis. The keyword is identical across surfaces; only the lowering target differs (I2 seam) [→ ch:reactivity-core, ch:pui-component-model].
- **Schema** — `schema` is surface-uniform: it means the same in `.pts` and `.pui` and lowers identically (it is spine, not view). A `.pui` file *imports* schema values; it does not re-declare the spine.
- **Sync** — `sync`/`synced` are source-position declarations legal in `.pui` (component-scoped, auto-dispose) and at `source` position generally; their replica/reconcile semantics are surface-independent (I2) [→ ch:data-sync-and-authority].
- **Validation** — `::` and `is` are schema-bound and surface-uniform; at a handler boundary in `.pts` they throw-on-`Err`, at a sync boundary they parse-gate-and-skew [→ ch:errors-results-and-validation].

---

## 5. Proposed extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in the catalog/parser today). Each includes a desugaring sketch so it remains glass-floor-compatible (I1). They are introduced *here* because each concerns the program/surface/file model as a whole rather than a single construct.

### 5.1 `.para` project manifest — declare the spine and authority once  `Proposed`

**Rationale.** Today the schema spine is discovered by scanning files, and sync authority/transport is configured imperatively (`configureSynced(...)`) at runtime [→ ch:data-sync-and-authority]. That violates the spirit of I3 (the *set* of spine files and the authority model are themselves un-modeled program facts) and A3 (model-syntax fatigue — config scattered across call sites). A single declarative manifest names the spine, the authority model, and the projection defaults *once*, machine-checkably, for the whole workspace.

**Grammar.** A `.para` file is a restricted, declaration-only Para surface (a `.pts` whose only legal top-level forms are the manifest blocks below). It is itself glass-floor: it lowers to a plain TS config module.

```
Manifest      ::= ManifestItem*
ManifestItem  ::= SpineDecl | AuthorityDecl | TransportDecl | ProjectDecl | SurfaceDecl
SpineDecl     ::= "spine" "{" SpineEntry* "}"
SpineEntry    ::= GlobPattern ";"                       ⟨files contributing schema declarations⟩
AuthorityDecl ::= "authority" "{" AuthorityRule* "}"
AuthorityRule ::= SchemaRef "=>" ("class-a" | "class-b" FieldList) ";"
FieldList     ::= "{" Ident ("," Ident)* "}"
TransportDecl ::= "transport" ("in-process" | "nats" ConfigObj) ";"
ProjectDecl   ::= "project" Ident "{" ProjectionList "}"   ⟨forward-ref §5.4⟩
SchemaRef     ::= Ident
GlobPattern   ::= StringLit
ConfigObj     ::= "{" (Ident ":" Expr ("," Ident ":" Expr)*)? "}"
```

**Lexical note.** `class-a`/`class-b`/`in-process` are hyphenated terminals legal only inside the manifest blocks (they are not added to the general keyword catalog and so cannot shadow identifiers in `.pts`/`.pui`). The manifest surface is *closed*: any top-level form not in `ManifestItem` is an error (`only manifest blocks are legal in a .para file`).

**Static semantics.** The manifest is loaded once per workspace (resolution: nearest `*.para` walking up from each source file; exactly one manifest may be in scope per file — two in-scope manifests is an error). `spine { … }` defines the **closed set** of files whose `schema` declarations form the spine; a `schema` declared *outside* the spine globs is a compile error (`schema declared outside spine; add its file to spine{} or move it`), discharging the I3 "set of spine files is itself accounted for" gap. `authority { S => class-a }` binds a reconciliation class to a schema at compile time (today this is implicit/runtime); `class-b` **requires** an explicit `FieldList` (the grammar makes the field list non-optional), enforcing the "multi-writer merge is never ambient" rule of [→ ch:data-sync-and-authority] and discharging falsification criterion §6.4. Every `SchemaRef` must resolve to a `schema` *inside* the declared spine (forward reference to §5.1's own closure). Exactly one `transport` is permitted.

**Dynamic semantics / desugar.** The manifest is erased to a config module evaluated once at process start; it introduces no per-file runtime cost.

```
# Desugar (proposed):  .para manifest
Para (app.para):
    spine { "src/schema/**.pts"; }
    authority { Cart => class-b { items }; User => class-a; }
    transport nats { url: "nats://bus:4222" };
TS (.para.config.ts):
    import { configureSynced } from "@lyku/para-sync";
    export const __paraSpine = ["src/schema/**.pts"];
    export const __paraAuthority = { Cart: { class: "B", fields: ["items"] },
                                     User: { class: "A" } };
    configureSynced({ transport: { kind: "nats", url: "nats://bus:4222" } });
```

**Interaction.** The manifest is the single input that closes three otherwise-ambient facts: the spine file set (I3), the authority class per schema (sync), and the transport (sync). A `sync NAME :: S from KEY` declaration in any `.pui`/source position is type-checked against `__paraAuthority[S]`: a `class-b` replica whose component performs a local write to a field *not* in the declared `FieldList` is a compile error (`field 'price' is not a class-b merge field of Cart; only {items} may be locally written`). This is how the manifest's authority model reaches the per-component sync surface without runtime configuration.

**Example.**

```para
// app.para — one declared place for spine + authority + transport
spine {
  "src/schema/**.pts";
  "src/models/*.pts";
}
authority {
  Document => class-b { body, title };   // multi-writer merge fields explicit
  Presence => class-a;
}
transport nats { url: "nats://localhost:4222", subjectOf: "synced.${key}" };
```

```para
// ✗ counter-example
authority {
  Document => class-b;   // ✗ error: class-b requires an explicit { field, … } list
  Order    => class-a;   // ✗ error if Order's file is not matched by any spine{} glob
}
```

### 5.2 `#![strict-totality]` per-file pragma — machine-checkable no-`any` mode  `Proposed`

**Rationale.** I3 forbids silent `any`/`as` escapes, but the host TypeScript surface *permits* them everywhere. A per-file pragma lets a `.pts` file opt into a mode where the I3 boundary is a **compile error**, not a discipline — making "no silent `any`" verifiable per-file (discharges A5/A2 mechanically at the file granularity).

**Grammar (lexical).** A pragma is a line comment of a reserved shape at the *top of file* (before any non-comment token):

```
Pragma     ::= "//" "#![" PragmaName PragmaArg? "]"
PragmaName ::= "strict-totality" | …
PragmaArg  ::= ":" Ident
```

**Lexical note.** The `//#![…]` form is chosen so the pragma is a no-op comment in plain TS tooling (a `.pts` lowered without the Para checker still type-checks) — the pragma is *additive*, glass-floor-safe. Multiple pragmas may stack (one per line) at the top of file; the first non-comment, non-pragma token ends the pragma zone, and a `//#![…]` after that point is an ordinary comment (a warning is emitted: `pragma after first token is ignored; move to top of file`).

**Static semantics.** Under `strict-totality`, within the file: (1) an explicit `any` type annotation is an error; (2) an `as` cast that is not `as const` is an error; (3) any value reaching a module boundary (export, handler return, sync cell) without a schema-derived type is an error (`value crosses boundary without a schema type; annotate with a schema or Infer<typeof S>`). The pragma changes *no runtime behavior*. Inference of `any` (e.g. an untyped `JSON.parse`) at a boundary is also an error under (3); inside a function body, an inferred `any` that never crosses a boundary is permitted (the gate is at boundaries, not everywhere, so the mode stays usable).

**Dynamic semantics / desugar.** None — the pragma is erased; it only gates the checker.

```
# Desugar (proposed):  strict-totality pragma
Para:
    //#![strict-totality]
    export fun load(): User { return db.query() as User; }   // ✗ error: `as` cast forbidden under strict-totality
TS:
    // (pragma erased)
    export function load(): User { return db.query() as User; }   // would compile in plain TS — the pragma is the gate
```

**Interaction.** `strict-totality` composes with `::` and `is`: the *sanctioned* way to satisfy gate (3) is to pass an `unknown` through `S.parse(...)` / `x is S` rather than `as S`, so the pragma actively steers code toward the parse-gate discipline [→ ch:errors-results-and-validation]. It also composes with the §5.3 capability matrix: a `server`-tagged file under `strict-totality` that returns a value to a `client`-reachable boundary must return a schema-typed value, closing the A4 (typed-auth-context) hole at the file granularity.

**Example.**

```pts
//#![strict-totality]
// .pts — this file is now machine-checked free of any/as escapes
schema Order { id: UUID, total: int }

export fun parse(raw: unknown): Order {
  const r = Order.parse(raw);
  if (r.tag === "Err") throw new Error(r.error);
  return r.value;                       // ok: type flows from the schema
  // return raw as Order;               // ✗ error: `as` cast forbidden under strict-totality
}
```

### 5.3 `surface { … }` capability matrix — legal-construct-per-surface as a compile error  `Proposed`

**Rationale.** Some constructs are only meaningful on one surface (`prop`/`provide`/`inject`/inline-snippet are `.pui`-only; `source`/`async signal`/`using`/`sync` auto-dispose on *component* unmount and have no meaning in a plain `.pts` module; server-only handlers must not ship to the client bundle). Today misuse degrades to a confusing host-level error or silently mis-lowers. A declared **capability matrix** turns cross-surface misuse into a precise compile error, and declares the `server` / `client` / `shared` split that the projection/bundle model relies on.

**Grammar.**

```
SurfaceDecl   ::= "surface" Capability "{" ConstructList "}"
Capability    ::= "pts" | "pui" | "server" | "client" | "shared"
ConstructList ::= (ConstructName ";")*
ConstructName ::= Ident          ⟨a keyword id from language-surface.ts⟩
```

These declarations live in the `.para` manifest (§5.1). A construct may appear under multiple capabilities (e.g. `signal` is `shared`).

**Static semantics.** For each construct use, the checker computes the using file's capability set from its extension (`*.pui ⊇ {pui}`, `*.pts`-family `⊇ {pts}`) and its `server`/`client`/`shared` tag (from filename convention — e.g. `*.server.pts` ⊇ `{server}`, `*.client.pts`/`.pui` ⊇ `{client}` — or a §5.2-style pragma `//#![surface:server]`; absent any tag, a file is `shared`). A use whose construct is *not* listed under any capability the file holds is an error: `'prop' is a .pui-only construct, used in a .pts file` or `'parabun:gpio' is server-only, reachable from a client bundle`. This is the surface-level enforcement of I2 (view-only constructs cannot leak into the spine) and a load-bearing input to the bundle-split: a `client`-capability file may not (transitively) import a `server`-only construct, and the build uses the matrix to prove the client bundle excludes server-only modules. The matrix is **closed**: a construct id not appearing under *any* `surface { }` block is `shared` by default, so the matrix only needs to list the *restricted* constructs.

**Dynamic semantics / desugar.** None at the matrix level — `surface { }` blocks are erased with the rest of the manifest (§5.1). Their only effect is on the checker and on bundle-split decisions in the build [→ ch:modules-projections-and-build].

```
# Desugar (proposed):  surface capability matrix
Para (app.para):
    surface pui    { prop; provide; inject; }
    surface server { parabun:gpio; parabun:i2c; }
    surface shared { signal; derived; effect; schema; sync; }
TS (.para.config.ts):
    export const __paraSurface = {
      pui:    ["prop", "provide", "inject"],
      server: ["parabun:gpio", "parabun:i2c"],
      shared: ["signal", "derived", "effect", "schema", "sync"],
    };   // consumed by the checker + bundle splitter; no runtime effect
```

**Interaction.** The matrix is the static counterpart to the manifest's authority model: where §5.1 says *which schema is server-authoritative*, §5.3 says *which constructs may run where*. Together they discharge A4's structural risk — a `server`-only auth/middleware construct physically cannot be referenced from a `client` file, so the typed-auth-context can never leak to (or be forged on) the client, and the leak that historically forced an `any` is a compile error instead. It composes with §5.2: under `strict-totality`, a `client` file importing a `server`-only symbol is a hard error rather than a tree-shaking accident.

**Example.**

```para
// app.para
surface pui    { prop; provide; inject; snippet; }
surface server { parabun:gpio; parabun:i2c; parabun:spi; }
surface shared { signal; derived; effect; schema; sync; synced; source; }
```

```pts
// notify.client.pts  (capability set {pts, client})
import { readPin } from "parabun:gpio";   // ✗ error: 'parabun:gpio' is server-only, reachable from a client bundle
```

```pts
// helper.pts  (capability set {pts, shared})
prop title: string;   // ✗ error: 'prop' is a .pui-only construct, used in a .pts file
```

### 5.4 `project NAME { … }` projection-target declaration — name the outputs once  `Proposed`

**Rationale.** The projection generators (db model, api routes, typed client, wire codec, sync reconciler) are invoked today by convention and scattered config [→ ch:modules-projections-and-build]. I1 says every projection must be readable and ejectable per-site, but there is no *declared* place that says *which* projections a workspace emits, *where*, and *which are ejected* (overridden by hand). A `project` block in the manifest names each target's output path and ejection status, making the projection set itself a modeled, diffable fact (the I1/I3 closure for the codegen surface).

**Grammar.**

```
ProjectDecl    ::= "project" Ident "{" ProjectionList "}"
ProjectionList ::= (Projection ";")*
Projection     ::= Target "->" OutSpec EjectFlag?
Target         ::= "db" | "api" | "client" | "codec" | "reconciler" | "migrations"
OutSpec        ::= StringLit                       ⟨output path or glob⟩
EjectFlag      ::= "ejected"                        ⟨this target is hand-overridden; regen must not touch it⟩
```

**Lexical note.** `db`/`api`/`client`/`codec`/`reconciler`/`migrations` are manifest-local terminals (not in the general catalog). `ejected` is a trailing modifier, legal only after an `OutSpec`.

**Static semantics.** Each `project` block names a *projection profile* (multiple are allowed, e.g. a `web` profile and an `edge` profile differing in `client` output). Each `Projection` binds a `Target` to an `OutSpec`. A target marked `ejected` asserts the output at `OutSpec` is hand-maintained: the build **reads** it (for type-checking and the I1 diff) but **never regenerates** it — and a regen that *would* change an ejected file is a compile error (`projection 'client' is ejected at ./gen/client.ts but regen produced a different result; un-eject or reconcile`). This makes the I1 boundary/logic split (§2.1) *declared* rather than conventional: an ejected projection is exactly "an opinion you outgrew and overrode," and the manifest records it. A `Target` may appear at most once per profile. Every `db`/`migrations` target is checked against the live-DB diff (A5) when a connection is configured; drift is a compile error (I3).

**Dynamic semantics / desugar.** Erased to a build-config export; no runtime effect.

```
# Desugar (proposed):  project block
Para (app.para):
    project web {
      db         -> "drizzle/schema.ts";
      api        -> "src/gen/routes/**";
      client     -> "src/gen/client.ts" ejected;   // hand-overridden
      codec      -> "src/gen/codec.ts";
      reconciler -> "src/gen/reconcile.ts";
    }
TS (.para.config.ts):
    export const __paraProjects = { web: {
      db:         { out: "drizzle/schema.ts",   ejected: false },
      api:        { out: "src/gen/routes/**",    ejected: false },
      client:     { out: "src/gen/client.ts",    ejected: true  },
      codec:      { out: "src/gen/codec.ts",     ejected: false },
      reconciler: { out: "src/gen/reconcile.ts", ejected: false },
    }};
```

**Interaction.** `project` closes the last ambient fact the manifest leaves open: §5.1 names the spine and authority, §5.3 names where constructs may run, and §5.4 names what the spine *projects into* and what has been ejected. Together the three make the entire schema-is-the-application loop — spine → projections → ejections — a single diffable manifest, which is precisely the falsifiability surface `schema-is-the-application.md` demands (§6 criteria 2/3/7 become mechanically checkable against this block). It composes with §5.2: a `strict-totality` workspace whose `codec` projection cannot be schema-derived (an `unpack() as …` survives) is a per-target compile error, discharging A1/§6.6 at the projection granularity.

**Example.**

```para
// app.para
project edge {
  db         -> "drizzle/schema.ts";
  api        -> "src/gen/routes/**";
  client     -> "src/gen/edge-client.ts";   // different client than `web` profile
  codec      -> "src/gen/codec.ts";
  reconciler -> "src/gen/reconcile.ts" ejected;   // custom conflict policy, hand-owned
}
```

```para
// ✗ counter-example
project web {
  db  -> "drizzle/schema.ts";
  db  -> "other.ts";          // ✗ error: target 'db' declared twice in profile 'web'
  api -> "src/gen/routes/**";
}
```

### 5.5 `view NAME` substrate binding — make the renderer swap (I2) a declared, checkable seam  `Proposed`

**Rationale.** I2's north star is a renderer swap that leaves the spine untouched, but *which* substrate `.pui` lowers into is currently hardwired (forked Svelte). For I2 to be a checkable invariant rather than an aspiration, the substrate must be a **named, declared binding** so (a) a workspace can target an alternate renderer, and (b) the checker can prove the spine never depends on substrate specifics. This makes the single most load-bearing falsification criterion (§6.5 — "the spine cannot be expressed without reaching into the Svelte fork") mechanically testable.

**Grammar.**

```
ViewDecl   ::= "view" SubstrateId BindBlock?
SubstrateId ::= "svelte5" | "solid" | "custom" ":" StringLit   ⟨module providing the runes-equivalent bridge⟩
BindBlock  ::= "{" (RuneBind ";")* "}"
RuneBind   ::= ParaPrimitive "=>" StringLit     ⟨how a Para reactive keyword maps into the substrate⟩
ParaPrimitive ::= "signal" | "derived" | "effect" | "prop" | "lifecycle"
```

`view` lives in the `.para` manifest (§5.1). Exactly one `view` may be declared per workspace.

**Lexical note.** `svelte5`/`solid`/`custom` are manifest-local substrate identifiers. The `=>` in a `RuneBind` maps a Para primitive name to a substrate-side helper name (a string, since the substrate's API lives in another module); it is distinct from the `=>` in `AuthorityRule` only by context (manifest blocks are non-overlapping).

**Static semantics.** The `view` binding selects the `.pui` reactivity-lowering target (step 3 of §4.2). With the default `view svelte5` the lowering is exactly the shipped runes bridge. A non-default substrate must supply a `BindBlock` naming the substrate-side equivalents of `signal`/`derived`/`effect`/`prop`/`lifecycle`; the checker verifies each Para primitive `.pui` uses has a binding (an unbound primitive used in a `.pui` file is an error: `'derived' has no binding under view 'solid'; add a RuneBind or remove the usage`). Critically, **`view` may only rebind view primitives** — `schema`/`sync`/`synced`/`::`/`is` are spine and have **no** `RuneBind` form; an attempt to bind one is an error (`'sync' is spine, not view; it cannot be rebound by a substrate (I2)`). That prohibition *is* the mechanical statement of I2: the set of rebindable primitives is exactly the swappable view, and the spine is provably outside it.

**Dynamic semantics / desugar.** The `view` block selects which bridge module the `.pui` lowering imports; it has no runtime cost of its own. Under a non-default substrate, the `# Desugar:` of every `.pui` reactive construct retargets its emitted helper (e.g. `$state(x)` becomes the bound `createSignal(x)` form) while the *spine* lowering (schema, sync) is byte-identical to the default — the proof obligation that the spine survives the swap.

```
# Desugar (proposed):  view substrate binding
Para (app.para):
    view solid {
      signal => "createSignal";
      derived => "createMemo";
      effect => "createEffect";
      prop => "mergeProps";
      lifecycle => "onCleanup";
    }
.pui source:
    signal count = 0;
Runes (default view svelte5):
    let count = $state(0);
Substrate (view solid):
    const [count, set_count] = createSignal(0);   // from the bound module; spine lowering unchanged
```

**Interaction.** `view` is the manifest counterpart to INV-overview-5 (acyclic stratification): the DAG guarantees the spine *can* be swapped, and `view` is *where the swap is declared and checked*. It composes with §5.3 — the capability matrix's `pui` set is precisely the set of primitives a `view` binding may rebind; a primitive that is `pui` in §5.3 must have a `RuneBind` under a non-default `view`, and a primitive that is `shared`/`server` must not. The two declarations are consistency-checked against each other at manifest load (`primitive 'effect' is rebindable (pui) but bound nowhere under view 'solid'`). This is the strongest available discharge of §6.5: a spine construct that *could* only be expressed by reaching into the substrate would have to appear in a `RuneBind`, which the checker forbids.

**Example.**

```para
// app.para — declare the substrate; default is svelte5 and needs no BindBlock
view svelte5;
```

```para
// app.para — an experimental Solid substrate, spine untouched (I2 proof)
view custom: "@acme/para-solid-bridge" {
  signal    => "createSignal";
  derived   => "createMemo";
  effect    => "createEffect";
  prop      => "mergeProps";
  lifecycle => "onCleanup";
  // sync => "..."   // ✗ error: 'sync' is spine, not view; it cannot be rebound by a substrate (I2)
}
```

