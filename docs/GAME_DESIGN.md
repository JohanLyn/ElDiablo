# ElDiablo — Game Design Document

> Living document. **Chosen theme: The Seven Gates of Kur** (section 5). **Lead twist: the Tether** (section 4).
> **Prototype v2** is an open-world slice that plays like Diablo 3/4: town, 4 regions, waypoints, camps and elites, a dungeon with a boss, quests, loot and 6 skills. See [ARPG_FEATURES.md](ARPG_FEATURES.md) for the feature research behind it and [the prototype](../prototype/) to play it.

## 1. Vision & design pillars
1. **Feels great on a gamepad.** Every system (combat, loot, menus) is designed for a controller first. Mouse and keyboard is a port, not the other way around.
2. **Weighty, readable combat.** Hit-stop, clear enemy telegraphs, short animation-cancel windows. Fights should be about where you stand, not about clicking fast.
3. **Loot with a story.** Items you keep and grow matter more than items you salvage by the hundreds.
4. **Choices that echo.** What you do in one act changes later acts and the endgame.

## 2. Camera & controller scheme (Diablo 4–like)
- **Camera:** perspective camera, about 55° pitch, fixed yaw, follows the player with slight look-ahead in the direction of movement. Zoom has 2–3 steps (D-pad down). Walls and roofs between camera and player fade out (dither shader).
- **Movement:** left stick, with 8-way-feeling analog movement and acceleration curves.
- **Skills:** 6 slots. A/X/Y/B plus RB/RT (Xbox naming). LT held = alternate skill bar (12 skills total, optional).
- **Dodge:** a dedicated button (e.g. right-stick click or LB) with i-frames and a cooldown/charges.
- **Aim assist:** a soft-target cone in the facing direction, weighted by distance, threat and current target ("sticky" targeting). Skills snap to the target; ground-targeted AoEs place a reticle you nudge.
- **Right stick:** used by Twist #1 (the Tether). If the Tether is cut, it becomes manual aim instead.
- **Menus:** radial quick menu (potions, town portal, emotes). Inventory is a list/grid hybrid that you move through with the D-pad, with compare-on-hover. Loot pickup works by walking over it plus a hold-to-collect-all. A loot filter exists from day one.
- **Feedback:** rumble on hits and crits, a damage-number toggle, colorblind-safe rarity colors plus icons.

