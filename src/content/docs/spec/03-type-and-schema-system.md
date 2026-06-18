---
title: "The Schema Spine: Types, Schemas & Refinements"
description: "The heart of Para. All six schema declaration forms, constraint brands (StringOf/NumberOf/BigIntOf/ArrayOf/ObjectOf, extended vs standard variant),…"
sidebar:
  order: 4
---

# Chapter: The Schema Spine — Types, Schemas & Refinements

&gt; **Status of this chapter:** Mixed. The six `schema` declaration forms, the `__paraFromSchema` lowering and its sibling type alias, the constraint brands (`StringOf`/`NumberOf`/`BigIntOf`/`BooleanOf`/`ArrayOf`/`ObjectOf`) with their extended-vs-standard variant collapse, the refinement and primitive aliases, `SchemaValue`/`Infer`/`InferFromSchema`/`Handles`, the `::` validation marker, and `is`/`is not` guards (including literal membership) are **Shipped** (in `language-surface.ts` and the JS mirrors today; the runtime decoration `__paraFromSchema` and the `::` parse-injection are owned by the canonical runtime, cited as evidence). Everything in *§12 Proposed extensions* — schema algebra, relations/foreign-keys, computed/derived fields & cross-field refinements, first-class `Option<T>`, co-located versioning/migration, and branded units/currency — is **Proposed** (net-new surface, not in the catalog).
&gt; **Cross-refs:** This chapter owns the **model** and its **TS-type projection** — the single source of truth from which every other projection derives. The boundary-gate *use* of `::` (handler entry, throw-on-`Err`) and the sync parse-gate use of `sync NAME :: S from KEY` are [→ ch:errors-results-and-validation] and [→ ch:data-sync-and-authority] respectively; this chapter defines what `::`/`is` *mean* (schema-bound), not how a handler or reconciler consumes them. The db/api/client/codec/reconciler **codegen mechanics** are [→ ch:modules-projections-and-build]; this chapter defines the spine those projections read, not the projections. `Result<T,E>` is shared with [→ ch:errors-results-and-validation]; it is *defined* here because `schema.parse` returns it. The keyword catalog this chapter conforms to is `src/language-surface.ts` [→ ch:overview-and-surfaces §3.1].

---

## 0. The spine: a value at rest

The four pillars of Para are one idea viewed from four distances [→ ch:overview-and-surfaces §0]: a **schema** describes the *shape and constraints of a value at rest*; a **signal** describes that value *changing over time in one process* [→ ch:reactivity-core]; **sync** describes it *changing across a trust boundary* [→ ch:data-sync-and-authority]; a **source** describes it *driven by the outside world* [→ ch:sources-async-and-native]. This chapter owns the *at-rest* member — and because every other member reconciles, validates, and transports *the same value*, the schema is upstream of all three. That is the literal content of "the schema is the application": db model, api contract, typed client, server handles, boundary validation, wire codec, and client⇄server sync are **projections** of the `schema` declarations, not a stack assembled by hand [→ schema-is-the-application].

This chapter specifies the spine itself: how a `schema` is declared (six surface forms, §1), what it lowers to (`__paraFromSchema` + a sibling type alias, §2), the **JSON-Schema-2020-12 body grammar** the model is written in (§3), the **brand machinery** that carries constraints into the TS type system (§4–§5), the **refinement and primitive aliases** that make that body legible (§6), the **runtime/type projection** (`SchemaValue`/`Infer`/`InferFromSchema`/`Handles`, §7), and the two schema-bound validation operators (`::`, §8; `is`/`is not`, §9) plus the `Result` they speak in (§10). §11 states the spine invariants; §12 proposes the net-new surface that closes the remaining "the schema is the application" gaps (relations, computed fields, versioning, units).

Three invariants frame everything:

- **INV-schema-1 (one spine, sole source).** Every typed artifact that crosses a boundary (table column, route contract field, client return shape, wire field, synced cell) is *derived from* a `schema`, never hand-declared in parallel. A field that exists in a projection but not in a schema is the I3 gap this chapter exists to forbid: the model is **diffable against the live DB** [→ ch:modules-projections-and-build], so "derived from the spine" is mechanically checkable, and drift is a compile error.
- **INV-schema-2 (glass-floor model).** A `schema` lowers to a single readable `const NAME = __paraFromSchema(() => ( …JSON-Schema-2020-12 literal… ))` plus a sibling `type NAME` alias (§2). The body is *literal JSON Schema you could have written by hand* — no reflection, no proprietary DSL AST. Outgrowing the projection means reading the lowering and overriding one projection [→ ch:modules-projections-and-build], never abandoning the model (I1).
- **INV-schema-3 (constraints are typed, both sides).** A constraint expressible in the body (`minLength`, `format`, `integer`, `enum`, …) is carried into the TS type via a **brand** (§4) under the extended variant, so the *full* constraint set — not just the base type — reaches both client and server. "Types-ish + hand-roll the size/enum checks in the handler" is exactly the A2 failure this discharges; the constraint lives once, in the schema, and projects everywhere (I3, A2).

---

## 1. The `schema` declaration — six surface forms

`schema` is Para's **single shape primitive**. There is exactly one keyword; it has six surface forms that differ only in *where the JSON-Schema body comes from* and *whether a name/export is bound*. All six lower through the same runtime helper (`__paraFromSchema`, §2) and all six mint the same runtime shape (`SchemaValue<T,S>`, §7).

### Grammar

```
SchemaDecl   ::= Export? "schema" Ident SchemaSource          ⟨named forms⟩
               | "schema" SchemaBody                           ⟨F4: inline/anonymous, expression position⟩
SchemaSource ::= SchemaBody                                    ⟨F1: brace body⟩
               | "=" Expr                                      ⟨F2: assignment⟩
               | "from" Expr                                   ⟨F3: ingestion⟩
SchemaBody   ::= "{" SchemaField ("," SchemaField)* ","? "}"
Export       ::= "export"
SchemaField  ::= Ident "?"? ":" Type
Type         ::= ⟨the schema-body type grammar — §3, §6⟩
```

The catalog enumerates the recognizer patterns for each (`schema-decl`, `schema-from`, `schema-inline`, `export-schema-decl`, `export-schema-from`, `schema-bare`); the six surface forms are:

| # | Form | Where the body comes from | Binds | Status |
|---|---|---|---|---|
| **F1** | `schema NAME { … }` | inline brace body (Para field grammar) | `const NAME` + `type NAME` | Shipped |
| **F2** | `schema NAME = EXPR` | an arbitrary expression (object literal, imported value) | `const NAME` + `type NAME` | Shipped |
| **F3** | `schema NAME from EXPR` | an *existing* JSON Schema (file import, `fetch`, inline literal) | `const NAME` + `type NAME` | Shipped |
| **F4** | `schema { … }` | inline brace body, **no name** (expression position) | *(the expression value)* | Shipped |
| **F5** | `export schema NAME { … }` / `= …` | as F1/F2, re-exported | `export const`/`type NAME` | Shipped |
| **F6** | `export schema NAME from EXPR` | as F3, re-exported | `export const`/`type NAME` | Shipped |

**Lexical note (statement-position keyword detection).** `schema` fires as the keyword contextually [→ ch:overview-and-surfaces §1.1]: the catalog's `schema-bare` fallback explicitly *skips* `schema` when immediately followed by `=`, `.`, or `(` (`\b(schema)\b(?![\s]*[=.(])`), so `const schema = {}` (value), `schema.parse(x)` (member), and `schema(x)` (call) are **not** rewritten. This is what keeps the surface a strict superset: an identifier named `schema` survives untouched. The named forms additionally require `schema` + an identifier (`schema NAME`), and the `from` form requires `schema NAME from` as three tokens, so a property literally named `from` inside a body never triggers F3.

&gt; **Edge case (F3 vs F2 disambiguation).** `from` is the only distinguishing token between F2 and F3. `schema U from x` is **ingestion** (F3 — `x` is already a JSON Schema); `schema U = from(x)` is **assignment** (F2 — `from(x)` is an ordinary call expression, because the `from` is not in token position 3). The recognizer matches `schema\s+NAME\s+from\b` only with `from` as a standalone keyword token; `from(` (call) and `from.` (member) fall through to F2. Authors who genuinely need a value-producing call named `from` in F2 position are unaffected.

