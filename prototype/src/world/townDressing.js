import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { part, merge, gradientPart, PROP_GEOMETRY } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchLit } from './shaders/lit.js';
import { createGlow, createFlames } from './shaders/glow.js';

// Set dressing for Eridu Outpost: banners, lanterns, braziers, jars, awnings,
// a cart, palms, merlons and the lapis temple crown. Everything repeated is
// instanced or merged so the whole town costs a few dozen draw calls.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);

const GOLD = 0xe0b040, LAPIS = 0x2146a8, RED = 0x9a2a26;
const BRICK = 0x9a6c46;

export const goldMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3, emissive: 0x6a4810, emissiveIntensity: 0.6 });
export const lapisMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, emissive: 0x081a58, emissiveIntensity: 0.7 });
// Things that glow with the dusk/night weight. decorateHouse() registers each house's
// window mesh here (the camera rig clones occluder materials, so we update meshes, not
// shared materials) and dressTown() fills in the rest; updateTownGlow() runs per frame.
const GLOW = { windows: [], core: null, paper: null, halos: null, spill: null, spillMat: null };
const HOUSES = []; // roof corners + door of each house in world space, for the lantern strings
const _gc = new THREE.Color();
const WIN_COLOR = new THREE.Color(2.4, 1.6, 0.8), CORE_COLOR = new THREE.Color(3.2, 1.7, 0.6);
const SPILL_COLOR = new THREE.Color(1.0, 0.55, 0.22);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function updateTownGlow(tod, t) {
  const dark = Math.max(tod.night, tod.dusk * 0.55);
  const k = clamp01(dark * 1.6); // lit by dusk, fully on at night
  const flick = 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 23.3) * 0.02;
  for (const m of GLOW.windows) m.material.color.copy(WIN_COLOR).multiplyScalar((0.1 + 0.9 * k) * flick);
  if (GLOW.core) GLOW.core.material.color.copy(CORE_COLOR).multiplyScalar(0.18 + 0.82 * k);
  if (GLOW.paper) GLOW.paper.material.color.setScalar((0.22 + 2.4 * k) * flick);
  if (GLOW.halos) GLOW.halos.material.uniforms.uOpacity.value = 0.4 * k;
  if (GLOW.spillMat) GLOW.spillMat.color.copy(SPILL_COLOR).multiplyScalar(0.5 * k);
  if (GLOW.spill) GLOW.spill.visible = k > 0.01;
  if (GLOW.halos) GLOW.halos.visible = k > 0.01;
  return k;
}

function radialTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Thin cylinder from a to b as a vertex-coloured part (for wires).
const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
function tube(a, b, r, color) {
  const g = new THREE.CylinderGeometry(r, r, 1, 3).toNonIndexed();
  g.deleteAttribute('uv');
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  _q.setFromUnitVectors(_up, dir.normalize());
  g.applyMatrix4(_m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), _q, new THREE.Vector3(1, len, 1)));
  const c = new THREE.Color(color), cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

const woodMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

// Hanging cloth: top edge at y = 0, hangs down; vertex colours form the emblem.
function clothGeo(w, h, base, trim, emblem, sx = 4, sy = 9) {
  const pos = [], col = [], idx = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(trim), ce = new THREE.Color(emblem), c = new THREE.Color();
  for (let j = 0; j <= sy; j++) {
    for (let i = 0; i <= sx; i++) {
      const u = i / sx, v = j / sy;
      pos.push((u - 0.5) * w, -v * h * (1 - 0.0), 0);
      const edge = Math.min(u, 1 - u) < 0.14 || v > 0.93 || v < 0.05;
      const dia = Math.abs(u - 0.5) * 2.2 + Math.abs(v - 0.45) * 1.15 < 0.62;
      c.copy(edge ? ct : dia ? ce : cb);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, b = a + 1, cc = a + sx + 1, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function instanced(geo, mat, matrices, colors = null) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  if (colors) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(matrices.length * 3), 3); colors.forEach((c, i) => m.setColorAt(i, c)); }
  m.castShadow = true; m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

const mxAt = (x, y, z, ry = 0, s = 1) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); o.updateMatrix(); return o.matrix.clone(); };

