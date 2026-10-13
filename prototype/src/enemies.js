import * as THREE from 'three';
import { ARENA, PALETTE, resolveCollision } from './world.js';
import { damp } from './util.js';

// Enemy archetypes from the Kur underworld.
const TYPES = {
  gallu: {
    name: 'Gallu', hp: 34, speed: 3.7, radius: 0.55, range: 1.8,
    windup: 0.55, recover: 0.6, damage: 12, color: 0x7a1f1f,
  },
  scorpion: {
    name: 'Girtablullu', hp: 24, speed: 3.0, radius: 0.55, keepAway: 8,
    windup: 0.65, recover: 0.5, cooldown: 2.4, damage: 9, projSpeed: 11, color: 0x6b5a2a,
  },
};

const SPAWN_TIME = 0.7;

class Enemy {
  constructor(type, scene, x, z) {
    this.type = type;
    this.def = TYPES[type];
    this.radius = this.def.radius;
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.spawning = SPAWN_TIME;
    this.state = 'chase';
    this.stateTime = 0;
    this.cooldown = 1 + Math.random();
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.tetherCd = 0;
    this.burn = 0;
    this.burnTick = 0;
    this.slow = 0;
    this.flash = 0;
    this.dying = 0;
    this.facing = 0;

    this.group = makeModel(type, this.def.color);
    this.mat = this.group.userData.mat;
    this.group.position.set(x, -1.6, z);
    this.pos = this.group.position;
    scene.add(this.group);

    // Telegraph: a red disc that fills up during the wind-up.
    this.tele = new THREE.Mesh(
      type === 'gallu' ? new THREE.CircleGeometry(1, 28, -0.9, 1.8) : new THREE.PlaneGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.tele.rotation.x = -Math.PI / 2;
    this.tele.visible = false;
    scene.add(this.tele);

    // Health bar (always faces the fixed-yaw camera).
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x220a0a, depthTest: false, transparent: true }));
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.08), new THREE.MeshBasicMaterial({ color: 0xe0393a, depthTest: false, transparent: true }));
    this.barFill.position.z = 0.001;
    bg.renderOrder = 10; this.barFill.renderOrder = 11;
    this.bar.add(bg, this.barFill);
    this.bar.rotation.x = -0.96; // match camera pitch
    this.bar.visible = false;
    scene.add(this.bar);
  }

  hit(amount, g, { knockX = 0, knockZ = 0, crit = false, color = '#fff', silent = false } = {}) {
    if (!this.alive || this.spawning > 0) return;
    this.hp -= amount;
    this.flash = 1;
    this.knock.x += knockX;
    this.knock.z += knockZ;
    if (!silent || crit) g.fx.number(this.pos, amount, { color, big: crit });
    g.fx.burst(this.pos.clone().setY(1), 0xffc27a, silent ? 3 : 8, 4, { life: 0.35 });
    // Heavy hits interrupt wind-ups.
    if (amount >= 20 && this.state === 'windup') this.setState('recover');
    if (this.hp <= 0) this.die(g);
  }

  die(g) {
    this.alive = false;
    this.dying = 0.45;
    this.tele.visible = false;
    this.bar.visible = false;
    g.kills++;
    g.fx.burst(this.pos.clone().setY(1), PALETTE.gold, 26, 6, { up: 4, life: 0.9 });
    g.fx.burst(this.pos.clone().setY(0.8), 0x5a2bd8, 14, 3, { up: 6, life: 1.1, gravity: -2 });
    g.fx.stop(0.035);
    g.fx.rumble(0.25, 0.4, 60);
  }

  setState(s) { this.state = s; this.stateTime = 0; }

  update(dt, g) {
    if (this.spawning > 0) {
      this.spawning -= dt;
      this.pos.y = -1.6 * Math.max(0, this.spawning / SPAWN_TIME);
      if (Math.random() < 0.5) g.fx.burst(this.pos.clone().setY(0.1), 0x5a2bd8, 1, 2, { up: 3, life: 0.5, gravity: 0 });
      return;
    }
    this.pos.y = 0;
    if (!this.alive) {
      this.dying -= dt;
      const k = Math.max(0, this.dying / 0.45);
      this.group.scale.set(1 + (1 - k) * 0.3, k, 1 + (1 - k) * 0.3);
      return;
    }

    this.stateTime += dt;
    this.tetherCd = Math.max(0, this.tetherCd - dt);
    this.slow = Math.max(0, this.slow - dt);
    this.cooldown -= dt;

    // Burning (from the Tether of Gibil).
    if (this.burn > 0) {
      this.burn -= dt;
      this.burnTick -= dt;
      if (Math.random() < 0.4) g.fx.burst(this.pos.clone().setY(1), PALETTE.ember, 1, 1, { up: 3, life: 0.4, gravity: -3 });
      if (this.burnTick <= 0) { this.burnTick = 0.4; this.hit(2, g, { color: '#ff9a4a', silent: true }); if (!this.alive) return; }
    }

    const p = g.player;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = this.def.speed * (this.slow > 0 ? 0.45 : 1);
    const want = new THREE.Vector3();

    if (this.type === 'gallu') {
      if (this.state === 'chase') {
        want.set(dx / dist, 0, dz / dist).multiplyScalar(speed);
        this.facing = Math.atan2(dx, dz);
        if (dist < this.def.range && !p.dead) this.setState('windup');
      } else if (this.state === 'windup') {
        const k = this.stateTime / this.def.windup;
        this.showTele(k, this.def.range + 0.4);
        if (k >= 1) {
          // Strike: hits if the player is still in the telegraphed arc.
          const a = Math.atan2(dx, dz);
          const off = Math.abs(((a - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (dist < this.def.range + 0.5 && off < 1.0) p.takeDamage(this.def.damage, g);
          g.fx.burst(this.pos.clone().setY(0.3).addScaledVector(new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)), 1.4), 0xff6a3a, 8, 3, { life: 0.3 });
          this.tele.visible = false;
          this.setState('recover');
        }
      } else if (this.state === 'recover' && this.stateTime > this.def.recover) {
        this.setState('chase');
      }
    } else {
      // Scorpion-man: keeps distance, then fires a telegraphed bolt.
      this.facing = Math.atan2(dx, dz);
      if (this.state === 'chase') {
        const keep = this.def.keepAway;
        const radial = dist > keep + 1.5 ? 1 : dist < keep - 1.5 ? -1 : 0;
        const strafe = Math.sin(g.time * 0.7 + this.pos.x) > 0 ? 0.5 : -0.5;
        want.set((dx / dist) * radial - (dz / dist) * strafe, 0, (dz / dist) * radial + (dx / dist) * strafe).multiplyScalar(speed);
        if (this.cooldown <= 0 && dist < keep + 5 && !p.dead) this.setState('windup');
      } else if (this.state === 'windup') {
        const k = this.stateTime / this.def.windup;
        this.showTele(k, Math.min(dist, 14));
        if (k >= 1) {
          g.enemies.fire(this.pos, this.facing, this.def.projSpeed, this.def.damage);
          this.tele.visible = false;
          this.cooldown = this.def.cooldown + Math.random();
          this.setState('recover');
        }
      } else if (this.state === 'recover' && this.stateTime > this.def.recover) {
        this.setState('chase');
      }
    }

    this.vel.x += (want.x - this.vel.x) * damp(8, dt);
    this.vel.z += (want.z - this.vel.z) * damp(8, dt);
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 8));
    resolveCollision(this.pos, this.radius, g.world.colliders);

    // Visuals
    this.group.rotation.y = this.facing;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.emissive.setRGB(this.flash + (this.burn > 0 ? 0.25 : 0), this.flash * 0.9 + (this.burn > 0 ? 0.08 : 0), this.flash * 0.8 + (this.slow > 0 ? 0.3 : 0));
    const wobble = this.state === 'windup' ? Math.sin(this.stateTime * 40) * 0.05 : 0;
    this.group.scale.set(1 + wobble, 1 - wobble, 1 + wobble);
    this.bar.visible = this.hp < this.maxHp;
    this.bar.position.set(this.pos.x, 2.4, this.pos.z);
    this.barFill.scale.x = Math.max(0.001, this.hp / this.maxHp);
    this.barFill.position.x = -0.53 * (1 - this.barFill.scale.x);
  }

  showTele(k, length) {
    this.tele.visible = true;
    this.tele.material.opacity = 0.15 + k * 0.45;
    if (this.type === 'gallu') {
      this.tele.position.set(this.pos.x, 0.03, this.pos.z);
      this.tele.rotation.z = this.facing - Math.PI / 2;
      this.tele.scale.setScalar(Math.max(0.1, k) * length);
    } else {
      // A thin line toward the player showing where the bolt will fly.
      this.tele.scale.set(0.3 + k * 0.4, length, 1);
      this.tele.position.set(this.pos.x + Math.sin(this.facing) * length / 2, 0.03, this.pos.z + Math.cos(this.facing) * length / 2);
      this.tele.rotation.z = this.facing;
    }
  }

  dispose(scene) {
    scene.remove(this.group, this.tele, this.bar);
  }
}

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.projectiles = [];
    this.wave = 0;
    this.nextWaveIn = 1.5;
    this.boltGeo = new THREE.SphereGeometry(0.22, 8, 6);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xff5a3a });
  }

  reset() {
    for (const e of this.list) e.dispose(this.scene);
    for (const b of this.projectiles) this.scene.remove(b.mesh);
    this.list = [];
    this.projectiles = [];
    this.wave = 0;
    this.nextWaveIn = 1.5;
  }

  get aliveCount() { return this.list.filter((e) => e.alive).length; }

  spawnWave(g) {
    this.wave++;
    const gallu = 3 + this.wave * 2;
    const scorpions = this.wave >= 2 ? Math.floor(this.wave / 2) + 1 : 0;
    const spots = [[0, -ARENA + 1], [-ARENA + 1, 0], [ARENA - 1, 0], [0, ARENA - 1]];
    const spawn = (type, i) => {
      const [sx, sz] = spots[(i + this.wave) % spots.length];
      const x = sx + (Math.random() - 0.5) * 6, z = sz + (Math.random() - 0.5) * 6;
      const e = new Enemy(type, this.scene, x, z);
      e.spawning += i * 0.15; // stagger
      this.list.push(e);
    };
    for (let i = 0; i < gallu; i++) spawn('gallu', i);
    for (let i = 0; i < scorpions; i++) spawn('scorpion', i + gallu);
    g.hud.banner(`Gate I · Wave ${this.wave}`);
  }

  fire(from, facing, speed, damage) {
    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
    mesh.position.set(from.x + Math.sin(facing) * 0.8, 1.1, from.z + Math.cos(facing) * 0.8);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, pos: mesh.position, vx: Math.sin(facing) * speed, vz: Math.cos(facing) * speed, damage, life: 2.5 });
  }

  update(dt, g) {
    for (const e of this.list) e.update(dt, g);

    // Simple separation so packs spread out instead of stacking.
    const alive = this.list.filter((e) => e.alive && e.spawning <= 0);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
      // Don't walk through the player.
      const a = alive[i], p = g.player;
      if (!p.dead && p.state !== 'dodge') {
        const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + 0.5;
        if (d < min && d > 1e-4) { a.pos.x = p.pos.x + (dx / d) * min; a.pos.z = p.pos.z + (dz / d) * min; }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      b.pos.x += b.vx * dt;
      b.pos.z += b.vz * dt;
      b.life -= dt;
      let gone = b.life <= 0 || Math.abs(b.pos.x) > ARENA + 1 || Math.abs(b.pos.z) > ARENA + 1;
      if (!gone && g.tether.blocksProjectile(b.pos, g)) gone = true;
      if (!gone && Math.hypot(b.pos.x - g.player.pos.x, b.pos.z - g.player.pos.z) < 0.7) {
        if (g.player.takeDamage(b.damage, g)) gone = true;
      }
      if (gone) { this.scene.remove(b.mesh); this.projectiles.splice(i, 1); }
    }

    // Clean up finished death animations.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive && e.dying <= 0) { e.dispose(this.scene); this.list.splice(i, 1); }
    }

    if (this.list.length === 0 && !g.player.dead) {
      this.nextWaveIn -= dt;
      if (this.nextWaveIn <= 0) { this.spawnWave(g); this.nextWaveIn = 2.5; }
    }
  }
}

