// "Lapis Mosaic" ornament kit, after the Standard of Ur: lapis panels framed by
// inlaid triangles of shell, carnelian and lapis set in bitumen, with gold studs.
// Everything is procedural inline SVG (no image assets). installOrnaments()
// publishes tiled patterns as CSS custom properties so the stylesheets can use
// them as backgrounds, masks and border-images.

let uidCounter = 0;
const uid = (p) => `${p}${++uidCounter}`;

export const dataUri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s*\n\s*/g, ''))}")`;

export const PAL = {
  lapisDeep: '#0b1a3e', lapis: '#14306e', lapisHi: '#3d6bd6', lapisGlow: '#8fb4ff',
  shell: '#efe6cf', shellDim: '#b9ad94',
  carn: '#b8432c', carnHi: '#e0683f', carnDeep: '#6e2214',
  bitumen: '#15100c', gold: '#d9a441', goldHi: '#f6d27a', goldLo: '#8a6422', pyrite: '#e8c86a', mud: '#b5763f',
};
const P = PAL;

// Deterministic pseudo-random numbers for flecks and grain.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- mosaic frames
// Colour schemes for the triangle inlay: alternating up-triangles, down-triangles, gold line.
export const SCHEMES = {
  lapis: { up: [P.shell, P.carnHi], down: [P.lapisHi, P.lapis], line: P.gold, stud: P.lapisHi },
  common: { up: ['#cfc8b4', '#9a937f'], down: ['#243b78', P.lapisDeep], line: '#b9ad94', stud: '#b9ad94' },
  magic: { up: ['#6f9cff', '#bcd2ff'], down: [P.lapisHi, P.lapis], line: '#6f9cff', stud: '#bcd2ff' },
  rare: { up: [P.goldHi, P.gold], down: [P.lapis, P.lapisDeep], line: P.goldHi, stud: P.goldHi },
  legendary: { up: ['#ff8a3d', '#ffc36a'], down: [P.carn, P.carnDeep], line: '#ff9a4a', stud: '#ffc36a' },
  carn: { up: [P.carnHi, P.carn], down: [P.bitumen, '#3a1410'], line: P.carnHi, stud: P.carnHi },
  gold: { up: [P.goldHi, P.pyrite], down: [P.gold, '#a9772a'], line: P.goldHi, stud: P.shell },
};

// One horizontal band, 48 units long and 12 deep: gold line, bitumen grout, then
// a row of interlocking triangles (period 24, so it tiles under border-image).
function band(s) {
  let out = `<rect width="48" height="12" fill="${P.bitumen}"/>`;
  for (let x = -12, i = 0; x < 60; x += 12, i++) {
    out += `<path d="M${x} 10 H${x + 12} L${x + 6} 2Z" fill="${s.up[((i % 2) + 2) % 2]}"/>`;
  }
  for (let x = -6, i = 0; x < 54; x += 12, i++) {
    out += `<path d="M${x} 2 H${x + 12} L${x + 6} 10Z" fill="${s.down[((i % 2) + 2) % 2]}"/>`;
  }
  // grout lines over the seams
  out += `<g stroke="${P.bitumen}" stroke-width="1" fill="none" stroke-linejoin="miter">`;
  for (let x = -12; x < 60; x += 12) out += `<path d="M${x} 10 L${x + 6} 2 L${x + 12} 10"/><path d="M${x + 6} 2 L${x + 12} 10 L${x + 18} 2"/>`;
  out += `</g><rect width="48" height="1" fill="${s.line}"/><rect y="1" width="48" height="1" fill="${P.bitumen}"/><rect y="10" width="48" height="2" fill="${P.bitumen}"/>`;
  return out;
}

function corner(s) {
  return `<rect width="12" height="12" fill="${P.bitumen}"/><path d="M.5 12V.5H12" fill="none" stroke="${s.line}"/>
    <path d="M6 2 L10 6 L6 10 L2 6Z" fill="${s.stud}" stroke="${s.line}" stroke-width=".7"/><circle cx="6" cy="6" r="1.1" fill="${P.carn}"/>`;
}

