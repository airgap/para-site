---
title: ".pui Components: Props, Runes Bridge & Templates"
description: "The .pui surface as a Svelte-5 superset: prop declarations and the merged $props() model, the signal/derived/effect→runes bridge (escape analysis,…"
sidebar:
  order: 7
---

# Chapter: .pui Components — Props, the Runes Bridge & Templates

&gt; **Status of this chapter:** Mixed. The whole *existing* surface — `prop`, the `signal`/`derived`/`effect`→runes bridge (escaped vs inlined, `$effect.pre`, the HMR registry), `provide`/`inject`, `using`/`source`/`async signal` lifecycle injection, the sync-family component bindings (`sync`/`synced` — keyed, feed, scalar-query, and server-source forms — plus `presence`, `mutate`, and the query-derived `derived NAME :: SCHEMA = EXPR` [→ ch:sources-async-and-native §10.7, ch:data-sync-and-authority §13]), inline-snippet sugar, the full Svelte-5 template, lifecycle/nav auto-import, the sourcemap composition, and the LSP parity contract — is **Shipped** (`@lyku/para-preprocess` `lowerPuiReactivity` + `lowerParaMarkup`; `editors/lsp/pui-transform.ts`). Everything in *Proposed extensions* (§12) is **Proposed** (net-new surface, not in `language-surface.ts` or the preprocessor today).
&gt; **Cross-refs:** This chapter owns how Para reactivity and resources **project into a component** — the bridge, the lifecycle injection, the markup — and owns `provide`/`inject` + inline-snippet lifting outright. The underlying primitives are defined elsewhere and only *bridged* here: the in-process reactive core (`signal`/`derived`/`effect`/`~>`/`->`/`batch`/`untrack`) is [→ ch:reactivity-core]; resource-tied and async producers (`source`/`async signal`/`using`/`promiseSignal`/`from*`) are [→ ch:sources-async-and-native]; `sync`/`synced` reconcile & authority semantics are [→ ch:data-sync-and-authority] (this chapter shows only how those declarations *bind* in a component). The schema spine the component imports is [→ ch:type-and-schema-system]; `::`/`is` parse-gating is [→ ch:errors-results-and-validation]. The surface dispatch and `.pui` multi-pass ordering are [→ ch:overview-and-surfaces §4.2]; the sourcemap/LSP/parity machinery is detailed in [→ ch:tooling-diagnostics-and-conformance]. The view is the **swappable substrate** of **I2** — this chapter is the seam.

---

## 0. The view is the swappable thing (I2 in one chapter)

`.pts` lowers **Para→TS** — a flat, source-to-source transform whose output is the spine. `.pui` does that *and then one more thing the spine transform never does*: it bridges Para's reactive keywords into a **rendering substrate** (forked Svelte 5 runes today) so a template re-renders. That extra transform is the load-bearing claim of **I2**: reactivity, schema, sync, and native are substrate-independent *core*; the renderer is the *swappable* layer. The spine keywords keep their Para-native meaning and are merely **bridged into** runes — they are not runes wearing Para names [→ ch:overview-and-surfaces §1.2].

This chapter specifies the bridge precisely enough that it could be re-targeted (§12.6 makes the target a declared, checkable seam, and the `.para` `view` binding [→ ch:overview-and-surfaces §5.5] selects it). Three invariants frame it:

- **INV-pui-1 (bridge fidelity).** A Para reactive cell bridged into the substrate observes **every** write a `.pts` observer would. The default lowering keeps a real Para `signal` alongside the substrate `$state` cell and cross-subscribes them; the *inlined* form (a plain `$state`, no Para signal) is taken **only** when escape analysis proves no external Para observer exists (§2.3). Over-eager inlining is a correctness bug, never a perf tradeoff: the fallback is always the full bridge.
- **INV-pui-2 (one `$props()`, one settle).** A `.pui` component projects to a Svelte-5 component with **exactly one** `$props()` destructure (§1) and the substrate's render scheduling. Para's *core* settles synchronously [→ ch:reactivity-core INV-react-1]; the bridge schedules cross-system writes through `$effect.pre` so they land **before** the substrate's render effects read them — the template never observes a torn intermediate.
- **INV-pui-3 (glass floor, runes target).** Every form here lowers to **idiomatic runes** a Svelte-5 author could have written by hand: `$state`/`$derived`/`$derived.by`/`$effect`/`$effect.pre`/`$props`/`setContext`/`getContext`/`onDestroy` and standard `{#…}` blocks. No reflection, no `any`-degradation (I3). The synthetic names are stable and readable (`__sig_`, `__src_`, `__as_`, `__syn_`, `__para_attr_`).

&gt; **Surface gate (`.pui`-flavored by extension).** Inside a `.pui` file, a `<script>` whose `lang` is in `PUI_IMPLICIT_LANGS = { "", "ts", "typescript", "js", "javascript" }` is Para-lowered without an opt-in attribute; any other `lang` (`scss`, a foreign DSL) passes through verbatim [→ ch:overview-and-surfaces §1.2]. A reactive declaration in a `<script module>` block is a compile error (module scope has no instance to bind a `$state` cell or schedule `onDestroy` against). The pass order is normative — `markup → script → reactivity → TS-strip → Svelte` (§11, [→ ch:overview-and-surfaces §4.2]).

---

## 1. `prop` — the merged `$props()` model

A `.pui` component declares its inputs with `prop`. Svelte 5 accepts **exactly one** `$props()` call per component, so every `prop` declaration in the instance `<script>` is **collected and merged** into a single `let { … }: { … } = $props()` destructure emitted at the position of the first `prop` line; later `prop` lines are blanked (to plain empty lines) to preserve line numbering.

### Grammar

```
PropDecl      ::= "prop" Declarator ("," Declarator)* ";"?
Declarator    ::= Ident TypeAnn? ("=" Expr)?
TypeAnn       ::= ":" Type
```

- `Ident` — the prop name, destructured from `$props()`.
- `TypeAnn` — the prop's TS type. Absent, it defaults to `any` (the one place `.pui` admits an inferred `any`; the Proposed `strict-totality` pragma [→ ch:overview-and-surfaces §5.2] would forbid it).
- `Expr` — a default value. **Its presence is what makes the prop optional** (§1.2). One `prop` statement may carry several comma-separated declarators (`prop a: string = '', b = 3;`); each folds into the same merged destructure.

**Lexical note.** `prop` fires only as a line-leading declaration (`/^(\s*)prop\s+(.+?)\s*;?\s*$/` per `<script>` body). A value named `prop` (`obj.prop`, `const prop = …`) is not a declaration head and is untouched — superset closure [→ ch:overview-and-surfaces INV-overview-4]. `prop` is a **`.pui`-only** construct; in a `.pts` file it has no `$props()` to merge into (the Proposed capability matrix [→ ch:overview-and-surfaces §5.3] makes that misuse a compile error rather than a confusing host error).

### Static semantics

