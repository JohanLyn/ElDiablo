import * as THREE from 'three';

// Low-poly monster models built from primitives. Each returns a Group with
// userData.mat (the main material, flashed on hit).
export function makeEnemyModel(type, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, emissive: 0x000000 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe8d6b0, roughness: 0.5 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  if (type === 'gallu') {
    add(new THREE.BoxGeometry(0.9, 1.1, 0.7), mat, 0, 1.0, 0);
    add(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat, 0, 1.8, 0.1);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.09, 0.55, 6), bone, s * 0.25, 2.15, 0.05, 0, 0, -s * 0.5);
      add(new THREE.BoxGeometry(0.25, 0.5, 0.25), mat, s * 0.25, 0.25, 0);
      add(new THREE.BoxGeometry(0.2, 0.9, 0.2), mat, s * 0.6, 1.0, 0.25, -0.6);
      add(new THREE.SphereGeometry(0.06, 6, 4), eye, s * 0.13, 1.85, 0.38);
    }
  } else if (type === 'utukku') {
    // Restless ghost: translucent wisp body that tapers to nothing.
    mat.transparent = true;
    mat.opacity = 0.75;
    add(new THREE.ConeGeometry(0.45, 1.5, 8), mat, 0, 1.0, 0, Math.PI);
    add(new THREE.SphereGeometry(0.32, 10, 8), mat, 0, 1.85, 0);
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.07, 6, 4), eye, s * 0.12, 1.9, 0.27);
      add(new THREE.BoxGeometry(0.12, 0.7, 0.12), mat, s * 0.45, 1.4, 0.2, -0.8, 0, s * 0.3);
    }
  } else if (type === 'lilitu') {
    // Winged night-spirit caster.
    add(new THREE.ConeGeometry(0.42, 1.6, 8), mat, 0, 0.8, 0);
    add(new THREE.SphereGeometry(0.22, 10, 8), mat, 0, 1.8, 0);
    const wing = new THREE.MeshStandardMaterial({ color: 0x2a1530, side: THREE.DoubleSide, roughness: 0.8 });
    for (const s of [-1, 1]) {
      add(new THREE.PlaneGeometry(1.1, 0.8), wing, s * 0.6, 1.6, -0.2, 0, s * 0.5, s * 0.3);
      add(new THREE.SphereGeometry(0.05, 6, 4), eye, s * 0.08, 1.85, 0.19);
    }
    const orbMat = new THREE.MeshBasicMaterial({ color: 0x9a4dff });
    g.userData.orb = add(new THREE.SphereGeometry(0.16, 8, 6), orbMat, 0, 1.3, 0.55);
  } else if (type === 'scorpion') {
    const abdomen = add(new THREE.SphereGeometry(0.55, 10, 8), mat, 0, 0.55, 0);
    abdomen.scale.set(1, 0.6, 1.3);
    add(new THREE.CylinderGeometry(0.25, 0.32, 0.8, 8), mat, 0, 1.25, 0.35);
    add(new THREE.SphereGeometry(0.2, 8, 6), mat, 0, 1.8, 0.4);
    add(new THREE.TorusGeometry(0.45, 0.04, 4, 12, Math.PI), bone, 0, 1.3, 0.75, 0, 0, Math.PI / 2);
    for (let k = 0; k < 4; k++) add(new THREE.SphereGeometry(0.16 - k * 0.02, 6, 4), mat, 0, 0.7 + k * 0.32, -0.6 - Math.sin(k * 0.7) * 0.3);
    add(new THREE.ConeGeometry(0.08, 0.3, 6), bone, 0, 1.85, -0.35, 2.2);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.6, 0.08, 0.08), mat, s * 0.55, 0.3, -0.3 + k * 0.35, 0, 0, s * 0.5);
      add(new THREE.SphereGeometry(0.05, 6, 4), eye, s * 0.08, 1.85, 0.58);
    }
  } else if (type === 'asag') {
    // Stone-born brute of the mountains.
    const rock = mat;
    add(new THREE.DodecahedronGeometry(0.9, 0), rock, 0, 1.3, 0);
    add(new THREE.DodecahedronGeometry(0.45, 0), rock, 0, 2.35, 0.2);
    for (const s of [-1, 1]) {
      add(new THREE.DodecahedronGeometry(0.42, 0), rock, s * 1.05, 1.5, 0.2);
      add(new THREE.DodecahedronGeometry(0.4, 0), rock, s * 1.15, 0.75, 0.35);
      add(new THREE.BoxGeometry(0.4, 0.8, 0.4), rock, s * 0.4, 0.4, 0);
      add(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff6a2a }), s * 0.15, 2.4, 0.6);
    }
  } else if (type === 'neti') {
    // Neti, Keeper of the First Gate: towering armoured gatekeeper with a staff.
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3, emissive: 0x000000 });
    const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, metalness: 0.3, roughness: 0.4 });
    add(new THREE.CylinderGeometry(0.9, 1.4, 2.6, 10), mat, 0, 1.3, 0);
    add(new THREE.BoxGeometry(2.2, 0.9, 1.2), lapis, 0, 2.7, 0);
    add(new THREE.SphereGeometry(0.5, 12, 10), mat, 0, 3.5, 0.1);
    add(new THREE.CylinderGeometry(0.45, 0.6, 0.7, 8), gold, 0, 4.1, 0.1);
    for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.1, 0.5, 5), gold, Math.cos(i) * 0.4, 4.55, 0.1 + Math.sin(i) * 0.4);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.4, 1.6, 0.4), mat, s * 1.3, 2.2, 0.3, -0.3, 0, s * 0.2);
      add(new THREE.SphereGeometry(0.08, 6, 4), eye, s * 0.18, 3.6, 0.55);
      add(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x3a2a5a, side: THREE.DoubleSide }), s * 1.4, 3.2, -0.6, 0, s * 0.6, 0);
    }
    const staff = add(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), gold, 1.6, 2.4, 0.8);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: 0x9a6bff }));
    gem.position.y = 2.6;
    staff.add(gem);
    g.userData.gold = gold;
  }
  g.userData.mat = mat;
  return g;
}
