# ElDiablo — Roadmap

| Milestone | Goal |
|---|---|
| **M0 – Feel prototype** | Camera, controller movement, dodge, 1 melee skill, 1 enemy type, hit-stop/rumble. Is it fun with a gamepad? |
| **M1 – Tether prototype** | Right-stick familiar, damaging line, 3 tether modifiers. Validates Twist 1 early, because it's the riskiest. |
| **M2 – Loot core** | Stat/modifier system, item drops, inventory UI on controller, affixes, the deed event bus and 5 deeds. |
| **M3 – Vertical slice** | Chosen theme, 1 town, 1 procedural dungeon, 1 boss with Slay/Bind/Spare, 1 full class. |
| **M4 – Content** | 3 classes, Act 1–2, 15+ enemy types, Deedforge crafting. |
| **M5 – Endgame & polish** | Rift-style endgame, balancing, accessibility, optional co-op. |

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
- [ ] Playtest with a real controller and tune the numbers

**Done when:** it feels good to fight 20 enemies in the test arena with a controller.

## M1 – Tether prototype
- [x] Right-stick (or mouse) familiar within a 6.5 m radius; a resting familiar is harmless
- [x] Damaging line with a whip bonus (faster sweep = up to 2.5x damage)
- [x] Modes: Lapis (damage), Gibil (burn + fire trail), Ereshkigal (pull + slow), Nergal (blocks bolts, shoves)
- [x] Tether Snap (Y): a mode-specific burst along the line
- [ ] Playtest questions: Is steering two sticks at once fun or tiring? Should the familiar stay where it was left? Should the Tether have a resource cost?
