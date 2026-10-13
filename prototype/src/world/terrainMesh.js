import * as THREE from 'three';
import { HALF, REGIONS, TOWN } from './layout.js';
import { heightAt, groundColor, WATER_LEVEL, isWater, regionAt, marshWetness, roadLateral } from './terrain.js';
import { NOISE_GLSL } from './shaders/common.js';
import { createWater } from './shaders/water.js';

const REGION_COLORS = Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [k, v.ground]));

// Procedural ground material. Vertex colours stay the base (so the minimap
// matches); the fragment shader splats grass / mud / sand / ash by region
// weights, rock by slope, adds wet shores, road ruts, cloud shadows and
// fine relief normals.
function patchTerrainMaterial(material, env) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWind = env.uWind;
    shader.uniforms.uCloud = env.uCloud;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aReg; attribute vec4 aMisc;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vReg; varying vec4 vMisc;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNrm = normal; vReg = aReg; vMisc = aMisc;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vReg; varying vec4 vMisc;
        uniform float uTime; uniform vec2 uWind; uniform float uCloud;
        ${NOISE_GLSL}
        vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 19.19)); }
        float crackEdge(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = hash22(i + g);
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return d2 - d1;
        }
        float bumpH(vec2 p, float wR) {
          float ripple = sin(dot(p, vec2(0.86, 0.5)) * 1.7 + vnoise(p * 0.1) * 8.0);
          return vnoise(p * 0.9) * 0.5 + wR * ripple * 0.3;
        }`)
      .replace('#include <color_fragment>', `
        vec2 gp = vWPos.xz;
        float n1 = vnoise(gp * 1.3);
        float n2 = vnoise(gp * 0.16 + 7.0);
        float n3 = vnoise(gp * 0.045 + 3.0);
        float nf = vnoise(gp * 3.7);
        vec3 gN = normalize(vWNrm);
        float slope = 1.0 - gN.y;
        float wS = vReg.x, wM = vReg.y, wR = vReg.z, wA = vReg.w;
        float wT = clamp(1.0 - wS - wM - wR - wA, 0.0, 1.0);
        vec3 vbase = vColor.rgb;

        // Sunfields: lush to sun-dried grass in broad painterly patches.
        float dryK = smoothstep(0.38, 0.72, n3 * 0.65 + n2 * 0.55);
        vec3 cS = mix(vec3(0.15, 0.29, 0.065), vec3(0.50, 0.41, 0.14), dryK) * (0.82 + 0.4 * n1);
        cS = mix(cS, vbase * vec3(0.75, 0.85, 0.7), 0.28) * (0.94 + 0.12 * nf);
        // Marsh: moss and dark mud.
        float mudK = smoothstep(0.35, 0.72, n2 + vMisc.x * 0.4);
        vec3 cM = mix(vec3(0.075, 0.2, 0.085), vec3(0.11, 0.085, 0.05), mudK) * (0.8 + 0.45 * n1);
        cM = mix(cM, vbase * 0.55, 0.22);
        // Ruins: sun-bleached sand with soft ripple bands.
        float rip = sin(dot(gp, vec2(0.86, 0.5)) * 2.1 + vnoise(gp * 0.12) * 9.0) * 0.5 + 0.5;
        vec3 cR = mix(vec3(0.6, 0.43, 0.23), vec3(0.8, 0.64, 0.38), rip * 0.75 + n2 * 0.5) * (0.9 + 0.2 * n1);
        cR = mix(cR, vbase, 0.18);
        cR *= 0.94 + 0.12 * nf;
        // Ashen: charred basalt dusted with pale ash.
        vec3 cA = mix(vec3(0.07, 0.055, 0.075), vec3(0.2, 0.17, 0.2), smoothstep(0.4, 0.75, n2 * 0.7 + n1 * 0.4)) * (0.85 + 0.3 * nf);
        // Town: packed clay with a flagstone plaza.
        vec3 cT = vec3(0.45, 0.31, 0.19) * (0.88 + 0.24 * n1);
        float plaza = 1.0 - smoothstep(13.0, 19.0, length(gp - vec2(${TOWN.x.toFixed(1)}, ${TOWN.z.toFixed(1)})));
        vec2 fc = gp / 2.2; fc.x += 0.5 * mod(floor(fc.y), 2.0);
        vec2 ff = fract(fc);
        float edge = min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y));
        float stoneTone = hash21(floor(fc));
        vec3 flag = vec3(0.56, 0.42, 0.28) * (0.8 + 0.34 * stoneTone) * mix(0.62, 1.0, smoothstep(0.0, 0.07, edge));
        cT = mix(cT, flag, plaza * 0.85);

        vec3 col = cS * wS + cM * wM + cR * wR + cA * wA + cT * wT;

        // Rock on slopes, with horizontal strata.
        float strata = sin(vWPos.y * 5.5 + n1 * 2.2) * 0.5 + 0.5;
        vec3 rockC = mix(vec3(0.30, 0.25, 0.2), vec3(0.2, 0.17, 0.16), wM);
        rockC = mix(rockC, vec3(0.56, 0.4, 0.27), wR);
        rockC = mix(rockC, vec3(0.13, 0.1, 0.14), wA);
        rockC *= 0.8 + 0.35 * strata;
        float rockK = smoothstep(0.2, 0.4, slope + (n1 - 0.5) * 0.12) * (1.0 - wT);
        col = mix(col, rockC, rockK);

        // Wet shore: dark, glossy mud near the waterline.
        float wetK = (1.0 - smoothstep(${WATER_LEVEL.toFixed(2)}, ${(WATER_LEVEL + 0.75).toFixed(2)}, vWPos.y)) * smoothstep(0.1, 0.5, wM + vMisc.x);
        col = mix(col, col * vec3(0.5, 0.48, 0.42), wetK);

        // Roads: packed dirt, wheel ruts, ragged edges.
        float lat = abs(vMisc.y);
        float roadK = (1.0 - smoothstep(1.9, 3.0, lat + (n1 - 0.5) * 1.1)) * (1.0 - smoothstep(0.35, 0.8, wT));
        vec3 dirt = vec3(0.4, 0.28, 0.17) * (0.86 + 0.3 * n1) * (1.0 + 0.5 * wR);
        dirt = mix(dirt, vec3(0.17, 0.13, 0.13) * (0.8 + 0.4 * n1), wA);
        float rut = exp(-pow((lat - 0.8) / 0.22, 2.0)) * (0.5 + 0.5 * vnoise(gp * vec2(0.35, 0.35)));
        dirt *= 1.0 - 0.28 * rut;
        col = mix(col, dirt, roadK * 0.92);

        // Painterly breakup at ~8 m and ~1 m.
        col *= 0.9 + 0.2 * n2;

        diffuseColor.rgb = col;
        float cloudSh = 1.0 - uCloud * smoothstep(0.46, 0.72, fbm3(gp * 0.011 + uWind * uTime * 0.012));

        // Ashen cracks that glow violet.
        vec2 cq = gp * 0.075 + vec2(vnoise(gp * 0.09), vnoise(gp * 0.09 + 9.0)) * 1.1;
        float crackV = crackEdge(cq);
        float crackMask = smoothstep(0.42, 0.66, vnoise(gp * 0.03 + 21.0) + n2 * 0.25);
        float crack = (1.0 - smoothstep(0.0, 0.035, crackV)) * crackMask * wA * (1.0 - roadK);
        diffuseColor.rgb *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.14, crackV)) * crackMask * wA;
        float crackPulse = 1.5 + 0.6 * sin(uTime * 1.3 + n2 * 12.0);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.38, wetK);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float bE = 0.25;
          float b0 = bumpH(gp, wR);
          float bx = bumpH(gp + vec2(bE, 0.0), wR) - b0;
          float bz = bumpH(gp + vec2(0.0, bE), wR) - b0;
          vec3 dW = vec3(-bx, 0.0, -bz) / bE * (0.2 + 0.5 * wR + 0.1 * wetK);
          normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.62, 0.16, 1.0) * crack * crackPulse;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= cloudSh;
        reflectedLight.directSpecular *= cloudSh;`);
  };
  material.customProgramCacheKey = () => 'terrain-v1';
}

export function buildTerrain(scene, env) {
  const size = HALF * 2;
  const segs = 220;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const reg = new Float32Array(n * 4);
  const misc = new Float32Array(n * 4);
  const R = ['sunfields', 'marsh', 'ruins', 'ashen'];
  const taps = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const [r, g, b] = groundColor(x, z, REGION_COLORS);
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    // Soft region weights so materials blend across region borders.
    for (const [dx, dz] of taps) {
      const k = R.indexOf(regionAt(x + dx, z + dz));
      if (k >= 0) reg[i * 4 + k] += 1 / taps.length;
    }
    misc[i * 4] = marshWetness(x, z);
    misc[i * 4 + 1] = Math.max(-14, Math.min(14, roadLateral(x, z)));
  }
  // Light blur of the vertex colours to hide the 2 m grid at region edges.
  const W = segs + 1;
  const blurred = new Float32Array(colors);
  for (let zi = 1; zi < segs; zi++) {
    for (let xi = 1; xi < segs; xi++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += colors[((zi + dz) * W + xi + dx) * 3 + c] * (dx === 0 && dz === 0 ? 2 : 1);
        blurred[(zi * W + xi) * 3 + c] = s / 10;
      }
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(blurred, 3));
  geo.setAttribute('aReg', new THREE.BufferAttribute(reg, 4));
  geo.setAttribute('aMisc', new THREE.BufferAttribute(misc, 4));
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  patchTerrainMaterial(material, env);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const water = createWater(env);
  scene.add(water.mesh);

  return { mesh, water };
}

// Painted overview of the world for the minimap and the full map (1 px = 2 m).
export function buildMapImage() {
  const res = 220;
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d');
  const img = g.createImageData(res, res);
  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const x = (px / res) * HALF * 2 - HALF, z = (py / res) * HALF * 2 - HALF;
      let [r, gg, b] = groundColor(x, z, REGION_COLORS);
      if (isWater(x, z)) { r = 0.18; gg = 0.36; b = 0.38; }
      const h = heightAt(x, z);
      const lift = Math.max(-0.15, Math.min(0.2, h * 0.03));
      const i = (py * res + px) * 4;
      img.data[i] = Math.min(255, (r + lift) * 255);
      img.data[i + 1] = Math.min(255, (gg + lift) * 255);
      img.data[i + 2] = Math.min(255, (b + lift) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
