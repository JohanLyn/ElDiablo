import * as THREE from 'three';

// One GPU-animated Points system that follows the player. Every particle has
// a type (pollen, firefly, sand, ember, ash, mote); region weights decide
// which types are visible, so crossing a border fades one mood into the next.
export const PARTICLE_TYPES = ['pollen', 'firefly', 'sand', 'ember', 'ash', 'mote'];

export const PARTICLE_MIX = {
  town: [0.35, 0, 0, 0, 0, 0.2],
  sunfields: [1, 0, 0, 0, 0, 0],
  marsh: [0.15, 1, 0, 0, 0, 0.15],
  ruins: [0.1, 0, 1, 0, 0, 0],
  ashen: [0, 0, 0, 1, 0.9, 0],
  dungeon: [0, 0, 0, 0.12, 0, 1],
  cistern: [0, 0.35, 0, 0, 0, 1],
};

const BOX = 56;

export function createParticles(env, settings) {
  const q = settings?.quality?.particles ?? 1;
  const count = Math.round(2400 * q);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  const type = new Float32Array(count);
  // Mix of types: pollen/mote are the common ones, spread the rest evenly.
  for (let i = 0; i < count; i++) {
    rnd.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    type[i] = i % 6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  geo.setAttribute('aType', new THREE.BufferAttribute(type, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = {
    uTime: env.uTime,
    uWind: env.uWind,
    uCenter: { value: new THREE.Vector3() },
    uScale: { value: 400 },
    uWA: { value: new THREE.Vector4(1, 0, 0, 0) },
    uWB: { value: new THREE.Vector2(0, 0) },
    uOpacity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      uniform float uTime, uScale, uOpacity;
      uniform vec3 uCenter;
      uniform vec2 uWind;
      uniform vec4 uWA; uniform vec2 uWB;
      attribute vec4 aRnd; attribute float aType;
      varying vec4 vColor; varying float vKind;
      const float BOX = ${BOX.toFixed(1)};
      void main() {
        float ty = aType;
        float w = ty < 0.5 ? uWA.x : ty < 1.5 ? uWA.y : ty < 2.5 ? uWA.z : ty < 3.5 ? uWA.w : ty < 4.5 ? uWB.x : uWB.y;
        vec3 base = vec3(aRnd.x, aRnd.y, aRnd.z) * BOX;
        float t = uTime;
        vec3 p; vec3 col; float size; float alpha; float kind = 0.0; // kind 0 glow, 1 solid
        float hgt = 6.0;
        if (ty < 0.5) {            // pollen: golden dust lazily drifting
          p = base + vec3(uWind.x, 0.12, uWind.y) * t * 0.7 + vec3(sin(t * 0.5 + aRnd.w * 20.0), sin(t * 0.7 + aRnd.w * 9.0) * 0.6, cos(t * 0.45 + aRnd.w * 14.0)) * 0.8;
          hgt = 5.0; col = vec3(1.0, 0.82, 0.38); size = 0.1 + aRnd.w * 0.06; alpha = 0.55;
        } else if (ty < 1.5) {     // firefly: wandering, blinking
          p = base + vec3(sin(t * 0.3 + aRnd.w * 30.0) * 2.0, sin(t * 0.55 + aRnd.w * 11.0) * 0.5, cos(t * 0.27 + aRnd.w * 17.0) * 2.0);
          hgt = 2.6; float b = pow(sin(t * (0.8 + aRnd.w) + aRnd.x * 40.0) * 0.5 + 0.5, 3.0);
          col = vec3(0.65, 1.0, 0.3) * 2.6; size = 0.16; alpha = b;
        } else if (ty < 2.5) {     // sand wisps: fast, low, streaky
          p = base + vec3(uWind.x * 5.0 + 3.0, 0.0, uWind.y * 5.0) * t * 0.9;
          hgt = 2.2; col = vec3(0.86, 0.68, 0.42); size = 0.2 + aRnd.w * 0.18; alpha = 0.33 + 0.2 * sin(t * 2.0 + aRnd.x * 30.0);
          kind = 1.0;
        } else if (ty < 3.5) {     // embers: rise, sway, die at the top
          p = base + vec3(sin(t * 1.1 + aRnd.w * 20.0) * 0.7 + uWind.x * t * 0.3, t * (0.7 + aRnd.w * 0.8), cos(t * 0.9 + aRnd.w * 13.0) * 0.7);
          hgt = 9.0; col = vec3(1.0, 0.45, 0.12) * 3.2; size = 0.1 + aRnd.w * 0.07; alpha = 0.9;
        } else if (ty < 4.5) {     // ash flakes: tumble down
          p = base + vec3(uWind.x * t * 0.5 + sin(t * 0.7 + aRnd.w * 20.0) * 0.8, -t * (0.35 + aRnd.w * 0.35), uWind.y * t * 0.3 + cos(t * 0.6 + aRnd.w * 10.0) * 0.8);
          hgt = 9.0; col = vec3(0.2, 0.17, 0.22); size = 0.14 + aRnd.w * 0.1; alpha = 0.6; kind = 1.0;
        } else {                   // dungeon / town motes
          p = base + vec3(sin(t * 0.2 + aRnd.w * 30.0), sin(t * 0.25 + aRnd.w * 9.0) * 0.6, cos(t * 0.18 + aRnd.w * 15.0)) * 1.2;
          hgt = 5.0; col = vec3(0.6, 0.5, 0.45); size = 0.07 + aRnd.w * 0.04; alpha = 0.18 + 0.2 * sin(t * 0.8 + aRnd.x * 30.0);
        }
        // Wrap into a box centred on the player.
        vec3 rel = p - uCenter;
        rel.x = mod(rel.x + BOX * 0.5, BOX) - BOX * 0.5;
        rel.z = mod(rel.z + BOX * 0.5, BOX) - BOX * 0.5;
        float hy = mod(p.y - 0.0, hgt);
        vec3 wp = vec3(uCenter.x + rel.x, uCenter.y - 0.3 + hy, uCenter.z + rel.z);
        float edge = 1.0 - smoothstep(BOX * 0.32, BOX * 0.5, max(abs(rel.x), abs(rel.z)));
        float vert = smoothstep(0.0, 0.6, hy) * (1.0 - smoothstep(hgt * 0.7, hgt, hy));
        float on = step(aRnd.w, w + 0.0001) * step(0.001, w);
        // Per-type visibility is thinned by the weight so mixes cross-fade by density.
        float thin = step(fract(aRnd.w * 7.31 + aRnd.x), w);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, size * uScale / -mv.z);
        float a = alpha * edge * vert * thin * uOpacity;
        vColor = vec4(col, a);
        vKind = kind;
        if (a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vColor; varying float vKind;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float s = smoothstep(1.0, vKind > 0.5 ? 0.55 : 0.0, d);
        float a = vColor.a * s;
        if (a < 0.004) discard;
        // Premultiplied: glow types add light (alpha 0), solid types occlude.
        gl_FragColor = vec4(vColor.rgb * a, vKind > 0.5 ? a : 0.0);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  const mix = new Float32Array(6);
  mix.set(PARTICLE_MIX.sunfields);
  return {
    points,
    uniforms,
    count,
    // Called every frame with current region weights (blended in world.js).
    update(center, weights, viewportH, fovDeg) {
      uniforms.uCenter.value.copy(center);
      uniforms.uWA.value.set(weights[0], weights[1], weights[2], weights[3]);
      uniforms.uWB.value.set(weights[4], weights[5]);
      uniforms.uScale.value = (viewportH * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
    },
  };
}
