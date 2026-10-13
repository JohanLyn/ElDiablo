# ElDiablo — Tech Plan

## Prototype: three.js (current)
The first prototype (M0 feel and M1 Tether) is built in **three.js + Vite**, in [`prototype/`](../prototype/).
- **Why not Godot for the prototype?** Godot 4 isn't overkill for a prototype; it would be fine. three.js won for this phase because:
  - it runs in any browser with no install, so it's easy to share and to test with a controller (Gamepad API);
  - it can be built, run and screenshot-tested headlessly in a cloud dev session;
  - it starts instantly and is plain JavaScript, so iteration is fast.
- **Trade-off:** three.js is a renderer, not an engine. Physics, navmesh, an animation state machine, a scene editor, tooling and console ports would all have to be built or pulled in from libraries. That's acceptable for proving the fun, but costly for a full game.
- **Decision point after M1:** if the Tether is fun, choose the production engine.
  - **Godot 4** if the target is desktop/console with an editor-driven content pipeline (still the recommendation).
  - **Stay on the web** (three.js, or Babylon.js for more built-in engine features) if browser distribution matters most.
  - The prototype's systems (input mapping, tether maths, combat tuning numbers) port directly either way.


## Production engine (recommendation, decided after M1)
- **Engine: Godot 4 (C# or GDScript), 3D.** It's free with no royalties, has strong gamepad input mapping, and uses text-based scenes/resources that diff cleanly in git, which suits this repo-driven workflow. Unity is the alternative if you want its asset store and mature tooling. Unreal is overkill for a solo or small-team top-down ARPG.
- **Architecture:**
  - Data-driven: skills, items, affixes, deeds and enemies are defined as resources (`.tres`/JSON), not hard-coded.
  - **Ability system:** skill = cost + targeting + a list of effects. Effects include damage, status, spawn and tether-modify.
  - **Event bus** for deeds: combat events (kill, hit, dodge, low-HP) are published, and Unwritten affixes subscribe to them.
  - State-machine character controller. Enemy AI uses behaviour trees.
  - Save system: character, items with deed progress, and a world-choice ledger for Twist 3.
- **Art pipeline:** start with low-poly placeholder/kitbash assets (e.g. KayKit/Quaternius CC0 packs) and a stylized shader. Lock down a final art style only after the vertical slice.

