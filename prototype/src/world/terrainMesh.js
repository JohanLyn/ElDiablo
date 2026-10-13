import * as THREE from 'three';
import { HALF, REGIONS } from './layout.js';
import { heightAt, groundColor, WATER_LEVEL, isWater } from './terrain.js';

const REGION_COLORS = Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [k, v.ground]));

export function buildTerrain(scene) {
  const size = HALF * 2;
  const segs = 220;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const [r, g, b] = groundColor(x, z, REGION_COLORS);
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Marsh water sheet; terrain pokes through where it's higher.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 260),
    new THREE.MeshStandardMaterial({ color: 0x2e5a58, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-125, WATER_LEVEL, 0);
  scene.add(water);

  return { mesh, water };
}

// Painted overview of the world for the minimap and the full map (1 px = 2 m).
export function buildMapImage() {
  const res = 220;
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d');
  const img = g.createImageData(res, res);
  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const x = (px / res) * HALF * 2 - HALF, z = (py / res) * HALF * 2 - HALF;
      let [r, gg, b] = groundColor(x, z, REGION_COLORS);
      if (isWater(x, z)) { r = 0.18; gg = 0.36; b = 0.38; }
      const h = heightAt(x, z);
      const lift = Math.max(-0.15, Math.min(0.2, h * 0.03));
      const i = (py * res + px) * 4;
      img.data[i] = Math.min(255, (r + lift) * 255);
      img.data[i + 1] = Math.min(255, (gg + lift) * 255);
      img.data[i + 2] = Math.min(255, (b + lift) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
