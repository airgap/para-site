// Nav-badge 3-body simulation. Each landing page (and the docs
// SiteTitle) embeds <canvas class="nav-3body" data-current="lib"|
// "lang"|"runtime"> in place of the old binary-star SVG. The "current"
// star is heavier (mass 4) and renders larger; the other two bodies
// orbit around it with the trinity colors.
//
// Unlike the figure-8 splash sim (equal-mass, periodic), this one runs
// asymmetric gravity → the lighter bodies trace messier paths that
// drift over time. Velocity Verlet keeps it well-behaved at small
// dt; we never let bodies escape the canvas because the heavy mass
// dominates the binding energy.
(() => {
  const STARS = {
    lib: "#6db4ff",
    lang: "#ffd54a",
    runtime: "#ff5c4a",
  };

  function paint(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const current = (canvas.dataset.current || "lib").toLowerCase();
    if (!STARS[current]) return;

    function fit() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fit();

    // Order: [current/heavy, other-A, other-B]. Color and mass per body.
    const order = [current, ...Object.keys(STARS).filter(k => k !== current)];
    const COLORS = order.map(k => STARS[k]);
    const M = [4, 1, 1];

    // Initial conditions chosen so the binding energy keeps everything
    // inside ~|r|<1.4 over thousands of frames. Heavy at origin, two
    // lighter bodies counter-rotating at slightly different radii so
    // their orbital periods differ and the visual never repeats.
    const bodies = [
      { x: 0.0, y: 0.0, vx: 0.0, vy: 0.0 },
      { x: -0.85, y: 0.0, vx: 0.0, vy: 1.95 },
      { x: 0.6, y: 0.35, vx: -0.4, vy: -2.25 },
    ];

    // Recenter periodically so net momentum drift doesn't push the
    // system off-screen. (If it weren't for floating-point error,
    // momentum would stay zero forever.)
    function recenter() {
      const totalM = M[0] + M[1] + M[2];
      let cx = 0,
        cy = 0,
        vx = 0,
        vy = 0;
      for (let i = 0; i < 3; i++) {
        cx += bodies[i].x * M[i];
        cy += bodies[i].y * M[i];
        vx += bodies[i].vx * M[i];
        vy += bodies[i].vy * M[i];
      }
      cx /= totalM;
      cy /= totalM;
      vx /= totalM;
      vy /= totalM;
      for (let i = 0; i < 3; i++) {
        bodies[i].x -= cx;
        bodies[i].y -= cy;
        bodies[i].vx -= vx;
        bodies[i].vy -= vy;
      }
    }

    function accel(at) {
      const ax = [0, 0, 0];
      const ay = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          const dx = at[j].x - at[i].x;
          const dy = at[j].y - at[i].y;
          // Softening epsilon — close approaches between the light
          // bodies otherwise blow up at this dt. 0.04 is small enough
          // that the orbit shape is dominated by real gravity.
          const r2 = dx * dx + dy * dy + 0.04;
          const r = Math.sqrt(r2);
          const inv3 = M[j] / (r2 * r);
          ax[i] += dx * inv3;
          ay[i] += dy * inv3;
        }
      }
      return [ax, ay];
    }

    function step(dt) {
      const [ax, ay] = accel(bodies);
      for (let i = 0; i < 3; i++) {
        bodies[i].x += bodies[i].vx * dt + 0.5 * ax[i] * dt * dt;
        bodies[i].y += bodies[i].vy * dt + 0.5 * ay[i] * dt * dt;
      }
      const [ax2, ay2] = accel(bodies);
      for (let i = 0; i < 3; i++) {
        bodies[i].vx += 0.5 * (ax[i] + ax2[i]) * dt;
        bodies[i].vy += 0.5 * (ay[i] + ay2[i]) * dt;
      }
      // Bound the system: if a body wanders past R_MAX from the
      // centroid of the other two AND is still moving outward, flip
      // the radial component of its velocity. Elastic reflection
      // preserves the body's KE while sending it back toward the
      // group. The "moving outward" guard prevents stuck oscillation
      // at the boundary if a body re-enters with low radial speed.
      const R_MAX = 1.25;
      for (let i = 0; i < 3; i++) {
        let cx = 0;
        let cy = 0;
        let mTot = 0;
        for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          cx += bodies[j].x * M[j];
          cy += bodies[j].y * M[j];
          mTot += M[j];
        }
        cx /= mTot;
        cy /= mTot;
        const dx = bodies[i].x - cx;
        const dy = bodies[i].y - cy;
        const r2 = dx * dx + dy * dy;
        if (r2 < R_MAX * R_MAX) continue;
        const r = Math.sqrt(r2);
        const nx = dx / r;
        const ny = dy / r;
        const vRad = bodies[i].vx * nx + bodies[i].vy * ny;
        if (vRad <= 0) continue; // already returning
        bodies[i].vx -= 2 * vRad * nx;
        bodies[i].vy -= 2 * vRad * ny;
      }
    }

    const TRAIL_LEN = 28;
    const trails = bodies.map(() => []);
    const DT = 0.006;
    const SUB = 4;
    // Sim coords roughly [-1.4, +1.4] → fit into canvas with a small
    // margin. With the same scale per axis the "shape" is preserved.
    const HALF = 1.45;

    function render() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const s = Math.min(w, h) / (2 * HALF);

      ctx.clearRect(0, 0, w, h);

      // Trails first (so heads sit on top).
      for (let i = 0; i < 3; i++) {
        const t = trails[i];
        const color = COLORS[i];
        for (let k = 1; k < t.length; k++) {
          const a = t[k - 1];
          const b = t[k];
          const f = k / t.length;
          ctx.strokeStyle = withAlpha(color, f * 0.6);
          ctx.lineWidth = 0.5 + f * (i === 0 ? 1.2 : 0.7);
          ctx.beginPath();
          ctx.moveTo(cx + a.x * s, cy + a.y * s);
          ctx.lineTo(cx + b.x * s, cy + b.y * s);
          ctx.stroke();
        }
      }

      // Heads. Heavy body bigger, both visually and via halo radius.
      for (let i = 0; i < 3; i++) {
        const b = bodies[i];
        const px = cx + b.x * s;
        const py = cy + b.y * s;
        const radius = i === 0 ? 3.4 : 1.8;
        const haloR = i === 0 ? 8 : 4;
        const halo = ctx.createRadialGradient(px, py, 0, px, py, haloR);
        halo.addColorStop(0, withAlpha(COLORS[i], 0.7));
        halo.addColorStop(1, withAlpha(COLORS[i], 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS[i];
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function withAlpha(hex, a) {
      const c = hex.startsWith("#") ? hex.slice(1) : hex;
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    let running = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function tick() {
      if (running) {
        for (let s = 0; s < SUB; s++) step(DT);
        for (let i = 0; i < 3; i++) {
          const t = trails[i];
          t.push({ x: bodies[i].x, y: bodies[i].y });
          if (t.length > TRAIL_LEN) t.shift();
        }
        if ((++frame & 31) === 0) recenter();
      }
      render();
      requestAnimationFrame(tick);
    }
    addEventListener("resize", fit);
    for (let i = 0; i < 3; i++) trails[i].push({ x: bodies[i].x, y: bodies[i].y });
    render();
    requestAnimationFrame(tick);
  }

  function init() {
    document.querySelectorAll("canvas.nav-3body").forEach(paint);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
