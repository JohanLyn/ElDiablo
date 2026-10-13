import * as THREE from 'three';
import { createSkyMaterial } from './shaders/sky.js';

// Atmosphere over the day cycle. TOD_LOOKS are keyframes (by world.tod.t) of
// everything that changes through the day: key light, hemisphere and fill,
// sky and fog colours, exposure, bloom and the colour grade. blendLook() writes
// the interpolated result into a preallocated Look, so a frame allocates nothing.
// world.js layers a per-region modifier on top and applies the result.
//
// Colours are sRGB hex (converted to linear by THREE.Color).

const COLOR_KEYS = [
  'sunColor', 'hemiSky', 'hemiGround', 'fillColor', 'zenith', 'horizon', 'glow',
  'cloudLit', 'cloudDark', 'gShadow', 'gHighlight',
];
const NUM_KEYS = [
  'sun',        // key light intensity
  'hemi',       // hemisphere intensity
  'fill',       // cool fill intensity
  'fogD',       // exp2 distance-fog density (per metre)
  'glowAmt',    // sun in-scatter strength in fog and sky
  'exposure',   // tone-mapping exposure
  'envI',       // environment-map intensity
  'bloom', 'bloomThr', 'bloomRad',
  'shaft',      // light-shaft strength
  'stars',
  'cloudCover', 'cloudShadow',
  'gSplit', 'gSat', 'gContrast',
  'vign', 'grain', 'ca',
  'lantern',    // 0..1 how lit lanterns/halos are
  'discK',      // sun disc visibility
  'moonK',      // moon disc visibility
];

