import * as THREE from 'three';
import { generateItem, rollRarity, RARITY } from './items.js';
import { Rng } from '../core/rng.js';
import { makePillar, makePillarMaterial } from '../fx/beams.js';
import { RARITY_FX } from '../fx/rarity.js';

const LABEL_RANGE = 16;
const _probe = new THREE.Vector3();

// A named champion's guaranteed first drop (Aqrabu's "Sting of Aqrabu"): a rare with a fixed
// name and a venom-drinking pair of affixes (crit damage, life per hit), claimed on pickup.
function namedFirstDrop(fd, ilvl, rng) {
  let item;
  for (let i = 0; i < 60; i++) {
    item = generateItem({ ilvl, rarity: fd.rarity, kind: fd.kind, rng });
    const stats = item.affixes.map((a) => a.stat);
    if (stats.includes('lifeOnHit') && stats.includes('critDmg')) break;
  }
  item.name = fd.name;
  if (item.base.min !== undefined) item.base.name = 'Venom-Barbed Spear';
  item.firstClearFlag = fd.flag; // set on pickup (interact.js)
  return item;
}

// Items, gold and potion orbs lying on the ground.
export class Loot {
  constructor(scene, overlay) {
    this.scene = scene;
    this.overlay = overlay;
    this.items = []; // { item, mesh, beam, label, pos }
    this.pickups = []; // gold and potion orbs { kind, amount, mesh, pos, vel }
    this.rng = new Rng(Math.floor(Math.random() * 1e9));
    this.geos = {
      weapon: new THREE.BoxGeometry(0.12, 0.08, 1.1),
      armor: new THREE.BoxGeometry(0.5, 0.35, 0.4),
      jewel: new THREE.TorusGeometry(0.22, 0.07, 6, 12),
      gold: new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10),
      orb: new THREE.SphereGeometry(0.22, 10, 8),
    };
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xffcc44, metalness: 0.9, roughness: 0.25, emissive: 0x8a6000 });
    this.beamMats = {
      rare: makePillarMaterial(0xffc81a, 0xffeaa0, 0.8),
      legendary: makePillarMaterial(0xff5a0a, 0xffd0a0, 1.0, 1),
    };
    this.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a4a).multiplyScalar(1.8) });
  }

  // ---- drop tables -----------------------------------------------------------
  dropFor(enemy, g) {
    const lvl = enemy.level;
    const pos = enemy.pos;
    const mf = enemy.boss ? 2 : enemy.named ? 1.5 : enemy.elite ? 1 : 0;
    // Guardians (Neti, the Drowned Voice) spray their loot in a fountain of arcs instead of popping it out.
    const fountain = enemy.boss || (enemy.named && g.instance?.guardian?.id === enemy.named.id);
    let items = 0, minRarity = 'common';
    if (enemy.boss) { items = 5; minRarity = 'rare'; } else if (enemy.named) { items = 3; minRarity = 'rare'; } else if (enemy.elite) { items = 2; minRarity = 'magic'; } else if (this.rng.chance(0.13)) items = 1;
    for (let i = 0; i < items; i++) {
      // Neti and the Cistern's guardian each drop a guaranteed Legendary the first time.
      const flag = enemy.boss ? 'netiLegendary' : enemy.named?.legendaryFlag;
      const guaranteed = flag && i === 0 && !g.flags[flag];
      const item = generateItem({ ilvl: lvl, rarity: guaranteed ? 'legendary' : rollRarity(this.rng, { magicFind: mf, minRarity, ilvl: lvl }), rng: this.rng });
      if (guaranteed) item.firstClearFlag = flag; // set on pickup (interact.js)
      this.dropItem(item, pos, g, fountain ? { delay: 0.35 + i * 0.22 } : null);
    }
    const fd = enemy.named?.firstDrop;
    if (fd && !g.flags[fd.flag]) this.dropItem(namedFirstDrop(fd, lvl, this.rng), pos, g, { delay: 0.25 });
    if (enemy.boss || enemy.named || enemy.elite || this.rng.chance(0.4)) {
      const piles = enemy.boss ? 8 : enemy.elite || enemy.named ? 3 : 1;
      for (let i = 0; i < piles; i++) this.dropGold(Math.round(this.rng.float(3, 8) * lvl), pos, g, !!fountain);
    }
    if (enemy.boss || ((enemy.elite || enemy.named) && this.rng.chance(0.6)) || this.rng.chance(0.045)) this.dropOrb(pos, g, !!fountain);
  }

  dropChest(tier, pos, g, ilvl) {
    const n = tier === 3 ? 4 : tier === 2 ? 3 : 2;
    const minRarity = tier >= 2 ? 'magic' : 'common';
    for (let i = 0; i < n; i++) this.dropItem(generateItem({ ilvl, rarity: rollRarity(this.rng, { magicFind: tier, minRarity, ilvl }), rng: this.rng }), pos, g);
    for (let i = 0; i < tier + 1; i++) this.dropGold(Math.round(this.rng.float(6, 14) * ilvl), pos, g);
    if (tier >= 2) this.dropOrb(pos, g);
  }

  // fountain: { delay } launches the item later, higher and slower, in a long arc.
  dropItem(item, pos, g, fountain = null) {
    const kindGeo = item.kind === 'weapon' ? this.geos.weapon : item.kind === 'ring' || item.kind === 'amulet' ? this.geos.jewel : this.geos.armor;
    const color = new THREE.Color(RARITY[item.rarity].color);
    const mesh = new THREE.Mesh(kindGeo, new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(item.rarity === 'common' ? 0.2 : 0.55), metalness: 0.5, roughness: 0.4 }));
    const a = this.rng.float(0, Math.PI * 2), r = fountain ? this.rng.float(2.2, 4.8) : this.rng.float(0.8, 2.4);
    // Walk the throw outward and stop before the first wall or prop, so nothing lands
    // inside (or behind) a wall where it can't be picked up.
    let x = pos.x, z = pos.z;
    for (let s = 1; s <= 8; s++) {
      const cx = pos.x + Math.cos(a) * r * s / 8, cz = pos.z + Math.sin(a) * r * s / 8;
      _probe.set(cx, 0, cz);
      g.world.colliders.resolve(_probe, 0.3, g.inDungeon);
      if (Math.abs(_probe.x - cx) + Math.abs(_probe.z - cz) > 0.01) break;
      x = cx; z = cz;
    }
    const target = new THREE.Vector3(x, g.world.heightAt(x, z), z);
    g.world.colliders.resolve(target, 0.3, g.inDungeon);
    mesh.position.set(pos.x, (pos.y ?? 0) + 1, pos.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    let beam = null;
    if (item.rarity === 'rare' || item.rarity === 'legendary') {
      const fx = RARITY_FX[item.rarity];
      beam = makePillar(this.beamMats[item.rarity], item.rarity === 'legendary' ? 0.42 : 0.28, fx.beam);
      beam.position.copy(target);
      beam.userData.grow = 0;
      beam.scale.y = 0.01; // rises when the item lands
      this.scene.add(beam);
    }
    const label = document.createElement('div');
    label.className = `loot-label r-${item.rarity}`;
    label.textContent = item.name;
    label.hidden = true;
    this.overlay.appendChild(label);
    const L = { item, mesh, beam, label, pos: target, t: 0, from: mesh.position.clone(), rate: fountain ? 1.05 : 2.2, arc: fountain ? 5.2 : 1.5, delay: fountain?.delay ?? 0 };
    if (L.delay > 0) mesh.visible = false;
    this.items.push(L);
    if (item.rarity === 'legendary') g.hud.notify(`Legendary: ${item.name}`, 'legendary');
    g.events.emit('lootDrop', { item, pos: target, fall: L.delay + 1 / L.rate - 0.03 });
  }

  dropGold(amount, pos, g, fountain = false) { this.dropPickup('gold', amount, pos, g, fountain); }
  dropOrb(pos, g, fountain = false) { this.dropPickup('orb', 1, pos, g, fountain); }

  dropPickup(kind, amount, pos, g, fountain = false) {
    const mesh = new THREE.Mesh(kind === 'gold' ? this.geos.gold : this.geos.orb, kind === 'gold' ? this.goldMat : this.orbMat);
    const a = this.rng.float(0, Math.PI * 2), sp = fountain ? this.rng.float(2.5, 6) : this.rng.float(1.5, 3.5);
    mesh.position.set(pos.x, (pos.y ?? 0) + 1, pos.z);
    this.scene.add(mesh);
    this.pickups.push({ kind, amount, mesh, pos: mesh.position, vel: new THREE.Vector3(Math.cos(a) * sp, fountain ? this.rng.float(9, 13) : 5, Math.sin(a) * sp), age: 0 });
  }

  // ---- per frame -------------------------------------------------------------------
  update(dt, g, camera) {
    const p = g.player;
    for (const L of this.items) {
      if (L.delay > 0) { L.delay -= dt; if (L.delay > 0) continue; L.mesh.visible = true; }
      L.t = Math.min(1, L.t + dt * L.rate);
      const k = L.t;
      L.mesh.position.lerpVectors(L.from, L.pos, k);
      L.mesh.position.y = L.from.y + (L.pos.y + 0.35 - L.from.y) * k + Math.sin(k * Math.PI) * L.arc;
      if (k >= 1) {
        // Landing: a couple of damped bounces, then a gentle hover.
        L.b = (L.b ?? 0) + dt;
        const bounce = Math.abs(Math.sin(L.b * 7.5)) * 0.55 * Math.exp(-L.b * 4.2);
        L.mesh.position.y = L.pos.y + 0.35 + bounce + Math.sin(g.time * 2 + L.pos.x) * 0.05 * Math.min(1, L.b);
        L.mesh.scale.y = 1 - Math.max(0, 0.25 - L.b * 1.2) * 0.8 * (bounce < 0.05 ? 1 : 0);
        if (L.beam) { const full = RARITY_FX[L.item.rarity].beam; L.beam.scale.y = Math.max(0.01, full * Math.min(1, L.b * 3.5)); }
      }
      L.mesh.rotation.y += dt * (k >= 1 ? 1.2 : 6);
      if (L.item.rarity !== 'common') L.mesh.material.emissiveIntensity = 0.8 + Math.sin(g.time * 3 + L.pos.z) * 0.25;
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const o = this.pickups[i];
      o.age += dt;
      const ground = g.world.heightAt(o.pos.x, o.pos.z) + 0.2;
      const d = Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z);
      const wants = o.kind === 'gold' || p.potions < p.maxPotions;
      if (o.age > 0.5 && wants && d < 4.5 && !p.dead) {
        // Magnet toward the hero.
        o.pos.x += ((p.pos.x - o.pos.x) / (d || 1)) * dt * 14;
        o.pos.z += ((p.pos.z - o.pos.z) / (d || 1)) * dt * 14;
        o.pos.y += (p.pos.y + 1 - o.pos.y) * dt * 8;
        if (d < 0.7) {
          if (o.kind === 'gold') { p.gold += o.amount; g.hud.feed(`+${o.amount} gold`, 'gold'); } else { p.potions = Math.min(p.maxPotions, p.potions + 1); g.hud.feed('+1 Healing Potion', 'potion'); }
          g.events.emit('pickup', { kind: o.kind, amount: o.amount, pos: o.pos });
          this.scene.remove(o.mesh);
          this.pickups.splice(i, 1);
          continue;
        }
      } else {
        o.vel.y -= 18 * dt;
        o.pos.addScaledVector(o.vel, dt);
        if (o.pos.y < ground) { o.pos.y = ground; o.vel.set(0, 0, 0); }
      }
      o.mesh.rotation.y += dt * 3;
    }
  }

  // Position the floating name labels (called after the camera moves).
  updateLabels(g, camera, highlighted) {
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight;
    const v = new THREE.Vector3();
    for (const L of this.items) {
      const d = Math.hypot(g.player.pos.x - L.pos.x, g.player.pos.z - L.pos.z);
      const show = d < LABEL_RANGE && !g.uiOpen;
      L.label.hidden = !show;
      if (!show) continue;
      v.copy(L.pos).setY(L.pos.y + 0.9).project(camera);
      L.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      L.label.classList.toggle('hl', L === highlighted);
    }
  }

  nearestItem(pos, range) {
    let best = null, bd = range;
    for (const L of this.items) {
      const d = Math.hypot(pos.x - L.pos.x, pos.z - L.pos.z);
      if (d < bd && L.t >= 1) { bd = d; best = L; }
    }
    return best;
  }

  remove(L) {
    this.scene.remove(L.mesh);
    if (L.beam) this.scene.remove(L.beam);
    L.label.remove();
    this.items.splice(this.items.indexOf(L), 1);
  }

  clearAll() {
    for (const L of [...this.items]) this.remove(L);
    for (const o of this.pickups) this.scene.remove(o.mesh);
    this.pickups = [];
  }
}
