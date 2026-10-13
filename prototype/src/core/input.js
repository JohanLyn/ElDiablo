import * as THREE from 'three';
import { radialDeadzone } from './util.js';

// Standard Gamepad mapping (Xbox names): https://w3c.github.io/gamepad/#remapping
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15 };

// Diablo 4-style layout: skills on A X Y RB RT LT, evade B, potion LB.
const ACTIONS = {
  skill1: { pad: [PAD.A], keys: [], mouse: [0] },
  skill2: { pad: [PAD.X], keys: [], mouse: [2] },
  skill3: { pad: [PAD.Y], keys: ['Digit1'] },
  skill4: { pad: [PAD.RB], keys: ['Digit2'] },
  skill5: { pad: [PAD.RT], keys: ['Digit3'] },
  skill6: { pad: [PAD.LT], keys: ['Digit4'] },
  evade: { pad: [PAD.B], keys: ['Space'] },
  potion: { pad: [PAD.LB], keys: ['KeyQ'] },
  interact: { pad: [], keys: ['KeyE'] },
  aspectNext: { pad: [PAD.DRIGHT], keys: ['KeyR'] },
  aspectPrev: { pad: [PAD.DLEFT], keys: ['KeyF'] },
  portal: { pad: [PAD.DUP], keys: ['KeyT'] },
  zoom: { pad: [PAD.DDOWN], keys: ['KeyZ'] },
  map: { pad: [PAD.BACK], keys: ['KeyM', 'Tab'] },
  menu: { pad: [PAD.START], keys: ['KeyI', 'Escape'] },
  skillsMenu: { pad: [], keys: ['KeyK'] },
  questsMenu: { pad: [], keys: ['KeyJ', 'KeyL'] },
  // Menu actions
  confirm: { pad: [PAD.A], keys: ['Enter', 'Space'] },
  back: { pad: [PAD.B], keys: ['Escape', 'Backspace'] },
  alt: { pad: [PAD.X], keys: ['KeyX'] },
  alt2: { pad: [PAD.Y], keys: ['KeyY'] },
  tabPrev: { pad: [PAD.LB], keys: ['KeyQ'] },
  tabNext: { pad: [PAD.RB], keys: ['KeyE'] },
};

// Polls gamepad + keyboard/mouse once per frame into one action state.
export class Input {
  constructor(dom, camera) {
    this.dom = dom;
    this.camera = camera;
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.tappedKeys = new Set(); // presses shorter than a frame still count
    this.tappedMouse = new Set();
    this.mouseNdc = new THREE.Vector2();
    this.mouseGround = new THREE.Vector3();
    this.mouseMoved = false;
    this.wheel = 0;
    this.device = 'kbm';
    this.padIndex = null;
    this.move = { x: 0, z: 0, mag: 0 };
    this.aim = { x: 0, z: 0, mag: 0, active: false, mouse: false };
    this.down = {};
    this.pressed = {};
    this._prevDown = {};
    this.nav = { x: 0, y: 0 }; // repeating menu navigation pulses
    this._navHeld = { x: 0, y: 0, t: 0 };
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.tappedKeys.add(e.code);
      this.device = 'kbm';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    dom.addEventListener('mousemove', (e) => {
      const r = dom.getBoundingClientRect();
      this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.device = 'kbm';
      this.mouseMoved = true;
    });
    dom.addEventListener('mousedown', (e) => { this.mouseButtons.add(e.button); this.tappedMouse.add(e.button); this.device = 'kbm'; });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.device = 'pad'; });
    window.addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = null; this.device = 'kbm'; });
  }

  get gamepad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return null; }
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p) { this.padIndex = p.index; return p; }
    return null;
  }

  update(dt, playerPos) {
    const pad = this.gamepad;
    let padMove = { x: 0, y: 0, mag: 0 }, padAim = { x: 0, y: 0, mag: 0 };
    if (pad) {
      padMove = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.18);
      padAim = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.22);
      if (padMove.mag > 0 || padAim.mag > 0 || pad.buttons.some((b) => b.pressed)) this.device = 'pad';
    }

    let kx = 0, kz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz += 1;
    if (kx || kz) { const l = Math.hypot(kx, kz); this.move = { x: kx / l, z: kz / l, mag: 1 }; } else this.move = { x: padMove.x, z: padMove.y, mag: padMove.mag };

    // Ground point under the cursor (projected on the hero's height).
    this._raycaster.setFromCamera(this.mouseNdc, this.camera);
    this._plane.constant = -(playerPos?.y ?? 0);
    this._raycaster.ray.intersectPlane(this._plane, this.mouseGround);
    if (this.device === 'pad') {
      this.aim = { x: padAim.x, z: padAim.y, mag: padAim.mag, active: padAim.mag > 0, mouse: false };
    } else if (playerPos) {
      const dx = this.mouseGround.x - playerPos.x, dz = this.mouseGround.z - playerPos.z;
      this.aim = { x: dx, z: dz, mag: Math.hypot(dx, dz), active: this.mouseMoved, mouse: true };
    }

    for (const [name, map] of Object.entries(ACTIONS)) {
      let d = false;
      if (pad) for (const i of map.pad) d ||= !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5;
      for (const k of map.keys) d ||= this.keys.has(k) || this.tappedKeys.has(k);
      if (map.mouse) for (const m of map.mouse) d ||= this.mouseButtons.has(m) || this.tappedMouse.has(m);
      this.pressed[name] = d && !this._prevDown[name];
      this.down[name] = d;
      this._prevDown[name] = d;
    }
    this.pressed.zoomWheel = this.wheel !== 0;
    this.wheel = 0;

    // Menu navigation with key-repeat: D-pad, left stick, arrows or WASD.
    let nx = 0, ny = 0;
    if (pad) {
      if (pad.buttons[PAD.DLEFT]?.pressed || padMove.x < -0.5) nx = -1;
      if (pad.buttons[PAD.DRIGHT]?.pressed || padMove.x > 0.5) nx = 1;
      if (pad.buttons[PAD.DUP]?.pressed || padMove.y < -0.5) ny = -1;
      if (pad.buttons[PAD.DDOWN]?.pressed || padMove.y > 0.5) ny = 1;
    }
    if (kx) nx = kx;
    if (kz) ny = kz;
    const H = this._navHeld;
    this.nav = { x: 0, y: 0 };
    if (nx !== H.x || ny !== H.y) {
      H.x = nx; H.y = ny; H.t = 0;
      this.nav = { x: nx, y: ny };
    } else if (nx || ny) {
      H.t += dt;
      if (H.t > 0.38) { H.t -= 0.11; this.nav = { x: nx, y: ny }; }
    }
    this.tappedKeys.clear();
    this.tappedMouse.clear();
  }

  rumble(strong, weak, ms) {
    const pad = this.gamepad;
    if (!pad || this.device !== 'pad' || this.settings?.get('rumble') === false) return;
    pad.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {});
  }
}
