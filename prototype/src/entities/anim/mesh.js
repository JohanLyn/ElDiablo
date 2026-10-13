import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Low-poly "part" builder. Every part becomes a non-indexed geometry with the same
// attribute set so a whole bone's worth of parts can be merged into one mesh:
//   position, normal, color (rgba), aGlow (emissive amount), aMat (metal, rough, tint weight)
// Body colours are baked as greys with tint weight 1 so one geometry serves every
// elite/normal variant: the per-enemy material multiplies in its own tint.

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v1 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler();

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Shapes -----------------------------------------------------------------------
export const shapes = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg),
  cone: (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg),
  sphere: (r, ws = 7, hs = 5) => new THREE.SphereGeometry(r, ws, hs),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodeca: (r) => new THREE.DodecahedronGeometry(r, 0),
  octa: (r) => new THREE.OctahedronGeometry(r, 0),
  torus: (r, t, rs = 4, ts = 10, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  plane: (w, h) => new THREE.PlaneGeometry(w, h),
  // Limb: starts at the bone origin and hangs down -Y.
  limb: (rt, rb, len, seg = 6) => new THREE.CylinderGeometry(rt, rb, len, seg).translate(0, -len / 2, 0),
  // Grows up +Y from the origin (horns, spikes, blades).
  spike: (r, len, seg = 5) => new THREE.ConeGeometry(r, len, seg).translate(0, len / 2, 0),
  // Flat feather / tatter: a long tapered quad hanging down -Y from its top edge.
  tatter: (wTop, wBot, len) => {
    const g = new THREE.BufferGeometry();
    const a = wTop / 2, b = wBot / 2;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-a, 0, 0, a, 0, 0, b, -len, 0, -a, 0, 0, b, -len, 0, -b, -len, 0], 3));
    g.computeVertexNormals();
    return g;
  },
  // Triangular fin / blade profile: base on Y=0, tip at +Y, thickness along Z.
  fin: (w, h, t = 0.03) => {
    const hw = w / 2, ht = t / 2;
    const v = [
      -hw, 0, ht, hw, 0, ht, 0, h, 0,
      hw, 0, -ht, -hw, 0, -ht, 0, h, 0,
      -hw, 0, -ht, -hw, 0, ht, 0, h, 0,
      hw, 0, ht, hw, 0, -ht, 0, h, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  },
};

// Core part constructor ----------------------------------------------------------
// o: x,y,z rx,ry,rz sx,sy,sz  glow metal rough tint ao var jit double fade alpha
export function part(geo, color, o = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  _m.compose(_p.set(o.x || 0, o.y || 0, o.z || 0), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0)), _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
  g.applyMatrix4(_m);
  let pos = g.attributes.position.array;
  if (o.jit) {
    for (let i = 0; i < pos.length; i += 3) {
      const x = Math.round(pos[i] * 50), y = Math.round(pos[i + 1] * 50), z = Math.round(pos[i + 2] * 50);
      pos[i] += (hash3(x, y, z) - 0.5) * o.jit;
      pos[i + 1] += (hash3(y, z, x + 3) - 0.5) * o.jit;
      pos[i + 2] += (hash3(z, x, y + 7) - 0.5) * o.jit;
    }
  }
  if (o.double) {
    const n = pos.length;
    const out = new Float32Array(n * 2);
    out.set(pos);
    for (let i = 0; i < n; i += 9) {
      // reverse winding of each triangle (a, c, b)
      out.set([pos[i], pos[i + 1], pos[i + 2], pos[i + 6], pos[i + 7], pos[i + 8], pos[i + 3], pos[i + 4], pos[i + 5]], n + i);
    }
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    pos = out;
  }
  g.deleteAttribute('normal');
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  const count = pos.length / 3;
  const col = new Float32Array(count * 4);
  const glow = new Float32Array(count);
  const mat = new Float32Array(count * 3);
  _c.set(color);
  const ao = o.ao ?? 0.32;
  const vr = o.var ?? 0.12;
  const tintK = o.tint === true ? 1 : o.tint || 0;
  for (let i = 0; i < count; i++) {
    const tri = i - (i % 3);
    const cx = (pos[tri * 3] + pos[tri * 3 + 3] + pos[tri * 3 + 6]) / 3;
    const cy = (pos[tri * 3 + 1] + pos[tri * 3 + 4] + pos[tri * 3 + 7]) / 3;
    const cz = (pos[tri * 3 + 2] + pos[tri * 3 + 5] + pos[tri * 3 + 8]) / 3;
    const ny = nrm[i * 3 + 1];
    const lum = (1 - ao) + ao * (0.5 + 0.5 * ny);
    const v = 1 + (hash3(Math.round(cx * 40), Math.round(cy * 40), Math.round(cz * 40)) - 0.5) * vr;
    let k = lum * v;
    if (o.shade) k *= o.shade[2] + (o.shade[3] - o.shade[2]) * Math.min(1, Math.max(0, (pos[i * 3 + 1] - o.shade[0]) / (o.shade[1] - o.shade[0])));
    col[i * 4] = _c.r * k; col[i * 4 + 1] = _c.g * k; col[i * 4 + 2] = _c.b * k;
    let a = o.alpha ?? 1;
    if (o.fade) a *= o.fade[1] + (o.fade[3] - o.fade[1]) * Math.min(1, Math.max(0, (pos[i * 3 + 1] - o.fade[0]) / (o.fade[2] - o.fade[0])));
    col[i * 4 + 3] = a;
    glow[i] = o.glow || 0;
    mat[i * 3] = o.metal ?? 0.05; mat[i * 3 + 1] = o.rough ?? 0.78; mat[i * 3 + 2] = tintK;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 3));
  return g;
}