&gt; **Edge case (F4 is expression-position only).** `schema { … }` with no name is an *expression* — it produces a `SchemaValue` and binds nothing. It is legal anywhere an expression is (a `const x = schema { … }`, a property `{ request: schema { … } }`, a call argument). At *statement* position a bare `schema { … }` would be ambiguous with F1 missing its name; the catalog's `schema-inline` pattern (`\b(schema)\b(?=\s*\{)`) is ordered *after* the named patterns, so `schema NAME {` always wins and `schema {` only matches when no name intervenes.

### Static semantics

A `schema NAME …` declaration introduces **two bindings in one statement** (§2): a runtime `const NAME: SchemaValue<T,S>` and a sibling `type NAME` alias usable in type position. This dual binding is why `schema User { … }` lets you write both `User.parse(x)` (value) and `(req:: User)` / `req: User` (type) without restating the shape — the name is overloaded across the value and type namespaces, exactly as a TS `class` is. `Infer<typeof NAME>` (§7) extracts `T`; `NAME` in type position *is* `T` (the alias, §2). The body's fields contribute the field set; refinement/primitive aliases (§6) and the JSON-Schema body grammar (§3) define what a field may be. A field whose type is not a known primitive alias, refinement, capitalized `schema` reference, or inline body is a compile error at the type-projection step ([→ ch:tooling-diagnostics-and-conformance]).

### Dynamic semantics

At runtime the `const NAME` holds the decorated `SchemaValue` (§2.3) the instant the module evaluates; there is no lazy/async step (the `() => (…)` thunk in the lowering is evaluated eagerly by `__paraFromSchema`, §2). `NAME.parse(v)` and `NAME.is(v)` are available immediately. F4 (anonymous) produces the same value with no binding — it is consumed in place (e.g. a `request`/`response` slot of a handler model, §7.4).

### Examples

```pts
// .pts — F1: inline brace body
schema User {
  id: UUID,
  email: Email,
  age: int(0..150)?,
  status: "draft" | "published"
}

// F2: assignment from an object literal (full JSON-Schema body)
schema Order = {
  type: "object",
  properties: { id: { type: "bigint" }, total: { type: "integer", minimum: 0 } },
  required: ["id", "total"]
}

// F3: ingest an existing JSON Schema produced elsewhere
import orderJson from "./order.schema.json";
schema OrderExternal from orderJson;

// F5/F6: exported variants — the spine other modules import
export schema Account { id: UUID, handle: Slug }
export schema Session from sessionJsonSchema;
```

```pts
// .pts — F4: anonymous, expression position (a handler model's slots)
const getUser = {
  request:  schema { id: bigint },
  response: schema { name: string },
};
```

&gt; **Note (F1 sugar ↔ F2 canonical).** F1's Para field grammar (`id: UUID, age: int(0..150)?`) is **sugar** for a JSON-Schema body. Its canonical form is the F2/F4 object literal: `age: int(0..150)?` desugars to a property `age: { type: "integer", minimum: 0, maximum: 150 }` that is *not* in `required`. §3 (body grammar) and §6 (aliases) give the field-by-field expansion; the desugaring in §2.1 shows the whole-declaration lowering.

---

## 2. Lowering: `__paraFromSchema` + the sibling type alias

All six forms lower to a call to the runtime helper **`__paraFromSchema`** (which mints the `SchemaValue`, §7, and attaches field accessors) plus, for the named forms, a sibling **type alias**. This is the glass floor (I1): the lowering is a `const` you could have written by hand calling one ordinary function, and a `type` alias that resolves to the JSON-Schema body.

### 2.1 The named-declaration lowering (F1/F2/F3/F5/F6)

```
# Desugar:  schema NAME = EXPR        (F2; F1 first desugars its brace body to a JSON-Schema object literal)
Para:
    schema Order = { type: "object", properties: { id: { type: "bigint" } }, required: ["id"] };
TS:
    const Order = __paraFromSchema(() => ({ type: "object", properties: { id: { type: "bigint" } }, required: ["id"] }));
    type Order = (typeof Order)["schema"];
```

```
# Desugar:  schema NAME from EXPR     (F3 — ingestion; identical const+alias, EXPR is an existing JSON Schema)
Para:
    schema OrderExternal from orderJson;
TS:
    const OrderExternal = __paraFromSchema(() => (orderJson));
    type OrderExternal = (typeof OrderExternal)["schema"];
```

```
# Desugar:  export schema NAME { … }  (F5/F6 — the leading `export` is threaded onto BOTH bindings)
Para:
    export schema Account = accountSchema;
TS:
    export const Account = __paraFromSchema(() => (accountSchema));
    export type Account = (typeof Account)["schema"];
```

