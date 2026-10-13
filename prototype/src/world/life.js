import { createSetpieces } from './setpieces.js';

// The "living world": set pieces (storm, beacons) and ambient critters. world.js owns
// one instance (see the hook lines there) and ticks it each frame.
export function createLiving(ctx) {
  const { scene } = ctx;
  const setpieces = createSetpieces(ctx);
  const living = {
    setpieces,
    bind(g) { setpieces.bind(g); },
    update(dt, t, playerPos, renderer) {
      setpieces.update(dt, t, playerPos, renderer);
    },
  };
  scene.userData.living = living; // main.js binds the game context to it
  return living;
}
