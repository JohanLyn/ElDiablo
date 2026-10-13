// Small inline SVG icons for items and skills, tinted per rarity or skill colour.
const wrap = (body, color) => `<svg viewBox="0 0 32 32" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ITEM = {
  weapon: '<path d="M7 25 L22 10 Q26 6 27 5 Q26 9 22 13 L9 27 Z"/><path d="M6 21 L11 26"/><path d="M5 27 L7 25"/>',
  helm: '<path d="M7 20 Q7 8 16 7 Q25 8 25 20 Z"/><path d="M7 20 H25 V23 H7 Z"/><path d="M16 7 V3"/><path d="M12 14 H20"/>',
  chest: '<path d="M9 6 L13 8 H19 L23 6 L27 11 L24 14 V26 H8 V14 L5 11 Z"/><path d="M16 9 V26"/>',
  gloves: '<path d="M10 27 V15 L8 9 Q9 7 11 9 L12 13 V6 Q13 4 15 6 V13 V5 Q16 3 18 5 V13 V7 Q19 5 21 7 V17 L23 14 Q25 14 24 17 L20 27 Z"/>',
  boots: '<path d="M11 4 H18 V18 L26 22 Q27 27 24 27 H9 Q8 27 8 24 L11 18 Z"/><path d="M11 11 H18"/>',
  amulet: '<path d="M7 5 Q16 17 25 5"/><path d="M16 17 L21 22 L16 28 L11 22 Z"/>',
  ring: '<circle cx="16" cy="19" r="8"/><path d="M13 10 L16 5 L19 10"/>',
};

const SKILL = {
  strike: '<path d="M6 26 Q10 10 26 6"/><path d="M8 22 Q13 13 22 9"/><path d="M22 6 H27 V11"/>',
  javelin: '<path d="M5 27 L25 7"/><path d="M25 7 L27 5 M21 7 H25 V11"/><path d="M5 23 L9 27"/>',
  snap: '<circle cx="7" cy="24" r="3"/><circle cx="25" cy="8" r="3"/><path d="M9 22 L13 18 L15 21 L19 15 L21 17 L23 10"/>',
  wings: '<path d="M16 22 Q8 22 4 10 Q10 14 16 14 Q22 14 28 10 Q24 22 16 22 Z"/><path d="M16 14 V28"/>',
  storm: '<path d="M8 12 Q8 5 16 5 Q24 5 24 12 Z"/><path d="M15 13 L11 21 H16 L13 28 L21 18 H16 L19 13"/>',
  aegis: '<path d="M16 4 L26 8 V16 Q26 24 16 28 Q6 24 6 16 V8 Z"/><path d="M16 10 V22 M11 16 H21"/>',
  pyre: '<path d="M16 4 Q22 12 20 16 Q24 14 24 19 Q24 27 16 27 Q8 27 8 19 Q8 13 13 10 Q12 15 15 16 Q13 9 16 4 Z"/>',
  potion: '<path d="M13 4 H19 M14 4 V10 Q7 13 7 20 Q7 28 16 28 Q25 28 25 20 Q25 13 18 10 V4"/><path d="M8 19 H24"/>',
};

export const itemIcon = (kind, color) => wrap(ITEM[kind] ?? ITEM.ring, color);
export const skillIcon = (id, color) => wrap(SKILL[id] ?? SKILL.strike, color);
