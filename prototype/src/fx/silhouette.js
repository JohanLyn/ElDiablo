import * as THREE from 'three';

// Occlusion silhouette: a second draw of a character's skinned mesh that only
// shows where something else is in front of it (walls, trees, props). It shares
// the geometry and skeleton of the real mesh, so it costs one extra draw call and
// no extra animation work. The depth test is inverted (GreaterDepth) and nothing
// is written to depth.
//
// Draw order matters: every character mesh draws at renderOrder CHAR_ORDER, after
// the silhouettes (renderOrder SIL_ORDER), and after the world. The silhouette
// therefore tests against the world only; it cannot "see" the character's own
// overlapping limbs and plates, and the character paints over it wherever it is in
// front. The silhouette sits in the opaque queue (so it sorts before the
// characters) but blends with custom blending.
export const SIL_ORDER = 1;
export const CHAR_ORDER = 2;

const STYLES = {
  // Lapis fill with a bright gold rim: the hero is never lost behind a building.
  hero: { fill: [0.07, 0.2, 0.78], edge: [1.0, 0.74, 0.28], alpha: 0.46, edgeAlpha: 0.95 },
  // Elites and named monsters: a quieter ember outline so threats stay findable.
  foe: { fill: [0.5, 0.12, 0.06], edge: [1.0, 0.45, 0.2], alpha: 0.2, edgeAlpha: 0.6 },
  // Guardians: violet-gold, a little stronger than ordinary elites.
  boss: { fill: [0.32, 0.12, 0.62], edge: [0.85, 0.65, 1.0], alpha: 0.26, edgeAlpha: 0.75 },
};

const cache = {};
function silhouetteMaterial(kind) {
  if (cache[kind]) return cache[kind];
  const s = STYLES[kind];
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: false, depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    fog: false,
  });
  const u = {
    uFillC: { value: new THREE.Vector3(...s.fill) },
    uEdgeC: { value: new THREE.Vector3(...s.edge) },
    uAlpha: { value: s.alpha },
    uEdgeAlpha: { value: s.edgeAlpha },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSilN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSilN = transformedNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSilN;\nuniform vec3 uFillC;\nuniform vec3 uEdgeC;\nuniform float uAlpha;\nuniform float uEdgeAlpha;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float silF = 1.0 - abs(normalize(vSilN).z);
        float silE = smoothstep(0.3, 0.92, silF);
        gl_FragColor = vec4(mix(uFillC, uEdgeC, silE), mix(uAlpha, uEdgeAlpha, silE));`);
  };
  mat.customProgramCacheKey = () => 'silhouette1';
  cache[kind] = mat;
  return mat;
}

// Adds the silhouette beside `mesh` (a SkinnedMesh) and returns it.
export function addOcclusionOutline(mesh, kind = 'hero') {
  const m = new THREE.SkinnedMesh(mesh.geometry, silhouetteMaterial(kind));
  m.bind(mesh.skeleton, mesh.bindMatrix);
  m.boundingSphere = mesh.boundingSphere;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = SIL_ORDER;
  m.name = 'occlusionOutline';
  mesh.parent.add(m);
  return m;
}
