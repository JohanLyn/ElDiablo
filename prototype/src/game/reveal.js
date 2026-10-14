import * as THREE from 'three';

// Region reveal: the first time a hero enters a region or dungeon (per save, stored in
// g.flags.reveal) the camera pulls back and tilts toward the place's landmark for about
// 2.5 seconds, under the regular region banner. Gameplay is paused while it plays
// (g.revealing, honoured by the frame loop), any fresh input skips it, and it never
// starts while enemies are aggroed nearby.
//
// Cinematic poses reuse two preallocated vectors; nothing is allocated per frame.

const PITCH = THREE.MathUtils.degToRad(56);
const DURATION = 2.7;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Where to look, how high/far the camera swings, and how far the haze lifts.
const SHOTS = {
  town: { target: [0, 3, 152], lift: 30, back: 16, look: 0.85, fog: 140 },
  marsh: { target: [-108, 5, 26], lift: 26, back: 16, look: 0.9, fog: 220 },
  ruins: { target: [162, 17, 14], lift: 34, back: 18, look: 0.9, fog: 320 },
  ashen: { target: [0, 42, -199], lift: 30, back: 18, look: 0.92, fog: 400 },
  dungeon: { target: null, lift: 30, back: 6, look: 1, fog: 0, ahead: [0, -16], },
  cistern: { target: null, lift: 30, back: 6, look: 1, fog: 0, ahead: [0, -16] },
};

export class Reveal {
  constructor(g) {
    this.g = g;
    this.shot = null;
    this.t = 0;
    this.region = null;
    this.regionT = 0;
    this.armed = false;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.hero = new THREE.Vector3();
    this.p0 = new THREE.Vector3(); this.l0 = new THREE.Vector3();
    this.p1 = new THREE.Vector3(); this.l1 = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.out = { pos: this.pos, look: this.look };
    this.fn = (t) => this.pose(t);
    this.seeded = false;
    this.flagsRef = null;
    this.k = 0;
  }

  get active() { return !!this.shot; }
  seen(id) { return !!this.g.flags.reveal?.[id]; }
  mark(id) { (this.g.flags.reveal ??= {})[id] = 1; }

  // Called every frame, after world.update (so the haze override sticks) and before the camera rig.
  update(dt) {
    const g = this.g;
    if (this.shot) { this.tick(dt); return; }
    if (g.simDriven || !g.started || g.ui.open || g.player.dead || g.rig.cinematic) { if (!g.started) this.seeded = false; return; }
    const region = g.world.regionAt(g.player.pos.x, g.player.pos.z);
    if (g.flags !== this.flagsRef) { this.flagsRef = g.flags; this.seeded = false; } // new game or load
    if (!this.seeded) {
      // Wherever the hero starts or resumes counts as already seen.
      this.seeded = true;
      this.region = region;
      this.mark(region);
      return;
    }
    if (region !== this.region) { this.region = region; this.regionT = 0; return; }
    this.regionT += dt;
    if (this.seen(region) || !SHOTS[region]) return;
    if (!g.flags.introDone) return;
    if (this.regionT > 12) { this.mark(region); return; } // missed our chance (kept fighting); don't spring it on them later
    if (this.regionT < 0.15 || this.nearCombat()) return;
    this.begin(region);
  }

  nearCombat() {
    const g = this.g, p = g.player.pos;
    if (g.combatNearby) return true;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.aggro) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
      if (dx * dx + dz * dz < 45 * 45) return true;
    }
    return false;
  }

  begin(region) {
    const g = this.g;
    this.mark(region);
    this.shot = { id: region, ...SHOTS[region] };
    this.t = 0;
    this.k = 0;
    this.hero.copy(g.player.pos);
    // The regular follow pose, which the cinematic starts from and returns to.
    const rig = g.rig;
    this.l0.set(rig.target.x, rig.target.y + 0.6, rig.target.z);
    this.p0.set(rig.target.x, rig.target.y + Math.sin(PITCH) * rig.distance, rig.target.z + Math.cos(PITCH) * rig.distance);
    // The far pose looks toward the landmark from behind the hero.
    const s = this.shot;
    if (s.target) this.l1.set(s.target[0], s.target[1], s.target[2]);
    else this.l1.set(this.hero.x + s.ahead[0], this.hero.y + 1, this.hero.z + s.ahead[1]);
    this.dir.set(this.l1.x - this.hero.x, 0, this.l1.z - this.hero.z);
    const dist = this.dir.length() || 1;
    this.dir.divideScalar(dist);
    s.dist = dist;
    this.armed = false;
    g.revealing = true;
    g.rig.setCinematic(this.fn);
    g.events.emit('reveal', { id: region });
  }

  pose(t) {
    const s = this.shot, hero = this.hero, k = this.k;
    const u = Math.min(1, t / DURATION);
    // Far pose: behind the hero, high up, drifting sideways slowly while it holds.
    const drift = (u - 0.5) * 9;
    const fx = hero.x - this.dir.x * s.back + -this.dir.z * drift;
    const fz = hero.z - this.dir.z * s.back + this.dir.x * drift;
    const fy = hero.y + s.lift;
    // The look point slides from the hero toward the landmark (never all the way for distant ones).
    const reach = s.look;
    const lx = hero.x + (this.l1.x - hero.x) * reach, lz = hero.z + (this.l1.z - hero.z) * reach;
    const ly = this.l1.y;
    this.pos.set(this.p0.x + (fx - this.p0.x) * k, this.p0.y + (fy - this.p0.y) * k, this.p0.z + (fz - this.p0.z) * k);
    this.look.set(this.l0.x + (lx - this.l0.x) * k, this.l0.y + (ly - this.l0.y) * k, this.l0.z + (lz - this.l0.z) * k);
    return this.out;
  }

  tick(dt) {
    const g = this.g, input = g.input;
    this.t += dt;
    const u = this.t / DURATION;
    // Ease out, hold, ease back.
    this.k = smooth(0, 0.34, u) * (1 - smooth(0.7, 1, u));
    // Lift the haze so a landmark far across the map shows through.
    const fog = g.scene.fog;
    if (fog && this.shot.fog) { fog.far = fog.far + (Math.max(fog.far, this.shot.fog) - fog.far) * this.k; fog.near = fog.near + (fog.far * 0.35 - fog.near) * this.k * 0.5; }
    // Input: whatever was held when it began is ignored until released; anything fresh skips.
    let any = input.move.mag > 0.25;
    for (const k of Object.keys(input.pressed)) if (input.pressed[k]) { any = true; break; }
    for (const k of Object.keys(input.down)) if (input.down[k]) { any = true; break; }
    if (!any) this.armed = true;
    const moved = g.player.pos.distanceToSquared(this.hero) > 9;
    if (this.armed && any || moved || g.ui.open || g.player.dead || this.t >= DURATION) this.finish(this.armed && any);
  }

  finish(skipped) {
    const g = this.g;
    this.shot = null;
    g.revealing = false;
    g.rig.setCinematic(null);
    if (skipped) {
      // Don't let the skipping press also swing a weapon.
      for (const k of Object.keys(g.input.pressed)) g.input.pressed[k] = false;
      g.suppressInput = true;
    }
    this.regionT = 99;
  }
}
