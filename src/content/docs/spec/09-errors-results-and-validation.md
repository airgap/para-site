---
title: "Errors, Results, Option & Boundary Validation"
description: "Para's errors-as-values discipline end-to-end: Result<T,E> and Option<T>, Ok/Err/Some/None, match over tagged unions, the :: boundary-validation gate…"
sidebar:
  order: 10
---

# Chapter: Errors, Results, Option & Boundary Validation

&gt; **Status of this chapter:** Mixed. `Result<T,E>`, the `Ok`/`Err`/`Some` constructors and the `None` constant, the `::` boundary-validation gate (parse-injection at function entry, throw-on-`Err`), the `is` / `is not` guards (schema-`parse`-gate narrowing + literal membership), and the **literal-pattern** lowering of `match EXPR { pat => res }` are **Shipped** (in `language-surface.ts` and the JS mirrors today; the `::` parse-injection and the non-literal `match` lowering are owned by the canonical parser, cited as evidence). The non-literal `match` patterns (constructor / destructure / guard) are **Partial** — recognized as keyword surface and lowered for the literal case, but the constructor/destructure/guard arms are stubbed in the browser-lower path and only fully realized by the canonical parser. Everything in *§9 Proposed Extensions* — the completed `match` pattern grammar with exhaustiveness as a **compile error**, the `?` try-propagation operator, typed error schemas, `match` as a statement, the Option-aware pipeline, and the standardized validation-error shape — is **Proposed** (net-new surface, not in the catalog/parser today).
&gt; **Cross-refs:** This chapter owns the **error/validation model** and **pattern matching**: how errors flow as values, how `Result`/`Option` are consumed, how `match` discriminates them, and how the *parse gate* (the same idea at three boundaries — handler entry, `is`/`is not` guard, sync envelope) behaves. The **schemas** that back validation — the six `schema` forms, `SchemaValue`/`Infer`, the *meaning* of `::`/`is` as schema-bound markers, and the *definition* of `Result<T,E>` — are [→ ch:type-and-schema-system]; this chapter takes them as given and specifies their **use as boundaries** and their **pattern-match consumption**. The async error-chain operators `..>` / `..!` / `..&` (promise then/catch/finally) are [→ ch:lexical-and-expression-syntax §3]; this chapter cross-references them as the *async* dual of `match`-over-`Result` but does not redefine them. The reconcile-on-parse-fail behavior at the sync boundary (skew status, stale-echo suppression, never-poison) is [→ ch:data-sync-and-authority]; this chapter states the *invariant* (a synced envelope's parse failure never throws and never replaces good state) and defers the reconciler state machine there. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. The shape of the chapter: one gate, three boundaries

Para has exactly one error discipline, and it is the first design principle made mechanical: **errors are values; effects are explicit** [→ ch:overview-and-surfaces, I3]. A computation that can fail returns a `Result<T,E>`; a value that may be absent is an `Option<T>`; neither failure nor absence is signalled by an exception, an `undefined` leaking past a type, or a silent `any`. The discriminated union is the only failure channel, `match` is the only total way to consume it, and the **parse gate** — `Schema.parse(v): Result<T,string>` — is the only sanctioned conversion of an `unknown` from outside into a typed value inside.

That single gate appears at three boundaries, and the unification of those three is the load-bearing idea of this chapter:

1. **Handler entry** — `fun handle(req:: User)` injects `User.parse(req)` and **throws** on `Err`. The server boundary is a *trust* boundary; a request that does not parse is a protocol violation, and throwing is the correct, loud response (§3).
2. **The `is` / `is not` guard** — `if (x is User)` runs the *same* `User.parse(x)` and **narrows** on the `Ok` branch, returning a boolean, never throwing. The guard is the parse gate used as a *question*, not an *assertion* (§4).
3. **The sync envelope** — `sync user :: User from KEY` parse-gates every replicated envelope and, on `Err`, **skews** (marks the replica stale) without throwing and without poisoning the last-good value (§5). The client boundary is also a trust boundary, but a *live* one where throwing would tear down a running UI — so the same parse runs and its `Err` is handled by *degrading the status*, not by an exception.

The three differ only in their **policy on `Err`** — throw, ask, or skew — over an identical `Schema.parse` call. `::` *is* `is` *is* the sync gate, modulo what each does with the failure. Making that one fact legible is this chapter's job; the rest is the model (`Result`/`Option`, §1–§2), its consumption (`match`, §6–§7), and the proposed surface that completes the story (§9).

```
                       Schema.parse(v): Result<T,string>
                                   │
        ┌──────────────────────────┼──────────────────────────┐
   handler entry (::)         is / is not guard           sync envelope (sync :: S)
   policy on Err: THROW       policy on Err: false        policy on Err: SKEW (stale, keep last-good)
   §3                         §4                           §5  [→ ch:data-sync-and-authority]
```

&gt; **INV-errors-1 (one gate).** Every Para boundary that turns external `unknown` into typed data does so through a `SchemaValue.parse` call returning `Result<T,string>` [→ ch:type-and-schema-system §7.1]. There is no second validation path, no `as`-cast escape (I3), and no boundary that consumes `unknown` without parsing it. The three boundary forms (`::`, `is`, sync) are distinguished **only** by their `Err` policy.

---

## 1. `Result<T,E>` — the failure channel

`Result<T,E>` is the tagged union every fallible Para computation returns. It is **defined** in [→ ch:type-and-schema-system §10] because `schema.parse` returns it; this chapter takes that definition as canonical and specifies how it is *constructed* and *consumed*.

```ts
// the shape — from @lyku/para-schema (ch:type-and-schema-system §10)
export type Result<T, E> =
  | { readonly tag: "Ok";  readonly value: T }
  | { readonly tag: "Err"; readonly error: E };
```

A `Result` is discriminated by `tag`. The `Ok` arm carries `value: T`; the `Err` arm carries `error: E`. There is no third arm: a `Result` is **always** exactly one of `Ok` or `Err`, which is what makes `match` over it total (§6) and what lets `tag` be a sound discriminant for TS narrowing.

### 1.1 `Ok` / `Err` constructors

```
ResultCtor ::= "Ok" "(" Expr ")"
             | "Err" "(" Expr ")"
```

`Ok(v)` and `Err(e)` are the constructor functions for the two arms. They appear in **call position** only — the catalog entry `result-option-ctor` fires on `\b(Ok|Err|Some)\b(?=\s*\()`, so `Ok`/`Err` used as bare identifiers (a variable named `Ok`, an `import { Ok }` rename) are untouched (superset preservation, [→ ch:overview-and-surfaces §1.1]). They are `lspAllowlist: true` so the editor's "Cannot find name" fast-pass does not flag them at expression position.

**Static semantics.** `Ok(v: T): Result<T, never>` and `Err(e: E): Result<never, E>`. The `never` in the unused arm lets a constructed `Result` widen to the expected `Result<T,E>` at its use site without restating both type parameters: `Ok(user)` is assignable to `Result<User, string>` because `Result<User, never>` is. This is ordinary TS variance, not a Para rule — the constructors are plain functions.

**Dynamic semantics.** `Ok(v)` evaluates to `{ tag: "Ok", value: v }`; `Err(e)` to `{ tag: "Err", error: e }`. They are pure, total, and allocate one object. There is no Para-level magic: the constructors are runtime helpers imported from the schema runtime, and the lowering is the identity.

```
# Desugar:  Ok(EXPR) / Err(EXPR)
Para:
    return Ok(user);
    return Err("not found");
TS:
    return Ok(user);            // { tag: "Ok",  value: user }   — @lyku/para-schema
    return Err("not found");    // { tag: "Err", error: "not found" }
```

&gt; **Note (constructors are values, not keywords).** `Ok`/`Err` are *constructors* in the catalog (`kind: "constructor"`), not keywords — they lower to themselves and are erasable at the surface level (the only thing Para adds is the highlight + the LSP allowlist). They are recognized purely by call-position; this chapter never rewrites them, it only *consumes* their result in `match` (§6) and threads it through the proposed `?` operator (§9.2).

### 1.2 Consuming a `Result` without `match`

The hand-written, pre-`match` way to consume a `Result` is a `tag` check. It is verbose but total, and it is the lowering target every higher form (§6, §9.2) reduces to — so it is the glass floor of the error model:

```pts
// .pts — manual Result consumption (the glass floor)
const r = User.parse(raw);
if (r.tag === "Err") return Err(r.error);   // r.error: string   (narrowed)
const user = r.value;                        // user: Infer<typeof User>  (narrowed)
```

The `if (r.tag === "Err")` narrows `r` to the `Err` arm inside the branch (so `r.error` is accessible) and to the `Ok` arm after it (so `r.value` is accessible) — standard discriminated-union narrowing. The proposed `?` operator (§9.2) is exactly this pattern made into one postfix token; `match` (§6) is exactly this pattern made total over both arms in one expression. Everything in this chapter threads back to this five-line shape.

---

## 2. `Option<T>` — the absence channel

`Option<T>` is the tagged union for a value that may be *absent* — the typed replacement for `null`/`undefined` at a boundary. It is the structural sibling of `Result`: one arm carries a value, the other carries nothing.

```ts
// the shape — Para's Option (sibling of Result; first-class Option<T> proposed in ch:type-and-schema-system §12)
type Option<T> =
  | { readonly tag: "Some"; readonly value: T }
  | { readonly tag: "None" };
```

`Option` is discriminated by `tag` exactly as `Result` is. `Some(v)` carries `value: T`; `None` carries nothing. The distinction from `Result` is semantic, not structural: `Result` answers "did it fail, and why?" (the `Err` arm is *informative*), `Option` answers "is it there?" (the `None` arm is *empty*). A function that can fail with a reason returns `Result`; a lookup that can miss returns `Option`.

&gt; **Status note.** The `Some` constructor and the `None` constant are **Shipped** as catalog surface (`result-option-ctor` matches `Some(`; `none-const` matches a bare `None`); a first-class `Option<T>` *type* with full `match` integration and the Option-aware pipeline is **Proposed** ([→ ch:type-and-schema-system §12] proposes the type; §9.5 here proposes the pipeline). The constructors ship ahead of the type because they are the surface a developer reaches for; the type formalization closes the loop.

### 2.1 `Some` / `None` constructors

```
OptionCtor ::= "Some" "(" Expr ")"      ⟨constructor — call position⟩
             | "None"                    ⟨constant — bare value⟩
```

`Some(v)` is a constructor (catalog `result-option-ctor`, same entry as `Ok`/`Err`, matching `\b(Ok|Err|Some)\b(?=\s*\()`). `None` is a **constant**, not a constructor — catalog `none-const` matches `\b(None)\b(?!\s*[\.\[\(])`, i.e. `None` *not* followed by `.`, `[`, or `(`. That negative lookahead is what distinguishes the Option constant `None` from a member access `None.foo`, an index `None[0]`, or a call `None()` — those are ordinary identifiers and pass through untouched (superset preservation). Both are `lspAllowlist: true`.

**Lexical note (`None` is bare; `Some` is called).** The asymmetry is deliberate and mirrors the runtime shape: `Some` *wraps* a value so it must be called (`Some(x)`); `None` *is* a singleton with no payload so it is a bare value (`None`, never `None()`). Writing `Some` without a call (`const f = Some;`) is a bare identifier reference — legal, not rewritten. Writing `None(...)` is *not* the Option constant — the lookahead declines it, and it is treated as a call on whatever `None` resolves to.

**Static semantics.** `Some(v: T): Option<T>` (well, `Option<T>` via `{ tag: "Some", value: T }`); `None: Option<never>`, which widens to any `Option<T>`. As with `Ok`/`Err`, the `never` lets `None` satisfy `Option<User>` without annotation.

**Dynamic semantics.** `Some(v)` → `{ tag: "Some", value: v }`; `None` → the `{ tag: "None" }` singleton (a shared frozen object — `None` is referentially stable, so `o === None` is a valid emptiness check and `match` can compare against it by identity).

```
# Desugar:  Some(EXPR) / None
Para:
    const found = Some(user);
    const missing = None;
TS:
    const found = Some(user);     // { tag: "Some", value: user }   — @lyku/para-schema
    const missing = None;         // the shared { tag: "None" } singleton
```

&gt; **Edge case (`None` after a binary operator).** Because `None` is a bare constant, `x ?? None` and `cond ? Some(v) : None` are the idiomatic forms and lower verbatim. The recognizer's only job is to *allowlist* the bare `None` so the LSP does not flag it as an unknown name; it performs no rewrite. A `None` immediately followed by `.`/`[`/`(` is **not** the constant (it is whatever `None` resolves to), so `Option`'s `None` and a user's `None.something` never collide.

---

## 3. The `::` boundary gate — throw-on-`Err` at handler entry

`::` is the **per-argument validation marker**. Its *meaning* (schema-bound, types the parameter as `Infer<typeof T>` inside the body, lowers to a `Schema.parse` injection) is owned by [→ ch:type-and-schema-system §8]; this chapter owns its **boundary policy**: at a function entry, `::` injects a parse and **throws on `Err`**.

### 3.1 Grammar (recall)

```
Param        ::= Ident "::" Type      ⟨validated — parse-gate at entry, throw on Err⟩
              | Ident ":"  Type        ⟨type-only annotation — no runtime gate⟩
```

The double colon is the catalog `validate-marker` operator (`::`). The single colon is an ordinary TS annotation with no runtime cost. The choice between them is the choice between **a checked boundary and a trusted one**: `(req:: User)` says "this value crossed a trust boundary; verify it"; `(req: User)` says "this value is already known to be a `User`; just type it."

### 3.2 Dynamic semantics: the throw policy

At runtime, `(arg:: T)` injects `T.parse(arg)` at function entry and, on `Err`, **throws**. This is the server-write-gate policy: a request that does not parse is a protocol violation, and the loudest correct response is to reject the call before the body runs.

```
# Desugar:  fun handle(req:: T) { BODY }
Para:
    fun handle(req:: User) { return req.email; }
TS:
    function handle(req) {
      const __v_req = User.parse(req);
      if (__v_req.tag === "Err") throw new Error(__v_req.error);
      req = __v_req.value;                  // req: Infer<typeof User> for the body
      return req.email;                     // guaranteed-shape access
    }
```

The injected preamble is exactly the §1.2 glass-floor `tag` check, specialized to *throw* on `Err` and *rebind* the parameter to the parsed value on `Ok`. The body then sees `req: Infer<typeof User>` — a value that *provably parsed*, with no `any` in sight (I3).

**Why throw here, when the model says errors are values?** Because `::` at a parameter is a **boundary assertion**, not a fallible computation. The fallible computation is `User.parse`, and it *does* return a value (`Result`). The `::` marker is a policy *layered onto* that value: "if this boundary's value is `Err`, the caller violated the contract, so fail loudly." Throwing is the right policy for a *server-side request boundary* — there is no sensible local recovery for "the client sent garbage," and a thrown error is caught by the framework's request boundary and turned into a 4xx. Contrast the sync boundary (§5), where the same parse failure is handled by *degrading status*, because there the boundary is live and tearing down the UI would be wrong.

&gt; **INV-errors-2 (`::` body never sees unparsed data).** Inside the body of a function with an `(arg:: T)` parameter, `arg` has type `Infer<typeof T>` *and* the runtime value provably parsed (the throw fires before the first body statement). There is no execution path where the body runs with an `Err`-valued `arg`. This is the mechanical form of "the server boundary turns `unknown` into `T`."

### 3.3 Caching the parse (idempotent boundaries)

Per the catalog and the runtime, a `::` injection is **cached per parameter identity** within a call: re-validating the same reference is suppressed, so a value parsed once at the boundary is not re-parsed if it flows to a second `::` site unchanged. This matters when a handler delegates to another `::`-gated function with the same already-parsed argument — the gate is idempotent, not redundant. The cache is keyed on object identity (a parsed `User` carries no observable marker; the cache is a `WeakSet`-style memo at the call boundary), so it never changes observable behavior — it only avoids re-running a parse whose result is already known `Ok`. The semantics with and without the cache are identical (the parse is pure); the cache is a performance projection, not a behavioral one.

### 3.4 Skipped types (builtins are not parsed)

`::` only injects a parse when its RHS is a Para `schema`-declared identifier in scope. JS/TS builtins (`String`, `Number`, `Boolean`, `Date`, `Promise`, `Buffer`, `Array`, …) are **skipped** — there is no `String.parse`, and injecting one would be a phantom call. An unknown capitalized type that is neither a builtin nor a `schema` in scope is the diagnostic `Unknown type 'T' for `::` validation marker — declare a `schema T = { … }` or import one` [→ ch:type-and-schema-system §8]. The skip-list is the mechanism that keeps `(buf:: Buffer)` from emitting `Buffer.parse(buf)`; it is consulted at lowering time and mirrors the canonical parser's builtin set.

### 3.5 The IDE mirror vs the runtime

The runtime emit injects the parse-and-throw preamble (§3.2). The **IDE-only mirror** (ts-plugin / LSP) instead *strips the second colon to a space* — `(req:: User)` → `(req:  User)`, columns preserved — so `tsc` type-checks the annotation as an ordinary `req: User` without running validation. Both agree that `req: Infer<typeof User>` inside the body; only the runtime adds the gate. The parity contract pins the runtime emit [→ ch:overview-and-surfaces §3.2]. This is *not* a behavioral divergence: the editor needs the *type* (for completion and diagnostics), the runtime needs the *gate* (for the throw), and the two views are consistent on the one observable fact (the body's type of `req`).

---

## 4. `is` / `is not` — the parse gate as a question

`is` runs the **same** `Schema.parse` as `::`, but its policy on `Err` is **return `false`** (never throw), and its policy on `Ok` is **narrow** the operand. It is the parse gate used as a boolean question. Its meaning is owned by [→ ch:type-and-schema-system §9]; this chapter owns its role as the *third face of the one gate* (INV-errors-1) and its narrowing discipline.

### 4.1 Grammar (recall)

```
IsGuard     ::= Expr "is" Type                            ⟨schema guard — Capitalized RHS⟩
             | Expr "is" "not" Type
MemberGuard ::= MemberPath "is" "not"? Literal ("|" Literal)*   ⟨literal membership⟩
MemberPath  ::= Ident ("." Ident)*
```

`is` fires only before a **Capitalized** identifier (catalog `is-guard`: `\b(is)\b(?=\s+[A-Z])`), so `const is = 5; is + 1` and `obj.is(x)` keep their normal meaning (superset preservation). `is not` (catalog `is-not-guard`) is rewritten before bare `is`.

### 4.2 Dynamic semantics: the boolean policy

```
# Desugar:  EXPR is T   /   EXPR is not T   (schema guard)
Para:
    if (x is User) handleUser(x);
    if (x is not User) reject(x);
TS:
    if (User.parse(x).tag === "Ok") handleUser(x);
    if (User.parse(x).tag !== "Ok") reject(x);
```

`EXPR is T` lowers to `T.parse(EXPR).tag === "Ok"` — a boolean, never a throw. `is not T` lowers to `.tag !== "Ok"`. This is the *exact same* `T.parse` the `::` marker injects (§3.2) and the same `parse` the sync gate runs (§5); the three share one validation path (INV-errors-1). The difference is wholly in what is done with the `Result`'s `tag`: `::` throws on `Err`, `is` yields `false`, sync skews.

**Narrowing.** On the `true` branch of `x is T`, `x` narrows to `Infer<typeof T>` (a TS type predicate, via `SchemaValue.is`'s `v is T` signature, [→ ch:type-and-schema-system §7.1]); on `false`, to its complement. `is not T` narrows oppositely. Because the lowering is a `===`/`!==` over a `.tag`, TS narrows the *textual* form exactly as it would a hand-written guard — the `is` operator is sound precisely because it lowers to a discriminant comparison TS already understands.

### 4.3 Literal membership — narrowing without a schema

```
# Desugar:  S is 'a' | 'b'   /   S is not 'a' | 'b'   (literal membership)
Para:
    if (status is "open" | "pending") proceed();
    if (status is not "open" | "pending") halt();
TS:
    if ((status === "open" || status === "pending")) proceed();
    if ((status !== "open" && status !== "pending")) halt();
```

The literal-membership form (`S is 'a' | 'b'`) is a second face of `is` that does **not** call `parse`: it lowers to a parenthesized `===`/`||` chain (`!==`/`&&` for `is not`) over the canonicalized literals (strings normalized to double quotes; numbers pass through). It requires a **simple** operand — an identifier or property path (`MemberPath`), side-effect-free so the repeated comparison is sound [→ ch:type-and-schema-system §9]. The chain is always parenthesized to preserve precedence inside a larger expression (`a && S is 'x'|'y'`). This is the "narrow against a closed literal set" case, distinct from the schema-`parse` case; both are spelled `is`, both narrow, but only the schema form runs the gate. It is the bridge to `match`'s literal-pattern arms (§6.2): `match s { "a" => …, "b" => …, _ => … }` is the totalized, expression-valued form of a chain of `s is "a"` checks.

&gt; **Edge case (`is` vs TS type-predicate annotation).** A TS return annotation `function f(v): v is T {}` is also `EXPR is T`-shaped and *will* be rewritten by the textual mirror — a known toolchain-wide ambiguity that the parity corpus does not cover. Prefer a `schema` guard, or avoid `: v is T` predicate signatures in Para sources [→ ch:type-and-schema-system §9]. This is the one place the parse-gate surface overlaps a host-TS form; the spec marks it explicitly rather than silently absorbing it [→ ch:overview-and-surfaces §3.2, disagreement class 3].

---

## 5. The sync boundary — parse-gate-and-skew, never poison

`sync NAME :: SCHEMA from KEY` is the third boundary at which the parse gate runs. Its reconcile/authority semantics — the `(schema_version, sequence)` machine, `ReplicaStatus` transitions, stale-echo suppression — are owned by [→ ch:data-sync-and-authority]; this chapter owns the **error invariant** that ties the sync boundary into the one-gate story: a synced envelope's parse failure **never throws and never poisons** the last-good value.

### 5.1 The policy: skew, not throw

Recall (`sync` vs `synced`, [→ ch:overview-and-surfaces §1.2 Note]): `sync NAME :: SCHEMA from KEY` threads `SCHEMA` into `synced(KEY, { schema: SCHEMA })`, so **every envelope is parse-gated** against `SCHEMA` before it can replace the replica's value. The gate is the same `SCHEMA.parse(envelope.value): Result<T,string>` as `::` and `is`. The *policy on `Err`* is the third option:

- **On `Ok`** — the parsed value becomes the replica's new value (subject to the reconciler's `(schema_version, sequence)` ordering, [→ ch:data-sync-and-authority]).
- **On `Err`** — the replica's status transitions to `skew` (a known divergence the client can surface), the **last good value is retained**, and the envelope is dropped. **No throw**, because the boundary is live: a synced cell drives a running UI, and an exception would tear down the component tree over a single bad envelope.

```
# parse-gate-and-skew (the sync Err policy — reconciler detail in ch:data-sync-and-authority)
on envelope e:
    r = SCHEMA.parse(e.value)              // the same gate as :: and is
    if r.tag == "Ok":
        replica.value  = reconcile(r.value, e.schema_version, e.sequence)
        replica.status = "ok"
    else:                                  // r.tag == "Err"
        replica.status = "skew"            // surface the divergence; do NOT throw
        // replica.value unchanged — last-good retained (never poisoned)
        drop e
```

### 5.2 The never-poison invariant

&gt; **INV-errors-3 (parse failure never poisons synced state).** A synced envelope that fails `SCHEMA.parse` (a) **never throws** out of the reconcile path, and (b) **never replaces** the replica's current value with partial or `Err` data — the last value that *did* parse is retained. The only observable effect of a parse failure is a `ReplicaStatus` transition (to `skew`), which is a *value* the UI may read and respond to. This is the sync-boundary instance of "errors are values" (I3): the failure surfaces as readable status, not as a crash and not as corrupted state [→ ch:data-sync-and-authority].

The contrast across the three boundaries is now complete and exact:

| Boundary | Form | Gate | Policy on `Err` | Body/consumer sees |
|---|---|---|---|---|
| Handler entry | `(req:: T)` | `T.parse(req)` | **throw** `Error(error)` | parsed `T` (or never runs) |
| Guard | `x is T` | `T.parse(x)` | **return `false`** | narrowed `T` (true branch only) |
| Sync envelope | `sync n :: T` | `T.parse(env)` | **skew** (keep last-good) | `T` value + `status: "skew"` |

One `parse`. Three policies. The policy is chosen by the *kind* of boundary (assert / ask / replicate), and nothing else differs. That is the whole error model, mechanized.

&gt; **Edge case (the type-only sync form is *not* a gate).** `sync NAME : T from KEY` (single colon) lowers to `synced(KEY)` with `T` as a type annotation only — **no runtime parse**, so there is no `Err` policy because there is no parse. It is the `(req: T)` of the sync world: a *trusted* replica, typed but not gated. Use `::` when the envelope source is untrusted (the common case); use `:` only when delivery is already validated upstream (`configureSynced`'s codec is the gate) [→ ch:data-sync-and-authority].

---

## 6. `match` — total consumption of a tagged union

`match EXPR { pat => res, … }` is Para's pattern-matching expression: the total, expression-valued way to consume a `Result`, an `Option`, a literal, or any tagged union. The keyword is **Shipped** as surface (catalog `match-expr`, firing on `\b(match)\b(?=\s+[A-Za-z_$(])`, `lspAllowlist: true`); the **literal-pattern** lowering is **Shipped**; the constructor / destructure / guard patterns are **Partial** (lowered fully by the canonical parser; stubbed in the browser-lower live-compile path).

### 6.1 Grammar (shipped surface)

```
MatchExpr   ::= "match" Subject "{" Arm ("," Arm)* ","? "}"
Subject     ::= Expr                  ⟨bracket-balanced up to the opening `{`⟩
Arm         ::= Pattern "=>" Expr
Pattern     ::= Literal               ⟨Shipped — string / number literal⟩
             | "_"                    ⟨Shipped — catch-all / default⟩
             | CtorPattern            ⟨Partial — Ok/Err/Some/None, §6.3⟩
```

**Lexical note (subject extent).** `match` is recognized as a standalone identifier (not `str.match(/re/)`, not a longer name, not a binding `let match = …`). The subject is walked **bracket-balanced** from after `match` to the `{` that opens the arms: parens and brackets are skipped so a paren-grouped subject (`match (a + b) { … }`) stays in one piece, and strings/template-literals/comments are masked so a `{` inside a literal does not prematurely open the arm block. Arms are split on **top-level** commas (depth-tracked across `{}`/`[]`/`()` and through string/template spans). Each arm's `=>` is the first one **not** nested inside a paren/brace/bracket or an inner arrow — so an arm result that is itself an arrow (`x => () => x`) splits at the *outer* `=>`.

A guard against the `let match = …` binding shape is normative: a real match subject never starts with `=`, and the keyword form never follows a binding keyword, so `let match = $state<T>(…)` is *not* treated as a match (without this guard the subject walk would run forward to an unrelated `{` and swallow the span). This guard is mirrored in the LSP's `pui-transform` so the editor and build agree.

### 6.2 Dynamic semantics: the literal lowering (Shipped)

The all-literal case lowers to a `((__pm) => …ternary…)(SUBJECT)` IIFE — the subject is evaluated **once** (bound to `__pm`, the canonical "para match subject" name), then a right-folded ternary tests each pattern by `===` and falls through to the `_` arm's result (or `undefined` if no `_` arm):

```
# Desugar:  match SUBJECT { p1 => r1, p2 => r2, _ => d }   (all-literal patterns — Shipped)
Para:
    const label = match code {
      200 => "ok",
      404 => "missing",
      _   => "other",
    };
TS:
    const label = ((__pm) => __pm === 200 ? "ok" : __pm === 404 ? "missing" : "other")(code);
```

The fold is **right-associative** (`cases.reduceRight`), so the textual order of arms is the evaluation order (first matching arm wins). The `_` arm — the **catch-all** — supplies the ternary's final `else`; if absent, the default is `undefined`. Strings, numbers, and template-free literals are the shipped pattern vocabulary. The `__pm` IIFE guarantees the subject is evaluated exactly once even if it is an effectful or expensive expression — the spec-relevant property of the lowering (a naive expansion that repeated the subject per arm would re-run side effects).

&gt; **Edge case (no `_` arm → `undefined`).** In the *shipped* literal lowering, a `match` with no `_` arm and no matching pattern evaluates to `undefined` — there is **no** exhaustiveness check today. This is a known **Partial** gap: §9.1 proposes making missing exhaustiveness a **compile error** (not a runtime `undefined`, not a warning), which is the totality property the model demands. Until then, an author must supply `_` to be total, and the LSP/diagnostics flag a `match` whose subject type is a closed union missing an arm as a *warning* (the conformance chapter, [→ ch:tooling-diagnostics-and-conformance], pins the match-stub diagnostics).

### 6.3 Constructor patterns over `Result` / `Option` (Partial)

The natural use of `match` is over a `Result` or `Option` — the constructor-pattern form. It is **Partial**: recognized as surface, lowered by the canonical parser to a `tag` switch with a binding, but **stubbed** in the browser-lower live-compile path (which only handles literal arms and would mis-lower `Ok(value)` as a literal). The intended shipped semantics (realized by the canonical parser) are:

```
# Desugar:  match RESULT { Ok(v) => …, Err(e) => … }   (constructor patterns — Partial; canonical-parser form)
Para:
    const out = match User.parse(raw) {
      Ok(user) => user.email,
      Err(msg) => `bad: ${msg}`,
    };
TS:
    const out = ((__pm) =>
      __pm.tag === "Ok"  ? ((user) => user.email)(__pm.value)
    : __pm.tag === "Err" ? ((msg)  => `bad: ${msg}`)(__pm.error)
    : undefined
    )(User.parse(raw));
```

Each constructor pattern tests the discriminant (`__pm.tag === "Ok"`) and **binds** the arm's payload (`__pm.value` → `user`, `__pm.error` → `msg`) into the arm-result scope. `Some(v)` / `None` lower identically over `{ tag: "Some" | "None" }` (`None` binds nothing — `__pm.tag === "None" ? … : …`). Because `Result` and `Option` are *closed* two-arm unions, a `match` with both constructor arms is total **without** a `_` — and §9.1 makes that totality a *checked compile-time fact* (an `Ok`-only `match` over a `Result` is the error "non-exhaustive: missing `Err`").

&gt; **Status precision.** What ships *today*: the `match` keyword, the literal/`_` lowering, and the recognizer that lets `Ok(v)`/`Err(e)`/`Some(v)`/`None` *appear* as arm patterns. What is *stubbed/Partial*: the destructuring bind and the `tag`-switch lowering of those constructor arms in the browser-lower path — the canonical parser performs it; the live-compile demos do not. §9 promotes the whole non-literal pattern story from "canonical-parser-only / stubbed" to **spec'd surface** with exhaustiveness as a compile error.

### 6.4 `match` totality and the `_` obligation

`match` is an **expression** (§6.2's IIFE returns a value), so every evaluation must produce a value of the arm-result type. Totality is therefore not optional decoration — it is the property that makes `match` a *sound* expression rather than a partial function that can yield `undefined`. Two routes to totality:

1. **Closed-union exhaustiveness** — when the subject's type is a closed tagged union (`Result`, `Option`, a `schema`-derived enum), an arm for *every* constructor/variant is total with **no** `_`. This is the preferred form: the `_` is omitted precisely *because* the union is covered, and adding a `_` to an already-exhaustive `match` is a (proposed, §9.1) warning ("unreachable catch-all: the union is already exhaustive").
2. **Catch-all `_`** — when the subject is open (a `number`, a `string`, an external value), the `_` arm is **obligatory** for totality. The `_` is the catalog `underscore-lambda` allowlisted token reused as a pattern; in pattern position it means "any value," binds nothing, and supplies the ternary's `else`.

&gt; **INV-errors-4 (match totality obligation).** A `match` expression is **total** iff either (a) its subject type is a closed union and every variant has an arm, or (b) it has a `_` arm. Today, violation is *runtime `undefined`* + an LSP warning (Partial); §9.1 proposes violation be a **compile error**. Either way, the obligation is the same: every `match` must account for every value its subject can take (the I3 "no silent gap" property, applied to control flow).

---

## 7. `match` and the async dual (`..>` / `..!`) — one error model, two tempos

`match`-over-`Result` and the error-chain operators `..>` / `..!` / `..&` ([→ ch:lexical-and-expression-syntax §3]) are the **synchronous** and **asynchronous** faces of one error discipline. They are not redundant; they are the same idea at two tempos, and a Para program uses both:

- **`match`** consumes a *settled* `Result`/`Option` *synchronously* and *totally* — both arms, in one expression, returning a value. It is for "I have a `Result` in hand; branch on it."
- **`..> / ..! / ..&`** thread a *pending* `Promise` *asynchronously* — `..>` (then) on fulfilment, `..!` (catch) on rejection, `..&` (finally) regardless. It is for "I have a `Promise`; chain the success and failure paths without nesting."

The bridge between them is that an async fallible computation typically returns `Promise<Result<T,E>>` (a promise that *settles* with a `Result`, not a promise that *rejects*) — so the idiomatic Para async-error shape is `someAsync() ..> result => match result { Ok(v) => …, Err(e) => … }`: the `..>` waits for the promise, and the `match` totals the `Result` it settles with. Rejection (`..!`) is reserved for *infrastructural* failure (the network died), while `Err` (matched) is *domain* failure (the value was invalid) — the same `Result`-vs-throw distinction as §3's "`Err` is a value, the `::` throw is a policy." This keeps domain errors in the value channel (matched, total) and infrastructural errors in the rejection channel (caught), and the two never blur.

```pts
// .pts — the two tempos composed: async chain settling into a total match
loadUser(id)                              // Promise<Result<User, string>>
  ..> result => match result {            // ..> waits; match totals the Result
        Ok(user) => render(user),
        Err(msg) => renderError(msg),     // domain failure — a value
      }
  ..! netErr => renderOffline(netErr);    // infrastructural failure — a rejection
```

&gt; **Cross-ref (no redefinition).** The `..>`/`..!`/`..&` grammar, the `__pcv` leading-dot synthesis, the handler-scanning lexical rules, and the pipeline-binds-tighter precedence (INV-lex-2) are all owned by [→ ch:lexical-and-expression-syntax §3]. This chapter asserts only the *semantic pairing*: `match` is the sync total consumer of `Result`/`Option`; the error-chain ops are the async threader; domain failure lives in `Err` (matched), infrastructural failure in rejection (`..!`).

---

## 8. Model invariants (summary)

- **INV-errors-1 (one gate)** — every boundary turning external `unknown` into typed data runs `SchemaValue.parse → Result<T,string>`; the three forms (`::`, `is`, sync) differ only in their `Err` policy (throw / false / skew). §0.
- **INV-errors-2 (`::` body never sees unparsed data)** — the body of a function with an `(arg:: T)` parameter provably runs only on a parsed `T`; the throw fires before the first body statement. §3.2.
- **INV-errors-3 (parse failure never poisons synced state)** — a synced envelope failing `parse` never throws and never replaces last-good state; it only transitions `ReplicaStatus` to `skew`. §5.2 [→ ch:data-sync-and-authority].
- **INV-errors-4 (match totality obligation)** — a `match` is total iff its subject is a closed union with all variants covered, or it has a `_` arm; the obligation is "account for every value." §6.4.
- **INV-errors-5 (errors are values, throws are policy)** — `Schema.parse`, `Ok`/`Err`, `Some`/`None` never throw of their own accord; the only throw in the model is the `::` boundary *policy* layered onto an `Err` value. Failure is data until a boundary chooses to escalate it. §1, §3.2.

---

## 9. Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts` / the parser today, beyond the Partial `match` recognizer §6 already ships). Each gives grammar, static + dynamic semantics, a `# Desugar (proposed):` sketch so it stays glass-floor-compatible (I1), an example, and the rationale (which error-model gap it closes). They complete one arc: **make the error model total, not just disciplined** — total pattern matching (§9.1), ergonomic propagation (§9.2), a total *error* channel (§9.3), statement-position matching (§9.4), Option-aware piping (§9.5), and a standardized, projectable error shape (§9.6).

### 9.1 Complete `match`: constructor / destructure / guard patterns, bindings, exhaustiveness as a compile error  `Proposed`

**Rationale.** Today `match` ships the literal/`_` lowering and *recognizes* constructor arms, but the destructure/guard/binding patterns are Partial (canonical-parser-only) and **exhaustiveness is not checked** — a non-total `match` yields runtime `undefined` (§6.2 edge case). That is the single largest gap between the *discipline* "errors are values, consumed totally" and the *mechanism*. This proposal specifies the complete pattern grammar **and** promotes non-exhaustiveness from a runtime `undefined` (or LSP warning) to a **compile error** — the I3 "no silent gap" property applied to control flow. A `match` that does not account for every value its subject can take must not compile.

**Grammar.**

```
MatchExpr    ::= "match" Subject "{" Arm ("," Arm)* ","? "}"
Arm          ::= Pattern Guard? "=>" Expr
Guard        ::= "if" Expr                          ⟨arm fires only when guard is truthy⟩
Pattern      ::= Literal
              | "_"                                  ⟨catch-all; binds nothing⟩
              | Ident                                ⟨binding — binds the whole subject⟩
              | CtorPattern
              | ObjectPattern
              | ArrayPattern
CtorPattern  ::= ("Ok" | "Err" | "Some") "(" Pattern ")"
              | "None"
ObjectPattern::= "{" FieldPat ("," FieldPat)* "}"
FieldPat     ::= Ident (":" Pattern)?                ⟨`{ id }` binds id; `{ id: P }` recurses⟩
ArrayPattern ::= "[" (Pattern ("," Pattern)*)? RestPat? "]"
RestPat      ::= "..." Ident
```

**Lexical note.** The `if` of a `Guard` is recognized in **arm position only** (after a `Pattern`, before `=>`), distinct from a statement `if`. The arm's `=>` split (§6.1) already skips nested arrows; the `Guard` extends the pattern-side scan to absorb `if COND` before the `=>`. A `CtorPattern`'s inner `Pattern` may itself bind (`Ok(user)` binds `user`; `Ok({ id })` destructures-and-binds), so binds nest.

**Static semantics.** Patterns introduce **bindings** scoped to their arm's result expression (and guard): `Ok(user) => user.x` binds `user: T` from `Result<T,E>`; `{ id, name }` binds `id`/`name` from the subject's fields; `[head, ...rest]` binds `head` and `rest`. A bare `Ident` pattern binds the whole subject (a named catch-all). **Exhaustiveness is checked against the subject's type**: a closed union (`Result`, `Option`, a `schema` enum, a literal union) must have every variant covered *or* a `_`/`Ident` catch-all; otherwise it is the **compile error** `non-exhaustive match: missing Err` (or `missing case 404 | 500`, etc.). A **guarded** arm (`pat if cond`) does *not* count toward exhaustiveness (the guard may be false), so a guarded arm always requires a later unguarded arm or `_` to remain total — the checker treats `Ok(v) if v.ok` as "not provably covering `Ok`." An **unreachable** arm (a pattern fully shadowed by an earlier one, or a `_` before the last arm) is the error `unreachable match arm`.

**Dynamic semantics / desugar.** The IIFE-over-`__pm` lowering (§6.2) generalizes: the ternary tests each pattern (`__pm.tag === "Ok"` for ctors, structural checks for object/array, `===` for literals), AND-conjoins the guard, and binds via an inner arrow whose params are the pattern's bindings. Exhaustiveness being a compile error means the lowering needs **no** runtime `undefined` fallback for a checked-total `match` — the final arm is *known* to cover, so the trailing `: undefined` is emitted only for a `_`-terminated open match. The lowering stays the readable nested ternary (I1).

```
# Desugar (proposed):  full match — ctor + destructure + guard + binding
Para:
    const msg = match parse {
      Ok({ role }) if role === "admin" => "welcome, admin",
      Ok(user)                          => `hi ${user.name}`,
      Err(e)                            => `error: ${e}`,
    };
TS:
    const msg = ((__pm) =>
      __pm.tag === "Ok" && __pm.value.role === "admin"
        ? "welcome, admin"
    : __pm.tag === "Ok"
        ? ((user) => `hi ${user.name}`)(__pm.value)
    : __pm.tag === "Err"
        ? ((e) => `error: ${e}`)(__pm.error)
    : undefined        // emitted ONLY if the checker could not prove exhaustiveness;
    )(parse);          // here it is dead (the union is covered) and may be elided
```

**Interaction.** Completed `match` is the consumer for `Result` (§1), `Option` (§2), the `?` operator's threaded errors (§9.2), the typed-error schemas (§9.3), and `schema`-derived enums [→ ch:type-and-schema-system]. Exhaustiveness-as-compile-error composes with the `strict-totality` pragma [→ ch:overview-and-surfaces §5.2]: under that mode, an *open*-subject `match` lacking `_` is *also* an error (the pragma forbids the `undefined` fallback reaching a boundary). It discharges the totality leg of I3 for control flow. The diagnostic surfacing (codes, paths) is [→ ch:tooling-diagnostics-and-conformance].

**Example.**

```pts
schema Shape { kind: "circle" | "square", size: int }

// ✗ counter-example — non-exhaustive is a COMPILE ERROR, not runtime undefined
fun area(s:: Shape) = match s.kind {
  "circle" => Math.PI * s.size ** 2,
  // ✗ error: non-exhaustive match: missing case "square"  (add an arm or `_`)
};

// ✓ total — every variant covered, no `_` needed
fun area2(s:: Shape) = match s.kind {
  "circle" => Math.PI * s.size ** 2,
  "square" => s.size ** 2,
};
```

### 9.2 `?` — Result try-propagation operator  `Proposed`

**Rationale.** Threading a `Result` through a chain of fallible steps requires, today, a `tag` check per step (§1.2) — readable but ceremonial, and the ceremony scales with the chain length. The `?` postfix operator collapses "unwrap the `Ok`, or early-return the `Err`" into one token, lowering to the exact `tag`-check-and-return a developer would hand-write (the glass floor). It is the synchronous, value-channel analogue of `..>`/`..!` (which thread *promises*); `?` threads `Result`s.

**Grammar.**

```
TryExpr ::= Expr "?"          ⟨postfix — on a Result<T,E>-typed expression⟩
```

**Lexical note (postfix-`?` vs ternary / optional-chaining disambiguation — NORMATIVE).** A bare postfix `?` collides with three host forms; the spec resolves all three lexically:
- **Ternary** `cond ? a : b` — a `?` is **try-propagation** only when it is **not** followed (after whitespace) by a ternary consequent leading to a `:` at the same depth. The disambiguator: try-`?` is immediately followed by a *postfix boundary* — `;`, `)`, `]`, `}`, `,`, a newline, or another postfix operator — **not** by an expression. `r?` at a statement/operand boundary is try; `c ? x : y` (an expression after the `?`) is ternary. A try-`?` whose value is then *used* is written with the `?` adjacent to its operand and a boundary after (`const v = step()?;` — the `;` is the boundary).
- **Optional chaining** `a?.b` and **optional call** `a?.(x)` — a `?` immediately followed by `.` or `(` is host optional-chaining, **never** try (the parser requires the try-`?` *not* be followed by `.`/`(`). `r?.value` is optional access on `r`; `r?` then a boundary is try on `r`.
- **Optional parameter / property** `name?: T` — a `?` followed by `:` in a *declaration* position is host-optional, not try (try-`?` is an *expression* postfix, never a declaration one).

The rule in one line: **try-`?` is a `?` at expression-postfix position followed by a postfix boundary and not by `.`/`(`/`:`/a consequent.** This is a multi-token lookahead, in the spirit of the existing `..` vs `1.method()` and `Nd` vs range disambiguators [→ ch:lexical-and-expression-syntax]. Where ambiguity would otherwise remain, the spec **requires** the parser prefer the host form (ternary / optional-chaining) and emit a diagnostic suggesting the explicit `match`/`tag`-check form — Para never silently reinterprets a valid host `?`.

**Static semantics.** `EXPR?` where `EXPR: Result<T,E>` has type `T` (the unwrapped `Ok` value); it is legal **only** inside a function whose return type is `Result<_, E>` (or `Promise<Result<_, E>>`) with a compatible `E` — the early-return must have somewhere to go. Using `?` in a function not returning a compatible `Result` is the error `'?' propagates Err but the enclosing function does not return a Result<_, E>`. `E` must unify across all `?` sites and the return type (or be widened explicitly), keeping the `Err` channel typed (no `any`, I3).

**Dynamic semantics / desugar.** `EXPR?` evaluates `EXPR` once; on `Ok` it yields `.value`; on `Err` it **returns** `Err(.error)` from the enclosing function immediately. The lowering is the §1.2 glass floor, mechanized:

```
# Desugar (proposed):  Result try-propagation
Para:
    fun pipeline(raw:: unknown): Result<Receipt, string> {
      const user  = User.parse(raw)?;        // unwrap or early-return Err
      const order = loadOrder(user.id)?;
      return Ok(checkout(order));
    }
TS:
    function pipeline(raw): Result<Receipt, string> {
      const __r0 = User.parse(raw);
      if (__r0.tag === "Err") return __r0;        // Err(__r0.error), as-is
      const user = __r0.value;
      const __r1 = loadOrder(user.id);
      if (__r1.tag === "Err") return __r1;
      const order = __r1.value;
      return Ok(checkout(order));
    }
```

Each `?` becomes a `const __rN = …; if (__rN.tag === "Err") return __rN; … = __rN.value;` triple — the readable early-return a developer writes by hand. The synthetic name uses the `__r` prefix family (consistent with the parser's `__pm`/`__pcv`/`__pb0` convention [→ ch:overview-and-surfaces §3.2]).

**Interaction.** `?` is the value-channel sibling of the error-chain ops [→ ch:lexical-and-expression-syntax §3]: `..!` catches a *promise* rejection, `?` propagates a *`Result`* `Err`. It composes with `::` (a `(raw:: T)` gate produces the parsed value `?` then threads), with `match` (a function may `?`-propagate the common case and `match` the one it wants to handle), and with §9.3 (the propagated `E` is a typed error schema, so the threaded channel is total + projectable). Under `strict-totality` [→ ch:overview-and-surfaces §5.2], `?` is the *sanctioned* way to thread errors (it cannot drop an `Err`), so the pragma steers code toward it.

**Example.**

```pts
fun confirm(raw:: unknown): Result<Confirmation, AppError> {
  const req = CheckoutRequest.parse(raw)?;       // parse Err propagates
  const stk = reserveStock(req.items)?;          // domain Err propagates
  return Ok(buildConfirmation(stk));             // only the happy path is written
}
```

### 9.3 Typed error schemas — the `Err` channel is a schema too  `Proposed`

**Rationale.** Today `Schema.parse` returns `Result<T, string>` — the `Err` arm is a bare `string`. That is enough to *detect* failure but not to *project* it: the wire codec sends the `Ok` value with full schema fidelity but the error as an opaque string, so the client cannot match on error *kind*, and the `Err` channel is the one place the spine is *not* total (a silent `any`-shaped hole at the boundary, against I3). This proposal makes **errors schemas too**: a fallible operation declares its error type as a `schema`, the `Err` channel carries that typed value, and the codec projects the `Err` arm onto the wire **alongside** the `Ok` arm — so a client receives a *typed, matchable* error.

**Grammar.**

```
ErrorsDecl  ::= "errors" Ident "{" Variant ("," Variant)* ","? "}"   ⟨a closed error union — schema⟩
Variant     ::= Ident ("{" FieldDecl ("," FieldDecl)* "}")?
FunErrAnn   ::= "fun" Ident "(" Params ")" "!" Ident                 ⟨`! E` — declares the Err schema⟩
```

`errors NAME { … }` declares a closed tagged-union *error schema* (a `schema` whose variants are the error cases, each optionally carrying typed fields). `fun f(…) ! AppError` annotates a function's `Err` channel with that schema — sugar for a return type of `Result<_, AppError>`.

**Static semantics.** `errors AppError { NotFound, Forbidden { reason: str }, RateLimited { retryAfter: int } }` lowers to a `schema AppError` whose `Infer` is the union `{ tag: "NotFound" } | { tag: "Forbidden"; reason: string } | { tag: "RateLimited"; retryAfter: number }`. A `fun f(…) ! AppError` types as returning `Result<R, Infer<typeof AppError>>`. Because the error type is a *closed* schema, a `match` over the `Err` arm is **exhaustiveness-checked** (§9.1): handling `NotFound` and `Forbidden` but not `RateLimited` is the compile error `non-exhaustive: missing error variant RateLimited`. The `Err` channel is now as total as the `Ok` channel — no `string` escape, no `any`.

**Dynamic semantics / desugar.** The error schema decorates like any `schema` (`__paraFromSchema`); the wire codec projects **both** arms (the `Ok` value via the success schema, the `Err` value via the error schema) so a `Result<R, E>` round-trips with full fidelity in both directions [→ ch:modules-projections-and-build]. The runtime `Err` carries the typed variant, not a string.

```
# Desugar (proposed):  typed error schema + projected Err channel
Para:
    errors AppError {
      NotFound,
      Forbidden { reason: str },
      RateLimited { retryAfter: int },
    }
    fun loadUser(id:: UUID) ! AppError : Result<User, AppError> {
      const row = db.find(id);
      if (!row) return Err({ tag: "NotFound" });
      return Ok(row);
    }
TS:
    const AppError = __paraFromSchema(() => ({ anyOf: [
      { type: "object", properties: { tag: { const: "NotFound" } },    required: ["tag"] },
      { type: "object", properties: { tag: { const: "Forbidden" },  reason: { type: "string" } }, required: ["tag","reason"] },
      { type: "object", properties: { tag: { const: "RateLimited" }, retryAfter: { type: "integer" } }, required: ["tag","retryAfter"] },
    ]}));
    type AppError = (typeof AppError)["schema"];
    function loadUser(id): Result<User, AppError> {
      const __v = UUID.parse(id); if (__v.tag === "Err") throw new Error(__v.error); id = __v.value;
      const row = db.find(id);
      if (!row) return Err({ tag: "NotFound" });
      return Ok(row);
    }
    // wire codec projects BOTH the Ok (User) and Err (AppError) arms — ch:modules-projections-and-build
```

**Interaction.** Typed errors make `?` (§9.2) carry a typed `E` (so the threaded channel is total), make `match` over the `Err` arm exhaustiveness-checkable (§9.1), and close the A2/I3 hole at the *error* boundary — the `Err` channel becomes a schema projection like every other boundary artifact [→ ch:modules-projections-and-build, ch:data-sync-and-authority]. The standardized *validation*-error shape (§9.6) is a *specific* such error schema (the one `Schema.parse` itself returns). Under `strict-totality` [→ ch:overview-and-surfaces §5.2], a `fun` whose `Err` channel is bare `string` reaching a boundary is flagged — typed errors are how you satisfy the gate.

**Example.**

```pts
errors CheckoutError { OutOfStock { sku: str }, PaymentDeclined, AddressInvalid { field: str } }

fun checkout(req:: CheckoutRequest) ! CheckoutError : Result<Receipt, CheckoutError> {
  const stock = reserve(req.items)?;             // OutOfStock propagates, typed
  const paid  = charge(req.payment)?;            // PaymentDeclined propagates, typed
  return Ok(receiptFor(paid));
}

// client side — the Err arm is matchable BY VARIANT, not by string parsing:
match await checkout(form) {
  Ok(receipt)                  => show(receipt),
  Err({ tag: "OutOfStock", sku }) => warn(`${sku} sold out`),
  Err({ tag: "PaymentDeclined" }) => promptCard(),
  Err({ tag: "AddressInvalid", field }) => highlight(field),
  // exhaustive over CheckoutError — no `_` needed
}
```

### 9.4 `match` as a statement — binding scopes, no fallthrough  `Proposed`

**Rationale.** `match` ships as an *expression* (§6) — every arm must produce a value. But many uses are *effectful*: an arm runs a block (logs, dispatches, mutates) and produces nothing. Forcing those into expression position (each arm an IIFE returning `undefined`) is awkward and loses the natural "bind in the pattern, use across a block" scope. A statement form lets `match` head a block whose arms are statement blocks with the pattern's bindings in scope, fallthrough-free (each arm is closed; no `break` needed, no accidental fall-through — the C-switch footgun is absent by construction).

**Grammar.**

```
MatchStmt   ::= "match" Subject "{" StmtArm+ "}"
StmtArm     ::= Pattern Guard? "=>" Block
             | Pattern Guard? "=>" Stmt           ⟨single-statement arm⟩
Block       ::= "{" Stmt* "}"
```

The distinction from `MatchExpr` (§9.1) is positional: at **statement position** (a `match` whose result is not consumed — start of a statement, not an operand) the arms are **statement blocks**, not result expressions, and the `match` produces no value.

**Lexical note (statement-position detection).** A `match` is a *statement* when it appears at statement position (after `;`/`{`/newline, not as an operand) **and** its arms' right-hand sides are blocks/statements rather than expressions. This is the same statement-vs-expression disambiguation Para already applies to `effect { }` (block statement) vs an `effect` used as a value [→ ch:overview-and-surfaces §1.1, ch:reactivity-core]. The arm RHS shape (`{` block / statement vs expression) is the secondary cue; a `match` at statement position with expression arms is still a (discarded-value) expression.

**Static semantics.** Each arm's pattern bindings (§9.1) are scoped to that arm's `Block` (or `Stmt`). Arms do **not** fall through — control leaves the `match` after the matched arm's block, no `break`. Exhaustiveness is checked exactly as the expression form (§9.1): a statement `match` over a closed union must cover every variant or carry `_`; the difference is only that arms are effectful, not value-producing.

**Dynamic semantics / desugar.** A statement `match` lowers to an `if`/`else if` chain (not an IIFE — there is no value to return), the subject bound once to `__pm`, each arm a guarded block with its bindings as `const`s at block top:

```
# Desugar (proposed):  match statement
Para:
    match event {
      Ok(user) => {
        log(`login: ${user.id}`);
        dispatch(loggedIn(user));
      }
      Err(e) if e.tag === "RateLimited" => backoff(e.retryAfter),
      Err(e) => report(e),
    }
TS:
    {
      const __pm = event;
      if (__pm.tag === "Ok") {
        const user = __pm.value;
        log(`login: ${user.id}`);
        dispatch(loggedIn(user));
      } else if (__pm.tag === "Err" && __pm.error.tag === "RateLimited") {
        const e = __pm.error;
        backoff(e.retryAfter);
      } else if (__pm.tag === "Err") {
        const e = __pm.error;
        report(e);
      }
      // no trailing else needed: the union is exhaustively covered (§9.1)
    }
```

**Interaction.** The statement form is the effectful dual of the expression form — same patterns (§9.1), same exhaustiveness (compile error), same typed errors (§9.3), but lowering to `if`/`else` and producing no value. It is the natural consumer at handler boundaries (a `match req.action { … }` dispatch) and inside `effect`/`when` blocks [→ ch:reactivity-core, ch:effects-lifecycle-concurrency]. The no-fallthrough guarantee is a *correctness* property (the C-switch fall-through bug cannot be written), aligning with the spec's "the correct path is the easy path."

**Example.**

```pts
fun handle(msg:: InboundMessage) {
  match msg {
    { kind: "ping" }            => reply(pong()),
    { kind: "data", payload }   => ingest(payload),     // `payload` bound in-arm
    { kind } if kind.startsWith("_") => {},             // ignore internal — guarded
    _                           => reject(msg),          // catch-all for openness
  }
}
```

### 9.5 Option-aware pipeline / elvis — short-circuit on `None`  `Proposed`

**Rationale.** The pipeline `|>` [→ ch:lexical-and-expression-syntax §2] threads a value through stages; the error-chain `..>` threads a *promise*. Neither short-circuits on **absence**: a stage that returns `Option<T>` forces a manual `match`/`tag` check before the next stage. This proposal adds an **Option-aware pipeline** stage operator that short-circuits on `None` — the value-channel analogue of `?.` optional chaining, lifted to the pipeline, unifying `Option` with the operator surface. The detailed operator grammar lives with the other pipeline forms [→ ch:lexical-and-expression-syntax]; this section specifies the **Option semantics** it carries.

**Grammar.**

```
OptPipeStage ::= "|?>" PipeStage         ⟨Option-aware stage — short-circuits on None⟩
ElvisExpr    ::= Expr "??" Expr           ⟨Option elvis — unwrap Some or supply default⟩
```

`|?>` is an Option-short-circuiting pipeline stage; `EXPR ?? DFLT` unwraps a `Some` or yields the default on `None` (the Option elvis, distinct from the host nullish `??` by operating on `Option<T>`, not `T | null`).

&gt; **Cross-ref (operator home).** `|?>` is a *member of the pipeline family* and its lexical extent / LHS-RHS scanning rules are owned by [→ ch:lexical-and-expression-syntax §2]; the Option elvis `??`-over-`Option` is the value-channel sibling there. This section owns only the `None`-short-circuit *semantics*. The two chapters are consistency-checked: `|?>` is to `Option` what `..>` is to `Promise` and `|>` is to a plain value.

**Static semantics.** In `a |?> f |?> g`, each stage `f`/`g` takes the *unwrapped* `Some` value and returns an `Option`; the chain's type is `Option<R>` (the last stage's). If any stage yields `None`, the rest are skipped and the chain is `None`. `EXPR ?? DFLT` where `EXPR: Option<T>` has type `T` (the `Some` value or `DFLT`). No `any`: the `Option` is typed end-to-end.

**Dynamic semantics / desugar.** `|?>` lowers to a `tag === "Some"` short-circuit per stage; `??` to the unwrap-or-default. Both are the readable hand-written check (I1):

```
# Desugar (proposed):  Option-aware pipeline + elvis
Para:
    const city = lookup(id) |?> .address |?> geocode ?? "unknown";
TS:
    const __o0 = lookup(id);                                    // Option<Record>
    const __o1 = __o0.tag === "Some" ? __o0.value.address : None;
    const __o2 = __o1.tag === "Some" ? geocode(__o1.value) : None;   // geocode: T -> Option<City>
    const city = __o2.tag === "Some" ? __o2.value : "unknown";        // elvis default
```

**Interaction.** `|?>` is to `Option` what `?` (§9.2) is to `Result` and `..>` is to `Promise`: the three short-circuit operators, one per channel (absence / failure / pending). It composes with `match` (a pipeline result is an `Option` a `match` can total), with the first-class `Option<T>` type [→ ch:type-and-schema-system §12], and with the leading-dot stage sugar of the base pipeline [→ ch:lexical-and-expression-syntax §2]. The unification across the three channels is the point: a Para developer learns one short-circuit idiom and applies it to absence, failure, and asynchrony.

**Example.**

```pts
// thread an Option through stages; None anywhere short-circuits to the default
const greeting =
  users.find(u => u.id === id)        // Option<User>
  |?> .profile                         // Option<Profile>  (None if no profile)
  |?> p => Some(`hi ${p.displayName}`) // Option<string>
  ?? "hi there";                       // default on any None
```

### 9.6 Standardized validation-error shape — path + code + message, projected to form-binding  `Proposed`

**Rationale.** `Schema.parse` returns `Result<T, string>` — a single human string. That is unusable for a *form*: a UI needs to know *which field* failed, *why* (a stable code, not a localized string), and *what to say*. Today a parse failure is one opaque message with no field path, so client-side field-level validation re-implements the schema by hand (an A2/I3 hole — the same validation in two places, drifting). This proposal standardizes the validation-`Err` value as a structured `{ path, code, message }[]` (a *typed error schema*, §9.3 — the one `Schema.parse` itself returns), and projects it onto client **form-binding**: a synced/bound form input reads its field's errors directly from the parse result, so one schema drives both server validation and client field hints.

**Grammar.** No new keyword — this is the *shape* of the `Err` channel `Schema.parse` returns, formalized as a built-in error schema:

```
ValidationError ::= "{" "issues" ":" Issue "[" "]" "}"
Issue           ::= "{" "path" ":" str "[" "]" "," "code" ":" Code "," "message" ":" str "}"
Code            ::= "required" | "type" | "format" | "min" | "max" | "pattern" | "enum" | …
```

A `schema`'s `parse` upgrades from `Result<T, string>` to `Result<T, ValidationError>`, where `ValidationError` carries an array of `issues`, each with a **`path`** (the field location, e.g. `["address", "zip"]`), a **`code`** (a stable, machine-matchable reason), and a **`message`** (a default human string, overridable/localizable).

**Static semantics.** `ValidationError` is a built-in error schema (§9.3); `SchemaValue.parse: (v: unknown) => Result<T, ValidationError>`. The `code` is a closed union (exhaustiveness-checkable in a `match`). The `path` is a structured field path, so a UI can index errors by field. This is a *non-breaking widening* of the `Err` arm (string consumers read `issues[0].message`); §9.3's projection sends the structured error across the wire so the client receives the same `path`/`code`/`message` the server computed — never a re-validation.

**Dynamic semantics / desugar.** `parse` populates `issues` from the schema body's failed constraints (one issue per violated constraint, with its `path` from the field location and `code` from the constraint kind). A `.pui` form binding reads issues for its field by path:

```
# Desugar (proposed):  standardized validation error + form-binding projection
Para (.pts):
    const r = SignupForm.parse(input);
    // r: Result<Signup, ValidationError>
    // r.error.issues == [{ path: ["email"], code: "format", message: "must be a valid email" }, …]

Para (.pui):
    <input bind:value={form.email} :: SignupForm.email />
    {#each errorsFor(form, "email") as e}<span class="err">{e.message}</span>{/each}
Runes (.pui):
    // errorsFor(form, "email") reads form's parse-result issues filtered to path ["email"]
    // ONE schema (SignupForm) drives server parse AND client field hints — no re-validation
```

**Interaction.** The standardized shape is a *specific* typed error schema (§9.3) — the one `Schema.parse` returns — so it inherits projection (the `path`/`code`/`message` cross the wire, [→ ch:modules-projections-and-build, ch:data-sync-and-authority]), `match`-ability (a `match` on `issue.code` is exhaustiveness-checked, §9.1), and `?`-propagation (§9.2). It composes with the proposed schema-driven form binding [→ ch:pui-component-model §Proposes] — that proposal binds an input to a schema field; *this* proposal supplies the typed error that binding surfaces. Together they close the A2 hole: field-level validation is the schema projected to the client, computed once, never re-implemented. The `code` stability is what lets the message be localized at the edge without the server knowing the locale.

**Example.**

```pts
schema Signup { email: Email, age: int(13..120), handle: str(3..20) }

fun register(raw:: unknown): Result<User, ValidationError> {
  const r = Signup.parse(raw);
  if (r.tag === "Err") return r;        // structured issues flow to the client unchanged
  return Ok(create(r.value));
}

// client — one schema, field-addressed errors, no re-validation:
match register(form) {
  Ok(user) => goTo(user),
  Err({ issues }) => for (const i of issues) markField(i.path, i.code, i.message),
}
```

---

## 10. Chapter summary

Para's error model is one gate (`Schema.parse → Result`) at three boundaries (`::` throws, `is` asks, sync skews), one total consumer (`match`), and two absence/failure channels (`Option`, `Result`) that never throw of their own accord — the throw is always a *policy* a boundary chooses, never the validator's behavior (INV-errors-5). The shipped surface gives the constructors, the gate, the guards, and the literal `match`; the proposed surface **completes** it — total pattern matching with exhaustiveness as a compile error (§9.1), ergonomic `?` propagation (§9.2), a typed and projectable `Err` channel (§9.3), effectful statement-`match` (§9.4), Option-aware piping (§9.5), and a standardized, form-bindable validation-error shape (§9.6). Each lowers to the readable `tag`-check-and-branch a developer would write by hand (I1), and each closes a place where the error channel was previously less total than the value channel — making "errors are values, consumed totally" not just a discipline but a mechanism the compiler enforces.

