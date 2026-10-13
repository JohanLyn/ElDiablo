import * as THREE from 'three';
import { Colliders } from './colliders.js';
import { buildTerrain, buildMapImage } from './terrainMesh.js';
import { scatterProps } from './props.js';
import { buildTown } from './town.js';
import { buildDungeon } from './dungeon.js';
import { makeWaypoint, makeShrine, makeChest, makeGate } from './models.js';
import { WAYPOINTS, SHRINES, CHESTS, EVENT, GATE, REGIONS } from './layout.js';
import { heightAt, regionAt } from './terrain.js';
import { damp } from '../core/util.js';

// Mood per region: fog/sky colour, ambient and sun strength.
const ATMOS = {
  town: { fog: 0xb89870, near: 62, far: 165, hemi: 0.8, sun: 1.8 },
  sunfields: { fog: 0xb89870, near: 62, far: 165, hemi: 0.8, sun: 1.8 },
  marsh: { fog: 0x6d8476, near: 48, far: 135, hemi: 0.7, sun: 1.25 },
  ruins: { fog: 0xc9a77a, near: 58, far: 160, hemi: 0.85, sun: 2.0 },
  ashen: { fog: 0x3e2c3c, near: 44, far: 125, hemi: 0.55, sun: 0.95 },
  dungeon: { fog: 0x0b070d, near: 34, far: 80, hemi: 0.5, sun: 0.0 },
};

export const SHRINE_TYPES = {
  shamash: { name: 'Shrine of Shamash', color: 0xffd060, buff: 'Blessing of Shamash: +40% Damage', stats: { dmgPct: 40 } },
  enki: { name: 'Shrine of Enki', color: 0x4fd0ff, buff: 'Blessing of Enki: +8 Anima per Second', stats: { animaRegen: 8 } },
  ninurta: { name: 'Shrine of Ninurta', color: 0x8cff6a, buff: 'Blessing of Ninurta: +30% Movement and Attack Speed', stats: { moveSpeed: 30, attackSpeed: 30 } },
  ishtar: { name: 'Shrine of Ishtar', color: 0xff6aa8, buff: 'Blessing of Ishtar: +25% Critical Strike Chance', stats: { critChance: 25 } },
};

export function buildWorld(scene, settings = null) {
  const colliders = new Colliders();
  scene.background = new THREE.Color(ATMOS.sunfields.fog);
  scene.fog = new THREE.Fog(ATMOS.sunfields.fog, ATMOS.sunfields.near, ATMOS.sunfields.far);

  const hemi = new THREE.HemisphereLight(0xb8c4ff, 0x6a4a2a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  buildTerrain(scene);
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

  let atmos = { ...ATMOS.sunfields };
  const fogColor = new THREE.Color(ATMOS.sunfields.fog);
  const tmpColor = new THREE.Color();

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

    update(dt, t, playerPos) {
      const region = regionAt(playerPos.x, playerPos.z);
      const target = ATMOS[region];
      // Snap instantly when entering or leaving the dungeon, blend otherwise.
      const k = (region === 'dungeon') !== (atmos.sun === 0) ? 1 : damp(1.5, dt);
      atmos.near += (target.near - atmos.near) * k;
      atmos.far += (target.far - atmos.far) * k;
      atmos.hemi += (target.hemi - atmos.hemi) * k;
      atmos.sun += (target.sun - atmos.sun) * k;
      if (k === 1) atmos.sun = target.sun;
      fogColor.lerp(tmpColor.setHex(target.fog), k);
      scene.fog.color.copy(fogColor);
      scene.background.copy(fogColor);
      scene.fog.near = atmos.near;
      scene.fog.far = atmos.far;
      hemi.intensity = atmos.hemi;
      sun.intensity = atmos.sun;

      // The sun's shadow box follows the hero.
      sun.position.set(playerPos.x - 18, playerPos.y + 40, playerPos.z + 14);
      sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);

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
