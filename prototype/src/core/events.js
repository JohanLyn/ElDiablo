// Tiny synchronous event bus. Gameplay emits semantic events (hit, kill,
// skillCast, lootDrop...) and presentation systems (audio, VFX, tutorial)
// subscribe, so they never need hooks inside gameplay code.
//
// Event catalogue (payload fields):
//   hit {enemy, amount, crit, pos}            kill {enemy, pos}
//   playerHurt {amount, pos}                   playerDeath {pos}
//   skillCast {id, pos}                        strikeSwing {combo, pos, facing, reach}
//   javelinThrow {pos, dir}                    javelinHit {pos}
//   lightning {pos}                            leapStart {pos}   leapLand {pos, r}
//   snap {a, b, aspect}                        aegis {pos}       pyrePulse {pos, r}
//   evade {pos, dir}                           potion {pos}      footstep {pos, who}
//   tetherHit {pos, aspect}                    aspectChange {aspect}
//   enemyWindup {enemy}                        enemyAttack {enemy}   enemyProjectile {pos}
//   hazardBlast {x, z, r, color}               bossPhase {phase}
//   lootDrop {item, pos}                       pickup {kind, rarity, amount}
//   levelUp {level}                            questUpdate {kind, quest}
//   regionEnter {id}                           waypoint {id}     shrine {kind}
//   chestOpen {pos}                            portal {}         uiOpen {kind}
//   uiMove {}  uiConfirm {}  uiBack {}         denied {reason}
export class Events {
  constructor() { this.map = new Map(); }

  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (list) list.splice(list.indexOf(fn) >>> 0, 1);
  }

  emit(name, payload = {}) {
    const list = this.map.get(name);
    if (!list) return;
    for (const fn of list) {
      try { fn(payload); } catch (err) { console.error(`[events] ${name} handler failed`, err); }
    }
  }
}
