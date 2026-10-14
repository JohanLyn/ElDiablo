// Geometry of the bottom-right touch cluster (pure maths, no DOM: unit-tested in test/touchlayout.test.js).
//
// Everything is measured in CSS px from the cluster's corner: x grows toward the screen centre, y grows up.
// The big attack button sits near the corner, the always-on buttons (evade, potion, aspect swap) curl around it
// and the BOUND skills form an outer arc, packed from angle 0 so a hero with two skills has a short arc, not a
// ring of empty tiles. The whole cluster has to fit under the minimap on a short screen, so clusterLayout
// shrinks the buttons, then flattens the arc, then falls back to two rows hugging the bottom-right.

export const SKILL_BTNS = ['s2', 's3', 's4', 's5', 's6'];
export const MIN_BTN = 40;     // smallest button we shrink to
export const MIN_ATTACK = 64;  // the strike button never gets smaller than this
export const GAP = 6;          // smallest gap between two buttons

const rad = (d) => (d * Math.PI) / 180;

// Place `names` one after the other along an ellipse (rx, ry) around (cx, cy), starting at `start` degrees and
// stepping until each button clears its neighbour by `gap`. Mutates `out`.
function pack(out, names, sizes, cx, cy, rx, ry, start, gap) {
  let ang = start;
  let prev = null;
  for (const name of names) {
    const size = sizes[name];
    if (prev) {
      const need = (size + prev.size) / 2 + gap;
      for (let guard = 0; guard < 800; guard++) {
        ang += 0.25;
        if (Math.max(Math.abs(cx + rx * Math.cos(rad(ang)) - prev.x), Math.abs(cy + ry * Math.sin(rad(ang)) - prev.y)) >= need) break;
      }
    }
    prev = { x: cx + rx * Math.cos(rad(ang)), y: cy + ry * Math.sin(rad(ang)), size, ang };
    out[name] = prev;
  }
}

const valid = (items, gap) => {
  const list = Object.values(items);
  for (const it of list) if (it.x - it.size / 2 < 3 || it.y - it.size / 2 < 3) return false; // stays on screen
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (Math.max(Math.abs(list[i].x - list[j].x), Math.abs(list[i].y - list[j].y)) < (list[i].size + list[j].size) / 2 + gap - 1) return false;
    }
  }
  return true;
};

function arcs(s, flat, bound) {
  const size = (base, min) => Math.max(min, base * s);
  const a = size(84, MIN_ATTACK);
  const sizes = { attack: a, evade: size(62, MIN_BTN), potion: size(58, MIN_BTN), aspect: size(46, MIN_BTN) };
  for (const n of bound) sizes[n] = size(56, MIN_BTN);
  const gap = Math.max(GAP, 7 * s);
  const cx = a / 2 + 30 * s, cy = a / 2 + 24 * s;
  const items = { attack: { x: cx, y: cy, size: a, ang: 0 } };
  const r1sz = Math.max(sizes.evade, sizes.potion, sizes.aspect);
  const r1 = Math.max(100 * s, a / 2 + r1sz / 2 + gap);
  pack(items, ['evade', 'potion', 'aspect'], sizes, cx, cy, r1, r1, 14, gap);
  if (bound.length) {
    const r2sz = Math.max(...bound.map((n) => sizes[n]));
    const rx0 = Math.max(164 * s, r1 + r1sz / 2 + r2sz / 2 + gap);
    // the buttons are squares: widen the arc until the outer skills clear the inner ring
    for (let extra = 0; extra <= 60; extra += 3) {
      const rx = rx0 + extra;
      for (const n of bound) delete items[n];
      pack(items, bound, sizes, cx, cy, rx, flat ? rx * 0.8 : rx, 0, gap);
      if (valid(items, gap)) break;
    }
  }
  return { items, gap, mode: flat ? 'flat' : 'arc', scale: s };
}

// Two rows to the left of the attack button (very short screens).
function rows(bound) {
  const a = MIN_ATTACK, sz = MIN_BTN;
  const cx = a / 2 + 12, cy = a / 2 + 6;
  const items = { attack: { x: cx, y: cy, size: a, ang: 0 } };
  const order = ['evade', 'potion', 'aspect', ...bound];
  const perRow = Math.ceil(order.length / 2);
  order.forEach((name, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    items[name] = { x: cx + a / 2 + GAP + sz / 2 + col * (sz + GAP), y: 6 + sz / 2 + row * (sz + GAP), size: sz, ang: 0 };
  });
  return { items, gap: GAP, mode: 'rows', scale: 0.5 };
}

const topOf = (items) => Math.max(...Object.values(items).map((it) => it.y + it.size / 2));

// scale: the preferred layout scale; avail: height available above the corner (px); bound: bound skill buttons (names of SKILL_BTNS).
// maxWidth: keep the cluster out of the hero-safe zone in the middle of the screen (tried first, dropped if nothing fits).
export function clusterLayout({ scale, avail, bound, maxWidth = Infinity }) {
  const widthOf = (items) => Math.max(...Object.values(items).map((it) => it.x + it.size / 2));
  for (const limit of [maxWidth, Infinity]) {
    for (const flat of [false, true]) {
      for (let s = scale; s >= 0.44; s -= 0.02) {
        const r = arcs(s, flat, bound);
        r.top = topOf(r.items);
        if (r.top <= avail && widthOf(r.items) <= limit && valid(r.items, r.gap)) return r;
      }
    }
  }
  const r = rows(bound);
  r.top = topOf(r.items);
  return r;
}
