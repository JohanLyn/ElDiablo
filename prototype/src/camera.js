import * as THREE from 'three';
import { damp } from './util.js';

const PITCH = THREE.MathUtils.degToRad(55);
const ZOOMS = [24, 31, 18]; // distance steps, cycled with D-pad down / Z

// Diablo 4-style rig: fixed yaw, angled pitch, smooth follow with look-ahead,
// screen shake, and fading of anything that blocks the view of the hero.
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
    }
    this._ray = new THREE.Raycaster();
    this._shake = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  cycleZoom() { this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length; }

  snapTo(pos) {
    this.target.copy(pos);
    this.update(0, pos, new THREE.Vector3(), null, true);
  }

  update(dt, playerPos, playerVel, fx, instant = false) {
    this.distance += (ZOOMS[this.zoomIndex] - this.distance) * (instant ? 1 : damp(6, dt));
    this.lookAhead.lerp(this._dir.copy(playerVel).multiplyScalar(0.35), instant ? 1 : damp(3, dt));
    const goal = this._dir.copy(playerPos).add(this.lookAhead);
    this.target.lerp(goal, instant ? 1 : damp(7, dt));

    const offY = Math.sin(PITCH) * this.distance;
    const offZ = Math.cos(PITCH) * this.distance;
    this.camera.position.set(this.target.x, this.target.y + offY, this.target.z + offZ);
    if (fx) this.camera.position.add(fx.shakeOffset(this._shake));
    this.camera.lookAt(this.target.x, this.target.y + 0.5, this.target.z);

    // Fade occluders between the camera and the hero's chest.
    const chest = this._dir.set(playerPos.x, 1.2, playerPos.z);
    const toPlayer = chest.clone().sub(this.camera.position);
    const dist = toPlayer.length();
    this._ray.set(this.camera.position, toPlayer.normalize());
    this._ray.far = dist;
    const hits = new Set(this._ray.intersectObjects(this.occluders, false).map((h) => h.object));
    for (const o of this.occluders) {
      const want = hits.has(o) ? 0.22 : 1;
      o.userData.fade += (want - o.userData.fade) * (instant ? 1 : damp(10, dt));
      o.material.opacity = o.userData.fade;
      o.material.depthWrite = o.userData.fade > 0.95;
    }
  }
}