Rules:
- The body is wrapped in a **thunk** `() => (EXPR)`. The thunk exists so the call site is a plain expression that tsc type-checks structurally (the helper's signature is `<S>(s: () => S) => SchemaValue<unknown, S> & S`, §7), and so the schema literal participates in inference without an eager allocation order hazard.
- The **sibling type alias** is `type NAME = (typeof NAME)["schema"]`, emitted as a *second statement* (the JS mirror emits it semicolon-prefixed on the same line — `;type NAME = …` — to preserve source columns; the spec form is two statements). It indexes the runtime value's `schema` member type, which *is* the JSON-Schema body type `S`. This is deliberately **not** spelled `Infer<typeof NAME>` even though the two are equivalent for the model's inferred shape: `(typeof NAME)["schema"]` resolves to the unwrapped body and skips the `{ parse, is, schema } & S` intersection walk, which is a measured **1.5–2.2× tsc speedup** on large spines. `Infer<typeof NAME>` (§7) remains the form *hand-written* code reaches for; the two coincide on the data shape.
- The `export` keyword, when present (F5/F6), is threaded onto *both* the `const` and the `type` so the name is exported in both namespaces.

&gt; **Edge case (F1 brace-body lowering in the IDE mirror).** The runtime emit for **all** named forms is the `const NAME = __paraFromSchema(…)` above; this is owned by the canonical runtime ([→ ch:overview-and-surfaces §3]). The IDE-only mirror (ts-plugin / LSP) takes a *shortcut* for the F1 brace form specifically: it rewrites `schema NAME { …fields… }` to `type NAME = { …fields… }` plus a `const NAME: { parse; schema }` *stub* (a non-evaluating value of the right type) so tsc gets hover/navigation without running `__paraFromSchema`. The stub is an editor optimization, not the runtime semantics; the spec lowering is the `__paraFromSchema` form, and the parity contract pins the runtime emit, not the IDE stub [→ ch:overview-and-surfaces §3.2].

### 2.2 The inline/anonymous lowering (F4)

```
# Desugar:  schema { … }              (F4 — no binding; the call IS the value)
Para:
    const getUser = { request: schema { id: bigint }, response: schema { name: string } };
TS:
    const getUser = {
      request:  __paraFromSchema(() => ({ id: bigint })),
      response: __paraFromSchema(() => ({ name: string })),
    };
```

F4 emits only the `__paraFromSchema(…)` call — no `const`, no alias — because it is an expression. Its TS *type* is recovered structurally by the helper's return (`SchemaValue<unknown, S> & S`), so `Infer<typeof getUser.request>` (§7.4) still works without a named alias. (The body `{ id: bigint }` here is F1-style sugar lowering to `{ properties: { id: { type: "bigint" } }, required: ["id"] }` — §3.)

### 2.3 The runtime helper

`__paraFromSchema` is the runtime decoration step. Its contract:

```
__paraFromSchema<S>(thunk: () => S): SchemaValue<unknown, S> & S
```

- It evaluates the thunk once to obtain the JSON-Schema body `S`.
- It returns a value carrying `parse(v) → Result<T,string>`, `is(v) → v is T`, and `schema` (the body), with **field-navigation accessors** spread on (`User.id`, `User.email`, …) typed structurally via the `& S` intersection (§7.1).
- It is **erasable to a readable function call** (I1): the public, non-keyword name is `fromSchema` (re-exported from `@lyku/para-schema`) for pure-TS/JS consumers who do not have the keyword; `__paraFromSchema` is its in-runtime name. No reflection, no proxy magic that a developer cannot open.

&gt; **INV-schema-4 (one helper, all forms).** All six surface forms lower onto exactly one runtime entry point (`__paraFromSchema`) and one type-projection shape (`(typeof NAME)["schema"]` / `SchemaValue<T,S>`). There is no per-form special-casing in the *runtime*; the forms differ only at the surface (where the body and binding come from). This is what makes the spine a single thing to reason about, regardless of whether a schema was authored inline, assigned, or ingested.

---

## 3. The schema body: JSON Schema 2020-12 (+ Para extensions)

The body of a schema — whether written as F1 sugar or as an F2/F3 literal — is **JSON Schema 2020-12**, with a small set of Para extensions. This is INV-schema-2's substance: the model is a standard, inspectable document, not a proprietary AST. A schema ingested from an external JSON Schema (F3) and one authored inline (F1) are the *same kind of value*.

### 3.1 Body grammar (the canonical, post-sugar shape)

```
SchemaObject  ::= "{" "type" ":" TypeTag ("," Keyword)* "}"
               | "{" "enum" ":" "[" Literal ("," Literal)* "]" "}"
               | "{" "const" ":" Literal "}"
TypeTag       ::= "\"string\"" | "\"integer\"" | "\"number\"" | "\"bigint\""
               | "\"boolean\"" | "\"array\"" | "\"object\"" | "\"null\""
Keyword       ::= StringKw | NumberKw | ArrayKw | ObjectKw          ⟨per TypeTag⟩
StringKw      ::= "minLength" ":" Int | "maxLength" ":" Int
               | "pattern" ":" String | "format" ":" StringFormat
               | "enum" ":" StringArray | "const" ":" String
NumberKw      ::= "minimum" ":" Num | "maximum" ":" Num
               | "exclusiveMinimum" ":" Num | "exclusiveMaximum" ":" Num
               | "multipleOf" ":" Num | "enum" ":" NumArray | "const" ":" Num
ArrayKw       ::= "items" ":" SchemaObject | "minItems" ":" Int
               | "maxItems" ":" Int | "uniqueItems" ":" Bool
ObjectKw      ::= "properties" ":" "{" (Ident ":" SchemaObject)* "}"
               | "required" ":" StringArray
               | "minProperties" ":" Int | "maxProperties" ":" Int
               | "additionalProperties" ":" (Bool | SchemaObject)
StringFormat  ::= "\"email\"" | "\"uri\"" | "\"uri-reference\"" | "\"uuid\""
               | "\"date\"" | "\"time\"" | "\"date-time\"" | "\"duration\""
               | "\"ipv4\"" | "\"ipv6\"" | "\"hostname\"" | "\"regex\""
               | "\"json-pointer\"" | "\"relative-json-pointer\"" | String   ⟨open⟩
```

### 3.2 Para extensions to standard 2020-12

Para adds exactly the extensions the spine's projections need; each is named so a reader of the body knows what is standard and what is Para:

- **`type: "bigint"`** — a 64-bit/arbitrary-precision integer at rest. Standard JSON Schema has no bigint; Para adds it because the DB projection needs `bigint`/snowflake columns and the wire codec needs a non-lossy integer (A1). It projects to `BigIntOf<C>` (§4) / `bigint`.
- **Lockstep DB-type aliases** accepted in `format`/type position by F3 ingestion and the projection: `varchar`, `text`, `char`, `timestamptz`, `snowflake`, `numeric`, `jsonb`, `enum`. These are sugar the DB projection [→ ch:modules-projections-and-build] understands; they normalize to a standard `type`+`format` pair for validation.
- The Para **field sugar** of F1 (`int`, `str`, `Email`, `[str](1..=10)`, postfix `?`) — §6. This is surface sugar that *expands to* the standard body above; it adds no new body keyword.

&gt; **INV-schema-5 (standard body, total coverage).** Every Para field-sugar form has an exact JSON-Schema-2020-12 expansion (§6). There is no field whose meaning lives *only* in Para and cannot be written as a standard body — which is precisely why F3 ingestion is a peer of F1 authoring: the two converge on the same document. A construct that could only be expressed by reaching outside 2020-12 would break F3 round-tripping and is rejected at the catalog level.

---

## 4. Constraint brands & the `Brand<T,B>` phantom machinery

A schema body carries constraints (`minLength: 3`, `format: "email"`, `integer: true`). INV-schema-3 says those constraints must reach the **TS type**, not just the validator — so that a downstream consumer cannot accidentally assign a raw `string` where a `format: "email"` value is required, and so a `StringOf<{minLength:3}>` is structurally distinct from a `StringOf<{minLength:5}>`. Para does this with **phantom brands**.

### 4.1 `Brand<T,B>`

```ts
// @lyku/para-schema (extended variant)
declare const __schemaBrand: unique symbol;
export type Brand<T, B> = T & { readonly [__schemaBrand]: B };
```

`Brand<T,B>` is `T` (the runtime base type) intersected with a phantom property keyed by a `unique symbol` carrying the constraint bag `B`. The symbol is `declare const` — it exists *only* in the type system; at runtime a branded value **is** its base `T` (a branded string is a string). The phantom property is `readonly` and never written, so the brand has **zero runtime representation** (I1: the lowering of a branded field is the plain primitive; the brand lives entirely in the `.d.ts`).

**Static semantics.** `Brand<string, {minLength:3}>` is assignable *to* `string` (widening drops the brand) but a bare `string` is *not* assignable *to* it (you cannot forge a branded value without going through `parse`/`is`, §8–§9, which is the only sanctioned mint). `Brand<string,{minLength:3}>` and `Brand<string,{minLength:5}>` are mutually non-assignable (distinct `B`). This is the type-level enforcement of INV-schema-3.

### 4.2 The six constraint brands

Each base type has a brand and a constraint interface; the interfaces are the *typed mirror* of the §3 body keywords:

```ts
export type StringOf<C extends StringConstraints>   = Brand<string, C>;
export type NumberOf<C extends NumberConstraints>   = Brand<number, C>;
export type BigIntOf<C extends BigIntConstraints>   = Brand<bigint, C>;
export type BooleanOf<C extends BooleanConstraints> = Brand<boolean, C>;
export type ArrayOf<T, C extends ArrayConstraints = {}>  = Brand<readonly T[], C>;
export type ObjectOf<Shape extends Record<string, unknown>, C extends ObjectConstraints = {}> = Brand<Shape, C>;
```

| Brand | Base | Constraint interface (keys) | Body keywords mirrored (§3) |
|---|---|---|---|
| `StringOf<C>` | `string` | `minLength`, `maxLength`, `pattern`, `format`, `enum`, `const` | string keywords |
| `NumberOf<C>` | `number` | `integer`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `enum`, `const` | number/integer keywords |
| `BigIntOf<C>` | `bigint` | `minimum`, `maximum`, `enum`, `const` | `type:"bigint"` keywords |
| `BooleanOf<C>` | `boolean` | `const` | boolean keywords |
| `ArrayOf<T,C>` | `readonly T[]` | `minItems`, `maxItems`, `uniqueItems` | array keywords |
| `ObjectOf<Shape,C>` | `Shape` | `minProperties`, `maxProperties`, `additionalProperties` | object keywords |

`StringFormat` is the open union of the standard 2020-12 formats (`"email"`, `"uri"`, `"uuid"`, `"date"`, `"date-time"`, `"ipv4"`, `"ipv6"`, `"hostname"`, `"regex"`, …) widened with `(string & {})` so a custom format string is still assignable (open extension, A3-friendly — a project's own `format` does not require a library change).

### 4.3 Examples

```ts
// @lyku/para-schema brands, used directly (the projection emits these from a body)
type Username  = StringOf<{ minLength: 3; maxLength: 32; pattern: "^[A-Za-z0-9_]+$" }>;
type Email     = StringOf<{ format: "email" }>;          // == the refinement alias Email (§6)
type Age       = NumberOf<{ integer: true; minimum: 0; maximum: 150 }>;
type Snowflake = BigIntOf<{ minimum: 0n }>;
type Tags      = ArrayOf<string, { minItems: 1; maxItems: 10 }>;
```

```ts
// ✗ counter-example — cannot forge a branded value from a raw primitive
const e: Email = "not-an-email";   // ✗ error: 'string' is not assignable to StringOf<{format:"email"}>
const e2: Email = Email.parse(raw).value;   // ok — minted through the schema's parse gate (§8)
```

---

## 5. Extended vs standard variant collapse

The brand machinery is *too sharp* for a vanilla-TS consumer who imports a schema-bearing package without opting into Para. So `@lyku/para-schema` ships **two variants of the same type surface** under one package, selected by a package-export condition.

| Audience | Resolves to | What you get |
|---|---|---|
| `.pts` / Para projects | `index.ts` (extended) | full constraint brands — `StringOf<{minLength:3}>` distinct from `string` |
| vanilla TS / Node consumers | `index.standard.ts` (standard) | same names, every brand collapses to its base primitive |

**The collapse.** In the standard variant every brand is the identity on its base:

```ts
// index.standard.ts
export type Brand<T, _B> = T;                       // brand erased
export type StringOf<_C = StringConstraints>  = string;
export type NumberOf<_C = NumberConstraints>  = number;
export type BigIntOf<_C = BigIntConstraints>  = bigint;
export type BooleanOf<_C = BooleanConstraints> = boolean;
export type ArrayOf<T, _C = ArrayConstraints> = readonly T[];
export type ObjectOf<Shape extends Record<string, unknown>, _C = ObjectConstraints> = Shape;
```

**Selection.** A Para-aware `tsconfig.json` sets `moduleResolution: "bundler"` and `customConditions: ["parabun"]`; with `"parabun"` present, tsc resolves the **extended** `index.ts`; without it, vanilla TS resolves the **standard** `index.standard.ts`. The *exported names are identical* in both files, so a single `.d.ts` emitted by the projection works in either audience unchanged — only the constraint expressivity changes.

**Static semantics of the collapse.** Under standard, `Email` *is* `string`; `Age` *is* `number`; assignments that would be errors under extended (forging a branded value) compile silently — the constraints are dropped, not enforced, in vanilla consumers. `SchemaValue<T,S>` still carries `T` in both variants, so `Infer<typeof X>` works identically (the *data shape* is preserved; only the *constraint sharpness* is downgraded). `InferFromSchema<S>` (§7.3) is the full brand-deriving machinery under extended and collapses to `unknown` under standard (it is codegen-only; hand-written code uses `Infer`, which survives).

&gt; **INV-schema-6 (variant parity on data shape).** For any schema `X`, `Infer<typeof X>` denotes the **same set of runtime values** under both variants — they differ only in whether the static type *also* tracks constraints. A Para project (extended) and a downstream vanilla-TS consumer (standard) of the same generated `.d.ts` therefore never disagree about *what data is valid at runtime* (the runtime `parse` is variant-independent); they disagree only about *how much the compiler helps*. This is what lets the spine's typed client be consumed outside Para without a `@lyku/para-schema` dependency, without lying about the data (I3 across the package boundary).

---

## 6. Refinement types & primitive aliases — the legible field grammar

INV-schema-2's "legible model" (and A3, legibility-as-correctness) is why F1 has a **field sugar** layer over the §3 body. A reader writes `email: Email`, not `email: { type: "string", format: "email" }`. The sugar is a closed set of aliases that expand to standard body keywords (§3) / brands (§4).

### 6.1 Refinement types (capitalized — format-constrained strings)

These appear only in `: Type` / `:: Type` position (catalog `refinement-types`). Each is a `StringOf<{format}>` (§4):

| Alias | Expands to (brand) | Body keyword |
|---|---|---|
| `Email` | `StringOf<{ format: "email" }>` | `{ type:"string", format:"email" }` |
| `UUID` | `StringOf<{ format: "uuid" }>` | `format:"uuid"` |
| `Url` | `StringOf<{ format: "uri" }>` | `format:"uri"` |
| `Date` | `StringOf<{ format: "date" }>` | `format:"date"` |
| `DateTime` | `StringOf<{ format: "date-time" }>` | `format:"date-time"` |
| `IpV4` | `StringOf<{ format: "ipv4" }>` | `format:"ipv4"` |
| `IpV6` | `StringOf<{ format: "ipv6" }>` | `format:"ipv6"` |
| `Slug` | `StringOf<{ format: "slug" }>` (open format) | `format:"slug"` |

`Email`/`UUID`/etc. are **capitalized** deliberately: capitalization is the cue that the alias is a *refinement* (a constrained type that parses), distinguishable from a lowercase primitive alias and reusable as the RHS of `is`/`is not` (§9) and `::` (§8) — the same capitalization the `is`-guard recognizer requires (`is\s+[A-Z]`). A refinement alias is just a named `schema` of a string with a `format`; using one as a `::`/`is` operand means "parse as that format."

### 6.2 Primitive aliases (lowercase)

Lowercase aliases for the base scalar types, accepted in `: Type` position (catalog `primitive-types`):

| Alias(es) | Base | Body |
|---|---|---|
| `int` | integer `number` | `{ type:"integer" }` → `NumberOf<{integer:true}>` |
| `str`, `string` | `string` | `{ type:"string" }` → `string`/`StringOf<{}>` |
| `bool`, `boolean` | `boolean` | `{ type:"boolean" }` |
| `float`, `num`, `number` | `number` | `{ type:"number" }` |

`int`/`str`/`bool`/`float`/`num` are the **terse** spellings; `string`/`boolean`/`number` are accepted so a TS-fluent author need not relearn (A3 — the legible path is the easy path). They are surface aliases only — they carry no constraint beyond the base type unless refined (§6.3).

### 6.3 Inline field refinements (bounds, optional, arrays)

F1's field grammar composes the aliases with bound/cardinality sugar that expands to constraint keywords:

```
FieldType   ::= Alias Bound? "?"?
             | "[" FieldType "]" Bound?            ⟨array⟩
             | Literal ("|" Literal)*              ⟨inline enum⟩
Bound       ::= "(" Range ")"
Range       ::= Num ".." Num                       ⟨exclusive max⟩
             | Num "..=" Num                        ⟨inclusive max⟩
```

| F1 field sugar | JSON-Schema expansion | Typed projection |
|---|---|---|
| `age: int(0..150)` | `age: { type:"integer", minimum:0, maximum:150 }`, in `required` | `NumberOf<{integer:true,minimum:0,maximum:150}>` |
| `age: int(0..150)?` | same body, **not** in `required` | `…|undefined` (optional) |
| `tags: [str](1..=10)` | `tags: { type:"array", items:{type:"string"}, minItems:1, maxItems:10 }` | `ArrayOf<string,{minItems:1,maxItems:10}>` |
| `status: "draft" | "published"` | `status: { enum: ["draft","published"] }` | `"draft" | "published"` |
| `name: str` | `name: { type:"string" }`, required | `string` |

The postfix `?` controls **`required`** (its presence removes the field from the `required` array — the standard 2020-12 way to express optionality), and the type-projection adds `| undefined`. The `..`/`..=` bound operators are the same range operators as the expression language [→ ch:lexical-and-expression-syntax]; in a field bound they populate `minimum`/`maximum` (numbers) or `minItems`/`maxItems` (arrays).

```pts
// .pts — F1 sugar and its standard-body equivalent are the same schema
schema Profile {
  id:       UUID,
  handle:   Slug,
  bio:      str?,                 // optional string
  age:      int(13..=120)?,       // optional, bounded integer
  tags:     [str](0..=8),         // 0–8 string tags
  tier:     "free" | "pro" | "team"
}
```

&gt; **Edge case (refinement alias is just a named schema).** `Email`/`UUID`/… are *resolvable schema values* at runtime (string schemas with a `format`), which is exactly why they work as `::`/`is` operands. `x is Email` lowers to `Email.parse(x).tag === "Ok"` (§9) — `Email` must be in scope as a value, either as a built-in refinement schema or an imported one. A capitalized identifier in `is`-position that is *not* a schema value is the diagnostic "Unknown type for `is` guard — declare or import a `schema`."

---

## 7. The runtime/type projection: `SchemaValue`, `Infer`, `InferFromSchema`, `Handles`

The §2 lowering produces a `SchemaValue`; this section specifies that shape and the type-level extractors built on it. This is the *projection of the spine into the host type system* that this chapter owns (the db/api/wire projections are downstream and [→ ch:modules-projections-and-build]).

### 7.1 `SchemaValue<T,S>`

```ts
export type SchemaValue<T, S = unknown> = {
  parse: (v: unknown) => Result<T, string>;
  is:    (v: unknown) => v is T;
  schema: S;
} & S;
```

- `parse(v)` — the **only sanctioned mint** of a value of the schema's branded type. Returns `Result<T,string>` (§10): `Ok(value)` with a value typed `T`, or `Err(message)`. Errors are values, not exceptions (I3, §0).
- `is(v)` — a TS **type predicate** `v is T`; the `is`/`is not` operators (§9) lower onto `.parse(...).tag === "Ok"`, and `.is` is the directly-callable predicate form.
- `schema` — the JSON-Schema body `S`. The sibling type alias (§2.1) is `(typeof NAME)["schema"]`, i.e. `S`.
- `& S` — the body is **spread onto the value** so field-navigation accessors (`User.id`, `User.email`, `User.properties.age`) are reachable and structurally typed. This is what the `__paraFromSchema` decoration attaches at runtime.

### 7.2 `Infer<X>` — extract the data type

```ts
export type Infer<X> = X extends SchemaValue<infer T, any> ? T : never;
```

`Infer<typeof User>` extracts the `T` from `SchemaValue<T,S>` — the validated data shape. This is the form **hand-written code uses** when it needs the type of a schema's value (the §2 sibling alias is the codegen form; `Infer` is the consumer form, and the two coincide on the data shape). `Infer` works identically under both variants (INV-schema-6).

### 7.3 `InferFromSchema<S>` — derive the type from a *literal body*

```ts
export type InferFromSchema<S> =
    S extends { type: "string"; format?: …; minLength?: …; … } ? …StringOf<…>…
  : S extends { type: "integer" | "number"; … }               ? …NumberOf<…>…
  : S extends { type: "bigint" }                              ? bigint
  : S extends { type: "boolean" }                             ? boolean
  : S extends { type: "array"; items: infer Items; … }         ? ArrayOf<InferFromSchema<Items>, …>
  : S extends { type: "object"; properties: infer P; required?: … } ? InferObjectShape<P, R>
  : S extends { enum: readonly (infer V)[] }                  ? V
  : S extends { const: infer C }                              ? C
  : unknown;
```

`InferFromSchema<S>` is the **codegen-only** machine that turns a raw JSON-Schema *literal type* into the branded data type — it is what derives `StringOf<{format:"email"}>` from `{ type:"string", format:"email" }`, recurses through `items`/`properties`, splits `required` vs optional (`InferObjectShape`), and trims `undefined` constraint slots (`TrimUndefined`). `const`/`enum` short-circuit to the literal/union. Hand-written code does **not** reach for it (it uses `Infer<typeof X>`); the §2 sibling alias deliberately *avoids* it for tsc speed (§2.1). Under the standard variant it collapses to `unknown` (the brands it would derive don't exist there) — but `Infer` still works because `SchemaValue<T>` carries `T` in both variants (INV-schema-6).

### 7.4 `Handles<M,Ctx>` — handler-type sugar

```ts
export type Handles<M extends { request: Schema; response: Schema }, Ctx = unknown> = (
  req: Infer<M["request"]>,
  ctx: Ctx,
) => Promise<Infer<M["response"]>> | Infer<M["response"]>;
```

Given a *model record* `{ request: Schema, response: Schema }` (the F4 anonymous-schema shape of §1), `Handles<typeof M, Ctx>` derives the handler **function type**: `req` is `Infer<request>`, the return is `Infer<response>` (sync or `Promise`), `ctx` is the (application-supplied) context type, defaulting to `unknown`. This is the spine's **server-handle projection at the type level** — the boundary type from which a hand-written handler body hangs (the I1 boundary/logic split: `Handles` types the boundary, the body is the delta).

```pts
// .pts — the F4 model + its Handles<…> projection
const getUser = {
  request:  schema { id: bigint },
  response: schema { name: string },
};

const handler: Handles<typeof getUser, AppCtx> = (req, ctx) => {
  // req: { id: bigint }       — Infer<request>
  // return: { name: string }  — Infer<response>
  return { name: `user${req.id}` };
};
```

`Ctx` is where the **typed auth/middleware context** threads — the A4 hole (custom auth forcing `any`). Because `Ctx` is an ordinary type parameter the application substitutes (`Handles<typeof M, SecureContext<Model>>`), a custom-auth context is *typed end-to-end* with no `any`; the spine never forces an escape (A4, [→ ch:errors-results-and-validation]).

---

## 8. `::` — the schema-bound validation marker

`::` is the **per-argument validation marker**. In a function parameter, `(arg:: T)` declares that `arg` is validated against schema `T` at function entry: the boundary that turns an `unknown` from outside into a parsed `T` inside. It is schema-bound (its RHS is a `schema`), which is why it is defined *here*; its *use as a boundary gate* — what a handler does with the `Err`, how a sync envelope is parse-gated — is [→ ch:errors-results-and-validation] / [→ ch:data-sync-and-authority].

### Grammar

```
ValidatedParam ::= Ident "::" Type           ⟨Type must be a schema value⟩
```

Catalog `validate-marker`: the operator is `::`. It appears in parameter position (`fun handle(req:: User)`) and, in a different role, in a `sync` binding (`sync user :: User from KEY`, §8.3).

**Lexical note.** `::` is two colons; the field grammar uses a single `:` (`id: UUID`). The marker is distinguished by position (it follows a *parameter name*, where a single `:` would be a TS type annotation) and by the double colon. The RHS must be a **capitalized schema reference** (`User`, `Email`); a JS builtin (`String`, `Number`, `Buffer`, `Promise`) in `::` position is skipped (it is a type, not a schema, and has no `.parse`).

### Static semantics

`(req:: User)` types `req` as `Infer<typeof User>` (the validated shape) *inside the function body* — the body sees a parsed `User`, not an `unknown`. The RHS must resolve to a schema value in scope; an unknown type is the diagnostic "Unknown type '`T`' for `::` validation marker — declare a `schema T = { … }` or import one." `::` does **not** widen to `any` (I3): the only way past the marker is a value that parsed.

### Dynamic semantics

At entry the function runs `T.parse(req)` and, on `Err`, **throws** (the boundary contract; the throw/`Result` policy at a handler is [→ ch:errors-results-and-validation]). The body executes only with a validated value.

```
# Desugar:  fun handle(req:: T) { BODY }
Para:
    fun handle(req:: User) { return req.email; }
TS:
    function handle(req: Infer<typeof User>) {
      const __p = User.parse(req);
      if (__p.tag === "Err") throw new Error(__p.error);
      req = __p.value;                       // req is now a validated User
      return req.email;
    }
```

&gt; **Note (IDE mirror vs runtime).** The runtime emit injects the `parse`+throw preamble above (owned by the canonical runtime). The IDE-only mirror (ts-plugin/LSP) **strips** the second colon to a space (`(req:: User)` → `(req:  User)`, columns preserved) so tsc type-checks the annotation without running validation — the editor needs the *type*, the runtime needs the *gate*. Both agree that `req` has type `Infer<typeof User>` inside the body; only the runtime adds the parse. The parity contract pins the runtime emit [→ ch:overview-and-surfaces §3.2].

### 8.3 `::` on a `sync` binding (cross-ref)

`sync NAME :: SCHEMA from KEY` uses the *same* `::` to mean "parse-gate every synced envelope against `SCHEMA`." It lowers to `synced(KEY, SCHEMA)` (the schema becomes the runtime gate; the type-only single-colon form `sync NAME : T from KEY` lowers to `synced(KEY)` with `T` as the type annotation only). The reconcile/authority semantics are [→ ch:data-sync-and-authority]; this chapter asserts only that the `::` here is the *same schema-bound marker* — a synced boundary is a validated boundary, by the same operator as a handler parameter (the four-distances coherence, §0).

---

## 9. `is` / `is not` — schema-bound guards

`is` is the **runtime type-guard** operator: `EXPR is T` tests whether `EXPR` validates as schema `T`, narrowing `EXPR` to `Infer<typeof T>` on the true branch. `is not` is its negation. Like `::`, it is schema-bound; like `::`, its *use* at a boundary is cross-referenced, but its *meaning* is here.

### Grammar

```
IsGuard      ::= Expr "is" Type                 ⟨Type capitalized — a schema⟩
              | Expr "is" "not" Type
MemberGuard  ::= MemberPath "is" "not"? Literal ("|" Literal)*   ⟨literal membership⟩
MemberPath   ::= Ident ("." Ident)*
```

Catalog `is-guard` / `is-not-guard`: `is` fires only before a **Capitalized** identifier (`is\s+[A-Z]`), so `const is = 5; is + 1` and `obj.is(x)` are untouched (superset preservation). The LHS may be a chained member/call/index expression.

### Static semantics

`EXPR is T` is a TS type predicate: on the `true` branch `EXPR` narrows to `Infer<typeof T>`; on `false`, to its complement. `is not T` narrows oppositely. The **literal-membership** form (`S is 'a' | 'b'`) narrows `S` to the literal union (true) / excludes it (false) and requires a *simple* operand (identifier or property path — side-effect-free, so the repeated comparison is sound).

### Dynamic semantics & lowering

```
# Desugar:  EXPR is T   /   EXPR is not T   (schema guard)
Para:
    if (x is Email) { … }
    if (x is not Email) { … }
TS:
    if (Email.parse(x).tag === "Ok") { … }
    if (Email.parse(x).tag !== "Ok") { … }
```

```
# Desugar:  S is 'a' | 'b'   /   S is not 'a' | 'b'   (literal membership)
Para:
    if (status is "open" | "pending") { … }
    if (status is not "open" | "pending") { … }
TS:
    if ((status === "open" || status === "pending")) { … }
    if ((status !== "open" && status !== "pending")) { … }
```

The schema-guard form lowers to `T.parse(EXPR).tag === "Ok"` (`!== "Ok"` for `is not`) — the same `.parse` the schema's `SchemaValue` exposes (§7.1), so `is` and `::` share one validation path. The literal-membership form lowers to a parenthesized `===`/`||` chain (`!==`/`&&` for `is not`) over the canonicalized literals (string literals normalized to double quotes; numbers pass through). The chain is always parenthesized to preserve precedence inside a larger expression.

&gt; **Edge case (`is` vs TS type-predicate annotation).** A TS return annotation `function f(v): v is T {}` is also `EXPR is T`-shaped and *will* be rewritten by the textual mirror — a known toolchain-wide ambiguity. Prefer a `schema` guard, or avoid `: v is T` predicate signatures in Para sources. The parity corpus does not cover this case [→ ch:overview-and-surfaces §3.2].

---

## 10. `Result<T,E>` — errors are values

`schema.parse` returns a `Result`; it is defined here because the spine speaks it (the full error-handling chapter is [→ ch:errors-results-and-validation]).

```ts
export type Result<T, E> =
  | { readonly tag: "Ok";  readonly value: T }
  | { readonly tag: "Err"; readonly error: E };
```

A `Result` is a tagged union discriminated by `tag`. `parse` returns `Result<T, string>` (`Ok` with the validated `T`, or `Err` with a message). The constructors `Ok(v)` / `Err(e)` and the `match` integration are [→ ch:errors-results-and-validation]; the relevant fact here is that **validation never throws of its own accord** — it returns a value, and the `::` marker's throw (§8) is a *boundary policy applied to* that value, not the validator's behavior. This is the I3 "errors are values" property at the schema layer (§0).

```pts
// .pts — consuming a parse Result without exceptions
const r = User.parse(raw);
if (r.tag === "Err") return Err(r.error);   // r.error: string
const user = r.value;                        // user: Infer<typeof User>
```

---

## 11. Spine invariants (summary)

- **INV-schema-1** — every typed boundary artifact derives from a `schema` (sole source; drift is a compile error against the live DB).
- **INV-schema-2** — a `schema` lowers to a readable `__paraFromSchema(() => ( JSON-Schema-2020-12 ))` + sibling alias; the body is hand-writable (glass floor, I1).
- **INV-schema-3** — constraints are carried into the TS type via brands (full constraint set, both sides; A2).
- **INV-schema-4** — all six forms lower onto one runtime helper and one type-projection shape.
- **INV-schema-5** — every Para field sugar has an exact 2020-12 expansion (F1 and F3 converge).
- **INV-schema-6** — extended and standard variants denote the same runtime-valid set; they differ only in compiler help.

---

## 12. Proposed extensions

&gt; All constructs in this section are **Proposed** (net-new surface, not in `language-surface.ts` / the parser today). Each gives grammar, static + dynamic semantics, a `# Desugar (proposed):` sketch so it stays glass-floor-compatible (I1), an example, and the rationale (which "the schema is the application" gap it closes). They are introduced *here* because each extends the **model** itself — the spine — rather than a projection. Where a proposal projects into the DB/sync/validator, the *projection mechanics* remain [→ ch:modules-projections-and-build]; this section specifies the surface and its lowering only.

### 12.1 Schema algebra — intersection, union, partial, pick, omit  `Proposed`

**Rationale.** Today every schema is authored whole. Real spines have *derived* shapes: a `UserUpdate` is `User` with all fields optional; a `PublicUser` is `User` minus `passwordHash`; a `WithTimestamps & Entity` is two bodies intersected. Hand-writing each derived body restates the source — a totality hazard (the derived shape silently drifts from its parent) and an A3 legibility cost. A small, closed **algebra over schemas** lets a derived schema be *named as a function of its source*, so the relationship is modeled, not retyped. Each operator lowers to a body transform a developer could read.

**Grammar.**

```
SchemaAlgebra ::= Export? "schema" Ident "=" AlgebraExpr ";"
AlgebraExpr   ::= SchemaRef
               | AlgebraExpr "&" AlgebraExpr           ⟨intersection — merge properties⟩
               | AlgebraExpr "|" AlgebraExpr           ⟨union — anyOf⟩
               | "partial" "(" AlgebraExpr ")"          ⟨all properties optional⟩
               | "pick" "(" AlgebraExpr "," FieldList ")"
               | "omit" "(" AlgebraExpr "," FieldList ")"
FieldList     ::= "{" Ident ("," Ident)* "}"
SchemaRef     ::= Ident
```

`partial`/`pick`/`omit` are manifest-style helper terminals legal only on the RHS of a `schema =` algebra expression (they do not enter the general keyword catalog and cannot shadow identifiers). `&`/`|` are the schema-algebra operators (distinct from bitwise by the `schema =` context).

**Static semantics.** Each operator is total over the §3 body: `A & B` merges `properties` (a key in both must be assignment-compatible, else error: `intersection conflict on field 'id': bigint vs string`) and unions `required`; `A | B` produces a `{ anyOf: [A.schema, B.schema] }` body whose `Infer` is `Infer<A> | Infer<B>`; `partial(A)` empties `required`; `pick(A,{…})`/`omit(A,{…})` filter `properties` + `required` (a name not in `A` is an error: `pick: 'foo' is not a field of User`). The derived schema's `Infer` is the corresponding TS type operation (`&`, `|`, `Partial<…>`, `Pick<…>`, `Omit<…>`), so the type projection stays exact. Because the derived body is *computed from* the source, the I3 drift check (§0) covers it for free — change `User`, and `PublicUser` re-derives.

**Dynamic semantics / desugar.** Each operator lowers to a runtime body transform on the source's `.schema`, re-decorated by `__paraFromSchema`. The transforms are ordinary, readable object operations (I1).

```
# Desugar (proposed):  schema algebra
Para:
    schema UserUpdate = partial(omit(User, { id }));
    schema PublicUser = omit(User, { passwordHash });
    schema Entity     = WithId & WithTimestamps;
TS:
    const UserUpdate = __paraFromSchema(() => __paraPartial(__paraOmit(User.schema, ["id"])));
    type UserUpdate  = (typeof UserUpdate)["schema"];
    const PublicUser = __paraFromSchema(() => __paraOmit(User.schema, ["passwordHash"]));
    type PublicUser  = (typeof PublicUser)["schema"];
    const Entity     = __paraFromSchema(() => __paraMerge(WithId.schema, WithTimestamps.schema));
    type Entity      = (typeof Entity)["schema"];
    // __paraOmit/__paraPick/__paraPartial/__paraMerge are plain object transforms over a JSON-Schema body
```

**Interaction.** Schema algebra composes with §12.2 (a `pick` of an entity preserves its key field), §12.5 (a derived schema inherits its source's version unless re-versioned), and the projections (`UserUpdate` projects to a PATCH route body, `PublicUser` to a read-only client type) [→ ch:modules-projections-and-build]. It discharges A3 for the common derived-shape case: the relationship is one legible line, not a retyped body.

**Example.**

```pts
schema User { id: UUID, email: Email, passwordHash: str, age: int(0..150)? }

export schema PublicUser  = omit(User, { passwordHash });        // read-facing
export schema UserUpdate  = partial(omit(User, { id }));         // PATCH body
export schema AdminView   = User & schema { lastLogin: DateTime };  // intersect with an inline body
```

```pts
// ✗ counter-example
schema Bad = pick(User, { nickname });   // ✗ error: pick: 'nickname' is not a field of User
```

### 12.2 Schema-level relations & foreign keys — the graph shape  `Proposed`

**Rationale.** "The schema is the application" needs the spine to express not just *records* but the *graph* between them — which the DB projection needs for foreign keys/joins and which **sync needs for entity-keying** (a synced replica is keyed by `(entity, id)`; today that key is configured out-of-band). A relation declared *in the schema* feeds both: the DB gets an FK, sync gets a stable entity key, and the client gets a typed navigation. Without it, the relationship lives in three hand-kept places (A5 — the db⇄api⇄types chain must be one chain).

**Grammar.**

```
RelationField ::= Ident ":" RelKind "(" SchemaRef KeySpec? ")"
RelKind       ::= "ref" | "refs"          ⟨ref = to-one (FK held here); refs = to-many (inverse)⟩
KeySpec       ::= "by" Ident              ⟨the field on the OTHER schema that keys the relation; default: its @id⟩
IdMarker      ::= "@id"                    ⟨field-level: marks the entity key (sync + PK)⟩
```

`@id` is a field-level marker (one per schema) naming the **entity key** — the primary key for DB and the sync entity id. `ref(S)` declares a to-one foreign key to `S` (the FK column lives on this schema, typed as `S`'s `@id` type); `refs(S by f)` declares the to-many inverse (no column here; a typed navigation backed by `S.f`).

**Static semantics.** Each schema may declare at most one `@id` field; a schema used as a `ref`/`refs` target *must* have one (else: `Order.user references User, which has no @id field`). `user: ref(User)` types the field as `Infer<typeof User["@id"]>` (the key type) at the data layer and as `Infer<typeof User>` at the *navigated* layer (the client projection resolves it). `refs(LineItem by order)` is inverse-only: it adds no column and types as `readonly Infer<typeof LineItem>[]`. The relation graph is acyclic-checked only for *required* `ref` cycles (a required mutual FK is unsatisfiable: `cyclic required ref: Order.user → User.order`); optional cycles are allowed.

**Dynamic semantics / desugar.** The relation field lowers to a JSON-Schema body carrying a Para `x-relation` extension keyword (still a standard, inspectable body — INV-schema-5 is preserved because `x-` keywords are the 2020-12-sanctioned extension point). The DB and sync projections read `x-relation`; the runtime value is the FK scalar.

```
# Desugar (proposed):  relations / foreign keys
Para:
    schema User  { id: UUID @id, email: Email, orders: refs(Order by user) }
    schema Order { id: UUID @id, total: int, user: ref(User) }
TS:
    const User = __paraFromSchema(() => ({
      type: "object",
      properties: { id: { type:"string", format:"uuid", "x-id": true },
                    email: { type:"string", format:"email" },
                    orders: { "x-relation": { kind:"refs", target:"Order", by:"user" } } },
      required: ["id","email"],
    }));
    const Order = __paraFromSchema(() => ({
      type: "object",
      properties: { id: { type:"string", format:"uuid", "x-id": true },
                    total: { type:"integer" },
                    user: { type:"string", format:"uuid", "x-relation": { kind:"ref", target:"User", by:"id" } } },
      required: ["id","total","user"],
    }));
    // DB projection reads x-relation → FK + JOIN; sync reads x-id → entity key; client reads both → typed nav
```

**Interaction.** `@id` is the single input that closes sync entity-keying (the reconciler keys replicas by `(target, @id)` instead of a configured key) and DB primary keys *from one declaration*, discharging A5's "one chain" for the relational case. It composes with §12.1 (`pick`/`omit` must keep `@id` for an entity-typed result, else error: `omit removes the @id field; result is not an entity`) and §12.5 (a relation added in a new schema version projects to an `ADD COLUMN … REFERENCES` migration).

**Example.**

```pts
export schema Author { id: Snowflake @id, name: str, posts: refs(Post by author) }
export schema Post   { id: Snowflake @id, title: str(1..200), author: ref(Author), tags: refs(Tag by post) }
export schema Tag    { id: Slug @id, post: ref(Post) }
```

### 12.3 Computed/derived fields & cross-field refinements  `Proposed`

**Rationale.** Some field values are *functions of other fields* (`fullName = first + " " + last`), and some constraints span *multiple fields* (`endDate >= startDate`). Today the former is hand-written in a handler (invisible to the client) and the latter is the A2 failure — a size/range check re-implemented in handler code, invisible to the client until it fails server-side at runtime. Lifting both into the schema means a computed field projects to a DB **generated column** *and* a client-side value, and a cross-field refinement projects to a **validator on both sides** *and* a DB `CHECK` constraint. The constraint lives once.

**Grammar.**

```
ComputedField ::= Ident ":" Type "=" PureExpr ";"        ⟨derived from sibling fields⟩
Refinement    ::= "refine" "{" RefineRule (";" RefineRule)* "}"
RefineRule    ::= BoolExpr ("else" StringLit)?           ⟨cross-field predicate + message⟩
PureExpr      ::= ⟨a pure expression over sibling field names; no I/O⟩
BoolExpr      ::= ⟨a boolean expression over sibling field names⟩
```

A `ComputedField` uses `=` after the type to give a pure expression over sibling fields. A `refine { … }` block (one per schema) lists cross-field boolean rules, each optionally with an `else "message"` for the `Err`.

**Static semantics.** A computed field's expression must be **pure** over sibling fields ([→ ch:purity-and-determinism]) — no I/O, no external reads — so it is reproducible on both client and DB. Its declared type must be assignable from the expression's inferred type. It is **read-only** in the data type (`readonly fullName: string`) and excluded from `required`-on-input (it is computed, not supplied). A `refine` rule is a boolean over sibling field names; it contributes to `parse` (a rule that fails makes `parse` return `Err(message)`) and is checkable statically for referencing only declared fields (`refine references unknown field 'endDt'`).

**Dynamic semantics / desugar.** Computed fields lower to an `x-computed` body keyword (the expression as a pure thunk) consumed by `parse` (to populate the field) and the DB projection (generated column); `refine` rules lower to predicates run inside `parse` after field-level validation.

```
# Desugar (proposed):  computed field + cross-field refinement
Para:
    schema Booking {
      startDate: Date,
      endDate:   Date,
      nights:    int = daysBetween(startDate, endDate),
      refine { endDate >= startDate else "endDate must be on or after startDate" }
    }
TS:
    const Booking = __paraFromSchema(() => ({
      type: "object",
      properties: { startDate: {type:"string",format:"date"},
                    endDate:   {type:"string",format:"date"},
                    nights:    {type:"integer",
                                "x-computed": (r) => daysBetween(r.startDate, r.endDate)} },
      required: ["startDate","endDate"],
      "x-refine": [ { ok: (r) => r.endDate >= r.startDate,
                      msg: "endDate must be on or after startDate" } ],
    }));
    // parse(): validate fields → run x-refine (Err on first failure) → fill x-computed → Ok(value)
    // DB projection: nights AS GENERATED column; x-refine → CHECK (end_date >= start_date)
```

**Interaction.** This is the sharpest discharge of A2: the size/enum/cross-field checks `trackAnalytic` hand-rolls in handler code [→ schema-is-the-application §7 L3] become schema-level `refine` rules that project to *both* the client validator and the server, so the client cannot send data that only fails server-side. It composes with §12.6 (a computed field typed as a currency/unit) and §12.2 (a `refine` may span a `ref`'d field once the relation resolves).

**Example.**

```pts
export schema LineItem {
  qty:       int(1..),
  unitPrice: Money,                              // §12.6
  subtotal:  Money = unitPrice.mul(qty),         // computed → DB generated column
  refine {
    qty <= 100 else "max 100 per line";
  }
}
```

### 12.4 First-class `Option<T>` beside `Result`  `Proposed`

**Rationale.** `Result<T,E>` (§10) models *fallible* values; an *absent-but-not-an-error* value (a nullable field, a missing lookup) is today either `T | undefined` (untyped-ish, easy to forget to handle) or an awkward `Result<T, "missing">`. A first-class `Option<T>` (`Some(v)` / `None`) sits beside `Result` with the same `match` integration, makes optionality a *value you must destructure* (closing the "forgot the undefined branch" footgun the rewrites repeatedly hit), and gives an optional schema field a principled type. `Some`/`None` are already in the catalog (`result-option-ctor`, `none-const`); this lifts them to a first-class schema/`match` citizen.

**Grammar.**

```
OptionType ::= "Option" "<" Type ">"
OptionCtor ::= "Some" "(" Expr ")" | "None"
```

`Option<T>` is a type; `Some(v)`/`None` are its constructors (catalog-present today). An optional schema field `x: T?` *may* be projected as `Option<T>` instead of `T | undefined` under a per-schema or manifest opt-in.

**Static semantics.** `Option<T> = { tag: "Some"; value: T } | { tag: "None" }` — a tagged union discriminated identically to `Result`, so `match` discriminates both with one mechanism [→ ch:errors-results-and-validation]. `match` over an `Option` is **exhaustive** (both `Some`/`None` arms required, else a totality error — the footgun-closing property). `Some(v): Option<T>` infers `T` from `v`; `None: Option<never>` widens to the context.

**Dynamic semantics / desugar.** `Option` lowers to the tagged union; `Some`/`None` to object literals.

```
# Desugar (proposed):  Option<T>
Para:
    fun find(id: UUID): Option<User> {
      const u = db.get(id);
      return u ? Some(u) : None;
    }
    match find(id) { Some(u) => u.email, None => "—" }
TS:
    function find(id): { tag:"Some"; value: Infer<typeof User> } | { tag:"None" } {
      const u = db.get(id);
      return u ? { tag:"Some", value: u } : { tag:"None" };
    }
    // match → switch on .tag, both arms required
```

**Interaction.** `Option` composes with §10 (`Result` and `Option` share the discriminant convention and the `match` engine) and with optional schema fields (`x: T?` → `Option<T>` under opt-in), so an absent field is a value the consumer *must* handle, not a silently-ignored `undefined` (I3 at the field granularity). It is the type-level partner of the `??`/`?.` host operators, made total.

### 12.5 Co-located schema versioning & migration  `Proposed`

**Rationale.** Sync reconciles by `(schema_version, sequence)` [→ ch:data-sync-and-authority] — yet today `schema_version` is *magic* (assigned by the toolchain, invisible in the source). For the version to be **authored, not magic** (and for a migration to be a modeled, diffable fact rather than a hand-written SQL file that drifts from the model), the version and its migration belong *co-located with the schema*. A `@version` marker plus `migrate` blocks make the spine carry its own history, so a synced client and server agree on the version *because it is in the schema both compiled from*.

**Grammar.**

```
VersionedSchema ::= Export? "schema" Ident "@" Int SchemaBody MigrateBlock*
MigrateBlock    ::= "migrate" "from" Int "{" MigrateOp* "}"
MigrateOp       ::= "rename" Ident "->" Ident ";"
                 | "add" Ident ":" Type "=" Expr ";"      ⟨backfill expr⟩
                 | "drop" Ident ";"
                 | "split" Ident "->" "{" Ident ("," Ident)* "}" "=" Expr ";"
```

`schema User @3 { … }` declares the schema is at version 3; each `migrate from N { … }` block specifies the transform from version `N`. Ops are the readable schema-evolution primitives (`rename`, `add`+backfill, `drop`, `split`).

**Static semantics.** The `@Int` is the authored `schema_version`; it must be a positive integer and monotonically cover its `migrate from` blocks (a `migrate from 2` requires the schema be `@3` or later; a gap — `@3` with only `migrate from 1` — is the error `no migration path from v2 to v3`). Each `migrate` op is type-checked against the *prior* version's body (a `rename a -> b` requires `a` in vN and `b` in the current body; an `add` requires a backfill expr whose type matches). The version threads into the synced cell's type so a `sync NAME :: S from KEY` knows `S`'s version at compile time — closing the "schema_version is magic" gap (it is now read from the source).

**Dynamic semantics / desugar.** `@N` lowers to a `$schemaVersion` body field; `migrate` blocks lower to an ordered migration table the DB projection emits as readable up-migrations and the sync reconciler reads to skew old envelopes forward.

```
# Desugar (proposed):  versioned schema + migration
Para:
    schema User @2 { id: UUID @id, fullName: str }
    migrate from 1 {
      add fullName: str = `${old.firstName} ${old.lastName}`;
      drop firstName;
      drop lastName;
    }
TS:
    const User = __paraFromSchema(() => ({
      $schemaVersion: 2,
      type: "object",
      properties: { id: {type:"string",format:"uuid","x-id":true}, fullName: {type:"string"} },
      required: ["id","fullName"],
      "x-migrations": [ { from: 1, ops: [
        { op:"add",  field:"fullName", backfill:(old)=>`${old.firstName} ${old.lastName}` },
        { op:"drop", field:"firstName" },
        { op:"drop", field:"lastName" } ] } ],
    }));
    // DB projection: a readable up-migration (ADD fullName; backfill; DROP firstName,lastName)
    // sync reconciler: skews a v1 envelope to v2 via x-migrations before reconcile
```

**Interaction.** This is the schema-side counterpart of the sync chapter's reconcile-by-`(schema_version, sequence)`: the version is *authored here* and *consumed there*, so the two never disagree (the four-distances coherence, §0). The migration ops are the glass-floor history (I1) — a `migrate` block *is* the readable migration, co-located with the model it migrates, discharging the [beta-vault-migration-incident] sequencing lesson at the language level (expand/backfill is declared *before* a `drop`, and the toolchain can enforce the order because it can read both).

### 12.6 Branded units & currency — tying `d` literals into the type system  `Proposed`

**Rationale.** Para already has exact decimals: `0.0825d` lowers to `__paraDec("0.0825")` (a `Decimal` with `.add`/`.mul`/`.plus`, no FP drift) [→ ch:lexical-and-expression-syntax]. But a *raw* `Decimal` is dimensionless — nothing stops adding `USD` to `EUR`, or a price to a tax-rate. A **branded unit** schema type (`Money`, `Percent`, a currency tag) carries the unit in the type, projects to a DB `numeric`/`money` column, and makes `usdPrice.add(eurPrice)` a *compile error*. This ties the `d` literal — already exact at runtime — into the type system, closing the last gap where a financial value is "just a number."

**Grammar.**

```
UnitSchema ::= Export? "schema" Ident "=" "unit" "(" UnitBase UnitTag? ")" ";"
UnitBase   ::= "decimal" | "int"
UnitTag    ::= "tag" StringLit            ⟨the unit/currency discriminant⟩
            | "currency" Ident             ⟨ISO-4217-style currency code⟩
```

`schema Money = unit(decimal currency USD)` declares a decimal branded with currency `USD`; `schema Percent = unit(decimal tag "%")` a tagged decimal. `unit` is a manifest-style helper terminal on a `schema =` RHS.

**Static semantics.** `unit(decimal currency USD)` is `Brand<Decimal, { unit: "USD" }>` (§4 brand machinery, extended over `Decimal`). Two unit schemas with different tags/currencies are mutually non-assignable; arithmetic is typed so `Money.add(Money)` is `Money` but `USD.add(EUR)` is an error (`cannot add Money<USD> to Money<EUR>`). A `d` literal assigned to a unit field is *required* (a bare `number` is not assignable — you must write `19.99d`), so the exact-decimal discipline is enforced by the type. Under the **standard variant** (§5) the unit brand collapses to `Decimal` (the constraint is dropped for vanilla consumers, INV-schema-6).

**Dynamic semantics / desugar.** A unit schema lowers to a `__paraFromSchema` body with `type: "numeric"` + an `x-unit` tag; a unit-typed field's value is the underlying `Decimal` (`__paraDec(...)`). The brand is phantom (zero runtime cost, §4.1).

```
# Desugar (proposed):  branded unit / currency
Para:
    schema Money   = unit(decimal currency USD);
    schema Percent = unit(decimal tag "%");
    schema Invoice { subtotal: Money, taxRate: Percent, total: Money = subtotal.mul(taxRate.plus(1d)) }
TS:
    const Money   = __paraFromSchema(() => ({ type:"numeric", "x-unit": { kind:"currency", code:"USD" } }));
    type Money    = (typeof Money)["schema"];     // Brand<Decimal, { unit: "USD" }> under extended
    const Percent = __paraFromSchema(() => ({ type:"numeric", "x-unit": { kind:"tag", tag:"%" } }));
    const Invoice = __paraFromSchema(() => ({
      type: "object",
      properties: { subtotal: Money.schema, taxRate: Percent.schema,
                    total: { ...Money.schema, "x-computed": (r) => r.subtotal.mul(r.taxRate.plus(__paraDec("1"))) } },
      required: ["subtotal","taxRate"],
    }));
    // DB: numeric(…) columns; arithmetic is Decimal (exact); the brand makes USD+EUR a tsc error
```

**Interaction.** Branded units compose with §12.3 (a computed `total: Money = …` is a unit-typed generated column) and with the existing `d` literal (the literal supplies the exact value; the unit supplies the dimension). It is the type-system completion of the decimal story: `d` already won *exactness*; `unit(...)` adds *dimensional safety*, so a financial spine is total (I3) at the value *and* the unit level — the strongest available statement that "the schema is the application" reaches all the way down to money.

