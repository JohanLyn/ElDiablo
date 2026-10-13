import * as THREE from 'three';
import { Colliders } from './colliders.js';
import { buildTerrain, buildMapImage } from './terrainMesh.js';
import { scatterProps } from './props.js';
import { buildCanals } from './canals.js';
import { buildLandmarks } from './landmarks.js';
import { buildTown } from './town.js';
import { buildDungeon } from './dungeon.js';
import { makeWaypoint, makeShrine, makeChest, makeGate } from './models.js';
import { WAYPOINTS, SHRINES, CHESTS, EVENT, GATE, REGIONS } from './layout.js';
import { heightAt, regionAt } from './terrain.js';
import { damp } from '../core/util.js';
import { createEnv } from './shaders/common.js';
import { createSky } from './shaders/sky.js';
import { Grass } from './shaders/grass.js';
import { createParticles, PARTICLE_MIX } from './shaders/particles.js';

// Mood per region: sky colours, fog (= sky horizon, so distant ground melts into
// the sky), light colours/strength and the filmic grade.
const ATMOS_DEF = {
  town: {
    horizon: 0xf0c68c, zenith: 0x4c7fc2, near: 36, far: 130, hemi: 0.85, sun: 2.0, sunColor: 0xffd6a0,
    hemiSky: 0xaecbff, hemiGround: 0x84603a, fill: 0.35, fillColor: 0x9bb4ff, cloud: 0.26, glow: 1,
    grade: { shadow: 0x4d3a58, highlight: 0xffd496, split: 0.2, saturation: 1.16, contrast: 1.08 },
  },
  sunfields: {
    horizon: 0xf0c68c, zenith: 0x4c7fc2, near: 36, far: 130, hemi: 0.85, sun: 2.0, sunColor: 0xffd6a0,
    hemiSky: 0xaecbff, hemiGround: 0x84603a, fill: 0.35, fillColor: 0x9bb4ff, cloud: 0.26, glow: 1,
    grade: { shadow: 0x4d3a58, highlight: 0xffd496, split: 0.2, saturation: 1.16, contrast: 1.08 },
  },
  marsh: {
    horizon: 0x8cab98, zenith: 0x2f5f68, near: 24, far: 100, hemi: 0.78, sun: 1.45, sunColor: 0xf1e8b0,
    hemiSky: 0x9fd0c8, hemiGround: 0x3f5238, fill: 0.4, fillColor: 0x6fb0b0, cloud: 0.34, glow: 0.7,
    grade: { shadow: 0x1c4a4a, highlight: 0xe6f2b4, split: 0.22, saturation: 1.12, contrast: 1.05 },
  },
  ruins: {
    horizon: 0xe3c796, zenith: 0x6a98c8, near: 40, far: 150, hemi: 0.8, sun: 2.0, sunColor: 0xfff0d0,
    hemiSky: 0xd6dcff, hemiGround: 0xa07a4a, fill: 0.3, fillColor: 0xb7c4ff, cloud: 0.1, glow: 1.3,
    grade: { shadow: 0x5a4650, highlight: 0xfff0d2, split: 0.16, saturation: 0.96, contrast: 1.12 },
  },
  ashen: {
    horizon: 0x5b3b57, zenith: 0x1d1530, near: 22, far: 90, hemi: 0.85, sun: 1.3, sunColor: 0xffa588,
    hemiSky: 0x7a6a90, hemiGround: 0x2e1d33, fill: 0.45, fillColor: 0x6a5a8a, cloud: 0.12, glow: 0.9,
    grade: { shadow: 0x2a1a40, highlight: 0xf0c4b4, split: 0.18, saturation: 0.86, contrast: 1.12 },
  },
  dungeon: {
    horizon: 0x15101c, zenith: 0x0c0912, near: 26, far: 80, hemi: 1.25, sun: 0, sunColor: 0x8a7aff,
    hemiSky: 0x7a78c0, hemiGround: 0x4a3038, fill: 0.0, fillColor: 0x5a6aff, cloud: 0, glow: 0,
    grade: { shadow: 0x161a46, highlight: 0xffa86a, split: 0.25, saturation: 1.08, contrast: 1.08 },
  },
};
const COLOR_KEYS = ['horizon', 'zenith', 'sunColor', 'hemiSky', 'hemiGround', 'fillColor'];
const NUM_KEYS = ['near', 'far', 'hemi', 'sun', 'fill', 'cloud', 'glow'];
const GRADE_COLORS = ['shadow', 'highlight'];
const GRADE_NUMS = ['split', 'saturation', 'contrast'];
const ATMOS = Object.fromEntries(Object.entries(ATMOS_DEF).map(([id, d]) => {
  const o = { ...d.grade };
  for (const k of NUM_KEYS) o[k] = d[k];
  for (const k of [...COLOR_KEYS, ...GRADE_COLORS]) o[k] = new THREE.Color(d[k] ?? d.grade[k]);
  return [id, o];
}));
const SUN_OFFSET = new THREE.Vector3(-30, 26, 12);

