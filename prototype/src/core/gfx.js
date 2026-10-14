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
  lights: 12,
  torch: true,
  flashLights: 2,
};

export function configureGfx(q) {
  GFX.cheap = !!q?.cheapShaders;
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
float cloudN(vec2 p) { return (tnz(p).g * 0.5 + tnz(p * 2.03 + 17.1).b * 0.25) / 0.75; }
`;
