---
title: "Lexical Structure, Operators & Expression Sugar"
description: "The token layer and expression-level operators that are surface-wide and not tied to reactivity or schema: the pipeline `|>`, error-chain `..> / ..! /…"
sidebar:
  order: 3
---

# Chapter: Lexical Structure, Operators & Expression Sugar

&gt; **Status of this chapter:** Mixed. The token layer, the pipeline / error-chain / range / decimal operators, the `_` lambda placeholder, the leading-dot method shorthand, and the lexical disambiguation rules are **Shipped** (in the ParaBun parser and the `@lyku/para-transpile` mirror today). The `_1`/`_2` multi-arg placeholders, unit/quantity literals, the async pipeline variant, operator sections, and the Option-aware pipeline in *Proposed Extensions* are **Proposed**.
&gt; **Cross-refs:** This chapter owns the operators and literals usable in **any** expression position, surface-wide, that are not tied to reactivity or schema. Reactive-bind `~>` / `->` [→ ch:reactivity-core], schema validation `::` / `is` [→ ch:errors-results-and-validation, ch:type-and-schema-system], the `every` postfix interval [→ ch:reactivity-core], control-flow keywords (`match`, `when`, `parallel`, `defer`, `arena`) [→ ch:reactivity-core, ch:errors-results-and-validation], and the surface-dispatch / lowering-pipeline ordering [→ ch:overview-and-surfaces]. This chapter defines the *expression-level* sugar that those chapters compose with; it does not redefine their constructs.

---

## 0. Scope and boundary

Para's surface is a **strict superset** of its host language (INV-overview-4): every legal TypeScript/Svelte file is a legal Para file, and Para only *adds* tokens that lower away. The consequence for the lexer is that Para keywords and operators are recognized **contextually** — there are no new reserved words. An identifier named `signal`, `match`, `fun`, or `every` used as an ordinary value is *never* rewritten; the surface forms fire only in syntactic positions a plain-host program could never occupy.

This chapter specifies that contextual recognition for the **expression-level** surface:

- the **pipeline** operator `|>` (§2);
- the **error-chain** operators `..>` / `..!` / `..&` (§3);
- the **range** operators `..` / `..=` (§4);
- the **decimal** literal suffix `Nd` (§5);
- the **underscore placeholder** `_` (§6);
- the **leading-dot method shorthand** (§7);
- and the **lexical disambiguation** rules that hold all of the above together — statement-position keyword detection, `1.method()` vs `1..5`, the `d`-suffix vs range lookahead (§1, §8).

It does **not** cover the reactive-binding arrows (`~>` / `->`), the schema markers (`::` / `is`), the `every` postfix, or any control-flow keyword: those are operator/keyword forms tied to a *specific subsystem* (reactivity, schema, validation) and are defined in that subsystem's chapter. The dividing line is precise: **this chapter owns the operators and literals whose meaning is the same in every surface and every position, independent of reactivity and schema.**

&gt; **INV-lex-1 (contextual recognition).** No Para expression-operator or literal-suffix introduces a reserved word. For every form in this chapter there is a disambiguating lexical context (a glyph sequence the host never produces, or a lookahead/lookbehind guard); outside that context the bytes retain their host meaning. This is the per-token statement of the superset-closure invariant: `lower(h) ≡ h` for a host file `h` containing no Para construct.

---

## 1. The token layer

### 1.1 Token classes

Para's lexer is the host lexer plus a small set of **multi-character operator glyphs** and one **numeric-literal suffix**. The host token classes (identifiers, keywords, numeric/string/template/regex literals, punctuation) are unchanged. Para adds:

```
ParaOperator ::= "|>"                      ⟨pipeline⟩
               | "..>" | "..!" | "..&"      ⟨error-chain: then / catch / finally⟩
               | "..="  | ".."              ⟨range: inclusive / exclusive⟩
               | "~>"   | "->"              ⟨reactive-bind  — [→ ch:reactivity-core]⟩
               | "::"                       ⟨validate-marker — [→ ch:errors-results-and-validation]⟩
ParaLitSuffix ::= "d"                       ⟨decimal suffix on a numeric literal — §5⟩
```

Every glyph is **multi-character and chosen to be unambiguous against the host token stream**. `|>` cannot arise in TS (a `|` bitwise-or is never immediately followed by `>` in a valid expression). The `..`-family glyphs exploit the fact that TS has no `..` operator at all (only `...` spread and `.` access). `~>` and `->` (reactivity) and `::` (validation) are likewise host-absent. Because the glyphs are host-absent, **the lexer needs no mode switch** to recognize them; the only genuine ambiguities are *numeric*-adjacent (a digit then `.` then `.`, or a digit then `d`), handled in §8.

&gt; **Lexical note (`<`-sensitivity).** Para introduces **no** new `<`-ambiguity beyond the host's. In the JSX-enabled extensions (`.ptsx`/`.pjsx`) the host already disables TS generic-arrow syntax `<T>(x) => …`; Para inherits that unchanged (a leading type param is written `<T,>(x) => …`). None of this chapter's operators contain `<`, so they are inert to JSX disambiguation [→ ch:overview-and-surfaces §4.1].

### 1.2 Statement-position keyword detection

Para *keywords* (covered by their own chapters) are recognized only in **disambiguating positions** so the surface stays a superset. The full guard set is the catalog in `src/language-surface.ts`; the load-bearing pattern for expression-level reasoning is that a bare identifier matching a keyword is rewritten **only** when the *following* token could not occur after that identifier in a plain-host program. Representative guards (verbatim from the catalog, abbreviated):

