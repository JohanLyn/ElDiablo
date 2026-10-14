import * as THREE from 'three';

// Exponential distance fog + height fog with sun-tinted in-scattering.
//
// three's built-in fog chunks are replaced globally, so every material that
// has `fog: true` (all MeshStandardMaterials, canals, water...) gets it for
// free; custom additive shaders use FOG_GLSL / fogUniforms() to stay consistent.
//
//   tau   = (density * dist)^2 + hDensity * exp(-b * (camY - yRef)) * f(b * dy) * dist
//   fog   = 1 - exp(-tau)
//   color = fogColor + glowColor * lobe(dot(viewRay, glowDir))     (warm toward the sun)
//
// The extra parameters live in shared typed arrays that every material's
// uniform block points at (UniformsUtils.clone keeps typed arrays by
// reference), so world.js updates them once per frame.

export const FOG = {
  // x: height-fog density (per metre), y: falloff per metre of height,
  // z: reference height (metres), w: sun in-scatter amount
  h: new Float32Array([0.0, 0.1, 0.0, 0.0]),
  // xyz: unit direction the fog glows toward, w: lobe sharpness
  s: new Float32Array([0, 0, -1, 4]),
  // xyz: in-scatter colour (linear)
  g: new Float32Array([1, 0.8, 0.5]),
  color: new THREE.Color(),
  density: { value: 0.012 },
};

const EXTRA_UNIFORMS = {
  fogH: { value: FOG.h },
  fogS: { value: FOG.s },
  fogG: { value: FOG.g },
};

// Shared GLSL: fog factor and colour for a world-space position. Used by the
// replaced chunk below and by custom (additive / premultiplied) shaders.
const FOG_FULL = /* glsl */`
vec4 kurFog(vec3 wpos, vec3 camPos, float density, vec3 baseColor, vec4 H, vec4 S, vec3 G) {
  vec3 ray = wpos - camPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-3);
  // Height fog: density H.x * exp(-b * (y - yRef)) integrated along the ray.
  float ec = exp(clamp(-H.y * (camPos.y - H.z), -40.0, 20.0));
  float ep = exp(clamp(-H.y * (wpos.y - H.z), -40.0, 20.0));
  float bdy = H.y * ray.y;
  float k = abs(bdy) < 1e-3 ? ec : (ec - ep) / bdy;
  // Nothing near the hero: height fog ramps in over 25-55 m, distance fog starts at 30 m,
  // and opacity is capped at 0.35 inside 50 m (it only closes in toward the horizon).
  float tauH = H.x * k * dist * smoothstep(25.0, 55.0, dist);
  float tauB = density * 1.3 * max(dist - 30.0, 0.0);
  float amt = 1.0 - exp(-(tauB * tauB + tauH));
  amt = min(amt, mix(0.35, 1.0, smoothstep(50.0, 115.0, dist)));
  float sd = max(dot(dir, S.xyz), 0.0);
  float lobe = pow(sd, S.w) * 0.85 + pow(sd, 1.5) * 0.15;
  return vec4(baseColor + G * lobe * H.w, amt);
}
`;