// t: 0 dawn, .30 noon, .56 golden, .655 dusk, .84 night. The sun sets at .68
// and the moon takes over (world/timeofday.js), so the keyframes around .68 keep
// the key light dim while its direction changes.
const KEYS = [
  { // 0.00 first light: the key light swaps from moon to sun while it is still dim
    t: 0.0,
    sunColor: 0xffb596, hemiSky: 0xa8b0ee, hemiGround: 0x6e5262, fillColor: 0x7a8cff,
    zenith: 0x4d5f9f, horizon: 0xe8b4a8, glow: 0xffa888, cloudLit: 0xffc6b0, cloudDark: 0x6a5a8a,
    gShadow: 0x34386a, gHighlight: 0xffc0a0,
    sun: 0.5, hemi: 0.66, fill: 0.5, fogD: 0.0125, glowAmt: 0.55, exposure: 1.02, envI: 0.5,
    bloom: 0.5, bloomThr: 0.82, bloomRad: 0.55, shaft: 1.0, stars: 0.12, cloudCover: 0.55, cloudShadow: 0.3,
    gSplit: 0.26, gSat: 1.12, gContrast: 1.07, vign: 0.34, grain: 0.034, ca: 0.8, lantern: 0.35, discK: 1, moonK: 0.2,
  },
  { // 0.02 dawn: rose / peach sun, cool blue-violet shadows
    t: 0.02,
    sunColor: 0xffb596, hemiSky: 0xa8b0ee, hemiGround: 0x6e5262, fillColor: 0x7a8cff,
    zenith: 0x4d5f9f, horizon: 0xe8b4a8, glow: 0xffa888, cloudLit: 0xffc6b0, cloudDark: 0x6a5a8a,
    gShadow: 0x34386a, gHighlight: 0xffc0a0,
    sun: 1.7, hemi: 0.82, fill: 0.5, fogD: 0.0118, glowAmt: 0.35, exposure: 1.02, envI: 0.5,
    bloom: 0.5, bloomThr: 0.82, bloomRad: 0.55, shaft: 1.0, stars: 0.12, cloudCover: 0.55, cloudShadow: 0.3,
    gSplit: 0.2, gSat: 1.04, gContrast: 1.07, vign: 0.34, grain: 0.034, ca: 0.8, lantern: 0.35, discK: 1, moonK: 0.2,
  },
  { // 0.08 morning
    t: 0.08,
    sunColor: 0xffd0a0, hemiSky: 0xb4ccff, hemiGround: 0x84603c, fillColor: 0x8aa4ff,
    zenith: 0x3d70c0, horizon: 0xf2cfa4, glow: 0xffc488, cloudLit: 0xfff0e0, cloudDark: 0x8a9ac0,
    gShadow: 0x3e3a62, gHighlight: 0xffd8a8,
    sun: 1.9, hemi: 0.8, fill: 0.4, fogD: 0.0112, glowAmt: 0.4, exposure: 1.0, envI: 0.55,
    bloom: 0.4, bloomThr: 0.86, bloomRad: 0.5, shaft: 0.7, stars: 0, cloudCover: 0.5, cloudShadow: 0.28,
    gSplit: 0.2, gSat: 1.14, gContrast: 1.07, vign: 0.32, grain: 0.032, ca: 0.8, lantern: 0, discK: 1, moonK: 0,
  },
  { // 0.30 noon: clean warm sun, saturated lapis sky
    t: 0.30,
    sunColor: 0xffead0, hemiSky: 0x9cc2ff, hemiGround: 0x8a6a42, fillColor: 0x9bb4ff,
    zenith: 0x2a62c4, horizon: 0xc4d6e8, glow: 0xffe0b0, cloudLit: 0xffffff, cloudDark: 0x93a6cc,
    gShadow: 0x463c5e, gHighlight: 0xffe2b0,
    sun: 2.15, hemi: 0.84, fill: 0.3, fogD: 0.0095, glowAmt: 0.25, exposure: 1.0, envI: 0.6,
    bloom: 0.34, bloomThr: 0.9, bloomRad: 0.45, shaft: 0.25, stars: 0, cloudCover: 0.45, cloudShadow: 0.3,
    gSplit: 0.18, gSat: 1.14, gContrast: 1.07, vign: 0.28, grain: 0.03, ca: 0.7, lantern: 0, discK: 1, moonK: 0,
  },
  { // 0.46 afternoon
    t: 0.46,
    sunColor: 0xffe2b8, hemiSky: 0xa4c4f4, hemiGround: 0x8a6a40, fillColor: 0x9bb4ff,
    zenith: 0x2f66c0, horizon: 0xd6d4c4, glow: 0xffd098, cloudLit: 0xfff6e8, cloudDark: 0x95a4c4,
    gShadow: 0x463a5a, gHighlight: 0xffd8a0,
    sun: 2.1, hemi: 0.82, fill: 0.32, fogD: 0.0102, glowAmt: 0.32, exposure: 1.0, envI: 0.58,
    bloom: 0.36, bloomThr: 0.88, bloomRad: 0.47, shaft: 0.35, stars: 0, cloudCover: 0.45, cloudShadow: 0.3,
    gSplit: 0.19, gSat: 1.15, gContrast: 1.07, vign: 0.3, grain: 0.03, ca: 0.7, lantern: 0, discK: 1, moonK: 0,
  },
  { // 0.56 golden hour: deep amber key, long shadows, warm haze
    t: 0.56,
    sunColor: 0xffb468, hemiSky: 0xc4b8c8, hemiGround: 0x7a5a3a, fillColor: 0x8a7aff,
    zenith: 0x3d5aa0, horizon: 0xe6b88a, glow: 0xff9a40, cloudLit: 0xffb870, cloudDark: 0x6a5a8a,
    gShadow: 0x3a3068, gHighlight: 0xffcc90,
    sun: 2.3, hemi: 0.78, fill: 0.44, fogD: 0.0112, glowAmt: 0.55, exposure: 1.04, envI: 0.5,
    bloom: 0.55, bloomThr: 0.8, bloomRad: 0.6, shaft: 1.0, stars: 0, cloudCover: 0.5, cloudShadow: 0.34,
    gSplit: 0.2, gSat: 1.1, gContrast: 1.08, vign: 0.36, grain: 0.034, ca: 0.9, lantern: 0.1, discK: 1, moonK: 0,
  },
  { // 0.625 sunset: magenta and orange horizon, violet shadows
    t: 0.625,
    sunColor: 0xff8a50, hemiSky: 0xa088d0, hemiGround: 0x6a4450, fillColor: 0x7a5aff,
    zenith: 0x4a3a86, horizon: 0xe08060, glow: 0xff7040, cloudLit: 0xff8a64, cloudDark: 0x4a3a78,
    gShadow: 0x2a2060, gHighlight: 0xffb890,
    sun: 1.7, hemi: 0.75, fill: 0.5, fogD: 0.0122, glowAmt: 0.6, exposure: 1.08, envI: 0.45,
    bloom: 0.7, bloomThr: 0.76, bloomRad: 0.65, shaft: 0.9, stars: 0.1, cloudCover: 0.55, cloudShadow: 0.3,
    gSplit: 0.22, gSat: 1.08, gContrast: 1.1, vign: 0.4, grain: 0.036, ca: 1.0, lantern: 0.55, discK: 1, moonK: 0,
  },
  { // 0.665 dusk: magenta horizon, indigo sky, torches take over
    t: 0.665,
    sunColor: 0xe8806a, hemiSky: 0x8a80d0, hemiGround: 0x503a54, fillColor: 0x6a60ff,
    zenith: 0x2c2a68, horizon: 0xa8608c, glow: 0xff6a70, cloudLit: 0xe0607a, cloudDark: 0x3a3070,
    gShadow: 0x1e1a58, gHighlight: 0xffa8a0,
    sun: 1.0, hemi: 0.8, fill: 0.5, fogD: 0.0125, glowAmt: 0.45, exposure: 1.2, envI: 0.42,
    bloom: 0.85, bloomThr: 0.72, bloomRad: 0.7, shaft: 0.35, stars: 0.4, cloudCover: 0.55, cloudShadow: 0.2,
    gSplit: 0.24, gSat: 1.04, gContrast: 1.1, vign: 0.42, grain: 0.038, ca: 1.0, lantern: 0.9, discK: 0.6, moonK: 0,
  },
  { // 0.683 the sun has set: the key light is at its dimmest while it swaps to the moon
    t: 0.683,
    sunColor: 0x6a74c0, hemiSky: 0x5a58a8, hemiGround: 0x3a2c4c, fillColor: 0x5a58d8,
    zenith: 0x20245e, horizon: 0x9a4a7c, glow: 0xc0506a, cloudLit: 0xa05a8a, cloudDark: 0x2c2c64,
    gShadow: 0x181c56, gHighlight: 0xd8a0c8,
    sun: 0.3, hemi: 0.78, fill: 0.4, fogD: 0.013, glowAmt: 0.4, exposure: 1.26, envI: 0.4,
    bloom: 0.92, bloomThr: 0.7, bloomRad: 0.72, shaft: 0.1, stars: 0.6, cloudCover: 0.5, cloudShadow: 0.12,
    gSplit: 0.34, gSat: 1.1, gContrast: 1.1, vign: 0.44, grain: 0.04, ca: 1.0, lantern: 1, discK: 0, moonK: 0.4,
  },
  { // 0.725 blue hour, moon up
    t: 0.725,
    sunColor: 0x8a9cf0, hemiSky: 0x4e62b0, hemiGround: 0x2e3452, fillColor: 0x5064d0,
    zenith: 0x121a4c, horizon: 0x4a4678, glow: 0x7a68b8, cloudLit: 0x7a76b4, cloudDark: 0x20285a,
    gShadow: 0x121a50, gHighlight: 0xb8c0ff,
    sun: 0.95, hemi: 0.85, fill: 0.38, fogD: 0.0118, glowAmt: 0.28, exposure: 1.32, envI: 0.38,
    bloom: 0.98, bloomThr: 0.69, bloomRad: 0.74, shaft: 0.35, stars: 0.9, cloudCover: 0.46, cloudShadow: 0.1,
    gSplit: 0.34, gSat: 1.04, gContrast: 1.1, vign: 0.45, grain: 0.041, ca: 1.0, lantern: 1, discK: 0, moonK: 0.9,
  },
  { // 0.78 night: moonlit blue-silver, never black
    t: 0.78,
    sunColor: 0xa6c0ff, hemiSky: 0x7088e0, hemiGround: 0x34406a, fillColor: 0x5a74e0,
    zenith: 0x0c1438, horizon: 0x34487c, glow: 0x6a88d8, cloudLit: 0x6a7ab0, cloudDark: 0x141c40,
    gShadow: 0x0c1440, gHighlight: 0xc4d4ff,
    sun: 1.5, hemi: 1.0, fill: 0.4, fogD: 0.0108, glowAmt: 0.22, exposure: 1.42, envI: 0.45,
    bloom: 1.0, bloomThr: 0.68, bloomRad: 0.75, shaft: 0.6, stars: 1, cloudCover: 0.42, cloudShadow: 0.1,
    gSplit: 0.2, gSat: 1.0, gContrast: 1.08, vign: 0.46, grain: 0.042, ca: 1.0, lantern: 1, discK: 0, moonK: 1,
  },
  { // 0.90 deep night
    t: 0.90,
    sunColor: 0xa0bcff, hemiSky: 0x7088e0, hemiGround: 0x34406a, fillColor: 0x5a74e0,
    zenith: 0x0a1232, horizon: 0x30447a, glow: 0x6a88d8, cloudLit: 0x6a7ab0, cloudDark: 0x121a3c,
    gShadow: 0x0c1440, gHighlight: 0xc4d4ff,
    sun: 1.45, hemi: 0.98, fill: 0.4, fogD: 0.0108, glowAmt: 0.22, exposure: 1.42, envI: 0.45,
    bloom: 1.0, bloomThr: 0.68, bloomRad: 0.75, shaft: 0.6, stars: 1, cloudCover: 0.4, cloudShadow: 0.1,
    gSplit: 0.2, gSat: 1.0, gContrast: 1.08, vign: 0.46, grain: 0.042, ca: 1.0, lantern: 1, discK: 0, moonK: 1,
  },
  { // 0.965 pre-dawn: a violet-pink band creeps up the east
    t: 0.965,
    sunColor: 0x9aa0e8, hemiSky: 0x6a74c0, hemiGround: 0x3a3452, fillColor: 0x6a74e0,
    zenith: 0x1c2458, horizon: 0x8a5a86, glow: 0xc07aa0, cloudLit: 0xa08ab8, cloudDark: 0x2a3060,
    gShadow: 0x181c58, gHighlight: 0xe0b8d8,
    sun: 0.7, hemi: 0.58, fill: 0.4, fogD: 0.0125, glowAmt: 0.4, exposure: 1.22, envI: 0.42,
    bloom: 0.8, bloomThr: 0.74, bloomRad: 0.68, shaft: 0.4, stars: 0.6, cloudCover: 0.5, cloudShadow: 0.15,
    gSplit: 0.3, gSat: 1.05, gContrast: 1.08, vign: 0.4, grain: 0.04, ca: 1.0, lantern: 0.8, discK: 0.4, moonK: 0.6,
  },
];
// Wrap: the last keyframe blends into the first one at t = 1.
const WRAP = { ...KEYS[0], t: 1.0 };

