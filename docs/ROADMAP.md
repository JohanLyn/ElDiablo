# ElDiablo — Roadmap

| Milestone | Goal |
|---|---|
| **M0 – Feel prototype** | Camera, controller movement, dodge, 1 melee skill, 1 enemy type, hit-stop/rumble. Is it fun with a gamepad? |
| **M1 – Tether prototype** | Right-stick familiar, damaging line, 3 tether modifiers. Validates Twist 1 early, because it's the riskiest. |
| **M2 – Loot core** | Stat/modifier system, item drops, inventory UI on controller, affixes, the deed event bus and 5 deeds. |
| **M3 – Vertical slice** | Chosen theme, 1 town, 1 procedural dungeon, 1 boss with Slay/Bind/Spare, 1 full class. |
| **M4 – Content** | 3 classes, Act 1–2, 15+ enemy types, Deedforge crafting. |
| **M5 – Endgame & polish** | Rift-style endgame, balancing, accessibility, optional co-op. |

## Before M0
- [ ] Pick a theme (A *Mosegrav*, B *Seven Gates of Kur*, C *Aurum Rot*)
- [ ] Confirm the engine (recommended: Godot 4)

## M0 – Feel prototype checklist
- [ ] Godot 4 project scaffold (folders: `scenes/`, `scripts/`, `data/`, `assets/`)
- [ ] Input map for gamepad (move, dodge, 6 skill slots, zoom, menu) plus keyboard/mouse fallback
- [ ] Player controller: analog movement with acceleration curves, state machine (idle/move/attack/dodge/hit)
- [ ] Camera rig: ~55° pitch, fixed yaw, smooth follow with look-ahead, 3 zoom steps
- [ ] Occlusion fade for walls/roofs between camera and player
- [ ] Dodge with i-frames and charges
- [ ] One melee skill with soft-target aim assist
- [ ] One enemy type: chase, telegraphed attack, hit reaction, death
- [ ] Hit-stop, screen shake, controller rumble, damage numbers
- [ ] Greybox test arena

**Done when:** it feels good to fight 20 enemies in the test arena with a controller.