// A 9-slice border source. `px` is the band thickness in image pixels (use it as
// the border-image-slice value). Middle slice = 24 units = one triangle period.
export function mosaicFrame(scheme, px = 12) {
  const s = typeof scheme === 'string' ? SCHEMES[scheme] : scheme;
  const k = px / 12, S = 48 * k;
  const b = band(s), c = corner(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 48 48">
    <g>${b}</g>
    <g transform="translate(48 48) rotate(180)">${b}</g>
    <g transform="translate(0 48) rotate(-90)">${b}</g>
    <g transform="translate(48 0) rotate(90)">${b}</g>
    <g>${c}</g><g transform="translate(48 0) rotate(90)">${c}</g>
    <g transform="translate(48 48) rotate(180)">${c}</g><g transform="translate(0 48) rotate(-90)">${c}</g>
  </svg>`;
}

// Heading underline / ribbon edge: a thin run of triangles, transparent behind.
export function triBand({ up = [P.shell, P.carnHi], down = [P.lapisHi, P.lapisHi], h = 6, period = 24 } = {}) {
  const w = period, half = h * 2, n = w / half;
  let body = '';
  for (let i = -1; i <= n; i++) body += `<path d="M${i * half} ${h} H${(i + 1) * half} L${i * half + h} 0Z" fill="${up[((i % 2) + 2) % 2]}"/>`;
  for (let i = -1; i <= n; i++) body += `<path d="M${i * half + h} 0 H${i * half + h + half} L${i * half + half} ${h}Z" fill="${down[((i % 2) + 2) % 2]}" opacity=".85"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

// ---------------------------------------------------------------- cylinder-seal frieze
// A procession in gold silhouette on lapis, rolled out when screens open.
export function frieze() {
  const fig = (x, staff) => `<g transform="translate(${x} 25)" fill="${P.gold}" stroke="${P.gold}" stroke-linecap="round">
    <circle cx="0" cy="-17" r="2.4" stroke="none"/><path d="M-2.2 -14.2 H2.2 V-9 H-2.2Z" stroke="none"/>
    <path d="M-2.6 -9.5 H2.6 L4.4 -2.5 H-4.4Z" stroke="none"/><path d="M-1.4 -2.5 L-2.4 0 M1.4 -2.5 L2.8 0" fill="none" stroke-width="1.3"/>
    <path d="M2 -12.6 L6.8 -14.6" fill="none" stroke-width="1.2"/>${staff ? `<path d="M7 -21 V0" fill="none" stroke-width="1"/><circle cx="7" cy="-21.5" r="1.3" stroke="none" fill="${P.carnHi}"/>` : `<path d="M6.2 -15.6 q1.6 -1.6 3.2 0 l-.4 2.4 h-2.4Z" stroke="none" fill="${P.shell}"/>`}</g>`;
  const bull = (x) => `<g transform="translate(${x} 25)" fill="${P.shell}" stroke="${P.shell}" stroke-linecap="round" opacity=".92">
    <ellipse cx="0" cy="-9" rx="8.5" ry="4.2" stroke="none"/><path d="M6.5 -11 L11.5 -13.5 L13.5 -9.5 L8 -7Z" stroke="none"/>
    <path d="M11.2 -13.4 q.6 -3.6 3.4 -3.8 M12.6 -13.1 q2.6 -1.9 4.6 -.2" fill="none" stroke-width="1"/>
    <path d="M-5 -5.5 L-5.6 0 M-2 -5.5 L-2.2 0 M3 -5.5 L3.4 0 M6 -5.5 L6.8 0 M-8.4 -10 q-3 1 -3.6 5" fill="none" stroke-width="1.3"/></g>`;
  const rosetteM = (x) => `<g transform="translate(${x} 14)">${Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-4.6" rx="1.7" ry="3.2" fill="${P.carnHi}" transform="rotate(${i * 45})"/>`).join('')}<circle r="2" fill="${P.goldHi}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30" viewBox="0 0 120 30">
    <rect width="120" height="30" fill="${P.lapisDeep}"/>
    <rect y="0" width="120" height="1.4" fill="${P.gold}"/><rect y="28.6" width="120" height="1.4" fill="${P.gold}"/>
    <rect y="2.4" width="120" height="1" fill="${P.carn}" opacity=".8"/><rect y="26.6" width="120" height="1" fill="${P.carn}" opacity=".8"/>
    ${fig(10, true)}${fig(30, false)}${bull(58)}${rosetteM(86)}${fig(104, true)}
  </svg>`;
}

// ---------------------------------------------------------------- stone grain
function stone() {
  const r = rng(41);
  let flecks = '';
  for (let i = 0; i < 16; i++) flecks += `<circle cx="${(r() * 300).toFixed(0)}" cy="${(r() * 300).toFixed(0)}" r="${(0.5 + r() * 0.7).toFixed(2)}" fill="${P.pyrite}" opacity="${(0.22 + r() * 0.2).toFixed(2)}"/>`;
  const veins = '<path d="M-10 90 C60 60 110 140 190 100 S280 70 320 110" fill="none" stroke="#a9c4ff" stroke-width=".7" opacity=".08"/><path d="M-10 230 C50 250 120 190 200 230 S290 260 320 220" fill="none" stroke="#a9c4ff" stroke-width=".6" opacity=".06"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".16" numOctaves="3" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .72  0 0 0 0 .8  0 0 0 0 1  0 0 0 .34 -.12"/></filter><rect width="100%" height="100%" filter="url(#n)"/>${veins}${flecks}</svg>`;
}
const GRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const WAVE = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="12" viewBox="0 0 60 12"><path d="M0 6 Q7.5 0 15 6 T30 6 T45 6 T60 6 V12 H0 Z" fill="#000"/></svg>`;
const ZIGZAG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8"><path d="M0 7 L4 1 L8 7 L12 1 L16 7" fill="none" stroke="${P.gold}" stroke-width="1.2" opacity=".7"/></svg>`;
const NOTCH = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M4 0 L8 4 L4 8 L0 4 Z" fill="${P.gold}" opacity=".8"/></svg>`;

