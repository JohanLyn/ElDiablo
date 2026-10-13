import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { TOWN } from './layout.js';
import { makeHouse, makeNpc } from './models.js';
import { decorateHouse, dressTown } from './townDressing.js';

// Eridu Outpost: a walled mud-brick town with a small temple, market and NPCs.
export function buildTown(scene, colliders) {
  const rng = new Rng(99);
  const occluders = [];
  const brick = new THREE.MeshStandardMaterial({ color: 0x9a6c46, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.4, metalness: 0.2 });
  const { x: cx, z: cz, r } = TOWN;

  // Town wall: a square ring with gates on the north and south roads.
  const wallH = 3.2, t = 1.2;
  const segs = [
    // [x1, z1, x2, z2]
    [-r, -r, -3.5, -r], [3.5, -r, r, -r], // north (gate gap)
    [-r, r, -3.5, r], [3.5, r, r, r], // south (gate gap)
    [-r, -r, -r, r], [r, -r, r, r],
  ];
  for (const [x1, z1, x2, z2] of segs) {
    const w = Math.abs(x2 - x1) || t, d = Math.abs(z2 - z1) || t;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + (x1 !== x2 ? t : 0), wallH, d + (z1 !== z2 ? t : 0)), brick);
    m.position.set(cx + (x1 + x2) / 2, wallH / 2, cz + (z1 + z2) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    colliders.addBox(m.position.x - m.geometry.parameters.width / 2, m.position.z - m.geometry.parameters.depth / 2, m.position.x + m.geometry.parameters.width / 2, m.position.z + m.geometry.parameters.depth / 2);
    if (z1 === z2 && z1 > 0) occluders.push(m); // south wall faces the camera
  }
  // Gate towers with lapis bands.
  for (const gz of [-r, r]) {
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 5, 2.6), brick);
      tower.position.set(cx + sx * 4.8, 2.5, cz + gz);
      tower.castShadow = true;
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.4, 2.7), lapis);
      band.position.y = 1.4;
      tower.add(band);
      scene.add(tower);
      colliders.addBox(tower.position.x - 1.3, tower.position.z - 1.3, tower.position.x + 1.3, tower.position.z + 1.3);
      if (gz > 0) occluders.push(tower);
    }
  }

  // Houses around the edges, leaving the central plaza and road open.
  const lots = [
    [-17, -16, 7, 6], [-8, -18, 6, 5], [12, -17, 8, 6], [18, -7, 6, 7], [-18, -5, 6, 7],
    [-18, 8, 7, 6], [-9, 17, 6, 5], [11, 17, 7, 5], [18, 9, 6, 7],
  ];
  for (const [lx, lz, w, d] of lots) {
    const h = rng.float(3, 4.6);
    const house = makeHouse(w, d, h, rng);
    house.position.set(cx + lx, 0.1, cz + lz);
    // Face the plaza.
    house.rotation.y = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? -Math.PI / 2 : Math.PI / 2) : (lz > 0 ? Math.PI : 0);
    decorateHouse(house, { w, d, h, rng });
    scene.add(house);
    const rot = Math.abs(Math.sin(house.rotation.y)) > 0.5;
    const hw = (rot ? d : w) / 2, hd = (rot ? w : d) / 2;
    colliders.addBox(house.position.x - hw, house.position.z - hd, house.position.x + hw, house.position.z + hd);
    house.traverse((o) => { if (o.isMesh) occluders.push(o); });
  }

  // Small temple (stepped platform) in the north-west of the plaza.
  for (let i = 0; i < 3; i++) {
    const s = 7 - i * 2;
    const step = new THREE.Mesh(new THREE.BoxGeometry(s, 0.8, s), i === 2 ? lapis : brick);
    step.position.set(cx - 8, 0.4 + i * 0.8, cz - 7);
    step.castShadow = step.receiveShadow = true;
    scene.add(step);
  }
  colliders.addBox(cx - 11.5, cz - 10.5, cx - 4.5, cz - 3.5);

  // Well in the middle of the plaza.
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 12), brick);
  well.position.set(cx + 4, 0.45, cz + 4);
  well.castShadow = true;
  scene.add(well);
  colliders.addCircle(well.position.x, well.position.z, 1.2);

  // Market stall for the merchant.
  const stall = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 1.2), new THREE.MeshStandardMaterial({ color: 0x6a4426 }));
  table.position.y = 0.45;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: 0x2a4f8a }));
  canopy.position.set(0, 2.5, -0.3);
  for (const sx of [-1.7, 1.7]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 5), gold);
    pole.position.set(sx, 1.25, 0.6);
    stall.add(pole);
  }
  stall.add(table, canopy);
  stall.position.set(cx + 9, 0, cz - 4);
  stall.rotation.y = -Math.PI / 2;
  stall.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(stall);
  colliders.addBox(cx + 8.4, cz - 5.7, cx + 9.6, cz - 2.3);

  // NPCs: positions are where you talk to them.
  const npcs = [
    { id: 'ninsun', name: 'Ninsun, High Priestess', role: 'quest', x: cx - 8, z: cz - 2, model: makeNpc({ robe: 0xe8e0cc, trim: 0x1d3b8c, hat: 'crown' }) },
    { id: 'ubar', name: 'Ubar the Trader', role: 'merchant', x: cx + 10.6, z: cz - 4, model: makeNpc({ robe: 0x8a2a2a, trim: 0xd6a740, hat: 'turban' }) },
    { id: 'guard', name: 'Gate Guard', role: 'flavor', x: cx + 2.5, z: cz - r + 3, model: makeNpc({ robe: 0x5a4a3a, trim: 0x9a9a9a, hat: 'crown' }) },
  ];
  for (const n of npcs) {
    n.model.position.set(n.x, 0.1, n.z);
    n.model.rotation.y = n.role === 'merchant' ? -Math.PI / 2 : 0;
    scene.add(n.model);
    colliders.addCircle(n.x, n.z, 0.6);
  }

  dressTown(scene, colliders, { cx, cz, r });

  // Warm lights.
  for (const [lx, lz] of [[-6, -2], [8, 6], [0, -18]]) {
    const l = new THREE.PointLight(0xffa860, 10, 16, 1.6);
    l.position.set(cx + lx, 3, cz + lz);
    scene.add(l);
  }

  return { occluders, npcs };
}
