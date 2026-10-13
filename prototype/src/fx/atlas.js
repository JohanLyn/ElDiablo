import * as THREE from 'three';

// Procedural texture atlas (4x4 cells of 256px). RGB is white, the alpha
// channel is the mask; particle colour comes from the instance, so one atlas
// serves every tint. Built once at startup.
export const F = {
  DOT: 0, STAR: 1, SMOKE: 2, FLAME: 3, RING: 4, WAVE: 5, GLYPH_A: 6, GLYPH_B: 7,
  CRACK: 8, SCORCH: 9, SHARD: 10, STREAK: 11, WISP: 12, GLINT: 13, PLUS: 14, GLOW_RING: 15,
};
const CELL = 256;
const GRID = 4;

function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += vnoise(x, y) * a; x *= 2.03; y *= 2.03; a *= 0.5; } return s; }
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Cuneiform-style wedge: a thin shaft ending in a triangular head.
export function wedge(ctx, x, y, len, ang, w) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const hx = x + c * len, hy = y + s * len;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(hx - s * w, hy + c * w);
  ctx.lineTo(hx + s * w, hy - c * w);
  ctx.closePath();
  ctx.fill();
}

function pixelCell(data, cell, fn) {
  const cx = (cell % GRID) * CELL, cy = Math.floor(cell / GRID) * CELL, W = CELL * GRID;
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) {
      const u = (px + 0.5) / CELL * 2 - 1, v = (py + 0.5) / CELL * 2 - 1;
      const a = Math.max(0, Math.min(1, fn(u, v, Math.hypot(u, v))));
      const i = ((cy + py) * W + cx + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
}

function glyphRing(ctx, rng, cx, cy, R, count, size) {
  ctx.fillStyle = '#fff';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const ang = a + Math.PI / 2 + Math.floor(rng() * 4) * Math.PI / 4 * (rng() < 0.5 ? 1 : 0) + (rng() - 0.5) * 0.2;
      wedge(ctx, x + (rng() - 0.5) * size, y + (rng() - 0.5) * size, size * (0.5 + rng() * 0.7), ang, size * 0.1);
    }
  }
}