export const SHRINE_TYPES = {
  shamash: { name: 'Shrine of Shamash', color: 0xffd060, buff: 'Blessing of Shamash: +40% Damage', stats: { dmgPct: 40 } },
  enki: { name: 'Shrine of Enki', color: 0x4fd0ff, buff: 'Blessing of Enki: +8 Anima per Second', stats: { animaRegen: 8 } },
  ninurta: { name: 'Shrine of Ninurta', color: 0x8cff6a, buff: 'Blessing of Ninurta: +30% Movement and Attack Speed', stats: { moveSpeed: 30, attackSpeed: 30 } },
  ishtar: { name: 'Shrine of Ishtar', color: 0xff6aa8, buff: 'Blessing of Ishtar: +25% Critical Strike Chance', stats: { critChance: 25 } },
};

export function buildWorld(scene, settings = null) {
  const colliders = new Colliders();
  const env = createEnv();
  const start = ATMOS.sunfields;
  scene.background = new THREE.Color(start.horizon);
  scene.fog = new THREE.Fog(start.horizon, start.near, start.far);

  const sky = createSky(env);
  scene.add(sky.mesh);

  // Warm key + cool fill + sky/ground hemisphere.
  const hemi = new THREE.HemisphereLight(0xb8c4ff, 0x6a4a2a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 130 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9bb4ff, 0.35);
  fill.position.set(26, 14, -20);
  scene.add(fill, fill.target);

  buildTerrain(scene, env);
  const grass = new Grass(scene, env, settings);
  const particles = createParticles(env, settings);
  scene.add(particles.points);
  buildCanals(scene);
  buildLandmarks(scene, colliders);
  scatterProps(scene, colliders);
  const town = buildTown(scene, colliders);
  const dungeon = buildDungeon(scene, colliders);
  const mapImage = buildMapImage();

  const place = (obj, x, z) => { obj.position.set(x, heightAt(x, z), z); scene.add(obj); return obj; };

  const waypoints = WAYPOINTS.map((w) => {
    const model = place(makeWaypoint(), w.x, w.z);
    colliders.addCircle(w.x, w.z, 0.7);
    return { ...w, model, discovered: false };
  });
  const shrines = SHRINES.map((s) => {
    const def = SHRINE_TYPES[s.kind];
    const model = place(makeShrine(def.color), s.x, s.z);
    colliders.addCircle(s.x, s.z, 1.1);
    return { ...s, def, model, cooldown: 0 };
  });
  const chests = CHESTS.map((c) => {
    const model = place(makeChest(c.tier), c.x, c.z);
    model.rotation.y = Math.atan2(-c.x, -c.z) + Math.PI; // roughly face the world centre
    colliders.addCircle(c.x, c.z, 0.8);
    return { ...c, model, opened: false };
  });

  // Ritual circle for the world event.
  const ritual = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a4a44, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.6), stoneMat);
    s.position.set(Math.cos(a) * EVENT.r, 1.1, Math.sin(a) * EVENT.r);
    s.rotation.y = -a;
    s.castShadow = true;
    ritual.add(s);
    colliders.addCircle(EVENT.x + Math.cos(a) * EVENT.r, EVENT.z + Math.sin(a) * EVENT.r, 0.5);
  }
  const ritualRingMat = new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const ritualRing = new THREE.Mesh(new THREE.RingGeometry(EVENT.r - 0.6, EVENT.r, 48), ritualRingMat);
  ritualRing.rotation.x = -Math.PI / 2;
  ritualRing.position.y = 0.08;
  ritual.add(ritualRing);
  place(ritual, EVENT.x, EVENT.z);

  const gate = makeGate();
  place(gate, GATE.x, GATE.z);
  colliders.addBox(GATE.x - 24, GATE.z - 2, GATE.x - 5, GATE.z + 2.5);
  colliders.addBox(GATE.x + 5, GATE.z - 2, GATE.x + 24, GATE.z + 2.5);
  colliders.addBox(GATE.x - 5, GATE.z - 2, GATE.x + 5, GATE.z - 0.5);

  // Blended atmosphere state.
  const cur = { ...ATMOS.sunfields };
  for (const k of [...COLOR_KEYS, ...GRADE_COLORS]) cur[k] = ATMOS.sunfields[k].clone();
  let inDungeon = false;
  const lastPos = new THREE.Vector3();
  let clock = 0;
  const partMix = Float32Array.from(PARTICLE_MIX.sunfields);
  const tmpDir = new THREE.Vector3();
  const tmpDir2 = new THREE.Vector2();
  const right = new THREE.Vector3(), camUp = new THREE.Vector3(), snapped = new THREE.Vector3();
  const sunDir = SUN_OFFSET.clone().normalize();
  env.uSunDir.value.copy(sunDir);

  return {
    colliders,
    occluders: town.occluders,
    npcs: town.npcs,
    mapImage,
    waypoints,
    shrines,
    chests,
    ritual: { ...EVENT, ringMat: ritualRingMat, group: ritual },
    gate,
    dungeon,
    heightAt,
    regionAt,
    sun,

    update(dt, t, playerPos, renderer = null) {
      const region = regionAt(playerPos.x, playerPos.z);
      const target = ATMOS[region];
      const nowDungeon = region === 'dungeon';
      // Snap instantly when entering or leaving the dungeon, blend otherwise.
      const jumped = playerPos.distanceToSquared(lastPos) > 400;
      lastPos.copy(playerPos);
      const k = nowDungeon !== inDungeon || jumped ? 1 : damp(1.5, dt);
      inDungeon = nowDungeon;
      for (const key of NUM_KEYS) cur[key] += (target[key] - cur[key]) * k;
      for (const key of GRADE_NUMS) cur[key] += (target[key] - cur[key]) * k;
      for (const key of [...COLOR_KEYS, ...GRADE_COLORS]) cur[key].lerp(target[key], k);
      clock = (clock + dt) % 3600;
      env.uTime.value = clock;
      env.uPlayer.value.copy(playerPos);
      env.uCloud.value = cur.cloud;
      env.uSunColor.value.copy(cur.sunColor);
      env.uSkyZenith.value.copy(cur.zenith);
      env.uSkyHorizon.value.copy(cur.horizon);
      // Slowly wandering wind direction.
      env.uWind.value.set(Math.cos(clock * 0.05) * 0.8 + 0.6, Math.sin(clock * 0.04) * 0.5 + 0.2);
      sky.material.uniforms.uGlow.value = cur.glow;

      scene.fog.color.copy(cur.horizon);
      scene.background.copy(cur.horizon);
      scene.fog.near = cur.near;
      scene.fog.far = cur.far;
      hemi.color.copy(cur.hemiSky);
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemi;
      sun.color.copy(cur.sunColor);
      sun.intensity = cur.sun;
      fill.color.copy(cur.fillColor);
      fill.intensity = cur.fill;
      fill.position.set(playerPos.x + 26, playerPos.y + 14, playerPos.z - 20);
      fill.target.position.copy(playerPos);

      // The sun's shadow box follows the hero, snapped to shadow texels so edges don't swim.
      const texel = 64 / sun.shadow.mapSize.x;
      right.set(0, 1, 0).cross(sunDir).normalize();
      camUp.copy(sunDir).cross(right);
      const tx = playerPos.dot(right), ty = playerPos.dot(camUp);
      snapped.copy(playerPos)
        .addScaledVector(right, Math.round(tx / texel) * texel - tx)
        .addScaledVector(camUp, Math.round(ty / texel) * texel - ty);
      sun.position.copy(snapped).addScaledVector(SUN_OFFSET, 1);
      sun.target.position.copy(snapped);

      if (renderer) {
        renderer.setGrade({ shadow: cur.shadow, highlight: cur.highlight, split: cur.split, saturation: cur.saturation, contrast: cur.contrast });
        if (renderer.camera) {
          sky.mesh.position.copy(renderer.camera.position);
          const sz = renderer.webgl.getDrawingBufferSize(tmpDir2);
          particles.update(playerPos, partMix, sz.y, renderer.camera.fov);
          env.uPxScale.value = particles.uniforms.uScale.value;
        }
      }
      const target6 = PARTICLE_MIX[region];
      for (let i = 0; i < 6; i++) partMix[i] += (target6[i] - partMix[i]) * k;
      grass.update(playerPos);

      dungeon.cutaway.uPlayer.value.copy(playerPos);
      dungeon.update(t, region === 'dungeon');
      gate.userData.portalMat.opacity = 0.5 + Math.sin(t * 1.7) * 0.12;
      for (const s of shrines) {
        s.model.userData.flame.scale.y = s.cooldown > 0 ? 0.3 : 1 + Math.sin(t * 9 + s.x) * 0.15;
        s.model.userData.flameMat.color.setHex(s.cooldown > 0 ? 0x444444 : s.def.color);
      }
      for (const w of waypoints) {
        w.model.userData.ringMat.opacity = w.discovered ? 0.55 + Math.sin(t * 2) * 0.15 : 0.15;
        w.model.userData.lapis.emissive.setHex(w.discovered ? 0x2a4ab0 : 0x000000);
      }
    },

    regionInfo(x, z) {
      const id = regionAt(x, z);
      return { id, ...REGIONS[id] };
    },
  };
}
