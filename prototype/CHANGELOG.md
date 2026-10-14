# Changelog

All notable changes to the Gates of Kur prototype. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0-alpha]

A visual pass: a new interface built from the world's own lapis, shell and carnelian, a full day cycle, and set pieces and combat moments that hit harder.

### Added
- **Lapis Mosaic interface**, after the Standard of Ur.
  - Frames: lapis panels framed by inlaid shell, carnelian and lapis triangles, with gold studs and rosettes.
  - Orbs: Life and Anima are carved beads (etched carnelian, and lapis with pyrite flecks) with a clear fill line.
  - Skill bar and XP: the skill bar is a register strip, and XP is a strand of beads.
  - Minimap and quest tracker: a mosaic minimap ring, a cartouche region plate and a shell quest tab.
  - Tooltips: the border inlay shows the rarity.
  - Title: a title lockup with a seven-gate emblem.
  - Transitions: a cylinder-seal frieze rolls across when menus and banners open.
- **Day cycle**: a 14-minute day (dawn, day, golden hour, dusk, moonlit night). Each time of day has its own sun, sky, fog, exposure, bloom and colour grade, and each region keeps its own mood on top. New heroes start at dawn. The **Time of day** setting can hold one time, and the `?time=` URL flag sets it for one visit.
- **Atmosphere**
  - Height fog that pools in hollows, with sun-tinted haze.
  - A sky-lit environment map, so gold, lapis and metal glint.
  - Light shafts through palms, the ziggurat, the First Gate and dungeon ceilings.
  - Two cloud layers, a moon with phases, and stars.
  - Water that reflects the sky, the sun or moon, and nearby lanterns.
  - Grass that catches the light.
  - Chromatic aberration and lens dirt on High and Ultra.
- **Set pieces**
  - A lightning storm over the First Gate, with thunder.
  - Fire beacons and smoke on the ziggurat.
  - Eridu lantern strings, pennants and lamplit windows that come alive at dusk.
  - A short camera reveal the first time you enter each region.
- **Living world**: dove flocks that scatter as you approach, vultures over the ruins, crows in the Ashen Approach, dragonflies and jumping fish in the marsh, dust devils, and wind gusts that roll across the grass.
- **Combat impact**
  - Hit-stop and hit flashes scale with the weight of the hit.
  - A squash-and-rebound on hit and a directional camera kick.
  - Screen-space shockwaves on crits, slams, landings and boss moments.
  - Ichor bursts and ground stains in each monster family's colour.
  - A warm rim light on the hero, and a silhouette when the hero is hidden behind walls.
- **Boss entrances**: Neti and the Drowned Voice (who rises from the pool) get letterboxed camera intros with title cards. Elite and boss deaths get a brief slow-motion moment and a loot fountain.

### Changed
- Point lights now come from a shared pool of 12 that follow the nearest lanterns, braziers and fires. The scene's light count stays fixed, so lanterns are cheap.
- The HUD fades during boss entrances and region reveals, except for the title banner.

### Fixed
- Ground decals (cracks, scorch marks, glyphs) were never drawn because of back-face culling; they now show.

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
- Kill-quest markers point to the nearest camp that still has targets. Inside a dungeon, a marker for something outside it points at the way out.
- Legendaries no longer drop below item level 5, so the Cistern guardian's guaranteed Legendary is the first one. Elites have a little less life.
- Performance: every hero and monster is now one skinned mesh instead of one mesh per bone, which cuts draw calls in busy fights by about 85% (744 to 110 in the Dune Ruins). Dungeon brazier lights are pooled, so the light count stays the same everywhere.

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