```
fun       fires before  [A-Za-z_$*(<]          (a function head)         (?<!\.)\bfun\b(?=\s*[A-Za-z_$*(<])
signal    fires before  NAME [=,;:!]           (a binding head)          \bsignal\b(?=\s+[A-Za-z_$][\w$]*\s*[=,;:!])
effect    fires before  `{`  OR  ws + ident     (block / single-stmt)     \beffect\b(?=\s*\{|\s+[A-Za-z_$])
match     fires before  ws + [A-Za-z_$(]        (a subject)               \bmatch\b(?=\s+[A-Za-z_$(])
every     fires after   [)\d\w$] + ws           (a postfix on an expr)    (?<=[\)\d\w$])\s+every\s+(?=\d|[A-Za-z_$\(])
```

The mechanism this chapter relies on: **`effect`, `signal`, etc. are inert to the general expression-syntax pass.** This is what makes the two-pass `.pui` lowering composable (script lowering before reactivity lowering): a Para operator *inside* a reactive RHS is already host TS by the time the reactivity pass matches the declaration head, and a reactive keyword is *never* eligible for the expression-syntax pass [→ ch:overview-and-surfaces §4.2]. The guards are the precondition; this chapter's operators are the payload that flows through them.

**Static semantics.** A bytes-identical pure-host file is a fixed point of the expression-syntax pass: no guard fires, no helper is referenced, no preamble is injected (INV-overview-4). A guard mis-fire is a *parity bug*, adjudicated against the canonical parser (B1), never absorbed by mutating the corpus.

**Dynamic semantics.** None — the token layer has no runtime. Lexical recognition is a pure compile-time function of the byte stream and the bracket/region structure.

---

## 2. Pipeline `|>`

`Status: Shipped.`

The pipeline operator threads its left operand as the **first argument** of the right operand, left-associatively. It is the surface form for left-to-right data flow, replacing nested calls (`g(f(x))`) with a readable chain (`x |> f |> g`).

### 2.1 Grammar

```
PipelineExpr ::= Expr ( "|>" PipelineStage )+
PipelineStage ::= BareIdent                       ⟨x |> f          ⇒ f(x)⟩
                | CallTarget "(" ArgList? ")"      ⟨x |> f(y)       ⇒ f(y)(x)⟩
                | CallTarget "(" ArgListWith_ ")"  ⟨x |> f(_, y)    ⇒ f(x, y)⟩
                | "." Member CallTail*             ⟨x |> .method()  ⇒ x.method()⟩
ArgListWith_ ::= ⟨an ArgList containing ≥1 top-level `_` placeholder token (§6)⟩
```

- **Bare-ident** stage `f`: the LHS becomes the sole argument — `f(x)`.
- **Call** stage `f(y)`: the stage is *itself* a value (the result of `f(y)`), which is then called with the LHS — `f(y)(x)`. This is the function-returning-function (curried / factory) form.
- **Placeholder** stage `f(_, y)`: a top-level `_` token in the argument list (§6) is the substitution site; the LHS replaces `_` in place — `f(x, y)`. When a stage has a placeholder, the LHS is **not** appended; it is substituted.
- **Leading-dot** stage `.method()`: the stage binds onto the LHS as a receiver — `x.method()` (this is the §7 shorthand entering a pipeline stage).

**Lexical note (LHS / RHS extent).** A pipeline expression is delimited, not free-floating. Its **LHS start** scans backward through balanced parens to the first depth-0 boundary (`=` non-compound, `,`, `;`, `(`, `[`, `{`, `=>`, `return`, or newline); its **RHS end** scans forward through balanced parens to a statement terminator (`;`, depth-0 `,`, closing bracket, newline) **or** the first looser-precedence error-chain operator (`..>` / `..!` / `..&`). The chain is split on **top-level** `|>` only (a `|>` nested inside parens/brackets/braces is an operand, not a cut). The scan masks string/comment/regex spans so glyphs inside literals are inert.

### 2.2 Static semantics

- A pipeline is **left-associative**: `x |> f |> g ⇒ g(f(x))`. Each stage's result is the next stage's LHS.
- The placeholder form and the append form are mutually exclusive **per stage**: a stage either contains ≥1 top-level `_` (substitute) or it does not (append/call). A stage may use `_` more than once (§6 — multi-use).
- Type-wise the pipeline is **erasable**: `x |> f` type-checks exactly as `f(x)` would. There is no pipeline-specific type; the inferred type is the type of the fully-applied call. No `any` is introduced (I3).
- A pipeline never binds tighter than a member access inside a stage: `.method()` chains stay attached to their LHS receiver.

### 2.3 Dynamic semantics

A pipeline is **pure rewrite, no runtime helper** — it lowers to ordinary nested calls and has identical evaluation order to the hand-written nesting. Evaluation is innermost-first (the LHS is evaluated once; the result threads outward through the stages left-to-right).

&gt; **Edge case (single evaluation).** Because the LHS is *substituted as an expression*, a placeholder stage that uses `_` twice evaluates the LHS twice (`x |> f(_, _)` ⇒ `f(x, x)` — `x` textually duplicated). If the LHS has side effects and must be evaluated once, bind it first (`const v = x; v |> f(_, _)`). This is the conservative text-level behaviour; §6.1 (`Proposed`) hoists multi-use to a single binding.

### 2.4 Desugar

```
# Desugar:  bare-ident / call / placeholder / leading-dot stages
Para:
    data |> normalize |> validate
    user |> save(db)
    nums |> reduce(_, 0)
    name |> .trim() |> .toUpperCase()
TS:
    validate(normalize(data))
    save(db)(user)
    reduce(nums, 0)
    name.trim().toUpperCase()
```

```
# Desugar:  mixed chain with placeholder reuse
Para:
    x |> clamp(_, lo, hi) |> scale(2)
TS:
    scale(2)(clamp(x, lo, hi))
```

### 2.5 Example & rationale

```pts
// .pts
const slug = title
  |> .trim()
  |> .toLowerCase()
  |> replace(_, /\s+/g, "-");
// ⇒ replace(title.trim().toLowerCase(), /\s+/g, "-")
```

**Rationale.** `|>` is the surface form of "the schema is the application" at the *expression* scale: data flows forward through deliberately-written deltas, and the lowering is the exact nested call a developer could have written by hand (I1). It is glass-floor — there is no pipeline runtime to outgrow, only readable calls.

&gt; **Pass-ordering (normative).** Pipeline lowers **before** error-chain (`|>` binds tighter), so `data |> transform ..! handler` lowers to `transform(data).catch(handler)` [→ ch:overview-and-surfaces §4]. Inside a `.pui` it runs in the script-lowering pass (pass 2), before reactivity (pass 3) — so a `|>` in a `signal` RHS is already a plain call by the time the declaration head is matched.

---

## 3. Error-chain `..>` / `..!` / `..&`

`Status: Shipped.`

The error-chain operators are postfix promise combinators: they read as English (`then` / `catch` / `finally`) and lower to the corresponding `Promise.prototype` methods, left-associatively. They are the "effects are explicit, errors are values" surface for async flow — a chain you read top-to-bottom, not a nest of `.then().catch()`.

### 3.1 Grammar

```
ChainExpr  ::= Expr ( ChainOp Handler )+
ChainOp    ::= "..>"        ⟨then⟩
             | "..!"        ⟨catch⟩
             | "..&"        ⟨finally⟩
Handler    ::= Expr                       ⟨a callback value⟩
             | "." Member CallTail*       ⟨leading-dot sugar — §7, only on ..> / ..!⟩
```

- `p ..> next` ⇒ `p.then(next)`
- `p ..! recover` ⇒ `p.catch(recover)`
- `p ..& cleanup` ⇒ `p.finally(cleanup)`
- Left-associative: `p ..> f ..! a ..& b` ⇒ `p.then(f).catch(a).finally(b)`.

**Lexical note (handler scanning).** A handler is **not** regex-bounded: it may be a bare arrow function (`p ..> r => r.json()`) whose body itself contains parens, calls, and paren-grouped inner chains (`..! err => (recover() ..! fb)`). The handler scan walks forward through balanced parens to the next **top-level** chain op or expression terminator (`;`, depth-0 `,`, newline, closing bracket). `=>` is a **hard LHS boundary**: a chain op inside an arrow *body* chains onto the body expression, not back over the `=>`. Parens reset depth, so wrapping in `(...)` re-enables a nested chain. The LHS scan is symmetric to the pipeline's (§2.1).

### 3.2 The `__pcv` leading-dot synthesis

On `..>` and `..!` (but **not** `..&`), a handler whose first significant char (after trimming) is `.` is the leading-dot sugar: the handler's implicit receiver is the resolved/rejected value. It synthesizes an arrow whose parameter is **`__pcv`** ("para chain value") — the exact name the canonical parser emits, so parity fixtures stay byte-equal:

```
# Desugar:  leading-dot handler under ..> / ..!
Para:
    fetch(url) ..> .json() ..> .items
TS:
    fetch(url).then((__pcv) => __pcv.json()).then((__pcv) => __pcv.items)
```

`..&` deliberately gets **no** leading-dot sugar: a `finally` callback receives no value, so there is no implicit receiver to bind. A leading-dot handler under `..&` is left as-is (and surfaces as a downstream parse/runtime error) — the operator is intentionally narrower than `..>`/`..!`.

&gt; **Edge case (`__pcv` is per-stage, not chain-global).** Each leading-dot stage synthesizes its **own** `(__pcv) =>` arrow; the name `__pcv` is reused per stage but the arrows do not nest, so there is no capture collision across stages of one chain. Nesting *within* a handler (a method argument that is itself a chain) recurses, and the inner chain's `__pcv` shadows correctly because it lives inside its own arrow scope.

### 3.3 Static & dynamic semantics

**Static semantics.** The chain is erasable to the equivalent `.then/.catch/.finally` calls; it type-checks as `Promise<T>` would. `..>` expects the LHS to be thenable; `..!`/`..&` are valid on any `Promise`. Handlers are typed by `Promise.prototype.then`'s signature (the resolved value type for `..>`/`..!` `__pcv`, `void` for `..&`). No `any` is introduced.

**Dynamic semantics.** Identical to the hand-written promise chain. The chain ops compose left-to-right; `..&` runs regardless of settle state; rejection skips intervening `..>` to the next `..!`. There is no error-chain runtime helper — the lowering is plain `Promise` methods (I1).

&gt; **INV-lex-2 (chain ⊃ pipeline precedence).** `|>` binds tighter than `..> / ..! / ..&`. A `|>` chain appearing as an error-chain operand is fully collapsed *before* the chain op is applied: `x |> f ..> g` ⇒ `f(x).then(g)`. The pipeline's RHS scan stops at the first chain op (§2.1) precisely to enforce this. The two operator families therefore compose in exactly one order.

### 3.4 Example & rationale

```pts
// .pts
const data = await load(id)
  ..> .json()
  ..! err => fallback(err)
  ..& () => spinner.stop();
// ⇒ load(id).then((__pcv) => __pcv.json()).catch(err => fallback(err)).finally(() => spinner.stop())
```

**Rationale.** Async control flow is *composed, not hidden* (design principle 5). The chain reads as a sentence, each operator names its `Promise` method exactly, and the lowering is the chain a developer would write by hand — outgrowing it means reading three `.then`s, not ejecting a framework.

---

## 4. Ranges `..` / `..=`

`Status: Shipped.`

The range operators construct an iterable integer sequence. `..` is half-open `[a, b)`; `..=` is inclusive `[a, b]`. Both lower to a runtime helper.

### 4.1 Grammar

```
RangeExpr ::= Operand ".." Operand        ⟨exclusive: [a, b)⟩
            | Operand "..=" Operand        ⟨inclusive: [a, b]⟩
Operand   ::= IntLit | Ident | "(" Expr ")"
```

Operands are an integer literal, an identifier, or a parenthesized expression. Step is always `1`.

**Lexical note (operand shape & disambiguation).** The text-level rewriter is **conservative** by design — it fires only on a clear `operand .. operand` pattern. The inclusive form is matched *first* so the `=` is not consumed by the exclusive pattern; the exclusive pattern carries a negative lookahead `(?![.=])` so it never grabs `..=` (range-inclusive) or `...` (spread). The canonical parser handles the harder lexer-level cases in `js_lexer.zig`; the disambiguation table is §8.

### 4.2 Static & dynamic semantics

**Static semantics.** A range is `Iterable<number>` (specifically the helper's return type). It is most commonly consumed by `for…of`, spread, or array methods. No `any`.

**Dynamic semantics.** Lowers to `__parabunRange(a, b)` / `__parabunRangeInclusive(a, b)`, imported from the runtime bundle (`bun:wrap` natively / `parabun-browser-shims/wrap` under a bundler).

&gt; **INV-lex-3 (inverted-range emptiness).** A range whose start exceeds its end (after inclusivity) is **empty**, never reversed and never an error: `5..2` and `5..=2` both iterate zero times (`[]`). Ranges do not count downward; a descending sequence is written explicitly. This makes ranges *total* — every `a..b` has a defined, non-throwing meaning.

```
# Desugar:  exclusive / inclusive ranges
Para:
    for (const i of 0..n) { … }
    const dice = 1..=6;
    const empty = 5..2;
TS:
    for (const i of __parabunRange(0, n)) { … }
    const dice = __parabunRangeInclusive(1, 6);
    const empty = __parabunRange(5, 2);          // iterates 0 times
```

### 4.3 Example & rationale

```pts
// .pts
const evens = [...0..10].filter(_ % 2 === 0);   // _ placeholder (§6): [0..9] then keep evens
// ⇒ [...__parabunRange(0, 10)].filter((__pu) => __pu % 2 === 0)
```

**Rationale.** A bounded integer sequence is a total, ejectable value (the helper is readable source). Inverted-emptiness over inverted-error keeps `a..b` usable in derived/generic contexts where the bounds are dynamic without a guard at every site.

---

## 5. Decimal literals `Nd`

`Status: Shipped.`

A numeric literal with a trailing lowercase `d` is an **exact decimal** literal. It lowers to a `__paraDec(...)` runtime call constructed from the literal's **source string**, never from a `Number` — the entire point is to skip the IEEE-754 roundtrip. This is the surface form for "exact-by-default arithmetic where it matters."

### 5.1 Grammar

```
DecimalLit ::= NumericBase "d"
NumericBase ::= ( "." Digit+ | Digit+ ( "." Digit* )? ) Exponent?
Exponent   ::= ("e" | "E") ("+" | "-")? Digit+
```

Accepted bases: integer (`42d`), decimal (`0.1d`, `1.5d`, `100.25d`, `.5d`), and scientific (`1.5e3d`, `2E+10d`). The `d` must not be followed by another identifier character (so `1do` is not a decimal).

**Lexical note (the four edges).**

1. **Leading boundary** — the literal fires only where the preceding char is *not* an identifier char or `.` (lookbehind `(?<![\w$.])`). This is what stops `let id = 1` (the `d` in `id` is part of an identifier, not a suffix on `1`) and `obj.5d` (a `.5` that is property-adjacent) from misfiring.
2. **Hex / octal / binary are excluded** — `Decimal` accepts base-10 strings only; `0x1Fd` / `0o17d` / `0b10d` are **not** decimal literals (the `d`/`f` are hex digits or plain identifier tails, never the suffix).
3. **BigInt is a different token** — `1n` is a BigInt; there is no `nd`/`dn` combination. The decimal pass does not touch `n`-suffixed literals.
4. **Sign is unary, not part of the literal** — `-1d` is unary-minus applied to the decimal `1d` (mirroring `-1n` over BigInt), i.e. `(-1) ⊗ __paraDec("1")` semantics via the Decimal's own negate, not `__paraDec("-1")`.
5. **Trailing `..` is the range op** — `1d..5` is `(1d) .. 5`; the decimal pass runs *first* (so the `d` is gone before the range pass sees the source) and the range pass's lookahead keeps them separate (§8).

### 5.2 Static & dynamic semantics

**Static semantics.** A decimal literal has the runtime `Decimal` type (the `__paraDec` return). Arithmetic on decimals routes through `.add` / `.sub` / `.mul` / `.div` methods rather than host `+`/`*` (so there is no FP drift); the method-routing for decimal operands is [→ ch:type-and-schema-system] — this chapter specifies only the *literal*. No `any`.

**Dynamic semantics.** `Nd` ⇒ `__paraDec("N")` where `"N"` is the **verbatim source numeric string** (`JSON.stringify` of the captured base). The construction is string-based, so `0.1d` is exact (`__paraDec("0.1")`, never `__paraDec(0.1)`).

```
# Desugar:  decimal literals (string-form, no FP roundtrip)
Para:
    const rate  = 0.0825d;
    const count = 42d;
    const sci   = 1.5e3d;
    const half  = .5d;
TS:
    const rate  = __paraDec("0.0825");
    const count = __paraDec("42");
    const sci   = __paraDec("1.5e3");
    const half  = __paraDec(".5");
```

```
# Desugar:  the edges that DON'T fire
Para:
    let id = 1;           // `d` is part of `id`
    const x = 0x1Fd;      // hex — `d`/`F` are hex digits
    const b = 1n;         // BigInt — different token
    const r = 1d..5;      // decimal THEN range
TS:
    let id = 1;
    const x = 0x1Fd;
    const b = 1n;
    const r = __parabunRange(__paraDec("1"), 5);
```

### 5.3 Example & rationale

```pts
// .pts — money math without float drift
const subtotal = qty |> mul(_, 19.99d);   // (qty) ⊗ __paraDec("19.99")
const tax      = subtotal.mul(0.0825d);
const total    = subtotal.add(tax);
```

**Rationale.** Exactness where it matters is a *correctness* property, not a library opt-in: the suffix makes the exact path the easy path, and the lowering carries the source string so no precision is lost at the boundary. The four edges keep the suffix from colliding with identifiers, alternate bases, and the range operator — the superset stays closed (INV-lex-1).

---

## 6. The underscore placeholder `_`

`Status: Shipped.`

`_` is an **expression-context lambda placeholder**: a bare `_` in an expression argument position is rewritten at parse time into a single-parameter arrow whose body is the expression, with `_` bound to the parameter. The synthesized parameter is **`__pu`** ("para underscore"), the name the canonical parser emits.

### 6.1 Grammar

```
PlaceholderExpr ::= ⟨any Expr containing ≥1 top-level `_` token in a lambda-expecting position⟩
```

`_` is *not* a distinct grammar production with its own syntax highlight — at the source level it looks like an ordinary identifier (the catalog entry contributes only an LSP allowlist flag so an expression-position `_` does not trip a "Cannot find name" diagnostic). The rewrite is purely positional: a `_` appearing where a callback is expected (array-method arg, pipeline placeholder stage, filter/map predicate) wraps the surrounding expression.

### 6.2 Static & dynamic semantics

**Static semantics.** `arr.filter(_ > 0)` is the arrow `arr.filter((__pu) => __pu > 0)`; the placeholder's type is inferred from the callback's expected parameter type (so no `any`). A `_` used as a real binding name (`const _ = x`) is untouched — only expression-position `_` rewrites.

**Dynamic semantics.** `_` ⇒ `(__pu) => <expr-with-_-replaced-by-__pu>`. **Multi-use** of `_` within one wrapped expression binds the **same** parameter at every occurrence: `_.x + _.y` ⇒ `(__pu) => __pu.x + __pu.y` (one parameter, referenced twice). This differs from the pipeline placeholder (§2.1), where `_` is a *substitution site for the LHS*, not a lambda binding — context decides which meaning applies.

```
# Desugar:  underscore lambda (single + multi-use)
Para:
    arr.filter(_ > 0)
    pts.map(_.x + _.y)
    xs.sort((_,b) => _ - b)         // mixed: `_` is the bound param
TS:
    arr.filter((__pu) => __pu > 0)
    pts.map((__pu) => __pu.x + __pu.y)
    xs.sort((__pu, b) => __pu - b)
```

&gt; **Edge case (`_` lambda vs pipeline `_`).** In `x |> f(_, y)` the `_` is a *pipeline substitution* (§2.1) — the LHS replaces it, no arrow is synthesized. In `f(_ > 0)` the `_` is a *lambda placeholder* — an arrow is synthesized. The discriminator is the enclosing operator: a `_` inside a pipeline stage's argument list is substitution; a `_` in an ordinary call argument that forms a self-contained expression is a lambda. The two never co-fire on one token.

### 6.3 Example & rationale

```pts
// .pts
const active = users.filter(_.status === "active").map(_.email);
// ⇒ users.filter((__pu) => __pu.status === "active").map((__pu) => __pu.email)
```

**Rationale.** The placeholder is point-free sugar that stays glass-floor: the lowering is the exact arrow a developer would type, the param name is hygienic (`__pu` cannot collide with user identifiers), and multi-use is single-binding so the common `_.x + _.y` reads naturally. It is the smallest possible "thread one argument" form, complementary to `|>` (which threads across calls) and the leading-dot shorthand (§7, which threads onto a receiver).

---

## 7. Leading-dot method shorthand

`Status: Shipped.`

A call argument whose first significant character is `.` (followed by an identifier) is the **leading-dot method shorthand**: the argument is rewritten into a single-parameter arrow whose body is the method chain applied to the parameter. It is the "method reference" form — `arr.map(.toUpperCase())` instead of `arr.map(x => x.toUpperCase())`.

### 7.1 Grammar

```
LeadingDotArg ::= "." Member CallTail*       ⟨in a call-argument position⟩
CallTail      ::= "(" ArgList? ")" | "." Member | "[" Expr "]"
```

The shorthand fires when an argument (split on top-level commas) begins with `.IDENT`. The argument is wrapped in `(__x) => __x.<chain>` (the browser-lower path uses **`__x`** as the hygienic parameter, or `it` in the `readable` tooltip mode; the canonical parser's name is the source of truth for parity).

**Lexical note (placeholder-dot vs property-access).** A `.` is a *leading-dot placeholder* only when it sits at the **start of an expression** — after an opener (`(`, `[`, `{`, `,`) or after a binary/unary operator (`&&`, `||`, `==`, `?`, `:`, `!`, `+`, `-`, `*`, `/`, `%`, `=`, `<`, `>`, `&`, `|`, `^`, `~`). After an identifier, closing bracket, or digit, `.` is ordinary property access and is **not** rewritten. The scan masks string/template/regex/comment spans, skips balanced bracket groups verbatim (their inner placeholders belong to the recursive inner pass), and requires the `.` to be followed by an identifier char (so a `.0` decimal fraction is never mistaken for a placeholder).

### 7.2 Static & dynamic semantics

**Static semantics.** `arr.map(.toUpperCase())` ⇒ `arr.map((__x) => __x.toUpperCase())`; the parameter type is inferred from the method's expected callback. Multiple leading-dot args in one call each get their own arrow scope. No `any`.

**Dynamic semantics.** Pure rewrite, no runtime. Every top-level placeholder `.` in the (recursively-lowered) argument is prefixed with the synthesized parameter, then the whole argument is wrapped in `(__x) => …`.

```
# Desugar:  leading-dot method shorthand
Para:
    names.map(.trim())
    items.filter(.active && .qty > 0)
    rows.sort(.localeCompare(other))
TS:
    names.map((__x) => __x.trim())
    items.filter((__x) => __x.active && __x.qty > 0)
    rows.sort((__x) => __x.localeCompare(other))
```

&gt; **Edge case (leading-dot in a pipeline stage vs a call argument).** A leading-dot at the head of a *pipeline stage* (`x |> .method()`) binds onto the pipeline LHS as a **receiver** (`x.method()`, §2.1) — no arrow. A leading-dot at the head of a *call argument* (`map(.method())`) synthesizes an **arrow** (`(__x) => __x.method()`). Same glyph, two lowerings, disambiguated by whether the dot heads a pipeline stage or a call argument.

### 7.3 Example & rationale

```pts
// .pts
const upper = words.map(.toUpperCase()).filter(.length > 3);
// ⇒ words.map((__x) => __x.toUpperCase()).filter((__x) => __x.length > 3)
```

**Rationale.** The shorthand removes the ceremony of a one-parameter arrow for the overwhelmingly-common "call a method on each element" case while staying ejectable (the arrow is exactly what you'd write). Together, `|>`, `_`, and leading-dot form a complete point-free vocabulary: thread across calls (`|>`), thread one argument into an expression (`_`), thread onto a receiver (`.method()`).

---

## 8. Lexical disambiguation rules (consolidated)

`Status: Shipped.`

The numeric-adjacent ambiguities are the only places Para's expression surface genuinely contends with the host lexer. The canonical resolution lives in `js_lexer.zig`; the text-level mirrors implement the same decisions conservatively. The table is normative.

| Source | Tokenization | Reason |
|---|---|---|
| `1..5` | range `1 .. 5` | `..` is the range op; baseline JS would read `1.` then `.5`, Para-aware lexing prefers `..` |
| `1.0..2` | `1.0 .. 2` | the first `.` completes the float `1.0`; the `..` that follows is the range op |
| `1.method()` | `(1).method()` | a single `.` after a complete int is property access (number method call) |
| `1..method()` | `1 .. method()` then call | `..` is the range op; RHS is the `method` reference, then called |
| `0.5d` | decimal literal `__paraDec("0.5")` | `d` suffix on a complete numeric base (§5) |
| `1d..5` | `__paraDec("1") .. 5` | decimal pass runs first; `d` consumed, then range |
| `id` | identifier `id` | `d` is an identifier tail, not a suffix (leading-boundary lookbehind) |
| `0x1Fd` | hex int `0x1Fd` | hex base excludes the `d`-suffix path entirely |
| `1...x` | spread `1 ... x` (invalid) / `...x` | `..` carries `(?!\.)` so it never eats the third dot of spread |
| `a...b` | spread inside `[a, ...b]` etc. | three dots are always spread; range is exactly two |

**Static semantics (conservatism rule).** Where a text-level pass cannot prove the intended tokenization from local context, it **does not rewrite** — leaving the bytes as host tokens (which then either type-check as host code or surface a precise error). The decimal pass requires a clean leading boundary; the range pass requires recognizable operands and a negative lookahead against `..=`/`...`; the pipeline/error-chain scanners require depth-0 operators outside literals. A conservative non-rewrite is *never* a silent miscompile — the canonical parser (B1) is the adjudicator, and a mirror that diverges is a parity bug.

&gt; **Edge case (operator-pass ordering as disambiguation).** Several of these decisions are enforced not by a single regex but by **pass order**: decimal runs before range (so `d` is gone first), pipeline runs before error-chain (so `|>` binds tighter), and range runs *last* among the dot-family rewrites so it cannot consume a `..!`/`..&`/`..>` operand by mistake. The ordering is normative [→ ch:overview-and-surfaces §4]; reordering these passes changes tokenization, not just performance.

---

## Proposed Extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in the catalog/parser today). Each carries a `# Desugar (proposed):` block so it remains glass-floor-compatible (I1): the lowering is the readable code a developer could have written by hand, and no construct introduces an `any` escape (I3). They are introduced here because each is an *expression-level* operator/literal usable surface-wide, the boundary this chapter owns.

### P1. Multi-arg placeholders `_1` / `_2`  `Proposed`

**Rationale.** The single placeholder `_` (§6) threads exactly one argument. A common shape — a two-or-three-argument arrow where every parameter is used positionally and named trivially (`(a, b) => a.localeCompare(b)`) — still requires a full arrow. Positional placeholders `_1`, `_2`, `_3` extend `_`'s point-free reach to fixed-arity callbacks without inventing parameter names, while keeping `_` itself as the single-argument form (so the common case is unchanged).

**Grammar.**

```
PositionalPlaceholder ::= "_" Digit+         ⟨_1, _2, _3, …  ⇒ the Nth synthesized parameter⟩
```

A `_N` in a callback-expecting expression binds the **N-th** parameter (1-indexed) of a synthesized arrow whose **arity is the maximum N present** in the expression. Bare `_` remains `_1`'s synonym **only when no `_N` appears**; mixing bare `_` and `_N` in one expression is an error (`mix of `_` and positional `_N` in one placeholder lambda; use one form`).

**Static semantics.** The arrow's arity is `max(N)`; missing intermediate positions still produce parameters (so `_1 + _3` is a ternary arrow with an unused `__pp2`). Each `_N`'s type is inferred from the callback's N-th expected parameter type — no `any`. The synthesized parameters are named **`__pp1`, `__pp2`, …** (one prefix `__pp` "para positional", numbered), hygienic and collision-free.

**Dynamic semantics.** Pure rewrite; identical to the hand-written arrow.

```
# Desugar (proposed):  positional placeholders
Para:
    rows.sort(_1.name.localeCompare(_2.name))
    pairs.map(_1 + _2)
TS:
    rows.sort((__pp1, __pp2) => __pp1.name.localeCompare(__pp2.name))
    pairs.map((__pp1, __pp2) => __pp1 + __pp2)
```

```
# Desugar (proposed):  sparse positions + reuse
Para:
    f(_1 + _1 + _3)
TS:
    f((__pp1, __pp2, __pp3) => __pp1 + __pp1 + __pp3)   // __pp2 present, unused
```

**Interaction.** `_N` composes with the pipeline (§2): a stage `f(_1, y, _1)` (Proposed P2 hoist applies) and with leading-dot (`_1` may carry a method chain `_1.id`). It does **not** combine with bare `_` in the same expression (the error above), keeping each placeholder lambda's arity unambiguous.

**Example.**

```pts
// .pts
const byAge = people.sort(_1.age - _2.age);
// ⇒ people.sort((__pp1, __pp2) => __pp1.age - __pp2.age)

// ✗ counter-example
const bad = xs.reduce(_ + _2, 0);   // ✗ error: mix of `_` and positional `_N`
```

### P2. Unit / quantity literals (`100ms`, `5s`, `1.5kb`)  `Proposed`

**Rationale.** Para already has interval-driven reactivity (`signal x = … every 1000`) and timeouts/sizes scattered as bare numbers whose unit lives only in a variable name or a comment. A bare `1000` passed to `every` is an un-modeled fact (is it ms? s? ticks?) — exactly the kind of silent-meaning gap I3 forbids at the *value* level. A **unit literal** brands a number with its dimension at the literal site, lowering to a typed quantity the `every` postfix (and timeout/size APIs) consume directly, so the unit is a checked type rather than a convention.

**Grammar.**

```
QuantityLit ::= NumericBase Unit
Unit        ::= TimeUnit | SizeUnit
TimeUnit    ::= "ns" | "us" | "ms" | "s" | "m" | "h"
SizeUnit    ::= "b" | "kb" | "mb" | "gb" | "kib" | "mib" | "gib"
```

`NumericBase` is the §5 base (integer / decimal / scientific). A unit suffix and the decimal `d` suffix are **mutually exclusive** on one literal (`1.5msd` is an error — a quantity is already exact in its base unit; use `1500us` for sub-ms precision).

**Lexical note.** Unit suffixes share the §8 leading-boundary discipline (a unit fires only on a complete numeric base whose preceding char is not an identifier char or `.`), so `class5s` (an identifier) and `obj.5s` never misfire. The unit set is **closed** (the grammar above); an unrecognized suffix (`5x`) is *not* a quantity and falls through to host tokenization (`5` then identifier `x`), keeping the superset closed. Time and size units do not overlap, so each suffix is unambiguous.

**Static semantics.** A `TimeUnit` literal has type `Duration` (a branded `number` of nanoseconds: `Brand<number, "ns">`); a `SizeUnit` literal has type `ByteSize` (branded `number` of bytes). The brand makes a raw `number` **non-assignable** where a `Duration`/`ByteSize` is expected (and vice-versa), so `every 1000` (bare number) becomes a soft-deprecated form and `every 1s` is the checked form. Arithmetic between same-dimension quantities is allowed and stays branded (`1s + 500ms : Duration`); cross-dimension arithmetic (`1s + 1kb`) is a type error. No `any`.

**Dynamic semantics.** Lowers to a `__paraQty(value, unit)` runtime constructor that normalizes to the base unit (ns for time, bytes for size) and carries the brand at the type level only (the runtime value is a plain `number` in base units — zero-cost brand). The `every` postfix consumes a `Duration` directly (it already expects ms today; under this extension it accepts a `Duration` and reads its ms).

```
# Desugar (proposed):  quantity literals + every integration
Para:
    const timeout = 30s;
    const chunk   = 1.5mb;
    signal clock = Date.now() every 250ms;
TS:
    const timeout = __paraQty(30, "s");      // 30_000_000_000 ns, branded Duration
    const chunk   = __paraQty(1.5, "mb");    // 1_572_864 bytes, branded ByteSize
    const clock   = signal(() => Date.now(), { every: __paraQty(250, "ms") });
                                             // @lyku/para-signals — every reads the Duration
```

```
# Desugar (proposed):  same-dimension arithmetic, cross-dimension error
Para:
    const total = 1s + 500ms;     // ok: Duration
    const bad   = 1s + 1kb;       // ✗ error: cannot add Duration and ByteSize
TS:
    const total = __paraQty(1, "s").add(__paraQty(500, "ms"));   // Duration
```

**Interaction.** Quantities discharge an I3 gap at the `every` boundary: the interval unit is now a *type*, so `every 1000` (ambiguous) is distinguishable from `every 1s` (checked). They compose with `|>` (`buf |> take(_, 4kb)`), with decimals' string-form rationale (a quantity carries its base string so `1.5mb` is exact), and with the §P5 Option pipeline (a `Duration?` short-circuits cleanly). The `every` postfix's full semantics remain [→ ch:reactivity-core]; this extension only adds the *literal* and its branded type.

**Example.**

```pts
// .pts
signal heartbeat = ping() every 5s;          // checked: every accepts Duration
const cacheCap = 256mb;                       // ByteSize, not a bare number
const window   = 30s + 500ms;                 // Duration arithmetic stays branded
```

### P3. Async pipeline `|>>` (await between stages)  `Proposed`

**Rationale.** A `|>` chain over async stages today forces explicit awaits or an error-chain (`load(id) ..> parse ..> persist`), which reads well but mixes promise-combinator vocabulary into what is conceptually still a forward data pipeline. An **async pipeline** stage operator `|>>` threads the LHS forward *and awaits the result* before passing it to the next stage — so a mixed sync/async pipeline reads as one forward flow, with `await` appearing exactly where the data crosses an async boundary.

**Grammar.**

```
AsyncPipelineExpr ::= Expr ( PipeOp PipelineStage )+
PipeOp            ::= "|>"        ⟨sync stage — §2⟩
                    | "|>>"       ⟨async stage — await the stage result before the next⟩
```

`|>>` is a per-stage operator: a chain may mix `|>` and `|>>` (sync stages thread the value, async stages thread the awaited value). The whole expression is only legal in an `async` context (function / arrow / `async {` block); a `|>>` outside an async context is an error (`async pipeline `|&gt;&gt;` requires an async context`).

**Static semantics.** A `|>>` stage's result type is the *awaited* type (`Awaited<R>`) of the stage call, which is the next stage's LHS type. The chain is erasable to `await`-threaded calls; the final type is `Promise<T>` of the last stage's awaited result (the enclosing `async` re-wraps). No `any`.

**Dynamic semantics.** Each `|>>` stage awaits before threading. Evaluation is strictly sequential (stage N+1 does not start until stage N's promise settles); a rejection propagates as an ordinary `await` rejection (catchable with `..!` on the whole expression, or `try`/`catch`).

```
# Desugar (proposed):  async pipeline (await between stages)
Para:
    const out = id
      |>> load          // await load(id)
      |>  normalize     // sync stage on the awaited value
      |>> persist(db);  // await persist(db)(normalized)
TS:
    const __ap0 = await load(id);
    const __ap1 = normalize(__ap0);
    const out   = await persist(db)(__ap1);
```

```
# Desugar (proposed):  single-expression form (no temporaries needed at call site)
Para:
    user |>> fetchProfile |>> .enrich()
TS:
    await (await fetchProfile(user)).enrich()
```

**Interaction.** `|>>` is the forward-flow counterpart to the error-chain's `..>` (which is promise-combinator-flavored): use `|>>` when the pipeline is *data forward*, `..>` when you are explicitly composing `Promise` methods. It composes with `..!`/`..&` on the whole expression (`(a |>> f |>> g) ..! recover`), with `_` placeholders per stage, and with §P5's Option short-circuit (an async stage returning `T?` short-circuits the rest of the chain). The temporaries `__ap0…` mirror the `__pb0…` parallel-naming convention.

**Example.**

```pts
// .pts
async fun ingest(url: string) {
  return url
    |>> fetch
    |>> .json()
    |>  validate
    |>> save(db);
  // ⇒ save(db)(validate(await (await fetch(url)).json()))  threaded with sequential awaits
}
```

### P4. Operator sections — partial application to readable arrows  `Proposed`

**Rationale.** The `_` placeholder (§6) covers one-argument lambdas over a *whole* expression, but a bare binary-operator partial (`(+ 1)`, `(* 2)`, `(> 0)`) still needs `_ + 1`. An **operator section** — a parenthesized expression with exactly one operand and a binary operator — lowers to the same readable arrow as `_`, giving the canonical functional "section" form for the common `map`/`filter`/`reduce` cases, while lowering to an *ordinary arrow* (not a curried operator function), keeping the glass floor.

**Grammar.**

```
OperatorSection ::= "(" BinOp Expr ")"        ⟨right section:  (+ 1)  ⇒ x => x + 1⟩
                  | "(" Expr BinOp ")"         ⟨left section:   (1 +)  ⇒ x => 1 + x⟩
BinOp           ::= "+" | "-" | "*" | "/" | "%" | "**"
                  | "===" | "!==" | "<" | "<=" | ">" | ">="
                  | "&&" | "||" | "??"
```

A section is a parenthesized group whose content is exactly *one operand and one binary operator* (the operand on the missing side becomes the synthesized parameter). `(- 1)` is intentionally **excluded** (it is unary negation `-1`, not a right section); subtraction sections are written `(_ - 1)` with the placeholder to avoid that ambiguity — the grammar omits `-` from the right-section form for that reason.

**Static semantics.** A section synthesizes `(__os) => __os <op> EXPR` (right) or `(__os) => EXPR <op> __os` (left); the parameter type is inferred from the operator and the present operand (so `(+ 1)` is `(n: number) => number`). A parenthesized group that is *not* exactly one-operand-one-operator is an ordinary parenthesized expression (no section). No `any`.

**Dynamic semantics.** Pure rewrite to an arrow; the section operand `EXPR` is evaluated **per call** (inside the arrow body), matching `_ + EXPR` semantics — not captured once. The parameter is named **`__os`** ("para operator section"), hygienic.

```
# Desugar (proposed):  operator sections
Para:
    nums.map((* 2))
    nums.filter((> 0))
    xs.reduce((+), 0)            // both-missing → binary arrow (a,b) => a + b
    strs.filter((=== "ok"))
TS:
    nums.map((__os) => __os * 2)
    nums.filter((__os) => __os > 0)
    xs.reduce((__os1, __os2) => __os1 + __os2, 0)
    strs.filter((__os) => __os === "ok")
```

**Interaction.** Sections are the bare-operator complement to `_` (whole-expression) and leading-dot (method): `(* 2)` where the operand is the *implicit* parameter, `_ * 2` where you want the placeholder explicit in a larger expression. The both-missing form `(+)` produces a two-parameter arrow (`__os1`, `__os2`), composing with `reduce`. Sections thread through `|>` stages (`x |> map((* 2))`) and never collide with §P1 placeholders (a section has *no* `_`).

**Example.**

```pts
// .pts
const doubled = vals.map((* 2)).filter((>= 10));
// ⇒ vals.map((__os) => __os * 2).filter((__os) => __os >= 10)

// ✗ counter-example
const neg = vals.map((- 1));   // ✗ error: (- 1) is unary -1, not a section; write (_ - 1)
```

### P5. Option-aware pipeline `?|>` — short-circuit on `None`  `Proposed`

**Rationale.** Para's `Option` (`Some`/`None`) and `Result` are the value-level error model (design principle 5). A `|>` chain over `Option`-returning stages today must unwrap at each step or thread a `match`. An **Option-aware pipeline** stage `?|>` short-circuits the rest of the chain when a stage yields `None` (or `null`/`undefined`), mirroring `?.` optional chaining but at the pipeline-stage granularity — so a fallible forward flow reads as one chain with a single short-circuit, no per-stage unwrap.

**Grammar.**

```
OptionPipelineExpr ::= Expr ( PipeOp PipelineStage )+
PipeOp             ::= "|>"        ⟨total stage — §2⟩
                     | "?|>"       ⟨optional stage — short-circuit to None if LHS is None/null/undefined⟩
```

`?|>` is per-stage: a `?|>` stage is **only entered** when the threaded value is present (`Some(v)` / non-nullish); otherwise the value is `None` and every downstream stage (`?|>` and `|>` alike) is skipped, the whole expression evaluating to `None`. The chain's result type is `T?` (Option of the last stage's value).

**Static semantics.** A `?|>` stage's LHS type is narrowed to the **present** case (`v` from `Some(v)`, or `NonNullable<T>`); the stage call receives the unwrapped value, and its result is re-wrapped (`Some(...)`) for the next stage. The whole expression's type is `Option<T>` (or `T | None`). This is the pipeline analogue of `?.`'s `T | undefined` narrowing, but Option-typed so it composes with `match` / `is`. No `any`.

**Dynamic semantics.** Lowers to a `__paraOpt` short-circuit helper (or inline nullish guards) that threads the value only while present. Evaluation stops at the first `None`/nullish stage; no downstream stage runs (no side effects past the short-circuit). A `None` produced anywhere makes the result `None`.

```
# Desugar (proposed):  Option-aware pipeline short-circuit
Para:
    const email = userId
      ?|> findUser          // returns User?  — None ⇒ whole chain is None
      ?|> .profile          // skipped if findUser was None
      ?|> .contactEmail;
TS:
    const email = __paraOpt(userId, [
      findUser,
      (__pcv) => __pcv.profile,
      (__pcv) => __pcv.contactEmail,
    ]);   // threads while Some/non-nullish, else None — @lyku/para-option

# Inlined (glass-floor alternative, no helper):
    const __o0 = findUser(userId);
    const __o1 = __o0 == null ? undefined : __o0.profile;
    const email = __o1 == null ? undefined : __o1.contactEmail;
```

```
# Desugar (proposed):  mixed total + optional stages
Para:
    raw ?|> parse |> normalize ?|> validate
TS:
    // parse may yield None ⇒ short-circuit; normalize runs only if Some;
    // validate may yield None again. Result: Option<Validated>.
    __paraOpt(raw, [parse, (__pcv) => normalize(__pcv), validate]);
```

**Interaction.** `?|>` is the value-level (`Option`) counterpart to the async `|>>` (P3) and the promise-level `..!` (§3): use `?|>` for a *present/absent* fallible flow, `..!` for a *thrown/rejected* async flow. It composes with `match` (`match (raw ?|> parse) { Some(v) => …, None => … }`), with `is`/`::` (a `?|>` stage returning a parse `Result` short-circuits on `Err`), and with leading-dot (`.profile` heads an optional stage's receiver, reusing the `__pcv` synthesis of §3.2 for consistency). It is the pipeline expression of "errors are values": the absence is threaded, never thrown.

**Example.**

```pts
// .pts
const port = config
  ?|> .get("server")
  ?|> .get("port")
  ?|> parseInt(_, 10);
// None anywhere ⇒ port is None; otherwise Some(number)
```

---

## Summary of operator precedence (this chapter)

A consolidated, normative ordering of the expression operators this chapter owns, tightest-binding first (forms in later chapters are cross-referenced for context only):

```
1. member access  .   [ ]   ( )          (host)
2. leading-dot shorthand / _ / sections  (synthesize arrows — §6, §7, P1, P4)
3. unit/quantity & decimal literals       (literal-level — §5, P2)
4. range   ..  ..=                         (§4)
5. pipeline   |>   |>>   ?|>               (§2, P3, P5)   — left-associative
6. error-chain   ..>  ..!  ..&             (§3)           — looser than |>  (INV-lex-2)
   ──────  (below this line: other chapters)  ──────
7. reactive-bind  ~>  ->                    [→ ch:reactivity-core]
8. validate / guard  ::  is                 [→ ch:errors-results-and-validation]
```

The two load-bearing inter-operator facts: **`|>` binds tighter than the error-chain ops** (INV-lex-2 — so `x |> f ..> g` is `f(x).then(g)`), and **range lowers last among the dot-family rewrites** (§8 — so it never consumes a `..!`/`..&`/`..>` operand). All ordering is enforced by pass order in the lowering pipeline [→ ch:overview-and-surfaces §4]; reordering changes tokenization, not just performance.

