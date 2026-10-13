import * as THREE from 'three';
import { part, merge, PROP_GEOMETRY } from './models.js';
import { createFlames, createGlow } from './shaders/glow.js';
import { getEnv } from './shaders/common.js';

// The Ganzir Stair: a hand-laid dungeon instance far north of the overworld.
// Rooms are rectangles on a 2 m grid; walls grow on every empty cell that touches floor.
export const DUNGEON_ORIGIN = { x: 0, z: -600 };
const CELL = 2;

export const DUNGEON_RECTS = [
  // [cx, cz, w, d] relative to the origin
  [0, 0, 18, 18], // entry hall
  [0, -17, 6, 16],
  [0, -34, 26, 20], // hall of offerings
  [20, -34, 14, 6],
  [36, -34, 18, 22], // ossuary
  [36, -55, 6, 20],
  [36, -72, 22, 18], // gallery
  [14, -72, 22, 6],
  [-12, -76, 34, 32], // throne of Neti
];

export const DUNGEON_SPOTS = {
  entry: { x: 0, z: -600 + 4 },
  packs: [[-6, -632], [7, -638], [33, -628], [40, -640], [30, -670], [42, -676]].map(([x, z]) => ({ x, z })),
  boss: { x: -12, z: -680 },
  exit: { x: -12, z: -664 },
};

