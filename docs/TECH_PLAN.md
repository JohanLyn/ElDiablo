# ElDiablo — Tech Plan

## Tech approach (recommendation)
- **Engine: Godot 4 (C# or GDScript), 3D.** It's free with no royalties, has strong gamepad input mapping, and uses text-based scenes/resources that diff cleanly in git, which suits this repo-driven workflow. Unity is the alternative if you want its asset store and mature tooling. Unreal is overkill for a solo or small-team top-down ARPG.
- **Architecture:**
  - Data-driven: skills, items, affixes, deeds and enemies are defined as resources (`.tres`/JSON), not hard-coded.
  - **Ability system:** skill = cost + targeting + a list of effects. Effects include damage, status, spawn and tether-modify.
  - **Event bus** for deeds: combat events (kill, hit, dodge, low-HP) are published, and Unwritten affixes subscribe to them.
  - State-machine character controller. Enemy AI uses behaviour trees.
  - Save system: character, items with deed progress, and a world-choice ledger for Twist 3.
- **Art pipeline:** start with low-poly placeholder/kitbash assets (e.g. KayKit/Quaternius CC0 packs) and a stylized shader. Lock down a final art style only after the vertical slice.

