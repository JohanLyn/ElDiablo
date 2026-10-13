import * as THREE from 'three';

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
    tiles.setColorAt(i, inlay ? col.setHex(0x1d2e66) : col.setHex((gx + gz) % 2 ? 0x3a3038 : 0x332a32));
    i++;
  }
  tiles.receiveShadow = true;
  scene.add(tiles);

  // Walls, with a cutaway shader so walls between camera and hero dissolve.
  const wallGeo = new THREE.BoxGeometry(CELL, 3.2, CELL);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a4650, roughness: 0.95 });
  const cutaway = { uPlayer: { value: new THREE.Vector3() } };
  wallMat.onBeforeCompile = (shader) => {
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
  };
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

  // Braziers and pillars.
  const lights = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 });
  for (const [x, z] of [[-6, -594], [6, -594], [-10, -626], [10, -626], [36, -626], [36, -668], [-24, -664], [0, -664], [-24, -690], [0, -690]]) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.6, 6), goldMat);
    stand.position.set(x, 0.8, z);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 8), flameMat);
    flame.position.y = 1.2;
    stand.add(flame);
    scene.add(stand);
    colliders.addCircle(x, z, 0.4);
    const l = new THREE.PointLight(0xff8a3a, 0, 16, 1.5);
    l.position.set(x, 2.6, z);
    scene.add(l);
    lights.push({ light: l, flame, seed: Math.random() * 10 });
  }

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
      throneLight.intensity = active ? 30 : 0;
      for (const b of lights) {
        b.light.intensity = active ? 14 + Math.sin(t * 11 + b.seed) * 2 : 0;
        b.flame.scale.y = 1 + Math.sin(t * 13 + b.seed) * 0.15;
      }
    },
  };
}
