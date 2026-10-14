import * as THREE from 'three';
import { U, PREMULT, TAU, clamp01, col0, col1 } from './shared.js';
import { F } from './atlas.js';
import { VARIANTS } from '../game/gidimRules.js';

// Night of the Gidim visuals: the cuneiform marks the dead leave on the ground, the ghost
// material, the rise / death / recoil effects, the chains of bound gidim and the ghost-fire trails.
// Everything is pooled: the marks are ONE instanced mesh, the chains ONE instanced mesh.

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _e = new THREE.Euler();

export const GHOST_EDGE = 0x66f0ff;

// Turn an enemy model's rig material into a translucent pale-blue ghost: high rim, extra glow,
// cold dissolve edge. The material stays a rigMaterial (same shader), so rise and death reuse the
// ember dissolve with a cyan edge instead of orange.
export function ghostify(group, { variant = 'plain', lord = false } = {}) {
  const mat = group.userData.mat;
  const u = mat.userData.u;
  mat.transparent = true;
  mat.opacity = lord ? 0.74 : variant === 'shard' ? 0.5 : 0.6;
  mat.color.set(0xcfeff8); // pulls bone, iron and cloth toward cold glass
  u.uTint.value.set(0xa4eef4).lerp(_c.set(VARIANTS[variant]?.tint ?? 0x7fe8e0), 0.28);
  u.uGlow.value = lord ? 1.9 : 1.5;
  u.uFill.value = 0.5;
  u.uRim.value = 1.7;
  u.uRimMix.value = 1;
  u.uRimTint.value.setRGB(0.5, 1.0, 1.05);
  u.uEdge.value.set(GHOST_EDGE);
  mat.userData.baseGlow = u.uGlow.value;
  return group;
}

// ---------------------------------------------------------------------------------------------
// Marks: faint cuneiform scorch decals at the spot a monster died by day. One instanced quad per
// mark, a procedural shader draws the blot and its wedge-shaped glyphs; `uVis` brightens them
// through dusk and night. Rising marks flare with an expanding ring.
// ---------------------------------------------------------------------------------------------
const MARK_VERT = /* glsl */`
  attribute vec3 aTint;
  attribute vec2 aInfo;
  varying vec2 vUv; varying vec3 vTint; varying vec2 vInfo;
  void main() {
    vUv = uv; vTint = aTint; vInfo = aInfo;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z -= 0.0005 * gl_Position.w;
  }`;
const MARK_FRAG = /* glsl */`
  uniform float uVis, uTime;
  varying vec2 vUv; varying vec3 vTint; varying vec2 vInfo;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  // One cuneiform wedge: a triangular head and a thin shaft.
  float wedge(vec2 q) {
    float shaft = step(abs(q.y), 0.04) * step(-0.04, q.x) * step(q.x, 0.34);
    float head = step(abs(q.y), (q.x + 0.3) * 0.34) * step(-0.3, q.x) * step(q.x, -0.04);
    return max(shaft, head);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float seed = vInfo.x * 17.0;
    float n = vn(p * 3.2 + seed) * 0.65 + vn(p * 8.5 + seed * 2.0) * 0.35;
    float edge = 0.9 - 0.3 * n;
    float blot = smoothstep(edge, edge - 0.4, r);
    float char = blot * (0.5 + 0.5 * n);
    // glyph lattice: clusters of wedges in the middle of the scorch
    vec2 g = p * 2.3 + vec2(seed, seed * 1.7);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float hh = h21(cell + seed);
    float ang = floor(h21(cell * 1.7 + 3.0) * 4.0) * 0.7853982;
    float w1 = wedge(rot(ang) * (f - vec2(-0.08, 0.15)));
    float w2 = wedge(rot(ang + 1.5708) * (f - vec2(0.06, -0.17))) * step(0.55, hh);
    float inner = smoothstep(0.78, 0.5, r + (n - 0.5) * 0.25);
    float gl = max(w1, w2) * step(0.34, hh) * inner;
    float pulse = 0.82 + 0.18 * sin(uTime * 2.2 + seed * 6.0);
    float flare = vInfo.y;
    float ringR = 0.12 + 0.86 * (1.0 - flare);
    float ring = smoothstep(0.1, 0.0, abs(r - ringR)) * flare * smoothstep(1.0, 0.7, r);
    float vis = uVis;
    vec3 glow = vTint * (gl * (0.16 + 2.4 * vis * pulse) + char * vis * 0.12 + ring * 2.6 + flare * gl * 3.2);
    float a = char * (0.5 - 0.2 * vis) + gl * 0.2 * (1.0 - vis);
    if (a + max(glow.r, max(glow.g, glow.b)) < 0.004) discard;
    gl_FragColor = vec4(glow, a);
  }`;

