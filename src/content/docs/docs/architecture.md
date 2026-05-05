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

## All modules at a glance

Every public module on one row. `—` means "doesn't exist on that side."

- Rows with **both** columns filled → cross-runtime library with optional native acceleration on Parabun.
- Rows with `—` in npm → Parabun-only native module (no credible browser/Node equivalent).
- Rows with `—` in runtime → pure-JS lib where native code wouldn't help.

| Module | npm package | Runtime fast path | What it does |
|---|---|---|---|
| signals | `@para/signals` | — | Reactive state — Signal / Computed / Effect |
| parallel | `@para/parallel` | `parabun:parallel` *(planned)* | Worker-pool primitives — pmap / preduce / psort + Mutex / Semaphore |
| arena | `@para/arena` | `parabun:arena` ✓ | Buffer-pool free list + JSC-GC-deferring `scope()` |
| simd | `@para/simd` | `parabun:simd` *(planned)* | SIMD over typed arrays — sum / dot / matVec / topK |
| csv | `@para/csv` | `parabun:csv` *(planned)* | RFC 4180 parse / stringify; native = Highway SIMD parser |
| arrow | `@para/arrow` | `parabun:arrow` *(planned)* | In-memory Arrow + IPC + Parquet; native = FlatBuffers + zstd |
| rtp | `@para/rtp` | — | RFC 3550 RTP pack/parse + jitter buffer |
| mcp | `@para/mcp` | — | Model Context Protocol client (stdio + WebSocket) |
| image | — | `parabun:image` ✓ | JPEG / PNG / WebP / AVIF / HEIC / JPEG-XL decode + encode + filters |
| video | — | `parabun:video` ✓ | H.264 / H.265 / VP9 / AV1 decode + encode + thumbnail + extractAudio (ffmpeg) |
| audio | — | `parabun:audio` ✓ | WAV / MP3 / FLAC / AAC / OGG / Opus + FFT + filters + ALSA capture/playback |
| llm | — | `parabun:llm` ✓ | LLM inference (Llama / Mistral / Whisper) on CUDA + Metal; OpenAI-compatible serve |
| vision | — | `parabun:vision` ✓ | Frame + motion + YOLO + tesseract OCR + tracker + ONNX runtime |
| speech | — | `parabun:speech` ✓ | VAD-gated utterance segmentation + Whisper STT + Piper TTS |
| assistant | — | `parabun:assistant` ✓ | Bot harness composing speech + llm into a turn-taking agent |
| gpu | — | `parabun:gpu` ✓ | CUDA + Metal kernels; matVec / matmul / conv2D / scan / reduce / quantile / variance / argmin/max / histogram / custom MSL+CUDA |
| gpio | — | `parabun:gpio` ✓ | Linux uAPI v2 GPIO — digital in/out, edge events |
| i2c | — | `parabun:i2c` ✓ | Linux i2c-dev with SMBus convenience methods |
| spi | — | `parabun:spi` ✓ | Linux spidev with multi-segment transfers |
| camera | — | `parabun:camera` ✓ | V4L2 frame capture |

Two more npm packages back Para language features (`|>` and `0.1d`) — present so `.pts` output has somewhere to import from, not pitched as standalone libraries:

| Package | Backs which feature |
|---|---|
| `@para/pipeline` | `\|>` runtime helpers + affine-chain `compile()` |
| `@para/decimal` | Exact-decimal arithmetic for `0.1d` literals |

## How the routing shim works

Each `@para/*` library that has a runtime fast path tries to import its `parabun:*` counterpart at module load and falls back to its bundled JS when the import throws (Node, Deno, browsers, or just Parabun without that native module yet):

```ts
// inside @para/csv (paraphrased)
let impl;
try { impl = await import("parabun:csv"); }       // Parabun → native, fastest
catch { impl = await import("./impl-js.ts"); }    // everywhere else → bundled JS
export const { parseStream, /* … */ } = impl;
```

The native fast paths are opt-in upgrades, not requirements. Library consumers don't have to know which side they're on — same import, best available impl.

## Why two namespaces and not just one

You could imagine collapsing this to a single `@para/*` namespace where some packages are pure JS and some are FFI wrappers. We don't, for two reasons:

1. **Distribution boundary.** `parabun:*` modules can't be `npm install`ed — they need a Linux/macOS/Windows binary linked against system codec libraries, CUDA, V4L2 headers, etc. Putting them in npm would mean shipping a half-broken package most environments can't actually use. The namespace name carries that "this only works under Parabun" warning.
2. **Routing clarity.** With both namespaces visible, a developer reading code can tell at a glance whether a given import is portable (`@para/`) or runtime-locked (`parabun:`). Collapsed into one namespace, the same line would mean either thing depending on the package, and the cross-runtime story would erode.

## Convention recap

- See `parabun:` → native, Parabun-only. Never on npm.
- See `@para/` → cross-runtime npm package. Routes to `parabun:` internally when available.
- Don't see `para:` (legacy) → that import form is being retired in favor of `@para/*` everywhere.
