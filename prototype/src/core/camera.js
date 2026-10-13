import * as THREE from 'three';
import { damp } from './util.js';

const PITCH = THREE.MathUtils.degToRad(56);
const ZOOMS = [28, 36, 20]; // distance steps, cycled with D-pad down / Z / wheel

// Diablo 4-style rig: fixed yaw, angled pitch, smooth follow with look-ahead,
// screen shake, and fading of buildings that block the view of the hero.
export class CameraRig {
  constructor(camera, occluders) {
    this.camera = camera;
    this.zoomIndex = 0;
    this.distance = ZOOMS[0];
    this.target = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.occluders = occluders;
    for (const o of occluders) {
      o.material = o.material.clone(); // own material so it can fade alone
      o.material.transparent = true;
      o.userData.fade = 1;
      o.userData.center = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    }
    this._ray = new THREE.Raycaster();
    this._shake = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  // Scripted camera (title flyover). fn(t) -> { pos: Vector3, look: Vector3 }
  setCinematic(fn) { this.cinematic = fn; this.cineTime = 0; }

  cycleZoom(dir = 1) { this.zoomIndex = (this.zoomIndex + dir + ZOOMS.length) % ZOOMS.length; }

  snapTo(pos) { this.update(0, pos, new THREE.Vector3(), null, true); }

  update(dt, playerPos, playerVel, fx, instant = false) {
    if (this.cinematic) {
      this.cineTime += dt;
      const shot = this.cinematic(this.cineTime);
      this.camera.position.copy(shot.pos);
      this.camera.lookAt(shot.look);
      return;
    }
    const k = (rate) => (instant ? 1 : damp(rate, dt));
    this.distance += (ZOOMS[this.zoomIndex] - this.distance) * k(6);
    this.lookAhead.lerp(this._tmp.copy(playerVel).setY(0).multiplyScalar(0.3), k(3));
    this.target.lerp(this._tmp.copy(playerPos).add(this.lookAhead), k(8));
    if (instant) this.target.copy(playerPos);

    this.camera.position.set(this.target.x, this.target.y + Math.sin(PITCH) * this.distance, this.target.z + Math.cos(PITCH) * this.distance);
    if (fx) this.camera.position.add(fx.shakeOffset(this._shake));
    this.camera.lookAt(this.target.x, this.target.y + 0.6, this.target.z);

    // Fade nearby occluders between the camera and the hero's chest.
    const near = this.occluders.filter((o) => Math.abs(o.userData.center.x - playerPos.x) < 20 && Math.abs(o.userData.center.z - playerPos.z) < 30);
    const chest = this._tmp.set(playerPos.x, playerPos.y + 1.2, playerPos.z);
    const toPlayer = chest.clone().sub(this.camera.position);
    const dist = toPlayer.length();
    this._ray.set(this.camera.position, toPlayer.normalize());
    this._ray.far = dist;
    const hits = new Set(near.length ? this._ray.intersectObjects(near, false).map((h) => h.object) : []);
    for (const o of near.length ? this.occluders : []) {
      const want = hits.has(o) ? 0.2 : 1;
      if (want === 1 && o.userData.fade === 1) continue;
      o.userData.fade += (want - o.userData.fade) * k(10);
      if (Math.abs(o.userData.fade - 1) < 0.01) o.userData.fade = 1;
      o.material.opacity = o.userData.fade;
      o.material.depthWrite = o.userData.fade > 0.95;
    }
  }
}
