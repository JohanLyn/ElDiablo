import * as THREE from 'three';
import { U } from './shared.js';

// Enemy attack telegraphs: procedural zone / cone / lane shaders. A bright
// rim marks the danger area, a fill front sweeps from the origin out to the
// rim (the strike lands when it arrives), and a pattern per attack family
// (violet sigils, cracked ground, golden seals, lightning, molten rock).
export const TELE_STYLES = {
  void: { kind: 1, col: 0xb04dff, hot: 0xe6b8ff, dark: 0x16052a },
  crack: { kind: 2, col: 0xff4a18, hot: 0xff9a50, dark: 0x1c0604 },
  seal: { kind: 3, col: 0xffb62a, hot: 0xffe08a, dark: 0x241a04 },
  storm: { kind: 4, col: 0x4fb4ff, hot: 0xcfeaff, dark: 0x041428 },
  molten: { kind: 5, col: 0xff5a10, hot: 0xffc060, dark: 0x240a02 },
  fire: { kind: 0, col: 0xff3a2a, hot: 0xff8a5a, dark: 0x240606 },
  poison: { kind: 0, col: 0x9aff3a, hot: 0xeaffb0, dark: 0x0a2004 },
};

// Which style a hazard's gameplay colour maps to.
export function styleForColor(color) {
  switch (color) {
    case 0xb04dff: case 0x9a6bff: return 'void';
    case 0xff3a2a: return 'crack';
    case 0xd6a740: return 'seal';
    case 0x8fd3ff: return 'storm';
    case 0xff6a1a: return 'molten';
    default: return 'fire';
  }
}

const VERT = /* glsl */`
  uniform float uH[25];
  uniform float uConform;
  varying vec2 vP;
  void main() {
    vec2 p = position.xz;
    vP = p;
    float h = 0.0;
    if (uConform > 0.5) {
      vec2 g = clamp((p * 0.5 + 0.5) * 4.0, 0.0, 3.999);
      ivec2 i0 = ivec2(floor(g));
      vec2 f = fract(g);
      int b = i0.y * 5 + i0.x;
      h = mix(mix(uH[b], uH[b + 1], f.x), mix(uH[b + 5], uH[b + 6], f.x), f.y);
    }
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.x, h + 0.1, position.z, 1.0);
    gl_Position.z -= 0.0004 * gl_Position.w;
  }`;

