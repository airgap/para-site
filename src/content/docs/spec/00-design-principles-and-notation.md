---
title: "Para Spec — Design Principles & Notation"
description: "Para Spec — Design Principles & Notation"
sidebar:
  order: 1
---

## Para — Design Philosophy (Spec Preamble)

Para is a full-stack reactive language *family* in which **the schema is the application**. A program is not a stack you assemble (DB + API + client + validation + transport + live state) but a **single declared model plus the deliberately-written deltas** around it. Everything else — table migrations, route contracts, the typed client, boundary validation, the wire codec, and client⇄server state sync — is a **projection** of that one schema spine. Para defines the spec; ParaBun is one implementation. The spec is written for the language, not for any one transpiler — where ParaBun lowerings are cited, they are *evidence of feasibility*, not the boundary of what Para may specify.

### What Para optimizes for

1. **One spine, many projections.** A `schema` is the sole source of truth. The language's job is to make that source small, legible, and total, then to make every projection of it readable and ejectable. The aesthetic goal is that the *correct* path (model everything, derive everything) is the *easy* path — legibility is treated as a correctness property (a model so heavy teams ignore it has lost totality socially even if it holds formally).

2. **The glass floor (I1).** Every projection and every desugaring lowers to **plain, readable, ejectable code** — Para→TS, `.pui`→runes, schema→readable migration/handler/reconciler. "Opinionated about the model and the projections; never opaque about the output." Outgrowing an opinion means *reading the lowering and overriding that one projection* — never rewriting the application. If a generated artifact cannot be opened, read, and overridden per-site, it does not ship. This is the load-bearing constraint that distinguishes Para from magical fullstack reactive systems (Meteor) and from lossy codegen (which degrades teams to `any`).

