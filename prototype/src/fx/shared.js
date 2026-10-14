import * as THREE from 'three';

// Shared uniforms and tiny helpers for the VFX system. Everything here is
// allocation-free so it is safe to call from per-frame code.
export const U = {
  time: { value: 0 },
};

export const TAU = Math.PI * 2;
export const rr = (a, b) => a + Math.random() * (b - a);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Scratch colour: set once, read r/g/b without allocating.
const _c = new THREE.Color();
export function rgb(hex) { return _c.set(hex); }

// Set a particle template's start / end colour from a hex, with an HDR multiplier.
export function col0(t, hex, k = 1) { _c.set(hex); t.r0 = _c.r * k; t.g0 = _c.g * k; t.b0 = _c.b * k; }
export function col1(t, hex, k = 1) { _c.set(hex); t.r1 = _c.r * k; t.g1 = _c.g * k; t.b1 = _c.b * k; }

// Premultiplied "glow over": rgb is added, and `alpha` (usually a fraction of the
// glow strength) darkens what is behind. Keeps saturated colours readable on bright ground.
export const PREMULT = {
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

// Height of the *rendered* terrain mesh (piecewise-linear over its grid), not the
// smooth height function: decals laid on `heightAt` would sink into the facets.
// Mirrors world/terrainMesh.js (PlaneGeometry, size 2*HALF, `segs` cells per side).
export function makeSurfaceHeight(heightAt, half, segs, dungeonZ) {
  const cell = (half * 2) / segs;
  return (x, z) => {
    if (z < dungeonZ || x < -half || x > half || z > half) return heightAt(x, z);
    const gx = (x + half) / cell, gz = (z + half) / cell;
    const ix = Math.min(segs - 1, Math.max(0, Math.floor(gx))), iz = Math.min(segs - 1, Math.max(0, Math.floor(gz)));
    const fx = gx - ix, fz = gz - iz;
    const x0 = ix * cell - half, z0 = iz * cell - half;
    const ha = heightAt(x0, z0), hd = heightAt(x0 + cell, z0), hb = heightAt(x0, z0 + cell);
    if (fx + fz <= 1) return ha + fx * (hd - ha) + fz * (hb - ha);
    const hc = heightAt(x0 + cell, z0 + cell);
    return hc + (1 - fx) * (hb - hc) + (1 - fz) * (hd - hc);
  };
}
