import * as THREE from 'three';
import { distPointSegment } from '../core/util.js';
import { heightAt } from './terrain.js';
import { flatSpots } from './layout.js';
import { getEnv } from './shaders/common.js';

// Irrigation canals in the Sunfields: low mud berms with a thin ribbon of water,
// running beside the main roads. Decorative (walkable), but props keep clear of them.
export const CANAL_LINES = [
  [[8, 118], [10, 100], [10, 82], [7, 66], [4, 50], [3, 38]],
  [[-5, 4], [-4, -14], [-4, -34], [-9, -52], [-11, -70]],
  [[-70, 60], [-52, 66], [-34, 62], [-18, 66], [-8, 76]], // feeder from the west
];

const FLATS = flatSpots();

export function canalDistance(x, z) {
  let best = Infinity;
  for (const line of CANAL_LINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = distPointSegment(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]).dist;
      if (d < best) best = d;
    }
  }
  return best;
}

function resample(line, step) {
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(line[line.length - 1]);
  // Light smoothing so the polyline reads as a curve.
  return out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    return [(out[i - 1][0] + 2 * p[0] + out[i + 1][0]) / 4, (out[i - 1][1] + 2 * p[1] + out[i + 1][1]) / 4];
  });
}

export function buildCanals(scene) {
  const env = getEnv();
  const bankPos = [], bankCol = [], bankIdx = [];
  const wPos = [], wUv = [], wIdx = [];
  const prof = [[-2.4, 0], [-1.6, 0.34], [-1.0, 0.22], [-0.55, -0.16], [0.55, -0.16], [1.0, 0.22], [1.6, 0.34], [2.4, 0]];
  const col = [new THREE.Color(0x5a4630), new THREE.Color(0x7a6038), new THREE.Color(0x3b2e22)];
  let dist = 0;
  for (const line of CANAL_LINES) {
    const pts = resample(line, 2.5).filter((p) => !FLATS.some((f) => Math.hypot(p[0] - f.x, p[1] - f.z) < f.r + 2.5));
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const hc = heightAt(x, z);
      const base = bankPos.length / 3;
      for (let k = 0; k < prof.length; k++) {
        const [o, dy] = prof[k];
        const px = x + nx * o, pz = z + nz * o;
        bankPos.push(px, heightAt(px, pz) + dy * 0.9 + 0.03, pz);
        const c = k === 3 || k === 4 ? col[2] : (k === 1 || k === 6 ? col[1] : col[0]);
        bankCol.push(c.r, c.g, c.b);
      }
      if (i > 0 && (i - 1 < pts.length) && Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) < 4) {
        for (let k = 0; k < prof.length - 1; k++) {
          const p0 = base - prof.length + k, p1 = p0 + 1, q0 = base + k, q1 = q0 + 1;
          bankIdx.push(p0, q0, p1, p1, q0, q1);
        }
      }
      // Water ribbon follows the canal centre line.
      const wy = hc + 0.1;
      const wb = wPos.length / 3;
      wPos.push(x - nx * 1.05, wy, z - nz * 1.05, x + nx * 1.05, wy, z + nz * 1.05);
      dist += i > 0 ? Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) : 0;
      wUv.push(dist / 3, 0, dist / 3, 1);
      if (i > 0 && Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) < 4) wIdx.push(wb - 2, wb - 1, wb, wb - 1, wb + 1, wb);
    }
  }
  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(bankPos, 3));
  bankGeo.setAttribute('color', new THREE.Float32BufferAttribute(bankCol, 3));
  bankGeo.setIndex(bankIdx);
  bankGeo.computeVertexNormals();
  const banks = new THREE.Mesh(bankGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  banks.receiveShadow = true;
  scene.add(banks);

  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  wGeo.setIndex(wIdx);
  const wMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: env.uTime, uSky: env.uSkyHorizon, uSun: env.uSunColor },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vWP;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uSky, uSun;
      varying vec2 vUv; varying vec3 vWP;
      void main() {
        float edge = abs(vUv.y - 0.5) * 2.0;
        float flow = sin(vUv.x * 5.0 - uTime * 1.6 + sin(vUv.y * 6.0) * 1.5) * 0.5 + 0.5;
        vec3 deep = vec3(0.05, 0.2, 0.22), shallow = vec3(0.14, 0.38, 0.32);
        vec3 col = mix(deep, shallow, edge * 0.8 + flow * 0.15);
        col = mix(col, uSky * 0.9, 0.22 + flow * 0.1);
        col += uSun * pow(flow, 10.0) * 0.18 * (1.0 - edge);
        col = mix(col, vec3(0.8, 0.85, 0.7), smoothstep(0.82, 1.0, edge) * 0.35);
        gl_FragColor = vec4(col, 0.9 - edge * 0.2);
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(wGeo, wMat);
  water.renderOrder = 2;
  scene.add(water);
  return { banks, water };
}
