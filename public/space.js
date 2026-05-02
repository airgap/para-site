// Full-viewport starfield + three nebulae for the umbrella splash —
// one nebula per product (blue / yellow / red, matching the trinity).
// Replaces the body::before CSS gradient pile with a single canvas
// that's prettier (proper random distribution, gaussian falloff
// without 8-bit Mach bands) and DPR-aware.
//
// Static — no scroll parallax — because the umbrella is a single-
// screen splash. Only resize triggers a redraw.
(() => {
  const SEED = 4242; // distinct from runtime's 1337
  const STAR_COUNT = 260;

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

  // Three nebulae, one per product. Sized large with a long, gentle
  // alpha tail so they bleed into each other instead of showing
  // visible "junction" lines where two nebulae meet. Positions push
  // each color toward its own corner; the overlap is the tinted
  // ambient in between.
  const nebulae = [
    // Lib (blue) — top-left
    { x: 0.05, y: 0.15, rx: 0.95, ry: 0.85, color: [109, 180, 255], alpha: 0.18 },
    // Lang (yellow) — bottom-center
    { x: 0.5, y: 1.05, rx: 0.85, ry: 0.8, color: [255, 213, 74], alpha: 0.13 },
    // Runtime (red) — top-right
    { x: 0.95, y: 0.12, rx: 0.95, ry: 0.85, color: [255, 92, 74], alpha: 0.17 },
  ];

  // Stars. Three brightness tiers; color mostly warm-white with a
  // sprinkle of trinity-tinted (blue / yellow / red) accents.
  const rng = makeRng(SEED);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = rng();
    let radius, alpha, halo;
    if (r > 0.985) {
      radius = 1.8 + rng() * 1.2;
      alpha = 0.5 + rng() * 0.1;
      halo = true;
    } else if (r > 0.94) {
      radius = 1.1 + rng() * 0.6;
      alpha = 0.4 + rng() * 0.15;
      halo = true;
    } else {
      radius = 0.5 + rng() * 0.6;
      alpha = 0.2 + rng() * 0.25;
      halo = false;
    }
    const ct = rng();
    let color;
    if (ct > 0.96)
      color = [109, 180, 255]; // blue accent
    else if (ct > 0.93)
      color = [255, 213, 74]; // yellow accent
    else if (ct > 0.91)
      color = [255, 92, 74]; // red accent
    else color = [255, 250, 240]; // warm white default
    stars.push({ x: rng(), y: rng(), radius, alpha, halo, color });
  }

  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    render();
  }

  function render() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Nebulae first. Sized by vmin so their shape stays round (the
    // ellipse rx/ry ratio governs aspect) regardless of viewport.
    const vmin = Math.min(cssWidth, cssHeight);
    for (const n of nebulae) {
      const cx = n.x * cssWidth;
      const cy = n.y * cssHeight;
      const rx = n.rx * vmin;
      const ry = n.ry * vmin;
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

    // Stars on top.
    for (const s of stars) {
      const x = s.x * cssWidth;
      const y = s.y * cssHeight;
      const [cr, cg, cb] = s.color;
      if (s.halo) {
        // 2× halo extent matches the static SVG-style glow without
        // bloating the visible star size.
        const haloR = s.radius * 2;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, haloR);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${s.alpha})`);
        grad.addColorStop(0.25, `rgba(${cr},${cg},${cb},${s.alpha * 0.35})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, haloR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${s.alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 80);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resize);
  } else {
    resize();
  }
})();
