import { getEnv, NOISE_GLSL } from './common.js';
import { GFX, noiseUniform, NOISE_TEX_GLSL } from '../../core/gfx.js';

// Adds world-space wind sway and drifting cloud shadows to any
// MeshStandardMaterial (works for plain meshes and InstancedMesh).
//   sway:  tree/reed sway, grows with local height squared
//   cloth: banner flutter, grows with distance below the top edge (y <= 0)
export function patchLit(material, { sway = 0, cloth = 0, cloud = true } = {}) {
  const env = getEnv();
  material.onBeforeCompile = (shader) => {
    const cheap = GFX.cheap; // Mobile: cloud shadows from the baked noise texture
    shader.uniforms.uTime = env.uTime;
    if (cheap && cloud) shader.uniforms.uNoiseTex = noiseUniform;
    shader.uniforms.uWind = env.uWind;
    shader.uniforms.uCloud = env.uCloud;
    shader.uniforms.uSway = { value: sway };
    shader.uniforms.uCloth = { value: cloth };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway, uCloth; uniform vec2 uWind; varying vec3 vWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          mat4 lm = modelMatrix * instanceMatrix;
        #else
          mat4 lm = modelMatrix;
        #endif
        vec3 sorg = vec3(lm[3]);
        float sph = sorg.x * 0.31 + sorg.z * 0.23;
        float sw = sin(uTime * 1.5 + sph) * 0.6 + sin(uTime * 2.7 + sph * 1.9) * 0.3;
        float sk = uSway * transformed.y * transformed.y;
        transformed.x += sw * sk * uWind.x;
        transformed.z += sw * sk * uWind.y;
        float ck = uCloth * max(0.0, -transformed.y);
        transformed.z += (sin(uTime * 3.1 + transformed.x * 2.3 + sph) * 0.6 + sin(uTime * 5.3 + transformed.y * 3.0)) * ck * 0.12 * (0.4 + uWind.x * 0.4);
        transformed.x += sin(uTime * 2.2 + sph) * ck * 0.04;
        vWP = (lm * vec4(transformed, 1.0)).xyz;`);
    if (cloud) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWP; uniform float uTime, uCloud; uniform vec2 uWind;
          ${cheap ? NOISE_TEX_GLSL : NOISE_GLSL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float cloudSh = 1.0 - uCloud * smoothstep(0.46, 0.72, ${cheap ? 'cloudN' : 'fbm3'}(vWP.xz * 0.011 + uWind * uTime * 0.012));
          reflectedLight.directDiffuse *= cloudSh;
          reflectedLight.directSpecular *= cloudSh;`);
    }
  };
  material.customProgramCacheKey = () => `lit-${sway}-${cloth}-${cloud}${GFX.cheap ? '-c' : ''}`;
  return material;
}
