import { Rng } from '../core/rng.js';
import { STAT_INFO } from './stats.js';

export const SLOTS = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'amulet', 'ring1', 'ring2'];
export const SLOT_LABEL = {
  weapon: 'Weapon', helm: 'Helm', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring',
};
// Item "kind" -> which equipment slots accept it.
export const KIND_SLOTS = {
  weapon: ['weapon'], helm: ['helm'], chest: ['chest'], gloves: ['gloves'], boots: ['boots'], amulet: ['amulet'], ring: ['ring1', 'ring2'],
};

export const RARITY = {
  common: { label: 'Common', color: '#d9d4c7', affixes: [0, 0], mult: 1, value: 1 },
  magic: { label: 'Magic', color: '#6f9cff', affixes: [1, 2], mult: 1.1, value: 2 },
  rare: { label: 'Rare', color: '#f2d24b', affixes: [3, 4], mult: 1.2, value: 4 },
  legendary: { label: 'Legendary', color: '#ff9a2e', affixes: [3, 3], mult: 1.3, value: 8 },
};

// Base item types with a little Mesopotamian flavour.
const BASES = {
  weapon: [
    { name: 'Sapara Sickle-Sword', speed: 1.1, dmg: 1.0 },
    { name: 'Bronze Mace', speed: 0.9, dmg: 1.2 },
    { name: 'Lapis-Tipped Spear', speed: 1.0, dmg: 1.08 },
  ],
  helm: [{ name: 'Horned Crown', armor: 1.0 }, { name: 'Bronze Helm', armor: 1.15 }],
  chest: [{ name: 'Kaunakes Robe', armor: 1.6 }, { name: 'Scale Hauberk', armor: 2.0 }],
  gloves: [{ name: 'Bronze Bracers', armor: 0.8 }, { name: 'Linen Wrappings', armor: 0.65 }],
  boots: [{ name: 'Reed Sandals', armor: 0.6 }, { name: 'Copper Greaves', armor: 0.85 }],
  amulet: [{ name: 'Lapis Pendant' }, { name: 'Cylinder Seal' }],
  ring: [{ name: 'Gold Ring' }, { name: 'Carnelian Band' }],
};

// Affixes: which item kinds can roll them and their max value at a given item level.
const AFFIXES = {
  life: { kinds: ['helm', 'chest', 'gloves', 'boots', 'amulet', 'ring'], max: (l) => 10 + l * 4.5 },
  armor: { kinds: ['helm', 'chest', 'gloves', 'boots'], max: (l) => 5 + l * 2.2 },
  dmgPct: { kinds: ['weapon', 'gloves', 'amulet', 'ring'], max: (l) => 5 + l * 0.9 },
  critChance: { kinds: ['helm', 'gloves', 'amulet', 'ring'], max: (l) => 2 + l * 0.18 },
  critDmg: { kinds: ['weapon', 'amulet', 'ring'], max: (l) => 10 + l * 1.6 },
  attackSpeed: { kinds: ['weapon', 'gloves', 'ring'], max: (l) => 4 + l * 0.35 },
  moveSpeed: { kinds: ['boots', 'amulet'], max: (l) => 5 + l * 0.35 },
  cdr: { kinds: ['helm', 'amulet', 'ring'], max: (l) => 4 + l * 0.35 },
  lifeOnHit: { kinds: ['weapon', 'gloves'], max: (l) => 1.5 + l * 0.6 },
  animaRegen: { kinds: ['helm', 'chest', 'amulet'], max: (l) => 1 + l * 0.15 },
  tetherDmg: { kinds: ['weapon', 'chest', 'amulet'], max: (l) => 10 + l * 1.5 },
  potionHeal: { kinds: ['chest', 'boots'], max: (l) => 6 + l * 1.2 },
};

// Legendary powers (D4 "aspects"). The game checks stats.powers for these ids.
export const POWERS = {
  gatekeeper: { name: 'of the Seven Gates', kinds: ['weapon', 'amulet', 'helm'], text: 'Tether Snap also releases a nova around you for 120% weapon damage.' },
  gibil: { name: "Gibil's Kiss", kinds: ['weapon', 'gloves', 'ring'], text: 'Burning enemies explode on death for 80% weapon damage.' },
  lamassu: { name: "Lamassu's Wings", kinds: ['boots', 'chest', 'amulet'], text: 'Wings of the Sedu has 2 charges.' },
  ereshkigal: { name: "Ereshkigal's Grasp", kinds: ['gloves', 'ring', 'weapon'], text: 'Enemies struck by your Tether take 20% more damage for 3 seconds.' },
  adad: { name: "Adad's Fury", kinds: ['helm', 'amulet', 'ring'], text: 'Storm of Adad calls 4 additional lightning strikes.' },
  inanna: { name: "Inanna's Descent", kinds: ['weapon', 'gloves', 'helm'], text: 'Lapis Javelin splits into 3 javelins.' },
  nergal: { name: "Nergal's Bulwark", kinds: ['chest', 'boots', 'ring'], text: 'Evading grants a barrier absorbing 15% of your Maximum Life for 3 seconds.' },
};

