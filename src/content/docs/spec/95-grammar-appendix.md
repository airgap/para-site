---
title: "Appendix B — Consolidated Grammar Reference"
description: "Appendix B — Consolidated Grammar Reference"
sidebar:
  order: 15
---

Every keyword, operator, and type in Para — **current** (in ParaBun / para-preprocess today) and **proposed** (introduced by this spec). Read the present-tense language by filtering to `[current]`. Productions reuse the shared nonterminals `Ident`, `Expr`, `Type`, `Block`, `Pattern`, `SchemaBody`. Verified against `src/language-surface.ts` (the authoritative catalog).

```ebnf
(* ───────────────────────── B.1 Functions & purity ───────────────────────── *)
FunDecl       ::= "fun" Ident Generics? "(" Params ")" Block            [current]   (* alias for `function` *)
PureMod       ::= "pure"                                                [current]   (* purity marker; parse-time RT check *)
PureFun       ::= "pure" "async"? ("fun" | "function") …                [current]
PureArrow     ::= "pure" "async"? ( "(" Params ")" | Ident ) "=>" Expr  [current]
AsyncBlock    ::= "async" Block                                         [current]   (* async block expression *)

(* ───────────────────────── B.2 Reactivity core ──────────────────────────── *)
Signal        ::= "signal" Ident TypeAnn? "=" Expr Interval? ";"        [current]   (* WritableSignal *)
Interval      ::= "every" Expr                                          [current]   (* interval-driven postfix *)
Derived       ::= "derived" Ident ( "=" Expr | Block ) ";"              [current]   (* DerivedSignal; block = $derived.by *)
Effect        ::= "effect" ( Block | Expr ) ";"                         [current]
Source        ::= "source" Ident TypeAnn? "=" Expr ";"                  [current]   (* native handle: peek/subscribe/dispose *)
RBind         ::= Expr "~>" Expr                                        [current]   (* src ~> dst  →  effect dst = src *)
CallBind      ::= Expr "->" Expr                                        [current]   (* reactive call-binding *)
(* batch / untrack / resource / promiseSignal / throttled / debounced / from* are runtime fns, not keywords *)

(* ───────────────────── B.3 Effects, lifecycle, concurrency ───────────────── *)
When          ::= "when" "not"? Expr Block                             [current]   (* edge-triggered *)
WhenStartStop ::= "when" Expr "start" Block ( "when" "stop" Block )?    [current]   (* paired edge arms *)
Defer         ::= "defer" "await"? Expr ";"                            [current]   (* LIFO block-exit hook *)
Arena         ::= "arena" Block                                        [current]   (* DeferGC scope *)
Parallel      ::= ("parallel" | "para") ( Block | ("let"|"const") BindingList )  [current]   (* fan-out promise composition *)
Memo          ::= "memo" "async"? ( FunForm | ArrowForm )             [current]   (* memoized fn *)
Using         ::= "using" Ident "=" Expr ";"                          [current]   (* dispose-on-unmount (.pui) *)

(* ───────────────────────── B.4 Schema & types ───────────────────────────── *)
Schema        ::= "export"? "schema" ( SchemaNamed | SchemaInline )    [current]
SchemaNamed   ::= Ident ( SchemaBody | "=" Expr | "from" Expr )        [current]   (* 6 forms across export× / body / = / from *)
SchemaInline  ::= SchemaBody                                           [current]   (* anonymous literal *)
SchemaBody    ::= "{" Field* WhereClause* "}"                          (* Field set; WhereClause [proposed] *)
ValidateMark  ::= Ident "::" Type                                      [current]   (* (req:: User) injects User.parse(req) *)
IsGuard       ::= Expr "is" "not"? Type                                [current]   (* → Type.parse(expr).tag === "Ok" *)
PrimType      ::= "int"|"str"|"string"|"bool"|"boolean"|"float"|"num"|"number"   [current]
RefineType    ::= "Email"|"UUID"|"Url"|"Date"|"DateTime"|"IpV4"|"IpV6"|"Slug"    [current]
Brand         ::= "StringOf"|"NumberOf"|"BigIntOf"|"ArrayOf"|"ObjectOf"          [current]   (* constraint brands *)
ResultCtor    ::= "Ok" "(" Expr ")" | "Err" "(" Expr ")"              [current]
OptionCtor    ::= "Some" "(" Expr ")" | "None"                        [current]
Match         ::= "match" Expr "{" ( Pattern "=>" Expr ","? )* "}"    [current]   (* non-literal patterns: Partial *)

(* ──────────────────── B.5 Operators & literals (lexical) ─────────────────── *)
Pipeline      ::= Expr "|>" Expr                                       [current]   (* thread LHS as first arg *)
Then          ::= Expr "..>" Expr                                      [current]   (* .then *)
Catch         ::= Expr "..!" Expr                                      [current]   (* .catch *)
Finally       ::= Expr "..&" Expr                                      [current]   (* .finally *)
RangeExcl     ::= Expr ".." Expr                                       [current]   (* [a, b) *)
RangeIncl     ::= Expr "..=" Expr                                      [current]   (* [a, b] *)
Decimal       ::= Number "d"                                           [current]   (* 42d / 0.0825d — exact arithmetic *)
UnderscoreLam ::= "_"                                                  [current]   (* expr-context lambda: arr.filter(_ > 0) *)
LeadingDot    ::= "." Ident "(" Args ")"                               [current]   (* leading-dot method shorthand *)
(* Lexical note: `1.method()` vs `1..5`; `d`-suffix vs range lookahead; statement-position keyword detection *)

(* ─────────────────────── B.6 .pui component surface ──────────────────────── *)
Prop          ::= "prop" Ident TypeAnn? ( "=" Expr )? ";"             [current]   (* merged into $props() *)
AsyncSignal   ::= "async" "signal" Ident "=" Expr ";"                 [current]   (* {data,error,pending}, abort on unmount *)
Provide       ::= "provide" Ident "=" Expr ";"                        [current]   (* context *)
Inject        ::= "inject" Ident ";"                                  [current]
SnippetSugar  ::= Attr "=" "{" "<" Tag "/>" "}"                       [current]   (* inline snippet *)
(* full Svelte-5 template: {#if} {#each} {#await} {#snippet}, bind: on: use: transition:, scoped <style> [current] *)

(* ──────────────────────── B.7 Sync & authority ───────────────────────────── *)
SyncDecl      ::= "sync" Ident "::" Schema "from" KeyExpr ";"         [current]   (* server-authoritative replica, READ-only *)
SyncedDecl    ::= "synced" Ident "=" Expr ";"                         [current]   (* replicated state *)
(* SyncEnvelope{value, schema_version, sequence}; reconcile iff sequence === current+1; Class-A default / Class-B opt-in *)

(* ═══════════════════════════ B.8 PROPOSED SURFACE ════════════════════════════ *)

(* — One graph, two authorities (A.1) — *)
Transaction   ::= "transaction" Ident Block "commit" Expr ChainOp*    [proposed]   (* atomic optimistic intent + rollback *)
History       ::= ("signal"|"sync"…) Decl "keep" Number               [proposed]   (* version-stamped time-travel ring *)
HistoryRead   ::= Ident "." ("undo"|"redo") "(" ")" | Ident ".at" "(" Expr ")"   [proposed]
Motion        ::= "motion" Ident "=" Expr ("spring" | "tween") SpringCfg?  [proposed]   (* interpolated reactive value *)
AtRest        ::= Ident ".atRest"                                     [proposed]   (* reactive at-rest flag *)

(* — Temporal schema spine (A.2) — *)
StatesSchema  ::= "schema" Ident "states" "{" StateDecl+ Transition+ "}"   [proposed]
StateDecl     ::= Ident "{" Field* "}"                               [proposed]   (* per-state field shape *)
Transition    ::= Ident "->" Ident "on" Ident Guard? Authority?      [proposed]
Edge          ::= Ident ":" ( "->" | "->>" ) TypeRef EdgeOpts?       [proposed]   (* FK + join + sync fan-out + suspense *)
WhereClause   ::= "where" Expr ( "@msg" "(" Str ")" | "@async" "(" Expr ")" )?  [proposed]   (* cross-field invariant *)
Refine        ::= "refine" Ident "as" Type SchemaBody                [proposed]
Evolves       ::= "schema" Ident "@version" "(" Str ")" SchemaBody "evolves" "{" Delta+ "}"  [proposed]
Delta         ::= "from" Str ":" ("add"|"rename"|"split"|"drop"|…) …  [proposed]   (* minor = compatible / MAJOR = breaking *)

(* — Reconciler laws made type-visible (A.3) — *)
Authority     ::= "authority" ( "last-write-wins" | "merge" "concurrent"
                              | "server-only" | "derive" "from" Ident )  [proposed]
Visible       ::= "@visible" "(" ( "self" | Str ) ")" Field           [proposed]   (* viewer-indexed field presence *)
ViewerSync    ::= "sync" Ident "::" Schema "@viewer" "from" KeyExpr   [proposed]
SeqBrand      ::= Type "@seq" ( "where" Expr )?                        [proposed]   (* phantom sequence ordinal *)
OnAdvance     ::= "on" Ident "advance" "(" Ident "," Ident ")" Block  [proposed]   (* supplies the newer-than proof *)
Dispose       ::= "dispose" Ident ";"                                 [proposed]   (* consumes an affine handle *)

(* — Declarative scheduler & flow (A.4) — *)
Transition'   ::= "transition" Ident "=" "derived" Expr Lane?         [proposed]   (* concurrent priority-lane value *)
Lane          ::= "lane" ( "low" | "high" )                           [proposed]
Stream        ::= "stream" Ident "from" Expr StreamOp?               [proposed]
StreamOp      ::= "over" "last" Duration                              [proposed]   (* sliding window *)
                | "fold" Ident "by" Duration                          [proposed]   (* tumbling fold aggregate *)
                | "since" Expr                                        [proposed]   (* replay synced sequence as a log *)

(* — Glass-floor list identity (A.5) — *)
IdentityField ::= Field "@identity"                                   [proposed]   (* schema-declared list key *)
KeyedEach     ::= "{#each" Expr "as" Pattern "(" "keyof" Type ")" "}" … "{/each}"  [proposed]
EachCells     ::= "each" Ident "in" Expr "{" Signal* "}"             [proposed]   (* per-identity cell, survives reseed *)
ItemEdge      ::= "on:" ("enter"|"move"|"exit") "=" "{" Expr "}"     [proposed]
```

