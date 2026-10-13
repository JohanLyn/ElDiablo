// Mesopotamian ornament kit: everything is drawn as inline SVG (no image assets).
// installOrnaments() publishes tiled patterns as CSS custom properties so the
// stylesheets can use them as backgrounds and masks.

let uidCounter = 0;
const uid = (p) => `${p}${++uidCounter}`;

export const dataUri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// One cuneiform wedge: a triangular head with a tail, rotated about its origin.
const wedge = (x, y, rot, s = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0 L8 -3.2 L8 3.2 Z"/><path d="M8 0 H17" stroke-width="1.6" fill="none"/></g>`;

// Deterministic "signs" built from wedge groups: reads as cuneiform at a glance.
const SIGNS = [
  [[2, 7, 0], [2, 15, 0], [12, 11, 90]],
  [[2, 6, 20], [4, 14, -20], [3, 22, 0], [14, 10, 70]],
  [[2, 12, 0], [12, 4, 90], [12, 18, 90]],
  [[2, 5, 0], [2, 11, 0], [2, 17, 0], [2, 23, 0]],
  [[3, 8, -25], [3, 18, 25], [12, 13, 0]],
];

export function cuneiform({ color = '#d6a740', opacity = 0.5, w = 120, h = 34 } = {}) {
  let body = '';
  let x = 2;
  let i = 0;
  while (x < w - 18) {
    const sign = SIGNS[i % SIGNS.length];
    for (const [dx, dy, r] of sign) body += wedge(x + dx, dy + (h - 28) / 2, r, 0.62);
    x += 22 + (i % 3) * 3;
    i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}">${body}</g></svg>`;
}

// Eight-petal rosette, the Mesopotamian sun flower. `lapis` colours the eye.
export function rosette({ size = 32, gold = '#d6a740', edge = '#2a1a08', eye = '#2c56c9' } = {}) {
  const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-9.2" rx="3.7" ry="6.6" transform="rotate(${i * 45})"/>`).join('');
  return `<svg class="orn" width="${size}" height="${size}" viewBox="-16 -16 32 32" aria-hidden="true"><g fill="${gold}" stroke="${edge}" stroke-width=".7">${petals}</g><circle r="5.2" fill="${edge}" stroke="${gold}" stroke-width="1"/><circle r="3.1" fill="${eye}" stroke="#a9c4ff" stroke-width=".5"/></svg>`;
}

// Horizontal flourish: tapered lines, centre diamond flanked by dots.
export function divider({ width = 300, gold = '#d6a740', dark = '#6b5330' } = {}) {
  const g = uid('dv');
  const h = 22, c = width / 2;
  return `<svg class="orn divider" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${g}L" x1="0" x2="1"><stop offset="0" stop-color="${gold}" stop-opacity="0"/><stop offset="1" stop-color="${gold}"/></linearGradient><linearGradient id="${g}R" x1="1" x2="0"><stop offset="0" stop-color="${gold}" stop-opacity="0"/><stop offset="1" stop-color="${gold}"/></linearGradient></defs>
    <rect x="0" y="${h / 2 - 0.75}" width="${c - 22}" height="1.5" fill="url(#${g}L)"/>
    <rect x="${c + 22}" y="${h / 2 - 0.75}" width="${c - 22}" height="1.5" fill="url(#${g}R)"/>
    <rect x="${c - 40}" y="${h / 2 + 3}" width="18" height="1" fill="${dark}"/><rect x="${c + 22}" y="${h / 2 + 3}" width="18" height="1" fill="${dark}"/>
    <path d="M${c} 2 L${c + 9} ${h / 2} L${c} ${h - 2} L${c - 9} ${h / 2} Z" fill="#1d3b8c" stroke="${gold}" stroke-width="1.4"/>
    <path d="M${c} 7 L${c + 4} ${h / 2} L${c} ${h - 7} L${c - 4} ${h / 2} Z" fill="#7fa6ff"/>
    <circle cx="${c - 15}" cy="${h / 2}" r="2" fill="${gold}"/><circle cx="${c + 15}" cy="${h / 2}" r="2" fill="${gold}"/>
  </svg>`;
}

// The Seven Gates: seven arches, the first one cracked and burning.
export function gatesEmblem({ width = 330 } = {}) {
  const g = uid('ge');
  const gate = (i) => {
    const x = 6 + i * 46;
    const lit = i === 0;
    const stroke = lit ? '#ffd27a' : '#8a6a3a';
    return `<g transform="translate(${x} 4)">
      <path d="M0 40 V16 Q0 0 15 0 Q30 0 30 16 V40 Z" fill="${lit ? `url(#${g})` : '#150e10'}" stroke="${stroke}" stroke-width="${lit ? 2 : 1.6}"/>
      <path d="M5 40 V17 Q5 5 15 5 Q25 5 25 17 V40" fill="none" stroke="${lit ? '#a4741f' : '#3d2c1a'}" stroke-width="1"/>
      ${lit ? '<path d="M15 5 L12 16 L17 22 L13 31 L16 40" stroke="#fff2c8" stroke-width="1.6" fill="none" stroke-linejoin="round"/>' : `<circle cx="15" cy="21" r="1.6" fill="#6b5330"/>`}
    </g>`;
  };
  return `<svg class="orn gates" width="${width}" height="52" viewBox="0 0 ${width} 52" aria-hidden="true">
    <defs><radialGradient id="${g}" cx=".5" cy=".75" r=".8"><stop offset="0" stop-color="#ffb340"/><stop offset=".6" stop-color="#b8461c"/><stop offset="1" stop-color="#2a0e0a"/></radialGradient></defs>
    ${Array.from({ length: 7 }, (_, i) => gate(i)).join('')}
    <rect x="0" y="46" width="${width}" height="1.4" fill="#6b5330"/>
  </svg>`;
}

// Corner bracket for panels (drawn once, rotated via CSS).
export function corner({ size = 26, gold = '#d6a740' } = {}) {
  return `<svg class="orn corner" width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><path d="M1 25 V6 Q1 1 6 1 H25" fill="none" stroke="${gold}" stroke-width="2"/><path d="M6 25 V10 Q6 6 10 6 H25" fill="none" stroke="${gold}" stroke-width=".8" opacity=".6"/><circle cx="6" cy="6" r="2.4" fill="#2c56c9" stroke="${gold}" stroke-width=".9"/></svg>`;
}

// Lapis diamond finial used at the ends of boss bars and banners.
export function finial({ size = 30, flip = false } = {}) {
  return `<svg class="orn finial" width="${size}" height="${size}" viewBox="0 0 30 30" ${flip ? 'style="transform:scaleX(-1)"' : ''} aria-hidden="true"><path d="M15 1 L29 15 L15 29 L1 15 Z" fill="#2a1a08" stroke="#d6a740" stroke-width="1.6"/><path d="M15 6 L24 15 L15 24 L6 15 Z" fill="#1d3b8c" stroke="#f3d68a" stroke-width="1"/><path d="M15 10 L20 15 L15 20 L10 15 Z" fill="#7fa6ff"/></svg>`;
}

// Spinner glyph for the loading screen: a ring of wedges.
export function spinner(size = 64) {
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="M0 -26 L3 -18 H-3 Z" transform="rotate(${i * 30})" opacity="${0.25 + (i / 12) * 0.75}"/>`).join('');
  return `<svg class="orn spin" width="${size}" height="${size}" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="#d6a740">${ticks}</g><circle r="9" fill="none" stroke="#6b5330" stroke-width="1.5"/><circle r="3" fill="#2c56c9" stroke="#f3d68a"/></svg>`;
}

const WAVE = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="12" viewBox="0 0 60 12"><path d="M0 6 Q7.5 0 15 6 T30 6 T45 6 T60 6 V12 H0 Z" fill="#000"/></svg>`;
const ZIGZAG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8"><path d="M0 7 L4 1 L8 7 L12 1 L16 7" fill="none" stroke="#d6a740" stroke-width="1.2" opacity=".7"/></svg>`;
const GRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const NOTCH = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M4 0 L8 4 L4 8 L0 4 Z" fill="#d6a740" opacity=".8"/></svg>`;

export function installOrnaments() {
  const root = document.documentElement.style;
  root.setProperty('--cune-gold', dataUri(cuneiform({ color: '#d6a740', opacity: 0.24 })));
  root.setProperty('--cune-dim', dataUri(cuneiform({ color: '#9b7a3e', opacity: 0.1, w: 150, h: 40 })));
  root.setProperty('--cune-title', dataUri(cuneiform({ color: '#f3d68a', opacity: 0.55, w: 300, h: 34 })));
  root.setProperty('--cune-dark', dataUri(cuneiform({ color: '#4a2c10', opacity: 0.32, w: 150, h: 40 })));
  root.setProperty('--grain', dataUri(GRAIN));
  root.setProperty('--wave', dataUri(WAVE));
  root.setProperty('--zigzag', dataUri(ZIGZAG));
  root.setProperty('--notch', dataUri(NOTCH));
}

// Fill every [data-orn] placeholder in the DOM with its SVG ornament.
export function fillOrnaments(root = document) {
  const make = {
    rosette: () => rosette({ size: 30 }),
    'rosette-s': () => rosette({ size: 22 }),
    'rosette-l': () => rosette({ size: 46 }),
    divider: () => divider({ width: 320 }),
    gates: () => gatesEmblem(),
    corner: () => corner(),
    finial: () => finial(),
    'finial-r': () => finial({ flip: true }),
    spinner: () => spinner(),
  };
  root.querySelectorAll('[data-orn]').forEach((el) => {
    if (el.firstChild) return;
    const fn = make[el.dataset.orn];
    if (fn) el.innerHTML = fn();
  });
}