export function buildDungeon(scene, colliders) {
  const ox = DUNGEON_ORIGIN.x, oz = DUNGEON_ORIGIN.z;
  const floor = new Set();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [cx, cz, w, d] of DUNGEON_RECTS) {
    for (let x = cx - w / 2; x < cx + w / 2; x += CELL) {
      for (let z = cz - d / 2; z < cz + d / 2; z += CELL) {
        const gx = Math.round(x / CELL), gz = Math.round(z / CELL);
        floor.add(`${gx},${gz}`);
        minX = Math.min(minX, gx); maxX = Math.max(maxX, gx); minZ = Math.min(minZ, gz); maxZ = Math.max(maxZ, gz);
      }
    }
  }

  const walls = [];
  for (let gx = minX - 1; gx <= maxX + 1; gx++) {
    for (let gz = minZ - 1; gz <= maxZ + 1; gz++) {
      if (floor.has(`${gx},${gz}`)) continue;
      let touches = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (floor.has(`${gx + dx},${gz + dz}`)) { touches = true; break; }
      }
      if (touches) walls.push([gx, gz]);
    }
  }

  // Floor tiles (one instanced mesh, alternating tones).
  const tileGeo = new THREE.BoxGeometry(CELL * 0.98, 0.2, CELL * 0.98);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, floor.size);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let i = 0;
  for (const key of floor) {
    const [gx, gz] = key.split(',').map(Number);
    dummy.position.set(ox + gx * CELL + CELL / 2, -0.1, oz + gz * CELL + CELL / 2);
    dummy.updateMatrix();
    tiles.setMatrixAt(i, dummy.matrix);
    const inlay = (gx + gz) % 7 === 0;
    tiles.setColorAt(i, inlay ? col.setHex(0x2c449a) : col.setHex((gx + gz) % 2 ? 0x6a5a64 : 0x5e4f59));
    i++;
  }
  tiles.receiveShadow = true;
  scene.add(tiles);

  // Walls, with a cutaway shader so walls between camera and hero dissolve.
  const wallGeo = new THREE.BoxGeometry(CELL, 3.2, CELL);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x86707a, roughness: 0.95 });
  const cutaway = { uPlayer: { value: new THREE.Vector3() } };
  const applyCut = (mat) => { mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayer = cutaway.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nuniform vec3 uPlayer;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float southOf = vWorldPos.z - uPlayer.z;
        float side = abs(vWorldPos.x - uPlayer.x);
        if (southOf > 0.5 && southOf < 18.0 && side < 15.0 && vWorldPos.y > 0.6) {
          float pattern = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
          if (pattern < 1.0 || vWorldPos.y > 1.4) discard;
        }`);
  }; mat.customProgramCacheKey = () => 'dcut'; return mat; };
  applyCut(wallMat);
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, walls.length);
  walls.forEach(([gx, gz], k) => {
    dummy.position.set(ox + gx * CELL + CELL / 2, 1.6, oz + gz * CELL + CELL / 2);
    dummy.updateMatrix();
    wallMesh.setMatrixAt(k, dummy.matrix);
    const x0 = ox + gx * CELL, z0 = oz + gz * CELL;
    colliders.addBox(x0, z0, x0 + CELL, z0 + CELL);
  });
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  // Carved details: a lapis band and gold cap on every wall block (same cutaway as the walls).
  const bandMat = applyCut(new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.4, metalness: 0.2, emissive: 0x0a1a58, emissiveIntensity: 0.8 }));
  const capMat = applyCut(new THREE.MeshStandardMaterial({ color: 0xd6a740, roughness: 0.4, metalness: 0.3, emissive: 0x6a4810, emissiveIntensity: 0.7 }));
  const band = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 1.02, 0.34, CELL * 1.02), bandMat, walls.length);
  const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 1.06, 0.14, CELL * 1.06), capMat, walls.length);
  walls.forEach(([gx, gz], k) => {
    dummy.position.set(ox + gx * CELL + CELL / 2, 1.0, oz + gz * CELL + CELL / 2); dummy.updateMatrix(); band.setMatrixAt(k, dummy.matrix);
    dummy.position.y = 3.2; dummy.updateMatrix(); cap.setMatrixAt(k, dummy.matrix);
  });
  scene.add(band, cap);

  // Floor runes: faint pulsing glyph rings.
  const runeCells = [...floor].filter((key) => { const [gx, gz] = key.split(',').map(Number); return ((gx * 7 + gz * 13) % 9 + 9) % 9 === 0; });
  const runeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: getEnv().uTime },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
        float ring = smoothstep(0.04, 0.0, abs(r - 0.82)) + smoothstep(0.03, 0.0, abs(r - 0.6)) * 0.7;
        float ticks = smoothstep(0.12, 0.0, abs(fract(a * 8.0 / 3.14159) - 0.5) * 2.0 - 0.6) * smoothstep(0.82, 0.62, r) * smoothstep(0.55, 0.62, r);
        float star = smoothstep(0.035, 0.0, abs(abs(p.x) - abs(p.y)) * 0.7) * smoothstep(0.58, 0.2, r);
        float g = (ring + ticks * 0.8 + star * 0.8) * (0.5 + 0.35 * sin(uTime * 1.4 + r * 6.0));
        gl_FragColor = vec4(vec3(0.55, 0.38, 1.0) * g * 0.9, 1.0);
      }`,
  });
  const runes = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), runeMat, Math.max(1, runeCells.length));
  runeCells.forEach((key, k) => {
    const [gx, gz] = key.split(',').map(Number);
    dummy.position.set(ox + gx * CELL + CELL / 2, 0.015, oz + gz * CELL + CELL / 2);
    dummy.rotation.set(0, k * 1.7, 0); dummy.updateMatrix(); runes.setMatrixAt(k, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  runes.count = runeCells.length; runes.frustumCulled = false; runes.renderOrder = 2;
  scene.add(runes);

  // Hanging chains from wall tops, skulls and urns along the walls.
  const chainGeo = merge(Array.from({ length: 7 }, (_, i) => part(new THREE.TorusGeometry(0.1, 0.028, 4, 6), 0x6a6258, { y: -i * 0.17, ry: i % 2 ? Math.PI / 2 : 0, sy: 1.3 })));
  const skullGeo = merge([part(new THREE.SphereGeometry(0.2, 6, 5), 0xe4dcc6, { y: 0.2 }), part(new THREE.BoxGeometry(0.22, 0.12, 0.2), 0xd8d0ba, { y: 0.06, z: 0.06 }), part(new THREE.SphereGeometry(0.05, 4, 3), 0x1a1418, { x: 0.08, y: 0.24, z: 0.16 }), part(new THREE.SphereGeometry(0.05, 4, 3), 0x1a1418, { x: -0.08, y: 0.24, z: 0.16 })]);
  const urnGeo = PROP_GEOMETRY.jar();
  const dungMat = (cfg) => applyCut(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...cfg }));
  const edge = []; // floor cells touching a wall
  for (const key of floor) {
    const [gx, gz] = key.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!floor.has(`${gx + dx},${gz + dz}`)) { edge.push([gx, gz, dx, dz]); break; }
  }
  const pick = (n, salt) => edge.filter((_, i) => (i * 2654435761 + salt) % 1000 < n * 1000 / edge.length);
  const chainCells = pick(26, 11), skullCells = pick(34, 77), urnCells = pick(18, 313);
  const place = (cells, geo, mat, y, off, scale = 1) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
    cells.forEach(([gx, gz, dx, dz], k) => {
      dummy.position.set(ox + gx * CELL + CELL / 2 + dx * off, y, oz + gz * CELL + CELL / 2 + dz * off);
      dummy.rotation.set(0, (k * 2.3) % 6.28, 0); dummy.scale.setScalar(scale * (0.8 + (k % 5) * 0.1)); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
    m.count = cells.length; m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere();
    scene.add(m);
  };
  place(chainCells, chainGeo, dungMat({}), 3.1, 0.95);
  place(skullCells, skullGeo, dungMat({}), 0.1, 0.6);
  place(urnCells, urnGeo, dungMat({ roughness: 0.6 }), 0.1, 0.7, 0.9);

  // Braziers and pillars.
  const lights = [];
  const flameSpots = [], haloSpots = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 });
  for (const [x, z] of [[-6, -594], [6, -594], [-10, -626], [10, -626], [36, -626], [36, -668], [-24, -664], [0, -664], [-24, -690], [0, -690]]) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.6, 6), goldMat);
    stand.position.set(x, 0.8, z);
    const flame = new THREE.Object3D(); // flame itself is a billboard (below); keeps the flicker API
    flameSpots.push({ x, y: 1.75, z, s: 1.9 });
    haloSpots.push({ x, y: 2.2, z, color: 0xff7a24, size: 8, flicker: 0.25 });
    scene.add(stand);
    colliders.addCircle(x, z, 0.4);
    const l = new THREE.PointLight(0xff8a3a, 0, 16, 1.5);
    l.position.set(x, 2.6, z);
    scene.add(l);
    lights.push({ light: l, flame, seed: Math.random() * 10 });
  }

  const flameFx = createFlames(flameSpots, { intensity: 2.2 }), glowFx = createGlow(haloSpots, { opacity: 0.5 });
  scene.add(flameFx, glowFx);

  // Neti's dais.
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x2a4aa8, roughness: 0.35, metalness: 0.3 }));
  dais.position.set(DUNGEON_SPOTS.boss.x, 0.02, DUNGEON_SPOTS.boss.z);
  dais.receiveShadow = true;
  const daisRing = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 48), goldMat);
  daisRing.rotation.x = Math.PI / 2;
  daisRing.position.set(DUNGEON_SPOTS.boss.x, 0.1, DUNGEON_SPOTS.boss.z);
  scene.add(dais, daisRing);
  const throneLight = new THREE.PointLight(0xa07aff, 0, 22, 1.4);
  throneLight.position.set(DUNGEON_SPOTS.boss.x, 7, DUNGEON_SPOTS.boss.z + 2);
  scene.add(throneLight);

  return {
    cutaway,
    update(t, active) {
      flameFx.visible = glowFx.visible = active;
      runes.visible = active;
      throneLight.intensity = active ? 30 : 0;
      for (const b of lights) {
        b.light.intensity = active ? 14 + Math.sin(t * 11 + b.seed) * 2 : 0;
        b.flame.scale.y = 1 + Math.sin(t * 13 + b.seed) * 0.15;
      }
    },
  };
}
