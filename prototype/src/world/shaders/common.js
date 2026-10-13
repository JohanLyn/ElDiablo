import * as THREE from 'three';

// Shared GLSL snippets and the uniforms every world shader reads. One `env`
// object is created by world.js and updated each frame, so sky, terrain,
// grass, water and particles all agree on time, wind and sun.
export const NOISE_GLSL = /* glsl */`
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.875;
}
`;

let ENV = null;
export const getEnv = () => ENV;

export function createEnv() {
  ENV = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.85, 0.6) },
    uSkyZenith: { value: new THREE.Color(0x3a6fb0) },
    uSkyHorizon: { value: new THREE.Color(0xe6c08a) },
    uWind: { value: new THREE.Vector2(1, 0.3) },
    uPlayer: { value: new THREE.Vector3() },
    uCloud: { value: 0.28 }, // cloud-shadow strength
    uPxScale: { value: 800 }, // viewport px per world unit at distance 1 (point sprites)
  };
  return ENV;
}
