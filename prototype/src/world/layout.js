// Hand-placed layout of the overworld: regions, roads and points of interest.
// North is -Z (top of the screen). The world spans -HALF..HALF on X and Z.

export const HALF = 220;
export const PLAY_LIMIT = 200; // mountains beyond this

export const REGIONS = {
  town: { name: 'Eridu Outpost', level: 1, safe: true, ground: [0.55, 0.42, 0.29] },
  sunfields: { name: 'The Sunfields', level: 1, ground: [0.48, 0.5, 0.24] },
  marsh: { name: 'Reed Marsh', level: 3, ground: [0.27, 0.37, 0.26] },
  ruins: { name: 'Dune Ruins', level: 5, ground: [0.7, 0.55, 0.36] },
  ashen: { name: 'Ashen Approach', level: 7, ground: [0.30, 0.25, 0.28] },
  dungeon: { name: 'The Ganzir Stair', level: 9, ground: [0.2, 0.17, 0.2] },
  cistern: { name: 'Cistern of Enki', level: 3, ground: [0.2, 0.26, 0.25] },
};

export const TOWN = { x: 0, z: 150, r: 26 };

// Road polylines (x, z pairs).
export const ROADS = [
  [[0, 176], [0, 124], [2, 80], [-3, 40], [0, 18]],
  [[0, 18], [-40, 14], [-80, 6], [-122, 4]],
  [[0, 18], [40, 10], [84, -8], [126, -14]],
  [[0, 18], [3, -30], [-4, -70], [0, -112], [0, -160]],
];

export const WAYPOINTS = [
  { id: 'wp-town', name: 'Eridu Outpost', x: 6, z: 140 },
  { id: 'wp-sunfields', name: 'Sunfields Crossroads', x: 6, z: 22 },
  { id: 'wp-marsh', name: 'Shrine of Enki', x: -124, z: 12 },
  { id: 'wp-ruins', name: 'Broken Ziggurat', x: 128, z: -6 },
  { id: 'wp-ashen', name: 'Ashen Approach', x: 8, z: -112 },
];

export const SHRINES = [
  { id: 'sh1', x: -30, z: 70, kind: 'shamash' },
  { id: 'sh2', x: -150, z: -40, kind: 'enki' },
  { id: 'sh3', x: 150, z: 40, kind: 'ninurta' },
  { id: 'sh4', x: 70, z: -120, kind: 'ishtar' },
  { id: 'sh5', x: 60, z: 90, kind: 'ninurta' },
];

export const CHESTS = [
  { id: 'c1', x: 48, z: 120, tier: 1 }, { id: 'c2', x: -70, z: 100, tier: 1 },
  { id: 'c3', x: -165, z: 60, tier: 2 }, { id: 'c4', x: -100, z: -70, tier: 2 },
  { id: 'c5', x: 165, z: -70, tier: 2 }, { id: 'c6', x: 100, z: 60, tier: 2 },
  { id: 'c7', x: -60, z: -150, tier: 3 }, { id: 'c8', x: 70, z: -170, tier: 3 },
];

// Timed world event: hold the ritual circle.
export const EVENT = { id: 'ev-ritual', name: 'Ritual of the Gallu', x: -55, z: 40, r: 9 };

// Named champion for quest 3.
export const AQRABU = { id: 'aqrabu', x: 160, z: -30 };

export const GATE = { x: 0, z: -176 };
// The well-house over the Cistern of Enki, in the Reed Marsh near the Shrine of Enki waypoint
// (instances.js holds the same point as the cistern's entrance).
export const CISTERN_ENTRANCE = { x: -108, z: 26 };

// Points that the terrain flattens around (POIs need level ground).
export function flatSpots() {
  return [
    { x: TOWN.x, z: TOWN.z, r: TOWN.r + 8 },
    ...WAYPOINTS.map((w) => ({ x: w.x, z: w.z, r: 7 })),
    ...SHRINES.map((s) => ({ x: s.x, z: s.z, r: 5 })),
    ...CHESTS.map((c) => ({ x: c.x, z: c.z, r: 4 })),
    { x: EVENT.x, z: EVENT.z, r: EVENT.r + 5 },
    { x: GATE.x, z: GATE.z, r: 22 },
    { x: CISTERN_ENTRANCE.x, z: CISTERN_ENTRANCE.z + 2, r: 7 },
  ];
}

// Monster roster per region: [type, weight].
export const ROSTER = {
  sunfields: [['gallu', 6], ['utukku', 3]],
  marsh: [['utukku', 4], ['lilitu', 3], ['gallu', 2]],
  ruins: [['scorpion', 5], ['gallu', 2], ['asag', 1]],
  ashen: [['asag', 3], ['gallu', 3], ['lilitu', 2], ['scorpion', 2]],
  dungeon: [['gallu', 3], ['asag', 2], ['lilitu', 2], ['utukku', 2]],
  cistern: [['utukku', 4], ['lilitu', 3], ['gallu', 2]],
};
