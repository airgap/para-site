---
title: Frontend — reactive DOM without a framework
description: A worked ParaScript example — todo list with reactive signals, edge-triggered handlers, and effect-driven DOM updates. No React, no Vue, no Svelte, no compiler runtime.
---

A todo list, written in `.pts`, that reads as if you had a framework but ships ~3 KB of JS plus the shim package. Demonstrates `signal`, derived signals, `effect { }`, `when { }`, and the bare-read sugar.

## What you build

A textbox + button that adds items, a list that filters by completion state, a counter that hides itself when the list is empty, and an "all done!" toast that fires once each time the open count crosses zero.

## File layout

```
my-todo/
├── index.html
├── src/main.pts
├── vite.config.ts
└── package.json
```

## index.html

```html
<!doctype html>
<html>
  <body>
    <input id="new" placeholder="new todo…" autofocus />
    <button id="add">add</button>
    <select id="filter">
      <option value="all">all</option>
      <option value="open">open</option>
      <option value="done">done</option>
    </select>
    <ul id="list"></ul>
    <p id="count"></p>
    <p id="toast" hidden>all done!</p>
    <script type="module" src="./src/main.pts"></script>
  </body>
</html>
```

## src/main.pts

```pts
type Todo = { id: number; text: string; done: boolean };

signal items: Todo[] = [];
signal filter: "all" | "open" | "done" = "all";

// Derived signals — auto-promoted because the RHS reads `items` / `filter`.
signal visible = filter === "all"
  ? items
  : items.filter(t => (filter === "done" ? t.done : !t.done));
signal openCount = items.filter(t => !t.done).length;

let nextId = 1;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;

$<HTMLButtonElement>("#add").addEventListener("click", () => {
  const input = $<HTMLInputElement>("#new");
  if (!input.value.trim()) return;
  items = [...items, { id: nextId++, text: input.value.trim(), done: false }];
  input.value = "";
});

$<HTMLSelectElement>("#filter").addEventListener("change", e => {
  filter = (e.target as HTMLSelectElement).value as typeof filter;
});

// Effect: paints the list whenever `visible` changes.
effect {
  $<HTMLUListElement>("#list").innerHTML = visible
    .map(t => `
      <li data-id="${t.id}">
        <input type="checkbox" ${t.done ? "checked" : ""} />
        <span class="${t.done ? "done" : ""}">${t.text}</span>
      </li>
    `).join("");
}

// Effect: count text. Hides itself when there's nothing open.
effect {
  const el = $<HTMLParagraphElement>("#count");
  el.textContent = `${openCount} open`;
  el.hidden = openCount === 0 && items.length === 0;
}

// Edge-triggered: fires once per false→true of "everything is done"
when items.length > 0 && openCount === 0 {
  const t = $<HTMLParagraphElement>("#toast");
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2000);
}

// Click on a checkbox toggles done. Event delegation on the list.
$<HTMLUListElement>("#list").addEventListener("click", e => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-id]");
  if (!li || (e.target as HTMLElement).tagName !== "INPUT") return;
  const id = +li.dataset.id!;
  items = items.map(t => (t.id === id ? { ...t, done: !t.done } : t));
});
```

## vite.config.ts

```ts
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [{ find: /^para:(.*)$/, replacement: "parabun-browser-shims/$1" }],
  },
});
```

## package.json

```json
{
  "name": "my-todo",
  "type": "module",
  "scripts": {
    "build": "bun build src/main.pts --outfile dist/main.js && vite build",
    "dev": "bun build src/main.pts --watch --outfile dist/main.js & vite"
  },
  "dependencies": { "parabun-browser-shims": "*" },
  "devDependencies": { "vite": "^5", "bun-types": "*" }
}
```

## What's happening

- **`signal items: Todo[] = []`** — declares a reactive array. Every `items = ...` is an `items.set(...)` under the hood.
- **`signal visible = ...`** — the RHS reads `items` and `filter`, so this auto-promotes to `derived(() => ...)`. Whenever either dep changes, `visible` recomputes lazily.
- **`signal openCount = items.filter(...).length`** — same auto-promotion. Plain integer; just a derived view.
- **`effect { }`** — tracks every signal it reads. The list-painting effect re-runs only when `visible` changes; the count-painting effect re-runs only when `openCount` or `items.length` changes. The microtask flush dedupes between writes in the same tick.
- **`when items.length > 0 && openCount === 0`** — this is **edge-triggered**, not level-triggered. The toast fires once per false→true transition of the predicate, not every keystroke that keeps it true. If you check off the last item, toast appears; if you uncheck, the predicate goes false; check it again, toast reappears.
- **Bare-read sugar** — `items` inside an `effect`/`when`/`derived` rewrites to `items.get()`; `items = ...` rewrites to `items.set(...)`. Outside a tracked context (e.g., the click handler) the same rules apply.

## Without ParaScript

The same logic in plain TypeScript with one of the popular reactive libraries lands somewhere between 30% and 100% more lines of code — the boilerplate is the create-store, subscribe-to-store, hand-coded "did this change?" checks, plus the fact that `when` (true edge detection) usually doesn't exist as a primitive at all and you end up tracking the previous value yourself. Compare your last reactive UI you wrote in any framework with the file above.

## Build &amp; ship

```bash
bun install
bun run build           # → dist/index.html + dist/assets/*
```

Static output. Drop the `dist/` directory on any static host (Cloudflare Pages, Vercel, S3, GitHub Pages) — there's no server-side runtime requirement.
