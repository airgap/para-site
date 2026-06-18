---
title: "Tooling, Diagnostics, LSP & Conformance"
description: "The spec's contract with editors, diagnostics, and implementations: the LSP projection model (sourcemap composition .pui↔lowered↔TSX, position mapping,…"
sidebar:
  order: 13
---

# Chapter: Tooling, Diagnostics, LSP & Conformance

&gt; **Status of this chapter:** Mixed. The LSP projection model, sourcemap composition, diagnostic projection, semantic highlighting, the catalog-as-single-source codegen, and the parity/pin contract are **Shipped**. The conformance-suite/capability-levels, structured-diagnostic schema, spec-versioning lifecycle, `explain` lowering tooling, totality-coverage tooling, and machine-readable surface manifest in *Proposed extensions* are **Proposed**.
&gt; **Cross-refs:** This is the *observation-and-verification* chapter. Every other chapter defines **behavior**; this one defines how that behavior is **surfaced to tools** and **tested against an implementation**. Surface dispatch & B1–B3 [→ ch:overview-and-surfaces]; the per-construct lowerings this chapter projects [→ ch:reactivity-core, ch:pui-component-model, ch:type-and-schema-system, ch:data-sync-and-authority, ch:sources-async-and-native]; the parse-gate validation it narrows [→ ch:errors-results-and-validation]; codegen of the spine's projections [→ ch:modules-projections-and-build]; the lexical guards the highlighter mirrors [→ ch:lexical-and-expression-syntax].

---

## 0. What this chapter owns

A language is only as trustworthy as the tools that observe it and the tests that verify it. This chapter specifies the **quality-assurance and extensibility seam** of Para: the contract between *Para the spec*, the editors that render it, the diagnostics that flag it, and the *implementations* that must conform to it.

Three obligations live here, and nowhere else:

1. **Observation.** A Para file is not host TypeScript and not host Svelte; an editor cannot run `tsc` or `svelte-language-server` on it directly. This chapter specifies the **projection model** — how a `.pui`/`.pts` file is lowered to a host artifact the standard toolchain accepts, how positions are mapped back so diagnostics land on the *authored* token, and which diagnostics are *suppressed* because they belong to projection scaffolding rather than to user code.

