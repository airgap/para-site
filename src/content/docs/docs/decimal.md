---
title: "@lyku/para-decimal"
description: Exact-decimal arithmetic backing the Nd literal — BigInt-backed coef × 10^exp, so 0.1 + 0.2 is exactly 0.3.
---

```parabun
const rate = 0.0825d;                 // the literal → __paraDec("0.0825")
const tax = subtotal.times(rate);     // exact — no float drift, ever
```

Self-contained exact-decimal arithmetic — the runtime behind the
[`Nd` literal](/docs/language/#nd-decimal-literals). A `Decimal` is
`{ coef: bigint, exp: number }`, so **every operation that doesn't divide
is exact**: `0.1d.plus(0.2d)` is exactly `0.3`, not
`0.30000000000000004`.

## API

JS has no operator overloading, so arithmetic is explicit method calls —
the visible seam is the point (you always know which numbers are exact):

```ts
a.plus(b)   a.minus(b)   a.times(b)   a.dividedBy(b, { precision, roundingMode }?)
a.eq(b)     a.lt(b)      a.lte(b)     a.gt(b)     a.gte(b)
a.toString()          // exact decimal string
a.toNumber()          // lossy escape hatch, explicit by design
```

Division is the one operation that can't stay exact (`1/3`); it defaults
to 20 significant digits, rounding half-even, both overridable. Everything else — sums, ledgers,
tax lines, aggregation loops — stays exact at any magnitude, because the
coefficient is a `bigint`.

## When to reach for it directly

The `Nd` literal covers the common case (money, rates, measured
quantities in `.pts`/`.pui` code). Import the package directly when you
need to *construct* decimals from strings at runtime (user input, CSV
columns, DB `numeric` values) rather than from literals — same type,
same methods.

&gt; **Availability.** The literal lowering ships with the language today
&gt; (ParaBun / para-transpile emit it, and the runtime carries the
&gt; implementation). The standalone npm release of `@lyku/para-decimal` is
&gt; pending the workspace split — until then, direct-import usage is
&gt; in-repo only.
