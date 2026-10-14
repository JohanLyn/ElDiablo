// Night of the Gidim: the pure rules. No three.js, no DOM, so they can be unit-tested.
// The dead of the day rise at night (see gidim.js for the runtime that uses these).

export const MARK_CAP = 60;
export const MAX_ACTIVE = 24; // risen gidim alive at once (also the perf budget)
export const RISE_RADIUS = 70; // marks this close to the hero rise
export const RISE_SPREAD = 4; // seconds over which the first wave stagger-rises
export const ASH_COST = 15; // Ghost-ash per Night Blessing

// Gidim are a bonus, not a wall: HP x0.7, damage x0.8, XP x0.5 of the base monster, speed x0.8.
export const BASE = { hp: 0.7, dmg: 0.8, speed: 0.8, xp: 0.5 };

// Per-variant tuning on top of BASE. `title` prefixes the monster name.
export const VARIANTS = {
  plain: { title: 'Gidim', hp: 1, dmg: 1, speed: 1, scale: 1, xp: 1, ash: 1, tint: 0x7fe8e0, blurb: 'A plain gidim' },
  burning: { title: 'Burning Gidim', hp: 0.9, dmg: 1, speed: 1.1, scale: 1, xp: 1.2, ash: 1, tint: 0xffa860, blurb: 'Leaves a trail of ghost-fire' },
  chained: { title: 'Chained Gidim', hp: 1.25, dmg: 1.15, speed: 1, scale: 1.05, xp: 1.2, ash: 1, tint: 0x9fb4ff, blurb: 'Bound to its mark; lunges' },
  shattered: { title: 'Shattered Gidim', hp: 0.8, dmg: 0.9, speed: 1, scale: 1, xp: 1.2, ash: 1, tint: 0xd6f4ff, blurb: 'Splits into two shards' },
  shard: { title: 'Gidim Shard', hp: 0.3, dmg: 0.55, speed: 1.15, scale: 0.62, xp: 0.25, ash: 0.5, tint: 0xd6f4ff, blurb: 'A fragment' },
  lord: { title: 'Gidim Lord', hp: 2.6, dmg: 1.25, speed: 1, scale: 1.45, xp: 4, ash: 5, tint: 0xffd27a, blurb: 'A champion risen' },
};

export const BLESSINGS = {
  lamp: { name: 'Lamp of Nanna', short: 'Lamp of Nanna', desc: 'Lantern sanctuaries reach 50% further and your Tether ward is 50% stronger.' },
  ashskin: { name: 'Ash-skin', short: 'Ash-skin', desc: 'You take 20% less damage at night.' },
  reader: { name: 'Grave-reader', short: 'Grave-reader', desc: 'Gidim drop double Ghost-ash, with a 15% chance of an item.' },
};

// How a monster died decides what it comes back as. Elite and named monsters always return as Lords.
// Order matters: fire beats chains beats a crit.
export function gidimVariant({ source = 'other', burning = false, crit = false, elite = false, named = false } = {}) {
  if (elite || named) return 'lord';
  if (burning === true || source === 'burn' || source === 'pyre') return 'burning';
  if (source === 'tether' || source === 'snap') return 'chained';
  if (crit === true) return 'shattered';
  return 'plain';
}

// Whether a kill leaves a mark: outdoors, by day, nothing in dungeons or in town, not bosses, and the setting is on.
export function markEligible({ enabled = true, night = false, inDungeon = false, dungeon = false, region = 'sunfields', boss = false, gidim = false } = {}) {
  if (!enabled || night || inDungeon || dungeon || boss || gidim) return false;
  return region !== 'town' && region !== 'dungeon' && region !== 'cistern';
}

// Build the mark for a kill (data only).
export function makeMark({ type, elite = false, named = null, level = 1, x, z, source = 'other', crit = false, burning = false, time = 0, id = 0 }) {
  const variant = gidimVariant({ source, burning, crit, elite: !!elite, named: !!named });
  return { id, type, x, z, level, variant, source, crit: !!crit, burning: !!burning, lord: variant === 'lord', named: named ? named.name : null, eliteName: elite ? (elite.prefix ?? null) : null, time, queued: false };
}

// Append, dropping the oldest marks beyond the cap.
export function pushMark(marks, mark, cap = MARK_CAP) {
  marks.push(mark);
  while (marks.length > cap) marks.shift();
  return marks;
}

// Marks that rise per night, scaled a little by hero level, never above the active cap.
export function nightCap(level = 1) {
  return Math.max(10, Math.min(MAX_ACTIVE, Math.round(10 + 1.1 * level)));
}

// Ghost-ash dropped by a gidim of this variant. `rand` (0..1) rounds the half-ash of a shard.
export function ashFor(variant, { graveReader = false, rand = 0.5 } = {}) {
  const base = (VARIANTS[variant] ?? VARIANTS.plain).ash * (graveReader ? 2 : 1);
  const whole = Math.floor(base);
  return whole + (rand < base - whole ? 1 : 0);
}

// ---- sanctuaries ---------------------------------------------------------------------------------
export const SANCTUARY_R = { shrine: 7, waypoint: 7, lantern: 6 };

export const lanternRadius = (lampMult = 1) => SANCTUARY_R.lantern * lampMult;

// Is (x, z) inside a place the gidim cannot enter? ctx: { regionAt, town:{x,z,r}, shrines, waypoints, emitters, lampMult }.
// Returns { kind, x, z, r } (the sanctuary's centre and radius, for pushing out) or null.
export function sanctuaryAt(x, z, ctx) {
  const { regionAt, town, shrines, waypoints, emitters, lampMult = 1 } = ctx;
  if (regionAt && regionAt(x, z) === 'town') return { kind: 'town', x: town?.x ?? x, z: town?.z ?? z, r: town?.r ?? 0 };
  if (waypoints) for (const w of waypoints) if (Math.hypot(x - w.x, z - w.z) < SANCTUARY_R.waypoint) return { kind: 'waypoint', x: w.x, z: w.z, r: SANCTUARY_R.waypoint };
  if (shrines) for (const s of shrines) if (Math.hypot(x - s.x, z - s.z) < SANCTUARY_R.shrine) return { kind: 'shrine', x: s.x, z: s.z, r: SANCTUARY_R.shrine };
  if (emitters) {
    const r = lanternRadius(lampMult);
    // Lanterns are the lights that only burn at dusk and night. The sedu's own lantern follows the hero and is not a place.
    for (const e of emitters) if (e.night > 0 && e.enabled !== false && !e.sedu && Math.hypot(x - e.x, z - e.z) < r) return { kind: 'lantern', x: e.x, z: e.z, r };
  }
  return null;
}

export const inSanctuary = (x, z, ctx) => sanctuaryAt(x, z, ctx) !== null;

// The Tether ward: damage multiplier and push speed against gidim crossing the line.
export function wardStrength(lamp = false) {
  const k = lamp ? 1.5 : 1;
  return { dmg: 1 + 1.0 * k, push: 7 * k };
}
