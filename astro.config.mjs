import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import shikiTypescript from "@shikijs/langs/typescript";
import shikiTsx from "@shikijs/langs/tsx";
import shikiJavascript from "@shikijs/langs/javascript";
import shikiJsx from "@shikijs/langs/jsx";
import parabunTsGrammar from "./src/grammars/parabun-ts.tmLanguage.json" with { type: "json" };
import parabunTsxGrammar from "./src/grammars/parabun-tsx.tmLanguage.json" with { type: "json" };
import parabunJsGrammar from "./src/grammars/parabun-js.tmLanguage.json" with { type: "json" };
import parabunJsxGrammar from "./src/grammars/parabun-jsx.tmLanguage.json" with { type: "json" };
import parabunInjectGrammar from "./src/grammars/parabun-inject.tmLanguage.json" with { type: "json" };

// Hand-curated sidebar — the docs sit flat under src/content/docs/docs/* to
// preserve simple /docs/<slug>/ URLs. Para's surface is the language
// itself plus the runtime modules the language compiles down to. Hardware-
// bound modules (gpu, llm, camera, gpio, …) live on parabun.script.dev — we
// link there rather than mirror them.
const docsRoot = "/docs";
const guides = [
  { label: "Para docs", link: `${docsRoot}/` },
  { label: "Playground", link: "/playground" },
  { label: "Install", link: `${docsRoot}/install/` },
  { label: "Language reference", link: `${docsRoot}/language/` },
];
const examples = [
  { label: "Overview", link: `${docsRoot}/examples/` },
  { label: "Frontend (DOM)", link: `${docsRoot}/examples/frontend/` },
  { label: "Backend (Node)", link: `${docsRoot}/examples/backend/` },
  { label: "Edge (Workers)", link: `${docsRoot}/examples/edge/` },
];
const modules = ["signals", "arena", "parallel", "pipeline", "simd", "arrow", "csv"].map(slug => ({
  label: `para:${slug}`,
  link: `${docsRoot}/${slug}/`,
}));

export default defineConfig({
  site: "https://para.script.dev",
  integrations: [
    starlight({
      title: "Para",
      description:
        "A portable JavaScript dialect with reactive signals, edge-triggered handlers, ranges, pipelines, and purity. Compile with bun build, run anywhere V8/JSC runs.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/airgap/parabun" }],
      customCss: ["./src/styles/parabun.css"],
      sidebar: [
        { label: "Guides", items: guides },
        { label: "Examples", items: examples },
        { label: "Modules", items: modules },
        {
          label: "Hardware (ParaBun runtime)",
          items: [{ label: "parabun.script.dev →", link: "https://parabun.script.dev/docs/" }],
        },
      ],
      expressiveCode: {
        // Custom TextMate grammars for `.pts` / `.ptsx` / `.pjs` / `.pjsx`.
        // Each grammar embeds the matching base TS/TSX/JS/JSX grammar via
        // `embeddedLangs`, then layers ParaBun keywords (memo / pure / fun /
        // signal / effect / arena / defer) and operators (|> ~> -> ..= ..! ..&)
        // on top.
        shiki: {
          langs: [
            shikiTypescript,
            shikiTsx,
            shikiJavascript,
            shikiJsx,
            parabunTsGrammar,
            parabunTsxGrammar,
            parabunJsGrammar,
            parabunJsxGrammar,
            parabunInjectGrammar,
          ],
          langAlias: {
            parabun: "parabun-ts",
            pts: "parabun-ts",
            ptsx: "parabun-tsx",
            pjs: "parabun-js",
            pjsx: "parabun-jsx",
          },
        },
        // Tokyo Night for the night-sky default — slate background with
        // periwinkle keywords + warm strings, sits naturally inside the
        // cosmic page. min-light for the atlas alternate — pared-down,
        // parchment-friendly token contrast.
        themes: ["min-light", "tokyo-night"],
      },
    }),
  ],
});
