import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { part, merge, gradientPart, PROP_GEOMETRY } from './models.js';
import { heightAt, regionAt, roadDistance, isWater, WATER_LEVEL } from './terrain.js';
import { flatSpots, WAYPOINTS, HALF } from './layout.js';
import { canalDistance } from './canals.js';
import { LANDMARKS, addBlocked } from './spots.js';
import { patchLit } from './shaders/lit.js';
import { getEnv, NOISE_GLSL } from './shaders/common.js';
import { STORM, ZIG, ZIG_BEACONS } from './setpieces.js';

// Hand-built regional landmarks and set dressing: the broken lamassu and the
// half-buried ziggurat in the Dune Ruins, the First Gate silhouette over the
// Ashen Approach, marsh reed huts + boardwalk, and tilled Sunfield plots.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);

const SAND = [0xcdb487, 0xb99d6e, 0xdcc79c, 0xa98c5e];
const GOLD = 0xe0b040, LAPIS = 0x2146a8;

function stoneMaterial() {
  return patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}
// Gold and lapis catch a little light so bloom picks them up.
function accentMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3, emissive: 0x7a5410, emissiveIntensity: 0.55 });
}

function addMesh(group, geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  group.add(m);
  return m;
}

// ---------------------------------------------------------------- lamassu
function buildLamassu(scene, colliders) {
  const L = LANDMARKS.lamassu;
  const g = new THREE.Group();
  const stone = [], accent = [];
  const IVORY = [0xc4b79c, 0xa3977e, 0xd9cdb2, 0x877c68];
  const S = (geo, ci, o) => stone.push(part(geo, IVORY[ci], o));
  const A = (geo, c, o) => accent.push(part(geo, c, o));
  S(box(7.2, 1.3, 14), 3, { y: 0.45 }); // plinth
  S(box(7.6, 0.25, 14.4), 1, { y: 1.15 });
  S(box(3.4, 3.7, 5.2), 0, { y: 3.2, z: -2.2 }); // hind body
  S(box(3.7, 3.9, 3.2), 2, { y: 3.3, z: 1.7 }); // chest
  S(sph(2.1, 8, 6), 0, { y: 3.9, z: 2.0, sx: 1, sy: 0.95, sz: 0.95 });
  S(box(1.2, 2.7, 1.5), 1, { x: 1.2, y: 1.8, z: -3.4 }); // rear legs
  S(box(1.2, 2.7, 1.5), 1, { x: -1.2, y: 1.8, z: -3.4 });
  S(box(1.1, 2.7, 1.3), 2, { x: 1.2, y: 1.8, z: 2.6 }); // front right
  S(box(1.1, 1.0, 1.3), 1, { x: -1.2, y: 1.1, z: 2.6, rz: 0.15 }); // front left, broken
  S(box(1.4, 0.7, 1.2), 3, { x: -2.6, y: 1.05, z: 3.6, ry: 0.5, rz: 0.1 });
  S(cyl(0.95, 1.2, 1.7, 8), 0, { y: 5.7, z: 3.0, rx: 0.25 }); // neck stump
  for (let i = 0; i < 6; i++) { // right wing feathers, fanning back
    S(box(0.34, 0.7, 4.2 - i * 0.3), i % 2 ? 2 : 0, { x: 1.95 + i * 0.14, y: 5.6 + i * 0.55, z: -1.0 - i * 0.5, rz: -0.3 - i * 0.09, ry: -0.08 });
  }
  S(box(0.5, 0.8, 2.4), 1, { x: -1.9, y: 5.4, z: -1.5, rz: 0.4 }); // left wing: stubs
  S(box(0.4, 0.5, 1.5), 3, { x: -2.2, y: 5.9, z: -2.4, rz: 0.55, ry: 0.2 });
  S(cyl(0.3, 0.5, 3.4, 6), 1, { x: 0, y: 3.2, z: -5.6, rx: 1.15 }); // tail
  // The fallen head: bearded, horn-crowned.
  const hp = { x: -4.2, y: 1.7, z: 6.2 };
  S(sph(1.5, 8, 6), 2, { ...hp, sy: 1.1 });
  S(box(1.0, 1.4, 0.7), 1, { x: hp.x, y: hp.y - 1.1, z: hp.z + 0.6 }); // beard
  S(sph(0.28, 5, 4), 3, { x: hp.x - 0.5, y: hp.y + 0.1, z: hp.z + 1.1 });
  S(sph(0.28, 5, 4), 3, { x: hp.x + 0.5, y: hp.y + 0.1, z: hp.z + 1.1 });
  S(box(0.35, 0.5, 0.5), 1, { x: hp.x, y: hp.y - 0.15, z: hp.z + 1.3 });
  A(cyl(1.0, 1.1, 0.5, 10), GOLD, { x: hp.x, y: hp.y + 1.2, z: hp.z });
  A(cyl(0.12, 0.3, 1.5, 5), GOLD, { x: hp.x - 0.9, y: hp.y + 1.9, z: hp.z, rz: 0.5 });
  A(cyl(0.12, 0.3, 1.5, 5), GOLD, { x: hp.x + 0.9, y: hp.y + 1.9, z: hp.z, rz: -0.5 });
  // Gold collar and lapis band on the stump, inscription strip on the plinth.
  A(new THREE.TorusGeometry(1.15, 0.14, 5, 12), GOLD, { y: 5.05, z: 3.0, rx: Math.PI / 2 + 0.25 });
  A(box(7.4, 0.28, 0.12), LAPIS, { y: 0.85, z: 7.1 });
  A(box(7.4, 0.12, 0.14), GOLD, { y: 1.05, z: 7.1 });
  A(box(0.12, 0.28, 13.9), LAPIS, { x: 3.65, y: 0.85 });
  for (let i = 0; i < 7; i++) A(box(0.9, 0.6, 0.1), GOLD, { x: -3 + i * 1.0, y: 2.4, z: -4.82 });
  // Rubble.
  const rng = new Rng(11);
  for (let i = 0; i < 9; i++) {
    const a = rng.float(0, 6.28), r = rng.float(5, 9);
    S(new THREE.DodecahedronGeometry(rng.float(0.5, 1.2), 0), i % 4, { x: Math.cos(a) * r, y: 0.2, z: Math.sin(a) * r, sy: 0.7, ry: a });
  }
  addMesh(g, merge(stone), stoneMaterial());
  addMesh(g, merge(accent), accentMaterial());
  g.position.set(L.x, heightAt(L.x, L.z) - 0.35, L.z);
  g.rotation.y = 0.55;
  scene.add(g);
  const ax = Math.sin(0.55), az = Math.cos(0.55);
  for (const o of [-5, -3, -1, 1, 3]) colliders.addCircle(L.x + ax * o, L.z + az * o, 2.3);
  // Head and rubble.
  const c = Math.cos(0.55), s = Math.sin(0.55);
  colliders.addCircle(L.x + hp.x * c + hp.z * s, L.z - hp.x * s + hp.z * c, 1.5);
  return g;
}

