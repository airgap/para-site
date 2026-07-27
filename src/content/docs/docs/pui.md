---
title: "Components (.pui)"
description: Para's component filetype — a Svelte 5 superset where signals, sources, sync, and schemas are first-class declarations. Setup, the keyword surface, HMR, and tooling.
---

`.pui` is Para's component filetype: a **Svelte 5 superset** where the Para
keyword surface — `signal`, `derived`, `effect`, `source`, the
[sync family](/docs/sync/), `prop`, `provide`/`inject` — works as top-level
declarations in the script, lowered by `@lyku/para-preprocess` to plain
runes code the Svelte compiler consumes. The Svelte substrate is an
implementation choice; `.pui` is the durable surface. Normative semantics:
[spec ch. 06](/spec/06-pui-component-model/).

## Setup

```sh
bun add -d @lyku/para-preprocess
```

```js
// svelte.config.js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { parabunPreprocess } from "@lyku/para-preprocess";

export default {
  extensions: [".svelte", ".pui"],
  preprocess: [parabunPreprocess(), vitePreprocess()],
};
```

The file extension is the marker: in a `.pui`, the preprocessor engages on
every `<script>` block regardless of `lang` (`lang="ts"` is the canonical
spelling). `.svelte` files can opt in per-block with
`<script lang="pts">`. After this, `.pui` builds through the standard
SvelteKit/Vite pipeline.

## The component surface

```parabun
<script lang="ts">
import { User, Post } from "$lib/models.js";
import { api } from "$lib/api.js";

prop id: bigint;                       // → $props() destructure (defaults: `prop x: T = v`)

signal query = "";                     // reactive cell → $state
derived trimmed = query.trim();        // computed → $derived
effect { console.log(trimmed); }       // tracked side effect → $effect

async signal profile = fetch(`/api/p/${id}`).then(r => r.json());
                                       // fire-once { data, error, pending } cell
derived found :: Post = api.search(trimmed);
                                       // query-derived: REFETCHES when `trimmed` changes, gated by Post
source meter = audioMeter(0);          // native handle → auto-disposed reactive view
using conn = openSocket(url);          // dispose-on-unmount, nothing reactive

sync user :: User from query({ where: u => u.id == id });   // server-authoritative (live)
mutate rename of user { optimistic(name) { user.name = name; } }

provide theme = makeTheme();           // → setContext
inject theme: Theme;                   // → getContext (in a child)

when user?.banned { showBanner(); }    // edge-triggered handler
</script>

<h1>{user?.name}</h1>
{#if found.data}<Result post={found.data}/>{/if}
```

Everything above is a **declaration, not an API call** — each lowers to
readable runes + plain calls into `@lyku/para-signals` /
`@lyku/para-sync` (auto-imported), with disposal wired to unmount. The
template below the script is full Svelte 5 — every control block, snippet,
and binding works unchanged.

Two lowerings worth knowing about:

- **Escape analysis.** A `signal` only pays for the para↔runes bridge when
  external Para code can actually observe it; a cell that provably never
  escapes the component lowers to a bare `$state`. You write one keyword;
  the preprocessor picks the cheap form.
- **HMR.** In dev (`import.meta.hot`), signals lower through an HMR-stable
  registry so a module reload preserves cell values and subscribers; prod
  lowers to plain `signal()`.

## `.pui` vs `.svelte`

Same compiler, same template language. The differences: the Para script
surface is on by default (no `lang` juggling); **parabun-LSP owns `.pui`
exclusively** (svelte-LSP never claims it, avoiding its hardcoded
TS-lang-list limitation) — the trade-off is that some of svelte-LSP's
template-level diagnostics aren't ported yet; and under a plain-Node
toolchain (svelte-check, svelte-language-server) the preprocessor passes
scripts through with `lang="ts"` so downstream tools still type-check,
while Para operators are handled by parabun-LSP independently.

## Type-checking — `pui-check`

`@lyku/para-check` is svelte-check for the Para substrate:

```sh
bunx pui-check                # check every .pui/.svelte in the workspace
```

It projects each component to typed TSX via the same lowering + svelte2tsx
pipeline the LSP uses, type-checks one TypeScript program against your
tsconfig, and maps diagnostics back to original `.pui` positions.

## Fullstack

The sync declarations above become a running app through
[`@lyku/para-kit`](/docs/kit/): `para-kit emit` extracts `from server`
expressions into server artifacts, and the SSE endpoint + transport wire
the live channels. The [sync reference](/docs/sync/) covers the semantics.
