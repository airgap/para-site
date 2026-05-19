---
title: Para
description: ParaBun's optional TypeScript dialect. Parse-time desugarings — output is standard JavaScript.
---

**Para** is the language ParaBun ships alongside its runtime. Files ending in `.pts` (or `.ptsx`) are parsed with the extensions described below — purity, error chaining, pipelines, ranges, reactivity, edge-triggered handlers, JSON Schema data shapes, pattern matching — and lower to standard JS at parse time. Nothing in the runtime depends on the syntax. Plain `.ts` / `.tsx` files behave exactly as in upstream Bun.

The same extensions also work over plain JavaScript in `.pjs` / `.pjsx` files. We don't lead with that path — `.pts` is the canonical Para surface — but it's there if you need it.

GitHub's TextMate grammars don't recognize `.pts` — install the [editor extension](/docs/install-runtime/#editor-extension) for syntax highlighting + LSP support.

## `pure` and `memo`

A `pure` function is rejected at parse time if the body mutates an outer variable, reads `this`, or calls a known-impure global. Prefix `pure` with `memo` — or drop `pure` entirely and write `memo` — and the result is cached by argument identity:

- 0-arg: singleton (computed once, returned forever).
- 1-arg: `Map<arg, result>` lookup.
- multi-arg: nested `Map` chain keyed by each argument in turn.

Recursive self-references route through the outer wrapper, so `fib(20)` runs the body 21 times instead of 21,891. Async memoization dedupes concurrent in-flight calls and evicts on reject.

```parabun
// declarator form — `memo` implies pure + function
memo fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// arrow form — same thing as an expression prefix
const normalize = memo (s: string) => s.trim().toLowerCase();

// async dedupes concurrent in-flight calls, evicts on reject
memo async fetchProfile(id: string) { return await db.users.get(id); }
```

## `signal`, `effect`, `~>`, `->`, `when`

`signal NAME = <rhs>` declares a reactive cell. Bare reads desugar to `.get()`, assignments to `.set()`. If the RHS references another in-scope signal, the binding auto-promotes to a read-only `derived()`. `effect { ... }` tracks every signal it reads and re-runs on change.

`derived NAME = <rhs>` is the explicit form — useful when you want the keyword to telegraph "this is read-only" instead of relying on the auto-promote heuristic. Lowers identically to a `derived()` call with the same bare-read rewrite. Cells (writable) get `signal`; deriveds (read-only) can be `signal` (auto) or `derived` (explicit) — pick `derived` when clarity matters more than brevity.

`A ~> B` is a reactive **assignment** binding. It desugars to `effect(() => { B = A; })`, so `B` stays in step with `A` and whatever signals `A` reads from.

`A -> fn` is a reactive **call** binding — the call-sink complement to `~>`. It desugars to `effect(() => { fn(A); })`, so `fn` is called with the latest value of `A` whenever its tracked deps change. RHS must be a callable target (identifier, `obj.method`, or `arr[i]`) — bare calls, literals, and arrows are rejected.

`A ~> B when C` (and `A -> fn when C`) adds a guard. The desugar wraps the body in `if (C)` — `C` is read inside the effect so signal reads in the predicate are tracked too. Flipping `C` re-fires the effect, the body re-evaluates the guard, and only emits when it passes.

`when EXPR { BODY }` is a statement-level **edge-triggered** block. It fires `BODY` once each time `EXPR` transitions false → true. The dual `when not EXPR { BODY }` fires on the true → false edge. Both desugar to `signals.when(() => EXPR, () => { BODY })` — the `not` form pushes the negation into the predicate (`() => !(EXPR)`), since the falling edge is just the rising edge of the inverse. Distinct from suffix `when`: position disambiguates — suffix is every-truthy guard, block is edge-triggered.

`when EXPR start { BODY }` (and `when not EXPR start { BODY }`) is the same shape but with one extra fire: if the predicate is **already truthy at registration**, `BODY` runs once immediately. The trailing `start` modifier is the visible opt-in for that semantic — silent typo into the wrong direction is what the explicit modifier prevents. Useful for "the dangerous state is the noteworthy one" alerts where you don't want to silently miss a boot already in the bad state: bare `when tankEmpty` stays quiet on a startup that begins with the tank empty; `when tankEmpty start` notifies right away. Lowers to `signals.whenStart(() => EXPR, () => { BODY })`. Default `when` is right for "user pressed button" / "page loaded" semantics (don't fake the event at boot); the trailing `start` is right for safety/health alerts.

