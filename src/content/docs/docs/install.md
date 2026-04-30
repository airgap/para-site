---
title: Install
description: Build .pts files with bun build, alias para:* in your bundler, ship to browser / Lambda / Workers / Node.
---

ParaScript is the syntax + the small runtime modules it desugars to. To use it, you need:

1. **A transpiler** that turns `.pts` files into JavaScript. Today that's `bun build` (Parabun's parser shipped as a build tool — works fine even on a server you don't control at runtime).
2. **A bundler that resolves `para:*`** to the runtime shim package — five lines of config in Vite, esbuild, webpack, rollup, or whatever you use.
3. **The shim package**: [`parabun-browser-shims`](https://www.npmjs.com/package/parabun-browser-shims) on npm. Pure JS, browser/Node/edge-safe.

If you're shipping the server with [Parabun](https://parabun.script.dev) (the runtime fork of Bun), skip all of this — `.pts` runs natively and `para:*` resolves to built-in modules. The recipes below are for everywhere else.

## Step 1 — install Bun (or Parabun) on your build machine

```bash
curl -fsSL https://bun.sh/install | bash       # plain Bun is enough to run `bun build`
# or, for the all-batteries fork:
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install.sh | bash
```

A standalone `@parascript/transpile` npm package (no Bun required) is on the roadmap. Until then, your CI machine needs Bun installed for the build step. Runtime hosts (browser, Lambda, Workers, Node) need nothing.

## Step 2 — install the shim package

```bash
npm install parabun-browser-shims
# or: bun add parabun-browser-shims
```

This is a normal npm package — pure JS, no native deps, ~kb-scale. It exports the runtime side of every `para:*` module ParaScript desugars into (`signals`, `arena`, `parallel`, `pipeline`, `simd`, `arrow`, `csv`).

## Step 3 — alias `para:*` in your bundler

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

## Step 4 — write `.pts`, build, ship

```pts
// src/main.pts
signal count = 0;
effect { document.getElementById("c").textContent = count; }
document.getElementById("inc").addEventListener("click", () => count++);
```

```bash
# Transpile .pts → .js (or skip and let your Vite/esbuild plugin call bun build)
bun build src/main.pts --outdir dist/

# Then bundle as normal — your bundler's alias handles `para:*` resolution
vite build
```

The output is plain JavaScript that ships anywhere. No ParaScript runtime, no compiler-level magic — every extension you write becomes a normal JS call into a normal npm package.

## Editor extension

The VS Code-family extension (works for `code`, `cursor`, and `kiro`) provides:

- TextMate grammar for `.pts` / `.ptsx` / `.pjs` / `.pjsx` files.
- An LSP with hover, go-to-definition, semantic highlighting, purity diagnostics, memo arity hints, and operator documentation.

Install:

```bash
curl -fsSL https://raw.githubusercontent.com/airgap/parabun/main/install-extension.sh | bash
```

The script picks up whichever IDE binaries are on `$PATH` and installs the extension into all of them. Works whether or not you've installed Parabun the runtime.

## Platform notes

The build step (Bun + bundler) runs on Linux, macOS, and Windows. The output is plain JS — runs anywhere a JS engine runs. The shim package targets ES2022 and uses no APIs that require a specific host.