// Accumulates parts per bone, then merges each bone's parts into one geometry.
export class Builder {
  constructor() { this.parts = {}; }
  add(bone, geo, color, o) {
    (this.parts[bone] ??= []).push(part(geo, color, o));
    return this;
  }
  box(bone, w, h, d, color, o) { return this.add(bone, shapes.box(w, h, d), color, o); }
  cyl(bone, rt, rb, h, seg, color, o) { return this.add(bone, shapes.cyl(rt, rb, h, seg), color, o); }
  limb(bone, rt, rb, len, seg, color, o) { return this.add(bone, shapes.limb(rt, rb, len, seg), color, o); }
  spike(bone, r, len, seg, color, o) { return this.add(bone, shapes.spike(r, len, seg), color, o); }
  sphere(bone, r, ws, hs, color, o) { return this.add(bone, shapes.sphere(r, ws, hs), color, o); }
  ico(bone, r, color, o) { return this.add(bone, shapes.ico(r, 0), color, o); }
  dodeca(bone, r, color, o) { return this.add(bone, shapes.dodeca(r), color, o); }
  octa(bone, r, color, o) { return this.add(bone, shapes.octa(r), color, o); }
  // Tapered cylinder between two points (bone-local).
  seg(bone, from, to, r0, r1, seg, color, o = {}) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    _v1.set(dx / len, dy / len, dz / len);
    _q1.setFromUnitVectors(_up, _v1);
    _e1.setFromQuaternion(_q1);
    const g = shapes.cyl(r1, r0, len, seg);
    return this.add(bone, g, color, { ...o, x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2, z: (from[2] + to[2]) / 2, rx: _e1.x, ry: _e1.y, rz: _e1.z });
  }
  build() {
    const geos = {};
    let tris = 0;
    for (const [bone, list] of Object.entries(this.parts)) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      geos[bone] = g;
      tris += g.attributes.position.count / 3;
      for (const l of list) l.dispose();
    }
    return { geos, tris };
  }
}

// Material ------------------------------------------------------------------------
const VERT_HEAD = `
attribute float aGlow;
attribute vec3 aMat;
varying float vGlow;
varying vec3 vMatP;
varying vec3 vWP;
`;
const FRAG_HEAD = `
uniform float uDissolve;
uniform vec3 uEdge;
uniform float uBase;
uniform float uHeight;
uniform vec3 uTint;
uniform float uGlow;
uniform vec3 uShield;
uniform float uFill;
uniform float uRim;
varying float vGlow;
varying vec3 vMatP;
varying vec3 vWP;
float rh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rn(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(rh(i), rh(i+vec3(1,0,0)), f.x), mix(rh(i+vec3(0,1,0)), rh(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(rh(i+vec3(0,0,1)), rh(i+vec3(1,0,1)), f.x), mix(rh(i+vec3(0,1,1)), rh(i+vec3(1,1,1)), f.x), f.y), f.z);
}
`;

// Creates a MeshStandardMaterial that reads the part attributes and supports the
// ember dissolve (death / spawn). Each enemy owns one instance (own uniforms) but the
// compiled program is shared.
export function rigMaterial({ transparent = false, opacity = 1, tint = 0xffffff, glow = 1, edge = 0xff7a1a, emissiveBoost = 1, side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.05,
    transparent, opacity, side,
  });
  mat.depthWrite = true;
  mat.userData.u = {
    uDissolve: { value: 0 },
    uEdge: { value: new THREE.Color(edge) },
    uBase: { value: 0 },
    uHeight: { value: 2 },
    uTint: { value: new THREE.Color(tint) },
    uGlow: { value: glow * emissiveBoost },
    uShield: { value: new THREE.Color(0x000000) },
    uFill: { value: 0.16 },
    uRim: { value: 0.45 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vMatP = aMat;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dEdge = 0.0;
        if (uDissolve > 0.001) {
          float dn = rn(vWP * 2.4) * 0.62 + rn(vWP * 6.5) * 0.38;
          float dh = clamp((vWP.y - uBase) / uHeight, 0.0, 1.0);
          float dv = dn * 0.74 + (1.0 - dh) * 0.26;
          float dt = uDissolve * 1.14;
          if (dv < dt - 0.14) discard;
          dEdge = 1.0 - smoothstep(0.0, 0.14, dv - (dt - 0.14));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(1.0), uTint, vMatP.z);
        diffuseColor.rgb *= 1.0 - dEdge * 0.75;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vMatP.x; roughnessFactor = vMatP.y;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_COLOR_ALPHA
          totalEmissiveRadiance += vColor.rgb * mix(vec3(1.0), uTint, vMatP.z) * vGlow * uGlow;
        #else
          totalEmissiveRadiance += vColor * mix(vec3(1.0), uTint, vMatP.z) * vGlow * uGlow;
        #endif
        totalEmissiveRadiance += diffuseColor.rgb * uFill;
        float rimK = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += diffuseColor.rgb * (1.0 + vMatP.x) * 1.5 * rimK * uRim;
        totalEmissiveRadiance += uEdge * dEdge * 3.2;
        totalEmissiveRadiance += uShield * step(0.55, vMatP.x);`);
  };
  mat.customProgramCacheKey = () => 'rig1' + (transparent ? 't' : 'o');
  return mat;
}

// Per-enemy copy: own uniforms (tint, dissolve) but the same compiled program.
export function cloneRigMaterial(src, tint) {
  const m = rigMaterial({ transparent: src.transparent, opacity: src.opacity, tint, side: src.side, edge: src.userData.u.uEdge.value.getHex(), glow: src.userData.u.uGlow.value });
  return m;
}

export function setDissolve(mat, d) { mat.userData.u.uDissolve.value = d; }
