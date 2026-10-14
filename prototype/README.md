# The Seven Gates of Kur: prototype 0.3.0-alpha

An open-world action RPG slice in three.js that plays like Diablo 3/4. It's controller-first, and keyboard and mouse work too. See [CHANGELOG.md](CHANGELOG.md) for what changed and the known issues, and [../docs/ROADMAP.md](../docs/ROADMAP.md) for the alpha checklist.

## Run it
```bash
npm install
npm run dev      # dev server with hot reload
npm test         # node:test unit tests (game logic, maths, audio theory and recipes)
npm run build    # production build in dist/
npm run preview  # serve dist/ at http://localhost:4173
npm run e2e      # headless quest-chain simulation (needs `npm run preview` running and Playwright)
```

The e2e scripts need Playwright, which is not a dependency of the project: `npm i -D playwright && npx playwright install chromium`. Run `npm run build && npm run preview` first, then in another shell:

```bash
npm run e2e                           # e2e/sim.mjs: plays the whole quest chain, both dungeons included
node e2e/firstfifteen.mjs [url] [minutes] [seed]   # balance bot: plays the first 15 minutes and checks the pacing targets
```

## URL flags
| Flag | Effect |
|---|---|
| `?low` | Use the Low quality preset (no shadows, bloom or grass). Use it on slow or software-GL machines. |
| `?quality=low\|medium\|high\|ultra` | Use that quality preset instead of the saved one. |
| `?time=dawn\|noon\|golden\|dusk\|night` | Hold that time of day for this visit (Settings → Time of day saves a choice). |

Quality can also be changed in Settings. In the browser console, `window.__game` exposes the live game state.

## What's in it
- **World:** Eridu Outpost (town) and four regions with level ranges: the Sunfields (1), Reed Marsh (3), Dune Ruins (5) and Ashen Approach (7). Monsters scale to at least your level. Each region has its own sky, colour grade, ambient particles and music.
- **Story:** eight quests. A caravan ambush opens the game, then Ninsun sends you through the Sunfields, the Ritual Stones, the Reed Marsh and the Cistern of Enki, then Aqrabu in the Dune Ruins, and finally the Ganzir Stair and the boss **Neti, Keeper of the First Gate**.
- **Dungeons:** the Ganzir Stair and the Cistern of Enki (guardian: The Drowned Voice, first kill drops a Legendary). Both reset each time you enter.
- **Exploration:** waypoints with fast travel from the map, monster camps and elite packs, Aqrabu the Venomed (a named champion), shrines, chests, the *Ritual of the Gallu* world event, a town portal, and a minimap with fog of war.
- **Combat:**
  - 7 skills on 6 slots, using an Anima generator/spender model.
  - Evade with charges, potions with charges, telegraphed enemy attacks.
  - Elite affixes: Fast, Vampiric, Molten and Storm-Touched.
- **The Tether:** steer your sedu spirit with the right stick, and whip it for bonus damage. If you leave it alone, it sweeps nearby enemies by itself. Four Aspects unlock as you level.
- **Night of the Gidim:** the monsters you slay outdoors by day leave marks, and at night they rise as pale ghosts (Burning, Chained, Shattered, Plain, or a Gidim Lord) shaped by how they died. They cannot enter Eridu, shrines, waypoints or lantern light; your sedu spirit becomes a lantern and its Tether a ward. Ghost-ash ◈ buys Night Blessings from Ninsun. Toggle it under Settings > Gameplay.
- **Loot:**
  - Common, Magic, Rare and Legendary items with random affixes and 7 legendary powers.
  - Comparison tooltips and upgrade arrows.
  - Sell or gamble with Ubar, or salvage anywhere.
- **Progression:** XP up to level 20 (100 x L squared per level), skill points and ranks, rebinding, and potion upgrades from Ninsun.
- **Presentation:** a render pipeline with four quality presets, an animated rig-based hero and monsters, combat VFX, fully synthesized music and sound effects (no audio files), an ornate HUD, a pause menu, settings, contextual tutorial prompts and an error overlay.
- **Saving:** progress is saved automatically in the browser (localStorage, save format v3; v2 saves are migrated).

## Controls
| Action | Controller | Keyboard & mouse |
|---|---|---|
| Move | Left stick | WASD or arrow keys |
| Steer the Tether | Right stick | Mouse |
| Skill slots 1–6 | A · X · Y · RB · RT · LT | Left click · Right click · 1 · 2 · 3 · 4 |
| Interact / pick up | A (when no enemies are close) | E |
| Evade | B | Space |
| Healing potion | LB | Q |
| Change Tether Aspect | D-pad ◀ ▶ | R / F |
| Town Portal | D-pad ▲ | T |
| Zoom | D-pad ▼ | Z / mouse wheel |
| Map and fast travel | Back / View | M / Tab |
| Pause menu | Start | Esc |
| Inventory · Skills · Quests | From the pause menu (then LB/RB for tabs) | I · K · J |

In menus, use the D-pad or stick (arrow keys or WASD) to move, A (Enter) to choose, X for the second action (sell, salvage or assign to a button), B (Esc) to go back, and LB/RB (Q/E) to switch tabs. The Controls screen in the pause and title menus shows the same bindings.