// -------------------------------------------------------------- ziggurat
function buildZiggurat(scene, colliders) {
  const Z = LANDMARKS.ziggurat;
  const g = new THREE.Group();
  const stone = [], accent = [];
  const sizes = [30, 23, 16, 9], H = 3.4;
  const rng = new Rng(21);
  const P = (geo, ci, o) => part(geo, SAND[ci], o);
  sizes.forEach((sz, i) => {
    const y = i * H + H / 2 - 0.3;
    stone.push(gradientPart(box(sz, H, sz), 0x9a7c4e, SAND[i % 3], { y, axis: 'y' }));
    // Overhanging brick course on each tier.
    stone.push(P(box(sz + 0.5, 0.35, sz + 0.5), 3, { y: y + H / 2 - 0.1 }));
  });
  // Lapis + gold band on the second tier, framed doorway on the first.
  accent.push(part(box(23.15, 0.5, 23.15), LAPIS, { y: 1 * H + H / 2 - 0.9 }));
  accent.push(part(box(23.3, 0.14, 23.3), GOLD, { y: 1 * H + H / 2 - 0.5 }));
  accent.push(part(box(16.2, 0.5, 16.2), LAPIS, { y: 2 * H + H / 2 - 0.9 }));
  // Stairs up the south face and a dark doorway.
  for (let i = 0; i < 5; i++) stone.push(P(box(6, 0.6, 1.2), i % 2 ? 0 : 2, { y: 0.3 + i * 0.55, z: 19.0 - i * 0.9 }));
  stone.push(P(box(4.2, 3.2, 0.5), 3, { y: 1.6, z: 15.05 }));
  stone.push(part(box(2.2, 2.7, 0.6), 0x1a120c, { y: 1.45, z: 15.12 }));
  // Collapsed top and slumped debris.
  for (let i = 0; i < 16; i++) {
    const a = rng.float(0, 6.28), r = rng.float(8, 18);
    stone.push(P(new THREE.DodecahedronGeometry(rng.float(0.7, 2.0), 0), i % 4, { x: Math.cos(a) * r, y: rng.float(0, 1.2), z: Math.sin(a) * r, sy: 0.75, ry: a }));
  }
  for (let i = 0; i < 7; i++) {
    const bg = box(rng.float(1.2, 2.4), rng.float(0.8, 1.6), rng.float(1.2, 2.4)), o = { x: rng.float(-3.5, 3.5), y: 4 * H - 0.3 + 0.6, z: rng.float(-3.5, 3.5), ry: rng.float(0, 3), rz: rng.float(-0.3, 0.3) };
    // Keep the summit fire bowls clear of the rubble (rng draws stay identical).
    if (!ZIG_BEACONS.some(([bx, bz]) => Math.hypot(bx - o.x, bz - o.z) < 2.0) && Math.hypot(o.x, o.z) > 2.4) stone.push(P(bg, i % 4, o));
  }
  // Beacon bowls: a stone drum and a gold fire bowl at each corner, a larger pyre in the middle.
  for (const [bx, bz] of ZIG_BEACONS) {
    stone.push(P(cyl(0.55, 0.75, 0.7, 8), 3, { x: bx, y: ZIG.topY + 0.3, z: bz }));
    accent.push(part(cyl(0.95, 0.55, 0.45, 10), GOLD, { x: bx, y: ZIG.topY + 0.88, z: bz }));
    accent.push(part(new THREE.TorusGeometry(0.93, 0.07, 4, 12), LAPIS, { x: bx, y: ZIG.topY + 1.1, z: bz, rx: Math.PI / 2 }));
  }
  stone.push(P(cyl(1.5, 1.9, 0.6, 10), 3, { y: ZIG.topY + 0.25 }));
  accent.push(part(cyl(1.7, 1.1, 0.6, 12), GOLD, { y: ZIG.topY + 0.8 }));
  accent.push(part(new THREE.TorusGeometry(1.68, 0.1, 4, 14), LAPIS, { y: ZIG.topY + 1.08, rx: Math.PI / 2 }));
  // Sand pooled against the sides.
  for (let i = 0; i < 14; i++) {
    const side = i % 4, t = rng.float(-14, 14);
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? 15 : -15, z = side === 0 ? 15 : side === 1 ? -15 : t;
    stone.push(gradientPart(new THREE.IcosahedronGeometry(1, 1), 0x9a7440, 0xc39a5a, { x, y: 0.2, z, sx: rng.float(4, 7), sy: rng.float(1.4, 2.8), sz: rng.float(4, 7), axis: 'y' }));
  }
  addMesh(g, merge(stone), stoneMaterial());
  addMesh(g, merge(accent), accentMaterial());
  // Half-buried: tilt into the dune and sink the back.
  g.position.set(Z.x, heightAt(Z.x, Z.z) - ZIG.drop, Z.z);
  g.rotation.set(...ZIG.rot);
  scene.add(g);
  colliders.addBox(Z.x - 13.5, Z.z - 13.5, Z.x + 13.5, Z.z + 13.5);
  return g;
}

