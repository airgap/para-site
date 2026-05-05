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
  if (!sourceEl || !outputEl) return;

  // Hand-curated snippets. Each pair shows one Para-distinctive
  // syntactic construct on the left and its standard-JS desugaring on
  // the right. Order = order they cycle in.
  const snippets = [
    {
      name: "promise chain (..>, ..!) + bare-dot lambda",
      pts: `fetch("/api/users")
  ..> .json()
  ..> .filter(.active)
  ..! err => log(err)`,
      js: `fetch("/api/users")
  .then(__pcv => __pcv.json())
  .then(__pcv => __pcv.filter(_ => _.active))
  .catch(err => log(err))`,
    },
    {
      name: "para const — fan-out with names",
      pts: `para const cpu = bench.cpu(),
            gpu = bench.gpu(),
            mem = bench.mem();`,
      js: `const [cpu, gpu, mem] = await Promise.all([
  bench.cpu(),
  bench.gpu(),
  bench.mem(),
]);`,
    },
    {
      name: "decimal literal",
      pts: `const rate = 0.0825d
const tax = subtotal * rate
const total = subtotal + tax`,
      js: `const rate = __paraDec("0.0825")
const tax = subtotal.mul(rate)
const total = subtotal.add(tax)`,
    },
    {
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
  ];

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
    const kw = isPara
      ? /\b(parallel|para|derived|signal|computed|pure|fn|const|let|return|await|new|class|if|else|true|false|null)\b/g
      : /\b(const|let|return|await|function|new|class|if|else|true|false|null)\b/g;
    const builtin = /\b(__pcv|__paraDec|Promise|then|catch|all)\b/g;

    h = h.replace(op, "\x01op\x02$1\x03");
    h = h.replace(kw, "\x01kw\x02$1\x03");
    h = h.replace(builtin, "\x01kw\x02$1\x03");
    h = h.replace(/("[^"\n]*")/g, "\x01str\x02$1\x03");
    h = h.replace(/\b(\d+(?:\.\d+)?)\b/g, "\x01num\x02$1\x03");
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
    return (
      estimateTypingMs(snip.pts, TYPE_SOURCE_MS) + PRE_OUTPUT_MS + estimateTypingMs(snip.js, TYPE_OUTPUT_MS) + HOLD_MS
    );
  }

  // ─── Progress dots ────────────────────────────────────────────────
  const progressEl = root.querySelector(".transpile-progress");
  const timerEl = root.querySelector(".transpile-timer-fill");
  function renderProgress(i) {
    if (!progressEl) return;
    progressEl.innerHTML = snippets
      .map((_, k) => `<span class="transpile-dot${k === i ? " active" : ""}"></span>`)
      .join("");
  }
  renderProgress(0);

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

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  // pausableSleep accumulates only unpaused time, so the JS clock
  // stays in lockstep with the CSS-animated timer/evap (both freeze
  // via animation-play-state: paused).
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
    for (let i = 1; i <= text.length; i++) {
      if (cancelled) return;
      await waitWhilePaused();
      if (cancelled) return;
      el.innerHTML = highlight(text.slice(0, i), isPara) + caret;
      const ch = text[i - 1];
      // Whitespace types fast so indentation doesn't drag the eye.
      const delay = ch === " " || ch === "\n" ? Math.max(2, charDelay / 4) : charDelay;
      await sleep(delay);
    }
    el.innerHTML = highlight(text, isPara);
  }

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
    const total = idx * EVAP_STAGGER_MS + EVAP_DURATION_MS + 80;
    await pausableSleep(total);
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

  async function runOnce() {
    for (let idx = 0; idx < snippets.length; idx++) {
      if (cancelled) return;
      const snip = snippets[idx];
      sourceEl.innerHTML = "";
      outputEl.innerHTML = "";
      if (titleEl) titleEl.textContent = snip.name;
      renderProgress(idx);

      // Start the timer the moment text begins appearing so it tracks
      // the *whole* slide (typing + hold), not just the trailing hold.
      startTimer(snippetDurationMs(snip));

      await typeOut(sourceEl, snip.pts, true, TYPE_SOURCE_MS);
      if (cancelled) return;
      await pausableSleep(PRE_OUTPUT_MS);
      await typeOut(outputEl, snip.js, false, TYPE_OUTPUT_MS);
      if (cancelled) return;

      // Hold for the read-and-compare beat. The timer continues
      // draining without restart — it was already mid-flight from
      // the start of typing.
      await pausableSleep(HOLD_MS);
      stopTimer();
      if (cancelled) return;

      // Evaporative transition out of this snippet.
      await evaporate();
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    cancelled = false;
    while (!cancelled) {
      await runOnce();
    }
    running = false;
  }

  function stop() {
    cancelled = true;
  }

  function isActive() {
    return document.body.dataset.hero === "transpile";
  }
  function react() {
    if (isActive()) loop();
    else stop();
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const s = snippets[0];
    sourceEl.innerHTML = highlight(s.pts, true);
    outputEl.innerHTML = highlight(s.js, false);
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