function makeModel(type, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, emissive: 0x000000 });
  const horn = new THREE.MeshStandardMaterial({ color: 0xe8d6b0, roughness: 0.5 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const parts = [];
  if (type === 'gallu') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), mat);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat);
    head.position.set(0, 1.8, 0.1);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 6), horn);
      h.position.set(s * 0.25, 2.15, 0.05);
      h.rotation.z = -s * 0.5;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), mat);
      leg.position.set(s * 0.25, 0.25, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), mat);
      arm.position.set(s * 0.6, 1.0, 0.25);
      arm.rotation.x = -0.6;
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), eye);
      e.position.set(s * 0.13, 1.85, 0.38);
      parts.push(h, leg, arm, e);
    }
    parts.push(body, head);
  } else {
    // Scorpion-man: humanoid torso on a scorpion body with a raised tail.
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat);
    abdomen.scale.set(1, 0.6, 1.3);
    abdomen.position.y = 0.55;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.8, 8), mat);
    torso.position.set(0, 1.25, 0.35);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat);
    head.position.set(0, 1.8, 0.4);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 4, 12, Math.PI), horn);
    bow.position.set(0, 1.3, 0.75);
    bow.rotation.set(0, 0, Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.16 - k * 0.02, 6, 4), mat);
      seg.position.set(0, 0.7 + k * 0.32, -0.6 - Math.sin(k * 0.7) * 0.3);
      parts.push(seg);
    }
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), horn);
    sting.position.set(0, 1.85, -0.35);
    sting.rotation.x = 2.2;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), mat);
        leg.position.set(s * 0.55, 0.3, -0.3 + k * 0.35);
        leg.rotation.z = s * 0.5;
        parts.push(leg);
      }
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), eye);
      e.position.set(s * 0.08, 1.85, 0.58);
      parts.push(e);
    }
    parts.push(abdomen, torso, head, bow, sting);
  }
  for (const p of parts) { p.castShadow = true; g.add(p); }
  g.userData.mat = mat;
  return g;
}
