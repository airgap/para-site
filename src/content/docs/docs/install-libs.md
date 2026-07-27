---
title: Install
description: Compile .pts / .pjs files with parabun build, install the @lyku/para-* npm packages your code uses, ship to any JavaScript runtime.
---

Para is a parse-time syntax extension over TypeScript. The `.pts` parser lives in the [ParaBun](/runtime) fork of Bun — mainline Bun does not recognize the syntax. To use Para on a host that isn't ParaBun itself, you need two things:

1. **The ParaBun transpiler** to compile `.pts` → `.js`. The output is plain JavaScript and runs anywhere; ParaBun is only needed at build time.
2. **The runtime packages** from npm — install only the ones you actually use.

The transpiler emits standard `import`s of `@lyku/para-*` npm packages, so your bundler resolves them through normal node_modules — no aliases or bundler config needed.

A standalone `@lyku/para-transpile` npm package (no ParaBun required) ships as a pre-release — it covers the core Lang operator surface and powers the site's [playground](/playground). ParaBun remains the canonical, full-surface build host (the schema forms and `.pui` pipeline live there); runtime hosts (browser, Lambda, Workers, Node, Bun, Deno) never need either.

## 1. Install ParaBun on the build host

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install.sh | bash
```

This installs the `parabun` binary (with `pb` as a short alias) into `~/.parabun/bin/`.

## 2. Install the runtime packages

Install only the modules your code uses. Each module is its own npm package:

```bash
npm install @lyku/para-schema      # schema brand types + FromDecl (the spine's type side)
npm install @lyku/para-signals     # reactive primitives
npm install @lyku/para-sync        # server-authoritative sync replicas
npm install @lyku/para-kit         # fullstack sync projection (SvelteKit-shaped)
npm install @lyku/para-parallel    # Worker-pool pmap / preduce
npm install @lyku/para-arena       # Pool helper + no-op scope()
npm install @lyku/para-simd        # Wasm v128 kernels
npm install @lyku/para-csv         # RFC 4180 streaming parser
npm install @lyku/para-arrow       # in-memory tables + IPC + Parquet
npm install @lyku/para-rtp         # RFC 3550 packet framing
npm install @lyku/para-mcp         # Model Context Protocol client
npm install @lyku/para-decimal     # exact-decimal arithmetic (backs `0.1d` literals)
```

`@lyku/para-pipeline` is the runtime backing the Para Lang `|>` operator. It's
pulled in transitively by `@lyku/para-transpile` when you use `.pts` files; you
don't need to install or import from it directly.

All `@lyku/para-*` packages are pure JS / Wasm with no native dependencies and target ES2022.

## 3. Build

```bash
parabun build src/main.pts --outdir dist/
```

The output is standard JavaScript with normal `import "@lyku/para-signals"` (etc.) statements. Bundle it with your normal toolchain (`vite build`, `webpack`, etc.) — every bundler resolves `@lyku/para-*` through node_modules with no additional config.

## Editor extension

A VS Code-family extension provides the `.pts` / `.ptsx` / `.pjs` / `.pjsx` TextMate grammar and an LSP with hover, go-to-definition, semantic highlighting, purity diagnostics, and operator documentation.

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install-extension.sh | bash
```

The script installs into any of `code`, `cursor`, or `kiro` it finds on `$PATH`.

## Platform notes

The build step (Bun + bundler) runs on Linux, macOS, and Windows. The output is standard JavaScript; runtime targets are anywhere a JavaScript engine runs. All `@lyku/para-*` packages target ES2022.
