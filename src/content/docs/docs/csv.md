---
title: para:csv
description: Streaming RFC 4180 CSV parser with two output modes — row objects and per-column TypedArrays.
---

```ts
import csv from "para:csv";
```

Two output modes:

- **`parseCsv(input, opts?)`** — async iterator of row objects (or string arrays). The classical shape; works for everything.
- **`parseColumns(input, { schema, ... })`** — Promise of per-column `TypedArray` buffers. Numeric data lands in compute-ready memory with no per-row Object allocation and no per-cell boxed `Number`. The thing the JS ecosystem was missing between row-objects libs and DuckDB-WASM.

Both are state machines over UTF-8 bytes; the row-iterator path never materializes the full file. The columnar path materializes the columns (it has to — the result IS the materialization), but each column ends as one tight `TypedArray` rather than 1M boxed values.

## `parseColumns(input, { schema, headers?, delimiter?, quote? })`

```ts
const cols = await csv.parseColumns(Bun.file("./sensors.csv"), {
  schema: { ts: "f64", temp: "f32", sensorId: "i32", label: "string" },
});
// cols.ts        is a Float64Array
// cols.temp      is a Float32Array
// cols.sensorId  is an Int32Array
// cols.label     is a string[]
```

**`schema`** maps each column name to a type:

