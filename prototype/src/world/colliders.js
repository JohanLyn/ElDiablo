import { PLAY_LIMIT } from './layout.js';

const CELL = 8;

// Static world collision: circles (trees, rocks, pillars) and axis-aligned boxes
// (houses, walls), bucketed in a spatial hash so lookups stay cheap.
export class Colliders {
  constructor() {
    this.cells = new Map();
    this.count = 0;
  }

  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  insert(shape, minX, minZ, maxX, maxZ) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(shape);
      }
    }
    this.count++;
  }

  addCircle(x, z, r) {
    this.insert({ type: 'c', x, z, r }, x - r, z - r, x + r, z + r);
  }

  addBox(minX, minZ, maxX, maxZ) {
    this.insert({ type: 'b', minX, minZ, maxX, maxZ }, minX, minZ, maxX, maxZ);
  }

  nearby(x, z) {
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return list ?? [];
  }

  // Push a circle (pos.x, pos.z, r) out of everything it overlaps.
  resolve(pos, r, inDungeon = false) {
    if (!inDungeon) {
      const lim = PLAY_LIMIT - r;
      pos.x = Math.max(-lim, Math.min(lim, pos.x));
      pos.z = Math.max(-lim, Math.min(lim, pos.z));
    }
    // Check the neighbouring cells too, since a shape near a cell edge may overlap.
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(Math.floor(pos.x / CELL) + dx, Math.floor(pos.z / CELL) + dz));
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (s.type === 'c') {
            const ddx = pos.x - s.x, ddz = pos.z - s.z;
            const d = Math.hypot(ddx, ddz), min = s.r + r;
            if (d < min && d > 1e-6) { pos.x = s.x + (ddx / d) * min; pos.z = s.z + (ddz / d) * min; }
          } else {
            const cx = Math.max(s.minX, Math.min(pos.x, s.maxX));
            const cz = Math.max(s.minZ, Math.min(pos.z, s.maxZ));
            const ddx = pos.x - cx, ddz = pos.z - cz;
            const d = Math.hypot(ddx, ddz);
            if (d < r) {
              if (d > 1e-6) { pos.x = cx + (ddx / d) * r; pos.z = cz + (ddz / d) * r; } else {
                // Centre is inside the box: push out along the shallowest axis.
                const pushes = [[pos.x - s.minX + r, -1, 0], [s.maxX - pos.x + r, 1, 0], [pos.z - s.minZ + r, 0, -1], [s.maxZ - pos.z + r, 0, 1]];
                pushes.sort((a, b) => a[0] - b[0]);
                pos.x += pushes[0][1] * pushes[0][0];
                pos.z += pushes[0][2] * pushes[0][0];
              }
            }
          }
        }
      }
    }
  }

  // True if a straight segment is blocked by a box (used for projectiles).
  pointBlocked(x, z) {
    for (const s of this.nearby(x, z)) {
      if (s.type === 'b' && x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ) return true;
      if (s.type === 'c' && s.r > 0.7 && Math.hypot(x - s.x, z - s.z) < s.r * 0.8) return true;
    }
    return false;
  }
}
