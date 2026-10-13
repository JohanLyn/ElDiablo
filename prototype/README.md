# Gates of Kur: Tether prototype

A three.js prototype that tests whether the core combat and the Tether are fun on a controller. You fight waves of Gallu demons and scorpion-men in front of the First Gate of Kur.

```bash
npm install
npm run dev     # dev server with hot reload
npm test        # node:test unit tests (src/util.js)
npm run build   # production build in dist/
```

## Controls
| Action | Controller | Keyboard & mouse |
|---|---|---|
| Move | Left stick | WASD / arrows |
| Steer the familiar (the Tether) | Right stick | Mouse |
| Strike (3-hit combo, aim assist) | A / RT (hold) | Left click / J |
| Dodge (2 charges) | B / LB | Space / Shift |
| Tether Snap | Y / X | Right click / F |
| Change tether mode | RB, D-pad ◀ ▶ | Q / E |
| Zoom | D-pad ▼ | Z |
| Pause / help | Start | Esc / H |

## Code map
| File | What it does |
|---|---|
| `src/main.js` | Renderer, bloom, game loop, hit-stop, pause/restart |
| `src/input.js` | Gamepad + keyboard/mouse into one action state (edge-detected), rumble |
| `src/camera.js` | Diablo 4-style rig: 55° pitch, look-ahead, zoom steps, occluder fading |
| `src/player.js` | Movement, dodge, combo and soft-target aim assist |
| `src/tether.js` | Familiar, damaging line, whip bonus, 4 modes, Snap, fire patches |
| `src/enemies.js` | Gallu and scorpion-man AI, telegraphs, projectiles, waves |
| `src/world.js` | Arena before the First Gate, colliders, palette |
| `src/fx.js` | Particles, damage numbers, screen shake, hit-stop, rumble |
| `src/hud.js` | HUD overlay, banners, help and death screens |

Tuning numbers sit at the top of each file (for example `MAX_REACH`, `SNAP_COOLDOWN`, `COMBO`, `TYPES`). In the browser console, `window.__game` exposes the live game state for debugging.
