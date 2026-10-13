import { Enemy } from './enemies.js';
import { angleDelta, damp } from '../core/util.js';

// Neti, Keeper of the First Gate. Cycles through telegraphed attacks, summons
// Gallu and shields himself at 60% and 30% life, and speeds up when enraged.
export class Neti extends Enemy {
  constructor(level, x, z, scene) {
    super('neti', { level, x, z }, scene);
    this.named = { id: 'neti', name: TYPE_NAME, affixes: [] };
    this.name = TYPE_NAME;
    this.pattern = ['slam', 'sweep', 'slam', 'seals'];
    this.step = 0;
    this.summoned = new Set();
    this.shielded = false;
    this.shieldTime = 0;
    this.adds = [];
    this.spawning = 1.2;
  }

  get enraged() { return this.hp < this.maxHp * 0.3; }

  think(dt, g, dist) {
    const p = g.player;
    const mgr = g.enemies;
    if (!this.aggro) {
      if (dist < 17 && !p.dead) { this.aggro = true; if (!this.introDone) g.hud.banner(this.name, 'boss'); }
      return;
    }
    if (p.dead) { this.aggro = false; this.hp = this.maxHp; this.setState('idle'); return; }

    // Summon + shield thresholds.
    for (const t of [0.6, 0.3]) {
      if (this.hp < this.maxHp * t && !this.summoned.has(t)) {
        this.summoned.add(t);
        this.shielded = true;
        this.shieldTime = 9;
        this.adds = [];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const add = mgr.add(new Enemy('gallu', { level: this.level - 1, x: this.pos.x + Math.cos(a) * 6, z: this.pos.z + Math.sin(a) * 6 }, mgr.scene));
          add.dungeon = true;
          add.aggro = true;
          this.adds.push(add);
        }
        g.hud.notify('Neti calls the Gallu to the gate. His seal shields him.', 'boss');
        g.events.emit('bossPhase', { phase: t, boss: this });
        g.fx.shake(0.5);
      }
    }
    if (this.shielded) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0 || this.adds.every((a) => !a.alive)) this.shielded = false;
    }
    this.group.userData.gold.emissive.setHex(this.shielded ? 0x806020 : 0x000000);

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const speedUp = this.enraged ? 0.72 : 1;
    let wx = 0, wz = 0;
    this.facing += angleDelta(this.facing, Math.atan2(dx, dz)) * damp(this.state === 'windup' ? 2 : 6, dt);

    if (this.state === 'idle' || this.state === 'chase') {
      this.state = 'chase';
      if (dist > 5) { wx = (dx / dist) * this.def.speed; wz = (dz / dist) * this.def.speed; }
      if (this.stateTime > 1.1 * speedUp) this.beginAttack(g);
    } else if (this.state === 'windup') {
      const a = this.attack;
      if (a === 'sweep') mgr.showArc(this, g, this.stateTime / (0.95 * speedUp), 6.5);
      if (this.stateTime >= this.windupTime) {
        if (a === 'sweep') {
          const off = Math.abs(angleDelta(this.facing, Math.atan2(dx, dz)));
          if (dist < 7 && off < 1.15) p.takeDamage(this.dmg * 1.2, g, this.level);
          g.fx.burst(this.pos.clone().setY(this.pos.y + 1).addScaledVector({ x: Math.sin(this.facing) * 3, y: 0, z: Math.cos(this.facing) * 3 }, 1), 0x9a6bff, 30, 6, { up: 3, life: 0.5 });
          g.fx.shake(0.3);
          mgr.hideArc(this);
        }
        this.setState('recover');
      }
    } else if (this.state === 'recover' && this.stateTime > 0.7 * speedUp) {
      this.setState('chase');
    }
    this.vel.x += (wx - this.vel.x) * damp(6, dt);
    this.vel.z += (wz - this.vel.z) * damp(6, dt);
  }

  beginAttack(g) {
    const p = g.player;
    const mgr = g.enemies;
    const speedUp = this.enraged ? 0.72 : 1;
    this.attack = this.pattern[this.step++ % this.pattern.length];
    this.setState('windup');
    if (this.attack === 'slam') {
      this.windupTime = 1.1 * speedUp;
      mgr.hazard({ x: p.pos.x, z: p.pos.z, r: 4.2, delay: this.windupTime, dmg: this.dmg * 1.3, color: 0x9a6bff, level: this.level });
      if (this.enraged) mgr.hazard({ x: p.pos.x + p.vel.x * 0.8, z: p.pos.z + p.vel.z * 0.8, r: 3, delay: this.windupTime + 0.5, dmg: this.dmg, color: 0x9a6bff, level: this.level });
    } else if (this.attack === 'sweep') {
      this.windupTime = 0.95 * speedUp;
    } else {
      // Seven Seals: rings of blasts rippling outward from Neti.
      this.windupTime = 1.6;
      for (let ring = 0; ring < 3; ring++) {
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring * 0.45;
          const r = 4 + ring * 4;
          mgr.hazard({ x: this.pos.x + Math.cos(a) * r, z: this.pos.z + Math.sin(a) * r, r: 2.1, delay: (0.9 + ring * 0.55) * speedUp, dmg: this.dmg * 0.9, color: 0xd6a740, level: this.level });
        }
      }
    }
  }
}

const TYPE_NAME = 'Neti, Keeper of the First Gate';