- **Binding structure.** All `prop` declarators across the instance `<script>` are gathered in source order into one destructure. The *destructure* part uses `NAME = DEFAULT` where a default is present and bare `NAME` otherwise; the *type* part uses `NAME?: TYPE` where a default is present and `NAME: TYPE` otherwise. This is the rule **optionality is derived from the presence of a default** — a prop with a default is `?:` in the props type (the parent may omit it), a prop without is required.
- **Type surface.** The merged type literal is the component's public prop contract. Because each `prop` carries a real TS type (or `any`), the contract is checkable by the host type-checker through the runes projection — a parent passing a wrong-typed prop is a host type error, not a silent `any` (I3). A `.pts` file may `import type` this shape across the surface boundary (it erases) but never the component's runtime [→ ch:overview-and-surfaces INV-overview-5].
- **One merge per component.** Multiple `prop` lines are not multiple `$props()` calls; the merge is the only shape the Svelte compiler accepts. Re-declaring a prop name is a host redeclaration error in the merged destructure.

### Dynamic semantics

Identical to a hand-written `$props()` destructure: props are read reactively (the substrate re-renders consumers when a parent passes a new value), defaults apply when the parent omits the prop, and the bindings are the substrate's prop cells (two-way `bind:` to a prop follows Svelte-5 rules, §7.3).

### Desugar

```
# Desugar:  prop NAME: T = DEFAULT  (merged)
.pui:
    prop id: string;
    prop count: number = 0;
    prop user :: User;                  // type via schema Infer (see note)
Runes (.pui):
    let { id, count = 0, user }: { id: string; count?: number; user: User } = $props();
```

- The line of the *first* `prop` becomes the merged `let { … } = $props();`. The `count = 0` declarator becomes `count?: number` in the type (default ⇒ optional); `id` and `user` (no default) stay required.
- A declarator's `Type` is whatever follows `:` up to `=` (or end); `parseDeclarator` splits name / type / default with operator-aware `=` scanning (so `=>`, `==`, `<=`, compound assignments inside a default expression are not mistaken for the declarator's `=`).

&gt; **Edge case (default expression containing `=`).** `prop label: string = cond ? "a=b" : "c"` parses correctly: the declarator's `=` is found by `declScan`, which rejects `=` preceded by an operator char or followed by `=`/`>`, and string/brace spans are not scanned. The default expression is emitted verbatim into the destructure.

&gt; **Note (`prop NAME :: SCHEMA`).** A `::`-typed prop is a *type-level* convenience: the prop's TS type is `Infer<typeof SCHEMA>` [→ ch:type-and-schema-system]. It does **not** inject a runtime parse gate — props arrive from the parent component *inside the same trust boundary*, so there is nothing to validate. Runtime parse-gating of inputs is for boundaries that cross trust: handler args (`::` in `.pts`), `sync` envelopes (§5), and the Proposed schema-driven form binding (§12.4). This keeps `::` meaning "parse-gate an untrusted value" everywhere it has runtime force.

---

## 2. The reactivity bridge: `signal`/`derived`/`effect` → runes

The keyword is identical to its `.pts` meaning [→ ch:reactivity-core]; only the **lowering target** differs. In `.pts`, `signal x = 0` becomes `const x = signal(0)` against `@lyku/para-signals`. In `.pui` it must drive the substrate's render graph, so it bridges to runes. The bridge has two shapes — a **full bridge** (a Para signal *plus* a `$state` cell, cross-subscribed) and an **inlined** form (a plain `$state`) — chosen per-name by escape analysis (§2.3).

### 2.1 `signal` — the bridge (escaped form)

```
# Desugar:  signal NAME = EXPR   (escaped — full bridge)
.pui:
    signal count = 0;
Runes (.pui):
    import { signal } from "@lyku/para-signals";
    const __sig_count = signal(0);
    let count = $state(__sig_count.peek());
    $effect.pre(() => __sig_count.subscribe((__v: typeof count) => { count = __v; }));
```

- A real Para `WritableSignal` (`__sig_count`) is constructed once with `EXPR`.
- A substrate `$state` cell (`count`) is seeded from `__sig_count.peek()` (a non-tracking read; the seed must not subscribe at module-eval).
- `$effect.pre` runs **before** the substrate's render effects (INV-pui-2): it calls the Para signal's `.subscribe`, which creates a *Para* effect that synchronously fires the callback on every `.set()`; the callback writes into the `$state` cell, which then drives the substrate the normal way. The unsubscribe returned by `.subscribe` is the `$effect.pre` teardown — it runs on component unmount, so the cross-system subscription cannot leak.
- The cross-system direction matters: a `.set()` from *outside* the component (external Para code holding `signalOf(count)`) lands in the `$state` cell via this subscription; a write *inside* the component is rewritten to `.set()` (§2.4) so it flows back out through the same signal. The two systems stay coherent — this is INV-pui-1.

### 2.2 `signal` — the inlined form

When the name **provably never escapes** the component (§2.3), the Para signal and its cross-subscribe effect are *deleted*; the cell is a plain `$state`:

```
# Desugar:  signal NAME = EXPR   (inlined — component-local)
.pui:
    signal count = 0;
Runes (.pui):
    let count = $state(0);
```

- No `@lyku/para-signals` import, no `__sig_` cell, no `$effect.pre`. Measured ~1.84× faster and ~2.3× less heap at whole-component scale, because it removes a whole signal **and** a whole effect per local cell — it *deletes work* rather than swapping a backend.
- An inlined name is deliberately **not** added to `signalNames`, so the assignment-rewrite (§2.4) and the signal import are skipped for it: a write to an inlined cell is a plain `$state` assignment (`count = count + 1`), which the substrate already tracks.

&gt; **INV-pui-4 (inline is sound or absent).** A `signal` is inlined **iff** `buildEscapeChecker` returns `false` for its name; otherwise the full bridge stands. The checker is *conservative* — its fallback verdict is "escapes," i.e. keep the bridge — so the inline optimization can only ever *remove* a bridge that was provably unnecessary, never one that was needed (INV-pui-1).

### 2.3 `buildEscapeChecker` — the inline predicate

A `signal x` needs the full bridge **iff external Para code can observe `x`**, or `x` leaves the component via context or `export`. `buildEscapeChecker(source)` returns a `(name) => boolean` predicate over the `<script>` body computed as:

1. **`signalOf` capture.** Every `signalOf(ARG)` call is scanned. `signalOf` is *the* Para-handle API — calling it on a cell is the explicit "keep this Para-observable" intent. If `ARG` is a bare identifier, that name is added to the escaped set. If `ARG` is *not* a resolvable identifier (a member access, a call, an expression), the predicate becomes **untraceable** — it returns `true` for *every* name (the safe, coarse gate; a `signalOf` of something unresolvable means we cannot prove any cell local).
2. **Alias fixpoint.** Simple `const|let|var L = R;` aliases are collected and a fixpoint is run: if `L` escapes, `R` escapes too. This closes the `const y = x; signalOf(y)` hole without a full AST — `x` is marked escaped transitively.
3. **Context / export scan.** For a queried `name`, the predicate also returns `true` if the body contains `setContext`/`getContext`/`provide`/`inject` *on a line mentioning* `name` (the name flows into component context — an external observer), or an `export` mentioning `name`.

```
# Predicate:  escapes(name)  — keep the bridge iff true
escapes(name) :=
      untraceable                                   // a signalOf(<non-ident>) anywhere
   ∨  name ∈ signalOfd                              // signalOf(name) (incl. alias fixpoint)
   ∨  /\b(setContext|getContext|provide|inject)\b[^\n]*\bname\b/  // flows to context
   ∨  /\bexport\b[^\n]*\bname\b/                    // exported
```