// ---------------------------------------------------------------- cuneiform watermark
const wedge = (x, y, rot, s = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0 L8 -3.2 L8 3.2 Z"/><path d="M8 0 H17" stroke-width="1.6" fill="none"/></g>`;
const SIGNS = [
  [[2, 7, 0], [2, 15, 0], [12, 11, 90]],
  [[2, 6, 20], [4, 14, -20], [3, 22, 0], [14, 10, 70]],
  [[2, 12, 0], [12, 4, 90], [12, 18, 90]],
  [[2, 5, 0], [2, 11, 0], [2, 17, 0], [2, 23, 0]],
  [[3, 8, -25], [3, 18, 25], [12, 13, 0]],
];

export function cuneiform({ color = P.gold, opacity = 0.5, w = 120, h = 34 } = {}) {
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

// ---------------------------------------------------------------- rosette, divider, finial
// Eight-petal rosette, the Mesopotamian sun flower.
export function rosette({ size = 32, gold = P.gold, edge = P.bitumen, eye = P.carn, petal = P.shell } = {}) {
  const g = uid('rs');
  const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-9.4" rx="3.6" ry="6.4" transform="rotate(${i * 45})"/>`).join('');
  const inner = Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-9.4" rx="1.5" ry="3.8" transform="rotate(${i * 45})"/>`).join('');
  return `<svg class="orn" width="${size}" height="${size}" viewBox="-16 -16 32 32" aria-hidden="true"><defs><radialGradient id="${g}" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="${P.goldHi}"/><stop offset=".6" stop-color="${gold}"/><stop offset="1" stop-color="#8a6422"/></radialGradient></defs><g fill="url(#${g})" stroke="${edge}" stroke-width=".7">${petals}</g><g fill="${petal}" opacity=".9">${inner}</g><circle r="5.4" fill="${edge}" stroke="${gold}" stroke-width="1"/><circle r="3.3" fill="${eye}" stroke="${P.goldHi}" stroke-width=".6"/><circle r="1.1" fill="${P.shell}"/></svg>`;
}

// Gold stud with a small rosette: the corner joint of a mosaic frame.
export function corner26({ size = 28 } = {}) {
  const g = uid('cs');
  const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-6.2" rx="2.1" ry="3.7" transform="rotate(${i * 45})"/>`).join('');
  return `<svg class="orn corner" width="${size}" height="${size}" viewBox="-14 -14 28 28" aria-hidden="true"><defs><radialGradient id="${g}" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#fff0b8"/><stop offset=".45" stop-color="${P.gold}"/><stop offset="1" stop-color="#6e4f16"/></radialGradient></defs><circle r="12.6" fill="${P.bitumen}"/><circle r="11.4" fill="url(#${g})" stroke="${P.bitumen}" stroke-width=".8"/><circle r="9.4" fill="none" stroke="#6e4f16" stroke-width=".6" opacity=".7"/><g fill="${P.shell}" stroke="${P.bitumen}" stroke-width=".5">${petals}</g><circle r="3.2" fill="${P.carn}" stroke="${P.goldHi}" stroke-width=".7"/><circle r="1" cx="-.8" cy="-.8" fill="${P.carnHi}"/></svg>`;
}

// Horizontal flourish: tapered gold lines flanking a lapis diamond and triangle bars.
export function divider({ width = 320 } = {}) {
  const g = uid('dv');
  const h = 22, c = width / 2;
  const tri = (x0, dir) => Array.from({ length: 5 }, (_, i) => `<path d="M${x0 + dir * i * 8} ${h / 2 + 1} h${dir * 8} l${dir * -4} -6Z" fill="${i % 2 ? P.carnHi : P.shell}"/>`).join('');
  return `<svg class="orn divider" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${g}L" x1="0" x2="1"><stop offset="0" stop-color="${P.gold}" stop-opacity="0"/><stop offset="1" stop-color="${P.gold}"/></linearGradient><linearGradient id="${g}R" x1="1" x2="0"><stop offset="0" stop-color="${P.gold}" stop-opacity="0"/><stop offset="1" stop-color="${P.gold}"/></linearGradient></defs>
    <rect x="0" y="${h / 2 - 0.75}" width="${c - 62}" height="1.5" fill="url(#${g}L)"/>
    <rect x="${c + 62}" y="${h / 2 - 0.75}" width="${c - 62}" height="1.5" fill="url(#${g}R)"/>
    <g opacity=".95">${tri(c - 60, 1)}</g>
    <g opacity=".95" transform="translate(${width} 0) scale(-1 1)">${tri(c - 60, 1)}</g>
    <path d="M${c} 2 L${c + 10} ${h / 2} L${c} ${h - 2} L${c - 10} ${h / 2} Z" fill="${P.lapis}" stroke="${P.gold}" stroke-width="1.5"/>
    <path d="M${c} 7 L${c + 4.5} ${h / 2} L${c} ${h - 7} L${c - 4.5} ${h / 2} Z" fill="${P.lapisGlow}"/>
    <circle cx="${c - 18}" cy="${h / 2}" r="2" fill="${P.gold}"/><circle cx="${c + 18}" cy="${h / 2}" r="2" fill="${P.gold}"/>
  </svg>`;
}

// The Seven Gates: seven nested arches in shell, carnelian and lapis. The outer
// (First) Gate has cracked; the innermost glows.
export function gatesEmblem({ width = 168 } = {}) {
  const g = uid('ge');
  const W = 168, H = 124, cx = W / 2, t = 7.4;
  const cols = [P.carnHi, P.shell, P.lapisHi, P.carn, P.shell, P.lapis, P.carnHi];
  let arches = '';
  for (let i = 0; i < 7; i++) {
    const hw = 80 - i * t, top = 16 + i * t * 0.85, base = 112, r = hw;
    arches += `<path d="M${cx - hw} ${base} V${top + r} A${r} ${r} 0 0 1 ${cx + hw} ${top + r} V${base}Z" fill="${cols[i]}" stroke="${P.bitumen}" stroke-width="1.4"/>`;
    // a few triangle teeth along the arch crown for the mosaic feel
    if (i < 6) {
      const rr = r - t * 0.5;
      let teeth = '';
      for (let k = 1; k < 9; k++) {
        const a = Math.PI + (k / 9) * Math.PI;
        const x = cx + Math.cos(a) * rr, y = top + r + Math.sin(a) * rr;
        teeth += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="${P.bitumen}" opacity=".55"/>`;
      }
      arches += teeth;
    }
  }
  const hw = 80 - 7 * t, top = 16 + 7 * t * 0.85;
  const core = `<path d="M${cx - hw} 112 V${top + hw} A${hw} ${hw} 0 0 1 ${cx + hw} ${top + hw} V112Z" fill="url(#${g})" stroke="${P.gold}" stroke-width="1.2"/>`;
  const crack = `<path d="M${cx - 80} 112 L${cx - 76} 84 L${cx - 82} 70 L${cx - 74} 52 L${cx - 79} 40" fill="none" stroke="#fff2c8" stroke-width="2.4" stroke-linejoin="round"/><path d="M${cx - 80} 112 L${cx - 76} 84 L${cx - 82} 70 L${cx - 74} 52 L${cx - 79} 40" fill="none" stroke="#ff9a3a" stroke-width="5" stroke-linejoin="round" opacity=".45"/>`;
  return `<svg class="orn gates" width="${width}" height="${(width * H) / W}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><radialGradient id="${g}" cx=".5" cy=".95" r=".95"><stop offset="0" stop-color="#fff2c8"/><stop offset=".4" stop-color="${P.goldHi}"/><stop offset=".8" stop-color="${P.carn}"/><stop offset="1" stop-color="#3a1410"/></radialGradient></defs>
    <rect x="${cx - 90}" y="111" width="180" height="6" fill="${P.bitumen}"/><rect x="${cx - 90}" y="111" width="180" height="1.4" fill="${P.gold}"/>
    ${arches}${core}${crack}
    <rect x="${cx - 90}" y="116" width="180" height="1.2" fill="${P.gold}" opacity=".55"/>
  </svg>`;
}

// Lapis diamond finial used at the ends of boss bars.
export function finial({ size = 30, flip = false } = {}) {
  return `<svg class="orn finial" width="${size}" height="${size}" viewBox="0 0 30 30" ${flip ? 'style="transform:scaleX(-1)"' : ''} aria-hidden="true"><path d="M15 1 L29 15 L15 29 L1 15 Z" fill="${P.bitumen}" stroke="${P.gold}" stroke-width="1.6"/><path d="M15 6 L24 15 L15 24 L6 15 Z" fill="${P.carn}" stroke="${P.goldHi}" stroke-width="1"/><path d="M15 10 L20 15 L15 20 L10 15 Z" fill="${P.carnHi}"/><circle cx="15" cy="15" r="1.6" fill="${P.shell}"/></svg>`;
}

// Spinner glyph: a ring of wedges.
export function spinner(size = 64) {
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="M0 -26 L3 -18 H-3 Z" transform="rotate(${i * 30})" opacity="${0.25 + (i / 12) * 0.75}"/>`).join('');
  return `<svg class="orn spin" width="${size}" height="${size}" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="${P.gold}">${ticks}</g><circle r="9" fill="none" stroke="${P.goldLo}" stroke-width="1.5"/><circle r="3" fill="${P.carn}" stroke="${P.goldHi}"/></svg>`;
}

// ---------------------------------------------------------------- beads
// Orb ring: a carved stone bead seen face-on. Life = etched carnelian, Anima =
// lapis with pyrite flecks. 126 px, ring thickness ~9 px.
export function beadRing(kind = 'life') {
  const g = uid('br');
  const r = rng(kind === 'life' ? 7 : 19);
  const life = kind === 'life';
  const stops = life
    ? '<stop offset="0" stop-color="#f08a5a"/><stop offset=".35" stop-color="#c8502f"/><stop offset=".75" stop-color="#8a2a18"/><stop offset="1" stop-color="#5a180e"/>'
    : '<stop offset="0" stop-color="#6f98f5"/><stop offset=".35" stop-color="#2d56b8"/><stop offset=".75" stop-color="#14306e"/><stop offset="1" stop-color="#0a1a44"/>';
  let deco = '';
  if (life) {
    // white etching: two fine bands and a ring of little "eyes"
    deco += `<circle cx="63" cy="63" r="56.2" fill="none" stroke="#f7efdc" stroke-width=".9" opacity=".92"/><circle cx="63" cy="63" r="60.8" fill="none" stroke="#f7efdc" stroke-width=".9" opacity=".92"/>`;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, x = 63 + Math.cos(a) * 58.5, y = 63 + Math.sin(a) * 58.5;
      deco += i % 2 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.15" fill="#f7efdc" opacity=".95"/>`
        : `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a * 180 / Math.PI + 90).toFixed(1)})"><path d="M-.9 -2.6 V2.6 M.9 -2.6 V2.6" stroke="#f7efdc" stroke-width=".7" opacity=".9"/></g>`;
    }
  } else {
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2, rad = 54.8 + r() * 7.4;
      const x = 63 + Math.cos(a) * rad, y = 63 + Math.sin(a) * rad, s = 0.5 + r() * 0.95;
      deco += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="${r() > 0.35 ? P.pyrite : P.goldHi}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
    }
    for (let i = 0; i < 5; i++) { // pale veins
      const a = r() * Math.PI * 2, a2 = a + 0.25 + r() * 0.3;
      deco += `<path d="M${(63 + Math.cos(a) * 55).toFixed(1)} ${(63 + Math.sin(a) * 55).toFixed(1)} A58 58 0 0 1 ${(63 + Math.cos(a2) * 61).toFixed(1)} ${(63 + Math.sin(a2) * 61).toFixed(1)}" fill="none" stroke="#a9c4ff" stroke-width=".7" opacity=".35"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="126" viewBox="0 0 126 126"><defs><linearGradient id="${g}" x1=".15" y1="0" x2=".85" y2="1">${stops}</linearGradient></defs>
    <circle cx="63" cy="63" r="58.5" fill="none" stroke="url(#${g})" stroke-width="9.6"/>
    ${deco}
    <path d="M22 30 A54 54 0 0 1 54 10" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".28"/>
    <circle cx="63" cy="63" r="62.6" fill="none" stroke="${P.bitumen}" stroke-width="1.2" opacity=".9"/>
    <circle cx="63" cy="63" r="53.6" fill="none" stroke="${P.bitumen}" stroke-width="1.6"/><circle cx="63" cy="63" r="52.4" fill="none" stroke="${P.gold}" stroke-width=".8" opacity=".75"/>
  </svg>`;
}

// Gold bead-cap: sits at the poles of an orb. Drawn pointing up; flip with CSS.
export function beadCap() {
  const g = uid('bc');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="18" viewBox="0 0 56 18"><defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="#6e4f16"/><stop offset=".25" stop-color="${P.gold}"/><stop offset=".42" stop-color="#fff0b8"/><stop offset=".6" stop-color="${P.gold}"/><stop offset="1" stop-color="#5a3f10"/></linearGradient></defs>
    <path d="M20 1 H36 L38 6 H18Z" fill="url(#${g})" stroke="${P.bitumen}" stroke-width="1"/>
    <path d="M14 6 H42 L52 17 H4Z" fill="url(#${g})" stroke="${P.bitumen}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M12 9.5 H44 M9 13 H47" stroke="#5a3f10" stroke-width="1" opacity=".7"/>
    <path d="M17 3.2 H39" stroke="#fff0b8" stroke-width=".8" opacity=".6"/></svg>`;
}

// XP strand: beads of carnelian, lapis and gold on a cord. 54 px period.
export function beadStrand({ lit = true } = {}) {
  const g = uid('bs');
  const beads = [
    { c: lit ? ['#ff9a6a', '#c8502f', '#6e2214'] : ['#5a2a22', '#3a1a14', '#241008'], x: 9 },
    { c: lit ? ['#9fc0ff', '#3d6bd6', '#0f2a66'] : ['#26386a', '#162450', '#0c1636'], x: 27 },
    { c: lit ? ['#fff0b8', '#d9a441', '#7a5518'] : ['#6a5628', '#473818', '#2a200c'], x: 45 },
  ];
  const defs = beads.map((b, i) => `<radialGradient id="${g}${i}" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="${b.c[0]}"/><stop offset=".5" stop-color="${b.c[1]}"/><stop offset="1" stop-color="${b.c[2]}"/></radialGradient>`).join('');
  const body = beads.map((b, i) => `<circle cx="${b.x}" cy="8" r="6.4" fill="url(#${g}${i})" stroke="${P.bitumen}" stroke-width="1"/>${lit ? `<circle cx="${b.x - 2}" cy="5.6" r="1.5" fill="#fff" opacity=".6"/>` : ''}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="16" viewBox="0 0 54 16"><defs>${defs}</defs><rect y="7" width="54" height="2" fill="${lit ? '#3a2a14' : '#0a0806'}"/>${body}</svg>`;
}

// Minimap bezel: a ring of interlocking triangles with gold studs at N/E/S/W.
export function minimapRing(size = 216, band = 14) {
  const R = size / 2, rOut = R - 1.5, rIn = R - band + 1.5, M = 32;
  const pt = (rad, deg) => `${(R + rad * Math.sin((deg * Math.PI) / 180)).toFixed(2)} ${(R - rad * Math.cos((deg * Math.PI) / 180)).toFixed(2)}`;
  const step = 360 / M;
  let tri = '';
  for (let i = 0; i < M; i++) {
    const a = i * step;
    const upC = i % 2 ? P.carnHi : P.shell;
    tri += `<path d="M${pt(rIn, a - step / 2)} L${pt(rIn, a + step / 2)} L${pt(rOut - 1.5, a)}Z" fill="${upC}" stroke="${P.bitumen}" stroke-width=".9" stroke-linejoin="round"/>`;
    tri += `<path d="M${pt(rOut - 1.5, a)} L${pt(rOut - 1.5, a + step)} L${pt(rIn, a + step / 2)}Z" fill="${i % 2 ? P.lapis : P.lapisHi}" stroke="${P.bitumen}" stroke-width=".9" stroke-linejoin="round"/>`;
  }
  let studs = '';
  for (let k = 0; k < 4; k++) {
    const [x, y] = pt((rOut + rIn) / 2 + 0.5, k * 90).split(' ');
    studs += `<circle cx="${x}" cy="${y}" r="5.6" fill="${P.bitumen}"/><circle cx="${x}" cy="${y}" r="4.6" fill="${P.gold}" stroke="${P.goldHi}" stroke-width=".8"/><circle cx="${+x - 1}" cy="${+y - 1}" r="1.5" fill="#fff6d0"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${R}" cy="${R}" r="${R - band / 2}" fill="none" stroke="${P.bitumen}" stroke-width="${band}"/>
    <circle cx="${R}" cy="${R}" r="${R - 0.7}" fill="none" stroke="${P.gold}" stroke-width="1.4"/>
    ${tri}
    <circle cx="${R}" cy="${R}" r="${rIn - 0.6}" fill="none" stroke="${P.bitumen}" stroke-width="1.6"/><circle cx="${R}" cy="${R}" r="${rIn - 1.6}" fill="none" stroke="${P.gold}" stroke-width=".8" opacity=".7"/>
    ${studs}
  </svg>`;
}

// ---------------------------------------------------------------- install
export function installOrnaments() {
  const root = document.documentElement.style;
  const set = (k, svg) => root.setProperty(k, dataUri(svg));
  for (const name of ['lapis', 'carn', 'gold']) set(`--mosaic${name === 'lapis' ? '' : `-${name}`}`, mosaicFrame(name, 12));
  for (const name of Object.keys(SCHEMES)) set(`--mosaic-s${name === 'lapis' ? '' : `-${name}`}`, mosaicFrame(name, 8));
  set('--tri-band', triBand());
  set('--tri-band-gold', triBand({ up: [P.goldHi, P.gold], down: [P.lapisHi, P.lapis] }));
  set('--tri-band-carn', triBand({ up: [P.carnHi, P.carn], down: [P.shell, P.shellDim] }));
  set('--tri-band-fire', triBand({ up: ['#ff9a4a', '#ffc36a'], down: [P.carn, P.carnDeep] }));
  set('--tri-band-clay', triBand({ up: ['#3a2410', '#1c1208'], down: ['#8a5a2c', '#6e4520'] }));
  set('--frieze', frieze());
  set('--stone', stone());
  set('--grain', GRAIN);
  set('--wave', WAVE);
  set('--zigzag', ZIGZAG);
  set('--notch', NOTCH);
  set('--cune-gold', cuneiform({ color: P.gold, opacity: 0.22 }));
  set('--cune-dim', cuneiform({ color: P.shell, opacity: 0.075, w: 150, h: 40 }));
  set('--cune-title', cuneiform({ color: P.goldHi, opacity: 0.55, w: 300, h: 34 }));
  set('--cune-dark', cuneiform({ color: '#2a1608', opacity: 0.4, w: 150, h: 40 }));
  set('--bead-life', beadRing('life'));
  set('--bead-anima', beadRing('anima'));
  set('--bead-cap', beadCap());
  set('--beads-lit', beadStrand({ lit: true }));
  set('--beads-dim', beadStrand({ lit: false }));
  set('--mm-ring', minimapRing());
}

// Fill every [data-orn] placeholder in the DOM with its SVG ornament.
export function fillOrnaments(root = document) {
  const make = {
    rosette: () => rosette({ size: 30 }),
    'rosette-s': () => rosette({ size: 22 }),
    'rosette-l': () => rosette({ size: 46 }),
    divider: () => divider({ width: 320 }),
    gates: () => gatesEmblem(),
    corner: () => corner26(),
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
