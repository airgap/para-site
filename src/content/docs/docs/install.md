---
title: Install
description: Build .pts files with parabun build, alias para:* in your bundler, ship to any JavaScript runtime.
---

Para is a parse-time syntax extension over TypeScript. The `.pts` parser lives in the [ParaBun](https://parabun.script.dev) fork of Bun — mainline Bun does not recognize the syntax. To use Para on a host that isn't ParaBun itself, you need three things:

1. **The ParaBun transpiler** to compile `.pts` → `.js`. The output is plain JavaScript and runs anywhere; ParaBun is only needed at build time.
2. **A bundler alias** that maps `para:*` import specifiers to the runtime shim package. One line of bundler config.
3. **The runtime package**, [`parabun-browser-shims`](https://www.npmjs.com/package/parabun-browser-shims).

A standalone `@para/transpile` npm package (no ParaBun required) is on the roadmap. Until it ships, the build host needs ParaBun installed; runtime hosts (browser, Lambda, Workers, Node, Bun, Deno) do not.

## 1. Install ParaBun on the build host

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install.sh | bash
```

This installs the `parabun` binary (with `pb` as a short alias) into `~/.parabun/bin/`.

## 2. Install the runtime package

```bash
npm install parabun-browser-shims
```

`parabun-browser-shims` is pure JavaScript with no native dependencies. It exports the runtime side of every `para:*` module the language uses: `signals`, `arena`, `parallel`, `pipeline`, `simd`, `arrow`, `csv`.

## 3. Configure your bundler

### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [{ find: /^para:(.*)$/, replacement: "parabun-browser-shims/$1" }],
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
        path: require.resolve(`parabun-browser-shims/${args.path.slice(5)}`),
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
      "para:signals":  "parabun-browser-shims/signals",
      "para:arena":    "parabun-browser-shims/arena",
      "para:parallel": "parabun-browser-shims/parallel",
      "para:pipeline": "parabun-browser-shims/pipeline",
      "para:simd":     "parabun-browser-shims/simd",
      "para:arrow":    "parabun-browser-shims/arrow",
      "para:csv":      "parabun-browser-shims/csv",
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

The build step (Bun + bundler) runs on Linux, macOS, and Windows. The output is standard JavaScript; runtime targets are anywhere a JavaScript engine runs. The shim package targets ES2022.