**Single shared implementation.** The same `buildEscapeChecker` is imported by *both* the build path (`lowerPuiReactivity`) and the editor projection (`pui-transform.ts`) — not byte-mirrored copies — so the editor's inline/bridge decision is *structurally* identical to the build's. The build calls it after `provide`/`inject` have desugared to `setContext`/`getContext`; the editor calls it on the raw body where they are still keywords. The predicate's context regex matches **both** spellings (`provide|inject` and `setContext|getContext`), so the verdict is independent of which caller observes which form (INV-overview-3, parity).

&gt; **Edge case (`signalOf` in scope = whole-file conservative gate).** Because an untraceable `signalOf` arg flips *every* name to escaping, a single `signalOf(props.x)` (member access) in a component forces the full bridge for all its signals. This is intentional v1 coarseness: `signalOf` in a `.pui` is the rare escape hatch, and when present the component keeps today's proven behavior (zero regression). Per-name precision past the alias fixpoint is a documented refinement.

### 2.4 Assignment rewrite (escaped names only)

For each name in `signalNames` (the **escaped** signals — inlined ones are excluded), a standalone assignment line `NAME = EXPR;` is rewritten to `__sig_NAME.set(EXPR);`. The declaration line (now `const __sig_NAME = …`) is skipped (it contains `const __sig_NAME`). The write must go through the Para signal so external observers see it; the `$effect.pre` subscription then echoes it back into the `$state` cell.

```
# Desugar:  NAME = EXPR   (NAME an escaped signal)
.pui:
    count = count + 1;
Runes (.pui):
    __sig_count.set(count + 1);
```

&gt; **Edge case (only standalone assignment lines).** The rewrite matches `^(\s*)NAME\s*=\s*(.+?)\s*;?\s*$` — a whole-line assignment. Compound forms (`obj.count = …`, `count += 1`, `count` inside a larger expression) are not single-line bare assignments and are left alone; the read side (`count`) is the `$state` cell, already reactive. (This is a v1 surface; richer write forms are out of scope here.)

### 2.5 `derived` — `$derived` and `$derived.by`

`derived` has two forms; both run before the per-line passes (brace-aware) so a later pass cannot chew the rewritten body:

```
# Desugar:  derived NAME = EXPR
.pui:
    derived doubled = count * 2;
Runes (.pui):
    const doubled = $derived(count * 2);

# Desugar:  derived NAME { BODY }   (multi-statement block)
.pui:
    derived rows {
      const f = items.filter(_ => _.active);
      return f.sort(byName);
    }
Runes (.pui):
    const rows = $derived.by(() => {
      const f = items.filter((__pu) => __pu.active);
      return f.sort(byName);
    });
```

- The single-line `derived NAME = EXPR` initializer may **span newlines** (ternary / binary / member-chain wrap); its true extent is found by the shared `derivedInitEnd` scanner (depth-0 `;`, an ASI newline where the expression is complete and the next line is not a continuation, an enclosing `}`, or EOF — skipping string/template/comment/regex spans), **not** the line's end. The expression text is left in place (positions preserved → diagnostics map); only the opener/closer are rewritten.
- The block form `derived NAME { BODY }` is consumed first by the brace-aware pass and becomes `$derived.by(() => { BODY })`, leaving the body untouched and fully sourcemapped. This is the form for the chained `filter/sort/group` derivation that otherwise forces a raw `$derived.by` fallback.
- `derived` is read-only — there is no assignment-rewrite and no escape analysis; a `derived` cell does not bridge a Para signal (it is a substrate computed cell). Para-observable derivations live in `.pts` [→ ch:reactivity-core].

### 2.6 `effect` — `$effect` (block and single-statement)

```
# Desugar:  effect { BODY }
.pui:
    effect {
      console.log(count, doubled);
    }
Runes (.pui):
    $effect(() => {
      console.log(count, doubled);
    });

# Desugar:  effect EXPR;   (single statement, implicit-return preserved)
.pui:
    effect appSync.sync();
Runes (.pui):
    $effect(() => appSync.sync());
```

- The block form rewrites **only** the opener (`effect {` → `$effect(() => {`) and the matching closer (`}` → `})`); the (often large) body is untouched and fully mapped. The matching brace is found brace-aware (skipping comments/strings/templates).
- The single-statement form `effect EXPR;` is normalized to the block/arrow form: `$effect(() => EXPR)` — expression-bodied, so a returned cleanup is preserved. The terminating `;` is consumed (the emission is `$effect(() => EXPR)` with **no** trailing `;` — a byte-parity point with the canonical lowering). `EXPR` may span newlines (extent via `derivedInitEnd`).
- **Disambiguation (identical to the parser).** `effect` is the keyword only before `{` or whitespace+identifier-start. `effect(`, `effect.`, `effect[`, `effect=`, `effect:`, `effect;` keep `effect` as a plain identifier — superset closure [→ ch:reactivity-core, ch:overview-and-surfaces §1.1]. A pre-existing `effect` *identifier* (an imported `effect` function used as a value) is never rewritten.

&gt; **Edge case (cleanup return).** `effect { … return () => cleanup(); }` lowers to `$effect(() => { … return () => cleanup(); })`, and the substrate runs the returned function on re-run/unmount — Para's `return cleanup` convention [→ ch:reactivity-core] maps directly onto the rune's cleanup contract. There is no separate teardown keyword in `.pui`.

### 2.7 HMR signal preservation

When the preprocessor runs with `hmr` on (the default in dev — `process.env.NODE_ENV !== "production"`, and only the editor/LSP path forces it off so the type-relevant lowering stays byte-identical for parity), the **escaped** `signal` form is wrapped in a registry-backed allocation:

```
# Desugar:  signal NAME = EXPR   (escaped, hmr=true)
.pui:
    signal count = 0;
Runes (.pui):
    import { signal, hmrSignal } from "@lyku/para-signals";
    const __sig_count =
      (import.meta.hot ? hmrSignal(import.meta.url + "::count", () => signal(0)) : signal(0));
    let count = $state(__sig_count.peek());
    $effect.pre(() => __sig_count.subscribe((__v: typeof count) => { count = __v; }));
```

