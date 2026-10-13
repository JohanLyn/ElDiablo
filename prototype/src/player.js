import * as THREE from 'three';
import { PALETTE, resolveCollision } from './world.js';
import { angleDelta, damp, inCone } from './util.js';

const SPEED = 6.5;
const ACCEL = 45;
const DODGE_SPEED = 19;
const DODGE_TIME = 0.2;
const DODGE_CHARGES = 2;
const DODGE_RECHARGE = 1.4;
const RADIUS = 0.5;

// 3-hit combo: [duration, hit moment (0..1), damage, reach, half-angle, knockback]
const COMBO = [
  { time: 0.3, hitAt: 0.4, dmg: 12, reach: 2.5, arc: 1.15, knock: 3 },
  { time: 0.3, hitAt: 0.4, dmg: 12, reach: 2.5, arc: 1.15, knock: 3 },
  { time: 0.46, hitAt: 0.45, dmg: 24, reach: 2.9, arc: 1.4, knock: 9 },
];
const COMBO_WINDOW = 0.35; // seconds after a swing during which the next press continues the combo

export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98f62, roughness: 0.7 });
    this.cloakMat = new THREE.MeshStandardMaterial({ color: PALETTE.lapisLight, roughness: 0.6, emissive: 0x000000 });
    const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.85, roughness: 0.3 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), this.cloakMat);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
    head.position.y = 1.75;
    const helm = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 10), gold);
    helm.position.y = 2.05;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.06, 6, 16), gold);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.95;
    // Weapon pivot swings around the body during attacks.
    this.weaponPivot = new THREE.Group();
    this.weaponPivot.position.y = 1.1;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1.5), gold);
    blade.position.set(0.55, 0, 0.75);
    this.weaponPivot.add(blade);
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const trail = new THREE.Mesh(new THREE.RingGeometry(1.0, 2.5, 24, 1, -0.9, 1.8), this.trailMat);
    trail.rotation.x = -Math.PI / 2;
    trail.rotation.z = -Math.PI / 2; // arc centred on local +Z (forward)
    trail.position.y = 1.0;
    this.trail = trail;

    for (const m of [body, head, helm, belt, blade]) m.castShadow = true;
    this.group.add(body, head, helm, belt, this.weaponPivot, trail);
    scene.add(this.group);

    this.pos = this.group.position;
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 4);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI; // facing -Z (toward the gate)
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.dead = false;
    this.state = 'move';
    this.stateTime = 0;
    this.dodgeCharges = DODGE_CHARGES;
    this.dodgeRecharge = 0;
    this.dodgeDir = new THREE.Vector3();
    this.invuln = 0;
    this.combo = 0;
    this.comboWindow = 0;
    this.hitDone = false;
    this.queuedAttack = false;
    this.sinceHurt = 10;
    this.flash = 0;
    this.group.visible = true;
  }

  update(dt, g) {
    const { input } = g;
    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.sinceHurt += dt;
    if (this.dead) return;

    if (this.dodgeCharges < DODGE_CHARGES) {
      this.dodgeRecharge += dt;
      if (this.dodgeRecharge >= DODGE_RECHARGE) { this.dodgeCharges++; this.dodgeRecharge = 0; }
    }
    if (this.sinceHurt > 4) this.hp = Math.min(this.maxHp, this.hp + 3 * dt);

    const move = input.move;
    if (input.pressed.dodge && this.dodgeCharges > 0 && this.state !== 'dodge') this.startDodge(move, g);
    if (input.pressed.attack) this.queuedAttack = true;

    if (this.state === 'dodge') {
      this.vel.copy(this.dodgeDir).multiplyScalar(DODGE_SPEED * (1 - this.stateTime / DODGE_TIME * 0.5));
      if (Math.random() < 0.6) g.fx.burst(this.pos.clone().setY(0.4), PALETTE.lapisLight, 1, 1, { up: 1, life: 0.3, gravity: 0 });
      if (this.stateTime >= DODGE_TIME) this.setState('move');
    } else if (this.state === 'attack') {
      this.updateAttack(dt, g, move);
    } else {
      if (this.queuedAttack || input.down.attack) this.startAttack(g, move);
      const targetVx = move.x * SPEED, targetVz = move.z * SPEED;
      const k = Math.min(1, ACCEL * dt / SPEED);
      this.vel.x += (targetVx - this.vel.x) * k;
      this.vel.z += (targetVz - this.vel.z) * k;
      if (move.mag > 0.1) this.turnToward(Math.atan2(move.x, move.z), 16, dt);
    }

    this.pos.addScaledVector(this.vel, dt);
    resolveCollision(this.pos, RADIUS, g.world.colliders);

    // Visuals
    this.group.rotation.y = this.facing;
    this.flash = Math.max(0, this.flash - dt * 5);
    const blink = this.invuln > 0 && this.state !== 'dodge' && Math.floor(this.invuln * 20) % 2 === 0;
    this.cloakMat.emissive.setRGB(this.flash, this.flash * 0.2, this.flash * 0.2);
    this.group.visible = !blink;
    this.trailMat.opacity = Math.max(0, this.trailMat.opacity - dt * 5);
    if (this.state !== 'attack') this.weaponPivot.rotation.y += (0.6 - this.weaponPivot.rotation.y) * damp(12, dt);
  }

  setState(s) { this.state = s; this.stateTime = 0; }

  turnToward(angle, rate, dt) {
    this.facing += angleDelta(this.facing, angle) * damp(rate, dt);
  }

  startDodge(move, g) {
    this.dodgeCharges--;
    if (move.mag > 0.1) this.dodgeDir.set(move.x, 0, move.z).normalize();
    else this.dodgeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.invuln = DODGE_TIME + 0.08;
    this.queuedAttack = false;
    this.setState('dodge');
    g.fx.rumble(0.2, 0.3, 60);
  }

  // Soft-target aim assist: prefer enemies near the stick direction, then nearest.
  findTarget(g, move) {
    const dir = move.mag > 0.2 ? Math.atan2(move.x, move.z) : this.facing;
    let best = null, bestScore = Infinity;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d > 5.5) continue;
      const a = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      const off = Math.abs(angleDelta(dir, a));
      if (off > 1.2 && d > 2) continue;
      const score = d + off * 2.5;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  startAttack(g, move) {
    this.queuedAttack = false;
    if (this.comboWindow <= 0) this.combo = 0;
    const target = this.findTarget(g, move);
    if (target) {
      this.facing = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      const d = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      // Short lunge to close distance so swings connect.
      const lunge = Math.max(0, Math.min(d - 1.8, 2.2));
      this.vel.set(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(lunge / 0.12);
    } else {
      if (move.mag > 0.2) this.facing = Math.atan2(move.x, move.z);
      this.vel.multiplyScalar(0.3);
    }
    this.hitDone = false;
    this.setState('attack');
    this.weaponPivot.rotation.y = this.combo === 1 ? -1.6 : 1.6;
  }

  updateAttack(dt, g, move) {
    const step = COMBO[this.combo];
    const p = this.stateTime / step.time;
    // Lunge only during the first few frames, then plant feet.
    if (this.stateTime > 0.12) this.vel.multiplyScalar(Math.max(0, 1 - dt * 20));
    const from = this.combo === 1 ? -1.6 : 1.6;
    const sweep = Math.min(1, p / step.hitAt) ** 2;
    this.weaponPivot.rotation.y = from - from * 2 * sweep;
    if (this.combo === 2) this.weaponPivot.rotation.y += Math.sin(p * Math.PI) * 0.5;

    if (!this.hitDone && p >= step.hitAt) {
      this.hitDone = true;
      this.trailMat.opacity = 0.75;
      this.trail.scale.setScalar(step.reach / 2.5);
      let hits = 0;
      for (const e of g.enemies.list) {
        if (!e.alive || e.spawning) continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (d > step.reach + e.radius) continue;
        if (d > 0.8 && !inCone(this.pos.x, this.pos.z, this.facing, e.pos.x, e.pos.z, step.arc)) continue;
        const crit = Math.random() < 0.12;
        const kx = e.pos.x - this.pos.x, kz = e.pos.z - this.pos.z;
        const kl = Math.hypot(kx, kz) || 1;
        e.hit(step.dmg * (crit ? 2 : 1), g, { knockX: (kx / kl) * step.knock, knockZ: (kz / kl) * step.knock, crit, color: crit ? '#ffd166' : '#ffffff' });
        hits++;
      }
      if (hits) {
        g.fx.stop(this.combo === 2 ? 0.09 : 0.05);
        g.fx.shake(this.combo === 2 ? 0.35 : 0.18);
        g.fx.rumble(this.combo === 2 ? 0.7 : 0.35, 0.5, this.combo === 2 ? 120 : 70);
      }
    }

    if (p >= 1) {
      this.combo = (this.combo + 1) % COMBO.length;
      this.comboWindow = this.combo === 0 ? 0 : COMBO_WINDOW;
      this.setState('move');
      if (this.queuedAttack || g.input.down.attack) this.startAttack(g, move);
    }
  }

  takeDamage(amount, g) {
    if (this.dead || this.invuln > 0) return false;
    this.hp -= amount;
    this.sinceHurt = 0;
    this.flash = 1;
    this.invuln = 0.35;
    g.fx.number(this.pos, amount, { color: '#ff5d5d' });
    g.fx.shake(0.3);
    g.fx.rumble(0.8, 0.4, 140);
    g.fx.burst(this.pos.clone().setY(1), 0xff3b3b, 10, 4);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.group.visible = false;
      g.fx.burst(this.pos.clone().setY(1), PALETTE.lapisLight, 60, 8, { up: 5, life: 1.2 });
      g.onPlayerDeath();
    }
    return true;
  }
}