const FRAG = /* glsl */`
  uniform float uShape, uKind, uT, uTime, uScale, uLen, uHalf, uSeed;
  uniform vec3 uColor, uHot, uDark;
  varying vec2 vP;
  const float PI = 3.14159265;
  const float TAU = 6.2831853;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  vec2 voronoi(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(ip + g);
      float d = length(g + o - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return vec2(f1, f2);
  }
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  float line(float d, float w) { return smoothstep(w, w * 0.25, d); }
  float ringL(float r, float R, float w) { return line(abs(r - R), w); }

  // Pattern per attack family, p in zone space (|p| <= 1). Returns 0..1+.
  float pattern(vec2 p, float r, float fill) {
    float P = 0.0;
    if (uKind < 0.5) {
      float a = atan(p.x, p.y);
      P = ringL(r, 0.55, 0.018) * 0.7 + ringL(r, 0.28, 0.015) * 0.5;
      P += line(abs(fract(a * 8.0 / TAU + uTime * 0.05) - 0.5) * TAU / 8.0 * r, 0.02) * smoothstep(0.3, 0.5, r) * smoothstep(0.9, 0.7, r) * 0.6;
    } else if (uKind < 1.5) {
      // Violet sigils: rune ring + counter-rotating hexagram.
      float a = atan(p.x, p.y) + uTime * 0.25;
      float N = 14.0;
      float cell = floor(a / TAU * N);
      float cu = fract(a / TAU * N) - 0.5;
      float cr = (r - 0.8) / 0.12;
      float h1 = hash(vec2(cell, uSeed)), h2 = hash(vec2(cell + 7.0, uSeed));
      float arcW = TAU / N * r;
      float s1 = line(abs(cu - (h1 - 0.5) * 0.5) * arcW, 0.016) * step(abs(cr), 0.85);
      float s2 = line(abs(cr - (h2 - 0.5) * 1.1) * 0.12, 0.014) * step(abs(cu), 0.33);
      float wedge = line(length(vec2((cu - (h1 - 0.5) * 0.5) * arcW, (cr - 0.8) * 0.12)), 0.03) * step(0.5, h2);
      P += (s1 + s2 + wedge) * step(0.7, r) * step(r, 0.93);
      P += ringL(r, 0.95, 0.016) + ringL(r, 0.69, 0.012) * 0.8 + ringL(r, 0.22, 0.014);
      float hx = 0.0;
      for (int k = 0; k < 2; k++) {
        float off = float(k) * PI / 3.0 + (k == 0 ? uTime * 0.35 : -uTime * 0.35);
        vec2 v0 = vec2(sin(off), cos(off)) * 0.62, v1 = vec2(sin(off + TAU / 3.0), cos(off + TAU / 3.0)) * 0.62, v2 = vec2(sin(off + 2.0 * TAU / 3.0), cos(off + 2.0 * TAU / 3.0)) * 0.62;
        hx = max(hx, line(min(seg(p, v0, v1), min(seg(p, v1, v2), seg(p, v2, v0))), 0.016));
      }
      P += hx * 0.9;
      P += line(r, 0.05) * 0.8;
    } else if (uKind < 2.5) {
      // Cracked ground: glowing fissures radiating from the centre, lighting up outward.
      float a = atan(p.x, p.y);
      float lit = smoothstep(fill + 0.15, fill - 0.05, r);
      float cr = 0.0;
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float base = hash(vec2(fi, uSeed)) * TAU;
        float wob = (noise(vec2(r * 5.0 + fi * 7.1, fi)) - 0.5) * 1.1 * r;
        float da = abs(mod(a - base - wob + PI, TAU) - PI);
        float width = mix(0.05, 0.012, r);
        float reach = 0.35 + hash(vec2(fi, 3.0)) * 0.7;
        cr = max(cr, smoothstep(width, 0.0, da * r) * (1.0 - smoothstep(reach - 0.1, reach, r)));
      }
      vec2 vo = voronoi(p * 4.0 + uSeed);
      float hair = smoothstep(0.07, 0.0, vo.y - vo.x) * 0.3;
      P = (cr * 1.1 + hair) * (0.35 + 0.65 * lit) * (0.85 + 0.15 * sin(uTime * 8.0 + r * 10.0)) + smoothstep(0.3, 0.0, r) * lit * 0.7;
    } else if (uKind < 3.5) {
      // Golden seal: heptagram, rings, ticks.
      float spin = uTime * 0.3;
      vec2 q = rot(spin) * p;
      float hp = 0.0;
      for (int i = 0; i < 7; i++) {
        float a0 = float(i) / 7.0 * TAU, a1 = float((i + 2) - ((i + 2) / 7) * 7) / 7.0 * TAU;
        hp = max(hp, line(seg(q, vec2(sin(a0), cos(a0)) * 0.7, vec2(sin(a1), cos(a1)) * 0.7), 0.017));
        hp = max(hp, line(length(q - vec2(sin(a0), cos(a0)) * 0.7), 0.06) * 0.95);
      }
      float a = atan(q.x, q.y);
      float tick = line(abs(fract(a * 28.0 / TAU) - 0.5) * TAU / 28.0 * r, 0.012) * step(0.8, r) * step(r, 0.9);
      P = hp + ringL(r, 0.95, 0.014) + ringL(r, 0.78, 0.012) * 0.9 + ringL(r, 0.7, 0.01) * 0.5 + ringL(r, 0.2, 0.014) + tick * 0.8;
      P += line(seg(rot(-spin * 1.7) * p, vec2(0.0, -0.12), vec2(0.0, 0.12)), 0.02) * 1.2 + line(seg(rot(-spin * 1.7) * p, vec2(-0.12, 0.0), vec2(0.12, 0.0)), 0.02) * 1.2;
    } else if (uKind < 4.5) {
      // Lightning sigil: jittering radial bolts + dashed rings.
      float tq = floor(uTime * 9.0);
      float a = atan(p.x, p.y);
      float j = (noise(vec2(r * 9.0, tq + uSeed)) - 0.5) * 0.7 * r;
      float bolts = line(abs(fract((a + j) * 6.0 / TAU) - 0.5) * TAU / 6.0 * r, 0.022) * step(0.1, r) * step(r, 0.92);
      float dash = step(0.5, fract(a * 20.0 / TAU + uTime * 0.6));
      P = bolts * (0.6 + 0.4 * noise(vec2(a * 5.0, tq))) + ringL(r, 0.95, 0.016) + ringL(r, 0.6, 0.012) * dash + ringL(r, 0.3, 0.014) * (1.0 - dash);
      P += smoothstep(0.2, 0.0, r) * (0.5 + 0.5 * noise(vec2(tq, 3.0)));
    } else {
      // Molten: lava veins and bubbling cells.
      vec2 q = p * 2.6 + vec2(uSeed * 5.0, uTime * 0.12);
      vec2 vo = voronoi(q);
      float vein = smoothstep(0.26, 0.0, vo.y - vo.x);
      float bub = smoothstep(0.33, 0.0, vo.x) * (0.5 + 0.5 * sin(uTime * 5.0 + hash(floor(q)) * 30.0));
      P = vein * 0.95 + bub * 0.35 + ringL(r, 0.96, 0.02);
    }
    return P;
  }

  void main() {
    vec2 p = vP;
    float inside, r, edgePhys, f, extentPhys;
    if (uShape < 0.5) {            // zone
      r = length(p); inside = 1.0 - smoothstep(0.985, 1.0, r);
      edgePhys = (1.0 - r) * uScale; f = r; extentPhys = uScale;
    } else if (uShape < 1.5) {     // cone
      r = length(p);
      float ang = atan(p.x, p.y);
      float sideD = (uHalf - abs(ang)) * r * uScale;
      inside = step(r, 1.0) * step(abs(ang), uHalf);
      edgePhys = min((1.0 - r) * uScale, sideD); f = r; extentPhys = uScale;
    } else {                       // lane: x in [-1,1], y = along 0..1
      r = length(p * vec2(1.0, 0.5));
      float ex = (1.0 - abs(p.x)) * uScale, ez = (1.0 - p.y) * uLen;
      inside = 1.0;
      edgePhys = min(ex, ez); f = p.y; extentPhys = uLen;
    }
    if (inside < 0.01) discard;

    float t = clamp(uT, 0.0, 1.0);
    float strike = smoothstep(0.82, 1.0, t);
    float filled = 1.0 - smoothstep(-0.02, 0.02, f - t);       // inside the charged region
    float frontD = abs(f - t) * extentPhys;
    float front = exp(-frontD * 5.0) * (1.0 - strike * 0.3) * step(0.01, t);

    float rimW = 0.1 + 0.05 * t;
    float rim = smoothstep(rimW, 0.0, edgePhys);
    float rimGlow = smoothstep(0.55, 0.0, edgePhys) * 0.25;
    float pulse = 0.82 + 0.18 * sin(uTime * (7.0 + t * 14.0));

    float pat = 0.0;
    if (uShape < 1.5) {
      vec2 pz = p; float rz = r;
      if (uShape > 0.5) { pz = p * 1.0; }
      pat = pattern(pz, rz, t);
    } else {
      // Lane: moving chevrons.
      float chev = fract((p.y * uLen * 0.9 - abs(p.x) * uScale * 0.9) * 0.5 - uTime * 1.2 - t);
      pat = smoothstep(0.55, 0.62, chev) * smoothstep(0.78, 0.7, chev) * 0.9;
    }

    float patW = 0.22 + 0.55 * filled + 0.25 * t;
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    // Dark underlay for contrast on bright ground.
    float under = 0.30 + 0.22 * filled;
    col += uDark * under; alpha += under;
    // Tinted fill.
    float tint = (0.09 + 0.2 * filled) ;
    col += uColor * tint * 1.4; alpha += tint;
    // Pattern.
    float pv = pat * patW;
    col += mix(uColor, uHot, 0.2 + 0.4 * t) * pv * 1.15; alpha += pv * 0.9;
    // Rim and front.
    float rv = (rim * (0.7 + 0.8 * t) + rimGlow) * pulse;
    col += mix(uColor, uHot, 0.2 + 0.4 * t) * rv * 1.35; alpha += rv * 0.95;
    float fv = front * 0.9;
    col += uHot * fv * 0.9; alpha += fv * 0.7;
    // Strike flash.
    float fl = strike * strike;
    col += uHot * fl * 0.35 * (0.4 + rim); alpha += fl * 0.2;
    alpha = clamp(alpha, 0.0, 1.0) * inside;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col / max(alpha, 0.001) * inside, alpha);
  }`;

