---
title: Install
description: Build .pts files with parabun build, alias para:* in your bundler to @para/* npm packages, ship to any JavaScript runtime.
---

Para is a parse-time syntax extension over TypeScript. The `.pts` parser lives in the [ParaBun](/runtime) fork of Bun — mainline Bun does not recognize the syntax. To use Para on a host that isn't ParaBun itself, you need three things:

1. **The ParaBun transpiler** to compile `.pts` → `.js`. The output is plain JavaScript and runs anywhere; ParaBun is only needed at build time.
2. **A bundler alias** that maps `para:*` import specifiers to the `@para/*` npm packages. One regex line of bundler config.
3. **The runtime packages** — install only the ones you actually use.

A standalone `@para/transpile` npm package (no ParaBun required) is on the roadmap. Until it ships, the build host needs ParaBun installed; runtime hosts (browser, Lambda, Workers, Node, Bun, Deno) do not.

## 1. Install ParaBun on the build host

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install.sh | bash
```

This installs the `parabun` binary (with `pb` as a short alias) into `~/.parabun/bin/`.

## 2. Install the runtime packages

Install only the modules your code uses. Each module is its own npm package:

```bash
npm install @para/signals     # reactive primitives
npm install @para/parallel    # Worker-pool pmap / preduce
npm install @para/pipeline    # |> combinators + SIMD fusion
npm install @para/arena       # Pool helper + no-op scope()
npm install @para/simd        # Wasm v128 kernels
npm install @para/csv         # RFC 4180 streaming parser
npm install @para/arrow       # in-memory tables + IPC + Parquet
npm install @para/rtp         # RFC 3550 packet framing
npm install @para/mcp         # Model Context Protocol client
```

All `@para/*` packages are pure JS / Wasm with no native dependencies and target ES2022.

## 3. Configure your bundler

A single regex rule maps every `para:*` specifier to the matching `@para/*` package:

### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [{ find: /^para:(.*)$/, replacement: "@para/$1" }],
  },
});
```

### esbuild

```ts
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "dist/main.js",
  plugins: [{
    name: "para-alias",
    setup(b) {
      b.onResolve({ filter: /^para:/ }, args => ({
        path: require.resolve(`@para/${args.path.slice(5)}`),
      }));
    },
  }],
});
```

### webpack

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      "para:signals":  "@para/signals",
      "para:arena":    "@para/arena",
      "para:parallel": "@para/parallel",
      "para:pipeline": "@para/pipeline",
      "para:simd":     "@para/simd",
      "para:arrow":    "@para/arrow",
      "para:csv":      "@para/csv",
      "para:rtp":      "@para/rtp",
      "para:mcp":      "@para/mcp",
    },
  },
};
```

## 4. Build

```bash
parabun build src/main.pts --outdir dist/
```

The output is standard JavaScript. Bundle it with your normal toolchain (`vite build`, `webpack`, etc.); the alias takes care of the `para:*` imports.

## Editor extension

A VS Code-family extension provides the `.pts` / `.ptsx` / `.pjs` / `.pjsx` TextMate grammar and an LSP with hover, go-to-definition, semantic highlighting, purity diagnostics, and operator documentation.

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install-extension.sh | bash
```

The script installs into any of `code`, `cursor`, or `kiro` it finds on `$PATH`.

## Platform notes

The build step (Bun + bundler) runs on Linux, macOS, and Windows. The output is standard JavaScript; runtime targets are anywhere a JavaScript engine runs. All `@para/*` packages target ES2022.
