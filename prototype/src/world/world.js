import * as THREE from 'three';
import { Colliders } from './colliders.js';
import { buildTerrain, buildMapImage } from './terrainMesh.js';
import { scatterProps } from './props.js';
import { buildCanals } from './canals.js';
import { buildLandmarks } from './landmarks.js';
import { buildTown } from './town.js';
import { buildDungeon } from './dungeon.js';
import { makeWaypoint, makeShrine, makeChest, makeGate, makeWellHouse } from './models.js';
import { WAYPOINTS, SHRINES, CHESTS, EVENT, GATE, REGIONS, CISTERN_ENTRANCE } from './layout.js';
import { heightAt, regionAt } from './terrain.js';
import { damp } from '../core/util.js';
import { createEnv } from './shaders/common.js';
import { createSky } from './shaders/sky.js';
import { Grass } from './shaders/grass.js';
import { createParticles, PARTICLE_MIX } from './shaders/particles.js';
import { LightManager } from './lights.js';
import { TimeOfDay } from './timeofday.js';
import { FOG, installFog } from './shaders/fog.js';
import { createLook, copyLook, blendLook, keyElevation, EnvBaker, LOOK_COLORS, LOOK_NUMS } from './env.js';
import { createShafts } from './shafts.js';
import { createLiving } from './life.js'; // living-world hook (1/3): set pieces + critters

// Atmosphere = time-of-day look (env.js keyframes, driven by world.tod) +
// a per-region modifier (this table) layered on top. Each region keeps its
// identity: marsh teal-green mist in its hollows, ruins bleached gold and dusty,
// ashen bruised violet with an ember glow, town warm clay and lantern light,
// sunfields clean honey-gold. Dungeons ignore the day entirely (FIXED looks).
//
// Modifier numbers are multipliers unless noted; colours multiply (tints) or
// are blended in (haze, grade).
const MOD_NUMS = {
  fogMul: 1, hD: 0, hB: 0.5, hRef: 0, // height fog: density, falloff per metre, reference height
  sunMul: 1, hemiMul: 1, fillMul: 1, expMul: 1, bloomMul: 1, shaftMul: 1, satMul: 1, conAdd: 0, vignAdd: 0,
  cloudMul: 1, glowMul: 1, hazeMix: 0, gMix: 0, envMul: 1, lanternAdd: 0,
};
const MOD_COLORS = { lightTint: 0xffffff, skyTint: 0xffffff, groundTint: 0xffffff, hazeCol: 0xffffff, gShadow: 0x000000, gHigh: 0xffffff };
const MOD_DEF = {
  town: { // warm clay and hearth light; lanterns come on early
    lightTint: 0xfff2dc, skyTint: 0xfff0e0, hazeCol: 0xe8c89a, hazeMix: 0.18, fogMul: 0.8, bloomMul: 1.1, shaftMul: 1.2, satMul: 1.04, lanternAdd: 0.25,
    gShadow: 0x4a3452, gHigh: 0xffd8a0, gMix: 0.35,
  },
  sunfields: { // clean, open, honey-gold
    lightTint: 0xfff6e6, skyTint: 0xfff8ee, hazeCol: 0xf0d6a0, hazeMix: 0.1, fogMul: 0.85, satMul: 1.06, shaftMul: 1.0,
  },
  marsh: { // teal-green mist hugging the hollows
    lightTint: 0xe6fff2, skyTint: 0xcdf0e4, groundTint: 0xb8d8b0, hazeCol: 0x7fb09c, hazeMix: 0.3, fogMul: 1.2, hD: 0.05, hB: 0.5, hRef: 0.0,
    sunMul: 0.84, expMul: 0.98, bloomMul: 1.2, shaftMul: 1.6, satMul: 1.02, glowMul: 0.8, envMul: 0.9,
    gShadow: 0x1a4a4a, gHigh: 0xe6f2b4, gMix: 0.5,
  },
  ruins: { // bleached gold, dust in the air
    lightTint: 0xfff0d2, skyTint: 0xffeabf, groundTint: 0xffe0b0, hazeCol: 0xe8c890, hazeMix: 0.28, fogMul: 0.95, sunMul: 1.08, expMul: 1.05, satMul: 0.9, conAdd: 0.04, shaftMul: 1.3,
    gShadow: 0x5a4650, gHigh: 0xfff0d2, gMix: 0.4,
  },
  ashen: { // bruised violet, ember glow underneath
    lightTint: 0xffc4b0, skyTint: 0xb8a0c8, groundTint: 0xff6a40, hazeCol: 0x80486a, hazeMix: 0.3, fogMul: 1.0, hD: 0.05, hB: 0.35, hRef: 0.6,
    sunMul: 0.8, hemiMul: 0.85, expMul: 0.97, bloomMul: 1.35, satMul: 0.95, conAdd: 0.1, shaftMul: 0.9, glowMul: 2.0, envMul: 0.8,
    gShadow: 0x2a1a40, gHigh: 0xf0c4b4, gMix: 0.6,
  },
};
const ATMOS = Object.fromEntries(Object.entries(MOD_DEF).map(([id, d]) => {
  const o = { ...MOD_NUMS };
  for (const k of Object.keys(MOD_NUMS)) if (d[k] !== undefined) o[k] = d[k];
  for (const k of Object.keys(MOD_COLORS)) o[k] = new THREE.Color(d[k] ?? MOD_COLORS[k]);
  return [id, o];
}));
const MOD_BLEND_NUMS = Object.keys(MOD_NUMS);
const MOD_BLEND_COLORS = Object.keys(MOD_COLORS);