### Schema-body field annotations (decorator-position)

| Annotation | Status | Meaning |
|---|---|---|
| `@pk` | [proposed] | primary key |
| `@identity` | [proposed] | list-reconciliation key (A.5) |
| `@owner` | [proposed] | owner field for visibility classing |
| `@version("x")` | [proposed] | schema version for `evolves` chain |
| `@on_delete(cascade)` | [proposed] | edge cascade policy |
| `@guard(expr)` | [proposed] | transition precondition |
| `@authority(server-only)` | [proposed] | transition authority |
| `@visible(self \| "class")` | [proposed] | viewer-indexed presence |
| `@msg(str)` / `@async(fn)` | [proposed] | `where`-clause diagnostics / async refinement |

### Notes on existing-surface verification

- `signal`, `derived`, `effect`, `source`, `when`, `arena`, `memo`, `defer`, `schema`, `match`, `pure`, `para`/`parallel`, `is`, `every` are the keyword catalog confirmed in `src/language-surface.ts`; `Ok`/`Err`/`Some`/`None` and `_` are the LSP-allowlisted expression-position tokens.
- `match` non-literal patterns are **Partial** (literal-only today) per the keyword catalog and project memory.
- `sync`/`synced` are **current** but **READ-only**; the write path is `[proposed]` (cited in `[→ ch:data-sync-and-authority]` and `[→ ch:modules-projections-and-build]` for the wire codec).
- Operator precedence and the lexical-disambiguation rules (`..` vs `Nd` vs leading-dot, statement-position keyword detection) are normative in `[→ ch:lexical-and-expression-syntax]`; this appendix lists tokens, not precedence.

