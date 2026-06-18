---
title: "The Para Language Specification"
description: "The first formal specification of the Para language — .pts and .pui, existing surface plus proposed new surface."
sidebar:
  order: 0
---

*A full-stack reactive language family in which the schema is the application.*

**Status:** Working draft. **Spec layer:** Para (the language). **Reference implementation:** ParaBun (canonical Rust parser + JS-mirror; see `[→ ch:tooling-diagnostics-and-conformance]`). Where a ParaBun lowering is cited it is *evidence of feasibility*, never the boundary of what Para may specify.

---

## 0. Preamble — what Para is

Para is a full-stack reactive language *family* in which **the schema is the application**. A program is not a stack you assemble (DB + API + client + validation + transport + live state) but a **single declared model plus the deliberately-written deltas** around it. Table migrations, route contracts, the typed client, boundary validation, the wire codec, and client⇄server state sync are all **projections** of one schema spine.

Two surfaces carry the language:

- **`.pts`** — a TypeScript superset (also `.ptsx` / `.pjs` / `.pjsx`). Logic, schema, server handles, reactivity outside the view.
- **`.pui`** — a Svelte-5 superset for components. Para reactivity bridged into runes, plus the full Svelte-5 template.

Both are **strict supersets**: any valid host file is a valid Para file whose lowering is a fixed point (`INV-overview-4`).

### The five things Para optimizes for

1. **One spine, many projections.** A `schema` is the sole source of truth; the language makes that source small, legible, and total, then makes every projection readable and ejectable. The *correct* path (model everything, derive everything) is the *easy* path — legibility is treated as a correctness property.

2. **The glass floor (I1).** Every projection and every desugaring lowers to **plain, readable, ejectable code** — Para→TS, `.pui`→runes, schema→readable migration/handler/reconciler. Outgrowing an opinion means *reading the lowering and overriding that one projection*, never rewriting the application. If a generated artifact cannot be opened, read, and overridden per-site, it does not ship.