```parabun
signal  count   = 0;
derived doubled = count * 2;   // explicit form — same lowering as auto-promote

effect { console.log(count, doubled); }

count++;                      // effect re-runs: 1, 2

// reactive ASSIGNMENT — el.innerHTML mirrors count
count ~> el.innerHTML;

// reactive CALL — process.stdout.write is invoked on every change
`count=${count}\n` -> process.stdout.write;

// guarded bind — only updates while `enabled` is truthy
signal enabled = true;
doubled ~> el.innerHTML when enabled;
enabled = false;              // future doubled changes don't reach el

// edge-triggered handler — fires once per false→true transition.
signal motionPresent = false;
when motionPresent && enabled { console.log("greet"); }
when not enabled { console.log("disabled"); }

// Trailing `start` modifier ALSO fires once at registration if the
// predicate is already truthy. Use it for safety alerts where
// missing a boot-already-bad state would be wrong.
signal tankEmpty = true;
when tankEmpty start { console.error("tank EMPTY"); }   // fires immediately

// paired form — bare `when stop { ... }` adjacent to a `when` block
// (with or without `start`) shares its predicate and fires the
// inverse edge. `stop` pairs with `start` symmetrically: fire when
// the predicate starts being true / stops being true. The paired
// arm is ALWAYS strict-edge — so a tank-empty alert fires on
// boot-already-empty (because of `start`) but the recovery doesn't
// fake a fire on healthy boot.
signal connected = false;
when connected { showOnlineBanner(); }
when stop      { showOfflineBanner(); }

signal tankEmpty = true;
when tankEmpty start { console.error("EMPTY"); }     // boot-true → fires
when stop            { console.log("recovered"); }   // strict-edge — fires only on actual recovery
```

## `|>`, `..>`, `..!`, `..&`, `..` / `..=`

- `x |> f` is `f(x)`. `pure` functions threaded through `|>` are inlined at parse time — no call overhead.
- `..>` is `.then` in suffix position.
- `..!` is `.catch` in suffix position.
- `..&` is `.finally` in suffix position.
- `a..b` is an exclusive integer range; `a..=b` is inclusive.

The three Promise operators (`..>`, `..!`, `..&`) cover the whole `Promise.prototype` chain surface symmetrically — same precedence, same handler shape, composable in any order. Bare arrow handlers compose without parens: each arrow body terminates at the next chain operator. If you need a chain operator *inside* an arrow body, parens force the nesting — `..! err => (recover() ..! finalFallback)`. `await` binds tighter than the dotted operators, so `await p ..> f` parses as `(await p).then(f)`; wrap with `await (p ..> f)` to await the whole chain.

A leading `.` in `..>` / `..!` handler position is sugar for "method/property on the resolved value": `..> .json()` desugars to `..> (_) => _.json()`. Chains of access work too — `..> .users[0].id`. The sugar doesn't apply to `..&` since `.finally` callbacks receive no value.

```parabun
pure function sq(x: number) { return x * x; }

const result = 5 |> sq |> sq;   // 625 — both calls inlined

const data = await (
  fetch("/api")
    ..> .json()                   // .then  — call .json() on the response
    ..! .message                  // .catch — extract error message
    ..& () => spinner.hide()      // .finally — runs always
);

for (const i of 0..=9) emit(i);      // [0..9]
```

## `defer` and `arena`

`defer EXPR` schedules `EXPR` to run when the enclosing block exits — return, throw, or fall-through. Multiple defers in a block dispose in LIFO order. `defer await EXPR` inside an `async` function awaits the cleanup.

`arena { ... }` runs the block with the GC paused, then frees everything allocated inside on exit. Useful for tight numeric loops with short-lived intermediate allocations.

```parabun
function readConfig(path: string) {
  const fd = fs.openSync(path);
  defer fs.closeSync(fd);              // runs on every exit path
  return JSON.parse(fs.readFileSync(fd));
}

arena {
  const buf = new Float32Array(1_000_000);
  // ...numeric work...
}                                       // buf freed here, no GC pressure
```

## `parallel`

`parallel` is the answer to `const [a, b, c, d, e] = await Promise.all([f, g, h, i, j])` — the positional-array shape where reordering one side without the other is a silent bug, and where every long name effectively appears twice.

Two forms, picked by what you need:

**Statement form** — names appear exactly once, hoisted into scope:

```parabun
parallel let user     = fetchUser(id),
             posts    = fetchPosts(id),
             comments = fetchComments(id);
// names now in scope; all three RHSes ran concurrently
```

Lowers to `const [user, posts, comments] = await Promise.all([fetchUser(id), fetchPosts(id), fetchComments(id)]);`. `parallel const` works the same way; pick whichever reads better.

The statement form composes per-decl with `..!` / `..&` / `..>` for **per-item** error handling — each binding catches its own rejection independently:

```parabun
parallel let user     = fetchUser(id)     ..! defaultUser,
             posts    = fetchPosts(id)    ..! [],
             comments = fetchComments(id) ..! [];
```

**Expression form** — returns a `Promise` of an object with the names mapped to resolved values. Use when you need the bag itself (returning, passing inline, chaining `..!` over the **whole batch**):

```parabun
const bundle = await parallel { user: fetchUser(id), posts: fetchPosts(id) };

return await parallel { metrics: fetchMetrics(), session: fetchSession() };

const data = await parallel { user: …, posts: … } ..! err => fallbackBundle;
```

Both forms use `Promise.all` semantics — fail-fast on first rejection. For `allSettled`-flavored independence, use the statement form's per-decl `..!` instead.

## `Nd` decimal literals

`0.1 + 0.2 !== 0.3` keeps biting people. Para's `Nd` literal suffix produces a `Decimal` value with exact arithmetic — `coef * 10^exp` representation, BigInt internally, no floating-point roundoff:

