// Pure terrain functions (no rendering): which region a point is in, ground
// height, roads and marsh water. Used by world building, movement and the map.
import { fbm } from '../core/rng.js';
import { HALF, PLAY_LIMIT, ROADS, TOWN, flatSpots } from './layout.js';
import { distPointSegment, clamp } from '../core/util.js';

const SEED = 1337;
export const WATER_LEVEL = -0.85;
export const DUNGEON_Z = -400; // everything north of this is the dungeon instance

const FLATS = flatSpots();

export function regionAt(x, z) {
  if (z < DUNGEON_Z) return 'dungeon';
  if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r) return 'town';
  const n = (fbm(x / 60, z / 60, SEED + 3, 3) - 0.5) * 40;
  if (z < -82 + n) return 'ashen';
  if (x < -48 + n) return 'marsh';
  if (x > 48 - n) return 'ruins';
  return 'sunfields';
}

export function roadDistance(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      const d = distPointSegment(x, z, ax, az, bx, bz).dist;
      if (d < best) best = d;
    }
  }
  return best;
}

// How strongly the ground is flattened here (1 = fully flat).
function flatness(x, z) {
  let f = 0;
  const rd = roadDistance(x, z);
  f = Math.max(f, clamp(1 - (rd - 3) / 5, 0, 1) * 0.8);
  for (const s of FLATS) {
    const d = Math.hypot(x - s.x, z - s.z);
    f = Math.max(f, clamp(1 - (d - s.r) / 6, 0, 1));
  }
  return f;
}

// Marsh pools: low spots in the marsh fill with water.
export function marshWetness(x, z) {
  const n = fbm(x / 22, z / 22, SEED + 9, 3);
  return clamp((0.47 - n) * 6, 0, 1);
}

export function heightAt(x, z) {
  if (z < DUNGEON_Z) return 0;
  const region = regionAt(x, z);
  let h = (fbm(x / 45, z / 45, SEED, 4) - 0.5) * 5;
  if (region === 'ruins') h += Math.sin(x / 9 + Math.sin(z / 13) * 2) * 1.2 + 0.6;
  if (region === 'ashen') h += (fbm(x / 14, z / 14, SEED + 5, 3) - 0.5) * 4;
  if (region === 'marsh') h = h * 0.4 - 0.2 - marshWetness(x, z) * 1.6;
  if (region === 'town') h = 0.15;
  h *= 1 - flatness(x, z);
  // Mountains ring the playable world.
  const edge = Math.max(Math.abs(x), Math.abs(z)) - (PLAY_LIMIT - 6);
  if (edge > 0) h += edge * edge * 0.12 + fbm(x / 8, z / 8, SEED + 11, 2) * edge * 0.8;
  return h;
}

export function isWater(x, z) {
  return regionAt(x, z) === 'marsh' && heightAt(x, z) < WATER_LEVEL;
}

// Approximate ground colour (also used to paint the map image).
export function groundColor(x, z, regionColors) {
  const region = regionAt(x, z);
  const base = regionColors[region];
  const n = fbm(x / 9, z / 9, SEED + 21, 2);
  const shade = 0.82 + n * 0.3;
  let [r, g, b] = base.map((c) => c * shade);
  const rd = roadDistance(x, z);
  if (rd < 3.2 && region !== 'town') {
    const k = clamp((3.2 - rd) / 1.2, 0, 1);
    r += (0.55 - r) * k; g += (0.42 - g) * k; b += (0.3 - b) * k;
  }
  if (region === 'marsh') {
    const w = marshWetness(x, z);
    r *= 1 - w * 0.4; g *= 1 - w * 0.2; b *= 1 - w * 0.1;
  }
  const edge = Math.max(Math.abs(x), Math.abs(z)) - PLAY_LIMIT;
  if (edge > -4) {
    const k = clamp((edge + 4) / 10, 0, 1);
    r += (0.36 - r) * k; g += (0.3 - g) * k; b += (0.27 - b) * k;
  }
  return [r, g, b];
}

export { HALF };
