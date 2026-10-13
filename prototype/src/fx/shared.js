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