// Per-house trim: parapet, reed-mat awning over the door, lapis door frame, glowing window slits.
export function decorateHouse(house, { w, d, h, rng }) {
  const wood = [], gold = [], lapis = [];
  const top = h + 0.3;
  // Parapet lip around the flat roof.
  const t = 0.28, ph = 0.34;
  wood.push(part(box(w + 0.5, ph, t), BRICK, { y: top + ph / 2, z: d / 2 + 0.1 }));
  wood.push(part(box(w + 0.5, ph, t), BRICK, { y: top + ph / 2, z: -d / 2 - 0.1 }));
  wood.push(part(box(t, ph, d + 0.5), BRICK, { y: top + ph / 2, x: w / 2 + 0.1 }));
  wood.push(part(box(t, ph, d + 0.5), BRICK, { y: top + ph / 2, x: -w / 2 - 0.1 }));
  // Lapis lintel and posts around the door (local +z is the door side).
  lapis.push(part(box(1.5, 0.26, 0.2), LAPIS, { y: 2.12, z: d / 2 + 0.07 }));
  lapis.push(part(box(0.2, 2.0, 0.2), LAPIS, { x: -0.65, y: 1.05, z: d / 2 + 0.07 }));
  lapis.push(part(box(0.2, 2.0, 0.2), LAPIS, { x: 0.65, y: 1.05, z: d / 2 + 0.07 }));
  gold.push(part(box(1.6, 0.08, 0.22), GOLD, { y: 2.3, z: d / 2 + 0.08 }));
  // Reed-mat awning with striped weave, on two poles.
  const aw = rng.chance(0.75);
  if (aw) {
    for (let i = 0; i < 7; i++) {
      wood.push(part(box(0.5, 0.07, 1.9), i % 2 ? 0xc8a85a : 0xa8884a, { x: (i - 3) * 0.5, y: 2.65 - 0.0, z: d / 2 + 1.1, rx: 0.22 }));
    }
    for (const sx of [-1.7, 1.7]) wood.push(part(cyl(0.05, 0.06, 2.4, 5), 0x4a3320, { x: sx, y: 1.3, z: d / 2 + 1.95 }));
  }
  // A couple of jars and a bundle of reeds on the roof.
  const rj = rng.int(1, 3);
  for (let i = 0; i < rj; i++) wood.push(part(cyl(0.22, 0.3, 0.6, 7), 0xb8663a, { x: rng.float(-w / 2 + 0.7, w / 2 - 0.7), y: top + 0.35, z: rng.float(-d / 2 + 0.7, d / 2 - 0.7) }));
  const add = (geos, mat, cast = true) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(merge(geos), mat);
    m.castShadow = cast; m.receiveShadow = true;
    house.add(m);
  };
  add(wood, woodMaterial());
  add(lapis, lapisMaterial(), false);
  add(gold, goldMaterial(), false);
  // Warm window slits and a glowing doorway (unlit basic so they glow; keyed to dusk by updateTownGlow).
  const win = [];
  for (const [x, z, ry] of [[-w / 2 - 0.03, rng.float(-d / 4, d / 4), -Math.PI / 2], [w / 2 + 0.03, rng.float(-d / 4, d / 4), Math.PI / 2], [rng.chance(0.5) ? 1.9 : -1.9, d / 2 + 0.04, 0]]) {
    win.push(part(box(0.5, 0.8, 0.05), 0xffa24a, { x, y: h * 0.62, z, ry }));
  }
  win.push(part(box(0.84, 1.62, 0.04), 0xffc070, { y: 0.98, z: d / 2 + 0.1 })); // doorway lamplight
  const wm = new THREE.Mesh(merge(win), new THREE.MeshBasicMaterial({ vertexColors: true, color: WIN_COLOR.clone() }));
  house.add(wm);
  GLOW.windows.push(wm);
  // Anchors for lantern strings: the roof corners and the spot in front of the door, in world space.
  house.updateMatrix();
  const tp = top + 0.4;
  HOUSES.push({
    corners: [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => new THREE.Vector3(sx * (w / 2 + 0.2), tp, sz * (d / 2 + 0.2)).applyMatrix4(house.matrix)),
    door: new THREE.Vector3(0, 0, d / 2 + 1.7).applyMatrix4(house.matrix),
  });
}

