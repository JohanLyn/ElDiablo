// Per-rarity look for ground items: ring size/opacity, colours, beam height.
export const RARITY_FX = {
  common: { tier: 0, hex: 0xd8d0c0, hot: 0xffffff, ring: 1.0, ringA: 0.22, beam: 0 },
  magic: { tier: 1, hex: 0x5aa0ff, hot: 0xcfe4ff, ring: 1.5, ringA: 0.5, beam: 0 },
  rare: { tier: 2, hex: 0xffd84a, hot: 0xfff4b8, ring: 1.9, ringA: 0.62, beam: 5 },
  legendary: { tier: 3, hex: 0xff7a1e, hot: 0xffe0b0, ring: 2.7, ringA: 0.8, beam: 9 },
};