## 3. Core loop
Town hub → choose an act zone/dungeon → kill, loot and level → boss → **boss choice (Twist #3)** → return and upgrade (crafting, Deedforge) → harder content → endgame.

## 4. Three original twists

### Twist 1 — The Tether (twin-stick soulbond combat)
Every hero is bound to a **soul-familiar** that you position with the **right stick** inside a radius around the hero. The **line between hero and familiar is a weapon**: enemies that cross it take damage or status effects, and skills change what the line does:
- *Fire Tether*: the line ignites the ground it sweeps over.
- *Chain Tether*: pulls enemies hit by the line toward the hero.
- *Bulwark Tether*: the line blocks projectiles, so it works as a moving wall.
- *Triangle*: some builds add a second familiar, and enemies inside the triangle are debuffed.

**Why it works:** most ARPGs leave the right stick unused on controller. Here it becomes a core, skill-expressive input. Positioning becomes a build axis, and the result is a combat identity no other game in the genre has. Classes differ in their familiar (melee guardian, caster wisp, summoner swarm-node).

### Twist 2 — Deedforged loot (items that earn their power)
Rare and legendary items drop with 1–3 **Unwritten** affix slots. Each slot listens for a **deed** and *writes itself* when you complete it:
- Kill 300 enemies while below 30% HP → **"Desperate"** (+damage when low).
- Slay a boss without dodging → **"Unflinching"**.
- Kill 50 burning enemies with the Tether → **"Pyre-bound"**.

Fully written items get a **generated name and history** (e.g. *"Grimward, Breaker of the Hollow King"*). They can be **re-forged** at the Deedforge, which resets one slot with a different deed pool.

**Why it works:** it changes loot from a slot machine you salvage into a progression the player chooses. It rewards playstyle, gives the player goals while farming, and creates attachment to gear. Normal drops still exist, so the dopamine of the loot shower stays.

### Twist 3 — Slay, Bind or Spare (bosses as consequential choices)
When a major boss is defeated, it kneels and you choose:
- **Slay:** the classic loot explosion and an extra legendary.
- **Bind:** the boss's soul goes into a **Soul Socket** on your gear. It grants a strong unique power but has a **Demand** (e.g. "kill 100 beasts this act or lose the power", or "you can't use potions in boss fights"). Bound souls comment on your actions.
- **Spare:** the boss **returns later** as a town faction, merchant, mid-act ally, or a changed late-game encounter. The world map shifts as a result: zones open or close and enemy factions change.

Choices are stored per character, and the endgame reads them. For example, spared bosses can unite against the final threat, or betray you. **Why it works:** it adds narrative agency and **replay value across alts**, which the genre usually lacks, and it ties story directly to builds.

### Saved for later — Abubu, the Deluge (world event)
A recurring world event based on the Mesopotamian flood myth (Atrahasis, Gilgamesh). Roughly every 15 minutes a storm rolls in and water rises over low ground in the Sunfields and the Reed Marsh.
- Roads become rivers, loot floats downstream, and river demons swim in.
- You fight on rooftops, ridges and the ziggurat steps.
- When the flood recedes it leaves silt with buried treasure.

The user liked it and asked to keep it for a later version. It is the riskiest of the ideas because it changes navigation, so it should follow the second gate. It would reuse the height-based terrain, the water shader, the day cycle and the event-bus world events.

## 5. Themes (B chosen)

### Theme A — *Mosegrav* (Nordic Iron-Age bog folk horror)
In Iron-Age Scandinavia, the old bog sacrifices are rising: bodies that never rotted, wearing their nooses. Enemies include huldra, mare (nightmare spirits), lindworms, draugr, and wicker idols. Mist, peat and torchlight in a palette of greens, browns and bone. **Familiar:** a will-o'-the-wisp lyktgubbe. **Spare example:** a bog-king spared in Act 1 becomes the keeper of the peat-roads (fast travel). The theme is rich in folklore that's rarely used beyond generic "Viking".

### Theme B — *The Seven Gates of Kur* (Mesopotamian underworld descent) ✅ chosen
Inspired by Inanna's descent: the hero descends through **seven gates of the underworld**, and **each gate takes something** (a stat, a skill slot, an item type). The player earns those back in new forms. This gives the act structure a built-in mechanical arc. Enemies include gallu demons, Lamashtu, scorpion-men, and clay golems from broken ziggurats. Palette: lapis, gold, sun-baked clay, then dusty grey in the deep. **Familiar:** a winged sedu spirit. A fresh setting for the genre.

### Theme C — *Aurum Rot* (alchemical Renaissance canal city)
In a Venice-like canal city, an alchemists' guild tried to transmute life itself. A plague now turns flesh into living gold. You meet plague doctors, carnival masks, homunculi, gilded husks and mercury golems, and the canals flood and drain between zones. Palette: gold on black, candlelight, crimson silk. **Familiar:** a homunculus in a glass vessel. **Deedforge** fits naturally as alchemy. It's urban and gothic, but distinct from the usual medieval hellscape.

## 6. Game systems (scope for v1)
- **Classes (3 at launch):** a melee guardian, a ranged/caster, and a summoner/hybrid. Each has about 20 skills, a modifier tree per skill (D4/PoE2-lite), and a passive board.
- **Stats:** a central **stat/modifier system** (base + additive + multiplicative buckets, with tags like fire/melee/tether). Every effect in the game goes through it.
- **Itemization:** rarities (Common → Magic → Rare → Legendary → Deedforged/Unique), affix pools by item level and tags, data-driven tables.
- **Enemies:** archetype families (swarmer, brute, caster, elite affixes like Vampiric/Mortar/Shielding), with telegraphed attacks and an aggro/pack AI.
- **World:** handcrafted town hubs and boss arenas, plus **procedural dungeons** built from hand-made room chunks (tile-set stitching with navmesh baking).
- **Endgame:** escalating "Rift"-style dungeons with modifiers, a boss ladder that reflects Slay/Bind/Spare choices, and seasonal deed pools.
- **Co-op:** design for 2–4 player couch/online co-op, but **ship single-player first**. Keep the architecture authoritative-ready (separate simulation from presentation).