3. **Spine at the Para layer, not the view (I2).** Reactivity, schema, sync, and native are substrate-independent core; the view (`.pui`'s forked-Svelte renderer today) is the swappable thing. Every decision must survive a renderer swap with the spine untouched — which is why signals are Para-native primitives *bridged into* runes, not runes wearing Para names.

4. **Totality without silent `any` (I3).** All data is accounted for end-to-end (db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state). Any gap is *explicit and visible* — never a silent `any`, an unmodeled blob, an `as`-cast, or a path of least resistance that degrades typing. The mechanical anchor: the model is **diffable against the live database**; drift is a compile error.

5. **Errors are values; effects are explicit.** Validation returns `Result<T,E>`, not exceptions. Reactivity is a tracked graph with explicit cleanup (`defer` / `return cleanup` / `onDestroy`), never implicit magic. Purity is a declared, checkable contract. Concurrency (`parallel`, `async signal`, the error-chain operators) is composed, not hidden.

### The coherence

The four pillars are **one idea viewed from four distances**:

- A **schema** describes the *shape and constraints* of a value at rest.
- A **signal** describes that value *changing over time* in one process.
- **Sync** describes that value *changing over time across a trust boundary* — the same reconcile-by-`(schema_version, sequence)` machine the schema's wire codec already projects.
- A **native/AI source** describes that value *changing over time driven by the outside world*, surfaced through the identical `peek/subscribe/dispose` source convention.

So a synced entity, a derived computation, a microphone level, and an LLM token stream are all the **same reactive value** to component code. The unifying convention is the **source contract** downstream and the **schema spine** upstream. That is Para's defensible identity: not a nicer reactive view layer (runes already won that), but a language where the *spine* — model, validation, sync, lifecycle — is generated, total, and ejectable, and reactivity is the universal verb tying rest-shape to over-time-shape.

---

## 1. Notation conventions (normative — used by every chapter)

### 1.1 Grammar (EBNF-ish)

```
Signal   ::= "signal" Ident TypeAnn? "=" Expr Interval? ";"
Interval ::= "every" Expr
TypeAnn  ::= ":" Type
```

- `"literal"` — terminal keyword/punctuation, verbatim source.
- `Ident`, `Expr`, `Type`, `Block`, `Pattern` — shared nonterminals (PascalCase); never redefined per chapter.
- `?` optional, `*` zero-or-more, `+` one-or-more, `|` alternation, `( )` grouping.
- `⟨note⟩` — angle-bracketed prose for a constraint the grammar cannot express.
- **Lexical note** sub-blocks call out whitespace/position-sensitive rules (statement-position keyword detection, postfix `every`, `..` vs number-then-property), since Para's surface is parser-sensitive.
- When a form is **sugar**, the grammar names the canonical form it expands to.

### 1.2 Desugaring blocks

Every construct shows its lowering as a labeled block. The TS side is the **glass-floor output** (I1) — the readable code a developer could have written by hand.

```
# Desugar:  signal NAME = EXPR
Para:  signal count = 0;
TS:    const count = signal(0);            // @lyku/para-signals
```

Synthetic names use the implementation's real prefixes so examples are copy-accurate: `__sig_`, `__syn_`, `__src_`, `__as_`, `__pm` (match subject), `__pcv` (chain value), `__pu` (underscore lambda), `__pb0..` (parallel), `__paraDefer0`. `.pui` lowerings target **runes** and show the full bridge (`$state` + `$effect.pre` + `onDestroy`) when escape analysis requires it, with the inlined `$state`-only form noted as the alternative. Net-new surface is marked `# Desugar (proposed):`.

### 1.3 Static vs dynamic semantics

Each construct documents semantics under two fixed headers:

- **Static semantics** — binding structure, type inference (`signal<T>`, `Infer<typeof X>`), totality/exhaustiveness obligations, purity/escape analysis, what is a compile error.
- **Dynamic semantics** — evaluation order, dependency tracking, subscription/notification, batching/drain, cleanup ordering (LIFO vs FIFO, stated explicitly), reconcile transitions, error propagation. Ordering is written as a numbered transition list.

**Invariants** call-outs are labeled `I1`–`I3` (global) or `INV-<chap>-n` (local). **Edge cases** sub-blocks cover corner behaviors (empty-subs guard, stale-echo suppression, `is` vs type-predicate ambiguity, `1.method()` vs range).

### 1.4 Examples & status

Examples are fenced by surface (`pts` / `pui` / `ptsx` / `pjs` / `pjsx`), minimal and runnable-in-spirit. Counter-examples are marked `// ✗` with the diagnostic in a comment. Cross-references read `[→ ch:reactivity-core]`. Each construct carries a **Status** tag:

- **Shipped** — in ParaBun / para-preprocess today.
- **Partial** — literal-only or stubbed (e.g. `match` non-literal patterns).
- **Proposed** — net-new surface this spec introduces (always paired with a desugaring sketch to stay glass-floor-compatible).

Anti-requirements (`A1`–`A5`) and falsification criteria from `schema-is-the-application.md` are cited by tag where a construct discharges one.

---

## 2. Table of contents

| # | Chapter (`id`) | One line |
|---|---|---|
| 01 | [overview-and-surfaces](01-overview-and-surfaces.md) | The map: the two surfaces, file dispatch, the spine-and-deltas application model, and the Para↔ParaBun (spec vs implementation) relationship. |
| 02 | [lexical-and-expression-syntax](02-lexical-and-expression-syntax.md) | The token layer and surface-wide expression operators: `\|>`, `..> / ..! / ..&`, `.. / ..=`, `Nd` decimals, the `_` lambda placeholder, leading-dot shorthand, and lexical disambiguation. |
| 03 | [type-and-schema-system](03-type-and-schema-system.md) | The heart: all six `schema` forms, constraint brands, refinement types, primitive aliases, the JSON-Schema 2020-12 body, `Infer`/`SchemaValue`/`Handles<M>` — the single source every projection derives from. |
| 04 | [reactivity-core](04-reactivity-core.md) | The Para-native synchronous reactive core: `signal`/`derived`/`effect`, the `~>` and `->` binding operators, `batch`/`untrack`, and the dependency graph (drain, empty-subs guard, dynamic re-subscription). |
| 05 | [effects-lifecycle-concurrency](05-effects-lifecycle-concurrency.md) | Time- and scope-oriented control: edge-triggered `when`/`when not`/`when start/stop`, `defer` LIFO cleanup, `arena` DeferGC scopes, `parallel`/`para` fan-out, `memo`/`memo async`, and the `resource()` lifecycle. |
| 06 | [pui-component-model](06-pui-component-model.md) | The `.pui` surface as a Svelte-5 superset: `prop` and the `$props()` model, the signal→runes bridge (escape analysis, `$effect.pre`, HMR), `provide`/`inject`, snippet sugar, and full template support. |
| 07 | [sources-async-and-native](07-sources-async-and-native.md) | The outside-world pillar: the source convention, `source`/`async signal`/`using`, `promiseSignal` and the `from*` adapters, `throttled`/`debounced`, and the `parabun:*` native/AI module family surfaced reactively. |
| 08 | [data-sync-and-authority](08-data-sync-and-authority.md) | The trust-boundary pillar: `sync`/`synced`, `SyncEnvelope` and the `(schema_version, sequence)` reconciler, transports, Tier-1 read guarantees, Class-A vs Class-B reconciliation, visibility projection, the version-stamped cache. The highest-risk surface. |
| 09 | [errors-results-and-validation](09-errors-results-and-validation.md) | Errors-as-values end-to-end: `Result<T,E>`/`Option<T>`, `Ok`/`Err`/`Some`/`None`, `match` over tagged unions, the `::` boundary gate, `is`/`is not` parse-gate narrowing, and how parse failures flow through sync (skew, never poison). |
| 10 | [purity-and-determinism](10-purity-and-determinism.md) | The purity contract: `pure fun` / `pure async` / `pure arrow`, what referential transparency obligates, the parse-time checks the marker enables, and the purity↔`memo` cacheability relationship. |
| 11 | [modules-projections-and-build](11-modules-projections-and-build.md) | How the spine becomes running code: module/import semantics, the projection generators (DB/migrations, routes, typed client, handles, wire codec, reconciler) as ejectable output, the boundary/logic split, and the build pipeline. |
| 12 | [tooling-diagnostics-and-conformance](12-tooling-diagnostics-and-conformance.md) | The spec's contract with editors and implementations: LSP sourcemap composition, diagnostic standards, semantic highlighting from the keyword catalog, and a conformance notion validating ParaBun and future implementations against the spec. |
| A | [Frontier / Proposed Directions](#) | The forward vision — `transaction`, `history`, `transition`/`lane`, `stream`, `motion`, keyed `each`, state-machine schemas, `where`/relations/`authority`/`evolves`, and the type-visible reconciler laws. |
| B | [Grammar Appendix](#) | Every keyword, operator, and type — current and proposed — in one EBNF-style reference. |

---

## 3. How to read this spec

- **Start at chapter 01** for the surface map, then **03 (schema)** — every later chapter relates back to the schema spine. Reactivity (04) and sync (08) are the two halves of "value changing over time"; read them as a pair.
- **EXISTING vs PROPOSED.** The chapters 01–12 specify the language as it stands, tagged `Shipped` / `Partial` per construct. Net-new surface is tagged `Proposed` and always carries a desugaring sketch. The **Frontier chapter (A)** is *entirely* proposed: a coherent forward vision, not yet in any parser. The **Grammar Appendix (B)** marks every production `[current]` or `[proposed]` so you can read the present-tense language by filtering to `[current]`.
- **The glass floor is the reading aid.** When a construct confuses, read its `# Desugar:` block — the TS/runes output is, by I1, code you could have written by hand. If a lowering ever fails to be readable, that is a spec bug, not a you bug.
- **ParaBun is evidence, not law.** Citations to `src/js_parser/parse/*`, `para-signals`, or `para-sync` show feasibility. The spec governs Para; an implementation conforms by chapter 12's conformance notion, not by matching ParaBun byte-for-byte.

---

## Front matter & appendices

- [Design Principles & Notation](00-design-principles-and-notation.md) — read first
- [Appendix A — Frontier / Proposed Directions](90-frontier-proposed-directions.md)
- [Appendix B — Consolidated Grammar Reference](95-grammar-appendix.md)
- [Chapter Manifest](MANIFEST.md) · [Idea Pool](_ideas-pool.md)