const toColors = (k) => {
  const o = { t: k.t };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  for (const n of NUM_KEYS) o[n] = k[n];
  return o;
};
const FRAMES = [...KEYS, WRAP].map(toColors);

export function createLook() {
  const o = {};
  for (const c of COLOR_KEYS) o[c] = new THREE.Color();
  for (const n of NUM_KEYS) o[n] = 0;
  return o;
}

export function copyLook(dst, src) {
  for (const c of COLOR_KEYS) dst[c].copy(src[c]);
  for (const n of NUM_KEYS) dst[n] = src[n];
  return dst;
}

const sstep = (x) => x * x * (3 - 2 * x);

// Interpolates the keyframes at day-cycle time t (0..1) into `out`.
export function blendLook(t, out) {
  let i = 0;
  while (i < FRAMES.length - 2 && t >= FRAMES[i + 1].t) i++;
  const a = FRAMES[i], b = FRAMES[i + 1];
  const k = sstep(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], k);
  for (const n of NUM_KEYS) out[n] = a[n] + (b[n] - a[n]) * k;
  return out;
}

export { COLOR_KEYS as LOOK_COLORS, NUM_KEYS as LOOK_NUMS };

// Key-light elevation as the lighting uses it. tod.sunDir keeps the sun on its
// true arc; for shading the low sun is lifted a little (bounded shadow length)
// while the golden hour still gets long shadows.
export function keyElevation(e) {
  const x = Math.min(1, Math.max(0, (e - 0.06) / 1.02));
  return 0.17 + 0.88 * Math.pow(x, 2.2);
}