// Mobile: the same look for a fraction of the ALU. One exp for the height term (the camera end
// of the integral is dropped), a polynomial sun lobe instead of two pow()s, no extra
// direction normalise. Distance falloff, the 30 m clear zone and the near-opacity cap
// match the full version, so regions keep their depth and warmth.
const FOG_CHEAP = /* glsl */`
vec4 kurFog(vec3 wpos, vec3 camPos, float density, vec3 baseColor, vec4 H, vec4 S, vec3 G) {
  vec3 ray = wpos - camPos;
  float dist = length(ray);
  // Height fog integrated along the ray, for a camera far above the fog layer (always true
  // here): the full version's (exp(-b*camY) - exp(-b*y)) / (b*dy) with the camera term dropped.
  float tauH = H.x * exp(clamp(-H.y * (wpos.y - H.z), -20.0, 20.0)) * dist / (H.y * max(abs(ray.y), 0.08 * dist) + 1e-4) * smoothstep(25.0, 55.0, dist);
  float tauB = density * 1.3 * max(dist - 30.0, 0.0);
  float amt = 1.0 - exp(-(tauB * tauB + tauH));
  amt = min(amt, mix(0.35, 1.0, smoothstep(50.0, 115.0, dist)));
  float sd = max(dot(ray, S.xyz) / max(dist, 1e-3), 0.0);
  float lobe = sd * sd * mix(sd, 1.0, 0.25); // ~ the full version's pow(sd, 2.5) lobe
  return vec4(baseColor + G * lobe * H.w, amt);
}
`;
// The shared function lives in a chunk so the variant is picked when the first program
// compiles (installFog), and custom shaders that embed FOG_GLSL get the same one.
const FOG_FN = '#include <kur_fog_fn>\n';

const FRAG_PARS = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  uniform vec4 fogH;
  uniform vec4 fogS;
  uniform vec3 fogG;
  varying float vFogDepth;
  varying vec3 vFogWPos;
  ${FOG_FN}
#endif
`;

const FRAG = /* glsl */`
#ifdef USE_FOG
  vec4 kf = kurFog(vFogWPos, cameraPosition, fogDensity, fogColor, fogH, fogS, fogG);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, kf.rgb, kf.a);
#endif
`;

const VERT_PARS = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWPos;
#endif
`;

const VERT = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif
`;

// Direct rendering (no post-processing chain): three applies tone mapping and the sRGB
// encode inside each material, and its fog_fragment runs *after* them, which would blend
// the linear fog colour into display-space pixels. So here the fog moves into the
// tone-mapping chunk (blend first, in linear HDR like the composer path, then tone map),
// and the fog chunk itself becomes empty.
const TONEMAP_ORIG = THREE.ShaderChunk.tonemapping_fragment;
const TONEMAP_DIRECT = FRAG + TONEMAP_ORIG;

let installed = false;
export function installFog(cheap = false, direct = false) {
  THREE.ShaderChunk.kur_fog_fn = cheap ? FOG_CHEAP : FOG_FULL;
  THREE.ShaderChunk.tonemapping_fragment = direct ? TONEMAP_DIRECT : TONEMAP_ORIG;
  THREE.ShaderChunk.fog_fragment = direct ? '' : FRAG;
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_fragment = FRAG_PARS;
  THREE.ShaderChunk.fog_pars_vertex = VERT_PARS;
  THREE.ShaderChunk.fog_vertex = VERT;
  // Built-in materials clone their uniform block from ShaderLib, so the extra
  // uniforms have to be added to every entry that already carries fog.
  Object.assign(THREE.UniformsLib.fog, EXTRA_UNIFORMS);
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && lib.uniforms.fogColor) Object.assign(lib.uniforms, EXTRA_UNIFORMS);
  }
}

// For custom shaders that do their own fog (additive halos, flames, shafts).
// Add `...fogUniforms()` to `uniforms`, `FOG_GLSL` to the fragment shader and
// call `kurFogAt(worldPos)` -> vec4(colour, amount). `uniform vec3 cameraPosition`
// is provided by three.
export function fogUniforms() {
  return { fogColor: { value: FOG.color }, fogDensity: FOG.density, ...EXTRA_UNIFORMS };
}
export const FOG_GLSL = /* glsl */`
uniform vec3 fogColor; uniform float fogDensity; uniform vec4 fogH; uniform vec4 fogS; uniform vec3 fogG;
${FOG_FN}
vec4 kurFogAt(vec3 wpos) { return kurFog(wpos, cameraPosition, fogDensity, fogColor, fogH, fogS, fogG); }
// 1 = fully visible, 0 = swallowed by fog (additive things multiply by this).
float kurTransmit(vec3 wpos) { return 1.0 - kurFogAt(wpos).a; }
`;

installFog();