## Code map
| Folder | What lives there |
|---|---|
| `src/main.js` | Boot, the shared game context `g`, game loop and `g.simulate` tick, title flyover, teleport, dungeon enter/leave, death and respawn, save |
| `src/core/` | `input.js` (gamepad, keyboard and mouse to actions, with menu repeat), `render.js` (renderer, post-processing chain and filmic grade, rebuilt on quality change), `settings.js` (quality presets and saved options), `slowmo.js` (kill slow-motion), `camera.js` (D4-style rig, building fade, scripted flyover), `events.js` (event bus that decouples gameplay from audio, VFX and tutorials), `fx.js` (damage numbers, shake, hit-stop, rumble), `rng.js` (seeded RNG, noise), `util.js` |
| `src/audio/` | Synthesized audio, no files. `audio.js` (wires events to sounds, owns the AudioContext), `engine.js` (buses, limiter, reverbs, spatial output), `synth.js` (synthesis toolkit), `sfx.js` (sound recipes), `instruments.js` (choir, reed, drum, horn, lyre), `music.js` (adaptive generative score), `hum.js` (Tether hum), `theory.js` (pure helpers, unit-tested) |
| `src/fx/` | Combat VFX. `vfx.js` (event-driven director), `particles.js` (instanced particle layers), `atlas.js` (procedural textures), `ribbons.js` (trails and lightning), `slash.js`, `telegraph.js` (attack warning shaders), `beams.js` (loot beams and the Aegis shield), `models.js` (javelin, bolt, wings, ghosts), `combat.js` (hit feel, ichor, shockwaves, death moments), `bossIntro.js` (boss entrances), `silhouette.js` (hero outline behind walls), `rarity.js`, `shared.js` |
| `src/world/` | `layout.js` (regions, roads and POIs: edit here to move things), `terrain.js` (height, region and road functions), `terrainMesh.js` (terrain splat shader), `props.js` (instanced scatter), `models.js`, `town.js` and `townDressing.js`, `landmarks.js`, `canals.js`, `spots.js` (keep-clear areas for props), `dungeon.js` (dungeon builder), `instances.js` (data for the Ganzir Stair and the Cistern of Enki), `colliders.js` (spatial hash), `timeofday.js` (day cycle), `env.js` (time-of-day looks and the sky environment map), `lights.js` (pooled point lights for lanterns and fires), `shafts.js` (light shafts), `setpieces.js` (First Gate storm, ziggurat beacons), `life.js` (birds, critters, gusts), `world.js` (assembly, regional atmosphere and grade) |
| `src/world/shaders/` | `common.js` (shared uniforms), `fog.js` (height and distance fog for every material), `sky.js`, `grass.js`, `water.js`, `lit.js` (wind sway and cloud shadows for standard materials), `particles.js` (regional ambient particles), `glow.js` (light halos and billboard flames) |
| `src/entities/` | `player.js`, `abilities.js` (all 7 skills), `tether.js`, `enemies.js` (types, AI, camps, elites, hazards), `boss.js` (Neti), `rig.js` (procedural skeleton and animator), `enemyModels.js` (monster models and poses), `anim/hero.js` (hero model and poses), `anim/mesh.js` (low-poly part builder) |
| `src/game/` | Pure logic: `items.js`, `stats.js`, `skills.js`, `quests.js`, `save.js`, `gidimRules.js` (Night of the Gidim rules); plus `gidim.js` (marks, risings, sanctuaries, blessings), `loot.js` (drops, pickups, labels), `interact.js` (NPCs, waypoints, shrines, chests, portals, world event), `story.js` (caravan ambush and first-time loot guarantees), `reveal.js` (first-visit region reveals) and `tutorial.js` (contextual prompts) |
| `src/ui/` | `hud.js`, `menus.js` (inventory, skills, quests, settings, controls), `ui.js` (overlay routing, map travel, dialogue, title, pause, death), `mapdraw.js` (minimap, map, fog), `system.js` (error overlay, WebGL and narrow-screen notices, auto-pause), `portraits.js` (NPC portraits), `ornaments.js` (SVG ornament kit), `glyphs.js` (button and key glyphs), `icons.js`, and the stylesheets `style.css`, `hud.css`, `menus.css` |
| `test/` | `game.test.js` (items, stats, skills, quests, save migration, event bus), `audio.test.js` (theory, DSP helpers, SFX recipes, music profiles), `util.test.js` (maths), `gidim.test.js` (variants, sanctuaries, mark cap) |
| `e2e/` | `sim.mjs` (full quest-chain simulation), `firstfifteen.mjs` (balance bot for the first 15 minutes) |

Tuning numbers sit at the top of each file: `TYPES` and `ELITE_AFFIXES` in `enemies.js`, `SKILLS` in `skills.js`, `AFFIXES` in `items.js`, `QUALITY` in `settings.js`, and the formulas in `stats.js`. Dungeon layouts, rosters and guardians are in `src/world/instances.js`, and the quest chain is in `src/game/quests.js`.
