import * as THREE from 'three';
import { NOISE_GLSL } from './common.js';

// Gradient sky dome: zenith -> horizon haze, a soft sun glow and a faint
// drifting cloud band. Fog-free; follows the camera so it never clips.
export function createSky(env) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: env.uTime,
      uSunDir: env.uSunDir,
      uSunColor: env.uSunColor,
      uZenith: env.uSkyZenith,
      uHorizon: env.uSkyHorizon,
      uGlow: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uGlow;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float up = smoothstep(-0.02, 0.75, h);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.7));
        // Haze band hugging the horizon, and below it.
        col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.22, abs(h))) * 0.55);
        if (h < 0.0) col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.3, h));
        // Sun glow and disc.
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55) * uGlow;
        col += uSunColor * smoothstep(0.9975, 0.9992, sd) * 2.2 * uGlow;
        // Thin drifting clouds, lit from the sun side.
        vec2 cp = d.xz / (h + 0.28) * 1.4 + vec2(uTime * 0.004, 0.0);
        float c = smoothstep(0.5, 0.78, fbm3(cp * 1.2)) * smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.5, 0.9, h));
        col = mix(col, mix(uHorizon, uSunColor, 0.4) * 1.15, c * 0.45);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return { mesh, material };
}