// Dungeon looks: complete, fixed (time of day is ignored). Same fields as env.js looks.
const FIXED_DEF = {
  dungeon: {
    sunColor: 0x8a7aff, hemiSky: 0x7a78c0, hemiGround: 0x4a3038, fillColor: 0x5a6aff,
    zenith: 0x0c0912, horizon: 0x1c1428, glow: 0x6a50c0, cloudLit: 0x2a2038, cloudDark: 0x120e1c, gShadow: 0x161a46, gHighlight: 0xffa86a,
    sun: 0, hemi: 1.35, fill: 0, fogD: 0.02, glowAmt: 0, exposure: 1.04, envI: 0.55, bloom: 0.8, bloomThr: 0.7, bloomRad: 0.6,
    shaft: 0, stars: 0, cloudCover: 0, cloudShadow: 0, gSplit: 0.25, gSat: 1.08, gContrast: 1.1, vign: 0.42, grain: 0.04, ca: 0.8, lantern: 1, discK: 0, moonK: 0,
  },
  cistern: {
    sunColor: 0x7fe8ff, hemiSky: 0x6ab0b8, hemiGround: 0x2a4040, fillColor: 0x5fd0ff,
    zenith: 0x081416, horizon: 0x10262a, glow: 0x3fb0c0, cloudLit: 0x1a3038, cloudDark: 0x0a1a1e, gShadow: 0x0e3240, gHighlight: 0xc8fff0,
    sun: 0, hemi: 1.35, fill: 0, fogD: 0.019, exposure: 1.04, envI: 0.6, glowAmt: 0, bloom: 0.8, bloomThr: 0.7, bloomRad: 0.6,
    shaft: 0, stars: 0, cloudCover: 0, cloudShadow: 0, gSplit: 0.24, gSat: 1.06, gContrast: 1.08, vign: 0.42, grain: 0.04, ca: 0.8, lantern: 1, discK: 0, moonK: 0,
  },
};
const FIXED = Object.fromEntries(Object.entries(FIXED_DEF).map(([id, d]) => {
  const L = createLook();
  for (const k of LOOK_COLORS) L[k].set(d[k]);
  for (const k of LOOK_NUMS) L[k] = d[k] ?? 0;
  return [id, L];
}));

export const SHRINE_TYPES = {
  shamash: { name: 'Shrine of Shamash', color: 0xffd060, buff: 'Blessing of Shamash: +40% Damage', stats: { dmgPct: 40 } },
  enki: { name: 'Shrine of Enki', color: 0x4fd0ff, buff: 'Blessing of Enki: +8 Anima per Second', stats: { animaRegen: 8 } },
  ninurta: { name: 'Shrine of Ninurta', color: 0x8cff6a, buff: 'Blessing of Ninurta: +30% Movement and Attack Speed', stats: { moveSpeed: 30, attackSpeed: 30 } },
  ishtar: { name: 'Shrine of Ishtar', color: 0xff6aa8, buff: 'Blessing of Ishtar: +25% Critical Strike Chance', stats: { critChance: 25 } },
};

