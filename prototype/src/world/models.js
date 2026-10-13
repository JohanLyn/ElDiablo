import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Build one vertex-coloured geometry from primitive parts so a whole prop can be
// drawn with a single InstancedMesh.
export function part(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

export const merge = (parts) => mergeGeometries(parts, false);

const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);


// A curved leaf with a centre crease. Runs along +Z (arching up then drooping), or
// along +Y when `upright` (a blade of grass/reed leaning toward +Z).
export function leafGeo(len, width, { arch = 0.5, droop = 1.1, segs = 5, taper = 1.4, upright = false } = {}) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = (width / 2) * Math.max(0.05, Math.sin(Math.PI * Math.min(1, 0.12 + 0.88 * (1 - Math.pow(t, taper)))));
    const lift = len * (arch * t - droop * t * t * 0.5);
    if (upright) {
      const y = len * t, z = len * droop * t * t * 0.5;
      pos.push(-w, y, z, 0, y, z + width * 0.1, w, y, z);
    } else {
      const z = len * t;
      pos.push(-w, lift, z, 0, lift + width * 0.08, z, w, lift, z);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Like part(), but colours a base->tip gradient along the geometry's local axis.
export function gradientPart(geo, c0, c1, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, axis = 'z' } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  const lo = g.boundingBox.min[axis], hi = g.boundingBox.max[axis];
  const a = new THREE.Color(c0), b = new THREE.Color(c1), c = new THREE.Color();
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const arr = axis === 'x' ? 'getX' : axis === 'y' ? 'getY' : 'getZ';
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p[arr](i) - lo) / (hi - lo || 1)));
    c.copy(a).lerp(b, t);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return g;
}

