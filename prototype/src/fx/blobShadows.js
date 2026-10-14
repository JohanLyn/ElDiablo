import * as THREE from 'three';

// Soft contact shadows for the hero and nearby monsters on presets without real
// shadow maps (Mobile). One instanced draw call of dark, feathered discs lying on the
// ground; nothing is created on presets that have shadows.
const MAX = 40;
const RANGE2 = 38 * 38;

function softDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class BlobShadows {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: softDisc(), color: 0x10081c, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  update(g) {
    const px = g.player.pos.x, pz = g.player.pos.z;
    const heightAt = g.world.heightAt;
    let n = 0;
    const put = (x, z, r) => {
      if (n >= MAX) return;
      this.p.set(x, heightAt(x, z) + 0.05, z);
      this.s.set(r * 2.3, 1, r * 2.3);
      this.mesh.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s));
    };
    if (g.player.group.visible && !g.player.dead) put(px, pz, 0.55);
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0 || e.untouchable) continue;
      const dx = e.pos.x - px, dz = e.pos.z - pz;
      if (dx * dx + dz * dz > RANGE2) continue;
      put(e.pos.x, e.pos.z, e.radius);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
