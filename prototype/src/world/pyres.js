import * as THREE from 'three';
import { part, merge } from './models.js';
import { patchLit } from './shaders/lit.js';
import { createFlames, createGlow } from './shaders/glow.js';
import { PYRES, PYRE_SPOTS } from './layout.js';

// The Wailing Pyres (world event on the Ashen Approach): three cold pyres on a ring of
// ash-grey flagstones. Each has a progress ring on the ground (fills while the hero
// stands by it), spectral flames (instanced, scaled by how lit the pyre is), a halo and
// a pooled-light emitter. Visual state is driven from game/interact.js via setLit().
//
// Draw calls: stone (1), flames (1), halos (1), progress rings (3, additive).
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const ASH = [0x8a8090, 0x9a9098, 0x786e7a, 0xa49aa4];
const BONE = 0xcfc4a8, CHAR = 0x1c1614, IRON = 0x34303a;
export const PYRE_LIT_RADIUS = 2.9;
const FLAME_H = 2.9;
const FLAME_COLORS = [0xc4f2ff, 0x4fb4ff, 0x2a34c0];
const HALO = 0x7fc8ff;

const RING_VERT = /* glsl */`
  varying vec2 vP;
  void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */`
  uniform float uProg, uAlpha, uTime; uniform vec3 uCol;
  varying vec2 vP;
  void main() {
    float a = atan(vP.x, vP.y) / 6.2831853 + 0.5;       // 0..1 around the ring
    float on = step(a, uProg);
    float edge = smoothstep(0.0, 0.02, uProg - a) * on;
    float pulse = 0.75 + 0.25 * sin(uTime * 4.0 + a * 12.0);
    vec3 col = mix(uCol * 0.22, uCol * 1.5, edge * pulse);
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`;

export function buildPyres(g) {
  const { scene, world } = g;
  const colliders = world.colliders, heightAt = world.heightAt;
  const stone = [];
  const spots = PYRE_SPOTS.map((p) => ({ ...p, y: heightAt(p.x, p.z) }));

  // Ring of paving around the plateau.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2, r = PYRES.r + 3.2 + (i % 3) * 0.5;
    const x = PYRES.x + Math.cos(a) * r, z = PYRES.z + Math.sin(a) * r;
    stone.push(part(box(1.6 + (i % 2) * 0.5, 0.2 + (i % 3) * 0.06, 1.0), ASH[i % 4], { x, y: heightAt(x, z) + 0.05, z, ry: a + Math.PI / 2 + (i % 3) * 0.2 }));
  }
  for (const s of spots) {
    const { x, z, y } = s;
    stone.push(part(cyl(1.35, 1.6, 0.45, 8), ASH[2], { x, y: y + 0.18, z }));
    stone.push(part(cyl(1.05, 1.2, 0.18, 8), ASH[0], { x, y: y + 0.5, z }));
    // A cairn of charred logs and ribs, ready to burn.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      stone.push(part(cyl(0.09, 0.12, 1.9, 5), CHAR, { x: x + Math.cos(a) * 0.38, y: y + 1.4, z: z + Math.sin(a) * 0.38, rz: Math.cos(a) * 0.35, rx: -Math.sin(a) * 0.35 }));
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      stone.push(part(cyl(0.05, 0.07, 1.5, 4), BONE, { x: x + Math.cos(a) * 0.75, y: y + 1.05, z: z + Math.sin(a) * 0.75, rz: Math.cos(a) * 0.7, rx: -Math.sin(a) * 0.7 }));
    }
    stone.push(part(new THREE.TorusGeometry(0.85, 0.07, 5, 10), IRON, { x, y: y + 0.95, z, rx: Math.PI / 2 }));
    stone.push(part(new THREE.SphereGeometry(0.2, 6, 5), BONE, { x: x + 0.9, y: y + 0.65, z: z + 0.4, sy: 0.9 }));
    colliders.addCircle(x, z, 1.1);
  }
  const mesh = new THREE.Mesh(merge(stone), patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);

  // Flames, halos, light emitters and progress rings.
  const flames = createFlames(spots.map((s) => ({ x: s.x, y: s.y + 1.0, z: s.z, s: 0.001 })), { colors: FLAME_COLORS, intensity: 1.05 });
  scene.add(flames);
  const halos = createGlow(spots.map((s) => ({ x: s.x, y: s.y + 2.0, z: s.z, color: HALO, size: 1.6, flicker: 0.2 })), { opacity: 0.4 });
  scene.add(halos);
  const sizes = halos.geometry.attributes.aSize;
  const ringGeo = new THREE.RingGeometry(1.75, 2.15, 56, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = spots.map((s) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uProg: { value: 0 }, uAlpha: { value: 0.5 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0x7fd8ff) } },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.set(s.x, s.y + 0.14, s.z);
    m.renderOrder = 3;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  const emitters = spots.map((s) => world.lights.add({ x: s.x, y: s.y + 2.6, z: s.z, color: 0x86d0ff, intensity: 0, range: 18, decay: 1.6, flicker: 0.6, night: 0.25 }));

  const dummy = new THREE.Object3D();
  const lit = spots.map(() => 0);
  const api = {
    spots, lit, rings, emitters,
    center: { x: PYRES.x, y: heightAt(PYRES.x, PYRES.z), z: PYRES.z },
    // k: 0 cold .. 1 blazing; the flame, halo and light follow.
    setLit(i, k) {
      if (Math.abs(lit[i] - k) < 0.002) return;
      lit[i] = k;
      const s = spots[i];
      dummy.position.set(s.x, s.y + 1.0, s.z);
      dummy.scale.setScalar(0.001 + k * FLAME_H);
      dummy.updateMatrix();
      flames.setMatrixAt(i, dummy.matrix);
      flames.instanceMatrix.needsUpdate = true;
      sizes.setX(i, 1.6 + k * 6);
      sizes.needsUpdate = true;
      emitters[i].intensity = k * 8;
    },
    // Ground ring: p in 0..1 fills; alpha 0 hides it.
    setRing(i, p, alpha) {
      const u = rings[i].material.uniforms;
      u.uProg.value = p; u.uAlpha.value = alpha;
      rings[i].visible = alpha > 0.01;
    },
    update(t) { for (const r of rings) r.material.uniforms.uTime.value = t; },
  };
  for (let i = 0; i < spots.length; i++) api.setRing(i, 0, 0);
  return api;
}
