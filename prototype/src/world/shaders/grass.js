import * as THREE from 'three';
import { regionAt, heightAt, roadDistance, isWater, marshWetness } from '../terrain.js';
import { flatSpots } from '../layout.js';

// Wind-swayed grass tufts in a ring around the player. A fixed pool of cell
// slots is addressed by (cell mod N): when the player crosses into a new cell
// only the cells that actually changed are re-scattered, with a per-cell hash
// so the same cell always grows the same grass.
const CELL = 4;
const N = 20; // N * CELL = 80 m wide pool, ring radius 40 m
const RADIUS = (N * CELL) / 2;
const FLATS = flatSpots().filter((f) => f.r < 12);

// JS twin of the GLSL hash/value noise used by the terrain shader, so the
// grass tint follows the same lush/dry patches as the ground below it.
const fract = (v) => v - Math.floor(v);
function hash21(x, y) {
  let px = fract(x * 123.34), py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  return fract(px * py);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function cellHash(cx, cz, k) {
  let h = Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263) ^ Math.imul(k + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tuftGeometry() {
  const pos = [], col = [], nor = [], idx = [];
  const blades = 11;
  const base = new THREE.Color(0x5b6a2a), tip = new THREE.Color(0xe2e08a);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + (b % 2) * 0.4;
    const r = 0.05 + (b % 4) * 0.08;
    const h = 0.32 + ((b * 37) % 5) * 0.08;
    const lean = 0.15 + ((b * 13) % 4) * 0.06;
    const ox = Math.sin(a) * r, oz = Math.cos(a) * r;
    const dx = Math.sin(a + 1.2), dz = Math.cos(a + 1.2); // blade width direction
    const lx = Math.sin(a) * lean, lz = Math.cos(a) * lean; // lean outward
    const w = 0.075;
    const rings = [[0, w, 0], [0.55, w * 0.75, 0.4], [1, 0, 1]];
    const start = pos.length / 3;
    for (const [t, ww, lt] of rings) {
      const bx = ox + lx * lt * lt * h, bz = oz + lz * lt * lt * h;
      if (ww > 0) {
        pos.push(bx - dx * ww, t * h, bz - dz * ww, bx + dx * ww, t * h, bz + dz * ww);
        for (let s = 0; s < 2; s++) { const c = base.clone().lerp(tip, t); col.push(c.r, c.g, c.b); nor.push(0, 1, 0); }
      } else {
        pos.push(bx, t * h, bz);
        const c = base.clone().lerp(tip, t); col.push(c.r, c.g, c.b); nor.push(0, 1, 0);
      }
    }
    idx.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, env, settings) {
    this.env = env;
    const q = settings?.quality?.grass ?? 1;
    this.enabled = q > 0;
    this.K = Math.round(14 * q);
    this.mesh = null;
    if (!this.enabled) return;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = env.uTime;
      shader.uniforms.uWind = env.uWind;
      shader.uniforms.uPlayer = env.uPlayer;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind; uniform vec3 uPlayer;')
        .replace('#include <project_vertex>', `
          vec4 iOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec4 wpos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          float dd = length(iOrigin.xz - uPlayer.xz);
          float fade = 1.0 - smoothstep(${(RADIUS * 0.72).toFixed(1)}, ${(RADIUS * 0.98).toFixed(1)}, dd);
          wpos.xyz = iOrigin.xyz + (wpos.xyz - iOrigin.xyz) * fade;
          float bend = transformed.y * transformed.y * 2.4;
          float gust = sin(iOrigin.x * 0.33 + iOrigin.z * 0.21 + uTime * 1.6) * 0.65 + sin(iOrigin.x * 0.9 - iOrigin.z * 0.7 + uTime * 3.3) * 0.25
                     + sin(iOrigin.x * 0.07 + uTime * 0.5) * 0.4;
          wpos.xz += uWind * gust * bend * 0.22;
          wpos.y -= abs(gust) * bend * 0.04;
          vec4 mvPosition = viewMatrix * wpos;
          gl_Position = projectionMatrix * mvPosition;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`);
    };
    material.customProgramCacheKey = () => 'grass-v1';
    const count = N * N * this.K;
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells = new Int32Array(N * N * 2).fill(0x7fffffff);
    this._d = new THREE.Object3D();
    this._c = new THREE.Color();
    scene.add(this.mesh);
    this.lastCx = null; this.lastCz = null;
  }

  fillCell(cx, cz) {
    const slot = (((cz % N) + N) % N) * N + (((cx % N) + N) % N);
    const { K, _d: d, _c: c } = this;
    const mesh = this.mesh;
    for (let k = 0; k < K; k++) {
      const i = slot * K + k;
      const x = (cx + cellHash(cx, cz, k * 3)) * CELL;
      const z = (cz + cellHash(cx, cz, k * 3 + 1)) * CELL;
      const rnd = cellHash(cx, cz, k * 3 + 2);
      let keep = false, dens = 0;
      const region = regionAt(x, z);
      if (region === 'sunfields') dens = 0.5 + 0.5 * vnoise(x * 0.05 + 40, z * 0.05);
      else if (region === 'marsh') {
        const w = marshWetness(x, z);
        dens = w > 0.02 ? 0.55 + w * 0.6 : 0.5; // thick around the pools
      }
      if (dens > 0 && rnd < dens && !isWater(x, z) && roadDistance(x, z) > 2.6) {
        keep = true;
        for (const f of FLATS) if ((x - f.x) ** 2 + (z - f.z) ** 2 < (f.r * 0.8) ** 2) { keep = false; break; }
      }
      if (!keep) { d.scale.setScalar(0); d.position.set(x, -50, z); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); continue; }
      const y = heightAt(x, z);
      const s = 0.55 + cellHash(cx, cz, k * 3 + 100) * 0.65 + (region === 'marsh' ? 0.35 : 0);
      d.position.set(x, y - 0.03, z);
      d.rotation.set(0, cellHash(cx, cz, k * 3 + 200) * 6.28, 0);
      d.scale.set(s, s * (0.85 + cellHash(cx, cz, k * 3 + 300) * 0.5), s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      // Colour follows the ground patches below.
      if (region === 'sunfields') {
        const n3 = vnoise(x * 0.045 + 3, z * 0.045 + 3), n2 = vnoise(x * 0.16 + 7, z * 0.16 + 7);
        const dry = smoothstep(0.38, 0.72, n3 * 0.65 + n2 * 0.55);
        c.setRGB(0.42 + dry * 0.42, 0.8 - dry * 0.1, 0.32 + dry * 0.1);
      } else {
        const w = marshWetness(x, z);
        c.setRGB(0.42 - w * 0.12, 0.8 - w * 0.05, 0.4 + w * 0.05);
      }
      c.multiplyScalar(0.85 + cellHash(cx, cz, k * 3 + 400) * 0.3);
      mesh.setColorAt(i, c);
    }
  }

  update(pos, force = false) {
    if (!this.enabled) return;
    this.env.uPlayer.value.copy(pos);
    const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    if (!force && cx === this.lastCx && cz === this.lastCz) return;
    const far = this.lastCx === null || Math.abs(cx - this.lastCx) >= N / 2 || Math.abs(cz - this.lastCz) >= N / 2;
    const h = N / 2;
    for (let dz = -h; dz < h; dz++) {
      for (let dx = -h; dx < h; dx++) {
        const x = cx + dx, z = cz + dz;
        const slot = (((z % N) + N) % N) * N + (((x % N) + N) % N);
        if (!far && this.cells[slot * 2] === x && this.cells[slot * 2 + 1] === z) continue;
        this.cells[slot * 2] = x; this.cells[slot * 2 + 1] = z;
        this.fillCell(x, z);
      }
    }
    this.lastCx = cx; this.lastCz = cz;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
