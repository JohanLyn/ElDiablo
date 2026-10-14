import { HALF, REGIONS, PYRES } from '../world/layout.js';
import { INSTANCES } from '../world/instances.js';

// Fog of war: 4 m cells over the overworld, revealed around the hero.
export const FOG_RES = 110;
export class Fog {
  constructor() {
    this.cells = new Uint8Array(FOG_RES * FOG_RES);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = FOG_RES;
    this.ctx = this.canvas.getContext('2d');
    this.dirty = true;
    this.timer = 0;
  }

  load(bytes) { this.cells = bytes; this.dirty = true; }

  reveal(x, z, radius) {
    const cell = (HALF * 2) / FOG_RES;
    const cx = (x + HALF) / cell, cz = (z + HALF) / cell, r = radius / cell;
    for (let j = Math.floor(cz - r); j <= Math.ceil(cz + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
        if ((i - cx) ** 2 + (j - cz) ** 2 > r * r) continue;
        const k = j * FOG_RES + i;
        if (!this.cells[k]) { this.cells[k] = 1; this.dirty = true; }
      }
    }
  }

  isRevealed(x, z) {
    const cell = (HALF * 2) / FOG_RES;
    const i = Math.floor((x + HALF) / cell), j = Math.floor((z + HALF) / cell);
    return this.cells[j * FOG_RES + i] === 1;
  }

  // Lapis-deep-where-unexplored mask canvas.
  mask() {
    if (!this.dirty) return this.canvas;
    const img = this.ctx.createImageData(FOG_RES, FOG_RES);
    for (let k = 0; k < this.cells.length; k++) {
      if (!this.cells[k]) { img.data[k * 4] = 7; img.data[k * 4 + 1] = 14; img.data[k * 4 + 2] = 38; img.data[k * 4 + 3] = 238; }
    }
    this.ctx.putImageData(img, 0, 0);
    this.dirty = false;
    return this.canvas;
  }
}

