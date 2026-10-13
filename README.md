# ElDiablo

A controller-first action RPG in the spirit of Diablo, Torchlight and Titan Quest, with a Diablo 4–style angled top-down 3D camera.

## What makes it different
1. **The Tether:** your hero is bound to a soul-familiar that you steer with the right stick. The line between them is a weapon that skills reshape.
2. **Deedforged loot:** items have *Unwritten* affixes that write themselves when you complete deeds, so gear grows with your playstyle and earns its own name.
3. **Slay, Bind or Spare:** every defeated major boss is a choice. You can take its loot, socket its soul into your gear (along with its demands), or let it live and change the world.

## Theme: The Seven Gates of Kur
A descent into the Mesopotamian underworld. Each of the seven gates takes something from you, and you win it back in a new form.

## Play the prototype
A browser prototype of the core combat and **the Tether** lives in [`prototype/`](prototype/):

```bash
cd prototype
npm install
npm run dev     # open the printed URL and plug in a controller (or use keyboard + mouse)
npm test        # unit tests for the maths helpers
npm run build   # static build in prototype/dist
```

## Docs
- [Game Design](docs/GAME_DESIGN.md)
- [Tech Plan](docs/TECH_PLAN.md)
- [Roadmap](docs/ROADMAP.md)
