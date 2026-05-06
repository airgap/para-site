---
title: Architecture
description: How Para and Parabun fit together — what the @para/* libraries give you, what the parabun:* runtime modules add, and which ones you reach for when.
---

Para is two products that work together.

- **`@para/*`** — eight cross-runtime libraries on npm. Pure JS / Wasm, no native dependencies. They run anywhere JS does — Node, Deno, Bun, browsers, Parabun.
- **`parabun:*`** — twelve native runtime modules that ship with Parabun. They wrap codec stacks, GPU compute, and hardware I/O — work that pure JS can't match.

Both share the same import shape, so you don't have to think about which side you're on:

```ts
import signals from "@para/signals";   // anywhere
import image   from "parabun:image";   // Parabun
```

When you're on Parabun, `@para/*` libraries quietly use their `parabun:*` counterparts under the hood — where one exists. Same import, faster impl, no code change to opt in.

## What's in the box

Twenty modules. `✓` means it's available on that side; `—` means it isn't.

| Module | `@para/*` | `parabun:*` | What it does |
|---|:---:|:---:|---|
| signals | ✓ | — | Reactive state — Signal / Computed / Effect |
| parallel | ✓ | planned | Worker pool — pmap / preduce / psort + Mutex / Semaphore |
| arena | ✓ | ✓ | Buffer pool + JSC-GC-deferring `scope()` |
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
- **— in `@para/*`** → Parabun-only. System codecs, GPU, and kernel drivers don't have a credible browser/Node equivalent.
- **— in `parabun:*`** → pure JS is already as fast as native here, so we don't ship one.
- **`planned`** → on the roadmap. The `@para/*` library works today; the native fast path is tracked but not yet shipped.

Two more npm packages back Para language features:

| Package | Backs which feature |
|---|---|
| `@para/pipeline` | `\|>` operator runtime + affine-chain `compile()` |
| `@para/decimal` | Exact-decimal arithmetic for `0.1d` literals |

## What you can build

These modules compose. A few realistic shapes:

- **Streaming ETL** — `@para/csv` + `@para/arrow` parse a multi-GB CSV and write per-country Parquet without loading the file into memory. Works in Node today; faster on Parabun once the native CSV parser lands.
- **Voice assistants** — `parabun:speech` + `parabun:llm` + `parabun:audio` give you a wake-word → STT → LLM → TTS loop in 30 lines. Parabun-only because the engines need GPU.
- **IoT control loops** — `parabun:gpio` + `@para/signals` make a reactive sensor → threshold → relay loop on a Raspberry Pi. The same `@para/signals` powers the React dashboard you serve from the device.
- **In-browser data tools** — `@para/arrow` + `@para/parallel` slice a Parquet file and run worker-pooled aggregates on the user's machine, no server round-trip.

See [Examples](/docs/examples/) for runnable code.

## Why two namespaces

Two namespaces, two distribution stories:

- `@para/*` ships on npm and is meant to be portable. You can install one of them in a Node project that's never heard of Parabun, and everything works.
- `parabun:*` ships inside the Parabun binary and links against system libraries (codecs, CUDA, V4L2, SPI). It can't be `npm install`ed because most environments don't have what it needs.

Keeping them in separate namespaces means a developer reading code can tell at a glance which side an import is on — `parabun:` is the "you need Parabun for this" tell, `@para/` is the "this works anywhere" tell. The cross-runtime promise stays unambiguous.

## Next steps

- [Install the libraries](/docs/install-libs/) — `npm install @para/<package>`.
- [Install Parabun](/docs/install-runtime/) — single curl install, includes everything.
- [Examples](/docs/examples/) — runnable code across frontend / backend / edge.
- Module deep-dives: [`@para/signals`](/docs/signals/), [`@para/csv`](/docs/csv/), [`parabun:llm`](/docs/llm/), [`parabun:gpu`](/docs/gpu/), and the [full list in the sidebar](/docs/).