export function buildAtlas() {
  const W = CELL * GRID;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(W, W);
  const d = img.data;

  pixelCell(d, F.DOT, (u, v, r) => Math.exp(-r * r * 5.5) * (1 - sstep(0.8, 1, r)));
  pixelCell(d, F.STAR, (u, v, r) => {
    const au = Math.abs(u), av = Math.abs(v);
    const core = Math.exp(-r * r * 38);
    const ray1 = Math.exp(-av * 34) * Math.pow(Math.max(0, 1 - au), 2.2);
    const ray2 = Math.exp(-au * 34) * Math.pow(Math.max(0, 1 - av), 2.2);
    const du = (u + v) * 0.7071, dv = (u - v) * 0.7071;
    const d1 = Math.exp(-Math.abs(dv) * 40) * Math.pow(Math.max(0, 1 - Math.abs(du)), 3) * 0.45;
    const d2 = Math.exp(-Math.abs(du) * 40) * Math.pow(Math.max(0, 1 - Math.abs(dv)), 3) * 0.45;
    return (core * 1.2 + ray1 + ray2 + d1 + d2 + Math.exp(-r * r * 6) * 0.25) * (1 - sstep(0.85, 1, r));
  });
  pixelCell(d, F.SMOKE, (u, v, r) => {
    const n = fbm(u * 2.6 + 5.1, v * 2.6 + 1.7, 5);
    const rad = 1 - sstep(0.15, 0.98, r);
    return Math.max(0, n * 1.55 - 0.32) * rad * 1.15;
  });
  pixelCell(d, F.FLAME, (u, v) => {
    const s = (v + 1) * 0.5; // 0 tip (top) .. 1 bottom
    const n = fbm(u * 3 + 2.3, v * 4 + 7.7, 4);
    const wob = (n - 0.5) * 0.5 * (1 - s * 0.5);
    const hw = 0.66 * Math.pow(s, 0.62) * (1 - Math.pow(s, 4.5)) + 0.02;
    const x = Math.abs(u + wob * (1 - s) * 0.8);
    const body = 1 - sstep(hw * 0.35, hw, x);
    const taper = sstep(0.0, 0.18, s);
    const inner = 0.55 + 0.45 * fbm(u * 5 + 1.1, v * 6 - 3.2, 3);
    return body * taper * Math.min(1, inner * 1.25) * (1 - sstep(0.93, 1, s));
  });
  pixelCell(d, F.RING, (u, v, r) => Math.exp(-Math.pow((r - 0.88) / 0.035, 2)) + Math.exp(-Math.pow((r - 0.88) / 0.1, 2)) * 0.25);
  pixelCell(d, F.WAVE, (u, v, r) => {
    const body = r < 0.9 ? Math.pow(r / 0.9, 7) * 0.8 : 1;
    return body * (1 - sstep(0.9, 0.995, r)) * (0.25 + Math.exp(-Math.pow((r - 0.9) / 0.03, 2)) * 1.4);
  });
  pixelCell(d, F.SCORCH, (u, v, r) => {
    const n = fbm(u * 2.2 + 11, v * 2.2 + 3, 5);
    const a = sstep(0.28, 0.9, n * 1.15 + (1 - r) * 0.85 - 0.55);
    return a * (1 - sstep(0.7, 1, r));
  });
  pixelCell(d, F.SHARD, (u, v) => {
    const q = Math.abs(u) * 2.3 + Math.abs(v) * 0.85;
    return (1 - sstep(0.55, 0.95, q)) * (0.6 + 0.4 * (1 - Math.abs(u)));
  });
  pixelCell(d, F.STREAK, (u, v) => {
    const body = Math.exp(-v * v * 70) * Math.pow(Math.max(0, (u + 1) * 0.5), 1.6) * (1 - sstep(0.88, 1, u));
    const head = Math.exp(-((u - 0.78) ** 2) * 60 - v * v * 90);
    return Math.min(1, body + head * 0.9);
  });
  pixelCell(d, F.WISP, (u, v) => {
    const s = (v + 1) * 0.5; // 0 top (head), 1 bottom (tail)
    const sway = Math.sin(s * 5) * 0.12 * s;
    const x = Math.abs(u - sway);
    const hw = 0.36 * (1 - sstep(0.0, 0.4, Math.abs(s - 0.28))) + 0.34 * Math.pow(1 - s, 1.5) * sstep(0.05, 0.3, s) + 0.01;
    const body = 1 - sstep(hw * 0.2, hw, x);
    const head = Math.exp(-((x * x) / 0.012 + ((s - 0.3) ** 2) / 0.012));
    return (body * Math.pow(1 - s, 1.2) * 0.9 + head) * (1 - sstep(0.94, 1, s));
  });
  pixelCell(d, F.GLINT, (u, v, r) => {
    const au = Math.abs(u), av = Math.abs(v);
    const a = Math.exp(-av * 70) * Math.pow(Math.max(0, 1 - au), 1.5) + Math.exp(-au * 70) * Math.pow(Math.max(0, 1 - av), 1.5);
    return Math.min(1, a + Math.exp(-r * r * 60)) * (1 - sstep(0.9, 1, r));
  });
  pixelCell(d, F.PLUS, (u, v) => {
    const au = Math.abs(u), av = Math.abs(v);
    const arm = (1 - sstep(0.17, 0.27, au)) * (1 - sstep(0.62, 0.74, av));
    const arm2 = (1 - sstep(0.17, 0.27, av)) * (1 - sstep(0.62, 0.74, au));
    return Math.max(arm, arm2);
  });
  pixelCell(d, F.GLOW_RING, (u, v, r) => {
    return (Math.exp(-Math.pow((r - 0.76) / 0.13, 2)) * 0.9 + Math.exp(-r * r * 5) * 0.22 + Math.exp(-Math.pow((r - 0.76) / 0.03, 2)) * 0.6) * (1 - sstep(0.9, 1, r));
  });
  ctx.putImageData(img, 0, 0);

  const cellOrigin = (cell) => [(cell % GRID) * CELL + CELL / 2, Math.floor(cell / GRID) * CELL + CELL / 2];
  const stroke = (lw) => { ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 5; };
  const circle = (cx, cy, r, lw) => { stroke(lw); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };

  // GLYPH_A: golden seal: rings, cuneiform ring, heptagram, inner rune.
  {
    const [cx, cy] = cellOrigin(F.GLYPH_A);
    const rng = seeded(41);
    circle(cx, cy, 118, 4); circle(cx, cy, 104, 1.5); circle(cx, cy, 70, 2.5); circle(cx, cy, 30, 3);
    stroke(2);
    for (let i = 0; i < 84; i++) { const a = (i / 84) * Math.PI * 2; const l = i % 7 === 0 ? 12 : 5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 104, cy + Math.sin(a) * 104); ctx.lineTo(cx + Math.cos(a) * (104 - l), cy + Math.sin(a) * (104 - l)); ctx.stroke(); }
    glyphRing(ctx, rng, cx, cy, 87, 21, 14);
    stroke(2.2);
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) { const a = -Math.PI / 2 + ((i * 3) % 7) / 7 * Math.PI * 2; const x = cx + Math.cos(a) * 70, y = cy + Math.sin(a) * 70; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i / 7) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (let k = 0; k < 5; k++) wedge(ctx, cx - 14 + k * 3, cy - 12 + k * 6, 14, -0.6 + k * 0.3, 2.6);
  }
  // GLYPH_B: violet sigil: hexagram, dashed ring, vertex orbs, rune ring.
  {
    const [cx, cy] = cellOrigin(F.GLYPH_B);
    const rng = seeded(97);
    circle(cx, cy, 116, 3.5); circle(cx, cy, 98, 1.5); circle(cx, cy, 56, 2);
    stroke(2);
    ctx.setLineDash([10, 7]); ctx.beginPath(); ctx.arc(cx, cy, 78, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    stroke(2.8);
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + off + (i / 3) * Math.PI * 2; const x = cx + Math.cos(a) * 98, y = cy + Math.sin(a) * 98; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI * 2; circle(cx + Math.cos(a) * 98, cy + Math.sin(a) * 98, 8, 2.5); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 98, cy + Math.sin(a) * 98, 3, 0, 7); ctx.fill(); }
    glyphRing(ctx, rng, cx, cy, 107, 30, 9);
    stroke(2);
    ctx.beginPath(); ctx.moveTo(cx - 28, cy); ctx.lineTo(cx + 28, cy); ctx.moveTo(cx, cy - 28); ctx.lineTo(cx, cy + 28); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
  }
  // CRACK: jagged radial fissures with branches and a glowing core.
  {
    const [cx, cy] = cellOrigin(F.CRACK);
    const rng = seeded(7);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 52);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.fillRect(cx - 60, cy - 60, 120, 120);
    const branch = (x, y, ang, len, w, depth) => {
      stroke(w);
      ctx.beginPath(); ctx.moveTo(x, y);
      let px = x, py = y, a = ang;
      const steps = Math.max(3, Math.round(len / 11));
      for (let i = 0; i < steps; i++) {
        a += (rng() - 0.5) * 0.7;
        px += Math.cos(a) * (len / steps); py += Math.sin(a) * (len / steps);
        ctx.lineTo(px, py);
        if (depth < 2 && rng() < 0.33) {
          const sa = a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6);
          ctx.stroke();
          branch(px, py, sa, len * (0.28 + rng() * 0.22), w * 0.55, depth + 1);
          stroke(w); ctx.beginPath(); ctx.moveTo(px, py);
        }
      }
      ctx.stroke();
    };
    const arms = 9;
    for (let i = 0; i < arms; i++) branch(cx, cy, (i / arms) * Math.PI * 2 + rng() * 0.5, 100 + rng() * 22, 4.2 - rng() * 1.4, 0);
  }
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Small tiling strip of runes for the Tether beam.
export function buildRuneStrip() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const ctx = c.getContext('2d');
  const rng = seeded(1234);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 3;
  for (let i = 0; i < 16; i++) {
    const x = 16 + i * 32;
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const ang = Math.floor(rng() * 4) * Math.PI / 4 + (rng() < 0.5 ? 0 : Math.PI / 2);
      wedge(ctx, x + (rng() - 0.5) * 14, 32 + (rng() - 0.5) * 30, 8 + rng() * 14, ang, 2.4);
    }
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 14, 8); ctx.lineTo(x + 14, 56); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Spectral wing: layered feathers fanning out from the root at the left edge.
export function buildWing() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 8;
  const rows = [
    { n: 9, len: 470, spread: [-0.1, 0.78], w: 28, a: 0.95 },
    { n: 8, len: 360, spread: [-0.02, 0.7], w: 26, a: 0.8 },
    { n: 7, len: 250, spread: [0.05, 0.62], w: 24, a: 0.65 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const k = i / (row.n - 1);
      const ang = -(row.spread[0] + (row.spread[1] - row.spread[0]) * k) + 0.05;
      const len = row.len * (0.62 + 0.38 * Math.sin((0.2 + k * 0.8) * Math.PI * 0.55 + 0.35));
      ctx.save();
      ctx.translate(18, 150);
      ctx.rotate(-ang);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, `rgba(255,255,255,${row.a})`); g.addColorStop(0.7, `rgba(255,255,255,${row.a * 0.7})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -row.w * 0.18);
      ctx.quadraticCurveTo(len * 0.5, -row.w * 0.78, len, 0);
      ctx.quadraticCurveTo(len * 0.5, row.w * 0.5, 0, row.w * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  const root = ctx.createRadialGradient(18, 150, 0, 18, 150, 70);
  root.addColorStop(0, 'rgba(255,255,255,1)'); root.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = root; ctx.fillRect(0, 70, 120, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
