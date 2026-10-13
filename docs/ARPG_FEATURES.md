# Essential Action-RPG Features (Diablo 3 / 4 style)

High-level research into what makes a Diablo-style action RPG work, and what the prototype needs in order to feel like one. Sources are listed at the end. The rest comes from studying Diablo 2, 3 and 4, Torchlight, Titan Quest, Path of Exile and Last Epoch.

## The core loop
**Kill → loot → get stronger → go somewhere harder → kill.** Everything below exists to keep that loop fresh:
- The fighting must feel good on its own (responsive, weighty, readable).
- Loot must sometimes *change how you play*, not just add numbers.
- The world must keep giving you somewhere new to point that power at.

Reviews of Diablo 4 describe this as a "hypnotic" loop of slashing, finding rarer loot and watching numbers go up, and warn that the same repetition turns tedious when execution slips. Blizzard framed D4's open world as "disruptions" (events, dungeons, strongholds) that break up that loop.

## Feature checklist

Legend: ✅ in prototype v2 · 🔜 planned next · 💤 later

### 1. Combat feel
| Feature | Why it matters | v2 |
|---|---|---|
| Direct control (stick/WASD), Diablo 3+ style | Controller-first; replaces click-to-move | ✅ |
| Evade / dodge with i-frames (D4: B button) | Skill expression; telegraphs become dodgeable | ✅ |
| Telegraphed enemy attacks | Fights are about where you stand, not just stats | ✅ |
| Hit-stop, shake, rumble, damage numbers, crits | "Weight" and feedback | ✅ |
| Soft-target aim assist on controller | Skills hit what you meant without a mouse | ✅ |
| Health potions with limited charges, refilled by drops | Healing as a resource decision (D4) | ✅ |
| Crowd control (slow, knockback, stun) | Build variety and control | ✅ partial |

### 2. Skills and resources
| Feature | v2 |
|---|---|
| 6 skill slots on the controller (D4: A, X, Y, RB, LT, RT) | ✅ |
| Resource generator → spender model (basic skill builds resource, core skills spend it) | ✅ (Anima) |
| Cooldown skills: mobility, defensive, ultimate | ✅ |
| Skill unlocks by level, skill points to rank up | ✅ |
| Rebinding skills to any slot | ✅ |
| Skill modifiers/upgrades (D4 enhancements) | 💤 |
| Paragon / post-max-level board | 💤 |

Design note: a known D4 criticism is that a strict generator/spender model forces filler casts. We mitigate this with passive Anima regen, and the Tether deals damage while you build resource.

### 3. Loot and itemization
| Feature | v2 |
|---|---|
| Rarity tiers with colours: Common, Magic, Rare, Legendary | ✅ |
| Random affixes scaled by item level | ✅ |
| Legendary powers that change skills (D4 aspects) | ✅ (7 powers) |
| Equipment slots: weapon, helm, chest, gloves, boots, amulet, 2 rings | ✅ |
| Ground labels, rarity light beams, gold auto-pickup | ✅ |
| Item comparison tooltip (green/red deltas) | ✅ |
| Selling, plus a gamble vendor (D3 Kadala-style) for gold sinks | ✅ |
| Crafting / rerolling (D4 enchanting), sockets, gems | 💤 |
| Stash, loot filter | 🔜 |

### 4. Open world and exploration
| Feature | v2 |
|---|---|
| Large continuous world split into **regions with level ranges** | ✅ 4 regions + town |
| **Monster level scales** with the player within a region floor (D4 style) | ✅ |
| Town hub: quest giver, merchant, healer, waypoint | ✅ |
| **Waypoints** discovered by exploring, fast travel from the map | ✅ |
| Monster camps placed through the world (no arenas or waves) | ✅ |
| Elite / champion packs with random affixes | ✅ |
| **Dungeons** as separate instanced spaces with a boss | ✅ 1 dungeon |
| **World events** (timed objectives with a reward chest) | ✅ |
| Shrines (temporary buffs), chests, breakables | ✅ shrines and chests |
| Strongholds (clear a hostile area to liberate a town or waypoint) | 🔜 |
| Minimap with fog of war, full map overlay, quest markers | ✅ |
| Town portal | ✅ |

### 5. Progression and story
| Feature | v2 |
|---|---|
| XP and levels with a stat increase and skill point per level | ✅ (cap 20) |
| Main quest chain with a tracker and objectives | ✅ 5 quests |
| NPC dialogue | ✅ |
| Side quests | 🔜 |
| Difficulty tiers (D4 world tiers / torment) | 💤 |
| Endgame (Nightmare dungeons, rifts, Pit) | 💤 |
| Save and continue | ✅ (local browser save) |

### 6. UI on controller
| Feature | v2 |
|---|---|
| Life orb (left) + resource orb (right), skill bar between them | ✅ |
| Contextual interact on A, avoiding the D4 conflict where A is also the basic skill (enemies nearby → attack wins) | ✅ |
| Menus fully navigable with D-pad/stick, LB/RB for tabs | ✅ |
| Target frame showing name, level, affixes and life of the current target | ✅ |

### 7. Later
- Multiple classes, co-op, crafting depth, seasons, procedural dungeon layouts, audio and music.

## How ElDiablo differs
The **Tether** stays as the class's signature mechanic:
- The right stick (unused in D4) steers the sedu familiar, and the line between you is a weapon.
- If you don't touch the stick, the familiar sweeps toward nearby enemies on its own at reduced power. Two-stick play is a skill ceiling, not a requirement.

## Sources
- [Destructoid: Diablo 4 review](https://destructoid.com/?p=381843): the core loop and the risk of repetition
- [TechRadar: Diablo 4 devs on "disruptions"](https://www.techradar.com/features/diablo-4-devs-promise-disruptions-that-will-break-the-rpg-mold): open-world design intent
- [George Berry: Diablo 4 has a resource generation problem](https://georgeberry.substack.com/p/diablo-4-has-a-resource-generation): critique of generator/spender skills
- [Game8: Diablo 4 controls](https://game8.co/games/Diablo-4/archives/413998): default controller layout (B evade, LB potion, skills on Y/RB/LT/RT)
- [Icy Veins: fixing the D4 controller layout](https://wp-prod.icy-veins.com/diablo-4-tips-on-how-to-fix-clunky-controller-layout/): the A-button interact/basic-skill conflict
- [PCGamesN: Diablo 4 stronghold locations](https://www.pcgamesn.com/diablo-4/stronghold-locations): strongholds unlock waypoints, vendors and dungeons
- [guides4gamers: Diablo 4 world map](https://guides4gamers.com/diablo-4/maps/world-map/): regions, waypoints, dungeons, side quests
- [GamePro: level scaling in Diablo 4](https://www.gamepro.de/artikel/diablo-4-automatisches-level-scaling,3392442.html): how monster levels track the player