// ------------------------------------------------------- First Gate (far)
function buildGiantGate(scene, colliders) {
  const G = LANDMARKS.gate;
  const g = new THREE.Group();
  const stone = [], accent = [];
  const base = new THREE.Color(0x1b1424), top = new THREE.Color(0x3a2c4c);
  const slab = (w, h, d, x, y, z, o = {}) => stone.push(gradientPart(box(w, h, d), base, top, { x, y: y + h / 2, z, axis: 'y', ...o }));
  for (const sx of [-1, 1]) {
    slab(13, 58, 9, sx * 19, 0, 0);
    slab(15, 3, 11, sx * 19, 58, 0);
    slab(40, 30, 7, sx * 46, 0, 1.5);
    slab(26, 18, 6, sx * 70, 0, 3);
    for (let k = 0; k < 6; k++) accent.push(part(box(13.15, 0.5, 9.15), LAPIS, { x: sx * 19, y: 6 + k * 9 }));
    accent.push(part(box(15.3, 0.7, 11.3), GOLD, { x: sx * 19, y: 61.2 }));
  }
  slab(52, 10, 9, 0, 55, 0);
  accent.push(part(box(52.2, 1.2, 9.2), LAPIS, { y: 55.4 }));
  accent.push(part(box(52.4, 0.5, 9.3), GOLD, { y: 65.2 }));
  // Horn crenellations.
  for (let i = -4; i <= 4; i++) stone.push(gradientPart(new THREE.ConeGeometry(1.6, 6, 4), base, top, { x: i * 5.6, y: 68.5, axis: 'y' }));
  addMesh(g, merge(stone), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  addMesh(g, merge(accent), accentMaterial(), { cast: false });
  // Violet energy in the opening: breathes slowly, streams upward and flares with the lightning.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 56),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: getEnv().uTime, uFlash: STORM.flash },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime, uFlash;
        ${NOISE_GLSL}
        void main() {
          float v = 1.0 - vUv.y;
          float side = 1.0 - smoothstep(0.32, 0.5, abs(vUv.x - 0.5));
          float swirl = sin(vUv.x * 9.0 + uTime * 0.5 + vUv.y * 5.0) * 0.5 + 0.5;
          float stream = fbm3(vec2(vUv.x * 5.0, vUv.y * 3.0 - uTime * 0.35));
          float breathe = 0.78 + 0.22 * sin(uTime * 0.8) + 0.08 * sin(uTime * 2.3);
          float a = (pow(v, 1.6) * 0.65 + 0.06) * side * (0.6 + swirl * 0.2 + stream * 0.45) * breathe;
          a += uFlash * side * (0.25 + v * 0.4);
          vec3 c = mix(vec3(0.42, 0.14, 0.9), vec3(0.75, 0.55, 1.0), pow(stream, 2.0) * 0.8 + uFlash * 0.5);
          gl_FragColor = vec4(c * a * 1.6, a);
        }`,
    }),
  );
  glow.position.set(0, 28, -0.2);
  glow.renderOrder = 3;
  g.add(glow);
  g.position.set(G.x, -5.5, G.z);
  scene.add(g);
  colliders.addBox(G.x - 25.5, G.z - 5, G.x - 12.5, G.z + 5);
  colliders.addBox(G.x + 12.5, G.z - 5, G.x + 25.5, G.z + 5);
  colliders.addBox(G.x - 25, G.z - 5, G.x + 25, G.z - 3);
  return g;
}

// -------------------------------------------------------- marsh dressing
function buildMarsh(scene, colliders) {
  const wp = WAYPOINTS.find((w) => w.id === 'wp-marsh');
  const rng = new Rng(303);
  const stone = [], wood = [];
  // Reed huts hugging the shore, half sunk into the mud.
  const picks = [];
  for (let t = 0; t < 4000 && picks.length < 5; t++) {
    const a = rng.float(0, 6.28), r = rng.float(16, 58);
    const x = wp.x + Math.cos(a) * r, z = wp.z + Math.sin(a) * r;
    if (regionAt(x, z) !== 'marsh' || isWater(x, z) || roadDistance(x, z) < 8) continue;
    const h = heightAt(x, z);
    if (h > WATER_LEVEL + 0.55 || h < WATER_LEVEL - 0.15) continue;
    if (picks.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
    picks.push({ x, z, h, rot: rng.float(0, 6.28) });
  }
  const hutGeo = PROP_GEOMETRY.reedHut();
  const hutMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  const huts = new THREE.InstancedMesh(hutGeo, hutMat, Math.max(1, picks.length));
  const d = new THREE.Object3D();
  picks.forEach((p, i) => {
    d.position.set(p.x, p.h - 0.55, p.z);
    d.rotation.set(0.05, p.rot, 0.09);
    d.scale.setScalar(1.0 + (i % 2) * 0.2);
    d.updateMatrix();
    huts.setMatrixAt(i, d.matrix);
    colliders.addCircle(p.x, p.z, 2.0);
    addBlocked(p.x, p.z, 5);
  });
  huts.count = picks.length;
  huts.castShadow = huts.receiveShadow = true;
  huts.computeBoundingSphere();
  scene.add(huts);

  // Boardwalk from the waypoint toward the nearest open water.
  let best = null;
  for (let r = 8; r < 75 && !best; r += 3) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 6.28;
      const x = wp.x + Math.cos(a) * r, z = wp.z + Math.sin(a) * r;
      if (isWater(x, z) && roadDistance(x, z) > 10) { best = { x, z, a }; break; }
    }
  }
  if (best) {
    const sx = wp.x + Math.cos(best.a) * 6, sz = wp.z + Math.sin(best.a) * 6;
    const ex = best.x + Math.cos(best.a) * 3, ez = best.z + Math.sin(best.a) * 3;
    const len = Math.hypot(ex - sx, ez - sz);
    const dx = (ex - sx) / len, dz = (ez - sz) / len;
    const yaw = Math.atan2(dx, dz);
    for (let u = 0; u < len; u += 0.62) {
      const x = sx + dx * u, z = sz + dz * u;
      const y = Math.max(heightAt(x, z), WATER_LEVEL) + 0.26;
      wood.push(part(box(2.3, 0.1, 0.5), (Math.round(u / 0.62) % 2) ? 0x7a5632 : 0x6a4a2a, { x, y, z, ry: yaw + ((u * 7.3) % 1 - 0.5) * 0.05 }));
      if (Math.round(u / 0.62) % 5 === 0) {
        for (const side of [-1, 1]) {
          const px = x + dz * side * 1.1, pz = z - dx * side * 1.1;
          const gy = Math.min(heightAt(px, pz), y - 0.4);
          wood.push(part(cyl(0.09, 0.11, y - gy + 0.45, 5), 0x4a3320, { x: px, y: (y + gy) / 2 - 0.1, z: pz }));
        }
      }
      if (u % 3 < 0.62) addBlocked(x, z, 2.5);
    }
  }
  if (wood.length) {
    const m = new THREE.Mesh(merge(wood), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}

// -------------------------------------------------------- Sunfield plots
function buildFields(scene) {
  const rng = new Rng(777);
  const flats = flatSpots();
  const placed = [];
  const verts = [], cols = [], idx = [];
  const wheatGeo = PROP_GEOMETRY.wheat();
  const wheatMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), { sway: 0.1 });
  const crops = [];
  const W = 16, D = 11;
  for (let t = 0; t < 6000 && placed.length < 6; t++) {
    const x = rng.float(-120, 120), z = rng.float(-50, 118);
    if (regionAt(x, z) !== 'sunfields') continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 40)) continue;
    const rd = roadDistance(x, z);
    if (rd < 14 || rd > 70 || canalDistance(x, z) < 12) continue;
    if (flats.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 14)) continue;
    let lo = 99, hi = -99;
    for (const [ox, oz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, 0]]) { const h = heightAt(x + ox, z + oz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 0.7) continue;
    placed.push({ x, z });
  }
  const dry = new THREE.Color(0x6b4a2a), ridge = new THREE.Color(0x8a6a3a), green = new THREE.Color(0x4a6a28);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  placed.forEach((p, pi) => {
    addBlocked(p.x, p.z, 11);
    const rows = Math.round(D / 0.55), segs = 8;
    const base = verts.length / 3;
    for (let r = 0; r <= rows; r++) {
      const z = p.z - D / 2 + (r / rows) * D, isRidge = r % 2 === 1;
      for (let s = 0; s <= segs; s++) {
        const x = p.x - W / 2 + (s / segs) * W;
        const edge = Math.min(r, rows - r, s, segs - s) === 0 ? -0.12 : 0;
        verts.push(x, heightAt(x, z) + (isRidge ? 0.14 : 0.03) + edge, z);
        const c = isRidge ? ridge : dry;
        cols.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rows; r++) for (let s = 0; s < segs; s++) {
      const a = base + r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    for (let r = 1; r < rows; r += 2) for (let x = -W / 2 + 0.8; x < W / 2 - 0.4; x += 1.8) {
      const px = p.x + x + rng.float(-0.25, 0.25), pz = p.z - D / 2 + (r / rows) * D;
      dummy.position.set(px, heightAt(px, pz) + 0.12, pz);
      dummy.rotation.set(0, rng.float(0, 6), 0);
      dummy.scale.setScalar(rng.float(0.8, 1.05));
      dummy.updateMatrix();
      const k = pi % 2 ? 1 : 0.0;
      crops.push([dummy.matrix.clone(), tint.clone().setRGB(1 - k * 0.55, 1, 1 - k * 0.7).multiplyScalar(rng.float(0.85, 1.1))]);
    }
  });
  if (!placed.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  const inst = new THREE.InstancedMesh(wheatGeo, wheatMat, crops.length);
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(crops.length * 3), 3);
  crops.forEach(([m, c], i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, c); });
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  scene.add(inst);
}

export function buildLandmarks(scene, colliders) {
  return {
    lamassu: buildLamassu(scene, colliders),
    ziggurat: buildZiggurat(scene, colliders),
    gate: buildGiantGate(scene, colliders),
    marsh: buildMarsh(scene, colliders),
    fields: buildFields(scene),
  };
}