let zoneGeo = null, coneGeo = null, laneGeo = null;
function geometries() {
  if (zoneGeo) return;
  zoneGeo = new THREE.PlaneGeometry(2, 2, 16, 16);
  zoneGeo.rotateX(-Math.PI / 2);
  // Cone: fan of triangles around +Z, half angle 0.9 rad, radius 1.
  const half = 0.9, seg = 24, pos = [0, 0, 0], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -half + (i / seg) * half * 2;
    pos.push(Math.sin(a), 0, Math.cos(a));
    if (i > 0) idx.push(0, i, i + 1);
  }
  coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  coneGeo.setIndex(idx);
  laneGeo = new THREE.PlaneGeometry(2, 1);
  laneGeo.rotateX(-Math.PI / 2);
  laneGeo.translate(0, 0, 0.5);
}

export class Telegraphs {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    geometries();
    this.seed = 0;
  }

  _make(shape) {
    const geo = shape === 0 ? zoneGeo : shape === 1 ? coneGeo : laneGeo;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uH: { value: new Float32Array(25) }, uConform: { value: 0 },
        uShape: { value: shape }, uKind: { value: 0 }, uT: { value: 0 }, uTime: U.time, uScale: { value: 1 }, uLen: { value: 1 }, uHalf: { value: 0.9 }, uSeed: { value: 0 },
        uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uDark: { value: new THREE.Color() },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.userData.shape = shape;
    this.pool.push(mesh);
    return mesh;
  }

  // Reuse a mesh that was removed from the scene (by anybody), else make one.
  _acquire(shape, style) {
    let mesh = null;
    for (const m of this.pool) if (m.userData.shape === shape && !m.parent) { mesh = m; break; }
    if (!mesh) mesh = this._make(shape);
    const u = mesh.material.uniforms;
    const s = TELE_STYLES[style] ?? TELE_STYLES.fire;
    u.uKind.value = s.kind; u.uColor.value.set(s.col); u.uHot.value.set(s.hot); u.uDark.value.set(s.dark);
    u.uT.value = 0; u.uConform.value = 0; u.uSeed.value = (this.seed++ % 17) * 0.37;
    mesh.visible = true;
    this.scene.add(mesh);
    return mesh;
  }

  zone(x, z, r, style) {
    const m = this._acquire(0, style);
    m.position.set(x, 0, z);
    m.scale.set(r, 1, r);
    m.material.uniforms.uScale.value = r;
    return m;
  }

  // Fit a zone to the terrain (9 height samples, biquadratic in the shader).
  conform(m, x, z, r, heightAt) {
    const H = m.material.uniforms.uH.value;
    for (let iz = 0; iz < 5; iz++) for (let ix = 0; ix < 5; ix++) H[iz * 5 + ix] = heightAt(x + (ix - 2) * r * 0.5, z + (iz - 2) * r * 0.5);
    m.material.uniforms.uConform.value = 1;
  }

  cone(style = 'fire') { return this._acquire(1, style); }
  lane(style = 'poison') { return this._acquire(2, style); }

  setProgress(m, k) { m.material.uniforms.uT.value = k; }
}

const registry = new WeakMap();
// One shared Telegraphs per scene (enemy code has no access to the game context).
export function getTelegraphs(scene) {
  let t = registry.get(scene);
  if (!t) { t = new Telegraphs(scene); registry.set(scene, t); }
  return t;
}
