// Live .pts → JS transpile demo. Cycles through snippets that
// demonstrate Para-specific syntax (..>, ..!, parallel { }, |>, etc.)
// and shows what each desugars to. The whole pitch in 7 seconds.
//
// Plain-DOM (not canvas) — code rendering needs syntax highlighting,
// proper text wrapping, and selection support, all of which the
// browser does natively. The hero slot just hosts the panel.
(() => {
  const root = document.querySelector(".transpile");
  if (!root) return;
  const sourceEl = root.querySelector(".transpile-source-code");
  const outputEl = root.querySelector(".transpile-output-code");
  const titleEl = root.querySelector(".transpile-title");
  const sourceTagEl = root.querySelector(".transpile-source-tag");
  if (!sourceEl || !outputEl) return;

  // Hand-curated splash hero reel. Five snippets — each one shows a
  // Para-distinctive construct on the left and its standard-JS
  // desugaring on the right. The full feature atlas (20+ samples
  // including stream fusion, early-exit, decimal, `::` validation,
  // `schema from`, compile-time fold, etc.) lives in /playground —
  // the splash is the hero reel; the playground is the full menu.
  //
  // Ordering: lead with the most visually distinctive Para syntax
  // (..>, ..!, bare-dot lambda), then |>, then the three headline-
  // tagged features (match, signals, schema). Earlier rev had a
  // sixth "compile-time fold" demo; dropped because it only applies
  // to literal-input pipelines, which real code almost never has —
  // it taught an optimization not a programming model.
  // Each snippet declares its `category` so the demo can cycle within
  // a single tab's pool. Lang snippets default to split-pane (mode
  // omitted = 'split'); Runtime snippets are single-pane (mode:
  // 'single'). Two snippet pools, one shared animation rig.
  const snippets = [
    {
      category: "lang",
      name: "promise chain (..>, ..!) + bare-dot lambda",
      pts: `fetch("/api/users")
  ..> .json()
  ..> .filter(.active)
  ..! err => log(err)`,
      js: `fetch("/api/users")
  .then(r => r.json())
  .then(r => r.filter(_ => _.active))
  .catch(err => log(err))`,
    },
    {
      category: "lang",
      name: "pipeline (|>) + bare-dot lambda",
      pts: `const top = items
  |> filter(.active)
  |> map(.score)
  |> sortDesc
  |> take(10)`,
      js: `const top = take(
  sortDesc(
    map(
      filter(items, _ => _.active),
      _ => _.score
    )
  ),
  10
)`,
    },
    {
      category: "lang",
      name: "match: literal arms compile to a switch (jump table)",
      pts: `const msg = match status {
  200 => "ok",
  400 | 404 => "client error",
  500 => "server error",
  _ => "unknown"
}`,
      js: `const msg = ((m) => {
  switch (m) {
    case 200: return "ok"
    case 400:
    case 404: return "client error"
    case 500: return "server error"
    default: return "unknown"
  }
})(status)`,
    },
    {
      category: "lang",
      name: "signals: reactive cells + effect",
      pts: `signal n = 0
signal sq = n * n
effect { console.log(sq) }
n++`,
      js: `const n = signal(0)
const sq = derived(() => n.get() * n.get())
effect(() => console.log(sq.get()))
n.set(n.get() + 1)`,
    },
    {
      category: "lang",
      name: "schema: one declaration, fast inline validator + JSON Schema",
      pts: `schema User {
  id: int,
  email: Email,
  age: int(0..150)?
}`,
      // Default-collapsed: parse and schema bodies fold behind clickable
      // `…` placeholders so the snippet reads in 4 lines. The `…` chars
      // in `js` are turned into <button class="fold-btn"> elements after
      // typing; clicking expands the matching entry from `jsFolds` in
      // place. Click again on the expanded region to collapse.
      // Inline trailing comments annotate each property — the highlighter
      // styles `//` lines as `.tk-cm` so they read as quiet narration
      // instead of competing with the code.
      js: `const User = {
  // parse string with validation
  parse: str => { … },
  // validate an object
  validate: obj => { … },
  // JSON Schema for OpenAPI and whatnot
  schema: { … }
}`,
      jsFolds: [
        `
    if (typeof v !== "object" || v === null) return { tag: "Err", error: "expected object" }
    if (typeof v.id !== "number" || !Number.isInteger(v.id)) return { tag: "Err", error: "id: expected int" }
    if (typeof v.email !== "string" || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v.email))
      return { tag: "Err", error: "email: expected Email" }
    if (v.age !== undefined && v.age !== null
        && (typeof v.age !== "number" || !Number.isInteger(v.age) || v.age < 0 || v.age >= 150))
      return { tag: "Err", error: "age: expected int" }
    return { tag: "Ok", value: v }
  `,
        `
    type: "object",
    properties: {
      id: { type: "integer" },
      email: { type: "string", format: "email" },
      age: { type: "integer", minimum: 0, exclusiveMaximum: 150 }
    },
    required: ["id", "email"]
  `,
      ],
    },
    {
      // Single-pane mode: no parse-time desugar to show — the wow is
      // "this is the actual code that runs a full voice agent." Same
      // animation infrastructure as the Lang reels (typing, hold,
      // evaporate, progress dot); only the visual structure changes.
      // CSS adds `.transpile.single` which hides the arrow + output
      // column so the source pane fills the whole panel.
      category: "runtime",
      name: "parabun:assistant — wake → STT → LLM → TTS, GPU-accelerated",
      mode: "single",
      // No Para-specific syntax in this snippet — just imports +
      // top-level await. Tagged `.ts` to signal that it works as
      // plain TypeScript on ParaBun. The other Runtime demos use
      // Para syntax (`when` for gpio, `->` for the audio binding) so
      // they stay `.pts`.
      tag: ".ts",
      pts: `import assistant from "parabun:assistant";

const bot = await assistant.create({
  wakeWord: "Hey Para",
  llm: "models/llama-3.2-1b.gguf",
  stt: "models/whisper-tiny.en.bin",
  tts: "models/piper-amy-en.onnx",
});

await bot.run();`,
    },
    {
      category: "runtime",
      name: "parabun:gpio — Linux GPIO via uAPI v2",
      mode: "single",
      pts: `import gpio from "parabun:gpio";

const led    = gpio.out(17);
const button = gpio.in(27, { pull: "up" });

// Trigger on truthy change
when button.value { led.toggle(); }`,
    },
    {
      category: "runtime",
      name: "parabun:audio + gpio — mic peak drives an LED via `->`",
      mode: "single",
      pts: `import gpio  from "parabun:gpio";
import audio from "parabun:audio";

const led = gpio.out(17);
const mic = audio.openMic(0);

// Continuously update on change
mic.peakLevel > 0.3 -> led.write;`,
    },
  ];

  // Earlier rev had Language/Runtime tabs that filtered the reel
  // into separate pools. Reel now cycles through every snippet
  // continuously regardless of category; the progress dots
  // themselves are color-coded so the viewer can tell which type of
  // demo is upcoming. `activeSnippets()` is kept as a single-line
  // helper so the rest of the cycler code doesn't need to know it's
  // a pass-through now — if we want pool-filtered tabs back later,
  // only this function changes.
  function activeSnippets() {
    return snippets;
  }

  // Escape only `&` and `<` so the source remains regex-friendly for
  // the highlighter (operators like `..>`, `=>`, `|>` need to match
  // literal `>` not `&gt;`).
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  // Two-pass tokenizer using string replacement with a marker scheme:
  // we mark every recognized token with `\x01CLASS\x02text\x03`, then
  // do a final pass to convert markers into <span> tags. This avoids
  // re-matching tokens we already wrapped.
  function highlight(text, isPara) {
    let h = esc(text);
    const op = isPara ? /(\.\.[>!&=]|\|>|=>)/g : /(=>)/g;
    // ─── codegen:splash-keywords:begin ──────────────────────────────
    // AUTO-GENERATED from /raid/parabun/src/language-surface.ts via
    // scripts/generate-splash-highlighter.ts. Edit the catalog's
    // SPLASH_PARA_KEYWORDS / SPLASH_JS_KEYWORDS arrays, then run
    // `bun run codegen` in the parabun repo. The Jenkins `Codegen
    // check` stage fails if this block drifts from the catalog.
    const kw = isPara
      ? /\b(pure|fun|signal|derived|effect|source|when|arena|memo|defer|match|schema|parallel|para|is|every|const|let|var|function|return|await|async|new|class|if|else|true|false|null|import|from|export|default|as|switch|case|throw|for|of)\b/g
      : /\b(const|let|var|function|return|await|async|new|class|if|else|true|false|null|import|from|export|default|as|switch|case|throw|for|of)\b/g;
    // ─── codegen:splash-keywords:end ────────────────────────────────
    const builtin = /\b(then|catch)\b/g;

    // Strings run FIRST so subsequent passes can skip their contents
    // entirely. Otherwise e.g. `import ... from "@lyku/para-pipeline"` would
    // have the `para` matched as a keyword, then later wrapped as a
    // string containing nested kw markers — the wrap-spans pass would
    // terminate the string span at the first \x03 inside, leaking
    // `kw` into the visible text. Same class of bug as the number leak.
    h = h.replace(/("[^"\n]*")/g, "\x01str\x02$1\x03");
    // Comments run right after strings: `//` to end-of-line. Catches
    // the trailing annotations in the schema demo's js side
    // (`parse: (v) => { … }, // runtime validator → Result`). The
    // pattern won't match `//` inside string literals because those
    // are already inside a `\x01str\x02...\x03` marker block (and the
    // marker characters break the line-class match).
    h = h.replace(/(\/\/[^\n\x01\x03]*)/g, "\x01cm\x02$1\x03");

    // Each subsequent pass uses the same `(MARKED)|PATTERN` trick: if
    // the regex engine lands on an existing marker block, pass it
    // through unchanged; otherwise wrap as the new token type.
    const markedAlt = "\\x01[a-z]+\\x02[^\\x03]*\\x03";
    const opPattern = new RegExp("(" + markedAlt + ")|" + op.source, "g");
    const kwPattern = new RegExp("(" + markedAlt + ")|" + kw.source, "g");
    const builtinPattern = new RegExp("(" + markedAlt + ")|" + builtin.source, "g");
    const numPattern = new RegExp("(" + markedAlt + ")|\\b(\\d+(?:\\.\\d+)?)\\b", "g");

    h = h.replace(opPattern, (_m, marked, captured) => (marked ? marked : `\x01op\x02${captured}\x03`));
    h = h.replace(kwPattern, (_m, marked, captured) => (marked ? marked : `\x01kw\x02${captured}\x03`));
    h = h.replace(builtinPattern, (_m, marked, captured) => (marked ? marked : `\x01kw\x02${captured}\x03`));
    h = h.replace(numPattern, (_m, marked, captured) => (marked ? marked : `\x01num\x02${captured}\x03`));

    // Wrap markers as spans. Done last so spans don't get double-wrapped.
    h = h.replace(/\x01([a-z]+)\x02([^\x03]*)\x03/g, '<span class="tk-$1">$2</span>');
    return h;
  }

  // Caret element appended to whichever pane is actively typing.
  const caret = '<span class="transpile-caret">▍</span>';

  // Per-snippet timing budget. Typing is fast (the keystrokes aren't
  // the show); the long beat is the read-and-compare hold afterwards.
  const TYPE_SOURCE_MS = 14;
  const TYPE_OUTPUT_MS = 6;
  const PRE_OUTPUT_MS = 320;
  const HOLD_MS = 6500;
  const EVAP_DURATION_MS = 700;
  const EVAP_STAGGER_MS = 4;

  // Estimate total snippet duration (typing + pre-output + typing +
  // hold) so the bottom timer bar can begin draining the moment text
  // starts appearing — gives the viewer a "you have N seconds to read"
  // signal across the whole snippet, not just the trailing hold.
  function estimateTypingMs(text, perChar) {
    const wsPerChar = Math.max(2, perChar / 4);
    let total = 0;
    for (const ch of text) {
      total += ch === " " || ch === "\n" ? wsPerChar : perChar;
    }
    return total;
  }
  function snippetDurationMs(snip) {
    // Single-pane snippets (Runtime demos) skip the PRE_OUTPUT pause
    // + output typing pass — there's no `.js` desugar to display, just
    // the source itself + the read-and-compare hold.
    if (snip.mode === "single") {
      return estimateTypingMs(snip.pts, TYPE_SOURCE_MS) + HOLD_MS;
    }
    return (
      estimateTypingMs(snip.pts, TYPE_SOURCE_MS) + PRE_OUTPUT_MS + estimateTypingMs(snip.js, TYPE_OUTPUT_MS) + HOLD_MS
    );
  }

  // ─── Progress dots ────────────────────────────────────────────────
  const progressEl = root.querySelector(".transpile-progress");
  const timerEl = root.querySelector(".transpile-timer-fill");
  function renderProgress(i) {
    if (!progressEl) return;
    // Dots cover the whole reel + carry a `data-category` attr that
    // CSS uses to color them by Lang / Runtime. Active dot keeps its
    // own brighter accent on top of the category base color.
    progressEl.innerHTML = activeSnippets()
      .map((s, k) => {
        const safeName = s.name.replace(/"/g, "&quot;");
        const category = s.category ?? "lang";
        return `<button type="button" class="transpile-dot${k === i ? " active" : ""}" data-i="${k}" data-category="${category}" data-name="${safeName}" aria-label="${safeName}"></button>`;
      })
      .join("");
  }
  renderProgress(0);
  if (progressEl) {
    progressEl.addEventListener("click", e => {
      const dot = e.target.closest(".transpile-dot");
      if (!dot) return;
      e.stopPropagation();
      const idx = Number.parseInt(dot.dataset.i, 10);
      if (Number.isInteger(idx)) jumpTo(idx);
    });
    // Single shared tooltip element. Lives at body root so position:
    // fixed coords work in viewport space. Position is recomputed per
    // hover; width clamps the tooltip to the window edges using its
    // actual measured size (CSS pseudo-element widths can't be measured
    // from JS reliably, hence the real-DOM rewrite).
    let tip = root.querySelector(".transpile-tooltip");
    if (!tip && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      tip = document.createElement("span");
      tip.className = "transpile-tooltip";
      document.body.appendChild(tip);
    }
    const showTip = dot => {
      if (!tip) return;
      tip.textContent = dot.dataset.name || "";
      tip.classList.add("visible");
      // Measure AFTER setting text (and visible — needed for layout)
      // but before painting, then reposition. The transform animation
      // still smooths the appearance.
      const rect = dot.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      // Clamp to viewport — leave `margin` px on each side.
      left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
      tip.style.left = `${left}px`;
      tip.style.top = `${rect.top - tipRect.height - 8}px`;
    };
    const hideTip = () => {
      if (tip) tip.classList.remove("visible");
    };
    progressEl.addEventListener("pointerover", e => {
      const dot = e.target.closest(".transpile-dot");
      if (dot) showTip(dot);
    });
    progressEl.addEventListener("pointerout", e => {
      const dot = e.target.closest(".transpile-dot");
      if (!dot) return;
      // Don't hide if moving to another dot — pointerover will fire.
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".transpile-dot")) return;
      hideTip();
    });
  }

  // ─── Pause control ────────────────────────────────────────────────
  let hoverPaused = false;
  let clickPaused = false;
  const isPaused = () => hoverPaused || clickPaused;

  function syncPausedClass() {
    root.classList.toggle("paused", isPaused());
    root.classList.toggle("pinned", clickPaused);
  }
  root.addEventListener("pointerenter", () => {
    hoverPaused = true;
    syncPausedClass();
  });
  root.addEventListener("pointerleave", () => {
    hoverPaused = false;
    syncPausedClass();
  });

  // Explicit pause/play button. Toggling sticky-pause via the button
  // is more discoverable than "click anywhere on the panel" — and
  // avoids accidentally pausing when the user clicks to copy code.
  const pauseBtn = root.querySelector(".transpile-pause-btn");
  function syncPauseBtn() {
    if (!pauseBtn) return;
    pauseBtn.setAttribute("aria-pressed", clickPaused ? "true" : "false");
    pauseBtn.setAttribute("aria-label", clickPaused ? "play" : "pause");
  }
  if (pauseBtn) {
    syncPauseBtn();
    pauseBtn.addEventListener("click", e => {
      e.stopPropagation();
      clickPaused = !clickPaused;
      syncPausedClass();
      syncPauseBtn();
    });
  }

  // ─── Animation loop ───────────────────────────────────────────────
  let cancelled = false;
  let running = false;
  let currentIdx = 0;
  // When a progress dot is clicked, the in-flight snippet is cancelled
  // and the loop reads pendingJumpIdx as the next index instead of
  // advancing naturally. Distinguishes jump-cancel from stop-cancel.
  let pendingJumpIdx = null;

  // `activeTab` + `activeSnippets()` are declared above (right after
  // the `snippets` array) so the early `renderProgress(0)` call can
  // see them without tripping the `let` temporal-dead-zone.

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  // pausableSleep accumulates only unpaused time. Used for HOLD_MS only
  // — pause is "stop autoplay," not "freeze everything," so animations
  // (typing, evaporate, timer) run through real wall-clock time and only
  // the post-typing read beat extends when paused.
  async function pausableSleep(ms) {
    let elapsed = 0;
    let lastTick = performance.now();
    while (!cancelled) {
      const now = performance.now();
      if (!isPaused()) elapsed += now - lastTick;
      lastTick = now;
      if (elapsed >= ms) return;
      await sleep(50);
    }
  }
  async function waitWhilePaused() {
    while (isPaused() && !cancelled) await sleep(60);
  }

  async function typeOut(el, text, isPara, charDelay) {
    // Pause does NOT halt typing — pause only affects autoplay (the
    // post-typing HOLD beat that would auto-advance to the next snippet).
    // Animations always play through; the slideshow just stops cycling.
    for (let i = 1; i <= text.length; i++) {
      if (cancelled) return;
      el.innerHTML = highlight(text.slice(0, i), isPara) + caret;
      const ch = text[i - 1];
      // Whitespace types fast so indentation doesn't drag the eye.
      const delay = ch === " " || ch === "\n" ? Math.max(2, charDelay / 4) : charDelay;
      await sleep(delay);
    }
    el.innerHTML = highlight(text, isPara);
  }

  // ─── Foldable regions ─────────────────────────────────────────────
  // Snippets opt in by setting `jsFolds`: a list of strings, one per `…`
  // placeholder in the output text. Each `…` becomes a clickable button
  // post-typing; clicking expands the matching body inline. The expanded
  // span is itself clickable to collapse back. Used by the schema demo
  // to hide the long `parse` + `schema` bodies behind toggles.
  function makeFoldBtn(body, isPara) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fold-btn";
    btn.textContent = "…";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "expand");
    btn.title = "click to expand";
    btn._foldBody = body;
    btn._foldIsPara = isPara;
    return btn;
  }

  function makeFoldBody(body, isPara) {
    const span = document.createElement("span");
    span.className = "fold-body";
    span.innerHTML = highlight(body, isPara);
    span.setAttribute("role", "button");
    span.setAttribute("aria-expanded", "true");
    span.setAttribute("aria-label", "collapse");
    span.title = "click to collapse";
    span._foldBody = body;
    span._foldIsPara = isPara;
    return span;
  }

  function installFolds(el, folds, isPara) {
    if (!folds || folds.length === 0) return;
    let i = 0;
    function walk(node) {
      if (i >= folds.length) return;
      if (node.nodeType === 3) {
        const text = node.nodeValue;
        const at = text.indexOf("…");
        if (at === -1) return;
        const before = text.slice(0, at);
        const after = text.slice(at + 1);
        const parent = node.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(makeFoldBtn(folds[i++], isPara), node);
        const tail = document.createTextNode(after);
        parent.insertBefore(tail, node);
        parent.removeChild(node);
        walk(tail);
      } else if (
        node.nodeType === 1 &&
        !node.classList?.contains("fold-btn") &&
        !node.classList?.contains("fold-body")
      ) {
        for (const child of [...node.childNodes]) walk(child);
      }
    }
    walk(el);
  }

  outputEl.addEventListener("click", e => {
    const btn = e.target.closest(".fold-btn");
    if (btn && outputEl.contains(btn)) {
      e.stopPropagation();
      btn.replaceWith(makeFoldBody(btn._foldBody, btn._foldIsPara));
      return;
    }
    const span = e.target.closest(".fold-body");
    if (span && outputEl.contains(span)) {
      e.stopPropagation();
      span.replaceWith(makeFoldBtn(span._foldBody, span._foldIsPara));
    }
  });

  // Walk all text nodes inside `el` and wrap each non-whitespace char
  // in a `.evap` span with --i (sequence index) and --r (random 0..1)
  // so the CSS evaporate animation can stagger + scatter each glyph.
  // Preserves existing color spans by walking the tree, not the string.
  function wrapForEvaporation(el, startIdx) {
    let i = startIdx;
    function walk(node) {
      if (node.nodeType === 3) {
        const text = node.nodeValue;
        if (!text) return;
        const frag = document.createDocumentFragment();
        for (const ch of text) {
          if (ch === " " || ch === "\n" || ch === "\t") {
            frag.appendChild(document.createTextNode(ch));
          } else {
            const span = document.createElement("span");
            span.className = "evap";
            span.style.setProperty("--i", String(i++));
            span.style.setProperty("--r", Math.random().toFixed(3));
            span.textContent = ch;
            frag.appendChild(span);
          }
        }
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        for (const child of [...node.childNodes]) walk(child);
      }
    }
    walk(el);
    return i;
  }

  async function evaporate() {
    // Joint sequence index across both panes so the dissolve looks
    // like one wave moving across the whole panel, not two parallel.
    let idx = 0;
    idx = wrapForEvaporation(sourceEl, idx);
    idx = wrapForEvaporation(outputEl, idx);
    root.classList.add("evaporating");
    // Wait for the longest scheduled glyph + its animation to finish.
    // Plain sleep (not pausableSleep): evaporate is an animation, not
    // autoplay — it plays through regardless of pause state.
    const total = idx * EVAP_STAGGER_MS + EVAP_DURATION_MS + 80;
    await sleep(total);
    root.classList.remove("evaporating");
    sourceEl.innerHTML = "";
    outputEl.innerHTML = "";
  }

  // Drive the bottom timer bar via CSS animation with a known
  // duration; restart it by toggling the class with a reflow gap.
  function startTimer(ms) {
    if (!timerEl) return;
    root.classList.remove("timing");
    timerEl.style.animationDuration = `${ms}ms`;
    // Force reflow so re-adding restarts the animation from 0.
    void timerEl.offsetWidth;
    root.classList.add("timing");
  }
  function stopTimer() {
    if (!timerEl) return;
    root.classList.remove("timing");
  }

  async function runSnippet(idx) {
    if (cancelled) return;
    const snip = activeSnippets()[idx];
    if (!snip) return; // active tab might have changed mid-flight
    sourceEl.innerHTML = "";
    outputEl.innerHTML = "";
    // A mid-evaporate cancel can leave .evaporating/.holding on the
    // root; clear them so the next snippet starts clean.
    root.classList.remove("evaporating");
    root.classList.remove("holding");
    // `.single` toggles the layout: hides the `→` arrow + the output
    // column, expands the source column to full panel width. Used by
    // Runtime demos (no parse-time desugar to display). The Lang
    // demos default to split-pane.
    root.classList.toggle("single", snip.mode === "single");
    // `.runtime-only` reveals the "parabun only" header badge for
    // snippets that use parabun:* modules. Separate flag from
    // `.single` because the mode-vs-category split is decoupled by
    // design — a future Lang demo could go single-pane, and a future
    // Runtime demo could fit a split-pane treatment.
    root.classList.toggle("runtime-only", snip.category === "runtime");
    // Source-pane file tag — defaults to `.pts` but each snippet can
    // override (e.g. the parabun:assistant snippet is plain `.ts`
    // since it uses no Para syntax). Lets the demo be honest about
    // when a parabun:* module works on stock TypeScript.
    if (sourceTagEl) sourceTagEl.textContent = snip.tag ?? ".pts";
    if (titleEl) titleEl.textContent = snip.name;
    renderProgress(idx);

    // Start the timer the moment text begins appearing so it tracks
    // the *whole* slide (typing + hold), not just the trailing hold.
    startTimer(snippetDurationMs(snip));

    await typeOut(sourceEl, snip.pts, true, TYPE_SOURCE_MS);
    if (cancelled) return;
    // Single-pane snippets stop here — no second pane to populate.
    // Split-pane snippets continue: pause briefly, then type the JS
    // desugar in the right pane, then install fold buttons if any.
    if (snip.mode !== "single") {
      // Tween between source-typed and output-typing-starts is part
      // of the animation phase, so it doesn't pause; only the HOLD
      // beat below does.
      await sleep(PRE_OUTPUT_MS);
      await typeOut(outputEl, snip.js, false, TYPE_OUTPUT_MS);
      if (cancelled) return;
      installFolds(outputEl, snip.jsFolds, false);
    }

    // Hold for the read-and-compare beat. .holding gates the timer's
    // CSS pause rule so the bar only freezes once we're actually in the
    // pausable autoplay beat — not during the preceding type-in.
    root.classList.add("holding");
    await pausableSleep(HOLD_MS);
    root.classList.remove("holding");
    stopTimer();
    if (cancelled) return;

    // Evaporative transition out of this snippet.
    await evaporate();
  }

  async function loop() {
    if (running) return;
    running = true;
    cancelled = false;
    while (true) {
      await runSnippet(currentIdx);

      if (pendingJumpIdx !== null) {
        // Jump-cancel: pick up the requested snippet and keep looping.
        currentIdx = pendingJumpIdx;
        pendingJumpIdx = null;
        cancelled = false;
        continue;
      }
      if (cancelled) break; // stop-cancel: terminate the loop.
      // Advance within the active tab's pool, not the global list.
      currentIdx = (currentIdx + 1) % activeSnippets().length;
    }
    running = false;
  }

  function stop() {
    pendingJumpIdx = null;
    cancelled = true;
  }

  function jumpTo(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= activeSnippets().length) return;
    if (idx === currentIdx && running) return;
    pendingJumpIdx = idx;
    cancelled = true;
    // If the user pinned the demo via the pause button, jumping should
    // play the new snippet — otherwise the click does nothing visible.
    if (clickPaused) {
      clickPaused = false;
      syncPausedClass();
      syncPauseBtn();
    }
  }

  function isActive() {
    return document.body.dataset.hero === "transpile";
  }
  function react() {
    if (isActive()) loop();
    else stop();
  }

  // Tab-switch logic removed when the reel was recombined into a
  // single continuous cycle. Color-coded dots (set by
  // `renderProgress` via `data-category`) now telegraph upcoming
  // demo type without separating the pools.

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const s = snippets[0];
    root.classList.toggle("single", s.mode === "single");
    root.classList.toggle("runtime-only", s.category === "runtime");
    if (sourceTagEl) sourceTagEl.textContent = s.tag ?? ".pts";
    sourceEl.innerHTML = highlight(s.pts, true);
    if (s.mode !== "single") {
      outputEl.innerHTML = highlight(s.js, false);
      installFolds(outputEl, s.jsFolds, false);
    }
    if (titleEl) titleEl.textContent = s.name;
    renderProgress(0);
    return;
  }

  new MutationObserver(react).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-hero"],
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", react);
  } else {
    react();
  }
})();
