# ElDiablo — Roadmap

| Milestone | Goal |
|---|---|
| **M0 – Feel prototype** | Camera, controller movement, dodge, 1 melee skill, 1 enemy type, hit-stop/rumble. Is it fun with a gamepad? |
| **M1 – Tether prototype** | Right-stick familiar, damaging line, 3 tether modifiers. Validates Twist 1 early, because it's the riskiest. |
| **M2 – Loot core** | Stat/modifier system, item drops, inventory UI on controller, affixes, the deed event bus and 5 deeds. |
| **M3 – Vertical slice** | Chosen theme, 1 town, 1 procedural dungeon, 1 boss with Slay/Bind/Spare, 1 full class. |
| **M4 – Content** | 3 classes, Act 1–2, 15+ enemy types, Deedforge crafting. |
| **M5 – Endgame & polish** | Rift-style endgame, balancing, accessibility, optional co-op. |

## Direction change (v2)
Playtest feedback on v1: wave defense in one arena isn't the goal. The game should be an **open-world action RPG that plays like Diablo 3/4**. Prototype v2 rebuilds around the essential features listed in [ARPG_FEATURES.md](ARPG_FEATURES.md) and keeps the Tether as the class's signature mechanic. M2 and parts of M3 were pulled forward.

## Decisions
- [x] Theme: **The Seven Gates of Kur**
- [x] Lead twist to prove first: **the Tether**
- [x] Prototype tech: **three.js + Vite** (see [Tech Plan](TECH_PLAN.md))
- [ ] Production engine: decide after M1 playtests

## M0 – Feel prototype (three.js, `prototype/`)
- [x] Vite + three.js project scaffold
- [x] Input mapping for gamepad (move, dodge, attack, snap, tether modes, zoom, pause) plus keyboard/mouse fallback
- [x] Player controller: analog movement with acceleration, states (move/attack/dodge), 3-hit combo
- [x] Camera rig: 55° pitch, fixed yaw, smooth follow with look-ahead, 3 zoom steps
- [x] Occlusion fade for pillars/walls between camera and player
- [x] Dodge with i-frames and 2 charges
- [x] Melee combo with soft-target aim assist and lunge
- [x] Enemies: Gallu (melee, telegraphed arc) and Girtablullu scorpion-men (ranged, telegraphed bolt), waves
- [x] Hit-stop, screen shake, controller rumble, damage numbers, bloom
- [x] Kur-themed greybox arena before the First Gate
- [x] (v1 arena and waves were replaced by the v2 open world)

**Done when:** it feels good to fight 20 enemies in the test arena with a controller.

## M1 – Tether prototype
- [x] Right-stick (or mouse) familiar within a 6.5 m radius; a resting familiar is harmless
- [x] Damaging line with a whip bonus (faster sweep = up to 2.5x damage)
- [x] Modes: Lapis (damage), Gibil (burn + fire trail), Ereshkigal (pull + slow), Nergal (blocks bolts, shoves)
- [x] Tether Snap (Y): a mode-specific burst along the line
- [ ] Playtest questions: Is steering two sticks at once fun or tiring? Should the familiar stay where it was left? Should the Tether have a resource cost?

## Prototype v2 – Open world (done)
- [x] Overworld (~400 × 400 m): Sunfields (Lv 1), Reed Marsh (Lv 3), Dune Ruins (Lv 5), Ashen Approach (Lv 7), roads, water, ~3,000 props, mountain border
- [x] Eridu Outpost town: Ninsun (quests, potion upgrades), Ubar (sell, gamble), waypoint
- [x] D4-style monster scaling (max(region level, hero level)) and ~100 seeded camps that spawn, leash and respawn
- [x] 5 monster types (Gallu, Utukku, Lilitu, Girtablullu, Asag) with melee/brute/ranged/caster AI and telegraphs
- [x] Elite packs with affixes (Fast, Vampiric, Molten, Storm-Touched) and a named champion (Aqrabu)
- [x] Dungeon instance (the Ganzir Stair) that resets on entry, with boss Neti (3 attack patterns, adds + shield phases, enrage)
- [x] 6-slot skill bar on the D4 controller layout; 7 skills; Anima generator/spender; cooldowns; ranks; rebinding
- [x] Tether integrated as a class mechanic: manual whip with the right stick, auto-sweep when idle, 4 Aspects unlocked by level
- [x] Items: 7 kinds, 4 rarities, 12 affixes, 7 legendary powers, comparison tooltips, upgrade arrows, selling, salvaging, gambling
- [x] Potions with charges (refilled by orbs and in town), evade with charges, barrier, buffs
- [x] Waypoints and fast travel, town portal, shrines, chests, Ritual of the Gallu world event
- [x] Minimap with fog of war, full map, quest markers, target frame, boss bar
- [x] 5-quest story chain, XP and levels (cap 20), skill points
- [x] Local save/continue, title screen, death and respawn
- [x] Unit tests (game logic) and an end-to-end simulation (`npm run e2e`)

## Next
- [ ] Playtest with a real controller; tune damage, XP curve and monster density
- [ ] Twist 2: Deedforged items (Unwritten affixes and the deed event bus)
- [ ] Twist 3: Slay / Bind / Spare on Neti and Aqrabu
- [ ] Strongholds, side quests, stash, loot filter
- [ ] Audio (SFX first, then music)
- [ ] Decide the production engine
