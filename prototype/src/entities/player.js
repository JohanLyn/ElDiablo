import * as THREE from 'three';
import { computeStats, xpToNext, MAX_LEVEL, armorReduction } from '../game/stats.js';
import { startingWeapon, KIND_SLOTS } from '../game/items.js';
import { angleDelta, damp } from '../core/util.js';

const RADIUS = 0.5;
const EVADE_SPEED = 20;
const EVADE_TIME = 0.2;
const EVADE_COOLDOWN = 0.9; // per charge
export const INVENTORY_SIZE = 30;

// The Gatewalker: movement, evade, potions, buffs, life/Anima, levels and gear.
export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98f62, roughness: 0.7 });
    this.cloakMat = new THREE.MeshStandardMaterial({ color: 0x3a64c8, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.85, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), this.cloakMat);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
    head.position.y = 1.75;
    const helm = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 10), gold);
    helm.position.y = 2.05;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.06, 6, 16), gold);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.95;
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.9 }));
    cape.position.set(0, 1.05, -0.42);
    cape.rotation.x = 0.12;
    this.weaponPivot = new THREE.Group();
    this.weaponPivot.position.y = 1.1;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1.5), gold);
    blade.position.set(0.55, 0, 0.75);
    this.weaponPivot.add(blade);
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.trail = new THREE.Mesh(new THREE.RingGeometry(1.0, 2.6, 24, 1, -0.9, 1.8), this.trailMat);
    this.trail.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    this.trail.position.y = 1.0;
    this.barrierMat = new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.barrierMesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), this.barrierMat);
    this.barrierMesh.position.y = 1.0;
    for (const m of [body, head, helm, belt, blade, cape]) m.castShadow = true;
    // Warm carried light, only lit in dark places (dungeon, Ashen Approach).
    this.torch = new THREE.PointLight(0xffb070, 0, 14, 1.4);
    this.torch.position.set(0, 3, 0.5);
    this.group.add(body, head, helm, belt, cape, this.weaponPivot, this.trail, this.barrierMesh, this.torch);
    scene.add(this.group);
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
  }

  // Fresh character, or restored from a save.
  init(save) {
    this.level = save?.level ?? 1;
    this.xp = save?.xp ?? 0;
    this.gold = save?.gold ?? 0;
    this.inventory = save?.inventory ?? [];
    this.equipment = save?.equipment ?? { weapon: startingWeapon() };
    this.skillRanks = save?.skillRanks ?? { strike: 1 };
    this.skillPoints = save?.skillPoints ?? 0;
    this.slots = save?.slots ?? ['strike', null, null, null, null, null];
    this.aspectIndex = save?.aspectIndex ?? 0;
    this.potionLevel = save?.potionLevel ?? 0;
    this.lastWaypoint = save?.lastWaypoint ?? 'wp-town';
    this.buffs = [];
    this.recompute();
    this.life = this.stats.maxLife;
    this.anima = 40;
    this.potions = this.maxPotions;
    this.resetCombatState();
  }

  resetCombatState() {
    this.dead = false;
    this.state = 'move';
    this.stateTime = 0;
    this.evadeCharges = 2;
    this.evadeTimer = 0;
    this.evadeDir = new THREE.Vector3();
    this.invuln = 0;
    this.barrier = 0;
    this.barrierTime = 0;
    this.castLock = 0;
    this.facing = Math.PI;
    this.sinceHurt = 10;
    this.flash = 0;
    this.vel.set(0, 0, 0);
    this.group.visible = true;
  }

  get maxPotions() { return 4 + this.potionLevel; }
  get potionHeal() { return (0.35 + 0.1 * this.potionLevel) * this.stats.potionMult; }

  recompute() {
    const prevMax = this.stats?.maxLife;
    this.stats = computeStats(this.level, this.equipment, this.buffs);
    if (prevMax && this.life !== undefined) this.life = Math.min(this.stats.maxLife, this.life * (this.stats.maxLife / prevMax));
  }

  addBuff(id, label, stats, duration) {
    this.buffs = this.buffs.filter((b) => b.id !== id);
    this.buffs.push({ id, label, stats, time: duration, duration });
    this.recompute();
  }

  // ---- inventory -----------------------------------------------------------
  addItem(item) {
    if (this.inventory.length >= INVENTORY_SIZE) return false;
    this.inventory.push(item);
    return true;
  }

  // Equip from the inventory; rings go to an empty ring slot, else replace ring 1.
  equip(item) {
    const options = KIND_SLOTS[item.kind];
    let slot = options.find((s) => !this.equipment[s]) ?? options[0];
    if (options.length > 1 && this.equipment[options[0]] && this.equipment[options[1]]) {
      // Replace the weaker ring.
      slot = (this.equipment[options[0]].ilvl <= this.equipment[options[1]].ilvl) ? options[0] : options[1];
    }
    const idx = this.inventory.indexOf(item);
    if (idx >= 0) this.inventory.splice(idx, 1);
    const old = this.equipment[slot];
    this.equipment[slot] = item;
    if (old) this.inventory.splice(Math.max(0, idx), 0, old);
    this.recompute();
  }

  unequip(slot) {
    const item = this.equipment[slot];
    if (!item || this.inventory.length >= INVENTORY_SIZE) return false;
    delete this.equipment[slot];
    this.inventory.push(item);
    this.recompute();
    return true;
  }

  // The equipped item that a new item would be compared against.
  comparisonFor(item) {
    const options = KIND_SLOTS[item.kind];
    const eq = options.map((s) => this.equipment[s]).filter(Boolean);
    if (eq.length < options.length) return null;
    return eq.sort((a, b) => a.ilvl - b.ilvl)[0];
  }

  // ---- progression -----------------------------------------------------------
  gainXp(amount, g) {
    if (this.level >= MAX_LEVEL) return;
    this.xp += amount;
    while (this.level < MAX_LEVEL && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.skillPoints++;
      this.recompute();
      this.life = this.stats.maxLife;
      this.anima = this.stats.maxAnima;
      g.onLevelUp(this.level);
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
  }

  // ---- per frame ---------------------------------------------------------------
  update(dt, g) {
    const { input } = g;
    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.castLock = Math.max(0, this.castLock - dt);
    this.sinceHurt += dt;
    if (this.dead) return;

    // Buffs
    let changed = false;
    for (const b of this.buffs) b.time -= dt;
    if (this.buffs.some((b) => b.time <= 0)) { this.buffs = this.buffs.filter((b) => b.time > 0); changed = true; }
    if (changed) this.recompute();

    if (this.barrierTime > 0) { this.barrierTime -= dt; if (this.barrierTime <= 0) this.barrier = 0; }
    if (this.evadeCharges < 2) {
      this.evadeTimer += dt;
      if (this.evadeTimer >= EVADE_COOLDOWN) { this.evadeCharges++; this.evadeTimer = 0; }
    }
    this.anima = Math.min(this.stats.maxAnima, this.anima + this.stats.animaRegen * dt);
    if (this.sinceHurt > 5 && g.inSafeZone) this.life = Math.min(this.stats.maxLife, this.life + this.stats.maxLife * 0.2 * dt);

    const move = g.uiOpen ? { x: 0, z: 0, mag: 0 } : input.move;
    if (!g.uiOpen && input.pressed.evade && this.evadeCharges > 0 && this.state !== 'evade' && this.state !== 'leap') this.startEvade(move, g);
    if (!g.uiOpen && input.pressed.potion) this.drinkPotion(g);

    if (this.state === 'evade') {
      this.vel.copy(this.evadeDir).multiplyScalar(EVADE_SPEED * (1 - (this.stateTime / EVADE_TIME) * 0.5));
      if (this.stateTime >= EVADE_TIME) this.setState('move');
    } else if (this.state === 'move') {
      const slow = this.castLock > 0 ? 0.35 : 1;
      const speed = this.stats.moveSpeed * slow;
      const k = Math.min(1, 45 * dt / 6);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
      if (this.castLock <= 0 && move.mag > 0.1) this.turnToward(Math.atan2(move.x, move.z), 16, dt);
    }
    // 'attack' and 'leap' velocity is driven by abilities.js

    if (this.state !== 'leap') {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      g.world.colliders.resolve(this.pos, RADIUS, g.inDungeon);
      this.pos.y = g.world.heightAt(this.pos.x, this.pos.z);
    }

    // Visuals
    this.group.rotation.y = this.facing;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.cloakMat.emissive.setRGB(this.flash, this.flash * 0.2, this.flash * 0.2);
    const blink = this.invuln > 0 && this.state === 'move' && this.sinceHurt < 0.4 && Math.floor(this.invuln * 20) % 2 === 0;
    this.group.visible = !blink;
    this.trailMat.opacity = Math.max(0, this.trailMat.opacity - dt * 5);
    const wantTorch = g.inDungeon ? 22 : g.world.regionAt(this.pos.x, this.pos.z) === 'ashen' ? 8 : 0;
    this.torch.intensity += (wantTorch - this.torch.intensity) * damp(4, dt);
    this.barrierMat.opacity = this.barrier > 0 ? 0.18 + Math.sin(g.time * 6) * 0.05 : Math.max(0, this.barrierMat.opacity - dt * 2);
    if (this.state !== 'attack') this.weaponPivot.rotation.y += (0.6 - this.weaponPivot.rotation.y) * damp(12, dt);
  }

  setState(s) { this.state = s; this.stateTime = 0; }
  turnToward(angle, rate, dt) { this.facing += angleDelta(this.facing, angle) * damp(rate, dt); }

  startEvade(move, g) {
    this.evadeCharges--;
    if (move.mag > 0.1) this.evadeDir.set(move.x, 0, move.z).normalize();
    else this.evadeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.facing = Math.atan2(this.evadeDir.x, this.evadeDir.z);
    this.invuln = EVADE_TIME + 0.1;
    this.setState('evade');
    g.abilities.cancel();
    if (this.stats.powers.has('nergal')) this.addBarrier(this.stats.maxLife * 0.15, 3);
    g.fx.rumble(0.2, 0.3, 60);
    g.fx.burst(this.pos.clone().setY(this.pos.y + 0.4), 0x7fb2ff, 8, 2, { up: 1, life: 0.35, gravity: 0 });
  }

  addBarrier(amount, duration) {
    this.barrier = Math.max(this.barrier, amount);
    this.barrierTime = Math.max(this.barrierTime, duration);
  }

  drinkPotion(g) {
    if (this.potions <= 0) { g.hud.notify('No healing potions left', 'warn'); return; }
    if (this.life >= this.stats.maxLife) { g.hud.notify('Life is already full', 'warn'); return; }
    this.potions--;
    const heal = this.stats.maxLife * this.potionHeal;
    this.life = Math.min(this.stats.maxLife, this.life + heal);
    g.fx.number(this.pos, heal, { color: '#7dff8a' });
    g.fx.burst(this.pos.clone().setY(this.pos.y + 1), 0x7dff8a, 18, 2.5, { up: 3, life: 0.7, gravity: -2 });
  }

  heal(amount) { this.life = Math.min(this.stats.maxLife, this.life + amount); }

  // Damage from an attacker of a given level. Returns true if it landed.
  takeDamage(raw, g, attackerLevel = 1) {
    if (this.dead || this.invuln > 0 || this.state === 'evade' || this.state === 'leap') return false;
    let amount = raw * (1 - armorReduction(this.stats.armor, attackerLevel));
    if (this.barrier > 0) {
      const absorbed = Math.min(this.barrier, amount);
      this.barrier -= absorbed;
      amount -= absorbed;
      if (this.barrier <= 0) this.barrierTime = 0;
    }
    if (amount <= 0) return true;
    this.life -= amount;
    this.sinceHurt = 0;
    this.flash = 1;
    this.invuln = 0.15;
    g.abilities.interruptChannel();
    g.fx.number(this.pos, amount, { color: '#ff5d5d' });
    g.fx.shake(Math.min(0.4, 0.12 + amount / this.stats.maxLife));
    g.fx.rumble(0.7, 0.4, 120);
    if (this.life <= 0) {
      this.life = 0;
      this.dead = true;
      this.group.visible = false;
      g.fx.burst(this.pos.clone().setY(this.pos.y + 1), 0x3a64c8, 60, 8, { up: 5, life: 1.2 });
      g.onPlayerDeath();
    }
    return true;
  }

  serialize() {
    return {
      level: this.level, xp: this.xp, gold: this.gold, inventory: this.inventory, equipment: this.equipment,
      skillRanks: this.skillRanks, skillPoints: this.skillPoints, slots: this.slots, aspectIndex: this.aspectIndex,
      potionLevel: this.potionLevel, lastWaypoint: this.lastWaypoint,
    };
  }
}