3. **Spine at the Para layer, not the view (I2).** Reactivity, schema, sync, and native are **substrate-independent core**. The view (`.pui`'s forked-Svelte renderer today) is the swappable thing; the data/sync spine is the durable thing. Every design decision must survive a renderer swap with the spine untouched. This is why signals are Para-native primitives bridged *into* runes, not runes wearing Para names.

4. **Totality without silent `any` (I3).** All data is accounted for end-to-end (db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state). Any gap is *explicit and visible* — never a silent `any`, an unmodeled blob, an `as`-cast escape hatch, or a path of least resistance that degrades typing. The mechanical anchor: the model is **diffable against the live database**, so "accounted for" is verifiable, not aspirational. Drift is a compile error.

5. **Errors are values; effects are explicit.** Validation returns `Result<T,E>`, not exceptions. Reactivity is a tracked graph with explicit, traceable lowerings and explicit cleanup (`return cleanup` / `onDestroy` / `defer`), never implicit magic. Purity is a declared, checkable contract. Concurrency (`parallel`, `async signal`, the error-chain operators) is composed, not hidden.

### The coherence — what unifies signals + schema-spine + sync + native

The four pillars are **one idea viewed from four distances**:

- A **schema** describes the *shape and constraints* of a value at rest.
- A **signal** describes that value *changing over time* in one process.
- **Sync** describes that value *changing over time across a trust boundary* (the same reconcile-by-(schema_version, sequence) machine the schema's wire codec already projects).
- A **native/AI source** describes that value *changing over time driven by the outside world* (sensor, model, stream), surfaced through the identical `peek/subscribe/dispose` source convention.

So a synced entity, a derived computation, a microphone level, and an LLM token stream are all the **same reactive value** to component code — it reads and writes a value; the projection chosen by the schema and authority model handles transport, validation, and lifecycle. The unifying convention is the **source contract** (`peek/subscribe/dispose`) downstream and the **schema spine** upstream. That is Para's defensible identity: not "a nicer reactive view layer" (runes already won that), but a language where the *spine* — model, validation, sync, lifecycle — is generated, total, and ejectable, and where reactivity is the universal verb tying rest-shape to over-time-shape.

### The aesthetic

Small surface, postfix and operator sugar that reads as English (`when`, `defer`, `is`, `every`, `parallel`), exact-by-default arithmetic where it matters (`d` decimals), and a hard refusal of opacity. Para would rather expose a readable lowering than hide a convenience. Every keyword has a traceable desugaring; every projection has a glass floor; every boundary has a parse gate; no escape to `any`.


---

## Spec Notation Conventions (used by every chapter)

These conventions are normative. Every chapter MUST use them so the spec reads as one document.

### 1. Grammar (EBNF-ish)

Grammar productions use a lightweight EBNF:

```
Signal        ::= "signal" Ident TypeAnn? "=" Expr Interval? ";"
Interval      ::= "every" Expr
TypeAnn       ::= ":" Type
```

- `"literal"` — terminal keyword/punctuation, verbatim source.
- `Ident`, `Expr`, `Type`, `Block`, `Pattern` — nonterminals (PascalCase). Reuse shared nonterminals; do not redefine `Expr`/`Type` per chapter.
- `?` optional, `*` zero-or-more, `+` one-or-more, `|` alternation, `( )` grouping.
- `⟨note⟩` — angle-bracketed prose for a constraint the grammar cannot express (e.g. `⟨Ident must be capitalized⟩`).
- Lexical/whitespace-sensitive rules (statement-position disambiguation, postfix `every`, `..` vs number-then-property) are called out in a **Lexical note** sub-block, since Para's surface is regex/parser-sensitive.

When a surface form is **sugar**, give the grammar for the sugar AND name the canonical form it expands to.

### 2. Desugaring blocks (Para → TS / Para → runes)

Every construct shows its lowering as a labeled, side-by-side block. The TS side is the **glass-floor output** (I1) — it must be the readable code a developer could have written by hand.

```
# Desugar:  signal NAME = EXPR
Para:
    signal count = 0;
TS:
    const count = signal(0);            // @lyku/para-signals
```

Rules:
- Use `# Desugar:` header naming the surface form abstractly (METAVARS in CAPS: `NAME`, `EXPR`, `SCHEMA`, `KEY`, `BODY`).
- Synthetic names introduced by the lowering use the real prefixes from the implementation so examples are copy-accurate: `__sig_`, `__syn_`, `__src_`, `__as_`, `__pm` (match subject), `__pcv` (chain value), `__pu` (underscore lambda), `__pb0..` (parallel), `__paraDefer0`.
- `.pui` lowerings target **runes** and show the full bridge (`$state` + `$effect.pre` + `onDestroy`) when escape analysis requires it; show the inlined `$state`-only form as the alternative with a one-line note on when each applies.
- If `.pts` and `.pui` lower differently, show BOTH under `TS (.pts):` and `Runes (.pui):`.
- Where ParaBun is the canonical desugaring but the spec proposes new surface, mark the lowering `# Desugar (proposed):` so implementers know it is not yet in the parser.

### 3. Static vs dynamic semantics

Each construct documents semantics under two fixed headers:

- **Static semantics** — what holds at parse/compile/type-check time: binding structure, type inference (`signal<T>`, `Infer<typeof X>`), totality/exhaustiveness obligations, purity/escape analysis, what is a compile error. State type-level rules as judgements in prose (e.g. "`Infer<typeof User>` extracts `T` from `SchemaValue<T,S>`").
- **Dynamic semantics** — runtime behavior: evaluation order, dependency tracking, subscription/notification, batching/drain, cleanup ordering (LIFO vs FIFO — state which), reconcile state transitions, error propagation. When ordering matters, write it as a numbered transition list (the reconciler and signal-drain style).

Use **Invariants** call-outs (labeled I1–I3 for the global ones, or local `INV-<chap>-n`) and **Edge cases** sub-blocks for the corner behaviors (empty-subs guard, stale-echo suppression, `is` vs type-predicate ambiguity, `1.method()` vs range).

### 4. Examples

Examples are fenced and labeled by surface:

```pts
// .pts
schema User { id: UUID, email: Email, age: int }
fun handle(req:: User) { return req.email; }
```

```pui
<!-- .pui -->
<script lang="ts">
  sync user :: User from `user:${id}`;
</script>
{user.name}
```

- Tag fences `pts` / `pui` (and `ptsx`/`pjs`/`pjsx` where surface-relevant).
- Keep examples minimal and runnable-in-spirit; when an example demonstrates a lowering, pair it with its `# Desugar:` block.
- **Counter-examples** (things that are a compile error or anti-pattern) are marked `// ✗` with the diagnostic in a comment.

### 5. Cross-references & status

- Cross-reference other chapters as `[→ ch:reactivity-core]` using chapter `id`.
- Each construct carries a **Status** tag: `Shipped` (in ParaBun/preprocess today), `Partial` (literal-only / stubbed, e.g. `match` non-literal patterns), or `Proposed` (net-new surface this spec introduces). New-idea sections are always `Proposed` and must include a desugaring sketch so they remain glass-floor-compatible.
- Anti-requirements (A1–A5) and falsification criteria from `schema-is-the-application.md` are cited by tag where a construct discharges one.

