// Pure math helpers (no three.js dependency) so they can be unit-tested in Node.
// The game plays on the XZ plane; "2D" below means (x, z).

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent smoothing factor for "move toward target" lerps.
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// Radial deadzone: ignores small stick drift and rescales the rest to 0..1
// so movement ramps smoothly from the edge of the deadzone.
export function radialDeadzone(x, y, deadzone = 0.2) {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { x: 0, y: 0, mag: 0 };
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled, mag: scaled };
}

// Shortest signed difference between two angles, in [-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Distance from point P to segment AB, plus the projection parameter t (0 = A, 1 = B).
export function distPointSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 0 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

// Clamp a vector to a maximum length.
export function clampLength(x, z, maxLen) {
  const len = Math.hypot(x, z);
  if (len <= maxLen || len === 0) return { x, z };
  return { x: (x / len) * maxLen, z: (z / len) * maxLen };
}

// Is the direction to (tx, tz) within +-halfAngle of the facing angle?
// Facing angle convention: 0 = +Z, PI/2 = +X (matches Math.atan2(x, z)).
export function inCone(fromX, fromZ, facing, tx, tz, halfAngle) {
  const a = Math.atan2(tx - fromX, tz - fromZ);
  return Math.abs(angleDelta(facing, a)) <= halfAngle;
}
