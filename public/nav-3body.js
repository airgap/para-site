// Nav-badge 3-body simulation, 3D. Each landing page (and the docs
// SiteTitle) embeds <canvas class="nav-3body" data-current="lib"|
// "lang"|"runtime"> in place of the old binary-star SVG. The "current"
// star is heavier (mass 4) and renders larger; the other two bodies
// orbit around it with the trinity colors.
//
// Three real spatial dimensions: gravity acts on (x, y, z) and bodies
// have non-zero z extent in their initial conditions so the orbit
// doesn't degenerate into a plane. Render uses a tilted-orthographic
// camera (rotate around x-axis by CAM_TILT, then drop the depth
// coordinate) so out-of-plane motion appears as up/down dip in the
// projected y. Body radius and trail width scale with depth so the
// nearer body reads as closer.
//
// Boundary handling: when a body wanders past R_MAX from the centroid
// of the OTHER two AND is still moving outward, the radial component
// of its 3D velocity flips. Elastic, KE-preserving, keeps the system
// bound without relying on heavy softening.
(() => {
  const STARS = {
    lib: "#6db4ff",
    lang: "#ffd54a",
    runtime: "#ff5c4a",
  };

  // Camera tilt around the x-axis. 0 = pure top-down (no z parallax,
  // looks 2D). π/2 = pure side-on (no y motion visible). 25° picks up
  // out-of-plane motion clearly without distorting the orbit shape.
  const CAM_TILT = (Math.PI / 180) * 25;
  const COS_T = Math.cos(CAM_TILT);
  const SIN_T = Math.sin(CAM_TILT);

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

    // 3D ICs. Heavy at origin (zero velocity — it's the anchor), two
    // light bodies on randomized 3D shells around it with roughly
    // tangential velocities so each session starts with a different
    // orbit. Each light body picks a random unit direction (uniform
    // on the sphere via inverse-CDF on z) and a random radius in
    // [0.7, 1.0]. Velocity direction is the cross product of the
    // position vector with a random fixed-up axis — guarantees a
    // non-radial component (otherwise we'd have a pure radial fall).
    function rand(min, max) {
      return min + Math.random() * (max - min);
    }
    function randomLight() {
      const r = rand(0.7, 1.0);
      const cosTheta = rand(-1, 1);
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const phi = rand(0, Math.PI * 2);
      const x = r * sinTheta * Math.cos(phi);
      const y = r * sinTheta * Math.sin(phi);
      const z = r * cosTheta * 0.4; // squash z slightly so the orbit reads in-plane-ish
      // Tangential velocity: cross(pos, axis) where axis is jittered
      // each time so the two lights aren't co-planar.
      const ax = rand(-1, 1);
      const ay = rand(-1, 1);
      const az = rand(-1, 1);
      let vx = y * az - z * ay;
      let vy = z * ax - x * az;
      let vz = x * ay - y * ax;
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const vTarget = rand(1.7, 2.2);
      vx = (vx / vMag) * vTarget;
      vy = (vy / vMag) * vTarget;
      vz = (vz / vMag) * vTarget;
      return { x, y, z, vx, vy, vz };
    }
    const bodies = [{ x: 0.0, y: 0.0, z: 0.0, vx: 0.0, vy: 0.0, vz: 0.0 }, randomLight(), randomLight()];

    function recenter() {
      const totalM = M[0] + M[1] + M[2];
      let cx = 0,
        cy = 0,
        cz = 0,
        vx = 0,
        vy = 0,
        vz = 0;
      for (let i = 0; i < 3; i++) {
        cx += bodies[i].x * M[i];
        cy += bodies[i].y * M[i];
        cz += bodies[i].z * M[i];
        vx += bodies[i].vx * M[i];
        vy += bodies[i].vy * M[i];
        vz += bodies[i].vz * M[i];
      }
      cx /= totalM;
      cy /= totalM;
      cz /= totalM;
      vx /= totalM;
      vy /= totalM;
      vz /= totalM;
      for (let i = 0; i < 3; i++) {
        bodies[i].x -= cx;
        bodies[i].y -= cy;
        bodies[i].z -= cz;
        bodies[i].vx -= vx;
        bodies[i].vy -= vy;
        bodies[i].vz -= vz;
      }
    }

    function accel(at) {
      const ax = [0, 0, 0];
      const ay = [0, 0, 0];
      const az = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          const dx = at[j].x - at[i].x;
          const dy = at[j].y - at[i].y;
          const dz = at[j].z - at[i].z;
          // Softening — close approaches in 3D would otherwise blow
          // up at this dt. ε² = 0.04 is small enough that the orbit
          // shape is dominated by real gravity.
          const r2 = dx * dx + dy * dy + dz * dz + 0.04;
          const r = Math.sqrt(r2);
          const inv3 = M[j] / (r2 * r);
          ax[i] += dx * inv3;
          ay[i] += dy * inv3;
          az[i] += dz * inv3;
        }
      }
      return [ax, ay, az];
    }

    function step(dt) {
      const [ax, ay, az] = accel(bodies);
      for (let i = 0; i < 3; i++) {
        bodies[i].x += bodies[i].vx * dt + 0.5 * ax[i] * dt * dt;
        bodies[i].y += bodies[i].vy * dt + 0.5 * ay[i] * dt * dt;
        bodies[i].z += bodies[i].vz * dt + 0.5 * az[i] * dt * dt;
      }
      const [ax2, ay2, az2] = accel(bodies);
      for (let i = 0; i < 3; i++) {
        bodies[i].vx += 0.5 * (ax[i] + ax2[i]) * dt;
        bodies[i].vy += 0.5 * (ay[i] + ay2[i]) * dt;
        bodies[i].vz += 0.5 * (az[i] + az2[i]) * dt;
      }
      // 3D elastic reflection at the boundary: same scheme as before
      // but with z folded into the radial check + reflection. R_MAX
      // is the maximum distance from the centroid of the OTHER two
      // bodies before the radial component flips. 3.75 = 3× the
      // canvas half-extent — bodies can swing well beyond the visible
      // badge area before bouncing, which lets the chaotic dynamics
      // breathe between reflections.
      const R_MAX = 3.75;
      for (let i = 0; i < 3; i++) {
        let cx = 0,
          cy = 0,
          cz = 0,
          mTot = 0;
        for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          cx += bodies[j].x * M[j];
          cy += bodies[j].y * M[j];
          cz += bodies[j].z * M[j];
          mTot += M[j];
        }
        cx /= mTot;
        cy /= mTot;
        cz /= mTot;
        const dx = bodies[i].x - cx;
        const dy = bodies[i].y - cy;
        const dz = bodies[i].z - cz;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < R_MAX * R_MAX) continue;
        const r = Math.sqrt(r2);
        const nx = dx / r;
        const ny = dy / r;
        const nz = dz / r;
        const vRad = bodies[i].vx * nx + bodies[i].vy * ny + bodies[i].vz * nz;
        if (vRad <= 0) continue;
        bodies[i].vx -= 2 * vRad * nx;
        bodies[i].vy -= 2 * vRad * ny;
        bodies[i].vz -= 2 * vRad * nz;
      }
    }

    const TRAIL_LEN = 28;
    const trails = bodies.map(() => []);
    const DT = 0.006;
    const SUB = 4;
    const HALF = 1.45;

    // Project sim coords (x, y, z) to screen. Camera tilt is around
    // the x-axis: y_world rotates into y_screen + z_depth. Returns
    // {sx, sy, depth} where depth is the camera-relative z (higher =
    // closer to camera) used for size scaling and z-sorting.
    function project(p) {
      const yp = p.y * COS_T - p.z * SIN_T;
      const depth = p.y * SIN_T + p.z * COS_T;
      return { sx: p.x, sy: yp, depth };
    }

    function render() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const s = Math.min(w, h) / (2 * HALF);

      ctx.clearRect(0, 0, w, h);

      // Trails (projected). Drawn first so heads sit on top. Width
      // scales lightly with depth so closer segments feel weightier.
      for (let i = 0; i < 3; i++) {
        const t = trails[i];
        const color = COLORS[i];
        for (let k = 1; k < t.length; k++) {
          const a = project(t[k - 1]);
          const b = project(t[k]);
          const f = k / t.length;
          const depthScale = 1 + 0.35 * b.depth;
          ctx.strokeStyle = withAlpha(color, f * 0.6);
          ctx.lineWidth = (0.5 + f * (i === 0 ? 1.2 : 0.7)) * depthScale;
          ctx.beginPath();
          ctx.moveTo(cx + a.sx * s, cy + a.sy * s);
          ctx.lineTo(cx + b.sx * s, cy + b.sy * s);
          ctx.stroke();
        }
      }

      // Heads — z-sort so the nearer body draws on top of the farther
      // one. Body size scales with depth so the parallax feels real.
      const heads = bodies.map((b, i) => ({ b, i, p: project(b) }));
      heads.sort((a, b) => a.p.depth - b.p.depth); // far → near
      for (const h of heads) {
        const px = cx + h.p.sx * s;
        const py = cy + h.p.sy * s;
        const depthScale = 1 + 0.35 * h.p.depth;
        const baseR = h.i === 0 ? 3.4 : 1.8;
        const baseHalo = h.i === 0 ? 8 : 4;
        const radius = baseR * depthScale;
        const haloR = baseHalo * depthScale;
        const halo = ctx.createRadialGradient(px, py, 0, px, py, haloR);
        halo.addColorStop(0, withAlpha(COLORS[h.i], 0.7));
        halo.addColorStop(1, withAlpha(COLORS[h.i], 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS[h.i];
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
          t.push({ x: bodies[i].x, y: bodies[i].y, z: bodies[i].z });
          if (t.length > TRAIL_LEN) t.shift();
        }
        if ((++frame & 31) === 0) recenter();
      }
      render();
      requestAnimationFrame(tick);
    }
    addEventListener("resize", fit);
    for (let i = 0; i < 3; i++) trails[i].push({ x: bodies[i].x, y: bodies[i].y, z: bodies[i].z });
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