const _w = new THREE.Color();
const _lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
// Layers the (damped) region modifier `M` on the day's look `L`, writing `F`.
function applyMod(F, L, M, tmp) {
  // Region tints fade at night so the moon stays blue-silver everywhere.
  const nk = Math.min(1, L.moonK), tk = 1 - 0.7 * nk;
  _w.set(0xffffff).lerp(M.lightTint, tk);
  F.sunColor.copy(L.sunColor).multiply(_w);
  F.hemiSky.copy(L.hemiSky).multiply(_w);
  F.fillColor.copy(L.fillColor);
  F.hemiGround.copy(L.hemiGround).multiply(M.groundTint);
  _w.set(0xffffff).lerp(M.skyTint, tk);
  F.zenith.copy(L.zenith).multiply(_w);
  F.horizon.copy(L.horizon).multiply(_w);
  const hz = M.hazeMix * (1 - 0.65 * nk);
  if (hz > 0.001) {
    // Region haze keeps its hue but takes the brightness of the time of day.
    const hl = _lum(M.hazeCol) || 1;
    tmp.copy(M.hazeCol).multiplyScalar(_lum(F.horizon) / hl);
    F.horizon.lerp(tmp, hz);
    tmp.copy(M.hazeCol).multiplyScalar(_lum(F.zenith) / hl * 1.0);
    F.zenith.lerp(tmp, hz * 0.35);
  }
  F.glow.copy(L.glow);
  F.cloudLit.copy(L.cloudLit);
  F.cloudDark.copy(L.cloudDark);
  F.gShadow.copy(L.gShadow).lerp(M.gShadow, M.gMix);
  F.gHighlight.copy(L.gHighlight).lerp(M.gHigh, M.gMix);
  F.sun = L.sun * M.sunMul;
  F.hemi = L.hemi * M.hemiMul;
  F.fill = L.fill * M.fillMul;
  F.fogD = L.fogD * M.fogMul;
  F.glowAmt = L.glowAmt * M.glowMul;
  F.exposure = L.exposure * M.expMul;
  F.envI = L.envI * M.envMul;
  F.bloom = L.bloom * M.bloomMul;
  F.bloomThr = L.bloomThr; F.bloomRad = L.bloomRad;
  F.shaft = L.shaft * M.shaftMul;
  F.stars = L.stars;
  F.cloudCover = L.cloudCover;
  F.cloudShadow = L.cloudShadow * M.cloudMul;
  F.gSplit = L.gSplit; F.gSat = L.gSat * M.satMul; F.gContrast = L.gContrast + M.conAdd;
  F.vign = L.vign + M.vignAdd; F.grain = L.grain; F.ca = L.ca;
  F.lantern = L.lantern; F.discK = L.discK; F.moonK = L.moonK;
  return F;
}

