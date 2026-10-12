---
title: Install
description: Compile .pts / .pjs files with parabun build, install the @lyku/para-* npm packages your code uses, ship to any JavaScript runtime.
---

Para is a parse-time syntax extension over TypeScript. The `.pts` parser lives in the [ParaBun](/runtime) fork of Bun — mainline Bun does not recognize the syntax. To use Para on a host that isn't ParaBun itself, you need two things:

1. **The ParaBun transpiler** to compile `.pts` → `.js`. The output is JavaScript; its emitted imports determine which runtimes can execute it.
2. **The runtime packages** from npm — install only the ones you actually use.

Generated code may import `@lyku/para-*` runtime packages and helpers. Confirm that every emitted dependency is available for your target; the published standalone compiler and ParaBun do not have identical coverage.

A standalone `@lyku/para-transpile` npm package (no ParaBun required) ships as a pre-release — it covers the core Lang operator surface and powers the site's [playground](/playground). ParaBun remains the canonical, full-surface build host (the schema forms and `.pui` pipeline live there); runtime hosts do not need the compiler when all emitted runtime dependencies are available.

## 1. Install ParaBun on the build host

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install.sh | bash
```

This installs the `parabun` binary (with `pb` as a short alias) into `~/.parabun/bin/`.

## 2. Install the runtime packages

The following packages are published on public npm (verified 2026-10-12):

```bash
npm install @lyku/para-schema @lyku/para-signals @lyku/para-sync
```

The standalone compiler is a separate pre-release:

```bash
npm install @lyku/para-transpile
```

It supports a subset of Para syntax; use ParaBun for the full language. Check the [playground](/playground/) output before relying on a standalone transformation.

The public npm registry does **not** currently contain `@lyku/para-kit`, `@lyku/para-parallel`, `@lyku/para-arena`, `@lyku/para-simd`, `@lyku/para-csv`, `@lyku/para-arrow`, `@lyku/para-rtp`, `@lyku/para-mcp`, `@lyku/para-decimal`, `@lyku/para-pipeline`, or `@lyku/para-sort`. Their reference pages describe the source-workspace implementations or ParaBun's bundled modules where available. They cannot yet be installed with `npm install`; a cross-runtime application that needs them must supply the workspace packages until they are published.

`@lyku/para-pipeline` provides collection combinators used in pipeline examples. It is not a transitive dependency of `@lyku/para-transpile`. The standalone compiler can also emit `bun:wrap` helper imports for ranges, decimals, and other forms; those imports require ParaBun or a compatible runtime shim and do not resolve in stock Node or a browser by themselves.

The cross-runtime packages are JavaScript / Wasm libraries. Package availability and helper resolution still need to be checked for the target runtime.

## 3. Build

```bash
parabun build src/main.pts --outdir dist/
```

Inspect the generated imports, install or supply the referenced packages, and bundle with your normal toolchain (`vite build`, `webpack`, etc.). Imports such as `bun:wrap` require a compatible host or an explicit shim; installing the published packages alone does not resolve them.

## Editor extension

A VS Code-family extension provides the `.pts` / `.ptsx` / `.pjs` / `.pjsx` TextMate grammar and an LSP with hover, go-to-definition, semantic highlighting, purity diagnostics, and operator documentation.

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install-extension.sh | bash
```

The script installs into any of `code`, `cursor`, or `kiro` it finds on `$PATH`.

## Platform notes

The build step (Bun + bundler) runs on Linux, macOS, and Windows. Choose a runtime supported by every emitted dependency. JavaScript syntax compatibility alone does not establish compatibility with native modules or compiler helpers.
