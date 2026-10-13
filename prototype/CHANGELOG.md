# Changelog

All notable changes to the Gates of Kur prototype. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0-alpha]

The first alpha. The v2 open-world prototype now looks, sounds and plays like a game, and the first 15 minutes are scripted and balanced.

### Added
- **Graphics**
  - Quality presets: Low, Medium, High (default) and Ultra, chosen in Settings. Add `?low` or `?quality=medium` to the URL to override the saved preset. Presets control resolution, shadows, bloom, ambient occlusion, anti-aliasing, grass and particle density.
  - A filmic colour grade with its own mood per region, plus vignette, film grain and a low-life pulse at the screen edges.
  - A procedural sky dome, a terrain shader that blends grass, mud, sand, ash and rock, wind-swayed grass, shader-driven marsh water with foam and glints, and drifting cloud shadows.
  - Landmarks: the broken lamassu and half-buried ziggurat in the Dune Ruins, the First Gate silhouette over the Ashen Approach, marsh huts with a boardwalk, tilled fields and irrigation canals.
  - Eridu Outpost dressing: banners, lanterns, braziers, jars, awnings, a cart, palms and a lapis-crowned temple.
  - Ambient particles that change with the region: pollen, fireflies, sand, embers, ash and motes.
- **Characters**
  - A rig-based, animated Gatewalker (spring-driven cape, weapon that matches the equipped item and glows by rarity) and animated monsters, with spawn and death dissolves and an elite aura.
- **Combat effects**
  - Crescent sickle slashes, the Tether beam, javelin and bolt trails, lightning, Wings of the Sedu, the Aegis hex shield, and shaped telegraphs for enemy attacks (zones, cones and lanes).
  - Light beams over dropped loot, coloured by rarity.
- **Audio**
  - Fully synthesized sound effects and an adaptive, generative score with region themes, a combat layer and a boss layer. There are no audio files.
  - A continuous Tether hum that follows how fast you whip it, with a different timbre for each Aspect.
- **Interface**
  - An ornate Mesopotamian HUD, inventory, skills and quest screens, a pause menu, a settings screen (graphics, audio, gameplay, interface), a controls reference and a colour-blind option for item rarities.
  - A global error overlay with a "Copy details" button, a WebGL-missing notice, a narrow-screen notice, and auto-pause when the window loses focus or the controller disconnects.
- **The first 15 minutes**
  - A cold-open title screen with a slow flyover from the cracked First Gate to Eridu, and story cards.
  - A three-wave caravan ambush on the south road that teaches movement and combat. The first kill drops a weapon upgrade and the first elite or champion drops a Rare.
  - Contextual tutorial prompts for movement, attacking, the Tether, evading, potions, looting, equipping, skills, the map and Aspects. They show controller or keyboard text for the device in use, and can be switched off in Settings.
  - Painted NPC portraits in dialogue.
- **Quests**
  - The story chain is now eight quests: The Road to Eridu, Ash at the Outpost, The Ritual Stones, Waters of Enki, The Drowned Cistern, Sting of the Desert, The Ganzir Stair and Keeper of the First Gate.
- **Dungeons**
  - The Cistern of Enki, a mini-dungeon under the Reed Marsh shrine. Its guardian, The Drowned Voice, drops a guaranteed Legendary the first time you kill it.
  - Dungeons are now data in `src/world/instances.js`. The Ganzir Stair and the Cistern share one builder.
- **Tools**
  - `e2e/firstfifteen.mjs`, a balance bot that plays the first 15 minutes and checks the alpha pacing targets.
  - Unit tests for the audio system.

### Changed
- Save format is now v3. Older v2 saves are migrated on load: the hero skips the intro and tutorials, and the quest position is kept.
- Balance pass, checked with the balance bot:
  - The XP needed per level is now 100 x L squared.
  - The Tether is weaker: a longer hit interval, lower damage per tick and a lower whip bonus cap.
  - Monsters have more life and hit harder.
- Kill-quest markers point to the nearest camp that still has targets.

### Fixed
- Audio: the music scheduler looks ahead correctly, audio timing no longer depends on frame rate, voice counts are capped per sound, and the Tether hum is balanced against the mix.
- Telegraph shapes now match the area that actually hurts.
- Glow and particle blending is premultiplied, so effects no longer wash out.
- Canal placement and dungeon lighting: dungeons are brighter and their detail props sit correctly.

### Known issues
- The controller has only been tested through a simulated gamepad, not real hardware.
- Machines with software rendering (no GPU) are slow. Use `?low`.
- The map does not cover dungeon interiors beyond the minimap.
- The main JavaScript chunk is about 1 MB minified.

## [0.2.0]

The open-world prototype: Eridu Outpost, four regions, a five-quest story ending at the Ganzir Stair and the boss Neti, seven skills, the Tether and its Aspects, loot with legendary powers, fast travel and local saves.
