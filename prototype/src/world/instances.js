// Dungeon instances: self-contained spaces far outside the overworld, entered
// through a doorway in the world. Pure data so gameplay, UI and tests share it.
// Rooms are [cx, cz, w, d] rectangles relative to the origin, on a 2 m grid.

import { CISTERN_ENTRANCE } from './layout.js';

export const INSTANCES = {
  ganzir: {
    id: 'ganzir', name: 'The Ganzir Stair', region: 'dungeon', level: 7, roster: 'dungeon',
    origin: { x: 0, z: -600 },
    rects: [
      [0, 0, 18, 18], // entry hall
      [0, -17, 6, 16],
      [0, -34, 26, 20], // hall of offerings
      [20, -34, 14, 6],
      [36, -34, 18, 22], // ossuary
      [36, -55, 6, 20],
      [36, -72, 22, 18], // gallery
      [14, -72, 22, 6],
      [-12, -76, 34, 32], // throne of Neti
    ],
    spots: {
      entry: { x: 0, z: -596 },
      packs: [[-6, -632], [7, -638], [33, -628], [40, -640], [30, -670], [42, -676]].map(([x, z]) => ({ x, z })),
      boss: { x: -12, z: -680 },
      exit: { x: -12, z: -664 },
    },
    braziers: [[-6, -594], [6, -594], [-10, -626], [10, -626], [36, -626], [36, -668], [-24, -664], [0, -664], [-24, -690], [0, -690]],
    entrance: { x: 0, z: -168 },
    returnTo: { x: 0, z: -161 },
    enterEvent: 'dungeon',
    banner: 'Dungeon · resets each time you enter',
    elitePacks: [1, 3, 5], eliteType: 'asag',
    guardian: null, // Neti (entities/boss.js)
  },
  cistern: {
    id: 'cistern', name: 'Cistern of Enki', region: 'cistern', level: 3, roster: 'cistern',
    origin: { x: 0, z: -900 },
    rects: [
      [0, 0, 16, 16], // well stair
      [0, -14, 6, 12],
      [0, -30, 24, 20], // flooded hall
      [-17, -30, 10, 6],
      [-28, -30, 14, 14], // drowned shrine
      [0, -46, 6, 12],
      [0, -62, 26, 22], // the singing pool
    ],
    spots: {
      entry: { x: 0, z: -896 },
      packs: [[-6, -926], [6, -934], [-28, -930], [-8, -957]].map(([x, z]) => ({ x, z })),
      boss: { x: 0, z: -966 },
      exit: { x: 0, z: -954 },
    },
    braziers: [[-6, -894], [6, -894], [-11, -922], [11, -922], [-11, -938], [11, -938], [-33, -925], [-12, -954], [12, -954], [-12, -970], [12, -970]],
    pools: [[0, -30, 18, 14], [0, -62, 14, 10]],
    entrance: CISTERN_ENTRANCE,
    returnTo: { x: CISTERN_ENTRANCE.x, z: CISTERN_ENTRANCE.z + 5 },
    banner: 'Dungeon · the reeds die where its song echoes',
    elitePacks: [2], eliteType: 'gallu',
    guardian: { id: 'cistern-guardian', name: 'The Drowned Voice', type: 'lilitu', affixes: ['storm', 'vampiric'], legendaryFlag: 'cisternLegendary' },
    slainBanner: ['The Drowned Voice is silenced', 'The reeds will grow again'],
  },
};

// Which instance (if any) a world position belongs to.
export function instanceAt(z) {
  if (z < -800) return INSTANCES.cistern;
  if (z < -400) return INSTANCES.ganzir;
  return null;
}
