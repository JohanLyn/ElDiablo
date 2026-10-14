import { distPointSegment } from '../core/util.js';
import { AQRABU, CISTERN_ENTRANCE, GATE, WAYPOINTS, PYRES } from './layout.js';

// Footprints that scattered props must keep clear of (landmarks, huts, fields...).
// Landmark builders register their area here before scatterProps runs.
const BLOCKED = [];

export function addBlocked(x, z, r) { BLOCKED.push({ x, z, r }); }

export function nearBlocked(x, z, pad = 0) {
  for (const b of BLOCKED) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
  return false;
}

// Keep-clear corridors: polylines the quest routes (and the balance bot) walk in
// straight lines. Props that collide (rocks, columns, walls) keep half a corridor
// width plus their own footprint away from the line, so nothing sits on the way.
const CORRIDORS = [];

export function addCorridor(points, half = 2.75) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) segs.push([points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]]);
  CORRIDORS.push({ segs, half });
}

// pad: the prop's own footprint radius (a 6 m wall counts as 3.3, a rock as its collider).
export function nearCorridor(x, z, pad = 0) {
  for (const c of CORRIDORS) {
    for (const [ax, az, bx, bz] of c.segs) {
      if (distPointSegment(x, z, ax, az, bx, bz).dist < c.half + pad) return true;
    }
  }
  return false;
}

export const LANDMARKS = {
  lamassu: { x: 110, z: -40, r: 10 },
  ziggurat: { x: 162, z: 14, r: 17 },
  gate: { x: 0, z: -199, r: 40 },
};
for (const l of Object.values(LANDMARKS)) addBlocked(l.x, l.z, l.r);

// Aqrabu's camp: a 14 m clearing for the arena ring (src/world/arena.js).
export const ARENA = { x: AQRABU.x, z: AQRABU.z, r: 14 };
addBlocked(ARENA.x, ARENA.z, ARENA.r);
// The Wailing Pyres plateau beside the road to the gate.
addBlocked(PYRES.x, PYRES.z, PYRES.r + 6);

// Quest legs: Cistern of Enki -> Aqrabu (straight, and by the crossroads and the ruins waypoint),
// Aqrabu -> Ashen waypoint -> Ganzir entrance (and the straight line to the gate).
const WP = (id) => { const w = WAYPOINTS.find((x) => x.id === id); return [w.x, w.z]; };
const CIST = [CISTERN_ENTRANCE.x, CISTERN_ENTRANCE.z + 5];
const AQ = [AQRABU.x, AQRABU.z];
addCorridor([CIST, AQ]);
addCorridor([[CISTERN_ENTRANCE.x, CISTERN_ENTRANCE.z + 2], [-80, 8], [-40, 14], WP('wp-sunfields'), [40, 10], [84, -8], [126, -14], AQ]);
addCorridor([WP('wp-sunfields'), AQ]);
addCorridor([WP('wp-ruins'), AQ]);
addCorridor([AQ, WP('wp-ashen'), [0, -122], [0, -168]]);
addCorridor([AQ, [GATE.x, GATE.z + 8]]);
