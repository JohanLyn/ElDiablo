// Painted-looking NPC portraits drawn on canvas (no image assets).
const cache = new Map();

const LOOKS = {
  ninsun: { robe: '#efe6cf', trim: '#3d6bd6', skin: '#b9825a', hair: '#15100c', headwear: 'crown', bg: ['#2d56b8', '#0b1a3e'] },
  ubar: { robe: '#b8432c', trim: '#d9a441', skin: '#a8714a', hair: '#2a1a10', headwear: 'turban', beard: true, bg: ['#a56a38', '#2a1a0c'] },
  guard: { robe: '#4a5878', trim: '#b9ad94', skin: '#b07a52', hair: '#15100c', headwear: 'helm', beard: true, bg: ['#2a4a8a', '#0a1228'] },
};

export function portrait(id, size = 132) {
  const key = `${id}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const L = LOOKS[id] ?? LOOKS.guard;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 132;
  g.scale(s, s);
  const bg = g.createRadialGradient(66, 50, 10, 66, 66, 90);
  bg.addColorStop(0, L.bg[0]);
  bg.addColorStop(1, L.bg[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, 132, 132);
  // Shoulders and robe.
  g.fillStyle = L.robe;
  g.beginPath(); g.moveTo(10, 132); g.quadraticCurveTo(20, 86, 66, 84); g.quadraticCurveTo(112, 86, 122, 132); g.fill();
  g.strokeStyle = L.trim; g.lineWidth = 5;
  g.beginPath(); g.moveTo(46, 90); g.lineTo(66, 120); g.lineTo(86, 90); g.stroke();
  // Neck + head.
  g.fillStyle = L.skin;
  g.fillRect(57, 70, 18, 18);
  g.beginPath(); g.ellipse(66, 56, 21, 25, 0, 0, Math.PI * 2); g.fill();
  // Shading on the face.
  const sh = g.createLinearGradient(45, 0, 90, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = sh; g.beginPath(); g.ellipse(66, 56, 21, 25, 0, 0, Math.PI * 2); g.fill();
  // Eyes (kohl-lined) and brows.
  g.fillStyle = '#120a08';
  for (const x of [58, 74]) { g.beginPath(); g.ellipse(x, 54, 4.2, 2.2, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#f2e6cc';
  for (const x of [57.5, 73.5]) { g.beginPath(); g.arc(x, 53.6, 0.9, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = L.hair; g.lineWidth = 2.2;
  for (const [x1, x2] of [[52, 62], [70, 80]]) { g.beginPath(); g.moveTo(x1, 47); g.lineTo(x2, 46); g.stroke(); }
  g.strokeStyle = 'rgba(80,30,20,0.6)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(60, 68); g.quadraticCurveTo(66, 71, 72, 68); g.stroke();
  if (L.beard) {
    g.fillStyle = L.hair;
    g.beginPath(); g.moveTo(47, 60); g.quadraticCurveTo(50, 88, 66, 92); g.quadraticCurveTo(82, 88, 85, 60); g.quadraticCurveTo(66, 74, 47, 60); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(54 + i * 4, 72); g.lineTo(55 + i * 4, 88); g.stroke(); }
  }
  // Headwear.
  if (L.headwear === 'crown') {
    g.fillStyle = L.hair; g.beginPath(); g.ellipse(66, 40, 23, 14, 0, Math.PI, 0); g.fill();
    g.fillRect(43, 40, 7, 34); g.fillRect(82, 40, 7, 34);
    g.fillStyle = '#d9a441';
    g.beginPath(); g.moveTo(44, 36); for (let i = 0; i <= 6; i++) g.lineTo(44 + i * 7.3, i % 2 ? 22 : 32); g.lineTo(88, 36); g.closePath(); g.fill();
    g.fillStyle = L.trim; for (const x of [52, 66, 80]) { g.beginPath(); g.arc(x, 33, 2.6, 0, Math.PI * 2); g.fill(); }
  } else if (L.headwear === 'turban') {
    g.fillStyle = L.robe; g.beginPath(); g.ellipse(66, 36, 26, 16, 0, Math.PI, 0); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(66, 36 - i * 4, 25 - i * 3, 6, 0, Math.PI, 0); g.stroke(); }
    g.fillStyle = L.trim; g.beginPath(); g.arc(66, 30, 3.5, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = '#8a7a5a'; g.beginPath(); g.ellipse(66, 38, 24, 18, 0, Math.PI, 0); g.fill();
    g.fillRect(64, 20, 4, 18);
  }
  // Vignette frame.
  const v = g.createRadialGradient(66, 66, 40, 66, 66, 94);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = v; g.fillRect(0, 0, 132, 132);
  cache.set(key, c);
  return c;
}
