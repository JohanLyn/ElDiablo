import * as THREE from 'three';
import { U, PREMULT } from './shared.js';
import { buildRuneStrip } from './atlas.js';

// ---------------------------------------------------------------------------
// Light pillars / loot beams: open cylinder with soft fresnel edges, scrolling
// energy stripes and a hot base. Material per colour/intensity, geometry shared.
// ---------------------------------------------------------------------------
const PILLAR_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying float vY; varying float vAng;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    vY = position.y;
    vAng = atan(position.x, position.z);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const PILLAR_FRAG = /* glsl */`
  uniform vec3 uColor, uHot;
  uniform float uInt, uTime, uSpin;
  varying vec3 vN; varying vec3 vV; varying float vY; varying float vAng;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float edge = pow(f, 1.4);
    float top = 1.0 - smoothstep(0.35, 1.0, vY);
    float bottom = smoothstep(0.0, 0.03, vY);
    float stripes = 0.62 + 0.38 * sin(vAng * 5.0 + vY * 9.0 - uTime * 2.6 + uSpin * vY * 7.0) * sin(vAng * 3.0 - vY * 4.0 + uTime * 1.7);
    float base = pow(1.0 - vY, 3.0) * 1.2;
    float a = edge * top * bottom * (stripes * 0.75 + base) * uInt;
    vec3 col = mix(uColor, uHot, clamp(base * 0.5 + edge * edge * 0.35, 0.0, 1.0));
    gl_FragColor = vec4(col * a, a * 0.4);
  }`;

let pillarGeo = null;
export function pillarGeometry() {
  if (!pillarGeo) { pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); pillarGeo.translate(0, 0.5, 0); }
  return pillarGeo;
}

export function makePillarMaterial(color, hot, intensity = 1, spin = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color(hot) }, uInt: { value: intensity }, uTime: U.time, uSpin: { value: spin } },
    vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG,
    transparent: true, depthWrite: false, ...PREMULT, side: THREE.DoubleSide,
  });
}

// Mesh sized (radius, height); origin at the base.
export function makePillar(material, radius, height) {
  const m = new THREE.Mesh(pillarGeometry(), material);
  m.scale.set(radius, height, radius);
  m.frustumCulled = false;
  m.renderOrder = 6;
  return m;
}

