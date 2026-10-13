import * as THREE from 'three';
import { buildAtlas } from './atlas.js';

// GPU-instanced particle layers (one draw call each). Particles are camera
// facing billboards (mode 0), terrain-hugging decals (mode 1, corner heights
// sampled at spawn) or flat quads at a fixed world height (mode 2). All
// simulation is on the CPU in flat typed arrays; emitting never allocates.
const VERT = /* glsl */`
  attribute vec4 iPosSize;
  attribute vec4 iColor;
  attribute vec4 iVel;
  attribute vec4 iMisc;
  attribute vec4 iH;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec2 l = position.xy * 2.0;
    float size = iPosSize.w;
    float mode = iMisc.z;
    float c = cos(iMisc.x), s = sin(iMisc.x);
    vec3 world;
    if (mode < 0.5) {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      if (iVel.w > 0.0) {
        vec2 vv = (viewMatrix * vec4(iVel.xyz, 0.0)).xy;
        float len = length(vv);
        vec2 d = len > 1e-4 ? vv / len : vec2(1.0, 0.0);
        float sp = length(iVel.xyz);
        float longHalf = size * 0.5 * (1.0 + iVel.w * sp);
        vec3 ax = right * d.x + up * d.y;
        vec3 pr = right * (-d.y) + up * d.x;
        world = iPosSize.xyz + ax * l.x * longHalf + pr * l.y * size * 0.5;
      } else {
        vec2 q = vec2(c * l.x - s * l.y, s * l.x + c * l.y);
        world = iPosSize.xyz + (right * q.x + up * q.y) * size * 0.5;
      }
    } else {
      vec2 q = vec2(c * l.x - s * l.y, s * l.x + c * l.y);
      float h = iPosSize.y;
      if (mode < 1.5) {
        vec2 bl = clamp(l * (size / max(iMisc.w, 0.001)), -1.0, 1.0) * 0.5 + 0.5;
        h += mix(mix(iH.x, iH.y, bl.x), mix(iH.z, iH.w, bl.x), bl.y);
      }
      world = vec3(iPosSize.x + q.x * size * 0.5, h, iPosSize.z + q.y * size * 0.5);
    }
    float cell = iMisc.y;
    vec2 cellUv = vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0));
    vUv = (cellUv + uv * 0.992 + 0.004) * 0.25;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vColor.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }`;

const DEFAULTS = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 1,
  r0: 1, g0: 1, b0: 1, r1: -1, g1: -1, b1: -1, a: 1, frame: 0, grav: 0, drag: 0,
  rot: 0, rotVel: 0, stretch: 0, mode: 0, fp: 1, fin: 0.04, smax: 0,
};