export const PROP_GEOMETRY = {
  palm() {
    const parts = [];
    // Curved, ringed trunk.
    const N = 6, H = 5.4, lean = 0.9;
    const at = (t) => [lean * t * t, H * t];
    for (let i = 0; i < N; i++) {
      const [x0, y0] = at(i / N), [x1, y1] = at((i + 1) / N);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const rb = 0.3 - 0.13 * (i / N), rt = 0.3 - 0.13 * ((i + 1) / N);
      parts.push(part(new THREE.CylinderGeometry(rt, rb, len, 6, 1, true), i % 2 ? 0x7d5d3b : 0x6a4c2f, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rz: -Math.atan2(x1 - x0, y1 - y0) }));
    }
    const [tx, ty] = at(1);
    // Crown of arching fronds.
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
      const big = i % 2 === 0;
      const len = big ? 2.9 : 2.3;
      const tilt = big ? 0.15 : 0.55;
      parts.push(gradientPart(leafGeo(len, 0.85, { arch: 0.55 + tilt, droop: 1.3, segs: 4 }), big ? 0x2f5a22 : 0x3a6a26, big ? 0x86a83a : 0x9ab544, { x: tx, y: ty + 0.1, z: 0, ry: a }));
    }
    for (let i = 0; i < 4; i++) parts.push(gradientPart(leafGeo(1.6, 0.6, { arch: 1.5, droop: 0.9 }), 0x4a7a2a, 0xa5be4c, { x: tx, y: ty + 0.2, ry: i * 1.57 + 0.7 }));
    // Dates.
    parts.push(part(new THREE.SphereGeometry(0.24, 6, 4), 0xa86a22, { x: tx + 0.15, y: ty - 0.1, z: 0.1 }));
    parts.push(part(new THREE.SphereGeometry(0.2, 6, 4), 0x8a4a1a, { x: tx - 0.15, y: ty - 0.15, z: -0.1 }));
    return merge(parts);
  },
  wheat() {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.26 + ((i * 7) % 3) * 0.04, z = (Math.floor(i / 3) - 1) * 0.26;
      const h = 0.85 + (i % 3) * 0.1;
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.022, h, 3, 1, true), 0xcaa845, { x, y: h / 2, z, rz: (i % 2 - 0.5) * 0.18 }));
      parts.push(part(new THREE.ConeGeometry(0.05, 0.24, 4), i % 3 ? 0xe2c25a : 0xd2a63c, { x: x + (i % 2 - 0.5) * 0.09, y: h + 0.08, z }));
    }
    return merge(parts);
  },
  bush() {
    return merge([part(new THREE.IcosahedronGeometry(0.9, 0), 0x5b6e33, { y: 0.45, sy: 0.65 }), part(new THREE.IcosahedronGeometry(0.6, 0), 0x6b7e3b, { x: 0.5, y: 0.5, sy: 0.7 })]);
  },
  rock() {
    return merge([part(new THREE.DodecahedronGeometry(1, 0), 0x7a6d60, { y: 0.35, sy: 0.65 })]);
  },
  reed() {
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, r = 0.18 + (i % 4) * 0.11, h = 1.7 + (i % 5) * 0.28;
      parts.push(gradientPart(leafGeo(h, 0.11, { droop: 0.3 + (i % 3) * 0.14, segs: 4, taper: 1.0, upright: true }), 0x4d6a2c, i % 3 ? 0x9bb04a : 0xc4c25e, { x: Math.sin(a) * r, z: Math.cos(a) * r, ry: a, axis: 'y' }));
      if (i % 3 === 1) parts.push(part(cyl(0.055, 0.055, 0.34, 5), 0x6a3f22, { x: Math.sin(a) * r * 1.0, y: h * 0.82, z: Math.cos(a) * r }));
    }
    return merge(parts);
  },
  deadtree() {
    return merge([
      part(cyl(0.12, 0.3, 4, 5), 0x3d332c, { y: 2 }),
      part(cyl(0.05, 0.1, 1.8, 4), 0x3d332c, { x: 0.5, y: 3.2, rz: -0.9 }),
      part(cyl(0.05, 0.1, 1.5, 4), 0x3d332c, { x: -0.4, y: 2.6, rz: 0.8 }),
      part(cyl(0.04, 0.08, 1.2, 4), 0x3d332c, { z: 0.4, y: 3.6, rx: 0.8 }),
    ]);
  },
  column() {
    return merge([
      part(box(1.9, 0.4, 1.9), 0xc2a77a, { y: 0.2 }),
      part(cyl(0.7, 0.8, 3, 8), 0xd9c49a, { y: 1.9 }),
      part(cyl(0.55, 0.7, 0.6, 8), 0xd9c49a, { y: 3.5, rz: 0.25, x: 0.1 }),
    ]);
  },
  wallRuin() {
    return merge([
      part(box(6, 2.2, 1.1), 0xc9a877, { y: 1.1 }),
      part(box(2, 0.9, 1.15), 0xb8955f, { x: -1.5, y: 2.6 }),
      part(box(0.9, 0.4, 1.15), 0xb8955f, { x: 1.8, y: 2.4 }),
    ]);
  },
  spike() {
    return merge([part(new THREE.ConeGeometry(0.6, 3.2, 5), 0x2b2233, { y: 1.6 }), part(new THREE.ConeGeometry(0.35, 1.8, 5), 0x3a2c44, { x: 0.6, y: 0.9, rz: -0.35 })]);
  },
  bones() {
    return merge([
      part(cyl(0.05, 0.05, 1.0, 4), 0xddd6c4, { y: 0.06, rz: Math.PI / 2 }),
      part(cyl(0.05, 0.05, 0.8, 4), 0xddd6c4, { y: 0.06, rz: Math.PI / 2, ry: 1.1, z: 0.3 }),
      part(new THREE.SphereGeometry(0.2, 6, 4), 0xe8e0cc, { x: 0.5, y: 0.18, z: -0.2 }),
    ]);
  },
  bigRock() {
    return merge([part(new THREE.DodecahedronGeometry(6, 0), 0x6f6156, { y: 1, sy: 1.1 })]);
  },
};

