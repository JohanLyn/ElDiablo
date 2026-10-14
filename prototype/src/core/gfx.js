import * as THREE from 'three';

// Graphics facts that are baked in when the world is built (shader variants,
// pooled light counts). They come from the quality preset at page load and do
// not change at runtime, so every shader compiles exactly once; changing the
// preset in Settings shows "Applies after reload" for these.
//
//   cheap        simpler fog, terrain, water, sky and prop shaders (Mobile)
//   lights       size of the pooled point-light pool
//   torch        the hero carries a real PointLight (off on Mobile: a pool emitter lights the hero instead)
//   flashLights  pooled one-shot VFX flash lights
export const GFX = {
  cheap: false,
  direct: false, // no post chain: tone mapping and sRGB are done by the materials themselves
  lights: 12,
  torch: true,
  flashLights: 2,
};

export function configureGfx(q) {
  GFX.cheap = !!q?.cheapShaders;
  GFX.direct = q?.post === false;
  GFX.lights = q?.lights ?? 12;
  GFX.torch = GFX.lights >= 12;
  GFX.flashLights = GFX.lights >= 12 ? 2 : 1;
  if (GFX.cheap) noiseUniform.value ??= makeNoiseTexture();
}

// ---------------------------------------------------------------------------
// Baked value-noise texture for the cheap shaders. One RGBA texture holds four
// independent, tileable value-noise fields (lattice cell = 1 unit, tile = 64
// cells), so a single hardware-filtered fetch replaces a hash-based vnoise() of
// ~4 sin-free hashes + mixes, and `tnz(p).g` etc. give uncorrelated octaves.
const CELLS = 64, TEX = 256;

function lattice(seed) {
  const a = new Float32Array(CELLS * CELLS);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    a[i] = (s >>> 8) / 16777216;
  }
  return a;
}

function makeNoiseTexture() {
  const data = new Uint8Array(TEX * TEX * 4);
  const fields = [lattice(1337), lattice(7919), lattice(104729), lattice(15485863)];
  const per = TEX / CELLS;
  for (let c = 0; c < 4; c++) {
    const f = fields[c];
    for (let y = 0; y < TEX; y++) {
      const gy = y / per, iy = Math.floor(gy), fy0 = gy - iy, fy = fy0 * fy0 * (3 - 2 * fy0);
      for (let x = 0; x < TEX; x++) {
        const gx = x / per, ix = Math.floor(gx), fx0 = gx - ix, fx = fx0 * fx0 * (3 - 2 * fx0);
        const x0 = ix % CELLS, x1 = (ix + 1) % CELLS, y0 = iy % CELLS, y1 = (iy + 1) % CELLS;
        const a = f[y0 * CELLS + x0], b = f[y0 * CELLS + x1], cc = f[y1 * CELLS + x0], d = f[y1 * CELLS + x1];
        const v = (a + (b - a) * fx) + ((cc + (d - cc) * fx) - (a + (b - a) * fx)) * fy;
        data[(y * TEX + x) * 4 + c] = Math.round(v * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Shared uniform object: shaders that opt in reference `uNoiseTex: noiseUniform`.
export const noiseUniform = { value: null };

// tnz(p).r/.g/.b/.a ~ four independent vnoise(p) fields (period 64 units).
export const NOISE_TEX_GLSL = /* glsl */`
uniform sampler2D uNoiseTex;
vec4 tnz(vec2 p) { return texture2D(uNoiseTex, p * ${(1 / CELLS).toFixed(6)}); }
// Two-octave stand-in for fbm3() (cloud shadows).
float cloudN(vec2 p) { return ((tnz(p).g * 0.5 + tnz(p * 2.03 + 17.1).b * 0.25) / 0.75 - 0.5) * 0.7 + 0.5; }
`;

// ---------------------------------------------------------------------------
// Direct output for custom shaders. Stock materials end with the tone-mapping and
// colour-space chunks, but this game's ShaderMaterials write gl_FragColor in linear
// light and rely on the composer's OutputPass. When the scene renders straight to the
// canvas (GFX.direct), every ShaderMaterial gets the same two chunks appended to its
// main(), so sky, water, glows and particles are tone mapped like everything else.
// The accessor returns the original source untouched whenever GFX.direct is false,
// so desktop presets compile exactly the shaders they always did. Additive shaders are
// left alone (see the getter).
const FS = THREE.ShaderMaterial.prototype;
if (!Object.getOwnPropertyDescriptor(FS, 'fragmentShader')) {
  Object.defineProperty(FS, 'fragmentShader', {
    configurable: true,
    get() {
      // Additive glows keep their raw output: summing sRGB-encoded values piles up the soft
      // tails of a halo (the composer sums in linear light instead), and the raw value is a
      // good stand-in for that sum.
      if (!GFX.direct || this.blending === THREE.AdditiveBlending) return this._kurFs;
      if (this._kurFsOut === undefined || this._kurFsOutSrc !== this._kurFs) {
        this._kurFsOutSrc = this._kurFs;
        this._kurFsOut = wrapMain(this._kurFs);
      }
      return this._kurFsOut;
    },
    set(v) { this._kurFs = v; },
  });
}

function wrapMain(src) {
  if (typeof src !== 'string') return src;
  const m = /void\s+main\s*\(\s*\)/.exec(src);
  if (!m) return src;
  return `${src.slice(0, m.index)}void kurMain()${src.slice(m.index + m[0].length)}
void main() {
  kurMain();
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
}
