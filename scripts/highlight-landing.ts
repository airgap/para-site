// Re-renders every <pre data-lang="X"><code>...</code></pre> block on
// public/index.html through Shiki, using the same parabun TextMate
// grammar that powers the docs site. The previous markup was hand-
// rolled <span class="kw|fn|str|...">…</span> which drifted out of
// sync with reality on every edit.
//
// Run: bun run scripts/highlight-landing.ts
//
// The script reads public/index.html, finds each tabbed code block,
// strips the existing span markup and decodes entities to recover the
// raw source, runs it through Shiki with the parabun grammar, and
// writes the result back. Idempotent — re-running it on already-
// highlighted output produces the same output.

import { createHighlighter } from "shiki";
import parabunTs from "../src/grammars/parabun-ts.tmLanguage.json" with { type: "json" };
import parabunTsx from "../src/grammars/parabun-tsx.tmLanguage.json" with { type: "json" };
import parabunJs from "../src/grammars/parabun-js.tmLanguage.json" with { type: "json" };
import parabunJsx from "../src/grammars/parabun-jsx.tmLanguage.json" with { type: "json" };
import parabunInject from "../src/grammars/parabun-inject.tmLanguage.json" with { type: "json" };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#x27": "'",
  "#x60": "`",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
  hellip: "…",
  sup2: "²",
  sup3: "³",
};

function decodeEntities(s: string): string {
  return s.replace(/&([a-zA-Z]+|#x?\w+);/g, (m, name) => {
    if (name in ENTITIES) return ENTITIES[name];
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return m;
  });
}

function stripSpans(html: string): string {
  // Drop opening <span ...> and closing </span> tags. Keep inner text.
  return html.replace(/<span\b[^>]*>/g, "").replace(/<\/span>/g, "");
}

function rawCode(blockHtml: string): string {
  return decodeEntities(stripSpans(blockHtml));
}

// Process every .html file under public/ so the libs / lang / runtime
// landings get the same Shiki treatment as the umbrella index.
const publicDir = new URL("../public/", import.meta.url).pathname;
const glob = new Bun.Glob("**/*.html");
const targets: string[] = [];
for await (const rel of glob.scan({ cwd: publicDir })) targets.push(publicDir + rel);

const highlighter = await createHighlighter({
  langs: [
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    parabunTs as any,
    parabunTsx as any,
    parabunJs as any,
    parabunJsx as any,
    parabunInject as any,
  ],
  // Dual-theme: shiki emits per-span CSS variables for both themes; the
  // landing CSS picks `--shiki-light` or `--shiki-dark` from `[data-theme]`.
  themes: ["min-light", "tokyo-night"],
  langAlias: {
    parabun: "parabun-ts",
    pts: "parabun-ts",
    ptsx: "parabun-tsx",
    pjs: "parabun-js",
    pjsx: "parabun-jsx",
  },
});

let totalBlocks = 0;
let totalFiles = 0;
for (const path of targets) {
  const original = await Bun.file(path).text();
  let fileBlocks = 0;
  const rewritten = original.replace(
    /<pre\b([^>]*)>([\s\S]*?<code>)([\s\S]*?)(<\/code>[\s\S]*?)<\/pre>/g,
    (_m, preAttrs, preToCode, body, codeToEnd) => {
      const langMatch = preAttrs.match(/\bdata-lang=["']([\w-]+)["']/);
      const lang = langMatch ? langMatch[1] : "ts";
      const code = rawCode(body);
      const targetLang = lang === "ts" ? "typescript" : lang;
      const html = highlighter.codeToHtml(code, {
        lang: targetLang,
        themes: { light: "min-light", dark: "tokyo-night" },
        // No default color → both themes emit only as CSS variables on each
        // span. CSS rules under [data-theme="…"] pick the right one. Avoids
        // hard-coding either theme's hex into the markup, which would lock
        // the unselected theme to a fallback color.
        defaultColor: false,
      });
      const innerMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
      const inner = innerMatch ? innerMatch[1] : code;
      fileBlocks++;
      return `<pre${preAttrs}>${preToCode}${inner}${codeToEnd}</pre>`;
    },
  );
  if (fileBlocks > 0) {
    await Bun.write(path, rewritten);
    console.log(`  ${path}: ${fileBlocks} blocks`);
    totalBlocks += fileBlocks;
    totalFiles++;
  }
}
highlighter.dispose();
console.log(`re-highlighted ${totalBlocks} blocks across ${totalFiles} file(s)`);