// Richer replacements and extra props for the regional dressing.
const sph = (r, w = 6, h = 4) => new THREE.SphereGeometry(r, w, h);
Object.assign(PROP_GEOMETRY, {
  column() {
    return merge([
      part(box(2.0, 0.45, 2.0), 0xb99d6e, { y: 0.22 }),
      part(cyl(0.78, 0.86, 0.5, 8), 0xc9ae80, { y: 0.7 }),
      part(cyl(0.66, 0.74, 2.2, 8), 0xdcc79c, { y: 1.95 }),
      part(cyl(0.7, 0.7, 0.14, 8), 0xa88a5c, { y: 1.2 }),
      part(cyl(0.7, 0.7, 0.14, 8), 0xa88a5c, { y: 2.45 }),
      part(cyl(0.62, 0.66, 0.9, 8), 0xd3bd90, { y: 3.5, rz: 0.2, x: 0.18 }),
      part(box(0.9, 0.5, 0.5), 0xcdb487, { x: 0.9, y: 0.22, z: 0.8, ry: 0.5, rz: 0.2 }),
    ]);
  },
  columnFallen() {
    const parts = [part(box(2.0, 0.45, 2.0), 0xb99d6e, { x: -3.6, y: 0.2, rz: 0.05 })];
    for (let i = 0; i < 3; i++) parts.push(part(cyl(0.68, 0.7, 1.3, 8), i % 2 ? 0xdcc79c : 0xd3bd90, { x: -1.6 + i * 1.5, y: 0.66 + i * 0.02, z: i * 0.12, rz: Math.PI / 2, ry: i * 0.08 }));
    parts.push(part(box(1.5, 0.6, 1.3), 0xc9ae80, { x: 3.2, y: 0.45, z: 0.4, ry: 0.4 }));
    parts.push(part(cyl(0.5, 0.66, 1.0, 8), 0xd3bd90, { x: 4.4, y: 0.5, z: -0.8, rz: Math.PI / 2 - 0.3 }));
    return merge(parts);
  },
  bones() {
    const parts = [part(cyl(0.05, 0.05, 1.5, 4), 0xddd6c4, { y: 0.07, rz: Math.PI / 2 })];
    for (let i = 0; i < 5; i++) {
      const x = -0.55 + i * 0.27, r = 0.42 - Math.abs(i - 2) * 0.06;
      parts.push(part(new THREE.TorusGeometry(r, 0.035, 4, 8, Math.PI), 0xe8e1ce, { x, y: 0.0, z: 0.0, ry: Math.PI / 2, rx: 0.0, sy: 0.9 }));
    }
    parts.push(part(sph(0.22, 6, 5), 0xece5d2, { x: 1.05, y: 0.2, z: 0.2 }));
    parts.push(part(sph(0.07, 4, 3), 0x1a1418, { x: 1.17, y: 0.27, z: 0.31 }));
    parts.push(part(sph(0.07, 4, 3), 0x1a1418, { x: 1.17, y: 0.27, z: 0.08 }));
    parts.push(part(cyl(0.04, 0.04, 0.9, 4), 0xddd6c4, { x: -0.2, y: 0.05, z: 0.6, rz: Math.PI / 2, ry: 0.9 }));
    parts.push(part(cyl(0.04, 0.04, 0.7, 4), 0xd6cfba, { x: 0.5, y: 0.05, z: -0.6, rz: Math.PI / 2, ry: -0.5 }));
    return merge(parts);
  },
  spike() {
    const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg);
    return merge([
      gradientPart(cone(0.75, 3.8, 5), 0x120d1c, 0x5a4488, { y: 1.9, axis: 'y' }),
      gradientPart(cone(0.42, 2.2, 5), 0x120d1c, 0x6a50a0, { x: 0.8, y: 1.0, rz: -0.3, axis: 'y' }),
      gradientPart(cone(0.32, 1.5, 4), 0x120d1c, 0x6a50a0, { x: -0.6, y: 0.7, z: 0.3, rz: 0.4, axis: 'y' }),
    ]);
  },
  scarecrow() {
    return merge([
      part(cyl(0.05, 0.07, 2.6, 5), 0x6a4a2a, { y: 1.3 }),
      part(cyl(0.04, 0.04, 1.7, 5), 0x6a4a2a, { y: 1.85, rz: Math.PI / 2 }),
      part(new THREE.ConeGeometry(0.42, 1.2, 7), 0xcfb15a, { y: 1.4, sy: 1 }),
      part(cyl(0.45, 0.5, 0.18, 7), 0x2a4f9a, { y: 1.05 }),
      part(sph(0.26, 7, 5), 0xb96a38, { y: 2.38 }),
      part(cyl(0.2, 0.28, 0.26, 7), 0xcfb15a, { y: 2.65 }),
      part(box(0.14, 0.5, 0.04), 0x9a2a2a, { x: 0.7, y: 1.7, z: 0.05, rz: 0.12 }),
      part(box(0.14, 0.4, 0.04), 0x2a4f9a, { x: -0.7, y: 1.72, z: 0.05, rz: -0.1 }),
    ]);
  },
  jar() {
    const pts = [[0.0, 0], [0.28, 0], [0.4, 0.2], [0.5, 0.5], [0.4, 0.85], [0.22, 1.0], [0.26, 1.12], [0.3, 1.14]].map(([x, y]) => new THREE.Vector2(x, y));
    return merge([part(new THREE.LatheGeometry(pts, 8), 0xb8663a, {}), part(cyl(0.41, 0.41, 0.06, 8), 0x7a3f22, { y: 0.52 })]);
  },
  reedHut() {
    const parts = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 1.7;
      parts.push(gradientPart(cyl(0.07, 0.16, 3.6, 5), 0x8a7a40, 0xc8b062, { x: Math.sin(a) * r, y: 1.7, z: Math.cos(a) * r, rz: Math.cos(a) * 0.6, rx: -Math.sin(a) * 0.6, axis: 'y' }));
    }
    parts.push(part(new THREE.ConeGeometry(1.0, 1.0, 8), 0xb8a05a, { y: 3.3 }));
    parts.push(part(box(0.9, 1.5, 0.3), 0x2a1c12, { y: 0.8, z: 1.35 }));
    parts.push(part(new THREE.TorusGeometry(1.6, 0.07, 4, 14), 0x6a4a2a, { y: 1.5, rx: Math.PI / 2 }));
    return merge(parts);
  },
  sandDrift() {
    return merge([gradientPart(new THREE.IcosahedronGeometry(1, 1), 0x9a7440, 0xc39a5a, { y: 0.0, sy: 0.22, axis: 'y' })]);
  },
  obelisk() {
    return merge([
      part(box(1.6, 0.5, 1.6), 0xb99d6e, { y: 0.25 }),
      part(new THREE.CylinderGeometry(0.34, 0.55, 5.4, 4), 0xcdb487, { y: 3.2, ry: Math.PI / 4 }),
      part(new THREE.ConeGeometry(0.34, 0.6, 4), 0xd6a740, { y: 6.2, ry: Math.PI / 4 }),
    ]);
  },
});