// ---------------------------------------------------------------------------
// Aegis barrier: triplanar hex lattice + fresnel rim + shimmer, drains with life.
// ---------------------------------------------------------------------------
const BARRIER_VERT = /* glsl */`
  varying vec3 vObj; varying vec3 vN; varying vec3 vV;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const BARRIER_FRAG = /* glsl */`
  uniform float uI, uFrac, uHit, uTime;
  uniform vec3 uColor, uHot;
  varying vec3 vObj; varying vec3 vN; varying vec3 vV;
  const vec2 S = vec2(1.7320508, 1.0);
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hexD(vec2 p) { p = abs(p); return max(dot(p, S * 0.5), p.y); }
  // xy: edge line 0..1, z: cell hash
  vec3 hex(vec2 p) {
    vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / S.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * S, p - (hC.zw + 0.5) * S);
    bool first = dot(h.xy, h.xy) < dot(h.zw, h.zw);
    vec2 q = first ? h.xy : h.zw;
    vec2 id = first ? hC.xy : hC.zw + 9.73;
    float e = 0.5 - hexD(q);
    return vec3(smoothstep(0.075, 0.0, e), smoothstep(0.0, 0.2, e), hash(id));
  }
  void main() {
    vec3 n = normalize(vObj);
    vec3 w = pow(abs(n), vec3(6.0));
    w /= (w.x + w.y + w.z);
    float sc = 2.6;
    vec3 a = hex(vObj.yz * sc), b = hex(vObj.xz * sc), c = hex(vObj.xy * sc);
    float line = a.x * w.x + b.x * w.y + c.x * w.z;
    float cellH = a.z * w.x + b.z * w.y + c.z * w.z;
    float inner = a.y * w.x + b.y * w.y + c.y * w.z;
    // Cells wink out as the barrier drains.
    float alive = smoothstep(cellH - 0.12, cellH + 0.02, uFrac * 1.15);
    float flick = step(0.82, fract(cellH * 7.0 + floor(uTime * 3.0) * 0.37)) * 0.45;
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
    float scan = exp(-pow((vObj.y / 1.2) - sin(uTime * 1.6) * 0.95, 2.0) * 14.0);
    float v = (line * 0.95 + inner * (0.07 + flick) + rim * 1.15 + scan * 0.35) * alive + rim * 0.25;
    v += uHit * (0.5 + rim * 1.5);
    float alpha = clamp(v, 0.0, 1.0) * uI;
    gl_FragColor = vec4(mix(uColor, uHot, clamp(line * 0.6 + rim * 0.5 + uHit, 0.0, 1.0)) * (1.0 + line) * alpha, alpha * 0.4);
  }`;

export function makeBarrierMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uI: { value: 0 }, uFrac: { value: 1 }, uHit: { value: 0 }, uTime: U.time,
      uColor: { value: new THREE.Color(0xffb43a) }, uHot: { value: new THREE.Color(0xfff0b0) },
    },
    vertexShader: BARRIER_VERT, fragmentShader: BARRIER_FRAG,
    transparent: true, depthWrite: false, ...PREMULT,
  });
}

// ---------------------------------------------------------------------------
// Tether energy beam: camera-facing ribbon with a sinuous wobble, hot core,
// soft glow, scrolling cuneiform runes and a surge bead for Snap. Plus a fan
// mesh that renders the swept area as an afterimage when the line is whipped.
// ---------------------------------------------------------------------------
const BEAM_VERT = /* glsl */`
  uniform vec3 uA, uB;
  uniform float uWidth, uAmp, uTime;
  varying vec2 vUv;
  void main() {
    float u = uv.x;
    vec3 p = mix(uA, uB, u);
    vec3 axis = uB - uA;
    vec3 side = normalize(cross(axis, cameraPosition - p) + vec3(1e-5));
    float env = sin(3.14159 * u);
    float wob = sin(u * 17.0 - uTime * 13.0) * 0.55 + sin(u * 6.0 + uTime * 8.0) * 0.45;
    float vv = uv.y * 2.0 - 1.0;
    float w = uWidth * (0.5 + 0.5 * env);
    p += side * (vv * w + wob * uAmp * env);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const BEAM_FRAG = /* glsl */`
  uniform sampler2D uRunes;
  uniform vec3 uColor, uHot;
  uniform float uLen, uTime, uInt, uSurge, uRune;
  varying vec2 vUv;
  void main() {
    float vv = vUv.y * 2.0 - 1.0;
    float p = 1.0 - abs(vv);
    float core = pow(p, 7.0);
    float glow = pow(p, 1.7);
    float flow = 0.7 + 0.3 * sin(vUv.x * uLen * 3.2 - uTime * 18.0 + vv * 4.0) * sin(vUv.x * uLen * 1.3 + uTime * 7.0);
    vec2 ruv = vec2(vUv.x * uLen * 0.55 - uTime * 0.9, vv * 0.62 + 0.5);
    float rune = texture2D(uRunes, ruv).a * smoothstep(1.0, 0.35, abs(vv)) * uRune;
    float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
    float bead = exp(-pow((vUv.x - uSurge) * 9.0, 2.0)) * step(0.0, uSurge) * (0.35 + p);
    float a = (core * 1.4 + glow * 0.55 * flow + rune * 0.85 * glow + bead * 1.6) * ends * uInt;
    vec3 col = mix(uColor, uHot, clamp(core + bead * 0.8 + rune * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(col * a, a * 0.45);
  }`;

const FAN_N = 9;
const FAN_VERT = /* glsl */`
  attribute float aAge;
  uniform float uGain;
  varying float vA; varying float vX;
  void main() {
    vA = aAge * uGain;
    vX = uv.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }`;
const FAN_FRAG = /* glsl */`
  uniform vec3 uColor, uHot;
  varying float vA; varying float vX;
  void main() {
    float a = vA * pow(vX, 1.4);
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uColor, uHot, vX * vX * 0.6) * a, a * 0.45);
  }`;

export class TetherBeam {
  constructor(scene) {
    this.A = new THREE.Vector3(); this.B = new THREE.Vector3();
    this.surge = -1;
    const geo = new THREE.PlaneGeometry(1, 1, 48, 1);
    const runes = buildRuneStrip();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: this.A }, uB: { value: this.B }, uWidth: { value: 0.3 }, uAmp: { value: 0.06 }, uTime: U.time,
        uRunes: { value: runes }, uColor: { value: new THREE.Color(0x5d95ff) }, uHot: { value: new THREE.Color(0xdde9ff) },
        uLen: { value: 6 }, uInt: { value: 1 }, uSurge: { value: -1 }, uRune: { value: 1 },
      },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false,
      ...PREMULT, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);

    // Sweep afterimage fan.
    this.hist = new Float32Array(FAN_N * 6);
    this.histAge = new Float32Array(FAN_N);
    this.histT = 0;
    const fgeo = new THREE.BufferGeometry();
    this.fPos = new Float32Array(FAN_N * 2 * 3);
    this.fAge = new Float32Array(FAN_N * 2);
    const fuv = new Float32Array(FAN_N * 2 * 2);
    const idx = [];
    for (let i = 0; i < FAN_N; i++) {
      fuv[i * 4] = 0; fuv[i * 4 + 1] = 0; fuv[i * 4 + 2] = 1; fuv[i * 4 + 3] = 0;
      if (i < FAN_N - 1) { const v = i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
    fgeo.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setAttribute('aAge', new THREE.BufferAttribute(this.fAge, 1).setUsage(THREE.DynamicDrawUsage));
    fgeo.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    fgeo.setIndex(idx);
    this.fan = new THREE.Mesh(fgeo, new THREE.ShaderMaterial({
      uniforms: { uColor: this.mat.uniforms.uColor, uHot: this.mat.uniforms.uHot, uGain: { value: 0 } },
      vertexShader: FAN_VERT, fragmentShader: FAN_FRAG, transparent: true, depthWrite: false,
      ...PREMULT, side: THREE.DoubleSide,
    }));
    this.fan.frustumCulled = false;
    this.fan.renderOrder = 8;
    scene.add(this.fan);
  }

  setColor(hex) {
    const u = this.mat.uniforms;
    u.uColor.value.set(hex);
    u.uHot.value.set(hex).lerp(new THREE.Color(0xffffff), 0.7);
  }

  // surge position 0..1 (<0 = off)
  setSurge(v) { this.surge = v; }

  update(dt, A, B, { show, live, sweep, flare, thick }) {
    this.mesh.visible = show;
    if (!show) { this.fan.visible = false; return; }
    this.A.copy(A); this.B.copy(B);
    const u = this.mat.uniforms;
    u.uLen.value = A.distanceTo(B);
    u.uWidth.value = (0.2 + sweep * 0.12 + flare * 0.2) * thick * (live ? 1 : 0.4);
    u.uAmp.value = live ? 0.05 + sweep * 0.08 + flare * 0.1 : 0.015;
    u.uInt.value = (live ? 1.0 : 0.38) + sweep * 0.35 + flare * 0.5;
    u.uRune.value = live ? 1 : 0.4;
    u.uSurge.value = this.surge;

    // Afterimage fan: only built up while whipping.
    this.histT += dt;
    if (this.histT > 0.018) {
      this.histT = 0;
      this.hist.copyWithin(6, 0, (FAN_N - 1) * 6);
      this.hist[0] = A.x; this.hist[1] = A.y; this.hist[2] = A.z; this.hist[3] = B.x; this.hist[4] = B.y; this.hist[5] = B.z;
    } else {
      this.hist[0] = A.x; this.hist[1] = A.y; this.hist[2] = A.z; this.hist[3] = B.x; this.hist[4] = B.y; this.hist[5] = B.z;
    }
    const gain = Math.max(0, sweep - 0.12) * 1.3;
    this.fan.visible = gain > 0.02 && live;
    if (this.fan.visible) {
      this.fan.material.uniforms.uGain.value = gain;
      for (let i = 0; i < FAN_N; i++) {
        const k = i * 6, v = i * 6; // 2 vertices x 3 per history entry
        this.fPos[v] = this.hist[k]; this.fPos[v + 1] = this.hist[k + 1]; this.fPos[v + 2] = this.hist[k + 2];
        this.fPos[v + 3] = this.hist[k + 3]; this.fPos[v + 4] = this.hist[k + 4]; this.fPos[v + 5] = this.hist[k + 5];
        const age = 1 - i / (FAN_N - 1);
        this.fAge[i * 2] = this.fAge[i * 2 + 1] = age * age * 0.9;
      }
      this.fan.geometry.attributes.position.needsUpdate = true;
      this.fan.geometry.attributes.aAge.needsUpdate = true;
    }
  }
}
