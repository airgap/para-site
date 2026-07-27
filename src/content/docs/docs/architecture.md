---
title: Architecture
description: Para's two namespaces — @lyku/para-* cross-runtime npm libraries vs parabun:* native modules — and how Lang and Runtime fit on top of them.
---

Para's two products ([Lang and Runtime](/docs/)) ship code across two npm-vs-binary namespaces. The split tells a reader at a glance whether an import is portable or needs the Runtime:

- **`@lyku/para-*`** — a dozen cross-runtime libraries on npm. Pure JS / Wasm, no native dependencies. They run anywhere JS does — Node, Deno, Bun, browsers, ParaBun. This is most of Lang's runtime surface.
- **`parabun:*`** — twelve native modules linked into the ParaBun binary. They wrap codec stacks, GPU compute, and hardware I/O — work that pure JS can't match. Only available when running on ParaBun.

Both share the same import shape, so you don't have to think about which side you're on:

```ts
import signals from "@lyku/para-signals";   // anywhere
import image   from "parabun:image";   // Parabun
```

When you're on Parabun, `@lyku/para-*` libraries quietly use their `parabun:*` counterparts under the hood — where one exists. Same import, faster impl, no code change to opt in.

## What's in the box

`parabun:*` modules are native, hardware-accelerated, and only available in the Parabun runtime. `@lyku/para-*` libraries are cross-runtime, available on npm, and automatically use their `parabun:*` counterpart when running on Parabun.

| Module | `@lyku/para-*` | `parabun:*` | What it does |
|---|:---:|:---:|---|
| schema | ✓ | — | The spine's type side — brand types, `Infer`, `FromDecl` ([docs](/docs/schema/)) |
| signals | ✓ | — | Reactive state — Signal / Computed / Effect |
| sync | ✓ | — | Server-authoritative replicas — parse-gated, sequence-reconciled ([docs](/docs/sync/)) |
| kit | ✓ | — | Fullstack sync projection — emit + host + SSE bridge ([docs](/docs/kit/)) |
| parallel | ✓ | planned | Worker pool — pmap / preduce / psort + Mutex / Semaphore |
| arena | ✓ | ✓ | Buffer pool + JSC-GC-deferring `scope()` |
| lifecycle | ✓ | — | Process-state coordination — `keepAlive` with SIGINT/SIGTERM + onShutdown hook |
| simd | ✓ | planned | SIMD over typed arrays — sum, dot, matVec, topK |
| csv | ✓ | planned | RFC 4180 parse / stringify |
| arrow | ✓ | planned | In-memory Arrow + IPC + Parquet |
| rtp | ✓ | — | RFC 3550 RTP packets + jitter buffer |
| mcp | ✓ | — | Model Context Protocol client (stdio + WebSocket) |
| image | — | ✓ | JPEG / PNG / WebP / AVIF / HEIC / JPEG-XL — decode, encode, filters |
| video | — | ✓ | H.264 / H.265 / VP9 / AV1 — decode, encode, thumbnails, extract audio |
| audio | — | ✓ | WAV / MP3 / FLAC / AAC / OGG / Opus + ALSA capture / playback |
| llm | — | ✓ | Llama / Mistral / Whisper inference on CUDA + Metal |
| vision | — | ✓ | Frame analysis — motion, YOLO, OCR, ONNX runtime |
| speech | — | ✓ | Voice activity detection + Whisper STT + Piper TTS |
| assistant | — | ✓ | Turn-taking voice agent over speech + llm |
| gpu | — | ✓ | CUDA + Metal compute — matVec, conv2D, scan, reduce, histogram |
| gpio | — | ✓ | Linux GPIO — digital in/out, edge events |
| i2c | — | ✓ | Linux I²C with SMBus convenience |
| spi | — | ✓ | Linux SPI with multi-segment transfers |
| camera | — | ✓ | V4L2 frame capture |

How to read it at a glance:

- **Both columns filled** → portable library that gets faster on Parabun.
- **— in `@lyku/para-*`** → Parabun-only. System codecs, GPU, and kernel drivers don't have a credible browser/Node equivalent.
- **— in `parabun:*`** → pure JS is already as fast as native here, so we don't ship one.
- **`planned`** → on the roadmap. The `@lyku/para-*` library works today; the native fast path is tracked but not yet shipped.

More npm packages back Para language and tooling features:

| Package | Backs which feature |
|---|---|
| `@lyku/para-pipeline` | `\|>` operator runtime + affine-chain `compile()` |
| `@lyku/para-decimal` | Exact-decimal arithmetic for `0.1d` literals ([docs](/docs/decimal/)) |
| `@lyku/para-extract` | The `ts<import('./x').T>` checker-driven schema extractor ([docs](/docs/schema/#the-ts-extractor--tsimportxt)) |
| `@lyku/para-preprocess` | The `.pui` component preprocessor ([docs](/docs/pui/)) |
| `@lyku/para-check` | `pui-check` — batch type-checking for `.pui` ([docs](/docs/pui/#type-checking--pui-check)) |
| `@lyku/para-ui-native` | Native-reactive `.pui` adapters — parabun capability modules as `source` cells (pre-release) |

## What you can build

These modules compose. A few realistic shapes:

- **Streaming ETL** — `@lyku/para-csv` + `@lyku/para-arrow` parse a multi-GB CSV and write per-country Parquet without loading the file into memory. Works in Node today; faster on Parabun once the native CSV parser lands.
- **Voice assistants** — `parabun:speech` + `parabun:llm` + `parabun:audio` give you a wake-word → STT → LLM → TTS loop in 30 lines. Parabun-only because the engines need GPU.
- **IoT control loops** — `parabun:gpio` + `@lyku/para-signals` make a reactive sensor → threshold → relay loop on a Raspberry Pi. The same `@lyku/para-signals` powers the React dashboard you serve from the device.
- **In-browser data tools** — `@lyku/para-arrow` + `@lyku/para-parallel` slice a Parquet file and run worker-pooled aggregates on the user's machine, no server round-trip.

See [Examples](/docs/examples/) for runnable code.

## Why two namespaces

Two namespaces, two distribution stories:

- `@lyku/para-*` ships on npm and is meant to be portable. You can install one of them in a Node project that's never heard of Parabun, and everything works.
- `parabun:*` ships inside the Parabun binary and links against system libraries (codecs, CUDA, V4L2, SPI). It can't be `npm install`ed because most environments don't have what it needs.

Keeping them in separate namespaces means a developer reading code can tell at a glance which side an import is on — `parabun:` is the "you need Parabun for this" tell, `@lyku/para-` is the "this works anywhere" tell. The cross-runtime promise stays unambiguous.

## Next steps

- [Install the libraries](/docs/install-libs/) — `npm install @lyku/para-<package>`.
- [Install Parabun](/docs/install-runtime/) — single curl install, includes everything.
- [Examples](/docs/examples/) — runnable code across frontend / backend / edge.
- Module deep-dives: [`@lyku/para-signals`](/docs/signals/), [`@lyku/para-csv`](/docs/csv/), [`parabun:llm`](/docs/llm/), [`parabun:gpu`](/docs/gpu/), and the [full list in the sidebar](/docs/).