// A simple robed humanoid for NPCs.
export function makeNpc({ robe = 0x8a3a2a, trim = 0xd6a740, skin = 0xc98f62, hat = null } = {}) {
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: robe, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.4, metalness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 10), robeMat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.9;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 6, 14), trimMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.1;
  g.add(body, head, belt);
  if (hat === 'crown') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 8), trimMat);
    c.position.y = 2.2;
    g.add(c);
  } else if (hat === 'turban') {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.1, 6, 12), robeMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = 2.08;
    g.add(t);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeWaypoint() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c7f70, roughness: 0.9 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.35, metalness: 0.2, emissive: 0x000000 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.4, 8), stone);
  base.position.y = 0.2;
  const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.6, 4), lapis);
  ob.position.y = 2.2;
  ob.rotation.y = Math.PI / 4;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a64c8, transparent: true, opacity: 0.25 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 6, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.45;
  g.add(base, ob, ring);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { lapis, ringMat };
  return g;
}

export function makeShrine(color) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xb59a74, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), stone);
  base.position.y = 0.5;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.4, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 }));
  bowl.position.y = 1.2;
  const flameMat = new THREE.MeshBasicMaterial({ color });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 8), flameMat);
  flame.position.y = 1.9;
  g.add(base, bowl, flame);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { flame, flameMat };
  return g;
}

