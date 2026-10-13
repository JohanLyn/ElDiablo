// Footprints that scattered props must keep clear of (landmarks, huts, fields...).
// Landmark builders register their area here before scatterProps runs.
const BLOCKED = [];

export function addBlocked(x, z, r) { BLOCKED.push({ x, z, r }); }

export function nearBlocked(x, z, pad = 0) {
  for (const b of BLOCKED) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
  return false;
}

export const LANDMARKS = {
  lamassu: { x: 110, z: -40, r: 10 },
  ziggurat: { x: 162, z: 14, r: 17 },
  gate: { x: 0, z: -199, r: 40 },
};
for (const l of Object.values(LANDMARKS)) addBlocked(l.x, l.z, l.r);