// Draw the world (or the dungeon) centred on (cx, cz) at `scale` px per metre.
// Shared by the minimap and the full map.
export function drawMap(ctx, g, { cx, cz, scale, width, height, full = false, selected = null }) {
  const toX = (x) => width / 2 + (x - cx) * scale;
  const toY = (z) => height / 2 + (z - cz) * scale;
  ctx.save();
  ctx.fillStyle = '#060c22';
  ctx.fillRect(0, 0, width, height);

  if (g.instance) {
    const { origin, rects, spots, pools = [] } = g.instance;
    ctx.fillStyle = g.instance.id === 'cistern' ? '#24506a' : '#3c3a5a';
    for (const [rx, rz, w, d] of rects) {
      ctx.fillRect(toX(origin.x + rx - w / 2), toY(origin.z + rz - d / 2), w * scale, d * scale);
    }
    ctx.fillStyle = '#2f7f9a';
    for (const [rx, rz, w, d] of pools) ctx.fillRect(toX(origin.x + rx - w / 2), toY(origin.z + rz - d / 2), w * scale, d * scale);
    icon(ctx, toX(spots.entry.x), toY(spots.entry.z + 3), 'exit', scale);
    if (g.interactions.exitPortal) icon(ctx, toX(spots.exit.x), toY(spots.exit.z), 'portal', scale);
  } else {
    ctx.imageSmoothingEnabled = true;
    const S = HALF * 2 * scale;
    ctx.drawImage(g.world.mapImage, toX(-HALF), toY(-HALF), S, S);
    ctx.drawImage(g.fog.mask(), toX(-HALF), toY(-HALF), S, S);
    // a wash of lapis ties the terrain colours to the UI
    ctx.fillStyle = 'rgba(14, 36, 96, 0.26)';
    ctx.fillRect(toX(-HALF), toY(-HALF), S, S);
    if (full) {
      const vg = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.74);
      vg.addColorStop(0, 'rgba(6, 12, 34, 0)'); vg.addColorStop(1, 'rgba(6, 12, 34, 0.82)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, width, height);
    }

    if (full) {
      ctx.font = '600 13px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(246,210,122,0.85)';
      for (const [id, x, z] of [['sunfields', 0, 80], ['marsh', -125, -30], ['ruins', 125, -50], ['ashen', 0, -140]]) {
        ctx.fillText(`${REGIONS[id].name.toUpperCase()} · LV ${REGIONS[id].level}`, toX(x), toY(z));
      }
    }
    const seen = (x, z) => full ? g.fog.isRevealed(x, z) : true;
    for (const s of g.world.shrines) if (seen(s.x, s.z)) icon(ctx, toX(s.x), toY(s.z), s.cooldown > 0 ? 'shrineUsed' : 'shrine', scale);
    for (const c of g.world.chests) if (!c.opened && seen(c.x, c.z)) icon(ctx, toX(c.x), toY(c.z), 'chest', scale);
    if (seen(g.world.ritual.x, g.world.ritual.z)) icon(ctx, toX(g.world.ritual.x), toY(g.world.ritual.z), 'event', scale);
    if (seen(PYRES.x, PYRES.z)) icon(ctx, toX(PYRES.x), toY(PYRES.z), g.flags.pyresDone ? 'pyreLit' : 'pyre', scale);
    for (const { entrance: e } of Object.values(INSTANCES)) if (seen(e.x, e.z)) icon(ctx, toX(e.x), toY(e.z), 'dungeon', scale);
    for (const n of g.world.npcs) icon(ctx, toX(n.x), toY(n.z), 'npc', scale);
    if (g.interactions.portal) icon(ctx, toX(g.interactions.portal.mesh.position.x), toY(g.interactions.portal.mesh.position.z), 'portal', scale);
    for (const w of g.world.waypoints) {
      if (!w.discovered && !seen(w.x, w.z)) continue;
      icon(ctx, toX(w.x), toY(w.z), w.discovered ? 'waypoint' : 'waypointOff', scale, selected === w);
      if (full && w.discovered) {
        ctx.font = '600 12px "Alegreya Sans", sans-serif';
        ctx.fillStyle = selected === w ? '#f6d27a' : '#efe6cf';
        ctx.fillText(w.name, toX(w.x), toY(w.z) + 18);
      }
    }
  }

  // Enemies (minimap only, nearby).
  if (!full) {
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const dx = e.pos.x - g.player.pos.x, dz = e.pos.z - g.player.pos.z;
      if (dx * dx + dz * dz > 2500) continue;
      ctx.fillStyle = e.boss ? '#ffe3a8' : e.elite || e.named ? '#f6d84a' : '#e0683f';
      ctx.beginPath();
      ctx.arc(toX(e.pos.x), toY(e.pos.z), e.boss ? 5 : e.elite ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Quest marker (clamped to the edge on the minimap).
  const qm = g.questMarker();
  if (qm) {
    let x = toX(qm.x), y = toY(qm.z);
    if (!full) {
      const dx = x - width / 2, dy = y - height / 2, d = Math.hypot(dx, dy), max = width / 2 - 10;
      if (d > max) { x = width / 2 + (dx / d) * max; y = height / 2 + (dy / d) * max; }
    }
    icon(ctx, x, y, 'quest', scale);
  }

  // Hero arrow.
  const px = toX(g.player.pos.x), py = toY(g.player.pos.z);
  ctx.translate(px, py);
  ctx.rotate(-g.player.facing + Math.PI);
  ctx.fillStyle = '#efe6cf';
  ctx.strokeStyle = '#15100c';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function icon(ctx, x, y, kind, scale, selected = false) {
  const s = 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#15100c';
  const diamond = (r) => { ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); };
  switch (kind) {
    case 'waypoint': case 'waypointOff':
      ctx.fillStyle = kind === 'waypoint' ? '#6f98f5' : '#3a4468';
      diamond(s + 1); ctx.fill(); ctx.stroke();
      if (selected) { ctx.strokeStyle = '#f6d27a'; ctx.lineWidth = 2.5; diamond(s + 6); ctx.stroke(); }
      break;
    case 'shrine': case 'shrineUsed':
      ctx.fillStyle = kind === 'shrine' ? '#5fe0c0' : '#4a5470';
      ctx.beginPath(); ctx.arc(0, 0, s - 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'chest':
      ctx.fillStyle = '#e8c86a'; ctx.fillRect(-s + 1, -s + 2, (s - 1) * 2, (s - 2) * 2); ctx.strokeRect(-s + 1, -s + 2, (s - 1) * 2, (s - 2) * 2);
      break;
    case 'event':
      ctx.strokeStyle = '#ff7a52'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, s + 1, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'pyre': case 'pyreLit': {
      // A flame in a ring: spectral blue (lit once completed), grey while the pyres are cold.
      const hot = kind === 'pyreLit';
      ctx.strokeStyle = hot ? '#7fd0ff' : '#9a8fa8'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, s + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hot ? '#dff6ff' : '#b8aebf'; ctx.lineWidth = 1.2; ctx.strokeStyle = '#15100c';
      ctx.beginPath(); ctx.moveTo(0, -s + 1); ctx.quadraticCurveTo(s - 1, -1, 0, s - 2); ctx.quadraticCurveTo(-s + 1, -1, 0, -s + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'dungeon':
      ctx.fillStyle = '#d99a5e'; ctx.beginPath(); ctx.moveTo(-s - 1, s); ctx.lineTo(-s - 1, -2); ctx.arc(0, -2, s + 1, Math.PI, 0); ctx.lineTo(s + 1, s); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'npc':
      ctx.fillStyle = '#efe6cf'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'portal': case 'exit':
      ctx.strokeStyle = '#9fc0ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, s - 1, s + 2, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'quest':
      ctx.fillStyle = '#f6d27a'; diamond(s + 2); ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#15100c'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 1);
      break;
  }
  ctx.restore();
}
