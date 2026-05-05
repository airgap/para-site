---
title: Architecture — package layout
description: Two namespaces (parabun:* native modules, @para/* cross-runtime libraries), and which libraries route to which runtime modules when running on Parabun.
---

Para and Parabun ship code in two namespaces, each with a different distribution model and audience. This page is the reference for which package lives where and which packages depend on which.

## Two namespaces

| Namespace | What | Distribution | Where it runs |
|---|---|---|---|
| **`parabun:*`** | Native runtime modules. FFI to system libraries, GPU compute, hardware I/O, codec stacks. | Built into the Parabun binary. No npm publish. | Parabun runtime only — Linux / macOS / Windows. |
| **`@para/*`** | Cross-runtime libraries. Pure JS or Wasm. No native deps. | Published independently to npm. | Any JS runtime: Node, Deno, Bun, Parabun, browsers. |

The split is deliberate: `parabun:*` modules can't run elsewhere by design (they wrap `dlopen`'d codec libraries, V4L2 ioctls, CUDA kernels, etc.); `@para/*` libraries are built to be portable. Code that works in Node should keep working in Node, with Parabun as a perf-and-feature upgrade path — not a dependency.

## What lives where

### `parabun:*` — native, runtime-only (12)

| Module | What |
|---|---|
| `parabun:image` | JPEG / PNG / WebP / AVIF / HEIC / JPEG-XL decode + encode + filters |
| `parabun:video` | H.264 / H.265 / VP9 / AV1 decode + encode + thumbnail + extractAudio (ffmpeg) |
| `parabun:audio` | WAV / MP3 / FLAC / AAC / OGG / Opus + FFT + filters + ALSA capture/playback |
| `parabun:llm` | LLM inference (Llama / Mistral / Whisper) on CUDA + Metal; OpenAI-compatible serve |
| `parabun:vision` | Frame + motion + YOLO detect + tesseract OCR + tracker + ONNX runtime |
| `parabun:speech` | VAD-gated utterance segmentation + Whisper STT + Piper TTS |
| `parabun:assistant` | Bot harness composing speech + llm into a turn-taking conversational agent |
| `parabun:gpio` | Linux uAPI v2 GPIO — digital in/out, edge events |
| `parabun:i2c` | Linux i2c-dev with SMBus convenience methods |
| `parabun:spi` | Linux spidev with multi-segment transfers |
| `parabun:camera` | V4L2 frame capture |
| `parabun:gpu` | CUDA + Metal kernels; matVec / matmul / conv2D / scan / reduce / quantile / variance / argmin/max / histogram / custom MSL+CUDA |

### `@para/*` — cross-runtime libraries (8 + 2 auxiliary)

The eight canonical libraries:

| Package | What |
|---|---|
| `@para/signals` | Reactive state — Signal / Computed / Effect |
| `@para/parallel` | Worker-pool primitives — pmap / preduce / psort + Mutex / Semaphore |
| `@para/arena` | Buffer-pool free list + GC-deferring `scope()` (passthrough off-runtime) |
| `@para/simd` | SIMD primitives over typed arrays — sum / dot / matVec / topK / scalar+vector |
| `@para/csv` | RFC 4180 CSV parse / stringify with optional parallel-mode |
| `@para/arrow` | In-memory Arrow + Arrow IPC + Parquet |
| `@para/rtp` | RFC 3550 RTP packet pack/parse + jitter buffer |
| `@para/mcp` | Model Context Protocol client (stdio + WebSocket) |

Two auxiliary packages back Para language features (`|>` and `0.1d`) — present on npm, but not pitched as standalone libraries:

| Package | Backs which feature |
|---|---|
| `@para/pipeline` | `\|>` runtime helpers + affine-chain `compile()` |
| `@para/decimal` | Exact-decimal arithmetic for `0.1d` literals |

## Routing — `@para/*` → `parabun:*`

Several `@para/*` libraries can route to a `parabun:*` native fast path when running on Parabun. The library's public API is unchanged; the user writes `import "@para/csv"` once and gets best-available perf.

```ts
// inside @para/csv (paraphrased)
let impl;
try { impl = await import("parabun:csv"); }       // native, fastest
catch { impl = await import("./impl.ts"); }       // bundled JS, cross-runtime
export const { parseStream } = impl;
```

The native fast paths are **opt-in upgrades**, not requirements. If `parabun:csv` doesn't exist (yet, or because you're on Node), the bundled JS impl handles it.

## Module matrix

Every module on one axis, every module it can consume on the other. `●` = direct dependency. `○` = optional native fast-path routing (the library quietly uses the native impl when on Parabun, falls back to its own JS elsewhere). Empty = no relationship.

Read a row as "this module depends on…"; read a column as "this module is depended on by…". Column abbreviations: **sig** = signals, **par** = parallel, **are** = arena, **sim** = simd, **csv**, **arr** = arrow, **rtp**, **mcp**, **gpu**, **aud** = audio, **vid** = video, **img** = image, **vis** = vision, **llm**, **spe** = speech, **ass** = assistant, **gpi** = gpio, **i2c**, **spi**, **cam** = camera.

| | sig | par | are | sim | csv | arr | rtp | mcp | gpu | aud | vid | img | vis | llm | spe | ass | gpi | i2c | spi | cam |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **`@para/signals`**     |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/parallel`**    | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/arena`**       |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/simd`**        |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/csv`**         |   | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/arrow`**       |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/rtp`**         | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`@para/mcp`**         |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:gpu`**       | ● |   |   | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:audio`**     | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:video`**     |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:image`**     |   |   |   |   |   |   |   |   | ● |   | ● |   |   |   |   |   |   |   |   |   |
| **`parabun:vision`**    | ● |   |   |   |   |   |   |   | ● |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:llm`**       | ● |   |   |   |   |   |   |   | ● |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:speech`**    |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:assistant`** | ● |   |   |   |   |   |   | ● |   | ● |   |   |   | ● | ● |   |   |   |   |   |
| **`parabun:gpio`**      | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:i2c`**       | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:spi`**       | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **`parabun:camera`**    | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |

`parabun:speech` and `parabun:video` have no direct module deps — `speech` takes its STT/TTS engines as user-supplied parameters rather than importing them, and `video` only uses an internal ffmpeg helper module (no cross-module require). They appear "self-contained" in the matrix despite composing other modules at the user-API level.

Optional native fast paths (`○` cells in the matrix above are routed through `try { import("parabun:csv") } catch { /* JS */ }` shims):

| Library | Routes to | Status |
|---|---|---|
| `@para/arena` | `parabun:arena` (defer JSC GC during `scope()`) | **shipped** |
| `@para/csv` | `parabun:csv` (Highway-SIMD parser) | planned |
| `@para/arrow` | `parabun:arrow` (native FlatBuffers + zstd) | planned |
| `@para/simd` | `parabun:simd` (FFI to Highway intrinsics) | planned |
| `@para/parallel` | `parabun:parallel` (native pool + SAB) | planned |

`@para/signals`, `@para/rtp`, and `@para/mcp` have no native fast path because pure JS is already cheap enough relative to the work they do.

A few patterns visible in the matrix:

- **Column 1 is dense.** `@para/signals` is consumed by almost every `parabun:*` module — it's the universal reactive-state substrate. One observable primitive across the whole stack.
- **`parabun:gpu` is the second hub.** Used by `parabun:llm`, `parabun:image`, and `parabun:vision`. Same matVec / conv2D kernels back per-token inference and image blur.
- **`parabun:assistant` is the busiest row.** It composes — `parabun:llm` + `parabun:speech` + `parabun:audio` + `@para/mcp` + `@para/signals` — rather than implementing primitives.
- **`parabun:image` ↔ `parabun:video` are mutually adjacent**, sharing the ffmpeg integration for frame export and audio extraction.

A few notable shapes in that graph:

- **`@para/signals` is the universal substrate.** Every `parabun:*` module that exposes reactive state (gpio, i2c, spi, camera, audio, vision, llm, gpu) imports `@para/signals` rather than implementing its own observable. One reactive primitive across the whole stack.
- **`parabun:assistant` is a composer**, not a primitive. It sits on `parabun:llm` + `parabun:speech` + `parabun:audio` + `@para/mcp` and provides the turn-taking glue.
- **`parabun:llm` and `parabun:image` both lean on `parabun:gpu`.** The same matVec / conv2D kernels back per-token LLM inference and image blur.
- **The `@para/*` → `parabun:*` arrows are dashed because they're optional.** Today most resolve to "no native path exists, use the bundled JS"; the dashed shape is what becomes solid as native fast paths land (LYK-tracked individually).

## Why two namespaces and not just one

You could imagine collapsing this to a single `@para/*` namespace where some packages are pure JS and some are FFI wrappers. We don't, for two reasons:

1. **Distribution boundary.** `parabun:*` modules can't be `npm install`ed — they need a Linux/macOS/Windows binary linked against system codec libraries, CUDA, V4L2 headers, etc. Putting them in npm would mean shipping a half-broken package most environments can't actually use. The namespace name carries that "this only works under Parabun" warning.
2. **Routing clarity.** With both namespaces visible, a developer reading code can tell at a glance whether a given import is portable (`@para/`) or runtime-locked (`parabun:`). Collapsed into one namespace, the same line would mean either thing depending on the package, and the cross-runtime story would erode.

## Convention recap

- See `parabun:` → native, Parabun-only. Never on npm.
- See `@para/` → cross-runtime npm package. Routes to `parabun:` internally when available.
- Don't see `para:` (legacy) → that import form is being retired in favor of `@para/*` everywhere.
