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

// Hand-curated sidebar — every doc page lives flat under
// src/content/docs/docs/* with one Starlight tree at /docs/. Modules
// don't collide between products (signals vs gpu vs language); install
// pages are split per-product (install-libs / install-runtime).
const docsRoot = "/docs";
const guides = [
  { label: "Para docs", link: `${docsRoot}/` },
  { label: "Install (libs)", link: `${docsRoot}/install-libs/` },
  { label: "Install (runtime)", link: `${docsRoot}/install-runtime/` },
  { label: "Language reference", link: `${docsRoot}/language/` },
  { label: "Architecture", link: `${docsRoot}/architecture/` },
];
// /playground is a standalone page, not a doc — keeping it in the
// docs sidebar made Starlight's prev/next nav from /docs/ point at
// the playground (out of the docs flow). Linked from /docs/ inline
// instead, and surface it via the social/header slot.
const examples = [
  { label: "Overview", link: `${docsRoot}/examples/` },
  { label: "Frontend (DOM)", link: `${docsRoot}/examples/frontend/` },
  { label: "Backend (Node)", link: `${docsRoot}/examples/backend/` },
  { label: "Edge (Workers)", link: `${docsRoot}/examples/edge/` },
  { label: "Multi-plant waterer", link: `${docsRoot}/examples/iot-waterer/` },
  { label: "GPIO over HTTP + SSE", link: `${docsRoot}/examples/iot-http-state/` },
  { label: "Voice assistant", link: `${docsRoot}/examples/voice-assistant/` },
  { label: "Smart camera", link: `${docsRoot}/examples/camera-motion/` },
  { label: "Streaming ETL", link: `${docsRoot}/examples/streaming-etl/` },
  { label: "Parquet ETL", link: `${docsRoot}/examples/parquet-etl/` },
];
// pipeline is the runtime backing the |> operator (Para Lang internal),
// not pitched as a user-facing library — its function-call API is ugly
// without the |> sugar. Page still exists at /docs/pipeline/ for the
// language-internals doc, just not in the libs sidebar group.
const libModules = ["signals", "sync", "kit", "arena", "parallel", "simd", "arrow", "csv", "rtp", "mcp"].map(slug => ({
  label: `@lyku/para-${slug}`,
  link: `${docsRoot}/${slug}/`,
}));
const runtimeModules = [
  "assistant",
  "audio",
  "camera",
  "gpio",
  "gpu",
  "i2c",
  "image",
  "llm",
  "speech",
  "spi",
  "video",
  "vision",
].map(slug => ({ label: `parabun:${slug}`, link: `${docsRoot}/${slug}/` }));

// Language spec (draft) — the first formal Para spec, one Starlight page
// per chapter under /spec/*. Hand-ordered to match the chapter numbering;
// existing-surface chapters 1–12 then the two appendices.
const specPages = [
  { label: "Spec home", link: "/spec/" },
  { label: "Design principles & notation", link: "/spec/00-design-principles-and-notation/" },
  { label: "1 · Overview & surfaces", link: "/spec/01-overview-and-surfaces/" },
  { label: "2 · Lexical & operators", link: "/spec/02-lexical-and-expression-syntax/" },
  { label: "3 · Schema spine", link: "/spec/03-type-and-schema-system/" },
  { label: "4 · Reactivity", link: "/spec/04-reactivity-core/" },
  { label: "5 · Effects & concurrency", link: "/spec/05-effects-lifecycle-concurrency/" },
  { label: "6 · .pui components", link: "/spec/06-pui-component-model/" },
  { label: "7 · Sources & native/AI", link: "/spec/07-sources-async-and-native/" },
  { label: "8 · Data sync", link: "/spec/08-data-sync-and-authority/" },
  { label: "9 · Errors & validation", link: "/spec/09-errors-results-and-validation/" },
  { label: "10 · Purity", link: "/spec/10-purity-and-determinism/" },
  { label: "11 · Modules & build", link: "/spec/11-modules-projections-and-build/" },
  { label: "12 · Tooling & conformance", link: "/spec/12-tooling-diagnostics-and-conformance/" },
  { label: "Appendix A · Frontier", link: "/spec/90-frontier-proposed-directions/" },
  { label: "Appendix B · Grammar", link: "/spec/95-grammar-appendix/" },
];

// Pre-consolidation parabun.script.dev had its configurator at /configure;
// the page now lives at /runtime/configure/ since both subdomains hit the
// same worker. Old bookmarks still work via this 301.
const legacyParabunRedirects = {
  "/configure": "/runtime/configure/",
  "/configure/": "/runtime/configure/",
};

export default defineConfig({
  site: "https://para.script.dev",
  redirects: legacyParabunRedirects,
  integrations: [
    starlight({
      title: "Para",
      description:
        "A portable JavaScript dialect with reactive signals, edge-triggered handlers, ranges, pipelines, and purity. Compile with bun build, run anywhere V8/JSC runs.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/airgap/parabun" }],
      customCss: ["./src/styles/parabun.css"],
      components: { SiteTitle: "./src/components/SiteTitle.astro" },
      sidebar: [
        { label: "Guides", items: guides },
        { label: "Examples", items: examples },
        {
          label: "Lib modules (cross-runtime)",
          // para-sort kept as an explicit entry; its @lyku/para-sort label
          // now matches what the @lyku/para-<slug> map above would produce,
          // but it stays separate for clarity (and was the lone exception
          // back when it alone used the @lyku scope).
          items: [...libModules, { label: "@lyku/para-sort", link: `${docsRoot}/sort/` }],
        },
        { label: "Runtime modules (ParaBun)", items: runtimeModules },
        { label: "Language spec (draft)", items: specPages, collapsed: true },
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
            // Spec docs use `para` for bare Para/.pts code blocks and `pui`
            // for .pui component blocks. Map them onto the ParaBun grammars:
            // `para` → the .pts grammar; `pui` → the TSX grammar (closest fit
            // for .pui's script + JSX-like markup). (`ebnf` has no grammar and
            // renders as plain text, which suits grammar productions.)
            para: "parabun-ts",
            pui: "parabun-tsx",
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