const RARE_A = ['Dusk', 'Ashen', 'Silt', 'Grave', 'Sun', 'Reed', 'Ziggurat', 'Lapis', 'Scorpion', 'Storm', 'Cinder', 'Bitter'];
const RARE_B = ['Fang', 'Ward', 'Oath', 'Hymn', 'Gate', 'Thorn', 'Veil', 'Crown', 'Tide', 'Brand', 'Psalm', 'Seal'];

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function rollRarity(rng, { magicFind = 0, minRarity = 'common' } = {}) {
  const order = ['common', 'magic', 'rare', 'legendary'];
  let r = rng.weighted([['common', 55], ['magic', 30], ['rare', 12 + magicFind * 6], ['legendary', 2.2 + magicFind * 3]]);
  if (order.indexOf(r) < order.indexOf(minRarity)) r = minRarity;
  return r;
}

// Create a random item. `rng` can be a seeded Rng for deterministic tests.
export function generateItem({ ilvl, rarity, kind, rng = new Rng(Math.floor(Math.random() * 2 ** 31)), power } = {}) {
  kind ??= rng.weighted([['weapon', 18], ['helm', 12], ['chest', 12], ['gloves', 12], ['boots', 12], ['amulet', 8], ['ring', 12]]);
  rarity ??= rollRarity(rng);
  const R = RARITY[rarity];
  const baseDef = rng.pick(BASES[kind]);
  const base = { name: baseDef.name };
  if (kind === 'weapon') {
    const avg = (4 + ilvl * 2.3) * baseDef.dmg * R.mult * rng.float(0.9, 1.1);
    base.min = Math.max(1, Math.round(avg * 0.75));
    base.max = Math.round(avg * 1.25);
    base.speed = baseDef.speed;
  } else if (baseDef.armor) {
    base.armor = Math.round((3 + ilvl * 2.4) * baseDef.armor * R.mult * rng.float(0.9, 1.1));
  }

  const pool = Object.keys(AFFIXES).filter((k) => AFFIXES[k].kinds.includes(kind));
  const count = Math.min(pool.length, rng.int(R.affixes[0], R.affixes[1]));
  const affixes = [];
  for (let i = 0; i < count; i++) {
    const stat = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    const max = AFFIXES[stat].max(ilvl);
    const raw = max * rng.float(0.7, 1);
    const value = stat === 'life' || stat === 'armor' ? Math.round(raw) : Math.round(raw * 10) / 10;
    affixes.push({ stat, value });
  }

  let name = baseDef.name;
  let itemPower = null;
  if (rarity === 'magic') name = `${baseDef.name} of ${affixes[0] ? AFFIX_SUFFIX[affixes[0].stat] : 'Ur'}`;
  if (rarity === 'rare') name = `${rng.pick(RARE_A)} ${rng.pick(RARE_B)}`;
  if (rarity === 'legendary') {
    const options = Object.keys(POWERS).filter((p) => POWERS[p].kinds.includes(kind));
    itemPower = power && POWERS[power] ? power : rng.pick(options.length ? options : Object.keys(POWERS));
    const p = POWERS[itemPower];
    name = p.name.startsWith('of ') ? `${baseDef.name} ${p.name}` : `${p.name} ${baseDef.name}`;
  }

  return {
    id: newId(), kind, slot: KIND_SLOTS[kind][0], rarity, ilvl, name, base, affixes, power: itemPower,
  };
}

const AFFIX_SUFFIX = {
  life: 'Vigour', armor: 'Bronze', dmgPct: 'Slaughter', critChance: 'Precision', critDmg: 'Ruin', attackSpeed: 'Haste',
  moveSpeed: 'the Wind', cdr: 'the Moon', lifeOnHit: 'Leeching', animaRegen: 'the Sedu', tetherDmg: 'Binding', potionHeal: 'Enki',
};

export function sellValue(item) {
  return Math.round((5 + item.ilvl * 3) * RARITY[item.rarity].value);
}

export function gambleCost(playerLevel) {
  return 60 + playerLevel * 25;
}

export function affixLines(item) {
  return item.affixes.map((a) => `${STAT_INFO[a.stat].fmt(a.value)} ${STAT_INFO[a.stat].label}`);
}

// A single number to compare items quickly (used for "upgrade" arrows).
export function itemScore(item) {
  if (!item) return 0;
  const w = { life: 0.5, armor: 0.8, dmgPct: 3, critChance: 4, critDmg: 1.2, attackSpeed: 3, moveSpeed: 2, cdr: 2.5, lifeOnHit: 1.5, animaRegen: 6, tetherDmg: 1.2, potionHeal: 0.5 };
  let s = 0;
  if (item.base.min) s += ((item.base.min + item.base.max) / 2) * 3 * (item.base.speed ?? 1);
  if (item.base.armor) s += item.base.armor * 0.8;
  for (const a of item.affixes) s += a.value * (w[a.stat] ?? 1);
  if (item.power) s += 40;
  return s;
}

export function startingWeapon() {
  return {
    id: newId(), kind: 'weapon', slot: 'weapon', rarity: 'common', ilvl: 1, name: 'Worn Sickle-Sword',
    base: { name: 'Sapara Sickle-Sword', min: 4, max: 7, speed: 1.1 }, affixes: [], power: null,
  };
}