2. **Single source of surface.** Highlighting, the LSP's known-identifier allowlist, the TextMate grammars, the snippets, and (proposed) the spec's own reference grammar are all **generated from one catalog** — `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1]. This chapter specifies that catalog *as a contract*: its `EntryKind`/`CaptureScopes` model, the codegen passes, and the CI gate that forbids surface drift.

3. **Conformance.** The spec must be **falsifiable against an implementation**. Today the ParaBun parser is the source of truth (B1) and JS mirrors are tested against it (B2/B3) [→ ch:overview-and-surfaces §3]. This chapter specifies that mechanism precisely and — in *Proposed extensions* — **inverts it**: a normative conformance corpus and capability levels under which *the spec* is the source of truth and *any* implementation (ParaBun included) is the thing under test.

The load-bearing global invariants this chapter operationalizes:

- **I1 (glass floor)** becomes *interactive*: §6.4 (`explain`) shows the ejectable TS for any construct on hover; the diagnostic projection (§3) never squiggles the lowering itself.
- **I3 (totality without silent `any`)** becomes *mechanical in-editor*: §6.5 maps every schema field to its projections and flags any unaccounted-for path.
- **B1–B3 (parser-is-truth → parity)** become a *spec-anchored conformance lattice*: §6.1 promotes the corpus from "match the parser" to "match the spec."

&gt; **INV-tooling-1 (no tool invents surface).** No editor, LSP, linter, or grammar may recognize a Para construct that is not in the catalog (`src/language-surface.ts`) or, once §6.6 ships, the generated surface manifest derived from it. A construct that highlights but does not parse — or parses but does not highlight — is a **drift bug**, caught by the codegen CI gate (§2.3), never shipped. This is the tooling-layer statement of "the catalog is the single source."

---

## 1. The LSP projection model

An editor wants TypeScript-grade intelligence — hover, diagnostics, completion, go-to-definition — on a file the TypeScript language service has never heard of. The Para LSP achieves this by **projecting** the Para source onto a host artifact the embedded TS service *does* accept, querying the service in projected coordinates, and **mapping the answers back** to authored coordinates. The whole apparatus is a position-faithful transform plus a sourcemap.

### 1.1 Two projection paths

The projection target depends on the surface (dispatch is [→ ch:overview-and-surfaces §4]):

```
ProjectionPath ::= PtsPath | PuiPath
PtsPath        ::= ⟨.pts-family⟩  "→ TS (one-pass, position-preserving)"   "→ embedded tsserver"
PuiPath        ::= ⟨.pui⟩  "→ lowered Svelte (MagicString)" "→ TSX (svelte2tsx)" "→ embedded tsserver"
```

- **`.pts`-family path.** A single position-preserving source-to-source pass (`transformParabunToTS`) rewrites every Para construct to host TS that references injected helper declarations, then hands the result to the embedded TS service under a virtual `.ts`/`.tsx` path. Because the rewrite is *column-stable* (§1.3), most positions map by identity; the few that shift are recorded by line.
- **`.pui` path.** A two-map chain (§1.4): the reactivity/script lowering produces lowered Svelte over a whole-file `MagicString` (carrying a real v3 map), then `svelte2tsx` produces typed TSX (carrying a second v3 map). The two maps compose for column-accurate bidirectional mapping.

&gt; **INV-tooling-2 (the projection is never the answer).** The projected artifact exists *only* to be type-checked and queried; it is never shown to the user and never the unit a diagnostic is reported against. Every result the TS service returns in projected coordinates is mapped back to authored coordinates before it leaves the LSP (§1.5), and any result that maps to *generated-only* scaffolding is dropped (§3.2). A diagnostic at a projected position with no authored origin is, by definition, not a user error.

### 1.2 The `.pts` desugaring passes (LSP fast-pass projection)

`transformParabunToTS` runs only when `containsParabunSyntax` matches (a single combined regex over the catalog's surface forms); a pure-host file is returned unchanged — the LSP's restatement of the superset-closure invariant [→ ch:overview-and-surfaces, INV-overview-4]. The pass order is normative because later passes consume earlier output:

```
# Desugar:  .pts LSP projection (transformParabunToTS, in order)
1. transformModelDeclBlock     schema NAME { … }     →  type NAME = { … }; const NAME: {parse,schema} = …
2. transformSchemaEqualsBlock  schema NAME = { … }   →  const NAME = __paraFromSchema(() => ({ … }))
3. transformInlineSchemaExpr   schema { … }          →  __paraFromSchema(() => ({ … }))
4. transformThrowExpr          OP throw E            →  OP (() => { throw E; })()
5. transformMatchBlock         match E { … }         →  ((__m: any): any => null as any)(E)
6. transformIsTypeGuardSource  x is T / x is not T   →  __paraIs_T(x) / !__paraIs_T(x)
7. per-line: fun/memo/pure/:: /signal/effect/prop/derived/arena/parallel/when/..&/..!/~>/->/|>
8. injectIsHelpers             prepend  const __paraIs_T = (v): v is T => (T as any).parse(v).tag === "Ok"
9. injectSchemaHelper          prepend  declare function __paraFromSchema<S>(s:()=>S): {parse,is,schema} & S
```

**Static semantics.** The projection's job is to produce *valid, position-stable TS that type-checks like the construct would*, not to reproduce the runtime lowering. Three families of synthetic declaration carry the Para semantics into tsc:

- **`__paraFromSchema<S>`** (§ steps 1–3, 9). A `schema NAME = { … }` projects to a call whose return type is `{ parse, is, schema } & S` where `S` is the JSON-Schema body literal. This is what makes `NAME.parse`, `NAME.is`, `NAME.schema`, and field accessors resolve at the call site without per-file `.d.ts` shims [→ ch:type-and-schema-system]. The block form additionally emits a `type NAME = (typeof NAME)["schema"]` alias so `NAME` is usable in *type* position; the alias deliberately resolves to the **unwrapped** body (not the helper intersection), measured to roughly halve cold-check time on heavy `PostgresTableModel<S>` generics because tsc no longer walks both sides of the `{…} & S` intersection on every `keyof`/`T['properties']` lookup.
- **`__paraIs_T`** (§ steps 6, 8). `x is T` projects to a call to a prepended **user-defined type predicate** `(v: any): v is T => (T as any).parse(v).tag === "Ok"`. The predicate shape is load-bearing: it is exactly what lets tsc **narrow** `x` to `T` inside an `if (x is T) { … }` body — the editor reproduces the parse-gate narrowing of [→ ch:errors-results-and-validation] *as a TS type-narrowing*, so the user sees `x` typed as `T` in the then-branch.
- **`match` type-stub** (§ step 5). `match E { … }` projects to `((__m: any): any => null as any)(E)`. The subject `E` is preserved verbatim and re-projected so *its* errors surface; the arm results are deliberately `any`. Per-arm result narrowing would require a sourcemap-threaded structural lowering beyond what any current Para tooling does; the stub brings the editor to the same proven parity as the build path's stripping while keeping the subject type-checked. **Status: Partial** — match narrowing is the one construct the projection does not fully type (§6.1 capability levels make this Partial-ness machine-recorded, not folklore).

&gt; **INV-tooling-3 (`::` and `is` project to the spine, not to `any`).** The validation marker `::` projects column-preserving (`req:: User` → `req:  User`, second `:` → space) so the parameter keeps its schema type, and `is` projects to a real `v is T` predicate. Neither introduces an `as`/`any` escape: the editor preserves the I3 no-silent-`any` discipline of the language it is rendering.

### 1.3 Column-preserving rewrites (why positions survive)

A keyword rewrite that *changed column counts* would force every downstream position on the line to be re-mapped. The `.pts` per-line passes avoid this by rewriting keywords to **same-width** tokens, so every column after the keyword is bit-for-bit where it was:

| Para | Projected | Width |
|---|---|---|
| `signal` (6) | `let   ` (3 + 3 sp) | 6 |
| `derived` (7) | `let    ` | 7 |
| `effect` (6) | `      ` (6 sp) | 6 |
| `prop` (4) | `let ` | 4 |
| `arena` (5) | `     ` | 5 |
| `pure ` | `    ` (spaces) | preserved |
| `::` | `: ` (second `:` → space) | 2 |
| `~>` | `= ` | 2 |
| `->` | `, ` | 2 |
| `when E {` | `if  (E) {` | column of `{` held |

`signal` projects to `let` (not `const`) because the canonical parser rewrites `NAME = x` assignments on a signal to `.set()` calls, so the projected binding must tolerate reassignment without tripping tsc's const-reassignment check. The `~>` / `->` rewrites reverse direction relative to the true desugar (`B = A` vs `A = B`), which is harmless: tsc only needs both identifiers *in scope* for resolution/hover/go-to-def, not the dataflow direction.

&gt; **Edge case (line-shifting rewrites).** A few projections cannot be width-preserving: the `fun`→`function` and statement-form `memo NAME(`→`function NAME(` rewrites shift the *declaration line* right by 4. This is sanctioned because hover/go-to-def on the *body* (different lines) is unaffected, and the synthetic schema helpers are prepended **whole-line** (never inline) so they do not perturb the source line indices diagnostics map against.

### 1.4 The `.pui` two-map sourcemap chain

`.pui` cannot be width-preserved end to end — the `signal x` bridge reorders tokens, `prop` declarations merge into one `$props()` destructure, and `svelte2tsx` rewrites the whole template. So the `.pui` projection carries **two real v3 sourcemaps**, chained:

```
raw .pui  ──lowering map (MagicString, hires)──▶  lowered Svelte
lowered   ──svelte2tsx map──▶                     generated TSX
```

The lowering map is produced by re-implementing the reactivity lowering over a **whole-file `MagicString` with segment-preserving overwrites** (`lowerPuiFileWithMap`): keyword/punctuation spans are overwritten while user identifiers and expression bodies stay in place, so they keep *exact* column mapping. Critically, `effect { BODY }` rewrites **only** the opener `effect {` → `$effect(() => {` and the matching close `}` → `})` — the (often large) body is untouched and fully mapped. `derived NAME { BODY }` does the same with `$derived.by`. Where source↔output order is inherently reordered (the `signal` bridge, the merged `prop` destructure, the `sync`/`source`/`async signal` whole-line forms), the line is overwritten whole and is line-accurate (the LSP additionally strips the `__sig_`/`__src_`/`__syn_`/`__as_` prefixes in hovers, §1.6).

Multi-line right-hand sides (`derived NAME = EXPR`, single-statement `effect EXPR`, `sync … from KEY`, `synced NAME = ARGS`) take their true extent from the **shared `derivedInitEnd` scanner** — the same scanner the build path uses — not from the line end, so a ternary/binary/object-literal that wraps across lines is bracketed correctly and its interior stays mapped.

&gt; **INV-tooling-4 (build/LSP reactivity byte-parity).** For the **reactivity** subset — `signal`, `derived` (expr + block), `effect` (block + single-statement), `prop` — the lowered `.code` is **byte-identical** to `@lyku/para-preprocess`'s proven `lowerPuiReactivity(src, '@lyku/para-ui', true)`, enforced by `test/pui-lower-parity.smoke.ts`. The LSP and the build path therefore make the *same* inline-vs-bridge decision (they import the **same** `buildEscapeChecker` escape predicate — shared, not byte-mirrored), so editor diagnostics describe the code that will actually build. This is the editor-side face of [→ ch:overview-and-surfaces, INV-overview-3].

&gt; **Edge case (two intentional, gated deltas).** Two differences from canonical are **out of the byte-identity scope by design** and excluded from the parity gate (they are *not* drift):
&gt; 1. **Operator desugars** (`pure`/`|>`/`..!`/`fun`/`is`/ranges/decimal/match-stub). The LSP applies these (via `@lyku/para-transpile/syntactic`, the Babel-free entry) so the TSX projection is *valid TS*; the canonical parser does them at build, in a different layer. Different layers — never expected identical.
&gt; 2. **Auto-injected imports** (`signal`/`promiseSignal`/`synced` runtime, `provide`/`inject`/`using`/`source`/lifecycle/nav helpers). The LSP places them **inside** the `<script>` body (line-preserving, so diagnostic lines map); canonical emits them **before** the tag. Required for LSP sourcemap accuracy; deliberately divergent.

### 1.5 Position mapping (`toGenerated` / `toOriginal`)

The `.pui` transform exposes a bidirectional mapper composed from the two `TraceMap`s:

```
# toGenerated(line, char):   raw → lowered → generated TSX     (for QUERYING tsserver)
#   l = generatedPositionFor(loweringMap, {source: raw,     line, col})
#   g = generatedPositionFor(svelte2tsxMap, {source: lowered, line: l.line, col: l.col})
#
# toOriginal(line, char):    generated TSX → lowered → raw      (for REPORTING results)
#   l = originalPositionFor(svelte2tsxMap, {line, col})
#   o = originalPositionFor(loweringMap,    {line: l.line, col: l.col})
```

Every LSP feature uses the same `resolveTsQuery` seam: it `toGenerated`-maps the cursor, offsets into the projected code, queries the TS service, and `toOriginal`-maps every returned span. `.pts`/`.svelte` use a simpler line-heuristic map; `.pui` uses the two-map chain. The two paths are unified behind one return shape so callers (hover, diagnostics, completion, definition) are agnostic to which surface produced the answer.

&gt; **Edge case (source-label mismatch).** `svelte2tsx` labels its source by the bare `filename`, while the lowering map labels its generated side `filename + ".lowered"`. `toGenerated` tries the `.lowered` label first and **retries** under the bare `filename` when the first lookup returns null — a one-line robustness rule that keeps the chain composable across the two libraries' differing source-naming conventions.

### 1.6 Hover hygiene

Because the bridge introduces backing cells, a hover can land on a synthetic name. The LSP **un-prefixes** bridge internals before display: `__sig_count` is shown under the user's name `count`. Combined with the §3.2 scaffold-diagnostic filter, this guarantees the user never sees a projection internal — the glass floor (I1) is *opaque to the editor's incidental machinery* even though it is *transparent on demand* (§6.4).

---

## 2. The catalog as the single source of surface

### 2.1 The `LanguageEntry` model

`src/language-surface.ts` is the one place a Para construct's *surface* is described. Every entry is a `LanguageEntry`:

```
LanguageEntry ::= {
  id:           Ident,                  ⟨stable catalog key, never user-visible⟩
  doc:          StringLit,              ⟨one-line description; becomes the grammar `comment` + generated docs⟩
  kind:         EntryKind,
  languages?:   Language[],             ⟨default: all four .pts-family extensions⟩
  pattern:      Regex,                  ⟨the recognizer⟩
  scopes?:      CaptureScopes,          ⟨capture-group index → TextMate scope⟩
  name?:        Scope,                  ⟨single-scope fallback when pattern has no captures⟩
  lspAllowlist?: bool,                  ⟨contribute the token to the fast-pass known-identifier set⟩
  tests?:       StringLit[],            ⟨canonical behavior-pinning test files⟩
  snippet?:     StringLit,              ⟨emit a VS Code snippet⟩
  inject?:      bool                    ⟨default true: contribute to the inject grammar⟩
}
EntryKind     ::= "keyword" | "operator" | "refinement-type"
                | "primitive-type" | "constructor" | "constant"
Language      ::= "pts" | "ptsx" | "pjs" | "pjsx"
CaptureScopes ::= Record<CaptureIndex, Scope>     ⟨1-indexed, as TextMate expects⟩
```

`EntryKind` is the routing key: `keyword`/`constructor`/`constant` entries appear in the TextMate grammar **and** the LSP allowlist; `operator` entries appear in the grammar only; `refinement-type`/`primitive-type` appear in the grammar as type-position-only patterns. **Order matters**: the array is in inject-grammar order (TextMate stops at first match), so more-specific compounds (`pure async fun`) precede less-specific ones (`pure`), and multi-char operator glyphs (`..=`, `..!`, `..>`) precede the bare `..` range.

### 2.2 Codegen passes

`scripts/codegen.ts` is the one-shot runner; each generator consumes the catalog and writes an auxiliary surface:

```
# Desugar:  catalog → auxiliary surfaces (scripts/codegen.ts)
generate-grammars.ts          →  TextMate inject + per-extension main grammars (editor + para-site)
generate-lsp-allowlist.ts     →  the marked block of KNOWN_GLOBAL_IDENTIFIERS in parabun-lsp.ts
generate-splash-highlighter.ts→  the splash demo keyword regex (para-site transpile.js)
```

The LSP allowlist generator is illustrative of the contract: it reads `LSP_ALLOWLIST_TOKENS` from the catalog and rewrites **only** the text between two markers in `parabun-lsp.ts`:

```ts
// ─── codegen:lsp-allowlist:begin ──
"_", "signal", "derived", "effect", "source", "when", "arena", "memo",
"defer", "schema", "match", "pure", "Ok", "Err", "Some", "None", "para", "parallel",
// ─── codegen:lsp-allowlist:end ──
```

Everything outside the markers — the hand-curated JS/Web/Bun globals (`window`, `fetch`, `Bun`, …) — is preserved exactly. This is what lets the fast-pass `Cannot find name` scanner (§3.1) treat a bare `signal`/`Ok`/`_` as a known identifier rather than flagging it: the allowlist is *generated from the same catalog that defines the keyword*, so a new keyword cannot highlight-but-flag.

### 2.3 The drift gate

```
# Desugar:  the CI invariant
bun scripts/codegen.ts            # regenerate all auxiliary surfaces
bun scripts/codegen.ts --check    # exit non-zero if any committed output differs
```

**Static semantics (INV-tooling-1, operational form).** `codegen.ts --check` is a CI stage. It re-runs every generator into memory and diffs against the committed files. Any catalog change that was not accompanied by a regen fails the gate, and any hand-edit *inside* a marker block fails it too. The gate is the mechanical guarantee that the grammar, the LSP allowlist, the snippets, and the splash highlighter can never disagree with the catalog — and, once §6.6 ships, that the *spec's own grammar* cannot either.

&gt; **Edge case (the `_` meta-entry).** The underscore-lambda placeholder has `pattern: (?!)` (matches nothing) and `inject: false` — it contributes **no** syntactic highlight (it must look like a normal identifier) but **does** contribute `lspAllowlist: true`, so the fast-pass scanner accepts a bare `_` in expression position (`arr.filter(_ > 0)`) without a `Cannot find name`. The catalog models "recognized by one tool, invisible to another" as a first-class entry rather than a special case scattered across tools.

### 2.4 Semantic highlighting

Beyond TextMate (which is regex-static), the LSP emits **semantic tokens** for the two cases regex cannot resolve: `pure` functions (and their *call sites*, which require knowing which names are pure) and **signal-bound identifier references** (every read/write/method-receiver of a `signal NAME`, declaration site included, gets the `signal` modifier; property-access positions like `foo.count` are skipped). Plain identifiers in `.pui` additionally get TS-derived tokens (via the projection) so ordinary variables are not left unhighlighted. Token emission is sorted to strictly-ascending order and exact-overlap-deduped, as the protocol requires.

---

## 3. Diagnostic standards

Para diagnostics come from four producers, each in its lane: the **fast pass** (cheap, syntactic, ~5 ms — typos and unknown identifiers), the **TS service** (semantic, via the projection, possibly cold for tens of seconds), the **template/style** checks (`.pui`/`.svelte` markup well-formedness + embedded CSS/SCSS/Less/Sass), and **ParaBun parse diagnostics** (`Bun.Transpiler` over already-desugared content). The discipline is uniform: surface the cheap honest diagnostics immediately, map the expensive ones back faithfully, and **never** report a diagnostic against projection scaffolding.

### 3.1 The fast-pass `Cannot find name` scanner

`findUnknownIdentifierDiagnostics` is a deliberately conservative, parser-free scan that catches the single most common error class — a referenced identifier that is not imported, declared, a parameter/catch-binding, or a known global — within ~270 ms of typing, instead of waiting on the cold semantic pass. **Conservative on purpose: a false positive squiggle erodes trust more than a missed catch helps**, so the scanner is over-permissive (it builds an *allowlist* of in-scope names and only flags a use absent from it).

It is correct precisely because of the catalog (§2.2): the allowlist seeds from `KNOWN_GLOBAL_IDENTIFIERS`, whose Para-token region is generated from `LSP_ALLOWLIST_TOKENS`. The scanner masks strings/comments/regex/templates length-preservingly (offsets stay valid), then skips positions it cannot resolve without a real type-checker: after `.`, in `typeof`/`keyof`/`infer`/`extends`/`implements`/`new`/`as` position, JSX tag names, declaration sites, and object-literal keys.

```
# Desugar (diagnostic):  unknown-identifier (fast pass)
Para:
    const u = schsharedDraft.parse(x);      // typo
Diagnostic:
    { severity: 1, source: "parabun", code: "parabun-unknown-identifier",
      message: "Cannot find name 'schsharedDraft'", range: ⟨exact token span⟩ }
```

For `.pui`, the scanner first **masks everything outside parabun `<script>` bodies** (`maskOutsideParabunScripts`, length-preserving) so markup tag/attribute names cannot false-positive and offsets stay absolute — without which `.pui` got *no* fast undefined-name detection and a typo could slip through entirely until the unreliable cold pass.

### 3.2 Scaffold-diagnostic suppression (the I1 firewall)

The `.pui` projection emits identifiers and imports the *user did not write* — bridge internals (`__sig_*`, `__src_*`, `__v`), `svelte2tsx` machinery (`svelteHTML`, `__sveltets_*`, the `///<reference types="svelte" />`), and the injected runtime/rune globals (`@lyku/para-*`, `$props`/`$state`/`$derived`/`$effect`/…). These are ambient in a correctly-typed workspace and **non-actionable** in a `.pui`. The LSP drops them by message pattern *and* by mapping:

```
PUI_SCAFFOLD_DIAG ::= /Cannot find name '(svelteHTML | __sveltets_… | $props|$state|$derived|$effect|… |
                       __parabunRange… | __paraDec)' | Cannot find type definition file for 'svelte' |
                       Cannot find module '@lyku/para-(ui|signals|preprocess)'/
```

Two filters, applied to every projected diagnostic:
1. **Message filter** — drop if it matches `PUI_SCAFFOLD_DIAG` or names a `__sig_*`/`__v` bridge internal.
2. **Mapping filter** — drop if `toOriginal` returns null for its start (a generated-only span with no authored origin is, by construction, not user code).

&gt; **INV-tooling-5 (the glass floor is never the squiggle).** No diagnostic produced by the projection's own scaffolding — the synthetic helpers (§1.2), the bridge cells (§1.4), the svelte2tsx machinery, or the injected imports (§1.4 delta 2) — may reach the user as a Para diagnostic. The lowering (I1) is *readable on demand* (§6.4) and *invisible by default*. Genuine user errors (wrong types, real missing user identifiers/modules) are outside the filter and surface normally.

### 3.3 Severity and source uniformity

Every diagnostic carries a `source` (`"parabun"` for fast-pass, `"ts"` for projected — prefixed `TS<code>:`, `"css(sass)"`/etc. for style), a `severity` (Error/Warning/Info mapped from the TS category), an exact `range`, and — for Para-native diagnostics — a stable `code` (e.g. `parabun-unknown-identifier`). The TS-service work is offloaded to a `--tsc-helper` subprocess so the main event loop stays responsive (hover, completion, fast-pass diagnostics keep working mid-validate); cancellation is *implicit by versioning* — a helper response whose document version no longer matches the latest content is discarded. §6.2 promotes this `{source, code, severity, range, message}` shape into a **normative structured-diagnostic schema** uniform across CLI/LSP/CI.

### 3.4 Template & style diagnostics

`.pui`/`.svelte` markup gets a well-formedness scan (v1: unclosed parabun-flavored `<script>` → "missing `</script>`"), and `<style lang>` blocks are dispatched to the same `vscode-css-languageservice` Svelte's own LSP uses (CSS/SCSS/Less) or dart-sass (indented Sass), with block-local diagnostics offset back to file-global coordinates. These complete the "every region of a `.pui` is observed" obligation: script via the projection, markup via the well-formedness scan, style via the CSS service.

---

## 4. The parity & pin contract (B1–B3) — today's conformance

Para's *current* conformance mechanism is the JS-mirror parity contract [→ ch:overview-and-surfaces §3]. This chapter specifies it as a *test discipline*, because §6.1 generalizes it.

- **B1.** The canonical ParaBun parser (historically Zig, ported to Rust) is the single source of truth for Para→TS desugaring. A parity mismatch means the **mirror** is wrong, never the corpus.
- **B2.** The coupling is **versioned**: `airgap/para` pins an exact parser release (`.parabun-pin` = `{version, sha256, asset-url-pattern}`, realized as the lockfile-pinned `@lyku/parabun-bin` carrier). Bumping the pin is a deliberate, reviewed PR.
- **B3.** Parity is **CI-blocking**: the `parity` project runs the desugaring corpus two ways — *canonical* (the pinned binary transpiling the Para input) and *mirror* (`@lyku/para-transpile`) — and asserts equality. Byte-equality where the corpus asserts it (the harness deliberately emits parser-matching synthetic names: `__pm`, `__pcv`, `__sig_`, `__syn_`, `__src_`, `__as_`, `__pu`, `__pb0…`, `__paraDefer0`), semantic equality where noted.

**Corpus scoping.** The corpus is the *syntax-lowering* subset (~25 of the 65 `parabun-*.test.js`: `extensions`, `lexer`, `parser`, `match`, `pipeline*`, `pure`, `purity`, `is`, `range`, `decimal-literal`, `result`, `then-operator`, `throw-expr`, `underscore-lambda`, `when-block`, `derived-keyword`, `defer`, `memo`, `signals`, `schema-dsl`, `conformance`, `call-bind`, `rbind`) — these assert Para→TS desugaring and *are* the B1 contract. The ~40 *runtime-module* tests (`gpu-*`, `llm*`, `image`, `audio`, `simd`, `gguf*`, …) test native runtime, have no JS mirror, and stay in the fork.

**Two mirror classes.** `@lyku/para-transpile` mirrors the **parser** and is parity-gated. `para-preprocess`'s `lowerPuiReactivity` bridges into **Svelte runes** — a substrate transform the parser does not perform — so it is **outside** the B1 byte-contract (there is no canonical byte-target to equal); its faithfulness is instead pinned to itself by the build/LSP byte-parity smoke (INV-tooling-4). A **nightly canary** runs the corpus against the *latest* (not pinned) release and reports — never fails — early-warning drift.

&gt; **Edge case (three disagreement classes).** (1) Byte mismatch on a parity-asserted fixture → the mirror is wrong, fix the mirror. (2) Byte mismatch where the corpus asserts only semantic equality (import placement, trailing whitespace) → sanctioned, recorded in fixture metadata, not a failure. (3) The mirror produces *valid* output the canonical parser would not, or vice-versa → a parser/spec ambiguity, escalated as a **spec bug**, never silently absorbed. Class (3) is exactly the seam §6.1 widens: when the spec is the source of truth, class (3) is adjudicated against the *spec corpus*, not the parser.

---

## Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new tooling/spec surface, not shipped today). Each includes a desugaring/mechanism sketch so it remains glass-floor-compatible (I1) and grounded in an existing seam. They are introduced *here* because each concerns how Para is **observed or verified** as a whole, rather than the behavior of a single construct. The throughline: promote today's *parser-is-truth* (B1) into *spec-is-truth*, and make I1/I3 mechanically interactive in the editor.

### 5.1 Normative conformance suite + capability levels — `Para N.x conformant` for any implementation  `Proposed`

**Rationale.** Today "conforms to Para" means "passes parity against the pinned ParaBun binary" (B1). That makes ParaBun definitionally correct and every other implementation a second-class mirror — the inverse of the spec's authority model, which says *Para the spec* is authoritative and *implementations conform* [→ ch:overview-and-surfaces §3.1]. A net-new, spec-owned, implementation-agnostic **conformance suite** with **capability levels** inverts this: the suite *is* the contract, ParaBun is one implementation tested against it, and a future implementation can claim `Para 1.2 conformant @ Level Full` by passing the same fixtures — discharging the falsifiability demand without privileging any engine.

**Grammar.** A conformance fixture is a declaration-only `.conform` document (a restricted Para surface; it lowers to a plain JSON test manifest):

```
ConformSuite  ::= ConformDecl*
ConformDecl   ::= "conform" FixtureId Level "{" ConformBody "}"
Level         ::= "core" | "reactive" | "schema" | "sync" | "full"
ConformBody   ::= InputDecl OracleDecl FlagDecl*
InputDecl     ::= "input" Surface StringLit ";"          ⟨Para source under test⟩
OracleDecl    ::= "lowers" ("bytes" | "semantic") StringLit ";"   ⟨expected glass-floor output⟩
              |   "diagnoses" DiagCode At ";"            ⟨expected structured diagnostic, §6.2⟩
              |   "evaluates" StringLit ";"              ⟨expected runtime value, for runtime fixtures⟩
FlagDecl      ::= "requires" FeatureFlag ";"             ⟨gated by §6.3⟩
Surface       ::= "pts" | "ptsx" | "pjs" | "pjsx" | "pui" | "para"
DiagCode      ::= Ident                                  ⟨a §6.2 diagnostic code⟩
At            ::= "at" Int ":" Int
FeatureFlag   ::= Ident
```

**Capability levels** are a *lattice*, each subsuming the lower: `core` (lexical + expression operators + `match` literal/ctor arms), `reactive` (`signal`/`derived`/`effect`/`when` + the `.pui` runes bridge), `schema` (all six schema forms + `::`/`is` narrowing + `Infer`), `sync` (`sync`/`synced` + reconcile + authority), `full` (every Shipped construct including `Partial` ones at their spec'd partiality). An implementation declares the highest level whose fixtures it passes; a construct marked `Partial` in the spec (e.g. `match` non-literal narrowing, §1.2) ships a fixture asserting *exactly its partial behavior*, so partiality is conformance-tested rather than excused.

**Static semantics.** Each fixture names an `input` (Para source), an `oracle` (the expected lowering bytes/semantics, the expected structured diagnostic, or the expected runtime value), and optional `requires` feature flags (§6.3). A `lowers bytes` oracle asserts the implementation's glass-floor output is byte-identical (the same discipline B3 uses, but the *expected bytes live in the spec corpus*, not in a parser run); `lowers semantic` asserts AST-equivalence modulo the sanctioned deltas of §4. The suite is **closed and versioned**: a fixture references a spec version (§6.3), and `core`-level fixtures may not use a construct introduced above `core`. ParaBun's existing parity corpus becomes the *seed* of the `core`/`reactive`/`schema` levels; the ParaBun pin (B2) flips meaning — it pins *which spec version's suite* ParaBun is tested against, not *which parser is truth*.

**Dynamic semantics / runner.** The runner is implementation-supplied (a `paraconf` adapter): given a fixture, it lowers/evaluates the `input` and compares to the `oracle`. The spec ships the fixtures + an LSP/CLI-shaped report (§6.2 structured diagnostics on failure).

```
# Desugar (proposed):  conformance fixture
Para (signals.conform):
    conform signal-bridge reactive {
      input pui "<script>signal count = 0;</script>{count}";
      lowers semantic "let count = $state(0);";
      requires reactive-bridge;
    }
JSON (.conform.json — what `paraconf` consumes):
    { "id": "signal-bridge", "level": "reactive",
      "input": { "surface": "pui", "src": "<script>signal count = 0;</script>{count}" },
      "oracle": { "kind": "lowers", "mode": "semantic", "expected": "let count = $state(0);" },
      "requires": ["reactive-bridge"] }
```

**Interaction.** This is the inversion B1's edge-case (3) anticipated: a mirror-vs-canonical disagreement that is "a parser/spec ambiguity" is now adjudicated against the **spec corpus**, with ParaBun as a (possibly failing) participant rather than the oracle. It composes with §6.2 (the `diagnoses` oracle uses the structured-diagnostic schema), §6.3 (`requires` gates fixtures by feature flag/version), and §6.6 (the reference grammar's productions are themselves conformance-tested via `core` fixtures).

```para
// http.conform — a schema-level fixture: `::` boundary validation must narrow
conform validate-marker schema {
  input pts "fun h(req:: User) { return req.email; }";
  lowers semantic "function h(req) { req = throwOnErr(User.parse(req)); return req.email; }";
  diagnoses none;
}
```

```para
// ✗ counter-example
conform pipeline core {
  input pts "x |> f |> g";
  lowers semantic "g(f(x))";
  requires sync-class-b;   // ✗ error: a `core`-level fixture may not require an above-core feature
}
```

### 5.2 Structured, schema-projected diagnostics — errors as data, uniform across CLI/LSP/CI  `Proposed`

**Rationale.** Today a diagnostic is a freeform `message` string with an ad-hoc `code` (`parabun-unknown-identifier`) and a `range`; the TS-projected ones are `TS<n>: <text>`. There is no *machine-readable path* into the offending construct, no stable code namespace, and no shared shape across the fast pass, the projected pass, and CI. A spine language whose whole pitch is "errors are values, totality is mechanical" (I3) should make its *own* diagnostics values too: a **schema-projected diagnostic** — a `Result`-shaped record with a stable code, a structured path into the source model, and a severity — emitted identically by CLI, LSP, and CI.

**Grammar / shape.** The diagnostic is itself a Para `schema` (errors are schemas too, per [→ ch:errors-results-and-validation]):

```
schema Diagnostic {
  code:     DiagCode,             // stable, namespaced: "para/E1003"
  severity: "error" | "warning" | "info",
  message:  str,                  // human text (may be localized)
  path:     [PathSeg],            // structured route into the construct
  range:    Range,                // authored coordinates (post toOriginal)
  related:  [Related]?,           // secondary spans (e.g. the declaration)
  fix:      CodeAction?           // optional machine-applicable edit
}
PathSeg  ::= { kind: "file"|"schema"|"field"|"handler"|"signal"|"arm", name: str }
DiagCode ::= "para/" ("E"|"W"|"I") Int    ⟨E = error, W = warning, I = info⟩
```

**Static semantics.** Every diagnostic-producing site is assigned a **stable code** in the `para/*` namespace, registered in a spec appendix (so `para/E1003` means the same thing in every implementation and every version, the way TS codes do). The `path` is a structured route — `[{schema:"Cart"},{field:"price"}]` — not a string, so a consumer (a CI annotation, an LSP code-action, a totality dashboard §6.5) can index by construct without re-parsing the message. The schema-projection is load-bearing: because `Diagnostic` is a Para schema, its wire form, its TS type, and its JSON projection all derive from the one declaration (the spine discipline applied to the toolchain itself).

**Dynamic semantics / desugar.** The fast pass, the projected pass, the conformance runner (§6.1), and CI all emit `Diagnostic` values; the LSP projects them to `LspDiagnostic` (its existing `{range, severity, source, message, code}` is the lossy view), the CLI projects them to a TTY renderer, CI projects them to GitHub-annotation JSON. One producer shape, three sinks.

```
# Desugar (proposed):  structured diagnostic, three sinks
Para diagnostic value:
    Err({ code: "para/E1003", severity: "error",
          message: "Cannot find name 'schsharedDraft'",
          path: [{kind:"file",name:"draft.pts"}], range: ⟨…⟩ })
LSP sink:    { severity: 1, source: "para", code: "para/E1003", message: "…", range: ⟨…⟩ }
CLI sink:    draft.pts:12:9  error[para/E1003]  Cannot find name 'schsharedDraft'
CI sink:     ::error file=draft.pts,line=12,col=9,title=para/E1003::Cannot find name…
```

**Interaction.** This is the format §6.1's `diagnoses` oracle asserts against (a fixture says `diagnoses para/E1003 at 12:9`), the format §6.5's totality tool reports unaccounted fields in (`para/E3xxx`, "field has no projection"), and the format §6.3's lifecycle reports use of a `Proposed` construct in (`para/W2xxx`, "experimental feature behind flag"). It discharges A2/A4 at the tooling layer: a typed-auth-context leak or a hand-rolled-validation gap is reported as a *coded, path-addressed* value, not a string a CI script greps for.

### 5.3 Spec-versioning + feature-flag lifecycle — `Shipped`/`Partial`/`Proposed` as a real model  `Proposed`

**Rationale.** Today `Shipped`/`Partial`/`Proposed` are *prose tags* in the spec (§0; this chapter uses them). They have no machine reality: an implementation cannot declare *which* version it targets, a fixture (§6.1) cannot gate on *when* a construct shipped, and a `.pui` cannot opt into a `Proposed` construct behind a flag. Promoting the tags to a **lifecycle with a version axis and feature flags** lets the language evolve without silent drift: a construct moves `Proposed → Partial → Shipped` across spec versions, fixtures bind to a version, and `Proposed` surface is usable only behind an explicit flag.

**Grammar.** A workspace declares its target spec version and enabled flags in the `.para` manifest [→ ch:overview-and-surfaces §5.1]:

```
SpecDecl    ::= "spec" Version FlagBlock?
Version     ::= Int "." Int                       ⟨major.minor, e.g. 1.2⟩
FlagBlock   ::= "{" (FlagDecl ";")* "}"
FlagDecl    ::= "feature" FeatureFlag Lifecycle
Lifecycle   ::= "shipped" | "partial" | "proposed"
FeatureFlag ::= Ident                             ⟨a construct/feature id from the surface manifest §6.6⟩
```

**Static semantics.** `spec 1.2` binds the workspace to that version's surface manifest (§6.6) and conformance suite (§6.1). A construct's lifecycle is a fact in the manifest, keyed by version: `match-object-pattern` may be `proposed` in 1.1, `partial` in 1.2, `shipped` in 1.3. Using a construct whose lifecycle at the target version is `proposed` is an **error unless** the workspace `feature`-enables it (`para/W2001`, §6.2, downgrades to a warning when enabled); using a `partial` construct outside its spec'd partial subset is an error citing the partiality (e.g. `match non-literal arm narrowing is partial in spec 1.2; arm results type as any`). This makes §1.2's `match` Partial-ness a *versioned, machine-checked* fact rather than a comment.

**Dynamic semantics / desugar.** Erased — `spec`/`feature` are manifest config, gating the checker and the conformance runner; no runtime cost.

```
# Desugar (proposed):  spec version + feature flag
Para (app.para):
    spec 1.2 {
      feature match-object-pattern proposed;   // opt into a not-yet-shipped construct
      feature sync-class-b shipped;
    }
TS (.para.config.ts):
    export const __paraSpec = { version: "1.2",
      features: { "match-object-pattern": "proposed", "sync-class-b": "shipped" } };
```

**Interaction.** The lifecycle is the axis §6.1 fixtures bind to (`conform … { … } @spec 1.2`) and the gate §6.6's manifest is versioned by; it composes with §6.2 (lifecycle violations are coded `Diagnostic`s) and with the `.para` manifest's other blocks [→ ch:overview-and-surfaces §5]. It is the mechanism that lets the spec ship a `Proposed` construct (like everything in these *Proposed Extensions* sections) *experimentally*, behind a flag, conformance-tested at its declared lifecycle, before promoting it to `Shipped` — evolution without the silent drift B1–B3 exist to prevent.

### 5.4 `explain` lowering tooling — make the glass floor (I1) interactive  `Proposed`

**Rationale.** I1 says every construct has a readable, ejectable lowering, and §3.2 guarantees the editor *hides* that lowering's incidental scaffolding. But the lowering itself — the actual glass-floor TS a developer would read to override a projection — is only visible if you run the build and open the output. The hover already shows *prose* docs for a construct (§ the `getParabunHover` docs for `schema`/`match`/`is`/`effect`). **`explain` promotes that to the real lowering**: hover (or a code-lens / `para explain` CLI) shows the exact glass-floor TS/runes for the construct under the cursor, computed from the same projection the editor already runs. I1 stops being a promise you verify by building and becomes a thing you *see on demand*.

**Grammar (request, not source).** `explain` is an LSP request + CLI verb, not a language construct:

```
ExplainReq   ::= "explain" Target ExplainOpt*
Target       ::= Position | Range | ConstructId
ExplainOpt   ::= "--runes" | "--ts" | "--imports" | "--depth" Int
```

**Static semantics.** Given a position, the tool finds the smallest enclosing Para construct, runs the *existing* projection for the surface (the `.pts` `transformParabunToTS` passes §1.2, or the `.pui` `lowerPuiFileWithMap` §1.4), and returns the lowered span — mapped through the sourcemap so the explanation aligns token-for-token with the source. For `.pui` it can show both `--runes` (the bridge: `$state`/`$effect.pre`/`onDestroy`) and `--ts` (the spine projection) since the two targets differ (I2 seam). `--imports` includes the auto-injected runtime imports (§1.4 delta 2). The output is the *real* lowering (re-using the build/LSP byte-parity of INV-tooling-4), so what `explain` shows is what ejecting would give you.

**Dynamic semantics / desugar.** None — `explain` reads the projection; it produces no code in the program.

```
# Desugar (proposed):  explain on `sync user :: User from `user:${id}``
explain → (runes):
    const __syn_user = synced(`user:${id}`, User);
    let user = $state(__syn_user.peek?.() ?? __syn_user);
    $effect.pre(() => __syn_user.subscribe?.((__v: typeof user) => { user = __v; }));
    onDestroy(() => __syn_user.dispose?.());
    // + import { synced } from "@lyku/para-sync";    (with --imports)
```

**Interaction.** `explain` is the interactive face of I1 and the natural pair to §3.2: the firewall *hides* the scaffolding by default, `explain` *reveals* the lowering on request. It re-uses the §1 projection wholesale (no second lowering to drift — INV-tooling-1), feeds §6.5 (a field's "explain" includes its projections), and is itself conformance-tested (a §6.1 `lowers` oracle is exactly "what `explain` would show"). It is how "outgrowing an opinion means reading the lowering" [→ ch:overview-and-surfaces §0, I1] becomes a one-keystroke act rather than a build-and-grep.

### 5.5 Totality-coverage tooling — map every field to its projections (mechanical I3)  `Proposed`

**Rationale.** I3 says all data is accounted for end-to-end (db ⇄ api ⇄ client ⇄ validation ⇄ wire ⇄ live state) and that gaps are explicit, never silent. The spec asserts this is *verifiable* ("the model is diffable against the live database"). But in the editor, "is field `Cart.price` actually projected onto the wire codec, the API contract, the client type, and the reconciler?" is invisible — you discover a gap when something breaks. **Totality-coverage tooling** makes I3 mechanical and in-editor: for every `schema` field, it computes the set of projections [→ ch:modules-projections-and-build] that consume it and flags any field with an **unaccounted-for** path (declared but unprojected, or projected-but-unvalidated).

**Grammar (request + report).** A request + a projected report (`para coverage`, or an LSP code-lens per schema):

```
CoverageReq  ::= "coverage" Target CoverageOpt*
CoverageOpt  ::= "--projections" ProjList | "--gaps-only" | "--format" Fmt
ProjList     ::= Projection ("," Projection)*
Projection   ::= "db" | "api" | "client" | "codec" | "reconciler" | "validation"
```

The report is a `Diagnostic`-shaped value (§6.2) per gap, plus a matrix:

```
schema FieldCoverage {
  schema:      str,
  field:       str,
  projections: { db: bool, api: bool, client: bool, codec: bool, reconciler: bool, validation: bool },
  accounted:   bool,        // ∀ required projections present
  gap:         DiagCode?    // "para/E3001" when !accounted
}
```

**Static semantics.** For each spine schema (the closed set, once the `.para` `spine{}` manifest ships [→ ch:overview-and-surfaces §5.1]), the tool walks every field and checks each declared projection target (the `project{}` block, [→ ch:overview-and-surfaces §5.4]) for the field's presence. A field absent from a *required* projection — e.g. a `Cart.price` that the wire codec drops, so the client can never see it — is a coverage gap reported as `para/E3001` ("field has no `codec` projection; data cannot cross the wire — silent `any` risk"). Under a `strict-totality` file [→ ch:overview-and-surfaces §5.2] a gap is a **compile error**; otherwise a warning + dashboard entry. This is the mechanical anchor that turns "accounted for" from aspirational to a build-checkable matrix — the in-editor form of the live-DB diff (A5).

**Dynamic semantics / desugar.** None — coverage reads the spine and the projection set; it is a static analysis with no runtime presence.

```
# Desugar (proposed):  coverage gap on a dropped field
schema Cart { id: UUID, items: [LineItem], price: int }
project web { codec -> "src/gen/codec.ts"; }   // codec omits `price`
coverage → Err({ code: "para/E3001", severity: "error",
  message: "field 'Cart.price' has no codec projection; cannot cross the wire",
  path: [{kind:"schema",name:"Cart"},{kind:"field",name:"price"}] })
```

**Interaction.** Coverage is the editor-resident discharge of I3 and the falsifiability surface `schema-is-the-application.md` demands: it reads the `.para` manifest's `spine{}`/`project{}` closure [→ ch:overview-and-surfaces §5.1, §5.4], reports gaps as §6.2 `Diagnostic`s, and each field's coverage row links to §6.4 `explain` (so a present projection can be *read*, a missing one *flagged*). Together with `explain` it makes the two hardest invariants — I1 (read any lowering) and I3 (no field unaccounted) — both *interactive* rather than *documentary*.

### 5.6 Formal reference grammar + machine-readable surface manifest  `Proposed`

**Rationale.** This chapter's INV-tooling-1 says no tool may invent surface beyond the catalog. But the *spec* (this document) currently restates grammar productions in prose EBNF that are **hand-written**, not generated from the catalog — so the spec's grammar and the catalog's recognizers can, in principle, disagree, exactly the drift the codegen gate (§2.3) prevents *among tools* but not *between tools and the spec*. The fix is to generate a **formal reference grammar** and a **machine-readable surface manifest** from `src/language-surface.ts`, so the highlighting, the LSP, *and the spec's own grammar* all derive from one source.

**Grammar (the manifest's shape).** The surface manifest is a generated JSON artifact (and a generated grammar appendix):

```
SurfaceManifest ::= { version: Version, entries: ManifestEntry[] }
ManifestEntry   ::= {
  id:        Ident,                 // catalog id
  kind:      EntryKind,             // keyword | operator | refinement-type | …
  surfaces:  Surface[],             // which extensions
  grammar:   Production,            // the EBNF production this entry contributes
  lowering:  LoweringRef,           // pointer to the # Desugar block (for §6.4 explain)
  lifecycle: Lifecycle,             // §6.3, per spec version
  scopes:    CaptureScopes,         // TextMate scopes (for highlighting)
  allowlist: bool,                  // LSP fast-pass contribution
  tests:     StringLit[]            // conformance fixtures (§6.1) + behavior tests
}
```

**Static semantics.** A new `scripts/generate-surface-manifest.ts` (alongside the existing grammar/allowlist/splash generators §2.2) reads the catalog and emits (a) `surface-manifest.json` (consumed by the LSP, the conformance runner §6.1, and `explain` §6.4 to locate lowerings) and (b) a **reference-grammar appendix** the spec's grammar chapter *includes by reference* rather than restates. The same `codegen.ts --check` gate (§2.3) now also guards the spec: a catalog entry without a manifest/grammar entry — or a spec grammar production with no catalog backing — fails CI. The manifest is **versioned** (§6.3): `surface-manifest@1.2.json` is the surface of spec 1.2, so the conformance suite, the lifecycle gate, and the spec text are all anchored to one generated artifact.

**Dynamic semantics / desugar.** Erased — the manifest is build/spec-time metadata; it has no runtime presence. It is the *single* artifact every other tool and the spec read for "what is the surface."

```
# Desugar (proposed):  catalog → surface manifest (one more codegen pass)
src/language-surface.ts  ──generate-surface-manifest.ts──▶
    surface-manifest@N.x.json          (LSP + conformance runner + explain read this)
    spec/95-grammar-appendix.md        (the spec INCLUDES, never restates, these productions)
# guarded by the same  codegen.ts --check  gate as the grammars/allowlist
```

**Interaction.** The manifest is the keystone that makes INV-tooling-1 total: today the catalog is the single source for *tools*; the manifest extends "single source" to the *spec itself*, so highlighting, LSP, conformance (§6.1), lifecycle (§6.3), `explain` (§6.4), and the written grammar can never disagree. It is the structural completion of the spec's authority model: the spec defines the surface, one generated artifact carries it, every implementation and every tool conforms to *that* — the final inversion of B1's "the parser is the surface" into "the manifest (generated from the spec's catalog) is the surface, and the parser conforms."

