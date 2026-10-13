import * as THREE from 'three';
import { NOISE_GLSL } from './common.js';

// Sky dome driven by the day cycle: zenith/horizon gradient, sun glow + disc,
// moon with phase, stars, and two cloud layers drifting at different speeds
// (parallax) that catch the sun on their edges.
//
// SKY_GLSL is shared with the water shader (which reflects the sky analytically)
// and with the environment-map bake (BAKE: no discs, no stars, ground bounce).
export const SKY_UNIFORM_NAMES = ['uSunColor', 'uDisc', 'uMoon', 'uStars', 'uGlow', 'uGlowColor', 'uSkyGround', 'uCloudCover', 'uCloudLit', 'uCloudDark', 'uTime', 'uWind'];

export const SKY_GLSL = /* glsl */`
uniform vec3 uZenith, uHorizon, uSkyGround, uGlowColor, uSunColor, uCloudLit, uCloudDark;
uniform vec4 uDisc, uMoon;
uniform float uStars, uGlow, uCloudCover, uTime;
uniform vec2 uWind;
${NOISE_GLSL}

vec3 skyGradient(vec3 d, float bake) {
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.85, h), 0.62));
  // Bright haze hugging the horizon.
  col = mix(col, uHorizon * 1.1, exp(-abs(h) * 9.0) * 0.45);
  // Sun-side glow (wide scatter + tighter aureole), strongest low on the horizon.
  float sd = max(dot(d, uDisc.xyz), 0.0);
  float gl = pow(sd, 3.0) * 0.38 + pow(sd, 9.0) * 0.35 + pow(sd, 70.0) * 0.9 * (1.0 - bake);
  col += uGlowColor * gl * uGlow * uDisc.w * (0.35 + 0.65 * exp(-max(h, 0.0) * 3.0));
  // Moon glow.
  float md = max(dot(d, uMoon.xyz), 0.0);
  col += vec3(0.35, 0.46, 0.85) * (pow(md, 5.0) * 0.05 + pow(md, 60.0) * 0.28 * (1.0 - bake)) * uMoon.w;
  // Below the horizon: haze (runtime) or warm ground bounce (env bake).
  float below = 1.0 - smoothstep(-0.2, 0.0, h);
  col = mix(col, mix(uHorizon * 0.86, uSkyGround, bake), below);
  return col;
}

// Hash for star cells.
vec3 hash33s(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

vec3 skyFull(vec3 d, float bake) {
  vec3 col = skyGradient(d, bake);
  float h = d.y;
  if (bake < 0.5) {
    // Stars: sparse twinkling points, hidden by horizon haze and moon glow.
    if (uStars > 0.01 && h > 0.0) {
      vec3 sp = d * 70.0;
      vec3 cell = floor(sp);
      vec3 r = hash33s(cell);
      float on = step(0.93, r.x);
      float dd = length(fract(sp) - (0.2 + 0.6 * r.yzx));
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r.z * 3.0) + r.y * 40.0);
      float star = on * smoothstep(0.17, 0.0, dd) * tw * (0.35 + 1.4 * r.z);
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.62), step(0.8, r.y));
      col += sc * star * uStars * smoothstep(0.02, 0.4, h) * (1.0 - clamp(dot(d, uMoon.xyz) * 1.4, 0.0, 0.85) * uMoon.w);
    }
    // Moon disc with a soft phase terminator and maria.
    if (uMoon.w > 0.01) {
      float md = dot(d, uMoon.xyz);
      if (md > 0.996) {
        vec3 t1 = normalize(cross(uMoon.xyz, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(t1, uMoon.xyz);
        vec2 q = vec2(dot(d, t1), dot(d, t2)) / 0.042;
        float r2 = dot(q, q);
        if (r2 < 1.0) {
          vec3 n = vec3(q, sqrt(1.0 - r2));
          float lit = smoothstep(-0.25, 0.25, dot(n, normalize(vec3(0.55, 0.3, 0.78))));
          float maria = 0.72 + 0.4 * vnoise(q * 3.2 + 4.0) + 0.2 * vnoise(q * 7.0);
          vec3 mc = vec3(0.80, 0.88, 1.05) * (0.1 + 0.9 * lit) * maria;
          col = mix(col, mc * 2.6, smoothstep(1.0, 0.9, r2) * uMoon.w);
        }
      }
    }
    // Sun disc: HDR so bloom turns it into a glow.
    float sd = dot(d, uDisc.xyz);
    col += mix(uSunColor, vec3(1.0, 0.95, 0.85), 0.5) * smoothstep(0.9990, 0.9996, sd) * 6.0 * uDisc.w;
  }

  // Two cloud layers: a low, fast cumulus deck and a high, slow, stretched one.
  if (h > -0.02) {
    float thr = mix(0.66, 0.4, uCloudCover);
    vec2 sunXZ = normalize(uDisc.xz + vec2(1e-4));
    float fade = smoothstep(0.0, 0.2, h);
    // Low deck.
    vec2 p1 = d.xz / (h + 0.2) * 1.1 + uWind * uTime * 0.012;
    float n1 = fbm3(p1 * 1.3);
    float n1s = fbm3((p1 + sunXZ * 0.16) * 1.3);
    float c1 = smoothstep(thr, thr + 0.2, n1) * fade;
    float lit1 = clamp((n1 - n1s) * 5.0 + 0.55, 0.0, 1.0);
    vec3 cc1 = mix(uCloudDark, uCloudLit, lit1);
    col = mix(col, cc1, c1 * 0.85 * (1.0 - smoothstep(0.55, 0.95, h) * 0.6));
    // High deck: thin streaks.
    vec2 p2 = d.xz / (h + 0.45) * vec2(0.55, 1.5) + uWind * uTime * 0.005 + 7.3;
    float n2 = fbm3(p2 * 1.6);
    float c2 = smoothstep(thr + 0.02, thr + 0.28, n2) * fade * 0.5;
    col = mix(col, mix(uCloudDark, uCloudLit, 0.75) * 1.05, c2);
  }
  return col;
}
`;

// Uniforms SKY_GLSL reads, shared by the dome, the env bake and the water.
export function skyUniforms(env) {
  return {
    uTime: env.uTime,
    uSunColor: env.uSunColor,
    uDisc: env.uDisc,
    uMoon: env.uMoon,
    uStars: env.uStars,
    uGlow: env.uGlow,
    uGlowColor: env.uGlowColor,
    uSkyGround: env.uSkyGround,
    uCloudCover: env.uCloudCover,
    uCloudLit: env.uCloudLit,
    uCloudDark: env.uCloudDark,
    uWind: env.uWind,
    uZenith: env.uSkyZenith,
    uHorizon: env.uSkyHorizon,
  };
}

export function createSkyMaterial(env, bake = false) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: !bake, // runtime: only shade pixels no geometry covered (sky draws last)
    fog: false,
    uniforms: skyUniforms(env),
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.99999; // far plane, but inside the depth range
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        gl_FragColor = vec4(skyFull(normalize(vDir), ${bake ? '1.0' : '0.0'}), 1.0);
      }`,
  });
}

// Visible sky dome. Draws after all opaque geometry (renderOrder) with depth
// testing on, so the clouds are only shaded where the sky is actually visible.
export function createSky(env) {
  const material = createSkyMaterial(env, false);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  return { mesh, material };
}
