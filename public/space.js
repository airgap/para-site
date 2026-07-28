// Atmospheric splash backdrop: three ghost-palette nebulae (will-o-
// wisp green, spectral blue, moonlight white) that drift across the
// splash on slow phased sine loops.
//
// Drift was added 2026-05-11 after the corner-anchored static
// version read as "three colors in three corners" instead of a
// chromatic atmosphere. Each nebula now wanders within a wide
// elliptical envelope (~0.4 of the viewport) at sub-Hz frequencies
// — full cycles take 60-110 s per axis, so the motion is unhurried
// rather than swimming. `prefers-reduced-motion: reduce` short-
// circuits to a single static draw so the page stays accessible.
//
// Earlier revs also drew a fixed starfield (later black "void
// specks" against the aurora). Removed because the dots read as
// dust rather than stars on most displays; the nebulae alone now
// carry the atmosphere.
(() => {
  const SEED = 4242;

  const canvas = document.createElement("canvas");
  canvas.id = "__space";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: -10;
  `;
  function mount() {
    if (document.body) document.body.insertBefore(canvas, document.body.firstChild);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // Ghost-palette nebulae that drift across the splash on slow
  // phased sine loops. Three blobs (will-o-wisp green, spectral
  // blue, moonlight white) — warmer hues (red/violet/gold) were
  // dropped 2026-05-11 in favor of an all-cool "haunted" mood.
  // Brand colors still live in the lang/runtime cards; the
  // splash atmospherics are intentionally desaturated and cool.
  // Each blob's phased motion (different frequencies / starting
  // offsets per axis) means the visible color at any point is a
  // varying mix rather than a single corner-locked region.
  //
  // baseX/baseY = wander origin in canvas-fraction units.
  // ampX/ampY  = how far each nebula drifts from its origin.
  // freqX/freqY = cycles per second on each axis (very slow, ~0.01-0.02 ≈ 50-100 s).
  // phaseX/phaseY = starting offset so blobs don't peak together.
  const nebulae = [
    {
      baseX: 0.25,
      baseY: 0.3,
      ampX: 0.45,
      ampY: 0.35,
      freqX: 0.014,
      freqY: 0.011,
      phaseX: 0.0,
      phaseY: 1.7,
      rx: 0.95,
      ry: 0.85,
      color: [228, 234, 240],
      alpha: 0.16,
    },
    {
      baseX: 0.55,
      baseY: 0.7,
      ampX: 0.4,
      ampY: 0.3,
      freqX: 0.01,
      freqY: 0.015,
      phaseX: 2.3,
      phaseY: 0.4,
      rx: 0.85,
      ry: 0.8,
      color: [140, 220, 187],
      alpha: 0.14,
    },
    {
      baseX: 0.7,
      baseY: 0.25,
      ampX: 0.35,
      ampY: 0.4,
      freqX: 0.017,
      freqY: 0.009,
      phaseX: 4.1,
      phaseY: 3.0,
      rx: 0.95,
      ry: 0.85,
      color: [112, 184, 226],
      alpha: 0.15,
    },
  ];

  // Stars removed — earlier revs drew black silhouettes ("void
  // specks") to read as dark holes against the aurora, but they
  // ended up looking like dust on the screen on most displays. The
  // background is now just the drifting nebulae. `makeRng` stays
  // initialized so future star-like passes can reuse the seeded
  // RNG; no current consumers.
  const rng = makeRng(SEED);
  void rng; // silence unused-var lint until the next pass needs it

  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    // Force a render with the current animation time so the canvas
    // doesn't go blank during the resize gap. The RAF loop will
    // pick it up on the next frame either way.
    render(currentTime);
  }

  // Time origin so `t` is small and sin() arguments stay numerically
  // tame across long sessions. `currentTime` is the last value used
  // for rendering — exposed so `resize()` can re-render at the same
  // moment in the cycle.
  const t0 = performance.now();
  let currentTime = 0;
  const reducedMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frame(now) {
    currentTime = (now - t0) / 1000;
    render(currentTime);
    if (!reducedMotion) requestAnimationFrame(frame);
  }

  function render(t) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Sizing reference is `vmax` (larger of width/height) — vmin
    // would shrink the nebulae to narrow color bands on widescreen
    // displays.
    const vmax = Math.max(cssWidth, cssHeight);

    // Nebulae first. Position is `base + amp * sin(2π·freq·t + phase)`
    // per axis — independent X/Y frequencies and phase offsets keep
    // the three blobs from synchronizing into a parade. With three
    // blobs at offset phases, the visible color at any point is a
    // varying mix, not a "this corner is gold" composition.
    for (const n of nebulae) {
      const nx = n.baseX + n.ampX * Math.sin(2 * Math.PI * n.freqX * t + n.phaseX);
      const ny = n.baseY + n.ampY * Math.sin(2 * Math.PI * n.freqY * t + n.phaseY);
      const cx = nx * cssWidth;
      const cy = ny * cssHeight;
      const rx = n.rx * vmax;
      const ry = n.ry * vmax;
      const r = Math.max(rx, ry);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx / r, ry / r);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      const [cr, cg, cb] = n.color;
      // Approximate gaussian falloff with eight color stops so the
      // alpha derivative tapers continuously to zero — too few stops
      // (or a sharp last-mile) produce a visible Mach band right at
      // the radius. The 0.78-1.0 stretch is dedicated to the long
      // tail where alpha is < 1% so the edge fades into the bg.
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${n.alpha})`);
      grad.addColorStop(0.12, `rgba(${cr},${cg},${cb},${n.alpha * 0.78})`);
      grad.addColorStop(0.26, `rgba(${cr},${cg},${cb},${n.alpha * 0.5})`);
      grad.addColorStop(0.42, `rgba(${cr},${cg},${cb},${n.alpha * 0.28})`);
      grad.addColorStop(0.58, `rgba(${cr},${cg},${cb},${n.alpha * 0.13})`);
      grad.addColorStop(0.74, `rgba(${cr},${cg},${cb},${n.alpha * 0.05})`);
      grad.addColorStop(0.88, `rgba(${cr},${cg},${cb},${n.alpha * 0.012})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }

    // Stars were drawn here in earlier revs (black silhouettes
    // wandering on per-star sine phases). Removed because the dark
    // dots read more like screen dust than celestial bodies. The
    // nebulae alone carry the splash atmosphere now.
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 80);
  });

  function start() {
    resize();
    if (reducedMotion) {
      // Single static draw at t = 0. Same look every refresh —
      // accessibility users get a consistent backdrop without motion.
      render(0);
    } else {
      requestAnimationFrame(frame);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
