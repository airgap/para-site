---
title: "@lyku/para-schema"
description: The schema spine — one declaration yields a runtime validator, a TS type, and a JSON Schema 2020-12 document; recursion via $ref, capability-gated cycles, a schema-driven msgpack codec, and a checker-driven TS extractor.
---

```ts
import type { Infer, SchemaValue, FromDecl, StringOf, NumberOf } from "@lyku/para-schema";
```

The **spine**: declare a shape once and everything else derives from it — the
runtime validator (`.parse` returning a `Result`), the TS type (a sibling
alias, so `User` works in both value and type position), the JSON Schema
2020-12 document (`.schema`, hand-writable, standard), and the wire codec
(`.encode`/`.decode`). The language keyword does the declaring; this package
carries the *type-level* machinery that keeps constraints visible to tsc.
Normative semantics: [spec ch. 03](/spec/03-type-and-schema-system/).

## Declaring schemas

```parabun
schema User {                       // the field DSL — sugar over 2020-12
  id: int,
  email: Email,
  age: int(0..150)?
}

schema Order = {                    // literal JSON Schema body
  type: "object",
  properties: { id: { type: "bigint" } },
  required: ["id"],
};

schema External from orderJson;     // ingest an EXISTING JSON Schema (file, fetch, literal)

const inline = schema { id: bigint };          // anonymous, expression position

schema Account = ts<import('./models').Account>;   // extracted from a TS type (below)
```

Every form yields the same thing: `User.parse(v) → Result<User, string>`,
`User.is(v)` (a narrowing guard), `User.schema` (the standard document —
hand it to OpenAPI, Mongo, whatever), plus field navigation (`User.email`)
and the codec members. On a parameter, `req:: User` injects
parse-and-throw at entry; `x is User` is the expression-position guard.

## Recursion — self-reference compiles to `$ref`

Reference a schema's own name (or any in-scope declaration) inside a body
and it compiles to a registry reference — **data, not evaluation**, so
self, forward, and mutual recursion all just work:

```parabun
schema Comment = {
  type: "object",
  properties: {
    body:    { type: "string" },
    replies: { type: "array", items: Comment },   // → { $ref: "#Comment" }
  },
  required: ["body"],
};
```

Schema values stay plain **acyclic JSON** (`JSON.stringify` never throws);
navigation preserves identity (`Tree.children.element === Tree`); and a
recursion loop in a plain declaration must pass through an *escape node*
(an optional field, an emptiable array, a union arm) — a loop that is
`required` at every hop can never be satisfied by a finite value and is
rejected at first parse.

## Capability modifiers — cycles, depth, identity

Recursive *schemas* are free; cyclic *values* are licensed explicitly:

```parabun
cyclic schema Node = { … };            // values may contain reference loops
cyclic(3) schema Ring = { … };         // …bounded to cycles of ≤ 3 hops
schema(depth: 32) Comment = { … };     // cap recursive nesting per path
schema(identity: preserve) Doc = { … };// decode reconstructs shared references
```

Capabilities are per-declaration and **never propagate** across embedding
boundaries. The validator enforces them (in-flight cycle tracking,
path-scoped depth counters), and so does the codec — a hostile byte stream
can't smuggle a cycle past a non-`cyclic` schema.

## The wire codec — `.encode` / `.decode`

Schema-driven MessagePack on every schema value. When a declaration is
`cyclic` or `identity: preserve`, encoding is reference-tracked: repeated
objects emit a value-level backreference (ext type `0x50`), and decode is
shell-first so cycles and shared references reconstruct exactly — with the
same depth/cycle bounds enforced *during* decode.

```ts
const bytes = Doc.encode(doc);      // Uint8Array
const back  = Doc.decode(bytes);    // shared refs preserved under identity: preserve
```

## The brand types — constraints tsc can see

The extended variant (selected by the `parabun` package-export condition)
carries constraints as phantom brands; the standard variant collapses every
brand to its base primitive so vanilla TS consumers see ordinary types:

```ts
type Username = StringOf<{ minLength: 3; maxLength: 20; pattern: "^[a-z0-9_]+$" }>;
type Age      = NumberOf<{ integer: true; minimum: 0; exclusiveMaximum: 150 }>;
// extended: branded string/number — standard: just string/number
```

`StringOf` / `NumberOf` / `BigIntOf` / `BooleanOf` / `ArrayOf` / `ObjectOf`,
plus `SchemaValue<T,S>`, `Infer<typeof X>` (the type a schema validates),
`InferFromSchema<S>` (codegen's literal-body deriver), `Handles<M,Ctx>`
(handler-type sugar), and `Result<T,E>`. Same export names in both
variants — one emitted `.d.ts` serves both audiences.

`FromDecl<T, Name>` is the **declaration-origin marker**: codegen emits
`export type UserData = FromDecl<InferFromSchema<typeof User>, "User">` so
tools can tie a TS type back to the named declaration it came from. It
collapses to bare `T` in the standard variant.

## The TS extractor — `ts<import('./x').T>`

The reverse projection: derive the schema *from* an existing TS type, using
the real TypeScript checker (generics instantiated, intersections collapsed,
brands recovered):

```parabun
schema User = ts<import('./models').User>;
```

```sh
bun para-extract <file>        # substitutes the extracted body in place
bun para-extract <file> --check   # CI drift gate
```

`para-extract` (from `@lyku/para-extract`) replaces the directive with the
extracted JSON-Schema body, leaving a `/* ts<…> */` marker so re-extraction
is idempotent and the artifact reviews in the diff. Types marked with
`FromDecl` link to registry `$ref`s instead of being re-derived, so
extracted schemas participate in recursion like hand-written ones. An
unsubstituted directive throws at runtime with the fix-it — never a silent
empty schema.

## Where it flows

The schema is what the projections read: DB models and migrations, API
contracts, typed clients, boundary validation, the wire codec, and the sync
reconciler all derive from it — [spec ch. 11](/spec/11-modules-projections-and-build/)
is the projection table, [`@lyku/para-sync`](/docs/sync/) is the biggest
consumer (every envelope crosses a schema's parse gate).
