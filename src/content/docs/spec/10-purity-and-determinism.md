---
title: "Purity, Determinism & Memoization Contracts"
description: "Para's purity model as a checkable contract: pure fun / pure async / pure arrow markers, what referential transparency obligates, the parse-time…"
sidebar:
  order: 11
---

# Chapter: Purity, Determinism & Memoization Contracts

&gt; **Status of this chapter:** Mixed. The purity *surface* — `pure fun` / `pure async fun` / `pure arrow` markers, the keyword strip, and the parse-time identifier checks the marker gates — is **Shipped** (catalog `pure-fun` / `pure-async-fun` / `pure-arrow` / `export-pure-*`; `transformPure`). The purity *contract* it declares is today an **advisory, lint-enforced** discipline (the strip is a runtime no-op); §3.1's promotion of that contract to a checked **effect lattice**, and everything else in *Proposed extensions* (§3), are **Proposed** (net-new surface, not in `src/language-surface.ts` or the parser today).
&gt; **Cross-refs:** This chapter owns the **purity contract** and its enforcement story — `pure` marker → static analysis → glass-floor strip — and the *correctness conditions* (referential transparency, determinism) that other chapters depend on but do not define. The `derived` body's purity *obligation* is stated in [→ ch:reactivity-core §2] and *enforced* here. `memo`'s runtime cache (`__parabunMemo`, identity keying, TTL/`eq` variants) lives in [→ ch:effects-lifecycle-concurrency §3.2, §3.5]; this chapter owns *when that cache is sound* (INV-effects-8 cites this chapter). A computed/`refine` field's purity over sibling fields is required by [→ ch:type-and-schema-system §-computed]; this chapter defines what "pure over siblings" means and (§3.2) makes it checkable. The boundary-validation gate `::` / `is` and `Result` flow are [→ ch:errors-results-and-validation]. Determinism of sync reconcile (the reconciler is a pure fold over `(schema_version, sequence)`) is [→ ch:data-sync-and-authority]; this chapter supplies the determinism vocabulary that chapter cites. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. Purity as a checkable contract, not a runtime feature

Para's design principle 5 says *errors are values; effects are explicit; purity is a declared, checkable contract* [→ ch:overview-and-surfaces §0]. This chapter specifies that contract. It is the smallest pillar in the language — one keyword (`pure`) and the conditions it asserts — but it is **load-bearing for three others**: `derived` is only acyclic if its body is pure (INV-react-2), `memo` is only correct if its function is referentially transparent (INV-effects-8), and a computed schema field is only reproducible on both client and DB if its expression is pure over siblings ([→ ch:type-and-schema-system]). Each of those chapters *states* a purity obligation and forwards the *meaning and enforcement* of it here. This chapter is where the obligation is given teeth.

Two definitions frame the whole chapter. They are stated once, precisely, and reused everywhere `pure` is cited.