| `schema` value | Output type |
| --- | --- |
| `"f32"` | `Float32Array` |
| `"f64"` | `Float64Array` |
| `"i8"` / `"u8"` | `Int8Array` / `Uint8Array` |
| `"i16"` / `"u16"` | `Int16Array` / `Uint16Array` |
| `"i32"` / `"u32"` | `Int32Array` / `Uint32Array` |
| `"string"` | `string[]` (TypedArrays can't hold strings) |

**`headers`** — `true` (default) treats the first row as headers and matches schema keys against header cell names. `false` maps schema keys to column indices in declaration order. Or pass an explicit array of header names to skip the lookup.

All of `parseCsv`'s dialect options apply: `delimiter`, `quote`, `escape`, `comment`, `trim`, `skipEmptyLines`. UTF-8 BOM is stripped automatically.

Empty / missing numeric cells become `NaN` for floats, `0` for ints. The result objects share no backing buffers with the input.

### Why columnar?

Most CSV libraries return `Array<{col1, col2}>` row objects. Each row is a JS Object (~56-byte header) plus a boxed `Number` for each numeric cell — ~24 bytes per number. For a 1M-row, 4-numeric-column CSV that's ~120 MB of boxing overhead before you've done any actual work.

`parseColumns` writes straight into `TypedArray` buffers (one per column), grows them exponentially as rows arrive, and tight-fits the result at end-of-stream. For a 200K-row × 4-numeric-column CSV: 1.4× faster than the row-objects path on this codebase, and the result is 3 MB of contiguous bytes — ready to hand to `@para/simd`, `@para/arrow.fromColumns()`, GPU upload, or any other consumer that expects packed numeric data.

### Composing with `@para/simd`

```ts
import csv from "para:csv";
import { sum, mean } from "para:simd";

const cols = await csv.parseColumns("./sensors.csv", {
  schema: { temperature: "f32", humidity: "f32" },
});
const meanTemp = sum(cols.temperature) / cols.temperature.length;
```

## `parseBatches(input, { schema, batchSize?, ... })`

Async iterator over fixed-size columnar chunks. Lets a caller process arbitrarily large CSVs in O(N) time and O(`batchSize`) memory without materializing the full column buffers. Default `batchSize` is 8192 rows.

```ts
for await (const batch of csv.parseBatches(Bun.file("./big.csv"), {
  schema: { temp: "f32", ts: "f64" },
  batchSize: 8192,
})) {
  // batch.temp is a Float32Array of up to 8192 rows
  // batch.ts is a Float64Array of up to 8192 rows
  // process batch — feed to @para/simd, append to an Arrow stream, etc.
}
```

The final batch is tight-fit to the actual remaining row count; full-size batches share their backing buffers with the typed-array result.

## `reduceColumns(input, { schema, reducers, ... })`

Single-pass reduction over CSV columns — never materializes the data at all. Streaming aggregates per column with O(1) memory per column regardless of input size.

```ts
const stats = await csv.reduceColumns(Bun.file("./big.csv"), {
  schema: { temp: "f32", humidity: "f32", sensor: "string" },
  reducers: {
    temp: ["count", "sum", "min", "max", "mean", "stddev"],
    humidity: ["mean"],
    sensor: ["count"],
  },
});
// stats.temp = { count, sum, min, max, mean, stddev }
// stats.humidity = { mean }
// stats.sensor = { count }
```

Available reducers: `count`, `sum`, `min`, `max`, `mean`, `variance`, `stddev`. Numeric reductions skip `NaN` cells. `variance` and `stddev` use Welford's online algorithm — numerically stable even at billions of rows. String columns can only meaningfully be `count`-reduced.

## `parseCsv(input, opts?)`

The classical async iterator path. Returns row objects (or string arrays with `header: false`). The parser is a state machine over UTF-8 bytes; it never materializes the full file in memory regardless of size.

`input` can be:

- `Bun.BunFile` (recommended for files on disk).
- `ReadableStream<Uint8Array>` or `AsyncIterable<Uint8Array>` (for fetched content, pipes, sockets).
- `Uint8Array` or `string` (for in-memory).

```ts
import csv from "para:csv";

for await (const row of csv.parseCsv(Bun.file("data.csv"), { header: true })) {
  process(row.id, row.name, row.score);
}
```

| Option | Default | Description |
| --- | --- | --- |
| `headers` | `true` | When `true`, the first row is the column names; subsequent rows are emitted as objects keyed by column. When `false`, rows are `string[]`. Pass an explicit `string[]` to use them as headers and treat every input row as data. |
| `delimiter` | `","` | Single-character cell separator. Pass `""` to auto-detect from the first non-comment line — the lexer counts `,` `\t` `;` `|` outside quoted regions and picks the winner (comma on ties). |
| `quote` | `"\""` | Single-character quote that wraps cells with embedded delimiters / newlines. |
| `escape` | same as `quote` | RFC 4180 doubles the quote (`""`) to escape. Set to `"\\"` for backslash-escape dialects. When `escape !== quote` the parser stops treating `""` as an escape. |
| `comment` | `""` (off) | If set, lines starting with this character (when no field has been opened yet) are skipped entirely. |
| `trim` | `false` | Strip leading and trailing whitespace from each cell. Quoted cells are preserved verbatim — quoting exists *to* keep their whitespace. |
| `skipEmptyLines` | `true` | Drop wholly-blank rows. With `trim: true`, all-whitespace rows count as blank. Set `false` to surface them. |
| `typeInference` | `true` | Per-cell type inference: numeric → `number`, `"true"` / `"false"` → `boolean`, empty → `null`. Plain strings pass through. Disabled automatically without `headers`. |
| `skipLines` | `0` | Skip this many leading rows before header detection. |
| `maxRows` | `Infinity` | Cap the number of data rows yielded. The header row does not count. Useful for previews. |
| `transformHeader` | none | `(header, index) => string`. Maps each header cell before it becomes the object key (or, on the columnar paths, the schema-lookup name). Common use: normalize case so the CSV's `"First Name"` matches a `first_name` schema key. |
| `transform` | none | `(value, column) => string`. Maps each cell value before type inference. `column` is the header name when `headers` is set, otherwise the column index. `parseCsv` only — the columnar paths write straight into TypedArrays where a string→string mapping doesn't fit. |
| `parallel` | `false` | See [Parallel mode](#parallel-mode) below. |

A leading UTF-8 BOM (U+FEFF) is stripped from the first chunk automatically; you do not need to handle it. Without `headers`, every row is an array of strings (no inference).

## Parallel mode

`parallel: true` chunks the input across [`para:parallel`](/docs/parallel/)'s worker pool when the input has no quoted cells (the byte-boundary heuristic doesn't work otherwise). It runs the parse off the main thread.

```ts
for await (const row of csv.parseCsv(Bun.file("data.csv"), { header: true, parallel: true })) {
  // row processed off main thread
}
```

This is **not a per-file speedup**. The serial state machine is already memory-bandwidth-bound, and the parallel path's materialize-and-fork overhead grows with input size. Sweep on a 16-core x86 release build:

| Fixture | Serial (med) | Parallel (med) | Speedup |
| --- | --- | --- | --- |
| 5 MB · 128k rows | 152 ms | 129 ms | 1.18× |
| 50 MB · 1.25M rows | 1446 ms | 1528 ms | 0.95× |
| 200 MB · 4.92M rows | 5892 ms | 6363 ms | 0.93× |

Use `parallel: true` to keep the event loop responsive while parsing (parsing N files concurrently does scale across cores), not because you expect bigger files to go faster. `bench/parabun-csv-parallel/` reproduces the numbers.

## Bridging to columnar

`para:csv` rows pair naturally with [`para:arrow`](/docs/arrow/)'s `fromRows`:

```ts
import csv from "para:csv";
import arrow from "para:arrow";

const rows: any[] = [];
for await (const row of csv.parseCsv(Bun.file("data.csv"), { header: true })) rows.push(row);
const tbl = arrow.fromRows(rows);

arrow.mean(tbl.column("score"));
```

For very large CSVs, batch the bridge — call `arrow.fromRows` per N rows instead of materializing them all first.

## `stringify(rows, opts?)`

The inverse of `parseCsv` — take rows in memory and emit RFC 4180 CSV text.

```ts
import csv from "para:csv";

const text = csv.stringify([
  { id: 1, name: "Ada, Lovelace", note: 'said "hi"' },
  { id: 2, name: "Grace",         note: "ok" },
]);
// id,name,note
// 1,"Ada, Lovelace","said ""hi"""
// 2,Grace,ok
```

`rows` can be either an array of objects (header row inferred from the union of keys, in first-seen order) or an array of arrays (no header row unless you pass `headers` explicitly).

| Option | Default | Description |
| --- | --- | --- |
| `delimiter` | `","` | Field delimiter. |
| `quote` | `"\""` | Quote character. |
| `escape` | same as `quote` | Doubled-quote (`""`) by default; set to `"\\"` for backslash-escape output. |
| `newline` | `"\r\n"` | Row terminator. CRLF is what Excel expects; pass `"\n"` for Unix-only readers. |
| `headers` | `true` for object rows / `false` for array rows | `true` emits the inferred header row, `false` skips it, or pass `string[]` to specify exactly which columns and in what order. |
| `bom` | `false` | Prefix the output with a UTF-8 BOM (U+FEFF) for tools that need it (mainly Excel for non-ASCII text). |

Cells are quoted only when they contain the delimiter, the quote character, the escape character (if distinct), or a CR/LF. `null` / `undefined` round-trip as empty cells. `Date` values stringify as ISO 8601.

```ts
// Round-trip preserves the data.
const text = csv.stringify(rows);
const back = [];
for await (const r of csv.parseCsv(text, { headers: true })) back.push(r);
```

## Limits

- Multi-byte delimiters / quotes aren't supported. RFC 4180 specifies single-byte for both.
- Parallel mode requires the input has no quoted cells (otherwise byte-boundary chunking can split a quoted region) and a default dialect (no `comment`, `trim`, or distinct `escape`).
- Type inference is per-cell — there's no whole-column type promotion. If column `score` has mostly numbers and one `"N/A"`, you get a mix of `number` and `string`; coerce on your end if that's a problem.
