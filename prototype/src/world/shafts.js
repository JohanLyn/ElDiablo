import * as THREE from 'three';
import { heightAt, regionAt } from './terrain.js';
import { LANDMARKS } from './spots.js';
import { INSTANCES } from './instances.js';
import { NOISE_GLSL } from './shaders/common.js';
import { FOG_GLSL, fogUniforms } from './shaders/fog.js';

// Light shafts: soft additive ribbons that follow the sun (world shafts) or a
// fixed ceiling-crack direction (dungeons), all in one instanced draw call.
//
// Each shaft is a camera-facing ribbon around the light ray: it starts at a
// canopy / lintel / ceiling point, runs along -lightDir to the ground, fades at
// both ends and in at grazing view angles, and carries noise-scrolled dust and
// glittering motes. Strength comes from the day cycle (`shaft` in env.js).
//
// Instance layout: aA = (p0.xyz, halfWidth), aB = (groundY, maxLength, seed, strength),
// aC = (fixedDir.xyz, mode)  mode 0: sun ray   1: fixed ray   2: floor splash (fixed ray)
// aT = tint.

const palmMeshes = (scene) => {
  const out = [];
  scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const h = bb.max.y - bb.min.y, w = bb.max.x - bb.min.x;
    // The palm prop: ~6 m tall crown, ~5-8 m wide, double-sided leaf material.
    if (h > 5.4 && h < 7.6 && w > 4 && w < 9 && o.material?.side === THREE.DoubleSide) out.push(o);
  });
  return out;
};

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function createShafts(scene, env, settings) {
  const budget = settings?.quality?.shafts ?? 1;
  if (budget <= 0) return { update() {}, mesh: null };

  const items = [];
  const add = (it) => items.push(it);

  // ---- palms (sunfields + marsh): sun streaming through the crowns
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let pi = 0;
  for (const mesh of palmMeshes(scene)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(pos, q, sc);
      pi++;
      if (hash(pi) > 0.55 * budget) continue;
      const r = regionAt(pos.x, pos.z);
      const marsh = r === 'marsh';
      const n = hash(pi * 3.1) > 0.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const a = hash(pi * 7.7 + k) * 6.28, rr = 0.6 + hash(pi * 5.3 + k) * 1.6 * sc.y;
        add({
          x: pos.x + Math.cos(a) * rr, y: pos.y + 5.2 * sc.y + hash(pi + k) * 0.8, z: pos.z + Math.sin(a) * rr,
          w: (0.55 + hash(pi * 2.3 + k) * 0.7) * (marsh ? 1.35 : 1), gy: pos.y, cap: 26, seed: hash(pi * 9.1 + k) * 50,
          s: marsh ? 0.95 : 0.8, mode: 0, tint: marsh ? [0.8, 1.0, 0.78] : [1, 1, 1],
        });
      }
    }
  }

  // ---- the broken ziggurat: dust-heavy beams off the stepped tiers
  const Z = LANDMARKS.ziggurat;
  const zy = heightAt(Z.x, Z.z) - 2.6;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.28 + 0.4, rr = 7 + hash(i * 3.3) * 6;
    add({ x: Z.x + Math.cos(a) * rr, y: zy + 9 + hash(i) * 4, z: Z.z + Math.sin(a) * rr, w: 1.8 + hash(i * 1.7) * 1.8, gy: zy + 1.4, cap: 40, seed: i * 9.3, s: 1.1, mode: 0, tint: [1, 0.9, 0.7] });
  }

  // ---- the First Gate: light falling through the arch (violet-tinted)
  const G = LANDMARKS.gate, gy = heightAt(G.x, G.z);
  for (let i = 0; i < 5; i++) {
    const x = -9 + i * 4.5;
    add({ x: G.x + x, y: gy + 49, z: G.z + 1, w: 2.2 + (i % 2) * 1.2, gy: gy, cap: 80, seed: i * 6.1, s: 0.9, mode: 0, tint: [0.85, 0.7, 1] });
  }

  // ---- dungeon ceiling cracks: fixed direction, always on
  const crack = (inst, rooms, tint, dir, s = 1) => {
    const ox = inst.origin.x, oz = inst.origin.z;
    rooms.forEach(([cx, cz, w], i) => {
      const x = ox + cx, z = oz + cz;
      const d = new THREE.Vector3(...dir).normalize();
      const top = 9;
      add({ x, y: top, z, w, gy: 0, cap: top / d.y + 1, seed: i * 13.7 + cx, s, mode: 1, tint, dir: [d.x, d.y, d.z] });
      // The splash where the shaft lands on the floor.
      const land = top / d.y;
      add({ x: x - d.x * land, y: 0.06, z: z - d.z * land, w: w * 2.4, gy: 0, cap: 1, seed: i * 3.1, s: s * 0.8, mode: 2, tint, dir: [d.x, d.y, d.z] });
    });
  };
  crack(INSTANCES.ganzir, [[-5, -3, 1.2], [5, -34, 1.5], [-6, -38, 1.0], [38, -33, 1.4], [30, -72, 1.1], [-12, -70, 1.6], [-22, -80, 1.0]], [1.0, 0.82, 0.62], [0.34, 1, 0.22]);
  crack(INSTANCES.cistern, [[3, -2, 1.1], [-5, -29, 1.5], [6, -33, 1.0], [-27, -31, 1.1], [-4, -61, 1.6], [6, -64, 1.1]], [0.7, 0.95, 1.0], [-0.3, 1, 0.2]);

  const N = items.length;
  const aA = new Float32Array(N * 4), aB = new Float32Array(N * 4), aC = new Float32Array(N * 4), aT = new Float32Array(N * 3);
  items.forEach((it, i) => {
    aA.set([it.x, it.y, it.z, it.w], i * 4);
    aB.set([it.gy, it.cap, it.seed, it.s], i * 4);
    aC.set([...(it.dir ?? [0, 1, 0]), it.mode], i * 4);
    aT.set(it.tint, i * 3);
  });

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 4));
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
  geo.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 3));
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = {
    uTime: env.uTime,
    uSunDir: env.uSunDir,
    uSunColor: env.uSunColor,
    uShaftK: { value: 1 },
    uDungeonK: { value: 0 },
    uQ: { value: budget >= 0.99 ? 1 : 0 },
    ...fogUniforms(),
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aA, aB, aC; attribute vec3 aT;
      uniform vec3 uSunDir; uniform float uShaftK, uDungeonK;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vTint; varying vec3 vWP; varying float vLen;
      void main() {
        vUv = uv;
        float mode = aC.w;
        vec3 dir = mode > 0.5 ? normalize(aC.xyz) : normalize(uSunDir);
        vec3 axis = -dir;
        float dy = max(dir.y, 0.14);
        vec3 p0 = aA.xyz;
        float len = min((p0.y - aB.x) / dy, aB.y);
        vec3 P;
        float k = mode > 0.5 ? uDungeonK : uShaftK;
        float vis = 1.0;
        if (mode > 1.5) {
          // Floor splash: an ellipse stretched along the ray's ground track.
          vec2 e = (uv - 0.5) * 2.0;
          vec3 along = normalize(vec3(axis.x, 0.0, axis.z) + vec3(1e-4));
          vec3 across = vec3(-along.z, 0.0, along.x);
          P = p0 + (across * e.x + along * e.y * 1.6) * aA.w;
          vLen = 0.0;
        } else {
          P = p0 + axis * len * uv.y;
          vec3 toCam = cameraPosition - P;
          vec3 side = normalize(cross(axis, toCam));
          float w = aA.w * mix(1.0, 1.5, uv.y);
          P += side * position.x * w;
          // Fade when looking down the beam (the ribbon would collapse to a line).
          float ang = length(cross(axis, normalize(toCam)));
          vis *= smoothstep(0.06, 0.42, ang);
          vLen = len;
        }
        float dist = distance(cameraPosition, P);
        vis *= smoothstep(95.0, 55.0, dist) * smoothstep(1.5, 7.0, dist);
        vInfo = vec4(aB.z, aB.w * k * vis, mode, 0.0);
        vTint = aT;
        vWP = P;
        vec4 mv = viewMatrix * vec4(P, 1.0);
        gl_Position = projectionMatrix * mv;
        if (vInfo.y < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uQ; uniform vec3 uSunColor, uSunDir;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vTint; varying vec3 vWP; varying float vLen;
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main() {
        float seed = vInfo.x, strength = vInfo.y, mode = vInfo.z;
        float a;
        vec3 col = vTint * uSunColor;
        if (mode > 1.5) {
          vec2 e = (vUv - 0.5) * 2.0;
          float r = length(e);
          a = smoothstep(1.0, 0.0, r);
          a *= a * (0.65 + 0.5 * vnoise(vWP.xz * 1.3 + seed));
          col *= 0.7;
        } else {
          float x = abs(vUv.x - 0.5) * 2.0;
          float across = exp(-x * x * 3.4);
          float v = vUv.y;
          float along = smoothstep(0.0, 0.16, v) * (1.0 - smoothstep(0.62, 1.0, v));
          float n = 0.62 + 0.38 * vnoise(vec2(vUv.x * 2.2 + seed, v * vLen * 0.22 - uTime * 0.12));
          if (uQ > 0.5) n *= 0.8 + 0.4 * vnoise(vec2(vUv.x * 5.0 - seed, v * vLen * 0.5 + uTime * 0.07));
          a = across * along * n;
          // Dust motes drifting down the beam.
          vec2 g = vec2(vUv.x * 7.0 + seed, v * vLen * 0.55 - uTime * 0.25);
          vec2 cell = floor(g), f = fract(g);
          float rnd = hash21(cell + seed);
          vec2 c = vec2(hash21(cell + 3.7), hash21(cell + 9.1));
          float mote = step(0.78, rnd) * smoothstep(0.2, 0.0, length(f - c)) * (0.55 + 0.45 * sin(uTime * 2.5 + rnd * 40.0));
          a += mote * across * along * 1.6;
        }
        a *= strength;
        a *= kurTransmit(vWP);
        gl_FragColor = vec4(col * 0.9, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);

  return {
    mesh,
    count: N,
    uniforms,
    update({ shaftK, dungeon }) {
      uniforms.uShaftK.value = shaftK;
      uniforms.uDungeonK.value = dungeon ? 1 : 0;
    },
  };
}
