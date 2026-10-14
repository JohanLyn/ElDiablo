import * as THREE from 'three';
import { heightAt, isWater, WATER_LEVEL } from '../terrain.js';
import { SKY_GLSL, skyUniforms } from './sky.js';

const CX = -125, CZ = 0, W = 200, D = 260;

// Marsh water: depth-aware colour from a baked height texture, fresnel sky
// tint, animated ripple normals, soft shore foam and a sun glint.
export function createWater(env) {
  const TW = 160, TH = 208;
  const data = new Uint16Array(TW * TH);
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const x = CX - W / 2 + ((i + 0.5) / TW) * W;
      const z = CZ - D / 2 + ((j + 0.5) / TH) * D;
      const depth = isWater(x, z) ? Math.max(0, WATER_LEVEL - heightAt(x, z)) : 0;
      data[j * TW + i] = THREE.DataUtils.toHalfFloat(depth);
    }
  }
  const tex = new THREE.DataTexture(data, TW, TH, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...skyUniforms(env),
      uDepth: { value: tex },
      uSunDir: env.uSunDir,
      uSunK: env.uSunK,
      uAmbient: env.uAmbient,
      uLP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, // nearby emitters: xyz, range
      uLC: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) }, // colour * intensity
      uRect: { value: new THREE.Vector4(CX - W / 2, CZ - D / 2, W, D) },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uDepth;
      uniform vec3 uSunDir, uAmbient;
      uniform float uSunK;
      uniform vec4 uRect;
      uniform vec4 uLP[4];
      uniform vec3 uLC[4];
      varying vec3 vWPos;
      ${SKY_GLSL}
      float rippleH(vec2 p, float t) {
        float a = vnoise(p * 0.9 + vec2(t * 0.22, t * 0.13));
        float b = vnoise(p * 2.1 - vec2(t * 0.31, -t * 0.2) + 5.0);
        float c = vnoise(p * 4.6 + vec2(-t * 0.4, t * 0.35) + 11.0);
        return a * 0.55 + b * 0.3 + c * 0.15;
      }
      void main() {
        vec2 uv = (vWPos.xz - uRect.xy) / uRect.zw;
        float depth = texture2D(uDepth, uv).r;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float cover = smoothstep(0.0, 0.07, depth) * inside;
        if (cover < 0.01) discard;

        vec2 p = vWPos.xz;
        float e = 0.08, t = uTime;
        float h0 = rippleH(p, t);
        float hx = rippleH(p + vec2(e, 0.0), t) - h0;
        float hz = rippleH(p + vec2(0.0, e), t) - h0;
        vec3 n = normalize(vec3(-hx / e * 0.32, 1.0, -hz / e * 0.32));
        vec3 V = normalize(cameraPosition - vWPos);
        float ndv = clamp(dot(n, V), 0.0, 1.0);

        // Depth colour: yellow-green shallows to deep teal-lapis, lit by the scene's ambient light.
        float dk = 1.0 - exp(-depth * 1.7);
        vec3 shallow = vec3(0.16, 0.34, 0.22);
        vec3 deepC = vec3(0.01, 0.05, 0.075);
        vec3 water = mix(shallow, deepC, dk);
        water += vec3(0.02, 0.05, 0.04) * (h0 - 0.4);
        water *= uAmbient;

        // Fresnel reflection of the live sky (boosted for the high game camera).
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        vec3 sky = skyGradient(R, 0.0);
        float fres = 0.12 + 0.88 * pow(1.0 - ndv, 2.2);
        vec3 col = mix(water, sky * 0.85, clamp(fres * 0.95, 0.0, 0.8));

        // Sun / moon glints. The key light sits behind the camera in this view, so
        // the glint direction is mirrored to the far side (art-directed, always visible).
        vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.32), -abs(uSunDir.z) - 0.4));
        vec3 H = normalize(L + V);
        float nh = max(dot(n, H), 0.0);
        float glint = pow(nh, 150.0) * 1.7 + pow(nh, 22.0) * 0.14;
        col += uSunColor * glint * (0.35 + 0.9 * uSunK) * (0.5 + 0.5 * uAmbient.b);

        // Lantern / torch reflections on the surface.
        for (int i = 0; i < 4; i++) {
          vec4 lp = uLP[i];
          if (lp.w <= 0.0) continue;
          vec3 ld = lp.xyz - vWPos;
          float dist = length(ld);
          ld /= dist;
          float att = clamp(1.0 - dist / lp.w, 0.0, 1.0);
          att *= att;
          float sp = pow(max(dot(n, normalize(ld + V)), 0.0), 90.0);
          col += uLC[i] * att * (sp * 0.6 + 0.012);
        }

        // Shore foam: soft, slowly breathing lines hugging the bank.
        float foamZone = 1.0 - smoothstep(0.02, 0.16, depth);
        float lines = sin((depth * 22.0) - t * 1.3 + h0 * 6.0) * 0.5 + 0.5;
        float foamN = vnoise(p * 1.7 + t * 0.15);
        float foam = foamZone * (smoothstep(0.6, 0.95, lines) * 0.4 + smoothstep(0.07, 0.0, depth) * 0.45) * smoothstep(0.35, 0.75, foamN + 0.2);
        col = mix(col, vec3(0.86, 0.9, 0.76) * uAmbient, clamp(foam, 0.0, 0.6));

        float alpha = cover * mix(0.55, 0.93, dk);
        alpha = max(alpha, foam * 0.8 * cover);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(CX, WATER_LEVEL, CZ);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, material };
}
