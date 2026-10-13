import * as THREE from 'three';

// Palette for the Seven Gates of Kur: sun-baked clay, lapis lazuli, gold, dusk.
export const PALETTE = {
  clay: 0xb4885c, clayDark: 0x7a5236, lapis: 0x1d3b8c, lapisLight: 0x3a64c8,
  gold: 0xd6a740, dusk: 0x1b1222, ember: 0xff8a3a,
};

export const ARENA = 19; // half-size of the playable square

// Builds the arena in front of the First Gate. Returns colliders for movement
// and occluders that fade out when they block the camera's view of the player.
export function buildWorld(scene) {
  scene.background = new THREE.Color(PALETTE.dusk);
  scene.fog = new THREE.Fog(PALETTE.dusk, 34, 70);

  scene.add(new THREE.HemisphereLight(0x8a7cc0, 0x3a2416, 0.9));
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.7);
  sun.position.set(-14, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const floorTex = makeTileTexture();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(14, 14);
  floorTex.anisotropy = 8;
  floorTex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Inlaid lapis ring in the arena floor.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(9.2, 9.8, 64),
    new THREE.MeshStandardMaterial({ color: PALETTE.lapis, roughness: 0.4, metalness: 0.2 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.receiveShadow = true;
  scene.add(ring);

  const colliders = []; // circles: { x, z, r }
  const occluders = [];

  const brick = new THREE.MeshStandardMaterial({ color: PALETTE.clayDark, roughness: 1 });
  const lapisMat = new THREE.MeshStandardMaterial({ color: PALETTE.lapis, roughness: 0.35, metalness: 0.25 });
  const goldMat = new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: 0.3, metalness: 0.8 });

  // Mud-brick walls around the arena, with gaps where enemies pour in.
  const wallH = 1.6;
  for (const side of [-1, 1]) {
    for (const [from, to] of [[-ARENA - 1, -4], [4, ARENA + 1]]) {
      const len = to - from;
      const ew = addBox(scene, brick, len, wallH, 1, (from + to) / 2, wallH / 2, side * (ARENA + 1));
      addBox(scene, brick, 1, wallH, len, side * (ARENA + 1), wallH / 2, (from + to) / 2);
      if (side === 1) occluders.push(ew); // the south wall sits between camera and player
    }
  }

  // Lapis pillars with gold capitals.
  const pillarGeo = new THREE.CylinderGeometry(0.75, 0.9, 5, 12);
  const capGeo = new THREE.CylinderGeometry(1.1, 0.8, 0.5, 12);
  for (let i = 0; i < 8; i++) {
    if (i === 1 || i === 2) continue; // skip the two nearest the camera; they'd hide the action
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 13.5, z = Math.sin(a) * 13.5;
    const mat = lapisMat.clone();
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(x, 2.5, z);
    p.castShadow = p.receiveShadow = true;
    const cap = new THREE.Mesh(capGeo, goldMat.clone());
    cap.position.y = 2.6;
    cap.castShadow = true;
    p.add(cap);
    scene.add(p);
    colliders.push({ x, z, r: 0.95 });
    occluders.push(p);
  }

  // The First Gate (north): two towers and a lintel, a dim portal between.
  const gateZ = -ARENA - 2.5;
  for (const sx of [-1, 1]) {
    addBox(scene, brick, 3, 9, 3, sx * 5.5, 4.5, gateZ);
    addBox(scene, goldMat, 3.2, 0.4, 3.2, sx * 5.5, 9.1, gateZ);
    for (let k = 0; k < 4; k++) addBox(scene, lapisMat, 3.05, 0.35, 3.05, sx * 5.5, 1.5 + k * 2, gateZ);
  }
  addBox(scene, brick, 14, 2, 3, 0, 9.5, gateZ);
  addBox(scene, lapisMat, 14.2, 0.5, 3.2, 0, 8.4, gateZ);
  const portal = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8.4),
    new THREE.MeshBasicMaterial({ color: 0x5a2bd8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  portal.position.set(0, 4.2, gateZ + 0.2);
  scene.add(portal);

  // Ziggurat silhouette beyond the gate.
  for (let k = 0; k < 5; k++) {
    const s = 34 - k * 6;
    addBox(scene, brick, s, 3, s * 0.4, 0, 1.5 + k * 3, gateZ - 14 - k * 0.5, false);
  }

  // Braziers with flickering lights.
  const braziers = [];
  const bowlGeo = new THREE.CylinderGeometry(0.7, 0.35, 0.6, 10);
  const standGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6);
  const flameMat = new THREE.MeshBasicMaterial({ color: PALETTE.ember });
  for (const [x, z] of [[-ARENA + 2, -ARENA + 2], [ARENA - 2, -ARENA + 2], [-ARENA + 2, ARENA - 2], [ARENA - 2, ARENA - 2]]) {
    const stand = new THREE.Mesh(standGeo, goldMat);
    stand.position.set(x, 0.7, z);
    const bowl = new THREE.Mesh(bowlGeo, goldMat);
    bowl.position.y = 0.9;
    stand.add(bowl);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 8), flameMat);
    flame.position.y = 1.5;
    stand.add(flame);
    const light = new THREE.PointLight(PALETTE.ember, 12, 14, 1.6);
    light.position.set(x, 2.8, z);
    scene.add(stand, light);
    colliders.push({ x, z, r: 0.6 });
    braziers.push({ light, flame, seed: Math.random() * 10 });
  }

  return {
    colliders,
    occluders,
    update(t) {
      for (const b of braziers) {
        const f = Math.sin(t * 13 + b.seed) * 0.5 + Math.sin(t * 7.3 + b.seed * 2) * 0.5;
        b.light.intensity = 11 + f * 2.5;
        b.flame.scale.set(1, 1 + f * 0.15, 1);
      }
      portal.material.opacity = 0.45 + Math.sin(t * 1.7) * 0.1;
    },
  };
}

// Keep a circle of radius r inside the arena and out of pillars/braziers.
export function resolveCollision(pos, r, colliders) {
  const lim = ARENA - r;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d < min && d > 1e-5) {
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  }
}

function addBox(scene, mat, w, h, d, x, y, z, shadows = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// Procedural sun-baked mud-brick paving in a running bond.
function makeTileTexture() {
  const size = 256, rows = 8, cols = 4, h = size / rows, w = size / cols;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#6e4e36';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < rows; y++) {
    const offset = (y % 2) * (w / 2);
    for (let x = -1; x < cols; x++) {
      const bx = x * w + offset;
      g.fillStyle = `hsl(${25 + Math.random() * 6}, ${24 + Math.random() * 8}%, ${40 + Math.random() * 8}%)`;
      g.fillRect(bx + 1.5, y * h + 1.5, w - 3, h - 3);
      for (let k = 0; k < 18; k++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
        g.fillRect(bx + 2 + Math.random() * (w - 6), y * h + 2 + Math.random() * (h - 6), 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
    }
  }
  return new THREE.CanvasTexture(c);
}
