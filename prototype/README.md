# The Seven Gates of Kur: prototype v2

An open-world action RPG slice in three.js that plays like Diablo 3/4. It's controller-first, and keyboard and mouse work too.

```bash
npm install
npm run dev      # dev server with hot reload
npm test         # node:test unit tests (items, stats, quests, skills, maths)
npm run build    # production build in dist/
npm run preview  # serve dist/ (needed for the e2e simulation)
npm run e2e      # plays the whole quest chain headlessly (needs Playwright)
```

Add `?low` to the URL to turn off shadows and bloom on slow machines.

## What's in it
- **World:** Eridu Outpost (town) and four regions with level ranges: the Sunfields (1), Reed Marsh (3), Dune Ruins (5) and Ashen Approach (7). Monsters scale to at least your level.
- **Story:** five quests from Ninsun, ending in the Ganzir Stair dungeon and the boss **Neti, Keeper of the First Gate**.
- **Exploration:** waypoints with fast travel from the map, monster camps and elite packs, Aqrabu the Venomed (a named champion), shrines, chests, the *Ritual of the Gallu* world event, a town portal, and a minimap with fog of war.
- **Combat:**
  - 7 skills on 6 slots, using an Anima generator/spender model.
  - Evade with charges, potions with charges, telegraphed enemy attacks.
  - Elite affixes: Fast, Vampiric, Molten and Storm-Touched.
- **The Tether:** steer your sedu spirit with the right stick, and whip it for bonus damage. If you leave it alone, it sweeps nearby enemies by itself. Four Aspects unlock as you level.
- **Loot:**
  - Common, Magic, Rare and Legendary items with random affixes and 7 legendary powers.
  - Comparison tooltips and upgrade arrows.
  - Sell or gamble with Ubar, or salvage anywhere.
- **Progression:** XP up to level 20, skill points and ranks, rebinding, and potion upgrades from Ninsun.
- **Saving:** progress is saved automatically in the browser (localStorage).

## Controls
| Action | Controller | Keyboard & mouse |
|---|---|---|
| Move | Left stick | WASD |
| Steer the Tether | Right stick | Mouse |
| Skill slots 1–6 | A · X · Y · RB · RT · LT | Left click · Right click · 1 · 2 · 3 · 4 |
| Interact / pick up | A (when no enemies are close) | E |
| Evade | B | Space |
| Healing potion | LB | Q |
| Change Tether Aspect | D-pad ◀ ▶ | R / F |
| Town Portal | D-pad ▲ | T |
| Zoom | D-pad ▼ | Z / mouse wheel |
| Map and fast travel | Back / View | M / Tab |
| Inventory · Skills · Quests | Start (then LB/RB for tabs) | I · K · J |

In menus, use the D-pad or stick to move, A to choose, X for the second action (sell, salvage or assign to a button), B to go back, and LB/RB to switch tabs.

## Code map
| Folder | What lives there |
|---|---|
| `src/main.js` | Boot, renderer and bloom, the shared game context `g`, game loop, teleport, dungeon enter/leave, death and respawn, save |
| `src/core/` | `input.js` (gamepad, keyboard and mouse to actions, with menu repeat), `camera.js` (D4-style rig, building fade), `fx.js` (particles, damage numbers, shake, hit-stop, rumble), `rng.js` (seeded RNG, noise), `util.js` |
| `src/world/` | `layout.js` (regions, roads and POIs: edit here to move things), `terrain.js` (height, region and road functions), `terrainMesh.js`, `props.js` (instanced scatter), `town.js`, `dungeon.js`, `models.js`, `colliders.js` (spatial hash), `world.js` (assembly and atmosphere) |
| `src/entities/` | `player.js`, `abilities.js` (all 7 skills), `tether.js`, `enemies.js` (types, AI, camps, elites, hazards), `boss.js` (Neti), `enemyModels.js` |
| `src/game/` | Pure logic: `items.js`, `stats.js`, `skills.js`, `quests.js`, `save.js`; plus `loot.js` (drops, pickups, labels) and `interact.js` (NPCs, waypoints, shrines, chests, portals, world event) |
| `src/ui/` | `hud.js`, `menus.js` (inventory, skills, quests, controls), `ui.js` (overlay routing, map travel, dialogue, title, death), `mapdraw.js` (minimap, map, fog), `icons.js`, `style.css` |

Tuning numbers sit at the top of each file: `TYPES` and `ELITE_AFFIXES` in `enemies.js`, `SKILLS` in `skills.js`, `AFFIXES` in `items.js`, and the formulas in `stats.js`. In the browser console, `window.__game` exposes the live game state.