const MARK_MAX = 96;

class MarkDecals {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(MARK_MAX * 3), 3);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(MARK_MAX * 2), 2);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    this.info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aInfo', this.info);
    this.uniforms = { uVis: { value: 0 }, uTime: U.time };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, ...PREMULT,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MARK_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'gidim-marks';
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  add(x, y, z, size, tintHex, seed, flare) {
    if (this.n >= MARK_MAX) return;
    const i = this.n++;
    _e.set(0, seed * TAU, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(size, 1, size));
    this.mesh.setMatrixAt(i, _m);
    _c.set(tintHex);
    this.tint.setXYZ(i, _c.r, _c.g, _c.b);
    this.info.setXY(i, seed, flare);
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.info.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Chains: the visible ghost chain that binds a Chained gidim to its mark.
// ---------------------------------------------------------------------------------------------
const LINK_MAX = 220;

class ChainLinks {
  constructor(scene) {
    const geo = new THREE.TorusGeometry(0.12, 0.032, 5, 8);
    geo.scale(1, 1.5, 1);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, LINK_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.name = 'gidim-chains';
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  // A sagging chain of links from (ax, ay, az) to (bx, by, bz); slack 0 = taut.
  chain(ax, ay, az, bx, by, bz, slack, time) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const links = Math.max(3, Math.min(14, Math.ceil(len / 0.5)));
    _dir.set(bx - ax, by - ay, bz - az).normalize();
    _q.setFromUnitVectors(_up, _dir);
    for (let i = 0; i <= links; i++) {
      if (this.n >= LINK_MAX) return;
      const s = i / links;
      const sag = Math.sin(Math.PI * s) * (0.12 + 0.5 * slack) + Math.sin(time * 3 + s * 7) * 0.03;
      _p.set(ax + (bx - ax) * s, ay + (by - ay) * s - sag, az + (bz - az) * s);
      _qa.setFromAxisAngle(_dir, (i & 1) * Math.PI * 0.5);
      _m.compose(_p, _qa.multiply(_q), _s.setScalar(1));
      this.mesh.setMatrixAt(this.n++, _m);
    }
  }

  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
}

// ---------------------------------------------------------------------------------------------
export class GidimFx {
  constructor(g) {
    this.g = g;
    this.decals = new MarkDecals(g.scene);
    this.chains = new ChainLinks(g.scene);
    this.rises = []; // flaring rings where a mark is rising: { x, z, t, dur, tint, seed }
    this.dirty = true;
    this.t = 0;
    this.visSmooth = 0;
  }

  setDirty() { this.dirty = true; }

  surface(x, z) { return (this.g.surface ?? this.g.world.heightAt)(x, z); }

  // Per frame: marks brighten through dusk and night; chains and anchors follow the gidim.
  update(dt, { marks, active, enabled }) {
    const g = this.g, tod = g.world.tod;
    this.t += dt;
    const D = this.decals;
    const target = enabled && !g.inDungeon ? clamp01(Math.max(tod.dusk * 0.85, tod.night)) : 0;
    this.visSmooth += (target - this.visSmooth) * Math.min(1, dt * 2);
    D.uniforms.uVis.value = this.visSmooth;
    for (let i = this.rises.length - 1; i >= 0; i--) {
      this.rises[i].t += dt;
      if (this.rises[i].t >= this.rises[i].dur) { this.rises.splice(i, 1); this.dirty = true; }
    }
    const hasChain = active.some((e) => e.alive && e.gidim.chain);
    if (this.dirty || this.rises.length || hasChain) {
      this.dirty = false;
      D.begin();
      if (enabled && !g.inDungeon) {
        for (const m of marks) D.add(m.x, this.surface(m.x, m.z) + 0.08, m.z, m.lord ? 4.2 : 3.2, VARIANTS[m.variant].tint, (m.id * 0.6180339) % 1, 0);
        for (const r of this.rises) D.add(r.x, this.surface(r.x, r.z) + 0.09, r.z, r.lord ? 5.2 : 4.0, r.tint, r.seed, clamp01(1 - r.t / r.dur));
        // The mark under a chained gidim stays lit while its chain holds.
        for (const e of active) if (e.alive && e.gidim.chain) D.add(e.gidim.chain.ax, this.surface(e.gidim.chain.ax, e.gidim.chain.az) + 0.09, e.gidim.chain.az, 3.2, VARIANTS.chained.tint, (e.id * 0.37) % 1, 0.35);
      }
      D.end();
    }
    const C = this.chains;
    C.begin();
    for (const e of active) {
      const ch = e.alive && e.gidim.chain;
      if (!ch || e.spawning > 0) continue;
      const ay = this.surface(ch.ax, ch.az) + 0.25;
      const d = Math.hypot(e.pos.x - ch.ax, e.pos.z - ch.az);
      const slack = clamp01(1 - d / ch.len);
      C.chain(ch.ax, ay, ch.az, e.pos.x, e.pos.y + 1.0, e.pos.z, slack, this.t);
    }
    C.end();
  }

  // A mark begins to rise: ring flare on the ground, ghost motes spiralling up, a soft shockwave.
  rise(mark, y) {
    const g = this.g;
    this.rises.push({ x: mark.x, z: mark.z, t: 0, dur: mark.lord ? 2.4 : 1.6, tint: VARIANTS[mark.variant].tint, seed: (mark.id * 0.6180339) % 1, lord: mark.lord });
    this.dirty = true;
    const pos = _p.set(mark.x, y, mark.z);
    g.fx.burst(pos, 0x9ff3ff, mark.lord ? 40 : 18, mark.lord ? 4 : 2.2, { up: 5, life: 1.3, gravity: -3, spread: 4 });
    const L = g.fx.ps.add;
    if (g.fx.ps.n(1) > 0) {
      const t = L.begin(F.GLOW_RING);
      t.x = mark.x; t.y = 0.08; t.z = mark.z; t.mode = 1; t.s0 = 0.6; t.s1 = mark.lord ? 7 : 4.4; t.life = 1.1; t.a = 0.9; t.fin = 0.05;
      col0(t, 0x8ff6ff, 1.4); col1(t, 0x2a6a8a, 0.8);
      L.emit();
    }
    g.renderer.shockwave(_p.clone(), mark.lord ? 0.02 : 0.01, mark.lord ? 6 : 4, 0.7);
    if (mark.lord) g.renderer.pulse(0x7fe8f0, 0.12);
  }

  // A gidim breaks: glassy shards and a flash of cold light.
  death(pos, lord) {
    const g = this.g;
    const p = _p.set(pos.x, pos.y + 1, pos.z);
    g.fx.burst(p, 0xbff8ff, lord ? 46 : 24, lord ? 7 : 5.5, { up: 4, life: 0.9, gravity: 6, spread: 3 });
    g.fx.burst(p, 0x6fe0f0, lord ? 22 : 10, 2.5, { up: 6, life: 1.2, gravity: -2 });
    g.renderer.shockwave(p.clone(), lord ? 0.022 : 0.012, lord ? 7 : 4, 0.5);
  }

  // A gidim reaches the edge of a sanctuary and shrinks back with a hiss.
  recoil(pos, kind) {
    const g = this.g;
    const p = _p.set(pos.x, pos.y + 1.1, pos.z);
    g.fx.burst(p, 0xc8fbff, 14, 3.2, { up: 1.5, life: 0.6, gravity: 0, spread: 3 });
    const L = g.fx.ps.add;
    if (g.fx.ps.n(1) > 0) {
      const t = L.begin(F.GLOW_RING);
      t.x = pos.x; t.y = 0.08; t.z = pos.z; t.mode = 1; t.s0 = 0.5; t.s1 = kind === 'town' ? 3.2 : 2.4; t.life = 0.5; t.a = 0.7;
      col0(t, 0xffe6a8, 1.2); col1(t, 0x7fe8f0, 0.6);
      L.emit();
    }
  }

  // The ward flares where a gidim crosses the Tether line.
  ward(pos) {
    const p = _p.set(pos.x, pos.y + 1.0, pos.z);
    this.g.fx.burst(p, 0xfff0b8, 10, 4.5, { up: 2, life: 0.4, gravity: 0 });
  }

  // Ghost-fire: cold flames licking up from one trail patch.
  flames(p, dt) {
    const g = this.g;
    const k = Math.min(1, p.life / p.max * 2.5);
    const L = g.fx.ps.add;
    p.acc += dt * 8 * k;
    const gy = this.surface(p.x, p.z);
    while (p.acc >= 1) {
      p.acc -= 1;
      if (g.fx.ps.n(1) < 1) continue;
      const t = L.begin(F.FLAME);
      const a = Math.random() * TAU, r = Math.random() * 0.6;
      t.x = p.x + Math.cos(a) * r; t.y = gy + 0.15; t.z = p.z + Math.sin(a) * r;
      t.vy = 1.2 + Math.random() * 1.8; t.vx = (Math.random() - 0.5) * 0.4; t.vz = (Math.random() - 0.5) * 0.4;
      t.life = 0.45 + Math.random() * 0.35;
      t.s0 = (0.8 + Math.random() * 0.7) * (0.7 + 0.3 * k); t.s1 = t.s0 * 0.35;
      t.fp = 1.2; t.rot = (Math.random() - 0.5) * 0.4;
      t.r0 = 0.35; t.g0 = 1.1; t.b0 = 1.2; t.r1 = 0.05; t.g1 = 0.35; t.b1 = 0.6;
      L.emit();
    }
    p.glow -= dt;
    if (p.glow <= 0) {
      p.glow = 0.14;
      if (g.fx.ps.n(1) > 0) {
        const t = L.begin(F.DOT);
        t.x = p.x; t.y = 0.08; t.z = p.z; t.mode = 1; t.s0 = t.s1 = 2.2; t.life = 0.22; t.a = 0.4 * k; t.fin = 0.03;
        t.r0 = 0.2; t.g0 = 0.9; t.b0 = 1.0;
        L.emit();
      }
    }
  }

  // The sedu's lantern glow: a soft halo behind the familiar (the light itself is a pooled emitter).
  halo(b, k) {
    const g = this.g, L = g.fx.ps.add;
    if (k < 0.05 || g.fx.ps.n(1) < 1) return;
    const t = L.begin(F.DOT);
    t.x = b.x; t.y = b.y; t.z = b.z; t.s0 = t.s1 = 2.6 + Math.sin(this.t * 3) * 0.2; t.life = 0.16; t.a = 0.34 * k; t.fin = 0.02;
    t.r0 = 1.6; t.g0 = 1.2; t.b0 = 0.6;
    L.emit();
  }

  dispose() {
    const s = this.g.scene;
    s.remove(this.decals.mesh);
    s.remove(this.chains.mesh);
  }
}