export function dressTown(scene, colliders, { cx, cz, r }, lights = null) {
  const rng = new Rng(2024);
  const wood = [], gold = [], lapis = [], stone = [];
  const at = (x, z) => [cx + x, cz + z];

  // ---- banner poles with hanging cloth + lanterns on the arm
  const poles = [[-5.6, -15, 0.0], [5.8, -16, 0.0], [-5.6, 7, 0.0], [5.6, 13, 0.0], [-5.6, 17, 0.0], [5.6, 21, 0.0], [-9, -22.5, 0.0], [9.5, -22.5, 0.0],
    [-9.5, 22.5, 0.0], [9.5, 22.5, 0.0], [-5.6, -4, 0.0], [5.6, -4, 0.0]]; // the last four: south gate pair + plaza entry
  const clothA = [], clothB = [], clothAcol = [], lanternAt = [];
  poles.forEach(([px, pz], i) => {
    const [x, z] = at(px, pz);
    const side = px < 0 ? 1 : -1; // arm points toward the road
    wood.push(part(cyl(0.09, 0.13, 4.6, 6), 0x5a3d24, { x, y: 2.3, z }));
    wood.push(part(cyl(0.05, 0.05, 1.7, 5), 0x5a3d24, { x: x + side * 0.85, y: 4.35, z, rz: Math.PI / 2 }));
    gold.push(part(sph(0.16, 6, 5), GOLD, { x, y: 4.72, z }));
    gold.push(part(box(0.18, 0.18, 0.18), GOLD, { x: x + side * 1.7, y: 4.35, z }));
    const m = mxAt(x + side * 0.85, 4.3, z, Math.PI / 2 * 0 + (i % 2 ? 0.0 : 0.0), 1);
    (i % 2 ? clothB : clothA).push(m);
    lanternAt.push([x + side * 1.6, 3.95, z, true]);
    colliders.addCircle(x, z, 0.3);
  });
  const clothMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x201008, emissiveIntensity: 0.2 }), { cloth: 1 });
  scene.add(instanced(clothGeo(1.25, 2.7, RED, GOLD, 0xe8d8a0), clothMat, clothA));
  scene.add(instanced(clothGeo(1.25, 2.7, 0x1f3f94, GOLD, 0xe8d8a0), clothMat, clothB));

  // ---- doorway lanterns on stakes, plaza torches
  for (const [px, pz] of [[-3.2, -5.5], [3.2, -5.5], [-3.2, 0.5], [3.2, 9]]) {
    const [x, z] = at(px, pz);
    wood.push(part(cyl(0.06, 0.08, 2.2, 5), 0x4a3320, { x, y: 1.1, z }));
    lanternAt.push([x, 2.15, z, false]);
  }
  // Lantern bodies (instanced) + glowing cores + halos.
  const lanternFrame = merge([
    part(cyl(0.2, 0.2, 0.06, 6), 0x2a2018, { y: 0.0 }),
    part(new THREE.ConeGeometry(0.26, 0.2, 6), 0x3a2a1c, { y: 0.4 }),
    part(cyl(0.22, 0.22, 0.06, 6), 0x3a2a1c, { y: -0.34 }),
    part(box(0.03, 0.62, 0.03), 0x2a2018, { x: 0.18, y: 0.0 }), part(box(0.03, 0.62, 0.03), 0x2a2018, { x: -0.18, y: 0.0 }),
    part(box(0.03, 0.62, 0.03), 0x2a2018, { z: 0.18 }), part(box(0.03, 0.62, 0.03), 0x2a2018, { z: -0.18 }),
    part(cyl(0.01, 0.01, 0.5, 3), 0x2a2018, { y: 0.65 }),
  ]);
  const lanternCore = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6);
  const lm = lanternAt.map(([x, y, z]) => mxAt(x, y, z));
  scene.add(instanced(lanternFrame, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), lm));
  const coreMesh = instanced(lanternCore, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.7, 0.6) }), lm);
  coreMesh.castShadow = false;
  scene.add(coreMesh);
  GLOW.core = coreMesh;
  const nightHalos = lanternAt.map(([x, y, z]) => ({ x, y, z, color: 0xff9440, size: 3.6, flicker: 0.12 }));
  const halos = []; // always-on glows (braziers, temple)

  // ---- braziers with billboard flames
  const flames = [], brazierPos = [[-5, -23.5], [5, -23.5], [0, 12.5], [-14, -1], [-5, 23.5], [5, 23.5], [-4.6, -2.4], [-11.4, -2.4]];
  for (const [px, pz] of brazierPos) {
    const [x, z] = at(px, pz);
    gold.push(part(cyl(0.1, 0.2, 1.1, 6), 0x3a2a1c, { x, y: 0.55, z }));
    gold.push(part(cyl(0.5, 0.28, 0.32, 8), GOLD, { x, y: 1.2, z }));
    stone.push(part(cyl(0.3, 0.36, 0.2, 8), 0x3a2a1c, { x, y: 0.1, z }));
    flames.push({ x, y: 1.28, z, s: 1.5 });
    halos.push({ x, y: 1.9, z, color: 0xff8a30, size: 6.5, flicker: 0.25 });
    colliders.addCircle(x, z, 0.5);
    lights?.add({ x, y: 2.1, z, color: 0xff8a30, intensity: 8, range: 12, decay: 1.6, flicker: 0.5, night: 0.6 });
  }
  scene.add(createFlames(flames));

  // ---- merlons + lapis band on the town wall
  const wallTop = 3.2;
  const merlon = (x, z, ry) => stone.push(part(box(0.75, 0.55, 1.3), BRICK, { x, y: wallTop + 0.27, z, ry }));
  for (let s = -r; s <= r; s += 1.7) {
    for (const side of [-r, r]) {
      if (Math.abs(s) > 3.4 || false) {
        merlon(cx + s, cz + side, Math.PI / 2);
      }
    }
    merlon(cx - r, cz + s, 0);
    merlon(cx + r, cz + s, 0);
  }
  for (const sz of [-r, r]) for (const sgn of [-1, 1]) lapis.push(part(box(r - 3.2, 0.3, 1.3), LAPIS, { x: cx + sgn * (3.2 + (r - 3.2) / 2), y: 2.55, z: cz + sz }));
  for (const sx of [-r, r]) lapis.push(part(box(1.3, 0.3, 2 * r), LAPIS, { x: cx + sx, y: 2.55, z: cz }));

  // ---- temple crown: glazed lapis cap, gold horns, stairs and offering braziers
  const [tx, tz] = at(-8, -7);
  lapis.push(part(box(3.0, 0.25, 3.0), LAPIS, { x: tx, y: 2.52, z: tz }));
  lapis.push(part(box(1.6, 1.4, 1.6), LAPIS, { x: tx, y: 3.3, z: tz }));
  gold.push(part(box(1.75, 0.16, 1.75), GOLD, { x: tx, y: 4.05, z: tz }));
  for (const sx of [-1, 1]) {
    gold.push(part(new THREE.ConeGeometry(0.22, 1.9, 6), GOLD, { x: tx + sx * 0.75, y: 5.0, z: tz, rz: -sx * 0.45 }));
    gold.push(part(new THREE.ConeGeometry(0.14, 0.9, 5), GOLD, { x: tx + sx * 1.35, y: 5.75, z: tz, rz: -sx * 0.95 }));
  }
  for (const [ox, oz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) {
    gold.push(part(new THREE.ConeGeometry(0.2, 0.95, 5), GOLD, { x: tx + ox * 1.15, y: 2.1, z: tz + oz * 1.15, rz: ox > 0 ? -0.3 : 0.3 }));
  }
  for (let k = 0; k < 3; k++) stone.push(part(box(2.8 - k * 0.2, 0.3, 0.8), 0xb08458, { x: tx, y: 0.15 + k * 0.28, z: tz + 3.5 + 0.55 + (2 - k) * 0.7 }));
  lapis.push(part(box(7.1, 0.24, 7.1), LAPIS, { x: tx, y: 0.7, z: tz }));
  gold.push(part(box(7.2, 0.08, 7.2), GOLD, { x: tx, y: 0.84, z: tz }));
  gold.push(part(box(5.2, 0.08, 5.2), GOLD, { x: tx, y: 1.64, z: tz }));
  halos.push({ x: tx, y: 4.2, z: tz, color: 0x6a8aff, size: 7, flicker: 0.05 });

  // ---- cart + crates + sacks
  const [kx, kz] = at(-12.5, 2.5);
  const cartParts = [
    part(box(2.6, 0.16, 1.3), 0x6a4a2a, { y: 0.85 }),
    part(box(2.6, 0.5, 0.1), 0x7a5632, { y: 1.15, z: 0.62 }), part(box(2.6, 0.5, 0.1), 0x7a5632, { y: 1.15, z: -0.62 }),
    part(box(0.1, 0.5, 1.3), 0x7a5632, { x: -1.3, y: 1.15 }),
    part(cyl(0.55, 0.55, 0.1, 10), 0x4a3320, { x: 0.3, y: 0.55, z: 0.75, rx: Math.PI / 2 }), part(cyl(0.55, 0.55, 0.1, 10), 0x4a3320, { x: 0.3, y: 0.55, z: -0.75, rx: Math.PI / 2 }),
    part(box(2.4, 0.07, 0.07), 0x4a3320, { x: 2.3, y: 0.7, z: 0.3, rz: 0.1 }), part(box(2.4, 0.07, 0.07), 0x4a3320, { x: 2.3, y: 0.7, z: -0.3, rz: 0.1 }),
    part(sph(0.45, 7, 5), 0xc8b27a, { x: -0.5, y: 1.35, z: 0.1 }), part(sph(0.4, 7, 5), 0xd6c08a, { x: 0.2, y: 1.3, z: -0.2 }), part(box(0.7, 0.55, 0.7), 0x8a6238, { x: 0.8, y: 1.3, z: 0.2, ry: 0.4 }),
  ];
  const cartM = new THREE.Mesh(merge(cartParts), woodMaterial());
  cartM.position.set(kx, 0.1, kz);
  cartM.rotation.y = 0.5;
  cartM.castShadow = cartM.receiveShadow = true;
  scene.add(cartM);
  colliders.addCircle(kx, kz, 1.5);

  // ---- market: second stall with produce and ground carpets
  const [sx2, sz2] = at(14, 3.5);
  const stall = [
    part(box(3.2, 0.9, 1.1), 0x6a4426, { y: 0.45 }),
    part(box(3.6, 0.08, 2.4), 0x9a2a26, { y: 2.45, z: -0.3, rx: 0.12 }),
  ];
  for (let i = 0; i < 6; i++) stall.push(part(box(0.6, 0.09, 2.4), i % 2 ? 0xe8d8a0 : 0x2a4f9a, { x: -1.5 + i * 0.6, y: 2.5 - (0), z: -0.3, rx: 0.12 }));
  for (const px of [-1.7, 1.7]) { stall.push(part(cyl(0.06, 0.06, 2.5, 5), 0xe0b040, { x: px, y: 1.25, z: 0.7 })); stall.push(part(cyl(0.06, 0.06, 2.2, 5), 0xe0b040, { x: px, y: 1.1, z: -0.9 })); }
  const fruit = [0xd8602a, 0xc8302a, 0xe0b040, 0x6aa030];
  for (let i = 0; i < 12; i++) stall.push(part(sph(0.13, 6, 4), fruit[i % 4], { x: -1.3 + (i % 6) * 0.5, y: 1.0, z: -0.2 + Math.floor(i / 6) * 0.35 }));
  const st2 = new THREE.Mesh(merge(stall), woodMaterial());
  st2.position.set(sx2, 0, sz2);
  st2.rotation.y = -Math.PI / 2;
  st2.castShadow = st2.receiveShadow = true;
  scene.add(st2);
  colliders.addBox(sx2 - 0.8, sz2 - 1.8, sx2 + 0.8, sz2 + 1.8);
  const carpets = [];
  [[11.5, -0.5, 0.2, LAPIS, GOLD], [11.8, 2.4, -0.3, RED, 0xe8d8a0], [-4.5, 11, 0.1, 0x2a6a58, GOLD]].forEach(([px, pz, ry, c1, c2]) => {
    const [x, z] = at(px, pz);
    carpets.push(part(box(2.4, 0.04, 1.5), c1, { x, y: 0.13, z, ry }));
    carpets.push(part(box(2.0, 0.05, 1.1), c2, { x, y: 0.135, z, ry }));
    carpets.push(part(box(1.5, 0.06, 0.7), c1, { x, y: 0.14, z, ry }));
  });
  const carpetM = new THREE.Mesh(merge(carpets), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  carpetM.receiveShadow = true;
  scene.add(carpetM);

  // ---- jars and amphorae (instanced) around the buildings and the plaza
  const jarGeo = PROP_GEOMETRY.jar();
  const jarM = [], jarC = [];
  const jarSpots = [[-3.4, -4], [-3.3, -3.2], [5.5, -1.8], [6.4, -2.4], [12.4, -6], [12.6, -2.2], [-13, 0], [-13.4, 4.5], [-4, 14], [-3, 18], [3.6, 17], [5, 22], [-6.5, -21.5], [7, -21.5], [-14, -15], [14.5, 1], [-3.2, 7], [-2.6, 7.8], [3, 24], [-4, 23.8]];
  for (const [px, pz] of jarSpots) {
    const [x, z] = at(px, pz);
    const s = rng.float(0.75, 1.15);
    jarM.push(mxAt(x, 0.1, z, rng.float(0, 6), s));
    jarC.push(new THREE.Color().setRGB(rng.float(0.8, 1.1), rng.float(0.8, 1.05), rng.float(0.75, 1)));
    colliders.addCircle(x, z, 0.38 * s);
  }
  scene.add(instanced(jarGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }), jarM, jarC));

  // ---- palms inside the walls
  const palmGeo = PROP_GEOMETRY.palm();
  const palmM = [], palmC = [];
  for (const [px, pz] of [[-14, 14.5], [14, -12.5], [23, -14], [-23, -12], [23, 17], [-23, 18], [-22.5, 3], [22.5, 2], [-3.2, -12.5]]) {
    const [x, z] = at(px, pz);
    const s = rng.float(0.85, 1.2);
    palmM.push(mxAt(x, 0.05, z, rng.float(0, 6), s));
    palmC.push(new THREE.Color().setScalar(rng.float(0.9, 1.1)));
    colliders.addCircle(x, z, 0.45 * s);
  }
  scene.add(instanced(palmGeo, patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), { sway: 0.011 }), palmM, palmC));

  // ---- lantern strings: catenary wires hung with glowing paper lanterns and pennants
  const P3 = (px, pz) => { const [x, z] = at(px, pz); return new THREE.Vector3(x, 4.55, z); };
  const strings = [
    [[-5.6, -15], [5.8, -16]], [[-5.6, 7], [5.6, 13]], [[-5.6, 17], [5.6, 21]], [[-9, -22.5], [9.5, -22.5]],
    [[-9.5, 22.5], [9.5, 22.5]], [[-5.6, -4], [5.6, -4]],
    [[-5.6, -15], [-5.6, -4]], [[-5.6, -4], [-5.6, 7]], [[5.6, -4], [5.8, -16]], [[5.6, -4], [5.6, 13]], [[-5.6, 7], [-5.6, 17]], [[5.6, 13], [5.6, 21]],
  ].map(([a, b]) => [P3(...a), P3(...b)]);
  // Roof strings: each street pole reaches for the nearest rooftop corner.
  for (const [px, pz] of [[-5.6, -15], [5.8, -16], [-5.6, 7], [5.6, 13], [-5.6, 17], [5.6, 21]]) {
    const a = P3(px, pz);
    let best = null, bd = 99;
    for (const hs of HOUSES) for (const c of hs.corners) { const d = Math.hypot(c.x - a.x, c.z - a.z); if (d > 3 && d < bd) { bd = d; best = c; } }
    if (best && bd < 12) strings.push([a, best.clone()]);
  }
  const wires = [], lanternM = [], lanternC = [], pennantM = [], pennantC = [], spill = [], spillAt = [];
  const PAPER = [0xd8342a, 0xf08a28, 0xf2c040, 0xe0502a, 0x3a6ad0, 0xf08a28].map((c) => new THREE.Color(c));
  const HANG = new THREE.Vector3(), PREV = new THREE.Vector3(), CUR = new THREE.Vector3();
  const lamps = [];
  strings.forEach(([a, b], si) => {
    const len = a.distanceTo(b), sag = Math.max(0.4, len * 0.055);
    const curve = (u, out) => out.lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u - sag * 4 * u * (1 - u));
    const N = Math.max(6, Math.round(len / 1.1));
    curve(0, PREV);
    for (let i = 1; i <= N; i++) { curve(i / N, CUR); wires.push(tube(PREV, CUR, 0.02, 0x1c140e)); PREV.copy(CUR); }
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const nl = Math.max(2, Math.round(len / 1.9));
    for (let k = 0; k < nl; k++) {
      const u = (k + 0.5) / nl;
      curve(u, HANG);
      lanternM.push(mxAt(HANG.x, HANG.y - 0.3, HANG.z, rng.float(0, 6), 1));
      lanternC.push(PAPER[(si * 3 + k) % PAPER.length]);
      if ((k + si) % 3 === 0) lamps.push([HANG.x, HANG.y - 0.3, HANG.z]);
      if (k % 2 === 0) spillAt.push([HANG.x, HANG.z, 1.7]);
      nightHalos.push({ x: HANG.x, y: HANG.y - 0.3, z: HANG.z, color: 0xff9a40, size: 2.0, flicker: 0.1 });
      // pennant between this lantern and the next
      curve(Math.min(0.98, u + 0.5 / nl), CUR);
      pennantM.push(mxAt(CUR.x, CUR.y - 0.01, CUR.z, 0, 1).multiply(new THREE.Matrix4().makeRotationY(yaw)));
      pennantC.push(PAPER[(si + k * 2 + 1) % 4]);
    }
  });
  if (wires.length) {
    const wm = new THREE.Mesh(merge(wires), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    wm.castShadow = false;
    scene.add(wm);
  }
  const paperGeo = new THREE.SphereGeometry(0.19, 8, 6);
  paperGeo.scale(1, 1.25, 1);
  const paper = instanced(paperGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) }), lanternM, lanternC);
  paper.castShadow = false;
  scene.add(paper);
  GLOW.paper = paper;
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.17, 0, 0, 0.17, 0, 0, 0, -0.44, 0], 3));
  flagGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const flags = instanced(flagGeo, patchLit(new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide, emissive: 0x201008, emissiveIntensity: 0.25 }), { cloth: 1 }), pennantM, pennantC);
  flags.castShadow = false;
  scene.add(flags);
  // Light spilling onto the street from lanterns and doorways (additive ground pools).
  for (const hs of HOUSES) spillAt.push([hs.door.x, hs.door.z, 2.5]);
  const planes = spillAt.map(([x, z, rad]) => { const g = new THREE.PlaneGeometry(rad * 2, rad * 2); g.rotateX(-Math.PI / 2); g.translate(x, 0.19, z); return g; });
  if (planes.length) {
    GLOW.spillMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    GLOW.spill = new THREE.Mesh(mergeGeometries(planes), GLOW.spillMat);
    GLOW.spill.renderOrder = 2;
    scene.add(GLOW.spill);
  }
  GLOW.halos = createGlow(nightHalos, { opacity: 0.5 });
  scene.add(GLOW.halos);
  // Most lanterns are lit by the pooled lights only at dusk and night (night: 1).
  if (lights) for (const [x, y, z] of lamps) lights.add({ x, y, z, color: 0xffa050, intensity: 3.6, range: 9, decay: 1.8, flicker: 0.2, night: 1 });

  // ---- finish merged meshes
  const fin = (geos, mat, cast = true) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(merge(geos), mat);
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m);
  };
  fin(wood, woodMaterial());
  fin(stone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  fin(gold, goldMaterial(), false);
  fin(lapis, lapisMaterial(), false);
  scene.add(createGlow(halos, { opacity: 0.5 }));
}