export function makeChest(tier) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: tier >= 3 ? 0x3a2a4a : 0x6a4426, roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.85, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), wood);
  body.position.y = 0.4;
  const lid = new THREE.Group();
  lid.position.set(0, 0.8, -0.45);
  const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 8, 1, false, 0, Math.PI), wood);
  lidMesh.rotation.z = Math.PI / 2;
  lidMesh.position.z = 0.45;
  lid.add(lidMesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.95), gold);
  band.position.y = 0.55;
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.08), gold);
  lock.position.set(0, 0.7, 0.47);
  g.add(body, lid, band, lock);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { lid };
  return g;
}

export function makeHouse(w, d, h, rng) {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xb98d60, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 1 }));
  roof.position.y = h + 0.15;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.1), dark);
  door.position.set(0, 0.95, d / 2 + 0.03);
  g.add(body, roof, door);
  // Roof beams sticking out (typical mud-brick detail).
  for (let i = 0; i < Math.floor(w / 1.2); i++) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 4), dark);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(-w / 2 + 0.6 + i * 1.2, h - 0.3, d / 2 + 0.25);
    g.add(beam);
  }
  if (rng.chance(0.5)) {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, 1.4), new THREE.MeshStandardMaterial({ color: rng.pick([0x8a2a2a, 0x2a4f8a, 0x8a6a2a]), roughness: 0.9 }));
    awning.position.set(0, 2.4, d / 2 + 0.7);
    awning.rotation.x = 0.25;
    g.add(awning);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function makeGate() {
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 1 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.35, metalness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, roughness: 0.3, metalness: 0.8 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(4, 12, 4), brick, sx * 7, 6, 0);
    add(new THREE.BoxGeometry(4.3, 0.5, 4.3), gold, sx * 7, 12.2, 0);
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(4.08, 0.4, 4.08), lapis, sx * 7, 1.6 + k * 2.2, 0);
    add(new THREE.BoxGeometry(16, 8, 3), brick, sx * 16, 4, 0.5);
  }
  add(new THREE.BoxGeometry(18, 2.6, 4), brick, 0, 12.6, 0);
  add(new THREE.BoxGeometry(18.2, 0.6, 4.2), lapis, 0, 11.2, 0);
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x5a2bd8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const portal = add(new THREE.PlaneGeometry(10, 11), portalMat, 0, 5.5, 0);
  portal.castShadow = false;
  // Stairs leading down into the gate.
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(9, 0.3, 1.2), brick, 0, 0.15 + i * 0.05, 3 + i * 1.2).position.y = 0.3 - i * 0.07;
  g.userData = { portalMat };
  return g;
}

// Well-house over the Cistern of Enki: a glazed dome on four lapis-banded
// columns, sheltering a well that glows with Enki's water.
export function makeWellHouse() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xa8a48e, roughness: 0.95 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2f7a74, roughness: 0.35, metalness: 0.15 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d4a8c, roughness: 0.35, metalness: 0.25 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(7.2, 0.16, 7.2), stone, 0, 0.08, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.32, 0.38, 3.6, 8), stone, sx * 2.7, 1.8, sz * 2.7);
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 8), lapis, sx * 2.7, 2.6, sz * 2.7);
    }
  }
  add(new THREE.BoxGeometry(6.6, 0.4, 6.6), stone, 0, 3.8, 0);
  add(new THREE.BoxGeometry(6.7, 0.16, 6.7), lapis, 0, 3.55, 0);
  add(new THREE.SphereGeometry(2.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), teal, 0, 4.0, 0).scale.y = 0.6;
  add(new THREE.ConeGeometry(0.22, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 }), 0, 6.0, 0);
  // The well: stone rim, dark shaft and glowing water.
  add(new THREE.TorusGeometry(1.5, 0.28, 8, 24), stone, 0, 0.42, 0).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(1.4, 1.4, 0.5, 20, 1, true), stone, 0, 0.25, 0);
  const shaft = add(new THREE.CircleGeometry(1.42, 24), new THREE.MeshBasicMaterial({ color: 0x041010 }), 0, 0.2, 0);
  shaft.rotation.x = -Math.PI / 2;
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const water = add(new THREE.CircleGeometry(1.3, 24), portalMat, 0, 0.26, 0);
  water.rotation.x = -Math.PI / 2;
  water.castShadow = false;
  g.userData = { portalMat }; // its cyan glow is a light-manager emitter (world.js)
  return g;
}