class Layer {
  constructor(scene, atlas, max, additive, renderOrder) {
    this.max = max;
    this.hi = 0;
    this.next = 0;
    this.live = 0;
    this.heightAt = null;
    this.tpl = { ...DEFAULTS };
    this.gPos = new Float32Array(max * 4);
    this.gCol = new Float32Array(max * 4);
    this.gVel = new Float32Array(max * 4);
    this.gMisc = new Float32Array(max * 4);
    this.gH = new Float32Array(max * 4);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.rotVel = new Float32Array(max); this.fp = new Float32Array(max); this.fin = new Float32Array(max);

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.attrs = [];
    for (const [name, arr] of [['iPosSize', this.gPos], ['iColor', this.gCol], ['iVel', this.gVel], ['iMisc', this.gMisc], ['iH', this.gH]]) {
      const a = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.attrs.push(a);
    }
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  // Reset the template to defaults and hand it out for filling in.
  begin(frame) {
    const t = this.tpl;
    t.x = t.y = t.z = t.vx = t.vy = t.vz = 0;
    t.life = 1; t.s0 = t.s1 = 1;
    t.r0 = t.g0 = t.b0 = 1; t.r1 = t.g1 = t.b1 = -1;
    t.a = 1; t.frame = frame; t.grav = 0; t.drag = 0; t.rot = 0; t.rotVel = 0;
    t.stretch = 0; t.mode = 0; t.fp = 1; t.fin = 0.04; t.smax = 0;
    return t;
  }

  emit() {
    const t = this.tpl;
    const i = this.next;
    this.next = (i + 1) % this.max;
    if (i + 1 > this.hi) this.hi = i + 1;
    if (this.life[i] <= 0) this.live++;
    const o4 = i * 4, o3 = i * 3;
    const smax = t.smax || Math.max(t.s0, t.s1);
    this.gPos[o4] = t.x; this.gPos[o4 + 1] = t.y; this.gPos[o4 + 2] = t.z; this.gPos[o4 + 3] = t.s0;
    this.gVel[o4] = t.vx; this.gVel[o4 + 1] = t.vy; this.gVel[o4 + 2] = t.vz; this.gVel[o4 + 3] = t.stretch;
    this.gMisc[o4] = t.rot; this.gMisc[o4 + 1] = t.frame; this.gMisc[o4 + 2] = t.mode; this.gMisc[o4 + 3] = smax;
    const h = this.heightAt;
    if (t.mode === 1) {
      if (h) {
        const half = smax * 0.5, c = Math.cos(t.rot), s = Math.sin(t.rot);
        const hx = (lx, ly) => t.x + (c * lx - s * ly) * half;
        const hz = (lx, ly) => t.z + (s * lx + c * ly) * half;
        this.gH[o4] = h(hx(-1, -1), hz(-1, -1)); this.gH[o4 + 1] = h(hx(1, -1), hz(1, -1));
        this.gH[o4 + 2] = h(hx(-1, 1), hz(-1, 1)); this.gH[o4 + 3] = h(hx(1, 1), hz(1, 1));
      } else this.gH[o4] = this.gH[o4 + 1] = this.gH[o4 + 2] = this.gH[o4 + 3] = 0;
    }
    this.gCol[o4] = t.r0; this.gCol[o4 + 1] = t.g0; this.gCol[o4 + 2] = t.b0; this.gCol[o4 + 3] = 0;
    this.age[i] = 0; this.life[i] = t.life;
    this.s0[i] = t.s0; this.s1[i] = t.s1;
    this.c0[o3] = t.r0; this.c0[o3 + 1] = t.g0; this.c0[o3 + 2] = t.b0;
    const same = t.r1 < 0;
    this.c1[o3] = same ? t.r0 : t.r1; this.c1[o3 + 1] = same ? t.g0 : t.g1; this.c1[o3 + 2] = same ? t.b0 : t.b1;
    this.a0[i] = t.a; this.grav[i] = t.grav; this.drag[i] = t.drag;
    this.rotVel[i] = t.rotVel; this.fp[i] = t.fp; this.fin[i] = t.fin;
  }

  update(dt) {
    const { gPos, gCol, gVel, gMisc, age, life, s0, s1, c0, c1, a0, grav, drag, rotVel, fp, fin } = this;
    let live = 0, top = 0;
    for (let i = 0; i < this.hi; i++) {
      const L = life[i];
      if (L <= 0) continue;
      const a = age[i] + dt;
      const o4 = i * 4, o3 = i * 3;
      if (a >= L) { life[i] = 0; gPos[o4 + 3] = 0; gCol[o4 + 3] = 0; continue; }
      age[i] = a;
      live++; top = i + 1;
      const k = a / L;
      let vx = gVel[o4], vy = gVel[o4 + 1], vz = gVel[o4 + 2];
      const d = drag[i];
      if (d > 0) { const f = Math.max(0, 1 - d * dt); vx *= f; vy *= f; vz *= f; }
      vy -= grav[i] * dt;
      gVel[o4] = vx; gVel[o4 + 1] = vy; gVel[o4 + 2] = vz;
      gPos[o4] += vx * dt; gPos[o4 + 1] += vy * dt; gPos[o4 + 2] += vz * dt;
      gPos[o4 + 3] = s0[i] + (s1[i] - s0[i]) * k;
      gCol[o4] = c0[o3] + (c1[o3] - c0[o3]) * k;
      gCol[o4 + 1] = c0[o3 + 1] + (c1[o3 + 1] - c0[o3 + 1]) * k;
      gCol[o4 + 2] = c0[o3 + 2] + (c1[o3 + 2] - c0[o3 + 2]) * k;
      const f = fp[i];
      const fade = f === 1 ? 1 - k : Math.pow(1 - k, f);
      gCol[o4 + 3] = a0[i] * Math.min(1, a / fin[i]) * fade;
      gMisc[o4] += rotVel[i] * dt;
    }
    this.hi = top;
    this.live = live;
    const n = Math.max(1, top);
    for (const at of this.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
    this.geo.instanceCount = top;
  }
}

export class ParticleSystem {
  constructor(scene, { addMax = 3200, alphaMax = 900 } = {}) {
    this.atlas = buildAtlas();
    this.add = new Layer(scene, this.atlas, addMax, true, 6);
    this.alpha = new Layer(scene, this.atlas, alphaMax, false, 5);
    this.q = 1; // quality multiplier (settings.quality.particles)
  }

  set heightAt(fn) { this.add.heightAt = fn; this.alpha.heightAt = fn; }

  // Scale an emit count by quality and back-pressure, with stochastic rounding.
  n(count) {
    const load = this.add.live / this.add.max;
    const pressure = load > 0.65 ? Math.max(0.2, 1 - (load - 0.65) * 2.6) : 1;
    const v = count * this.q * pressure;
    return Math.floor(v + Math.random());
  }

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
  }
}