export function buildWorld(scene, settings = null) {
  const colliders = new Colliders();
  const env = createEnv();
  installFog();
  scene.background = new THREE.Color(0xc4d6e8);
  scene.fog = new THREE.FogExp2(0xc4d6e8, 0.0105);

  // Day cycle and pooled point lights, shared with gameplay (world.tod, world.lights).
  const tod = new TimeOfDay();
  const lights = new LightManager(scene);

  const sky = createSky(env);
  scene.add(sky.mesh);

  // Warm key + cool fill + sky/ground hemisphere.
  const hemi = new THREE.HemisphereLight(0xb8c4ff, 0x6a4a2a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 230 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9bb4ff, 0.35);
  fill.position.set(26, 14, -20);
  scene.add(fill, fill.target);

  const terrain = buildTerrain(scene, env);
  const grass = new Grass(scene, env, settings);
  const particles = createParticles(env, settings);
  scene.add(particles.points);
  buildCanals(scene);
  buildLandmarks(scene, colliders);
  scatterProps(scene, colliders);
  const shafts = createShafts(scene, env, settings);
  const living = createLiving({ scene, env, lights, tod, settings }); // living-world hook (2/3)
  const town = buildTown(scene, colliders, lights);
  const dungeon = buildDungeon(scene, colliders, lights);
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
  const well = place(makeWellHouse(), CISTERN_ENTRANCE.x, CISTERN_ENTRANCE.z);
  colliders.addCircle(CISTERN_ENTRANCE.x, CISTERN_ENTRANCE.z, 1.8);
  lights.add({ x: CISTERN_ENTRANCE.x, y: well.position.y + 1.2, z: CISTERN_ENTRANCE.z, color: 0x5fe0ff, intensity: 6, range: 9, decay: 1.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) colliders.addCircle(CISTERN_ENTRANCE.x + sx * 2.7, CISTERN_ENTRANCE.z + sz * 2.7, 0.45);
  colliders.addBox(GATE.x - 24, GATE.z - 2, GATE.x - 5, GATE.z + 2.5);
  colliders.addBox(GATE.x + 5, GATE.z - 2, GATE.x + 24, GATE.z + 2.5);
  colliders.addBox(GATE.x - 5, GATE.z - 2, GATE.x + 5, GATE.z - 0.5);

  // Atmosphere state: the day's look (instant), the damped region modifier, and the final blend.
  const dayLook = createLook(), look = createLook();
  const mod = { ...ATMOS.sunfields };
  for (const k of MOD_BLEND_COLORS) mod[k] = ATMOS.sunfields[k].clone();
  let inDungeon = null;
  const lastPos = new THREE.Vector3();
  let clock = 0;
  const partMix = Float32Array.from(PARTICLE_MIX.sunfields);
  const tmpDir = new THREE.Vector3();
  const tmpDir2 = new THREE.Vector2();
  const tmpC = new THREE.Color();
  const right = new THREE.Vector3(), camUp = new THREE.Vector3(), snapped = new THREE.Vector3();
  // The light direction the scene is shaded with: tod.sunDir with a lifted low sun
  // (bounded shadow length), smoothed so the sun-to-moon hand-over doesn't pop.
  const keyDir = new THREE.Vector3().copy(tod.sunDir);
  const sunDisc = new THREE.Vector3().copy(tod.sunDir), moonDir = new THREE.Vector3(0.55, 0.62, 0.1).normalize();
  const targetDir = new THREE.Vector3();
  let keyInit = false;
  const baker = { b: null, force: true };
  const poolLights = lights.pool;
  const waterLP = terrain.water.material.uniforms.uLP.value, waterLC = terrain.water.material.uniforms.uLC.value;
  const mood = { bloom: 0.4, bloomThr: 0.85, bloomRad: 0.5, vign: 0.3, grain: 0.03, ca: 0.7 };

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
    tod,
    lights,
    shafts,
    envBake: baker, // { b: EnvBaker } for diagnostics (bakes, ms)
    heightAt,
    regionAt,
    sun,

    update(dt, t, playerPos, renderer = null) {
      const region = regionAt(playerPos.x, playerPos.z);
      const target = ATMOS[region] ?? ATMOS.sunfields;
      const nowDungeon = region === 'dungeon' || region === 'cistern' ? region : null;
      // Snap instantly when entering or leaving the dungeon, blend otherwise.
      const jumped = playerPos.distanceToSquared(lastPos) > 400;
      lastPos.copy(playerPos);
      const swapped = nowDungeon !== inDungeon;
      const k = swapped || jumped ? 1 : damp(1.5, dt);
      inDungeon = nowDungeon;
      for (const key of MOD_BLEND_NUMS) mod[key] += (target[key] - mod[key]) * k;
      for (const key of MOD_BLEND_COLORS) mod[key].lerp(target[key], k);
      clock = (clock + dt) % 3600;
      env.uTime.value = clock;
      tod.update(dt);

      // ---- the look of the moment: day-cycle keyframes + region modifier, or a fixed dungeon look
      if (nowDungeon) copyLook(look, FIXED[nowDungeon]);
      else applyMod(look, blendLook(tod.t, dayLook), mod, tmpC);
      const sunUp = tod.elevation > -0.1;

      // ---- key light direction: true arc, low sun lifted, smoothed across the sun-to-moon hand-over
      if (nowDungeon) targetDir.set(0.2, 1, 0.1).normalize();
      else if (sunUp) {
        const e = Math.asin(Math.min(1, Math.max(-1, tod.sunDir.y)));
        const ne = keyElevation(e), c = Math.cos(ne);
        const hl = Math.hypot(tod.sunDir.x, tod.sunDir.z) || 1;
        targetDir.set((tod.sunDir.x / hl) * c, Math.sin(ne), (tod.sunDir.z / hl) * c);
      } else targetDir.copy(tod.sunDir);
      if (!keyInit || swapped || jumped) { keyDir.copy(targetDir); keyInit = true; }
      else keyDir.lerp(targetDir, 1 - Math.exp(-dt * 1.8)).normalize();
      if (sunUp) sunDisc.copy(tod.sunDir); else moonDir.copy(tod.sunDir);

      env.uDusk.value = nowDungeon ? 0 : tod.dusk;
      env.uNight.value = nowDungeon ? 0 : tod.night;
      env.uPlayer.value.copy(playerPos);
      env.uCloud.value = look.cloudShadow;
      env.uSunDir.value.copy(keyDir);
      env.uSunColor.value.copy(look.sunColor);
      env.uSunK.value = Math.min(1, look.sun / 2.2);
      env.uAmbient.value.copy(look.hemiSky).multiplyScalar(look.hemi * 0.6).add(tmpC.copy(look.sunColor).multiplyScalar(look.sun * 0.35));
      env.uSkyZenith.value.copy(look.zenith);
      env.uSkyHorizon.value.copy(look.horizon);
      env.uSkyGround.value.copy(look.hemiGround).multiplyScalar(0.9);
      env.uGlowColor.value.copy(look.glow);
      env.uGlow.value = 0.4 + look.glowAmt * 1.2;
      env.uDisc.value.set(sunDisc.x, sunDisc.y, sunDisc.z, look.discK);
      env.uMoon.value.set(moonDir.x, moonDir.y, moonDir.z, look.moonK);
      env.uStars.value = look.stars;
      env.uCloudCover.value = look.cloudCover;
      env.uCloudLit.value.copy(look.cloudLit);
      env.uCloudDark.value.copy(look.cloudDark);
      env.uLanternK.value = nowDungeon ? 1 : Math.min(1, look.lantern + mod.lanternAdd * Math.min(1, look.lantern * 3));
      // Slowly wandering wind direction.
      env.uWind.value.set(Math.cos(clock * 0.05) * 0.8 + 0.6, Math.sin(clock * 0.04) * 0.5 + 0.2);

      // ---- fog: exponential distance + height fog, glowing toward the sun's side of the sky
      scene.fog.color.copy(look.horizon);
      scene.background.copy(look.horizon);
      FOG.color.copy(look.horizon);
      scene.fog.density = FOG.density.value = look.fogD;
      FOG.h[0] = nowDungeon ? 0 : mod.hD;
      FOG.h[1] = mod.hB;
      FOG.h[2] = mod.hRef;
      FOG.h[3] = look.glowAmt;
      tmpDir.set(keyDir.x * 1.6, 0.15, -0.8).normalize();
      FOG.s[0] = tmpDir.x; FOG.s[1] = tmpDir.y; FOG.s[2] = tmpDir.z; FOG.s[3] = 2.5;
      FOG.g[0] = look.glow.r; FOG.g[1] = look.glow.g; FOG.g[2] = look.glow.b;

      // ---- lights
      hemi.color.copy(look.hemiSky);
      hemi.groundColor.copy(look.hemiGround);
      hemi.intensity = look.hemi;
      sun.color.copy(look.sunColor);
      sun.intensity = look.sun;
      sun.shadow.normalBias = 0.04 + 0.06 * (1 - keyDir.y);
      fill.color.copy(look.fillColor);
      fill.intensity = look.fill;
      fill.position.set(playerPos.x - keyDir.x * 26, playerPos.y + 14, playerPos.z - keyDir.z * 26 - 10);
      fill.target.position.copy(playerPos);
      scene.environmentIntensity = look.envI;

      // The sun's shadow box follows the hero, snapped to shadow texels so edges don't swim.
      const texel = 64 / sun.shadow.mapSize.x;
      right.set(0, 1, 0).cross(keyDir).normalize();
      camUp.copy(keyDir).cross(right);
      const tx = playerPos.dot(right), ty = playerPos.dot(camUp);
      snapped.copy(playerPos)
        .addScaledVector(right, Math.round(tx / texel) * texel - tx)
        .addScaledVector(camUp, Math.round(ty / texel) * texel - ty);
      sun.position.copy(snapped).addScaledVector(keyDir, 90);
      sun.target.position.copy(snapped);

      shafts.update?.({ shaftK: look.shaft, dungeon: !!nowDungeon });

      if (renderer) {
        renderer.webgl.toneMappingExposure = look.exposure;
        renderer.setGrade({ shadow: look.gShadow, highlight: look.gHighlight, split: look.gSplit, saturation: look.gSat, contrast: look.gContrast });
        mood.bloom = look.bloom; mood.bloomThr = look.bloomThr; mood.bloomRad = look.bloomRad;
        mood.vign = look.vign; mood.grain = look.grain; mood.ca = look.ca;
        renderer.setMood(mood);
        if (settings?.quality?.envBake !== false) {
          if (!baker.b) baker.b = new EnvBaker(renderer.webgl, scene, env);
          baker.b.update(env, dt, tod.t, baker.force || swapped);
          baker.force = false;
        }
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
      dungeon.update(t, region === 'dungeon' ? 'ganzir' : region === 'cistern' ? 'cistern' : null);
      living.update(dt, t, playerPos, renderer); // living-world hook (3/3)
      lights.update(t, playerPos, tod);
      // Nearby lantern light for the marsh water's reflections.
      for (let i = 0; i < 4; i++) {
        const l = poolLights[i], p = waterLP[i], c = waterLC[i];
        if (l && l.intensity > 0.05) {
          p.set(l.position.x, l.position.y, l.position.z, l.distance);
          c.set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity * 0.09);
        } else p.w = 0;
      }
      gate.userData.portalMat.opacity = 0.5 + Math.sin(t * 1.7) * 0.12;
      well.userData.portalMat.opacity = 0.45 + Math.sin(t * 2.1) * 0.15;
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
