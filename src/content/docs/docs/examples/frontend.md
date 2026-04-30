---
title: Frontend example
description: A todo list using ParaScript signals against the vanilla DOM, built with Vite. Demonstrates signal declarations, derived signals, effect blocks, and when blocks.
---

A todo list using ParaScript against the vanilla DOM, built with Vite. Demonstrates `signal`, derived signals, `effect { }`, `when { }`, and the bare-read sugar.

## Project layout

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
    <p id="toast" hidden>all done</p>
    <script type="module" src="./src/main.pts"></script>
  </body>
</html>
```

## src/main.pts

```pts
type Todo = { id: number; text: string; done: boolean };

signal items: Todo[] = [];
signal filter: "all" | "open" | "done" = "all";

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

effect {
  $<HTMLUListElement>("#list").innerHTML = visible
    .map(t => `
      <li data-id="${t.id}">
        <input type="checkbox" ${t.done ? "checked" : ""} />
        <span class="${t.done ? "done" : ""}">${t.text}</span>
      </li>
    `).join("");
}

effect {
  const el = $<HTMLParagraphElement>("#count");
  el.textContent = `${openCount} open`;
  el.hidden = openCount === 0 && items.length === 0;
}

when items.length > 0 && openCount === 0 {
  const t = $<HTMLParagraphElement>("#toast");
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2000);
}

$<HTMLUListElement>("#list").addEventListener("click", e => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-id]");
  if (!li || (e.target as HTMLElement).tagName !== "INPUT") return;
  const id = +li.dataset.id!;
  items = items.map(t => (t.id === id ? { ...t, done: !t.done } : t));
});
```

### Notes on the source

- `signal items: Todo[] = []` declares a reactive cell. `items = newValue` compiles to `items.set(newValue)`; reading `items` inside a tracked context (an `effect`, a `derived`, a `when` predicate, or another signal's RHS) compiles to `items.get()`.
- `signal visible = ...` and `signal openCount = ...` are auto-promoted to `derived()` because their initializers read other signals. They recompute lazily when a dep changes.
- Each `effect { }` block tracks the signals it reads and re-runs when any of them changes. The two effects in this file are independent: changing `filter` re-runs the list effect but not the count effect.
- `when items.length > 0 && openCount === 0 { ... }` fires once on each false→true transition of the predicate. Toggling the last unchecked item triggers the body once; toggling it back and re-completing it triggers it again.

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

## Build and deploy

```bash
bun install
bun run build
```

Output is a static `dist/` directory. Deploy to any static host (Cloudflare Pages, Vercel, S3, GitHub Pages, etc.).
