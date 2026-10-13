// Skill definitions for the Gatewalker class. Behaviour lives in entities/abilities.js.
// coef = weapon damage multiplier at rank 1; each extra rank adds RANK_BONUS.

export const RANK_BONUS = 0.12;
export const MAX_RANK = 5;

export const SKILLS = {
  strike: {
    name: 'Sickle Strike', category: 'Basic', unlock: 1, gain: 14, coef: 1.0, cooldown: 0,
    color: '#e8b068', desc: 'A sweeping 3-hit combo. Generates 14 Anima per hit.',
  },
  javelin: {
    name: 'Lapis Javelin', category: 'Core', unlock: 2, cost: 28, coef: 1.9, cooldown: 0, range: 18,
    color: '#8fb4ff', desc: 'Hurl a lapis javelin that pierces every enemy in a line.',
  },
  snap: {
    name: 'Tether Snap', category: 'Core', unlock: 3, cost: 35, coef: 2.6, cooldown: 0,
    color: '#6fd8c8', desc: 'The Tether flares, striking everything along it. Its effect follows your Tether Aspect.',
  },
  wings: {
    name: 'Wings of the Sedu', category: 'Mobility', unlock: 4, coef: 1.4, cooldown: 7, range: 9,
    color: '#efe6cf', desc: 'Leap forward on spirit wings and crash down, damaging and knocking back enemies.',
  },
  storm: {
    name: 'Storm of Adad', category: 'Core', unlock: 6, cost: 45, coef: 1.5, cooldown: 4, range: 14,
    color: '#a9dcff', desc: 'Call 6 lightning strikes onto enemies around the target area.',
  },
  aegis: {
    name: 'Aegis of Nergal', category: 'Defensive', unlock: 8, coef: 0, cooldown: 16,
    color: '#f6d27a', desc: 'Raise a barrier absorbing 40% of your Maximum Life for 6 seconds.',
  },
  pyre: {
    name: "Gibil's Pyre", category: 'Ultimate', unlock: 10, coef: 0.7, cooldown: 45,
    color: '#ff7a45', desc: 'For 8 seconds, your Tether burns and you pulse fire around you every half second.',
  },
};

export const SKILL_ORDER = ['strike', 'javelin', 'snap', 'wings', 'storm', 'aegis', 'pyre'];

// Tether Aspects: passive line behaviour, unlocked by level, switched on the D-pad.
export const ASPECTS = [
  { id: 'lapis', name: 'Lapis Aspect', unlock: 1, color: 0x5d95ff, css: '#5d95ff', desc: 'Pure damage. Whip the familiar for up to 2.5x damage.' },
  { id: 'fire', name: 'Aspect of Gibil', unlock: 3, color: 0xff7a2a, css: '#ff8a3a', desc: 'Burns enemies and leaves fire where the familiar sweeps.' },
  { id: 'chain', name: 'Aspect of Ereshkigal', unlock: 5, color: 0xb36bff, css: '#c08bff', desc: 'Drags struck enemies toward you and slows them.' },
  { id: 'bulwark', name: 'Aspect of Nergal', unlock: 7, color: 0xffcf4a, css: '#ffcf4a', desc: 'Blocks projectiles and shoves enemies away.' },
];

export function skillCoef(id, rank) {
  return SKILLS[id].coef * (1 + RANK_BONUS * Math.max(0, rank - 1));
}

// Skill slots map to controller buttons (D4 layout) and keyboard/mouse.
export const SLOT_BUTTONS = [
  { pad: 'A', kbm: 'LMB' },
  { pad: 'X', kbm: 'RMB' },
  { pad: 'Y', kbm: '1' },
  { pad: 'RB', kbm: '2' },
  { pad: 'RT', kbm: '3' },
  { pad: 'LT', kbm: '4' },
];

// Is the skill learnable/upgradable right now? Each further rank needs one more level.
export function canRankUp(id, level, ranks, points) {
  const r = ranks[id] ?? 0;
  return points > 0 && r < MAX_RANK && level >= SKILLS[id].unlock + r;
}