// ---------------------------------------------------------------------------
// Environment map: the live sky baked into a PMREM so metal, gold and lapis
// pick up the day's colours. The bake is spread over a few frames: a couple
// of 64 px cube faces per frame, then one prefilter pass.
const FACE_SIZE = 64;
export class EnvBaker {
  constructor(webgl, scene, env) {
    this.webgl = webgl;
    this.scene = scene;
    this.skyScene = new THREE.Scene();
    this.skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), createSkyMaterial(env, true)));
    this.skyScene.children[0].frustumCulled = false;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(FACE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    this.cam = new THREE.CubeCamera(0.1, 100, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(webgl);
    this.target = null; // PMREM render target, reused for every bake
    this.stage = -1; // -1 idle, 0..2 faces, 3 prefilter
    this.sig = new Float32Array(7); // zenith + horizon + time at the last bake
    this.cool = 0;
    this.bakes = 0;
    this.ms = 0; // cost of the last bake step (for diagnostics)
  }

  // Colour signature of the live sky; a bake is due once it drifts.
  _drift(env, t) {
    const z = env.uSkyZenith.value, h = env.uSkyHorizon.value, s = this.sig;
    let dt = Math.abs(t - s[6]);
    dt = Math.min(dt, 1 - dt); // the day wraps
    // A move of 0.01 in day time (about 8 s) is enough to re-bake.
    return Math.abs(z.r - s[0]) + Math.abs(z.g - s[1]) + Math.abs(z.b - s[2]) + Math.abs(h.r - s[3]) + Math.abs(h.g - s[4]) + Math.abs(h.b - s[5]) + dt * 5;
  }

  // Call once a frame. `force` bakes everything immediately (first frame, dungeon swaps).
  update(env, dt, t, force = false) {
    if (force) {
      this.stage = -1;
      this._renderFaces(0, 6);
      this._prefilter(env, t);
      return;
    }
    this.cool -= dt;
    if (this.stage < 0) {
      if (this.cool > 0 || this._drift(env, t) < 0.05) return;
      this.stage = 0;
    }
    const t0 = performance.now();
    if (this.stage < 3) {
      this._renderFaces(this.stage * 2, 2);
      this.stage++;
    } else {
      this._prefilter(env, t);
      this.stage = -1;
      this.cool = 0.6;
    }
    this.ms = performance.now() - t0;
  }

  _renderFaces(first, n) {
    const r = this.webgl, cam = this.cam;
    if (cam.coordinateSystem !== r.coordinateSystem) { cam.update(r, this.skyScene); return; }
    const prevTarget = r.getRenderTarget(), prevFace = r.getActiveCubeFace();
    for (let i = first; i < first + n; i++) {
      r.setRenderTarget(this.cubeRT, i);
      r.render(this.skyScene, cam.children[i]);
    }
    r.setRenderTarget(prevTarget, prevFace);
  }

  _prefilter(env, t) {
    const prev = this.target;
    this.target = this.pmrem.fromCubemap(this.cubeRT.texture, prev);
    if (!prev) this.scene.environment = this.target.texture;
    const z = env.uSkyZenith.value, h = env.uSkyHorizon.value, s = this.sig;
    s[0] = z.r; s[1] = z.g; s[2] = z.b; s[3] = h.r; s[4] = h.g; s[5] = h.b; s[6] = t;
    this.bakes++;
  }
}