```parabun
import { Decimal } from "@para/decimal";

0.1d.plus(0.2d).eq(0.3d);                              // true
0.1d.times(3d).eq(0.3d);                               // true
1d.dividedBy(3d, { precision: 20 }).toString();        // "0.33333333333333333333"
100d.dividedBy(8d).toString();                         // "12.5" — exact

const tax   = price.times(0.0825d);
const total = price.plus(tax);
```

Each `Nd` literal lowers to `__paraDec("N")` — using the **string** source, never roundtripping through float. JS doesn't allow operator overloading, so arithmetic is explicit method calls: `.plus`, `.minus`, `.times`, `.dividedBy` (alias `.div`), `.eq`, `.lt`, `.gt`, `.lte`, `.gte`, `.neg`, `.abs`. Conversions: `.toNumber()`, `.toString()`, `.toBigInt()`. Division takes `{ precision, roundingMode }` — seven `RoundingMode` variants (default `HALF_EVEN`); division-by-zero throws.

The `@para/decimal` package is self-contained — no `decimal.js` / `big.js` dep — and ships ~300 lines of TypeScript.

## `schema` and `match`

`schema NAME = body` declares a JSON Schema 2020-12 binding with a runtime validator and field-navigation accessors. The same keyword works as an inline expression literal — `schema { ... }` mints a decorated value at any value position:

```parabun
schema User = {
  type: 'object',
  properties: {
    id:   { type: 'bigint' },
    name: { type: 'string', minLength: 1, maxLength: 50 },
  },
  required: ['id', 'name'],
};

User.parse({ id: 1n, name: 'Alice' });   // { tag: 'Ok', value: ... }
User.id.type;                              // 'bigint'   — schema fields navigable
User.name.maxLength;                       // 50

// Inline at value position — same shape, no name binding.
const ep = {
  request:  schema { type: 'bigint' },
  response: User,
  authenticated: true,
};
ep.request.parse(123n).tag;                // 'Ok'
```

Both forms desugar to `__paraFromSchema(...)` and produce: `parse(v) → Result<T, string>`, `is(v) → boolean`, `schema` (literal back-ref), and per-field accessors. Composes naturally inside lockstep `satisfies TsonHandlerModel` blocks — endpoint records that hold `schema { ... }` slots type-check against the JSON Schema vocabulary while gaining runtime validators for free.

Para extends the JSON Schema `type` field with `bigint`, `varchar`, `text`, `char`, `timestamptz`, `snowflake`, `numeric`, `jsonb`, `enum`. Alt forms: `schema X from <expr>` ingests an existing schema (e.g. lockstep pg-models output); `schema X { id: int, name: str(1..=50) }` is the refinement-typed DSL.

`match` is pattern matching over the subject. Arms can be literal numbers / strings / booleans, `Ok(x)`/`Err(e)`/`Some(x)`/`None` Result/Option ctors, identifier-bind, `_` wildcard, or OR-alternation (`a | b | c`):

```parabun
const status = match res {
  Ok(user)  => `welcome ${user.name}`,
  Err(404)  => 'not found',
  Err(_)    => 'something broke',
};
```

Lowers to `switch` (when arms are all literals or all Result/Option tags) or an IIFE-wrapped ternary chain otherwise. Subject is evaluated once.

Companion: `Ok(x)` / `Err(e)` / `Some(x)` / `None` are constructor sugar for `{ tag: 'Ok', value: x }` etc.; `expr is Type` is a runtime type-guard that lowers to `Type.parse(expr).tag === 'Ok'` and narrows `expr` inside the `if` body via an injected typed predicate; `function f(req:: Type)` injects a parse-and-throw at entry.

The same `is` keyword, with a **string/number literal union** on the right (instead of a capitalized `schema` name), is set-membership sugar:

```ts
order.status is 'open' | 'pending' | 'closed'   // → (order.status === 'open' || order.status === 'pending' || order.status === 'closed')
code is 200 | 404 | 500                          // → (code === 200 || code === 404 || code === 500)
status is not 'open' | 'closed'                  // → (status !== 'open' && status !== 'closed')   (De Morgan)
```

It lowers to the strict-equality `||` chain (`is not` → the `!==`/`&&` De-Morgan chain) — the *exact* form `match`'s all-literal arm emits — so TS narrows the operand precisely as a hand-written chain would, and there's none of the per-evaluation array allocation/scan of `['open','pending','closed'].includes(order.status)`. The literal kind disambiguates from the schema guard (capitalized identifier → `schema`; quoted/numeric literal → membership; a lowercase identifier leaves `is` as a plain identifier). The operand must be a simple expression — an identifier or property path — so it is evaluated once and narrowing is preserved; bind a call's result to a variable first. String and numeric literals only.

## Diagnostics

The LSP carries arity-based hints: *"could be memo"* / *"memo probably not worth it"* on free functions, full purity diagnostics on `pure` bodies, and JSON-Schema-keyword validation on `schema X = body` blocks (with did-you-mean suggestions for typo'd keys). The full grammar lives in [`LLMs.md`](https://github.com/airgap/parabun/blob/main/LLMs.md#language-extensions).
