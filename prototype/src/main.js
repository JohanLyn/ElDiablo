import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld } from './world.js';
import { Input } from './input.js';
import { Fx } from './fx.js';
import { Player } from './player.js';
import { Tether } from './tether.js';
import { EnemyManager } from './enemies.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const world = buildWorld(scene);
const input = new Input(canvas, camera);
const hud = new Hud();
const fx = new Fx(scene, camera, input, document.getElementById('numbers'));
const player = new Player(scene);
const tether = new Tether(scene);
const enemies = new EnemyManager(scene);
const rig = new CameraRig(camera, world.occluders);

// Shared game context handed to every system.
const g = {
  scene, camera, input, hud, fx, world, player, tether, enemies, rig,
  time: 0, kills: 0, paused: true, started: false,
  onPlayerDeath() {
    setTimeout(() => hud.setDeath(true, enemies.wave, g.kills), 900);
  },
};
window.__game = g; // handy for debugging in the console and for automated smoke tests

function restart() {
  player.reset();
  enemies.reset();
  tether.reset(player);
  g.kills = 0;
  hud.setDeath(false);
  rig.snapTo(player.pos);
}

function setPaused(p) {
  g.paused = p;
  hud.setHelp(p);
}

restart();
setPaused(true);
document.getElementById('help').addEventListener('click', () => { g.started = true; setPaused(false); });
document.getElementById('death').addEventListener('click', restart);

let last = performance.now();
function frame(now) {
  const realDt = Math.min(Math.max(0, now - last) / 1000, 1 / 20);
  last = now;
  input.update(player.pos);

  if (!g.started) {
    if (input.pressed.confirm || input.pressed.attack) { g.started = true; setPaused(false); }
  } else if (player.dead) {
    if (input.pressed.confirm && document.getElementById('death').classList.contains('show')) restart();
  } else if (input.pressed.pause) {
    setPaused(!g.paused);
  } else if (g.paused && input.pressed.confirm) {
    setPaused(false);
  }

  if (!g.paused) {
    if (input.pressed.zoom) rig.cycleZoom();
    // Hit-stop freezes the simulation briefly; effects and camera keep running.
    const dt = fx.hitstop > 0 ? 0 : realDt;
    g.time += dt;
    if (dt > 0) {
      player.update(dt, g);
      tether.update(dt, g);
      enemies.update(dt, g);
    }
    fx.update(realDt);
  }
  world.update(performance.now() / 1000);
  rig.update(realDt, player.pos, player.vel, fx);
  hud.update(g);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
