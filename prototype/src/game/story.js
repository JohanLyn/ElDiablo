import * as THREE from 'three';
import { Enemy } from '../entities/enemies.js';
import { generateItem } from './items.js';
import { part, merge } from '../world/models.js';

// Scripted beats of the opening: the burning caravan on the south road, plus
// "first time" loot guarantees that make the first minutes rewarding.
// North road, just outside Eridu's north gate (the hero walks south into town after).
export const START = { x: 1, z: 95 };
export const CARAVAN = { x: 2, z: 103 };

const WAVES = [
  ['utukku', 'utukku', 'utukku'],
  ['gallu', 'utukku', 'gallu', 'utukku'],
  ['gallu', 'gallu', 'gallu', 'utukku', 'utukku'],
];

export class Story {
  constructor(g) {
    this.g = g;
    this.wave = -1;
    this.waveEnemies = [];
    this.nextWaveIn = 0;
    this.caravan = buildCaravan(g);
    g.questMarkers = { ambush: { x: CARAVAN.x, z: CARAVAN.z } };

    g.events.on('kill', ({ enemy }) => this.onKill(enemy));
  }

  // New hero: start on the south road with the caravan under attack.
  begin() {
    const g = this.g;
    g.flags.introDone = false;
    this.wave = 0;
    this.nextWaveIn = 1.2;
    this.waveEnemies = [];
    this.quietCamps();
    g.teleport(START.x, START.z);
    g.player.facing = 0;
    this.setBurning(true);
  }

  // Keep the opening clean: camps near the caravan sleep until later.
  quietCamps() {
    const g = this.g;
    for (const c of g.enemies.camps) {
      if (Math.hypot(c.x - CARAVAN.x, c.z - CARAVAN.z) < 34) {
        if (c.state === 'active') g.enemies.despawnCamp(c);
        c.state = 'cleared';
        c.clearedAt = g.time;
      }
    }
  }

  // The wreck (and its colliders) stays on the road; it only burns during the opening.
  setBurning(on) {
    for (const f of this.caravan.userData.flames) f.visible = on;
    this.caravan.userData.light.intensity = on ? 10 : 0; // not .visible: the light count must not change
  }

  // Loaded hero: skip the opening if it already happened.
  resume() {
    this.wave = this.g.flags.introDone ? -1 : 0;
    this.nextWaveIn = 1.2;
    if (!this.g.flags.introDone) this.quietCamps();
    this.setBurning(!this.g.flags.introDone);
  }

  update(dt) {
    const g = this.g;
    // Flames on the wrecked carts.
    for (const f of this.caravan.userData.flames) f.scale.y = 1 + Math.sin(g.time * 12 + f.position.x) * 0.25;
    if (this.wave < 0) return;
    if (this.waveEnemies.length && this.waveEnemies.every((e) => !e.alive)) {
      this.waveEnemies = [];
      this.wave++;
      this.nextWaveIn = 1.6;
      if (this.wave >= WAVES.length) this.finish();
      else g.hud.notify('More demons pour from the dunes!', 'warn');
      return;
    }
    if (!this.waveEnemies.length && this.wave < WAVES.length) {
      this.nextWaveIn -= dt;
      if (this.nextWaveIn <= 0) this.spawnWave(WAVES[this.wave]);
    }
  }

  spawnWave(types) {
    const g = this.g;
    types.forEach((type, i) => {
      const a = -0.9 + (i / Math.max(1, types.length - 1)) * 1.8 + (this.wave ? Math.PI : 0);
      const x = CARAVAN.x + Math.sin(a) * 9, z = CARAVAN.z + Math.cos(a) * 6;
      const e = new Enemy(type, { level: 1, x, z }, g.scene);
      e.spawning = 0.6 + i * 0.25;
      e.aggro = true;
      e.home.set(CARAVAN.x, 0, CARAVAN.z);
      e.storyMob = true;
      // A gentle start: the first wave hits softly.
      if (this.wave === 0) e.dmg *= 0.6;
      g.enemies.add(e);
      this.waveEnemies.push(e);
    });
    if (this.wave === 0) g.hud.banner('The caravan is under attack!', 'event', 'Defend it');
  }

  finish() {
    const g = this.g;
    this.wave = -1;
    g.flags.introDone = true;
    g.quests.notify({ type: 'event', id: 'ambush' });
    g.hud.banner('The road is clear', 'quest', 'Eridu Outpost lies just to the south');
    g.save();
  }

  onKill(e) {
    const g = this.g;
    const f = g.flags;
    // The very first kill drops a real weapon upgrade, to teach looting and equipping.
    if (!f.firstDrop && e.storyMob) {
      f.firstDrop = true;
      g.loot.dropItem(generateItem({ ilvl: 2, rarity: 'magic', kind: 'weapon' }), e.pos, g);
    }
    if (e.storyMob && this.waveEnemies.length && this.waveEnemies.every((x) => !x.alive) && this.wave === WAVES.length - 1) {
      g.loot.dropOrb(e.pos, g);
      g.loot.dropGold(25, e.pos, g);
    }
    // First elite or champion: a guaranteed Rare.
    if (!f.firstElite && (e.elite || e.named) && !e.boss) {
      f.firstElite = true;
      g.loot.dropItem(generateItem({ ilvl: e.level, rarity: 'rare' }), e.pos, g);
    }
  }
}

function buildCaravan(g) {
  const group = new THREE.Group();
  const wood = 0x6a4426, dark = 0x2a1a10, cloth = 0x9a3a2a, sand = 0xc9a877;
  const cart = (rot) => merge([
    part(new THREE.BoxGeometry(2.4, 0.5, 1.4), wood, { y: 0.8 }),
    part(new THREE.BoxGeometry(2.4, 0.6, 0.1), dark, { y: 1.2, z: 0.68 }),
    part(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), dark, { x: -0.8, y: 0.55, z: 0.78, rx: Math.PI / 2 }),
    part(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), dark, { x: 0.8, y: 0.3, z: -0.6, rx: Math.PI / 2, rz: 0.6 }),
    part(new THREE.BoxGeometry(1.6, 0.06, 1.6), cloth, { y: 1.7, rz: 0.35 }),
    part(new THREE.BoxGeometry(0.6, 0.6, 0.6), sand, { x: 1.6, y: 0.3, z: 0.6, ry: rot }),
    part(new THREE.BoxGeometry(0.5, 0.5, 0.5), wood, { x: 1.9, y: 0.25, z: -0.3 }),
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  [[0, 0, 0.3], [4.5, 2, -0.5]].forEach(([x, z, r]) => {
    const m = new THREE.Mesh(cart(r), mat);
    m.position.set(CARAVAN.x + x, 0, CARAVAN.z + z);
    m.rotation.set(0, r, x ? 0.25 : 0);
    m.castShadow = true;
    group.add(m);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 7), flameMat);
    f.position.set(CARAVAN.x + x + 0.3, 1.9, CARAVAN.z + z);
    group.add(f);
    flames.push(f);
    g.world.colliders.addCircle(CARAVAN.x + x, CARAVAN.z + z, 1.2);
  });
  const light = new THREE.PointLight(0xff7a2a, 10, 14, 1.6);
  light.position.set(CARAVAN.x + 2, 2.5, CARAVAN.z + 1);
  group.add(light);
  for (const c of group.children) if (c.isMesh) c.position.y += g.world.heightAt(c.position.x, c.position.z);
  group.userData.flames = flames;
  group.userData.light = light;
  g.scene.add(group);
  return group;
}
