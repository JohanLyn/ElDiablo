// Character stats: base values per level plus everything granted by gear and buffs.
// Pure functions only, so the formulas can be unit-tested.

export const MAX_LEVEL = 20;

export const STAT_INFO = {
  life: { label: 'Maximum Life', fmt: (v) => `+${Math.round(v)}` },
  armor: { label: 'Armor', fmt: (v) => `+${Math.round(v)}` },
  dmgPct: { label: 'Damage', fmt: (v) => `+${v.toFixed(1)}%` },
  critChance: { label: 'Critical Strike Chance', fmt: (v) => `+${v.toFixed(1)}%` },
  critDmg: { label: 'Critical Strike Damage', fmt: (v) => `+${v.toFixed(1)}%` },
  attackSpeed: { label: 'Attack Speed', fmt: (v) => `+${v.toFixed(1)}%` },
  moveSpeed: { label: 'Movement Speed', fmt: (v) => `+${v.toFixed(1)}%` },
  cdr: { label: 'Cooldown Reduction', fmt: (v) => `+${v.toFixed(1)}%` },
  lifeOnHit: { label: 'Life per Hit', fmt: (v) => `+${v.toFixed(1)}` },
  animaRegen: { label: 'Anima per Second', fmt: (v) => `+${v.toFixed(1)}` },
  tetherDmg: { label: 'Tether Damage', fmt: (v) => `+${v.toFixed(1)}%` },
  potionHeal: { label: 'Potion Healing', fmt: (v) => `+${v.toFixed(1)}%` },
};

// XP needed to go from `level` to `level + 1`.
export function xpToNext(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(100 * level * level);
}

// XP granted for killing a monster.
export function monsterXp(monsterLevel, mult = 1) {
  return Math.round(8 * monsterLevel * mult);
}

// Monster scaling (D4-style: monsters are at least the region level, else the player's).
export function monsterLevelFor(regionLevel, playerLevel) {
  return Math.max(regionLevel, playerLevel);
}
export const monsterLifeMult = (lvl) => 1 + 0.38 * (lvl - 1);
export const monsterDamageMult = (lvl) => 1 + 0.2 * (lvl - 1);

// Damage reduction from armor against an attacker of a given level (capped at 75%).
export function armorReduction(armor, attackerLevel) {
  const k = 30 + 15 * attackerLevel;
  return Math.min(0.75, armor / (armor + k));
}

const EMPTY = () => Object.fromEntries(Object.keys(STAT_INFO).map((k) => [k, 0]));

// Derive final stats from level, equipped items and active buffs.
export function computeStats(level, equipment, buffs = []) {
  const add = EMPTY();
  let weaponMin = 3, weaponMax = 5, weaponSpeed = 1;
  const powers = new Set();
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    if (item.slot === 'weapon') {
      weaponMin = item.base.min;
      weaponMax = item.base.max;
      weaponSpeed = item.base.speed ?? 1;
    }
    if (item.base.armor) add.armor += item.base.armor;
    for (const a of item.affixes) add[a.stat] += a.value;
    if (item.power) powers.add(item.power);
  }
  for (const b of buffs) for (const [k, v] of Object.entries(b.stats)) add[k] += v;

  return {
    level,
    maxLife: Math.round(100 + 12 * (level - 1) + add.life),
    maxAnima: 100,
    armor: Math.round(add.armor),
    weaponMin,
    weaponMax,
    dmgMult: 1 + add.dmgPct / 100,
    critChance: Math.min(0.75, 0.05 + add.critChance / 100),
    critMult: 1.5 + add.critDmg / 100,
    attackSpeed: weaponSpeed * (1 + add.attackSpeed / 100),
    moveSpeed: 6.2 * (1 + Math.min(60, add.moveSpeed) / 100),
    cdr: Math.min(0.5, add.cdr / 100),
    lifeOnHit: add.lifeOnHit,
    animaRegen: 3 + add.animaRegen,
    tetherMult: 1 + add.tetherDmg / 100,
    potionMult: 1 + add.potionHeal / 100,
    powers,
    raw: add,
  };
}

// Roll a hit: weapon damage x skill coefficient x modifiers, with crit.
export function rollDamage(stats, coef, rand = Math.random, extraMult = 1) {
  const weapon = stats.weaponMin + (stats.weaponMax - stats.weaponMin) * rand();
  const crit = rand() < stats.critChance;
  const amount = weapon * coef * stats.dmgMult * extraMult * (crit ? stats.critMult : 1);
  return { amount, crit };
}

// Average damage per hit of a 100% coefficient, for the character sheet.
export function averageHit(stats) {
  const avg = (stats.weaponMin + stats.weaponMax) / 2;
  return avg * stats.dmgMult * (1 + stats.critChance * (stats.critMult - 1));
}
