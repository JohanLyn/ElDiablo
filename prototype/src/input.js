import * as THREE from 'three';
import { radialDeadzone } from './util.js';

// Standard Gamepad mapping (Xbox names): https://w3c.github.io/gamepad/#remapping
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15 };

// Every action the game reads. Each one maps to pad buttons and keyboard keys.
const ACTIONS = {
  attack: { pad: [PAD.A, PAD.RT], keys: ['KeyJ'], mouse: [0] },
  dodge: { pad: [PAD.B, PAD.LB], keys: ['Space', 'ShiftLeft'] },
  snap: { pad: [PAD.Y, PAD.X], keys: ['KeyF', 'KeyK'], mouse: [2] },
  modeNext: { pad: [PAD.RB, PAD.DRIGHT], keys: ['KeyE'] },
  modePrev: { pad: [PAD.DLEFT], keys: ['KeyQ'] },
  zoom: { pad: [PAD.DDOWN], keys: ['KeyZ'] },
  pause: { pad: [PAD.START, PAD.BACK], keys: ['Escape', 'KeyP', 'KeyH'] },
  confirm: { pad: [PAD.A, PAD.START], keys: ['Enter', 'Space'] },
};

// Polls gamepad + keyboard/mouse once per frame and exposes one unified state.
// Whichever device was touched last decides how the familiar is aimed.
export class Input {
  constructor(dom, camera) {
    this.camera = camera;
    this.keys = new Set();
    this.mouseButtons = new Set();
    // Taps shorter than a frame would be missed by polling, so remember
    // everything pressed since the last update.
    this.tappedKeys = new Set();
    this.tappedMouse = new Set();
    this.mouseNdc = new THREE.Vector2();
    this.mouseGround = new THREE.Vector3();
    this.mouseMovedAt = 0;
    this.device = 'kbm';
    this.padIndex = null;

    this.move = { x: 0, z: 0, mag: 0 };
    this.aim = { x: 0, z: 0, mag: 0, active: false, mouse: false };
    this.down = {};
    this.pressed = {};
    this._prevDown = {};

    this._raycaster = new THREE.Raycaster();
    this._ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
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
      this.mouseMovedAt = performance.now();
    });
    dom.addEventListener('mousedown', (e) => { this.mouseButtons.add(e.button); this.tappedMouse.add(e.button); this.device = 'kbm'; });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.device = 'pad'; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) this.padIndex = null;
      this.device = 'kbm';
    });
  }

  get gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p) { this.padIndex = p.index; return p; }
    return null;
  }

  update(playerPos) {
    const pad = this.gamepad;
    let padMove = { x: 0, y: 0, mag: 0 };
    let padAim = { x: 0, y: 0, mag: 0 };
    if (pad) {
      padMove = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.18);
      padAim = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.22);
      const anyButton = pad.buttons.some((b) => b.pressed);
      if (padMove.mag > 0 || padAim.mag > 0 || anyButton) this.device = 'pad';
    }

    // Movement. The camera has a fixed yaw, so stick-up maps straight to world -Z.
    let kx = 0, kz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz += 1;
    if (kx || kz) {
      const l = Math.hypot(kx, kz);
      this.move = { x: kx / l, z: kz / l, mag: 1 };
    } else {
      this.move = { x: padMove.x, z: padMove.y, mag: padMove.mag };
    }

    // Familiar aim: right stick on pad, cursor position on mouse.
    if (this.device === 'pad') {
      this.aim = { x: padAim.x, z: padAim.y, mag: padAim.mag, active: padAim.mag > 0, mouse: false };
    } else {
      this._raycaster.setFromCamera(this.mouseNdc, this.camera);
      if (this._raycaster.ray.intersectPlane(this._ground, this.mouseGround) && playerPos) {
        const dx = this.mouseGround.x - playerPos.x;
        const dz = this.mouseGround.z - playerPos.z;
        const mag = Math.hypot(dx, dz);
        this.aim = { x: dx, z: dz, mag, active: this.mouseMovedAt > 0, mouse: true };
      }
    }

    // Buttons with edge detection.
    for (const [name, map] of Object.entries(ACTIONS)) {
      let d = false;
      if (pad) for (const i of map.pad) d ||= !!pad.buttons[i]?.pressed;
      for (const k of map.keys) d ||= this.keys.has(k) || this.tappedKeys.has(k);
      if (map.mouse) for (const m of map.mouse) d ||= this.mouseButtons.has(m) || this.tappedMouse.has(m);
      this.pressed[name] = d && !this._prevDown[name];
      this.down[name] = d;
      this._prevDown[name] = d;
    }
    this.tappedKeys.clear();
    this.tappedMouse.clear();
  }

  rumble(strong, weak, ms) {
    const pad = this.gamepad;
    if (!pad || this.device !== 'pad') return;
    pad.vibrationActuator?.playEffect?.('dual-rumble', {
      duration: ms, strongMagnitude: strong, weakMagnitude: weak,
    }).catch(() => {});
  }
}