- `hmrSignal(key, make)` keys a `globalThis.__PARA_HMR_SIGNALS` `Map` by `import.meta.url + "::" + name`. The **first** call creates the signal via `make()`; after a Vite/HMR module re-evaluation, subsequent calls return the **same instance** — its current value *and* existing subscribers survive the reload, so editing the component does not reset its state.
- Double-guarded: the registry path is taken only under `import.meta.hot`; a production build (no `hot`) takes the plain `signal(EXPR)` arm and never touches the registry — zero prod cost. The inlined `$state` form is unaffected by HMR (the substrate's own HMR handles plain `$state`).

&gt; **INV-pui-5 (HMR is identity-only).** `hmrSignal` changes **only** the *identity* of the underlying Para signal across reloads, never its semantics: value, subscribers, and the `$state`↔signal bridge are byte-identical to the non-HMR form once allocated. The LSP path therefore disables HMR with no loss of type fidelity.

---

## 3. `provide` / `inject` — component context

`provide`/`inject` are the `.pui` projection of Svelte context. They are owned outright by this chapter.

### Grammar

```
ProvideDecl ::= "provide" Ident TypeAnn? "=" Expr ";"?
InjectDecl  ::= "inject" Ident ":" Type ";"?
```

### Static & dynamic semantics

- `provide NAME = EXPR` → `setContext("NAME", EXPR)`. The context **key is the string literal of the name** (`v1` is string-keyed; a workspace-scoped typed-key registry is a documented follow-up). `setContext` is auto-imported from the runtime (`@lyku/para-ui` or `svelte`).
- `inject NAME: TYPE` → `const NAME: TYPE = getContext("NAME")`. The injected binding carries the author-supplied `TYPE` — the value off the context bus is typed, not `any` (I3, modulo the string-key trust that provider and consumer agree on the name). `getContext` is auto-imported.
- Context follows Svelte's component-tree rules: `setContext` must run during component init (top of `<script>`), `getContext` reads the nearest ancestor provider. A name provided and injected in the same component is legal (self-context).

```
# Desugar:  provide / inject
.pui (ancestor):
    provide theme: Theme = { mode: "dark" };
Runes:
    import { setContext } from "@lyku/para-ui";
    setContext("theme", { mode: "dark" });

.pui (descendant):
    inject theme: Theme;
Runes:
    import { getContext } from "@lyku/para-ui";
    const theme: Theme = getContext("theme");
```

&gt; **Interaction with escape analysis.** Because a `provide`d name flows into context, `buildEscapeChecker` treats it as escaping — a `signal` that is also `provide`d keeps its full bridge (§2.3). The build path sees `setContext`/`getContext` (already desugared); the editor sees `provide`/`inject`; the predicate matches both, so the verdict is identical (parity).

---

## 4. Resource & lifecycle injection: `using` / `source` / `async signal`

These keywords bind a producer into a component-reactive cell **and** schedule its teardown on unmount. Their *producer* semantics are [→ ch:sources-async-and-native]; this section specifies only the **component projection** (the `$state` view + `onDestroy` injection). All three reuse the peek/subscribe/dispose convention and inject `onDestroy` (auto-imported).

### 4.1 `using` — dispose-on-unmount

```
# Desugar:  using NAME = EXPR
.pui:
    using db = openDb(url);
Runes:
    import { onDestroy } from "@lyku/para-ui";
    const db = openDb(url); onDestroy(() => db.dispose?.());
```

- A plain `const` plus an unmount-time `.dispose?.()` (optional-chained, so a value without `dispose` does not crash unmount; Para resources expose both `.dispose()` and `Symbol.dispose`, and the friendlier `.dispose()` is called). No reactive view — `using` is the lightest form, for a resource you hold but do not subscribe to.

### 4.2 `source` — native handle → read-only reactive view

```
# Desugar:  source NAME = EXPR
.pui:
    source level = mic.level;
Runes:
    import { onDestroy } from "@lyku/para-ui";
    const __src_level = mic.level;
    let level = $state(__src_level.peek?.() ?? __src_level);
    $effect.pre(() => __src_level.subscribe?.((__v: typeof level) => { level = __v; }));
    onDestroy(() => __src_level.dispose?.());
```

- Composes the escaping-`signal` bridge (peek + `$effect.pre` subscribe) with the `using` disposal. Every handle method is **optional-chained**: `.peek?.()` (fallback: the handle itself, so a bare value works), `.subscribe?.(cb)` (its return is the `$effect.pre` teardown), `.dispose?.()`. A bare Para `Signal<T>` already satisfies this convention, so `source busy = m.busy` binds a native module's status signal with no extra ceremony.
- `NAME` is a **read-only** reactive view of an external source — deliberately **no** assignment-rewrite and **no** escape analysis (it is not a `signal` cell; the binding always uses the bridge because the producer is external by construction).

### 4.3 `async signal` — promise → `{data,error,pending}` view

```
# Desugar:  async signal NAME = EXPR
.pui:
    async signal user = fetchUser(id);
Runes:
    import { onDestroy } from "@lyku/para-ui";
    import { promiseSignal } from "@lyku/para-signals";
    const __as_user = promiseSignal(() => (fetchUser(id)));
    let user = $state(__as_user.peek?.() ?? __as_user);
    $effect.pre(() => __as_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __as_user.dispose?.());
```

- `promiseSignal(() => (EXPR))` returns a value satisfying the `source` convention, so the projection reuses the exact `source` bridge — no new machinery. The in-flight request is dropped on unmount (the `onDestroy` disposal), so there is no stale-state / set-after-unmount hazard. The thunk is `() => (EXPR)`; for true network abort, call `promiseSignal((abort) => fetch(u, { signal: abort }))` directly [→ ch:sources-async-and-native].

&gt; **Pass ordering.** `async signal` is lowered **before** the bare `signal` pass (its head is `async signal NAME =`), so the `signal` regex never sees `async signal` as a plain signal. The reactivity passes run in a fixed order (effect-blocks → derived-blocks → derived-decls → prop → provide/inject → using → source → async-signal → sync-from → synced → signal), each consuming its form so no two passes contend for the same line.

---

## 5. `sync` / `synced` — binding replicated state in a component

`sync`/`synced` are source-position declarations legal in `.pui`; their **reconcile, authority, and transport** semantics are [→ ch:data-sync-and-authority]. This chapter specifies only how they **bind** in a component — and the binding is the *same* peek/subscribe/dispose projection as `source` (§4.2), because a synced replica *is* a source (with a reconciler upstream). `synced` is auto-imported from `@lyku/para-sync`.

```
# Desugar:  sync NAME :: SCHEMA from KEY     (validated form)
.pui:
    sync user :: User from `user:${id}`;
Runes:
    import { onDestroy } from "@lyku/para-ui";
    import { synced } from "@lyku/para-sync";
    const __syn_user = synced(`user:${id}`, User);
    let user = $state(__syn_user.peek?.() ?? __syn_user);
    $effect.pre(() => __syn_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __syn_user.dispose?.());

# Desugar:  sync NAME : T from KEY           (type-only form)
.pui:
    sync presence : Presence from `presence:${room}`;
Runes:
    const __syn_presence = synced(`presence:${room}`);
    let presence: Presence = $state(__syn_presence.peek?.() ?? __syn_presence);
    // … $effect.pre subscribe + onDestroy as above …

# Desugar:  synced NAME = ARGS               (full-control form)
.pui:
    synced cart = `cart:${id}`, { schema: Cart, stream: true };
Runes:
    const __syn_cart = synced(`cart:${id}`, { schema: Cart, stream: true });
    // … same bridge …
```

- **`::` (validated)** threads `SCHEMA` as the second arg to `synced(KEY, SCHEMA)`, parse-gating every envelope at the sync boundary; the cell type is inferred from `synced<T>`. **`:` (type-only)** emits `synced(KEY)` with no schema (the trusted / opt-out mode) and annotates the `$state` cell with the supplied `T` (since no schema means the type can't be inferred). The colon count is captured greedily so `::` wins over `:`.
- `KEY` (in `sync … from KEY`) and `ARGS` (in `synced NAME = ARGS`) may span newlines (the opts object); extent via `derivedInitEnd` — a top-level comma between key and opts is a *continuation*, not a terminator.
- The bound `NAME` is a **read-only** reactive view (no assignment-rewrite): a `.pui` component *reads* replicated state; the **write** path (optimistic local mutation, intent versioning, confirm/reject) is the Proposed Tier-2 surface [→ ch:data-sync-and-authority §5] and, at the component, the Proposed two-way `bind:` of §12.2.

&gt; **Note (`sync` vs `synced` keyword disambiguation).** Both lower through `__syn_`. `sync NAME ::|: … from KEY` is the readable common-case sugar; `synced NAME = ARGS` is the full-control form whose emitted `synced(...)` call is never re-matched as the `synced` keyword (the head requires `synced <ident> =`). The two passes run in that order so the sugar's emitted call stays out of the full-control scan.

---

## 6. Inline snippet sugar: `attr={<Tag/>}` → `{#snippet}`

Svelte 5 passes reusable markup fragments as **snippets**. Writing a snippet for every one-line cell renderer is heavy; `.pui` lets you write the markup *inline at the attribute* and **lifts** it to a `{#snippet}` declaration during the markup pass (`lowerParaMarkup` → `lowerInlineSnippets`). This is owned outright by this chapter.

### What triggers a lift

The markup walker recognizes an attribute body `\sIDENT={ … }` and hands the `{…}` expression to a JS-expression scanner. Within that expression, an inline element is lifted when it appears at an **expression-starting boundary** (after `=`, `:`, `,`, `(`, `[`, `{`, `?`, `=>`, `>`, or at the start) — so a real `f(<x)` comparison or an ordinary call is never mis-lifted. Two element forms lift:

- **Bare element** `<Tag … />` → a zero-param snippet.
- **Param form** `(args) => <Tag … />` → a snippet whose parameters are `args` (the arrow's parameter list, verbatim).

```
# Desugar:  inline snippet (bare)
.pui:
    <Modal header={<h1>Settings</h1>}>…</Modal>
Lowered markup:
    <Modal header={(__para_attr_1.__para_snippet = true, __para_attr_1)}>…</Modal>
    {#snippet __para_attr_1()}<h1>Settings</h1>{/snippet}

# Desugar:  inline snippet (param form)
.pui:
    <Table cell={(row) => <a href={row.url}>{row.name}</a>} />
Lowered markup:
    <Table cell={(__para_attr_2.__para_snippet = true, __para_attr_2)} />
    {#snippet __para_attr_2(row)}<a href={row.url}>{row.name}</a>{/snippet}
```

- Each lift mints a stable name `__para_attr_${++counter}` and pushes a `{#snippet NAME(params)}BODY{/snippet}` declaration into the current scope. The **use site** becomes `(NAME.__para_snippet = true, NAME)` — a comma-operator expression that (a) tags the snippet with `.__para_snippet = true` *before* the consumer receives it, and (b) evaluates to the snippet reference. The tag lets a consumer (e.g. a `<Table>` cell-render path) distinguish a snippet from a plain `(item) => string` in minified prod builds without relying on `Function#toString`.
- The lifted body is itself run through `processMarkup`, so **nested** inline snippets compose (an inline element inside an inline element lifts recursively).

### Each-scoped lifts

A snippet lifted *inside* a `{#each}` block must be able to refer to the iteration binding, so it is flushed **just before** the matching `{/each}` close (inside the each body), not at module scope:

```
# Desugar:  each-scoped inline snippet
.pui:
    {#each rows as row}
      <Cell render={<span>{row.label}</span>} />
    {/each}
Lowered markup:
    {#each rows as row}
      <Cell render={(__para_attr_3.__para_snippet = true, __para_attr_3)} />
      {#snippet __para_attr_3()}<span>{row.label}</span>{/snippet}
    {/each}
```

- The walker pushes an each-scope on `{#each}` and pops it on `{/each}`, emitting that scope's lifted snippets immediately before the close. Module-scope lifts (outside any `{#each}`) are appended once at the end of the file.

&gt; **Edge case (verbatim pass-through).** `<script>`, `<style>`, and `<!-- … -->` regions are passed through **verbatim** by the markup walker — an `attr={<x/>}`-looking string inside a comment or style is never lifted. Strings, template literals, and balanced braces inside an expression are skipped by the low-level scanners, so a `{ "<a/>" }` string or a `{ obj.a < b }` comparison does not trigger a spurious lift.

&gt; **Glass floor.** The output is exactly the `{#snippet}` markup a Svelte-5 author would write by hand, plus a one-token `.__para_snippet` marker — readable and ejectable (I1). The Proposed typed-snippet contract (§12.3) adds a totality-checked parameter schema on top of this lifting without changing the emitted shape.

---

## 7. Full Svelte-5 template support

`.pui` is a **strict superset** of Svelte 5: every legal Svelte template is a legal `.pui` template, and `.pui` only *adds* the inline-snippet sugar (§6) and the script-side keyword lowerings (§1–§5). The template layer is therefore **inherited unchanged** and passes to the Svelte compiler after the Para passes have produced standard runes + standard markup.

### 7.1 Inherited block & directive surface

- **Blocks.** `{#if}/{:else if}/{:else}/{/if}`, `{#each list as item, i (key)}…{:else}…{/each}`, `{#await promise}…{:then v}…{:catch e}…{/await}`, `{#key expr}…{/key}`, `{#snippet name(params)}…{/snippet}` and `{@render snippet(args)}`. The inline-snippet sugar (§6) lifts *into* `{#snippet}` — it is the one Para addition; everything else is Svelte-native.
- **Tags.** `{expr}` interpolation, `{@html …}`, `{@const …}`, `{@debug …}`.
- **Directives.** `bind:value` / `bind:this` / `bind:group` and component `bind:prop`; `onclick={…}` and the legacy `on:event`; `use:action`; `transition:` / `in:` / `out:` / `animate:`; `class:` / `style:`; spread `{...props}`.
- **`{@render}` and snippet props.** A lifted inline snippet (§6) is passed as an ordinary prop and rendered by the child via `{@render}`; the `.__para_snippet` tag is the only Para-visible addition.

These are documented here as **inherited** — `.pui` adds no semantics to them. Where a directive interacts with a Para-bridged cell, the interaction is the cell's: `bind:value={count}` on an *inlined* `signal` binds the `$state` cell directly (two-way, native); on an *escaped* `signal` it binds the `$state` view, and writes flow out through the assignment-rewrite (§2.4) — the Proposed §12.2 makes write-authority on synced/source cells explicit.

### 7.2 Scoped `<style>`

A `<style>` block is Svelte-scoped per component, unchanged. The markup walker passes `<style>` through verbatim (§6), so no Para lowering touches CSS. A `<style lang="scss">` (or any non-implicit `lang`) is **not** Para-processed and compiles via the host's style pipeline. The Proposed §12.4 design-token system binds `<style>` to schema/theme projections *without* changing this pass-through default.

### 7.3 Lifecycle & navigation auto-import

`mount` was **retired** as a keyword (2026-05-17): a Para keyword must map to a language *primitive* (`signal`→`$state`, `effect`→`$effect`), not rename an ordinary framework call. Lifecycle and navigation are therefore **plain calls** in `.pui` — `onMount(() => …)`, `onDestroy(…)`, `afterNavigate(…)`. The only thing `.pui` removes is the import boilerplate: when a call to a name in the closed sets is used and not already imported, the preprocessor injects the import:

- `PUI_RUNTIME_LIFECYCLE = { onMount, onDestroy }` ← from the runtime (`@lyku/para-ui` or `svelte`).
- `PUI_KIT_NAV = { beforeNavigate, afterNavigate, onNavigate }` ← from `$app/navigation`.

```
# Desugar:  lifecycle auto-import
.pui:
    onMount(() => start());
    afterNavigate(() => track());
Runes (injected imports):
    import { onMount } from "@lyku/para-ui";
    import { afterNavigate } from "$app/navigation";
    onMount(() => start());
    afterNavigate(() => track());
```

- Detection (`usesIdentCall`) requires the name as a *call* and not a member access (`x.onMount`) or `$`-prefixed — the same lead guard the lowerings use. Imports dedup against a hand-authored import of the same module (so `import { onMount } from "svelte"` already present is not double-declared). This closed set **does not grow** — it is framework-defined, not a Para primitive family. The LSP auto-imports the *same* sets (one source of truth) so a `.pui` using bare `onMount` does not show a false `Cannot find name` in the editor while building fine.

---

## 8. `match` in `.pui` (type-stub parity)

`match` in a `.pui` `<script>` is lowered to a **parse-safe, subject-typed `any` stub** — identical to the proven shape shipped for `.svelte`/`.pts` non-`.pui` tooling. Full per-arm result narrowing would need a parser-faithful, sourcemap-threaded lowering (beyond what any current ParaBun tooling does), so `.pui` matches that same parity:

```
# Desugar (parity stub):  match SUBJECT { … }
.pui:
    const label = match status { "ok" => "Good", _ => "…" };
Lowered (LSP/strip):
    const label = ((__pm: any): any => null as any)(status);
```

- The whole `match { … }` is replaced with `((__pm: any): any => null as any)(SUBJECT)` so it **parses** and the `SUBJECT` still type-checks (its errors surface); arm results are `any`. The subject is itself run through the operator desugars (decimal/fun/pure/is/pipeline/error-chain/ranges) so a `match f(x) |> g { … }` subject type-checks. The stub is emitted on the match's first line plus the original `\n` count, so line totals are preserved and the per-line passes stay aligned. The span source is the shared `matchTypeStubSpans` (one implementation; a parity test guards drift). The full `match` semantics are [→ ch:errors-results-and-validation].

---

## 9. Sourcemap composition

The editor projects a `.pui` to typed TSX through **two chained v3 sourcemaps**, so a diagnostic, hover, or go-to maps back to the exact source column:

```
raw .pui  ──lowering map (MagicString)──►  lowered Svelte  ──svelte2tsx map──►  generated TSX
```

- The lowering is re-implemented over a whole-file `MagicString` with **segment-preserving overwrites**: keywords/punctuation are rewritten while user identifiers and expressions stay in place (exact column mapping). Where source↔output is inherently reordered (the `signal` bridge, the merged `prop` destructure, the `sync` binding) the line is overwritten whole and is *line-accurate* (the LSP additionally strips the `__sig_` prefix in hovers). Block forms (`effect {`, `derived NAME {`) rewrite only opener/closer — the body keeps exact mapping.
- Imports are injected **inside** the first `<script>` body (line-preserving: no trailing newline, so the lowered file has the same line count as the raw), specifically so diagnostic positions map. The build path emits imports *before* the tag (cleaner generated code) — a sanctioned divergence, not drift (§10).
- `toGenerated` chains raw→lowered→generated; `toOriginal` chains generated→lowered→raw. Both fall back gracefully when `svelte2tsx` labels its source by `filename` rather than `filename + ".lowered"`. Full details are [→ ch:tooling-diagnostics-and-conformance].

---

## 10. The LSP parity contract

The build path and the editor path use the **same** reactivity-lowering logic so the type a developer sees equals the type that ships.

&gt; **INV-pui-6 (reactivity byte-parity).** For the REACTIVITY lowering — `signal` / `derived` (expr + block) / `effect` (block + single-statement) / `prop` — the editor's `_puiLoweredCode` is **byte-identical** to `@lyku/para-preprocess`'s `lowerPuiReactivity(src, "@lyku/para-ui", true)` (line-preserving, HMR off). This is enforced by `test/pui-lower-parity.smoke.ts`. The `buildEscapeChecker` predicate is *imported* by both paths (not copied), so the inline/bridge decision is structurally identical.

Exactly **two** deltas are intentional and excluded from byte-identity (by design, not drift):

1. **Operator desugars.** `pure` / `|>` / `..!` / `..&` / `..>` / `fun` / `is` / ranges / decimal / `match`-stub. The LSP applies these (via `@lyku/para-transpile/syntactic`, the Babel-free entry) so the projection is valid TS for `svelte2tsx`; the canonical build path leaves them to ParaBun's parser (at build) / `Bun.Transpiler` (type-strip). Different layers — never expected identical.
2. **Import placement.** The LSP injects auto-imports **inside** the `<script>` (line-preserving for sourcemap accuracy); the build emits them **before** the tag. Same imports, different position — required for the chained sourcemap.

The editor's `match` is the one form still type-stubbed (§8); both paths stub it identically. A line the reactivity lowering already overwrote is skipped by the operator pass (overlap throws → caught) so the two never contend.

---

## 11. The `.pui` pass pipeline (normative order)

A `.pui` file runs a fixed, ordered pipeline; **order is normative** because later passes consume earlier passes' output:

```
# Desugar:  .pui build pipeline
1. markup            lowerParaMarkup     — inline attr={<Tag/>} → {#snippet}     (§6)
2. script            lowerParaScript     — async{}/pipeline/leading-dot/match    ([→ ch:lexical-and-expression-syntax])
3. reactivity        lowerPuiReactivity  — signal/derived/effect/prop/provide/
                                            inject/using/source/async signal/
                                            sync/synced → runes                  (§1–§5)
4. TS strip          Bun.Transpiler      — (Node fallback: esbuild)              (§§ already standard TS)
5. Svelte compiler   standard Svelte 5 runes
```

- **Within step 3** the keyword passes run in the fixed order listed in §4 (effect-blocks → derived-blocks → derived-decls → prop → provide/inject → using → source → async-signal → sync-from → synced → signal → assignment-rewrite → import injection), each consuming its form.
- Step 4 sees **standard TS** (the Para constructs are gone), so it is a generic type-strip — under Bun a `Bun.Transpiler`, under Node (how Vite runs the Svelte preprocess, since `vitePreprocess` does not process `.pui`) an esbuild transform with `preserveValueImports` + `importsNotUsedAsValues: "preserve"` (so markup-only and auto-subscribed imports survive). In a browser (`node:module` absent) the strip is skipped and the un-stripped source is returned (the in-browser compiler path).
- **Step 2/3 ordering hazard.** Because script lowering (step 2) runs before reactivity (step 3), a Para *operator* inside a reactive RHS is already host TS by the time step 3 matches the declaration head (`signal x = a |> f` is seen as `signal x = f(a)`). The contextual guards keep `signal`/`derived`/`effect` inert to the step-2 general pass, so the two compose in exactly this order [→ ch:overview-and-surfaces §4.2].

---

## 12. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts`, the preprocessor, or the parser today). Each includes a desugaring sketch (`# Desugar (proposed):`) so it remains glass-floor-compatible (I1) and survives a renderer swap (I2). They extend the *component projection* — none changes a spine primitive's meaning.

### 12.1 `@server` / `@client` split annotation — declare where component code runs  `Proposed`

**Rationale.** A `.pui` component today is wholly client code; server work (data loading, an authenticated mutation) is written in a separate `.pts` handler and wired by hand. That scatters the "what runs where" fact and forces the component author to hand-thread a typed client. A **split annotation** lets a component declare which `<script>` regions run on the server (feeding the schema spine's handler projection [→ ch:modules-projections-and-build]) and which hydrate on the client — making the boundary a modeled, checkable fact and discharging the A4 structural risk at the component (server-only auth context physically cannot reach the client bundle, per the capability matrix [→ ch:overview-and-surfaces §5.3]).

**Grammar.**
```
SplitBlock ::= "@server" "{" ScriptBody "}" | "@client" "{" ScriptBody "}"
ServerLoad ::= "@server" "load" Ident "::" SchemaRef "=" Expr ";"
```
`@server`/`@client` are block annotations legal only inside a `.pui` instance `<script>`. A bare `<script>` body (no annotation) is `@client` by default (today's behavior).

**Static semantics.** A `@server` block may reference only `server`-capability constructs (the matrix, [→ ch:overview-and-surfaces §5.3]); a `@client` block may not import a `server`-only symbol. A `@server load NAME :: SCHEMA = EXPR` declares a server-run loader whose result is **parse-gated** by `SCHEMA` at the boundary (the value crosses the trust boundary into the client) and projected into a `$state` seed the client hydrates from — closing the seam between the server handler projection and the component's reactive cells with no `any`. A value produced in `@server` and read in `@client` must be schema-typed (I3); an unannotated cross is a compile error.

**Dynamic semantics / desugar.** `@server` regions split into the route's server handler (the projection); `@client` regions stay in the component; the loader's result is serialized once and hydrated as a `$state` seed.

```
# Desugar (proposed):  @server load
.pui:
    @server load user :: User = db.user.find(id);
Runes (.pui, client half) + handler (server half):
    // server: projected into the route handler
    export async function __load_user(id): Promise<User> {
      return User.parse(await db.user.find(id)).value;   // parse-gate at boundary
    }
    // client: hydrated seed
    let user = $state<User>(__hydrate("user"));
```

**Interaction.** Composes with `sync` (§5): a `@server load` seeds the *initial* value; a `sync` keeps it live. With `strict-totality` [→ ch:overview-and-surfaces §5.2] a `@server` value crossing to `@client` without a schema type is a hard error. **Rationale recap:** the boundary becomes a declaration, not a convention — and the schema spine's handler projection gains its component-side caller for free.

### 12.2 First-class two-way `bind:` to synced/source cells — explicit write-authority  `Proposed`

**Rationale.** §5 binds synced state **read-only**; a write needs the Tier-2 optimistic path [→ ch:data-sync-and-authority §5]. Today there is no surface to express "this input writes back to the replica, optimistically, under this authority." A first-class `bind:` to a synced/source cell with an **explicit write-authority clause** makes the optimistic write surface legible and totality-checked against the manifest's authority model.

**Grammar.**
```
SyncBind   ::= "bind:" Prop "=" "{" SyncRef WriteAuth? "}"
WriteAuth  ::= "with" ("optimistic" | "confirmed") ("on" FieldPath)?
SyncRef    ::= Ident ("." FieldPath)?
```

**Static semantics.** `bind:value={cart.note with optimistic}` is legal **only** if `cart`'s authority class permits a local write to the named field — for a Class-B replica the field must be in the schema's declared merge field list (`authority { Cart => class-b { note } }`, [→ ch:overview-and-surfaces §5.1]); a write to a non-merge field is a compile error. `with confirmed` waits for server ack before reflecting; `with optimistic` reflects locally then reconciles (rollback on reject). Absent a `WriteAuth`, a `bind:` to a synced cell is a compile error (writing replicated state is never ambient — it states its authority).

**Dynamic semantics / desugar.** Lowers to a `$state` view plus a mutation call that threads an intent through the reconciler.

```
# Desugar (proposed):  two-way bind to synced cell
.pui:
    <input bind:value={cart.note with optimistic} />
Runes:
    <input value={cart.note}
           oninput={(e) => __syn_cart.write("note", e.target.value, { mode: "optimistic" })} />
```

**Interaction.** The write side is [→ ch:data-sync-and-authority §5]; this is its *component surface*. Composes with §12.4 (a schema-driven form field is a `bind:` whose authority is read from the schema). **Rationale recap:** optimistic write becomes a typed, authority-checked binding instead of a hand-rolled mutation handler that historically degraded to `any`.

### 12.3 Typed snippet contracts — totality-checked snippet parameters  `Proposed`

**Rationale.** A lifted inline snippet (§6) or a hand-written `{#snippet}` takes positional params whose types are inferred loosely; a consumer rendering it with the wrong arg shape fails at runtime. A **typed snippet contract** attaches a parameter schema to a snippet so a `{@render}` site is checked, and the totality of an each-scoped snippet (every branch supplies the params) is verifiable.

**Grammar.**
```
SnippetContract ::= "{#snippet" Ident "(" TypedParams ")" "}"
TypedParams     ::= (Ident "::" SchemaRef | Ident ":" Type) ("," …)*
```
The inline form gains a contract too: `cell={(row :: Row) => <…/>}` lifts to a contracted snippet.

**Static semantics.** A `::`-typed param threads `Infer<typeof SchemaRef>` as the param type *and* (Proposed) parse-gates the arg at the render boundary when the snippet is rendered with untrusted data. A `{@render snip(x)}` whose `x` is not assignable to the contract is a compile error. **Totality:** if a snippet is selected per-branch (e.g. a `match`-driven cell renderer), the checker requires every branch to supply a contract-satisfying arg — a missing branch is a totality error, not a runtime `undefined`.

**Dynamic semantics / desugar.** The contract erases to the param type (and an optional parse gate); the lift shape (§6) is unchanged.

```
# Desugar (proposed):  typed inline snippet
.pui:
    <Table cell={(row :: Row) => <a href={row.url}>{row.name}</a>} />
Lowered markup:
    <Table cell={(__para_attr_1.__para_snippet = true, __para_attr_1)} />
    {#snippet __para_attr_1(row: Infer<typeof Row>)}<a href={row.url}>{row.name}</a>{/snippet}
```

**Interaction.** Builds directly on §6's lifting (same emitted shape) and on the schema spine [→ ch:type-and-schema-system]. **Rationale recap:** snippets join the totality story (I3) — a render site is as checked as a function call, and inline cell renderers stop being an `any` hole in the template.

### 12.4 Schema-driven design-token `<style>` system — tokens as projections  `Proposed`

**Rationale.** Design tokens (colors, spacing, type scale) live today as ad-hoc CSS vars, untyped and disconnected from the model. If the schema is the application, the **theme is a schema** and the tokens a CSS-var **projection** of it — so a `<style>` can reference typed tokens, a token rename is a compile error, and the token set is diffable like any projection (I1).

**Grammar.**
```
TokenRef  ::= "token(" SchemaPath ")"          ⟨in a <style> value position⟩
ThemeUse  ::= "@theme" SchemaRef ";"           ⟨binds a theme schema to this component's tokens⟩
```

**Static semantics.** `@theme Theme;` binds a `schema Theme { color: { fg: Color, bg: Color }, space: Scale }` to the component. `token(color.fg)` in `<style>` resolves against `Theme` at compile time; an unknown path is a compile error (the token set is closed by the schema). The projection emits CSS custom properties (`--color-fg`) and rewrites `token(color.fg)` to `var(--color-fg)`; the variable *values* are projected from the theme schema's instance (light/dark variants are schema values, not duplicated CSS).

**Dynamic semantics / desugar.** The `<style>` pass (today verbatim, §7.2) gains one rewrite when `@theme` is present; absent `@theme`, `<style>` is unchanged (zero cost, full back-compat).

```
# Desugar (proposed):  schema design tokens
.pui:
    @theme Theme;
    <style>
      .card { background: token(color.bg); padding: token(space.md); }
    </style>
Lowered:
    <style>
      .card { background: var(--color-bg); padding: var(--space-md); }
    </style>
    /* :root projection emitted from Theme's instance values (light/dark) */
```

**Interaction.** Tokens become a projection alongside db/api/client [→ ch:modules-projections-and-build]; a `project` block (Proposed, [→ ch:overview-and-surfaces §5.4]) could name a `tokens -> "src/gen/tokens.css"` target. **Rationale recap:** the `<style>` substrate stays swappable (I2 — it is still CSS) while the *token vocabulary* is spine-derived and total.

### 12.5 Schema-driven reactive form binding — auto-validating inputs  `Proposed`

**Rationale.** A form over a `schema` today wires each field's `bind:`, validation, and error display by hand — exactly the per-field boilerplate the spine should erase. A **schema-driven form** binds a whole `schema` instance to inputs, with **per-field parse** running on input so each field's validity, coerced value, and error are reactive projections of the field's refinement — discharging A2 (no hand-rolled boundary validation) at the view.

**Grammar.**
```
FormBind  ::= "form" Ident "::" SchemaRef "=" Expr ";"
FieldBind ::= "bind:field" "=" "{" Ident "." FieldPath "}"
```

**Static semantics.** `form draft :: SignupForm = { … };` introduces a reactive form model whose fields are typed by `SignupForm`. `<input bind:field={draft.email} />` binds the `email` field; on input the field is parsed through its schema refinement (`Email`), exposing `draft.email.value` (coerced), `draft.email.valid`, and `draft.email.error` as reactive cells. A `bind:field` to a path not in the schema is a compile error; a submit reads `draft.parse()` → `Result<Infer<typeof SignupForm>, FormErrors>` (errors-as-values, [→ ch:errors-results-and-validation]).

**Dynamic semantics / desugar.** Each field lowers to a `$state` value cell + a `$derived` validity cell driven by the schema's per-field parse.

```
# Desugar (proposed):  schema form field
.pui:
    form draft :: SignupForm = { email: "" };
    <input bind:field={draft.email} />
    {#if !draft.email.valid}<span class="err">{draft.email.error}</span>{/if}
Runes:
    const draft = __paraForm(SignupForm, { email: "" });        // reactive form model
    <input value={draft.email.value}
           oninput={(e) => draft.email.set(e.target.value)} />  // per-field parse on set
    {#if !draft.email.valid}<span class="err">{draft.email.error}</span>{/if}
```

**Interaction.** Reuses the `::` parse-gate [→ ch:errors-results-and-validation] per field; the standardized validation-error shape (path + code + message, Proposed in the errors chapter) is what `draft.email.error` carries. Composes with §12.2 (`bind:field` to a *synced* form is an optimistic write under the field's authority). **Rationale recap:** the form is a projection of the schema, not a hand-validated delta — the easy path is the total path.

### 12.6 Renderer-agnostic component IR — a spec'd target for the I2 swap  `Proposed`

**Rationale.** I2's north star is a renderer swap that leaves the spine untouched, but the bridge (§2–§7) targets runes *concretely*. For "swap the renderer" to be a checkable claim rather than an aspiration, the bridge needs a **declared intermediate representation** — a small, renderer-neutral component IR that the `.pui` passes emit and a substrate adapter consumes. The `.para` `view` binding [→ ch:overview-and-surfaces §5.5] selects the adapter; this IR is *what it adapts*.

**Grammar (IR shape, not surface).** The IR is not authored; it is the emit target. Its node set is the closed bridge vocabulary:
```
ComponentIR  ::= PropsNode StateNode* DerivedNode* EffectNode* ContextNode* LifecycleNode* TemplateNode
StateNode    ::= "state" Ident InitExpr Bridge?         ⟨Bridge = the Para-signal cross-subscribe, if escaped⟩
DerivedNode  ::= "derived" Ident (Expr | Block)
EffectNode   ::= "effect" Block Schedule?               ⟨Schedule ∈ {pre, post}⟩
ContextNode  ::= "provide" Key Expr | "inject" Key Type
TemplateNode ::= ⟨renderer-neutral element/snippet/control tree⟩
```

**Static semantics.** The IR node set is **exactly** the set of bridgeable view primitives — `state`/`derived`/`effect`/`props`/`context`/`lifecycle`/`template`. **Spine constructs have no IR node**: `schema`/`sync`/`synced`/`::`/`is` are *not* representable in the component IR (they are imported values and source-position bindings, not view nodes). That absence is the mechanical statement of I2 — the swappable surface is precisely the IR's node set, and the spine is provably outside it (an attempt to emit a `sync` node is an error, mirroring the `view` rebind prohibition [→ ch:overview-and-surfaces §5.5]).

**Dynamic semantics / desugar.** The default `svelte5` adapter maps each IR node to the runes form this chapter already specifies (so today's output is byte-identical); an alternate adapter maps the *same* IR to its substrate, with the spine lowering untouched.

```
# Desugar (proposed):  component IR → adapter
.pui:
    signal count = 0;                  // escaped
IR:
    state count = 0 bridge(signal)
svelte5 adapter:
    const __sig_count = signal(0);
    let count = $state(__sig_count.peek());
    $effect.pre(() => __sig_count.subscribe((__v) => { count = __v; }));
solid adapter (illustrative):
    const __sig_count = signal(0);
    const [count, setCount] = createSignal(__sig_count.peek());
    createEffect(() => __sig_count.subscribe(setCount));   // spine `signal(...)` UNCHANGED
```

**Interaction.** The IR is the target the `view` binding [→ ch:overview-and-surfaces §5.5] retargets and the conformance corpus [→ ch:tooling-diagnostics-and-conformance] can pin (an implementation is renderer-conformant iff its adapter maps every IR node to a working substrate form while leaving the spine bytes identical). **Rationale recap:** the renderer swap stops being a slogan and gets a spec'd seam — the IR enumerates exactly what a substrate must provide, and proves the spine is not among it.

