import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWing } from './atlas.js';

// Small hand-built meshes used by the VFX layer: javelin, enemy bolt, hero
// silhouette ghosts and the spectral wings. Geometry and materials are shared.

function hdr(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }

let jav = null;
// Lapis spear: bright core shaft, faceted head and a soft additive sheath.
export function makeJavelinMesh() {
  if (!jav) {
    const shaft = new THREE.CylinderGeometry(0.035, 0.05, 1.7, 6); shaft.rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.1, 0.42, 4); head.rotateX(Math.PI / 2); head.translate(0, 0, 1.05);
    const tail = new THREE.ConeGeometry(0.07, 0.3, 4); tail.rotateX(-Math.PI / 2); tail.translate(0, 0, -0.95);
    const sheath = new THREE.CylinderGeometry(0.13, 0.13, 1.9, 8, 1, true); sheath.rotateX(Math.PI / 2);
    jav = {
      core: mergeGeometries([shaft, head, tail]),
      sheath,
      coreMat: new THREE.MeshBasicMaterial({ color: hdr(0xbcd8ff, 2.2) }),
      headMat: new THREE.MeshBasicMaterial({ color: hdr(0x3b6dff, 1.6) }),
      sheathMat: new THREE.MeshBasicMaterial({ color: hdr(0x4d86ff, 1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(jav.core, jav.coreMat), new THREE.Mesh(jav.sheath, jav.sheathMat));
  return g;
}

let bolt = null;
// Poisoned scorpion bolt: hot lime core in a toxic green halo.
export function makeEnemyBolt() {
  if (!bolt) {
    bolt = {
      core: new THREE.SphereGeometry(0.15, 8, 6),
      halo: new THREE.SphereGeometry(0.33, 10, 8),
      coreMat: new THREE.MeshBasicMaterial({ color: hdr(0xe4ff9a, 2.4) }),
      haloMat: new THREE.MeshBasicMaterial({ color: hdr(0x7cff2a, 1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(bolt.core, bolt.coreMat), new THREE.Mesh(bolt.halo, bolt.haloMat));
  return g;
}

const GHOST_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const GHOST_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uA;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
    gl_FragColor = vec4(uColor * (0.7 + rim * 1.5), (0.22 + rim * 0.75) * uA);
  }`;

let ghostGeo = null;
export function makeGhost(color) {
  if (!ghostGeo) {
    const body = new THREE.CapsuleGeometry(0.42, 0.9, 4, 10); body.translate(0, 0.95, 0);
    const head = new THREE.SphereGeometry(0.28, 10, 8); head.translate(0, 1.75, 0);
    const helm = new THREE.ConeGeometry(0.32, 0.5, 8); helm.translate(0, 2.05, 0);
    const cape = new THREE.BoxGeometry(0.8, 1.3, 0.06); cape.translate(0, 1.05, -0.42);
    ghostGeo = mergeGeometries([body, head, helm, cape]);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 } },
    vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(ghostGeo, mat);
  m.visible = false;
  m.frustumCulled = false;
  m.renderOrder = 7;
  return m;
}

// Spectral wings: two mirrored feathered planes hinged at the hero's back.
export function makeWings() {
  const tex = buildWing();
  const W = 3.4, H = 1.7;
  const geo = new THREE.PlaneGeometry(W, H);
  geo.translate(0.465 * W, 0.086 * H, 0);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: hdr(0xffd98a, 1.9), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const root = new THREE.Group();
  root.position.set(0, 1.45, -0.3);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.scale.x = s;
    m.renderOrder = 7;
    pivot.add(m);
    root.add(pivot);
    wings.push(pivot);
  }
  root.visible = false;
  return { root, wings, mat };
}