- **DEF-pure-1 (referential transparency).** A function `f` is **referentially transparent** if every call `f(a₁…aₙ)` may be replaced by its result value without changing program behavior — equivalently, `f` (i) is **deterministic** (equal arguments produce equal results, for the value model's notion of equality), (ii) performs **no observable side effect** (no mutation visible outside the call, no I/O, no write to a reactive cell, no exception used as control flow that the caller could not have produced itself), and (iii) reads **no ambient mutable state** (no clock, no RNG, no global the caller did not pass in). Referential transparency is the *enabling* property for caching: a result that may be substituted for its call may also be *stored and reused* for that call.
- **DEF-pure-2 (purity is closed under the call graph).** `f` is pure **only if every function `f` calls is pure**. Purity is not a local syntactic property of `f`'s body; it is a property of `f`'s *transitive closure*. A `pure fun` that calls an impure helper is impure — the marker is a *claim about the whole reachable subgraph*, which is exactly why checking it (§1.3, §3.1) requires whole-program-ish effect information, not a single-function scan.

&gt; **Glass floor (I1).** `pure` is **erased** at lowering: `transformPure` rewrites `pure ` to spaces (position-preserving — 4 spaces for `pure` + the trailing whitespace, so source-map columns stay aligned) and emits the plain `function` / arrow the developer could have written by hand. The contract lives entirely in the *checker* (today a linter; §3.1 a compiler pass); the *runtime* sees no trace of it. This is the honest statement of the current surface: **the marker is a parse-time and analysis-time artifact with zero runtime cost and, today, zero runtime enforcement.** Nothing here is reflection-driven or `any`-degraded (I3).

---

## 1. `pure` — the purity marker (Shipped)

`pure` is a **modifier** prefixed to a function declaration, function expression, or arrow. It asserts that the marked function satisfies DEF-pure-1. It has **three surface combinations** with `fun`/`async`/arrow, each recognized contextually and each erased to spaces at lowering.

### Grammar

```
PureFun     ::= "export"? "pure" "async"? ("fun" | "function") FunRest
PureArrow   ::= "pure" "async"? ArrowHead "=>" ArrowBody
FunRest     ::= Ident? Generics? "(" Params ")" RetTypeAnn? Block
ArrowHead   ::= Ident                              ⟨single bare param: pure x => …⟩
              | Generics? "(" Params ")" RetTypeAnn?
```

- `pure fun NAME(…) { … }` and `pure async fun NAME(…) { … }` — declaration / expression forms (catalog `pure-fun`, `pure-async-fun`; with `export`: `export-pure-fun`, `export-pure-async-fun`).
- `pure (x) => …`, `pure x => …`, `pure async (x) => …` — arrow forms (catalog `pure-arrow`, `pure-async-arrow`).
- `pure` composes with `fun` (the `function` shorthand, [→ ch:overview-and-surfaces §1.1]) and with the host `function` keyword identically; both lower the same way.

**Lexical note (contextual recognition — superset closure).** `pure` is the keyword **only** immediately before a function-introducing token: `transformPure`'s gate is `\bpure(\s+)(?=function\b|async\s+function\b|<[\w\s,=]+>\s*\(|\(|\w+\s*=>)`. A `pure` *not* followed by `function` / `async function` / `<…>(` / `(` / `IDENT =>` is left verbatim — so an identifier named `pure` (`const pure = isPure(x)`, `obj.pure`, `pure(x)` as a *call*) is **not** rewritten. This is the surface-superset guarantee INV-overview-4: a pure-host file containing a value named `pure` is a fixed point of the lowering. The compound forms (`pure async fun`) are matched by the *same* leading `pure` rule; `async`/`fun` are recognized by their own catalog entries, and the strip handles `pure async function` because the lookahead admits `async\s+function`.

&gt; **Lexical note (ordering, for highlighting only).** In `language-surface.ts` the compound entries (`export-pure-async-fun`, `pure-async-fun`, …) are listed **before** bare `pure-arrow` so the TextMate engine captures `pure`+`async`+`fun` as one run rather than letting bare `pure` match and leaving `async fun` unscoped (§-overview notation, "more-specific precedes less-specific"). This ordering is a *highlighting* concern; the `transformPure` strip is a single regex and order-independent.

### 1.1 Static semantics

- **Binding & typing.** `pure` changes **no type and no binding structure.** `pure fun f(x: int): int { … }` has exactly the type `f` would have without the marker (`(x: number) => number`); the marker is invisible to the host type-checker (it is gone before TS sees the file). The marked function is an ordinary value. There is **no `Pure<…>` wrapper type today** (§3.1 proposes lifting purity into the type via an effect row).
- **The contract is a *declared intent*, not an inferred fact (today).** Writing `pure` *asserts* DEF-pure-1; the Shipped pipeline does not *prove* it. The assertion is consumed by (a) the parse-time identifier checks (§1.3), (b) external static analysis / lint rules the project opts into, and (c) `memo`/`derived` soundness reasoning (§2). A `pure fun` whose body in fact performs I/O **compiles and runs** — it is a *contract violation*, surfaced by the linter if one is configured, not a hard compile error. §3.1 promotes this from advisory to checked.
- **Purity is transitive (DEF-pure-2), and that is what the marker cannot locally verify.** The marker is a claim about the call-graph closure. The Shipped checks (§1.3) verify the *cheap, local, decidable* fragment of that claim (free-identifier discipline); the *expensive, transitive* fragment (does every callee's closure stay pure?) is what §3.1's effect lattice exists to decide.

### 1.2 Dynamic semantics

**None.** `pure` is erased; the emitted function has identical runtime behavior to the unmarked function. There is no wrapper, no guard, no membrane, no freeze. A `pure` function that mutates is not stopped at runtime — purity is a *static* contract, and its only runtime consequence is *indirect*: a pure function is **safe to cache, skip, reorder, or evaluate at compile time** (§2, §3.5), and those optimizations are only correct because the contract holds.

&gt; **INV-pure-1 (erasure is observationally complete).** For any function `f`, `pure f ≡ f` at runtime — same return value, same exceptions, same (absence of) side effects. Removing or adding the `pure` marker changes *no* runtime behavior; it changes only what the checker and the cache-bearing constructs (`memo`, `derived`, const-eval) are *permitted to assume*. This is the dual of INV-react-1's "reason like straight-line code": you may reason about a `pure` call *as if* it were its value, and the runtime will not contradict you (provided the contract holds — which the linter, and §3.1 the compiler, exist to ensure).

### Desugar

```
# Desugar:  pure fun NAME(ARGS) { BODY }
Para (.pts):
    pure fun normalize(name: string) { return name.trim().toLowerCase(); }
TS (.pts):
        function normalize(name: string) { return name.trim().toLowerCase(); }
    //  ^^^^ `pure ` → 4 spaces + the trailing space, position-preserving (column-stable)
```

```
# Desugar:  pure async fun / pure arrow
Para (.pts):
    pure async fun load(id: UUID) { return await db.get(id); }   // ⚠ see §1.4: I/O contradicts the contract
    const sq = pure (x: int) => x * x;
TS (.pts):
        async function load(id: UUID) { return await db.get(id); }
    const sq =     (x: number) => x * x;
```

&gt; The strip is **whitespace-for-`pure`**, not deletion, so every downstream column (and any source map) is unperturbed (`transformPure` comment: "keeps column positions aligned"). The canonical ParaBun parser and the `@lyku/para-transpile` mirror agree on this byte target (it is a passthrough-shaped transform — the only edit is `pure `→spaces). The `.pui` surface strips identically; `pure` is spine, not view (it never bridges to a rune), so its lowering is byte-identical across surfaces (I2).

### 1.3 The parse-time identifier checks the marker enables

The reason `pure` is a *parser* concern and not purely a lint concern is that the marker switches on a small set of **decidable, local** identifier checks the parser can run cheaply while it has the function body in hand. These are the Shipped teeth of the contract — narrow, but real.

Inside a `pure`-marked function body, the parser tracks the set of **locally-bound names** (parameters, `const`/`let`/`fun` declarations, destructuring binds, loop variables) and flags **free references** that are statically known to be impure sources. The decidable fragment it checks:

1. **No write to a reactive cell.** A `signal`/`derived` cell read inside a `pure` body is permitted (reading is referentially transparent *given the cell's current value*, which the caller could have passed); a **`.set(…)` / `.update(…)` on a captured signal**, or an assignment that the bare-read sugar would lower to a `.set` ([→ ch:reactivity-core §9.1]), is a purity violation (`pure function writes reactive cell 'count'; a pure body may read but not mutate state`). This is the check that discharges `derived`'s acyclic obligation locally (§2).
2. **No reference to a flagged ambient-impure builtin.** A curated denylist of statically-recognizable non-deterministic / effecting globals — `Date.now`, `performance.now`, `Math.random`, `crypto.getRandomValues`, `fetch`, `console.*` (effect), and the `parabun:*` native-handle imports ([→ ch:sources-async-and-native]) — referenced *free* (not shadowed by a local bind) in a `pure` body is flagged (`pure function references non-deterministic source 'Math.random'`). Shadowing disables the check for that name (a local `const Math = …` is the developer's business — superset discipline mirrors the bare-read rule, [→ ch:reactivity-core §9.1]).
3. **No `await` in a `pure` (non-`async`) body**, and — see §1.4 — `await` in a `pure async` body is admissible only over other pure-async work; today this fragment is *not* decided at parse time (it needs callee effect info), so it is left to lint / §3.1.

These checks are **syntactic and intra-function** (no cross-module resolution at parse time), so they catch the common, local violations and *only* those. They are deliberately conservative: a flagged name that is actually fine (a `Date` you imported as a pure formatter) is silenced by the denylist being *names of known-impure globals*, not "anything called `now`". The transitive, cross-module fragment of DEF-pure-2 is **out of scope for the parser** and is the gap §3.1 closes.

&gt; **INV-pure-2 (parse-checks are sound, not complete).** The Shipped identifier checks **never flag a pure function as impure** falsely on the denylist axis (they flag only known-impure free references and reactive writes) and **never miss** a *direct, local* reactive-write or denylisted-global use. They *do* miss **transitive** impurity (a `pure fun` calling an unmarked impure helper) and **value-laundered** impurity (`const f = Math.random; f()`). The contract's completeness therefore rests on lint today and on §3.1 tomorrow; the parser's job is the cheap, sound, local subset.

### 1.4 The async honesty problem

`pure async fun` is the most easily-abused form, because the canonical thing an `async` function does — `await db.get(id)` — is **I/O**, which DEF-pure-1 forbids. The marker is *not* a lie by construction: a `pure async fun` is legitimate when its asynchrony is over **other pure-async computation** (awaiting a `memo async` of a pure function, awaiting a pure worker, awaiting a settled `Promise.resolve(pureValue)`), where the result is still a deterministic function of inputs with no observable effect. But the *common* `pure async` over a network/db read is a **contract violation the Shipped pipeline cannot catch** (the impurity is behind a callee the parser does not resolve).

The spec's position is explicit and honest: **today, `pure async` over I/O compiles, runs, and is wrong** — caught only by lint if configured, and by the developer's discipline. This is precisely the asymmetry §3.1 (effect lattice) and §3.4 (capability declarations) exist to remove: under the effect lattice, `pure async fun load(id) { return await db.get(id); }` is a **compile error** because `db.get` carries an `io` effect that the `pure` declaration excludes. Until then, the marker on an I/O `async` is **advisory and unverified**, and the spec says so rather than implying a guarantee the implementation does not provide.

```pts
// .pts
pure fun slug(s: string): string {                 // ✓ deterministic, no effect, no ambient read
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

pure fun stamp(s: string): string {
  return `${s}@${Date.now()}`;                      // ✗ parse-flagged: references non-deterministic 'Date.now'
}

signal count = 0;
pure fun bump(): void { count.set(count.get() + 1); } // ✗ parse-flagged: pure body writes reactive cell 'count'
```

```pts
// .pts — the async honesty case
pure async fun load(id: UUID): User { return await db.get(id); }
// today: COMPILES (parser can't resolve db.get's impurity) — a contract violation caught only by lint.
// under §3.1: COMPILE ERROR — `db.get` is `io`, excluded by `pure`.
```

---

## 2. Purity and cacheability — the soundness conditions this chapter owns

Two Shipped constructs cache results and are therefore **only correct on pure functions**. Their *mechanism* lives elsewhere; their *soundness condition* is specified here, and both chapters cite this section.

### 2.1 `memo` cacheability (condition for [→ ch:effects-lifecycle-concurrency §3.2])

`memo f` wraps `f` in an identity-keyed cache: a call with the same argument identities returns the stored result **without re-running the body** ([→ ch:effects-lifecycle-concurrency §3.2], `__parabunMemo`). A cache hit is a *substitution of the stored value for the call* — exactly the operation DEF-pure-1 licenses, and **only** DEF-pure-1.

&gt; **INV-pure-3 (memo soundness = referential transparency).** `memo f` is **behaviorally transparent** (indistinguishable from un-memoized `f`, modulo timing and cache memory) **iff `f` is referentially transparent** (DEF-pure-1). For an impure `f`, a cache *hit* silently **drops every side effect** `f` would have performed and returns a stale result for any ambient-state dependence — a correctness bug, not a performance footnote. This is the same fact [→ ch:effects-lifecycle-concurrency §3.2] states as INV-effects-8; this chapter is its definitional home. The `memo { ttl, eq, key }` variants ([→ ch:effects-lifecycle-concurrency §3.5]) change *which* calls hit, never *whether* hitting is sound (INV-effects-10): a `ttl` re-derives a *slowly-changing* pure-enough result on a window, it never licenses caching an effecting function.

Therefore: **`memo` should mark its function `pure`** (and, under §3.1, must — `memo` will require a `pure`/`pure async` effect bound). The pairing is the intended idiom:

```pts
// .pts — pure + memo: the result is cached because the body promises it may be
memo pure fun fib(n: int): int {        // (today `memo pure fun` strips `pure`, wraps in __parabunMemo)
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
```

&gt; **Note (today's surface).** `memo` and `pure` are *independent* markers in the Shipped catalog; `memo pure fun fib` strips `pure` (§1) and then `memo` wraps the result ([→ ch:effects-lifecycle-concurrency §3.2]) — they compose lexically but the parser does **not** today enforce that a `memo`'d function is `pure`. The soundness obligation (INV-pure-3) is on the developer; §3.1 makes `memo` *require* a non-`io` effect bound, mechanizing it.

### 2.2 `derived` purity (enforcement for [→ ch:reactivity-core §2])

A `derived` body "SHOULD be pure" ([→ ch:reactivity-core §2]) because it "may run zero, one, or many times and its result is memoized" — the identical caching argument as §2.1, plus the **acyclicity** argument: a `derived` that writes a signal it transitively reads forms a cycle (INV-react-2), which the core does not detect statically. The *structural defense* the reactivity chapter names is "the purity obligation on `derived`" — and that obligation is **check (1) of §1.3**: a `pure` body may not write a reactive cell. So the relationship is exact:

- `derived NAME = EXPR` carries an **implicit `pure` obligation** on `EXPR` ([→ ch:reactivity-core §2]).
- Marking it explicit — `derived NAME = pure EXPR` is not surface, but a `derived` **block** body may host a `pure`-checked computation, and §3.1 lifts the obligation into the type so a `derived` body is *checked* pure-of-writes, not merely *expected* to be.
- The payoff is INV-react-2: a `derived` whose body cannot write a reactive cell **cannot** be the write-half of a cycle. Purity is what turns "the graph is a DAG" from a hope into a consequence.

&gt; **INV-pure-4 (purity ⇒ acyclic derived).** If every `derived` body satisfies §1.3 check (1) (no reactive write), then no `derived` is the writing endpoint of a dependency cycle, and INV-react-2 (the graph is a DAG) holds by construction rather than by runtime convergence. The Shipped pipeline guarantees this only to the extent the parse-check fires (locally, soundly — INV-pure-2); the full guarantee is §3.1.

---

## 3. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `src/language-surface.ts` or the parser today). Each gives full grammar, static + dynamic semantics, a `# Desugar (proposed):` sketch (so it stays glass-floor-compatible, I1), an example, and a rationale. They share **one move**: promote `pure` from an erased, advisory marker (§1, runtime no-op, lint-enforced) into a **checked effect discipline** with readable diagnostics — without ever adding a runtime cost (every extension still erases; the contract lives in the checker). §3.1 is the foundation the rest build on.

### 3.1 The effect lattice: `pure ⊂ reactive-read ⊂ io ⊂ async`, inferred & checked  `Proposed`

**Rationale.** Today `pure` is a *claim* the compiler does not verify across the call graph (§1.1, DEF-pure-2): an impure callee silently poisons a `pure` marker, and `pure async` over I/O is a contract violation that compiles (§1.4). The fix is the move every effect system makes: turn purity into the **bottom of a lattice of effects**, *infer* each function's effect from its body and callees, and make the declared marker a **checked upper bound**. `pure` stops meaning "I promise" and starts meaning "the compiler proved." Crucially, this is *additive and glass-floor-safe* — the effect annotations erase exactly as `pure` does today (INV-pure-1); only the checker gains power.

**The lattice.** Four ordered effect tiers (a join-semilattice; a function's effect is the **join** of its body's and callees' effects):

```
pure  ⊑  reactive-read  ⊑  io  ⊑  async
```

- **`pure`** — DEF-pure-1: deterministic, no effect, no ambient read. The bottom; freely cacheable, reorderable, const-evaluable (§3.5).
- **`reactive-read`** — pure *plus* may **read** (subscribe to) reactive cells (`signal`/`derived`/`source`). Still deterministic *given the dependency snapshot*; this is precisely a `derived` body (it reads cells, never writes them, never does I/O). Cacheable *within a reactive epoch*. Reading-without-writing is its own tier because it is the exact effect a `derived` is allowed and the exact thing §1.3 check (1) permits-but-§2 wants-named.
- **`io`** — may perform observable side effects: write reactive cells, mutate captured state, call native handles, read the clock/RNG, log. This is an `effect` body, a handler, a `when` arm.
- **`async`** — `io` *plus* suspends (`await`, returns a `Promise`). The top.

(Note these are *tiers*, not orthogonal rows — a deliberately small, totally-ordered lattice chosen for **legibility** over expressive power, per the "legibility is a correctness property" principle, A3. §3.4's capability rows are the orthogonal refinement of the `io` tier.)

**Grammar.** Effect markers are modifiers (generalizing today's `pure`); a function may carry **at most one** lattice marker, which is a *checked upper bound* on its inferred effect.

```
EffectMarker ::= "pure" | "reactive" | "io" | "async"      ⟨lattice tier; `pure` is today's keyword⟩
EffFun       ::= "export"? EffectMarker? "async"? ("fun"|"function") FunRest
                  ⟨`async` the lattice-marker and `async` the host keyword coincide at the top tier⟩
```

- An **unmarked** function's effect is **inferred** and used at its call sites (no annotation burden by default).
- `pure` (Shipped keyword) is reinterpreted as "inferred effect must be `⊑ pure`."
- `reactive` / `io` are new contextual keywords (same statement-position discipline as `pure`, §1, so superset closure holds — a value named `io` is untouched).

**Static semantics.**
- **Inference.** Each function's effect is `join` of: the tiers of the operations in its body (a reactive write ⇒ `io`; a denylisted global ⇒ `io`; a cell read ⇒ `reactive-read`; an `await` ⇒ `async`) and the **declared-or-inferred effect of every function it calls** (DEF-pure-2, now mechanized — the transitive closure the parser could not do, §1.3). Recursion is handled by a fixpoint (start at `pure`, iterate to a fixed point; the lattice has height 4, so it converges in ≤4 passes per SCC).
- **Checking.** A declared marker is an **upper bound**: if the inferred effect exceeds the marker, it is a compile error with a **provenance trace** (the diagnostic names the *specific* operation/callee that raised the tier — the readable-diagnostics requirement):
  ```
  ✗ `pure fun load` has effect `io` but is declared `pure`
    → because it calls `db.get` (effect `io`)
      → because `db.get` reads native handle `parabun:pg` (effect `io`)
    fix: declare `io async fun load`, or replace `db.get` with a pure source.
  ```
- **Subsumption at call sites.** A `pure`-context (a `derived` body, a `memo`'d function, a schema `refine`, a const-eval site) may call only functions whose effect is `⊑` the context's allowance. A `derived` body is a `reactive-read` context: it may read cells and call `pure`/`reactive` functions, but a call to an `io` function is a compile error (`derived body calls io function 'log'; a derived may read but not effect` — mechanizing INV-pure-4). `memo` requires its function be `⊑ reactive-read` (mechanizing INV-pure-3 / INV-effects-8).

**Dynamic semantics / desugar.** **None** — every marker erases exactly as `pure` does today (`transformPure`-style strip; INV-pure-1 extends to `reactive`/`io`). The lattice is a *pure checker artifact*: zero runtime cost, zero runtime trace, full erasability (I1).

```
# Desugar (proposed):  effect markers all erase
Para (.pts):
    pure     fun a(x: int) { return x + 1; }
    reactive fun b()       { return count.get() * 2; }      // reads a cell → reactive-read
    io       fun c()       { count.set(0); log("reset"); }   // writes + logs → io
TS (.pts):
             function a(x: number) { return x + 1; }         // markers stripped to spaces (column-stable)
             function b()          { return count.get() * 2; }
             function c()          { count.set(0); log("reset"); }
    // the lattice lives in the checker; the emitted JS is identical to unmarked
```

**Interaction.** This is the keystone the whole chapter pivots on: it converts §1's *advisory* contract into a *checked* one (closing the §1.4 async-honesty gap and the DEF-pure-2 transitive gap), mechanizes INV-pure-3 (`memo` requires `⊑ reactive-read`) and INV-pure-4 (`derived` body checked `⊑ reactive-read`), and is the substrate for §3.2 (`pure` schemas demand a `pure` validator), §3.3 (determinism annotation = a `⊑ reactive-read` bound + key declaration), and §3.5 (const-eval is sound exactly on the `pure` tier). It composes with the `//#![strict-totality]` pragma ([→ ch:overview-and-surfaces §5.2]): a `strict-totality` file MAY additionally require every exported handler carry an *explicit* effect marker (no inference at the module boundary), making the effect surface part of the totality story (I3 — effects are accounted for, never silent).

### 3.2 `pure schema` / `pure refine` — side-effect-free validators, guaranteed  `Proposed`

**Rationale.** A schema's `refine` rule and computed-field expression must be **pure over sibling fields** — "no I/O, no external reads — so it is reproducible on both client and DB" ([→ ch:type-and-schema-system §-computed], which forwards the *meaning* of "pure" here). Today that requirement is prose; a custom validator that reaches out to `fetch` or reads a clock compiles, then **diverges between the client parse-gate and the DB constraint** (the same value validates in one place and not the other — a totality breach, A5). Mark the validator `pure` and have §3.1 **check** it: a refinement is then *guaranteed* safe to run at any boundary, any number of times, on either side of the trust boundary.

**Grammar.** A `pure` modifier on a refinement / computed-field expression inside a schema body (the schema-body grammar is [→ ch:type-and-schema-system]):

```
RefineRule   ::= "refine"  "pure"? "(" Expr ")" ("," StringLit)?   ⟨boolean over sibling fields⟩
ComputedField ::= Ident ":" Type "=" "pure"? Expr                   ⟨derived field; pure over siblings⟩
PureSchema   ::= "pure" "schema" Ident SchemaBody                   ⟨every refine/computed in body is `pure`⟩
```

- `refine pure (…)` / `field = pure EXPR` — mark an individual rule/field pure (checked).
- `pure schema NAME { … }` — a **schema-level** assertion that *every* refinement and computed field in the body is pure (the common case; saves per-rule annotation).

**Static semantics.** Under §3.1, the marked expression's inferred effect must be `⊑ pure` over **sibling field names only** (the in-scope names are the schema's own fields — DEF-pure-1's "reads no ambient state" specialized to "reads no field not declared here", which is already [→ ch:type-and-schema-system]'s `refine references unknown field` check, now strengthened from *name-resolution* to *effect-checking*). A `refine` that calls an `io`/`async`/`reactive` function is a compile error (`refinement is not pure: calls 'fetchAllowlist' (io); a refinement must be reproducible on client and DB`). A `pure schema` whose body contains any impure rule fails at that rule with the schema-level provenance.

**Dynamic semantics / desugar.** None new — the marker erases; the refinement lowers to the same `parse`-contributing boolean it does today ([→ ch:type-and-schema-system]). The *guarantee* is that the lowered validator is safe to call in the DB-constraint projection, the client parse-gate, and the wire-codec boundary identically (the I1 projections all reuse one validator with no per-site caveat).

```
# Desugar (proposed):  pure schema with a checked refinement
Para (.pts):
    pure schema DateRange {
      start: Date,
      end:   Date,
      refine (end >= start), "end must be on or after start"
    }
TS (.pts):
    // refinement erases to the same boolean it does today; §3.1 has PROVEN it pure,
    // so the SAME function is emitted for the client parse-gate AND the DB CHECK constraint.
    export const DateRange = __paraFromSchema({ /* … */ }, {
      refine: [[(v) => v.end >= v.start, "end must be on or after start"]],
    });
```

**Interaction.** This is the schema-spine consumer of §3.1: it discharges [→ ch:type-and-schema-system]'s "must be pure over siblings" obligation *mechanically*, and it is the precondition for cross-field refinements projecting to **both** validators and DB constraints (a `CHECK` constraint cannot call `fetch`; a `pure` refinement provably cannot). It ties to A5 (db ⇄ api ⇄ client one diffable chain): an impure refinement is exactly a value that could validate differently across the chain, and §3.1 makes that a compile error. It composes with §3.5 — a `pure` refinement over *constant* fields is const-evaluable, so a statically-violated refinement (`refine (1 > 2)`) is caught at compile time.

### 3.3 `det` / `@deterministic` — auto-memoize pure handlers as a projection  `Proposed`

**Rationale.** A `pure` (or `reactive-read`) function is *cacheable* (§2), but caching is opt-in per call site via `memo`. For a **pure handler** (a request handler whose response is a deterministic function of its validated input), the cache is a legitimate **projection** of the schema-is-the-application loop: the same way the spine projects a DB model and a wire codec, it can project a **response cache** for any handler the compiler has proven deterministic. A `det` annotation declares the handler deterministic (a §3.1 `⊑ reactive-read` bound) **and** names its cache key, and the build emits the memoization as ejectable glass-floor code.

**Grammar.**

```
DetFun  ::= "det" KeySpec? "async"? ("fun"|"function") FunRest
KeySpec ::= "by" "(" Expr ")"                  ⟨cache key derived from args; default = identity of validated input⟩
```

`det` implies (and is checked as) a §3.1 `⊑ reactive-read` upper bound — a deterministic function may read cells/config but not effect.

**Static semantics.** `det fun h(req:: Order) { … }` asserts `h` is deterministic in `req`; §3.1 checks the body's effect is `⊑ reactive-read` (else: `det handler 'h' is not deterministic: calls 'chargeCard' (io)`). `by (EXPR)` declares the cache key (must itself be `pure` over the args); absent `by`, the key is the **validated input's structural digest** (not identity — a handler over a freshly-parsed `req` would never hit an identity cache, so `det` defaults to a *structural* key, unlike `memo`'s identity key, INV-effects-8). The result type must be schema-derivable (so the cache is serializable across the projection, I3).

**Dynamic semantics / desugar.** Lowers to a `memo`-family wrapper keyed structurally (`__parabunMemoKeyed`, [→ ch:effects-lifecycle-concurrency §3.5]) — *the cache is the projection*, emitted as readable, ejectable code (I1):

```
# Desugar (proposed):  det handler → response-cache projection
Para (.pts):
    det by (req.id) fun price(req:: Quote): Money { return compute(req); }
TS (.pts):
    export const price = __parabunMemoKeyed(
      function (req) { const __v = Quote.parse(req); /* throw on Err */ return compute(__v.value); },
      { key: (req) => req.id },                 // ejectable: swap the cache, the TTL, the store per-site
    );
    // the build MAY additionally register `price` in the projection manifest's response-cache layer.
```

**Interaction.** `det` is the bridge from §3.1 (proven determinism) to [→ ch:effects-lifecycle-concurrency §3.5] (the bounded cache) reframed as a **projection** ([→ ch:modules-projections-and-build]) — it makes "automatic memoization of pure handlers" a *declared, diffable* fact (which handlers are cached, on what key) rather than scattered `memo` calls, the same way the `.para` manifest closes the spine/authority/transport facts ([→ ch:overview-and-surfaces §5]). It composes with §3.4 — a `det` handler's capability row must exclude `clock`/`random`/`net` (those break determinism), so `det` and an empty effecting-capability set are mutually reinforcing.

### 3.4 Capability rows: `uses {db, net, clock, random}` — effects as declared authority  `Proposed`

**Rationale.** The `io` tier (§3.1) is a single bit — "this function effects" — but *which* capability a function uses (database, network, clock, randomness, the filesystem) is exactly the information the **totality/auth story** wants (A4, the sharpest lesson: a server-only capability must not leak to the client; an "authless" handler must be provably unable to reach the DB). Refine the `io` tier into an **orthogonal capability row**: a function declares the capabilities it *may* use, the compiler infers what it *does* use, and the declared set is a checked upper bound — purity is then the **empty capability set**, and authority is "which capabilities a surface grants."

**Grammar.**

```
CapFun   ::= EffectMarker? "uses" CapSet "async"? ("fun"|"function") FunRest
CapSet   ::= "{" Capability ("," Capability)* "}" | "{" "}"   ⟨empty set = pure-of-capabilities⟩
Capability ::= "db" | "net" | "clock" | "random" | "fs" | Ident   ⟨extensible; Ident = a named capability⟩
```

**Static semantics.** `uses {db, clock} fun f() { … }` declares `f` may touch the DB and the clock and **nothing else**; §3.1's inference is extended to track *which* capability each `io` operation requires (`Math.random` ⇒ `random`; a `parabun:pg` handle ⇒ `db`; `Date.now` ⇒ `clock`; `fetch` ⇒ `net`), and a used-but-undeclared capability is a compile error with provenance (`f uses capability 'net' (via fetch) not in its declared set {db, clock}`). **`pure` ≡ `uses {}`** (empty row) — purity is the bottom of *this* lattice too, unifying §1 with the capability story. The capability set composes with the `surface { }` capability matrix ([→ ch:overview-and-surfaces §5.3]): a `client`-capability file may not call a function whose row contains a `server`-granted capability (`db`/`fs`), so the A4 leak ("a server-only auth construct reachable from the client forces an `any`") becomes a compile error — the capability row is *checked against the surface's grant*.

**Dynamic semantics / desugar.** None — the row erases like every other marker (INV-pure-1). It is a checker + bundle-split input only (no capability is *enforced at runtime* by this construct; runtime sandboxing, if any, is a separate concern — the spec is honest that this is a *static* discipline, like `pure` itself).

```
# Desugar (proposed):  capability row erases; gates the checker + bundle split
Para (.pts):
    uses {db} async fun getUser(id:: UUID): User { return await pg.users.find(id); }
    uses {}        fun fullName(u: User): string  { return `${u.first} ${u.last}`; } // ≡ pure
TS (.pts):
                   async function getUser(id) { const __v = UUID.parse(id); /*…*/ return await pg.users.find(__v.value); }
                         function fullName(u) { return `${u.first} ${u.last}`; }
    // rows stripped; the checker proved getUser uses ⊆ {db} and fullName uses {} (pure)
```

**Interaction.** This refines §3.1's `io` tier into the **authority** dimension ([→ ch:data-sync-and-authority], [→ ch:modules-projections-and-build] A4): a handler's capability row is the typed, checked statement of "what this code is allowed to touch," and tying it to the `surface { }` matrix makes server/client capability leakage a compile error rather than a tree-shaking accident. It strengthens §3.3 (`det` ⟺ a row excluding `clock`/`random`/`net`) and §3.2 (a `pure refine` ⟺ `uses {}`). It is the construct that makes "purity ties to the totality/auth story" concrete: *purity is the empty grant; authority is the granted set*.

### 3.5 `const`-eval of `pure` expressions — schema defaults & constants at compile time  `Proposed`

**Rationale.** A `pure` expression over `pure` inputs is, by DEF-pure-1, **substitutable for its value** — so when its inputs are *compile-time constants* (literals, other const-eval results), the compiler may **evaluate it at build time** and emit the value. This is the natural payoff of having a real `pure` tier (§3.1): it unlocks compile-time evaluation for **schema defaults** (a default that is a pure function of constants, computed once at build, not per-instantiation), **derived constants**, and **statically-checkable refinements** (a `refine` over constant fields evaluated at compile time, §3.2). It is the most concrete "purity buys you something" feature and is sound *exactly* on the `pure` tier — never on `io`.

**Grammar.** A `const` binding or schema default marked for const-eval:

```
ConstEval   ::= "const" Ident "=" "comptime" Expr ";"        ⟨evaluate EXPR at build; emit the value⟩
SchemaDflt  ::= Ident ":" Type "=" "comptime"? Expr          ⟨a field default; comptime ⇒ folded at build⟩
```

`comptime EXPR` requires `EXPR`'s effect be `⊑ pure` (§3.1) **and** all free references be const-eval values; else a compile error (`comptime expression is not pure: references 'config' (reactive-read)` or `comptime expression depends on non-constant 'userId'`).

**Static semantics.** The compiler evaluates `comptime EXPR` in a **sandboxed pure interpreter** (the `pure` tier guarantees no I/O/ambient read, so the interpreter needs no host capabilities — this is *why* const-eval is sound only on `pure`) and substitutes the resulting **literal** (a primitive, or a frozen plain-object/array literal). The result's type is the literal's inferred type (no `any` — I3). A `comptime` that throws is a **compile error** (the build surfaces the thrown `Result.Err`/exception as a diagnostic, never a runtime crash). For schema defaults, a `comptime` default is folded into the schema's emitted JSON Schema `default` (so the projection — DB default, client form default — carries the *value*, not a thunk).

**Dynamic semantics / desugar.** The expression is **gone** at runtime — replaced by its value. This is the one extension that changes the emitted *value* (not just the checker), and it does so *conservatively*: only a `comptime`-marked, `pure`-proven, constant-input expression is folded, and the fold is the literal the expression *would* have produced, so behavior is unchanged (INV-pure-1's substitution, applied at build).

```
# Desugar (proposed):  comptime fold of a pure expression
Para (.pts):
    pure fun grid(n: int): int[] { return [...Array(n).keys()].map(_ * _); }
    const SQUARES = comptime grid(5);
    schema Tile { size: int = comptime 1 << 4 }   // default folded to 16
TS (.pts):
    function grid(n) { return [...Array(n).keys()].map((__pu) => __pu * __pu); }
    const SQUARES = [0, 1, 4, 9, 16];             // grid(5) evaluated at build, emitted as a literal
    export const Tile = __paraFromSchema({ properties: { size: { type: "integer", default: 16 } } /*…*/ });
```

**Interaction.** Const-eval is the *consumer* that justifies the whole chapter's promotion of `pure` from advisory to checked: it is **only sound on a proven-`pure` expression** (§3.1), it folds **schema defaults** into the projection so the spine's defaults are values not thunks ([→ ch:type-and-schema-system], [→ ch:modules-projections-and-build]), and it makes **§3.2 refinements over constants** statically decidable (a `refine` over `comptime` fields is checked at build, turning an always-false refinement into a compile error). It composes with the `Nd` decimal literals ([→ ch:lexical-and-expression-syntax]) — a `comptime` decimal arithmetic (`comptime 0.1d.add(0.2d)`) folds to the exact `0.3d` value at build, with no FP drift and no runtime cost.

---

## 4. Chapter invariants (summary)

- **DEF-pure-1 (referential transparency).** Deterministic + no observable effect + no ambient mutable read; the enabling condition for caching/substitution. §0.
- **DEF-pure-2 (purity is transitive).** `f` is pure only if every callee is pure; the marker is a claim about the call-graph closure (which §3.1 mechanizes). §0.
- **INV-pure-1 (erasure is observationally complete).** `pure f ≡ f` at runtime; markers change only what the checker may assume, never behavior. §1.2. (Extends to all §3.1 effect markers.)
- **INV-pure-2 (parse-checks are sound, not complete).** The Shipped identifier checks flag local reactive-writes and denylisted globals soundly, but miss transitive/value-laundered impurity; completeness rests on lint today, §3.1 tomorrow. §1.3.
- **INV-pure-3 (memo soundness = referential transparency).** `memo f` is transparent iff `f` is pure; an impure hit drops effects. The definitional home of [→ ch:effects-lifecycle-concurrency §3.2]'s INV-effects-8. §2.1.
- **INV-pure-4 (purity ⇒ acyclic derived).** A `derived` body that cannot write a reactive cell cannot close a cycle; this is the purity defense [→ ch:reactivity-core §2]'s INV-react-2 names. §2.2.

The Shipped surface is one erased marker with sound-but-incomplete local checks (a *declared, advisory* contract); the Proposed surface is the same marker promoted to a checked effect lattice with capability rows and const-eval — **all still erasing to plain, readable code (I1), all spine-not-view (I2, byte-identical across `.pts`/`.pui`), none introducing a silent `any` (I3)**. Purity in Para is, end to end, a *static* contract: its only runtime consequence is the optimizations (cache, skip, reorder, fold) it makes sound — and the whole chapter's arc is moving the *guarantee* that those optimizations are sound from the developer's discipline into the compiler.

