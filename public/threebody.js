// Chenciner-Montgomery figure-8 — the stable periodic 3-body orbit
// where all three equal-mass bodies trace the same closed figure-8
// curve, chasing each other at 1/3 phase offsets. ICs and constants
// from the 1993 paper:
//   Body 1:  x = (+0.97000436, -0.24308753),  v = (+0.46620369, +0.43236573)
//   Body 2:  x = (-0.97000436, +0.24308753),  v = (+0.46620369, +0.43236573)
//   Body 3:  x = (        0  ,         0  ),  v = (-0.93240737, -0.86473146)
//   Period T ≈ 6.3259, with G = 1 and m_i = 1.
//
// Integrator: velocity Verlet — 2nd-order symplectic, stays on the
// orbit for thousands of periods. Smaller dt (~T / 800) keeps the
// figure-8 visually clean indefinitely.

(() => {
  const canvas = document.querySelector("canvas.three-body");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Star palette pulled off the page CSS so it always matches the
  // body brand colors.
  const css = getComputedStyle(document.documentElement);
  const C = [
    css.getPropertyValue("--star-lib").trim() || "#6db4ff",
    css.getPropertyValue("--star-lang").trim() || "#ffd54a",
    css.getPropertyValue("--star-runtime").trim() || "#ff5c4a",
  ];

  // Match the canvas backing buffer to its CSS box at the device pixel
  // ratio so the figure-8 stays sharp on retina + scales with viewport.
  function fit() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  addEventListener("resize", fit);

  // Bodies: position (x, y), velocity (vx, vy).
  const bodies = [
    { x: 0.97000436, y: -0.24308753, vx: 0.46620369, vy: 0.43236573 },
    { x: -0.97000436, y: 0.24308753, vx: 0.46620369, vy: 0.43236573 },
    { x: 0, y: 0, vx: -0.93240737, vy: -0.86473146 },
  ];

  // Trail history per body — fades from full color (newest) to
  // transparent (oldest), gives the figure-8 a sense of motion.
  const TRAIL_LEN = 220;
  const trails = bodies.map(() => []);

  function accel(at) {
    const ax = [0, 0, 0];
    const ay = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const dx = at[j].x - at[i].x;
        const dy = at[j].y - at[i].y;
        const r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2);
        // F = G m_j m_i / r^2 * unit(d), with G = m = 1
        // => a_i += dx / r^3
        const inv3 = 1 / (r2 * r);
        ax[i] += dx * inv3;
        ay[i] += dy * inv3;
      }
    }
    return [ax, ay];
  }

  // Velocity Verlet: x_{n+1} = x_n + v_n dt + ½ a_n dt²,
  //                  v_{n+1} = v_n + ½ (a_n + a_{n+1}) dt
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
  }

  // Sub-step the integrator several times per displayed frame so the
  // figure-8 stays on track even when rAF drops to ~30 Hz under load.
  // Period ≈ 6.3259 → SUB_STEPS * DT * 60 fps ≈ ~12s per orbit feels
  // like the right pace for a passive splash.
  const DT = 0.0032;
  const SUB_STEPS = 6;

  // Figure-8 bounding box in sim units. Trajectory reaches roughly
  // ±1.05 horizontal × ±0.36 vertical; PAD adds a small margin so
  // the heads don't graze the canvas edge.
  const HALF_W = 1.15;
  const HALF_H = 0.42;

  function render() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    // Pick the larger uniform scale that still fits the figure-8 in
    // both dimensions. With aspect-ratio: 2.75 the two axes typically
    // come out close to each other; this keeps the orbit aspect-
    // correct under any canvas size.
    const s = Math.min(w / (2 * HALF_W), h / (2 * HALF_H));

    ctx.clearRect(0, 0, w, h);

    // Draw trails first so heads sit on top.
    for (let i = 0; i < 3; i++) {
      const trail = trails[i];
      const color = C[i];
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let k = 1; k < trail.length; k++) {
        const a = trail[k - 1];
        const b = trail[k];
        const t = k / trail.length; // 0 = oldest, 1 = newest
        ctx.strokeStyle = withAlpha(color, t * 0.55);
        ctx.lineWidth = 0.5 + t * 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + a.x * s, cy + a.y * s);
        ctx.lineTo(cx + b.x * s, cy + b.y * s);
        ctx.stroke();
      }
    }

    // Star heads with a soft glow halo.
    for (let i = 0; i < 3; i++) {
      const b = bodies[i];
      const px = cx + b.x * s;
      const py = cy + b.y * s;
      const halo = ctx.createRadialGradient(px, py, 0, px, py, 16);
      halo.addColorStop(0, withAlpha(C[i], 0.7));
      halo.addColorStop(1, withAlpha(C[i], 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C[i];
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Hex (#rrggbb) → rgba helper. Trails want per-segment alpha; the
  // CSS vars are hex so we parse once per call.
  function withAlpha(hex, a) {
    const c = hex.startsWith("#") ? hex.slice(1) : hex;
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  let running = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) running = false;

  function tick() {
    if (running) {
      for (let s = 0; s < SUB_STEPS; s++) step(DT);
      for (let i = 0; i < 3; i++) {
        const t = trails[i];
        t.push({ x: bodies[i].x, y: bodies[i].y });
        if (t.length > TRAIL_LEN) t.shift();
      }
    }
    render();
    requestAnimationFrame(tick);
  }
  // Seed trails with the starting position so the first frame has
  // something visible while the integrator winds up.
  for (let i = 0; i < 3; i++) trails[i].push({ x: bodies[i].x, y: bodies[i].y });
  render();
  requestAnimationFrame(tick);
})();
