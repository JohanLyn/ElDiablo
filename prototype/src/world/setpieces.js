import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/common.js';
import { createFlames, createGlow } from './shaders/glow.js';
import { LANDMARKS } from './spots.js';
import { heightAt } from './terrain.js';
import { Rng } from '../core/rng.js';

// Hand-authored "set piece" effects layered over the landmarks:
//   - the First Gate storm: a brooding, rotating storm cell lit from inside, forked
//     lightning, thunder events and a violet pulse in the arch;
//   - the ziggurat beacons: summit fires with emitters and wind-drifting smoke.
// Everything is one instanced draw call per effect and allocation-free per frame.

// Shared with the gate's arch glow (landmarks.js): flash level and breathing phase.
export const STORM = { flash: { value: 0 } };
export const STORM_CENTER = new THREE.Vector3(0, 84, -204);

// The half-buried ziggurat is placed with this transform (landmarks.js builds it, we
// reuse it to find the summit in world space).
export const ZIG = { drop: 2.6, rot: [0.05, 0.25, -0.06], topY: 4 * 3.4 - 0.3 };
export const ZIG_BEACONS = [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]];
export function zigguratSummit() {
  const Z = LANDMARKS.ziggurat;
  const o = new THREE.Object3D();
  o.position.set(Z.x, heightAt(Z.x, Z.z) - ZIG.drop, Z.z);
  o.rotation.set(...ZIG.rot);
  o.updateMatrixWorld(true);
  const pts = ZIG_BEACONS.map(([x, z]) => o.localToWorld(new THREE.Vector3(x, ZIG.topY + 0.9, z)));
  const mid = o.localToWorld(new THREE.Vector3(0, ZIG.topY + 0.2, 0));
  return { beacons: pts, center: mid };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ storm
function buildCloudMesh(env, q) {
  const rng = new Rng(555);
  const puffs = [];
  const C = STORM_CENTER;
  const ring = (n, rMin, rMax, yMin, yMax, sMin, sMax, layer) => {
    for (let i = 0; i < n; i++) {
      const r = rMin + (rMax - rMin) * Math.sqrt(rng.next()), a = i * 2.4 + r * 0.045 + rng.float(-0.35, 0.35);
      puffs.push({
        x: C.x + Math.cos(a) * r, y: rng.float(yMin, yMax), z: C.z + Math.sin(a) * r * 0.9,
        s: rng.float(sMin, sMax), layer, spin: 0.012 + 0.028 * (1 - Math.min(1, r / 70)), seed: rng.next(), tint: rng.next(),
      });
    }
  };
  ring(Math.round(14 * q), 6, 62, 92, 108, 42, 74, 0); // dark crown
  ring(Math.round(26 * q), 8, 58, 62, 80, 30, 54, 1); // underside, lit from within
  ring(Math.round(10 * q), 4, 46, 3, 9, 16, 30, 2); // low mist rolling off the gate
  const n = puffs.length;
  const geo = new THREE.PlaneGeometry(1, 1);
  const seed = new Float32Array(n * 4);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uTime: env.uTime, uCenter: { value: new THREE.Vector3(C.x, 0, C.z) }, uStrike: { value: new THREE.Vector4(0, 60, -200, 0) },
      uInner: { value: 0.5 }, uFlash: STORM.flash, uNight: env.uNight,
    },
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCenter; uniform vec4 uStrike;
      attribute vec4 aSeed;
      varying vec2 vUv; varying vec4 vS; varying float vFlash;
      void main() {
        vUv = uv; vS = aSeed;
        vec3 org = vec3(instanceMatrix[3]);
        float size = length(vec3(instanceMatrix[0]));
        vec3 rel = org - uCenter;
        float ang = uTime * aSeed.z;
        float c = cos(ang), s = sin(ang);
        rel.xz = vec2(c * rel.x - s * rel.z, s * rel.x + c * rel.z);
        vec3 wp = uCenter + rel;
        wp.y += sin(uTime * 0.13 + aSeed.x * 40.0) * 1.8;
        vFlash = uStrike.w * clamp(1.0 - distance(wp, uStrike.xyz) / 110.0, 0.0, 1.0);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        float roll = aSeed.x * 6.283 + uTime * 0.01;
        float cr = cos(roll), sr = sin(roll);
        mv.xy += vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y) * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uInner, uFlash, uNight;
      varying vec2 vUv; varying vec4 vS; varying float vFlash;
      ${NOISE_GLSL}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float layer = vS.y;
        vec2 q = p * 1.5 + vS.x * 17.0 + vec2(uTime * 0.03, -uTime * 0.022);
        float n = fbm3(q);
        float a = smoothstep(0.2, 0.62, n * 0.95 + (1.0 - r) * 0.7 - 0.28);
        a *= smoothstep(1.0, 0.62, r);
        // shading: lighter on top, deep violet-black underneath
        float top = smoothstep(-0.9, 0.9, p.y + (n - 0.5) * 0.9);
        vec3 deep = vec3(0.012, 0.008, 0.028), lit = vec3(0.17, 0.12, 0.27);
        vec3 col = mix(deep, lit, top * (layer < 0.5 ? 0.9 : 0.55));
        // inner light: slow violet pockets that swell and fade
        float pocket = smoothstep(0.52, 0.92, fbm3(q * 1.7 + 7.0 + vec2(uTime * 0.11, uTime * 0.07)));
        float breathe = 0.65 + 0.35 * sin(uTime * 0.7 + vS.x * 30.0);
        col += vec3(0.75, 0.34, 1.3) * pocket * uInner * breathe * (1.0 - r * 0.5) * (layer < 1.5 ? 2.0 : 0.25);
        // lightning flash washes the nearest clouds in cold light
        col += vec3(0.55, 0.45, 1.0) * (vFlash * 0.75 + uFlash * 0.05) * (0.2 + (1.0 - top) * 0.8);
        float alpha = a * (layer < 1.5 ? 0.97 : 0.34);
        if (layer > 1.5) { col = mix(col, vec3(0.22, 0.16, 0.30), 0.55) + vec3(0.5, 0.25, 0.8) * pocket * uInner * 0.18; }
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  const d = new THREE.Object3D();
  puffs.forEach((p, i) => {
    d.position.set(p.x, p.y, p.z);
    d.scale.setScalar(p.s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    seed.set([p.seed, p.layer, p.spin, p.tint], i * 4);
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

const MAXSEG = 76;
function buildBolt() {
  const pos = new Float32Array(MAXSEG * 12), dir = new Float32Array(MAXSEG * 12), side = new Float32Array(MAXSEG * 4), wid = new Float32Array(MAXSEG * 4);
  const idx = new Uint16Array(MAXSEG * 6);
  for (let i = 0; i < MAXSEG; i++) {
    const v = i * 4;
    idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    side.set([-1, 1, -1, 1], v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aW', new THREE.BufferAttribute(wid, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, -200), 1e4);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uAlpha: { value: 0 }, uWidth: { value: 0.9 } },
    vertexShader: /* glsl */`
      attribute vec3 aDir; attribute float aSide; attribute float aW;
      uniform float uWidth;
      varying float vSide; varying float vW;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 t = mat3(modelViewMatrix) * aDir;
        vec2 t2 = t.xy;
        float l = length(t2);
        vec2 n = l > 1e-4 ? vec2(-t2.y, t2.x) / l : vec2(1.0, 0.0);
        mv.xy += n * aSide * uWidth * aW;
        gl_Position = projectionMatrix * mv;
        vSide = aSide; vW = aW;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha; varying float vSide; varying float vW;
      void main() {
        float s = abs(vSide);
        float core = smoothstep(0.42, 0.0, s);
        float halo = exp(-s * s * 3.0);
        vec3 col = vec3(0.55, 0.45, 1.0) * halo * 0.9 + vec3(1.0, 0.97, 1.0) * core * 2.4;
        gl_FragColor = vec4(col * uAlpha * (0.4 + vW * 0.6), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, pos, dir, wid, geo, mat, segs: 0 };
}

export function createStorm({ scene, env, lights, settings }) {
  const q = settings?.quality?.particles ?? 1;
  const clouds = buildCloudMesh(env, Math.max(0.5, q));
  scene.add(clouds);
  const bolt = buildBolt();
  scene.add(bolt.mesh);
  const light = lights.add({ x: 0, y: 30, z: -190, color: 0xb8a6ff, intensity: 0, range: 120, decay: 1.4, priority: 90 });
  const rng = new Rng(9001);
  const strike = clouds.material.uniforms.uStrike.value;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const state = {
    next: 3, age: 99, dist: 999, ctx: null, // ctx = game (events, fx), bound later
    tx: 0, tz: -190, pending: null, pendingT: 0, innerBase: 0.5,
  };

  // Fractal path from a to b: midpoint displacement, then a few branches.
  const buf = new Float32Array(64 * 3);
  function genPath(ax, ay, az, bx, by, bz, levels, jitter, out, start) {
    // out: Float32Array of points; start index (in points). returns point count.
    let n = 2;
    out[start * 3] = ax; out[start * 3 + 1] = ay; out[start * 3 + 2] = az;
    out[(start + 1) * 3] = bx; out[(start + 1) * 3 + 1] = by; out[(start + 1) * 3 + 2] = bz;
    for (let l = 0; l < levels; l++) {
      // expand in place from the back
      const m = n * 2 - 1;
      for (let i = n - 1; i >= 0; i--) {
        const dst = start + i * 2, src = start + i;
        out[dst * 3] = out[src * 3]; out[dst * 3 + 1] = out[src * 3 + 1]; out[dst * 3 + 2] = out[src * 3 + 2];
      }
      for (let i = 0; i < n - 1; i++) {
        const p = start + i * 2, r = start + i * 2 + 2, mid = p + 1;
        const dx = out[r * 3] - out[p * 3], dy = out[r * 3 + 1] - out[p * 3 + 1], dz = out[r * 3 + 2] - out[p * 3 + 2];
        const len = Math.hypot(dx, dy, dz) * jitter;
        out[mid * 3] = (out[p * 3] + out[r * 3]) / 2 + rng.float(-1, 1) * len;
        out[mid * 3 + 1] = (out[p * 3 + 1] + out[r * 3 + 1]) / 2 + rng.float(-0.3, 0.3) * len;
        out[mid * 3 + 2] = (out[p * 3 + 2] + out[r * 3 + 2]) / 2 + rng.float(-1, 1) * len;
      }
      n = m;
    }
    return n;
  }

  function writeSeg(i, x0, y0, z0, x1, y1, z1, w0, w1) {
    const v = i * 4, P = bolt.geo.attributes.position.array, D = bolt.geo.attributes.aDir.array, W = bolt.geo.attributes.aW.array;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    // Overlap the ends a touch so kinks don't open gaps.
    P.set([x0, y0, z0, x0, y0, z0, x1, y1, z1, x1, y1, z1], v * 3);
    for (let k = 0; k < 4; k++) { D[(v + k) * 3] = dx; D[(v + k) * 3 + 1] = dy; D[(v + k) * 3 + 2] = dz; }
    W[v] = W[v + 1] = w0; W[v + 2] = W[v + 3] = w1;
  }

  function fire(playerPos, g, renderer) {
    // Pick a target. Near the gate, strike where the hero can see it; otherwise hit the gate itself.
    const dHero = Math.hypot(playerPos.x - STORM_CENTER.x, playerPos.z - STORM_CENTER.z);
    let tx, tz, ty;
    const hot = dHero < 95 && playerPos.z < -120;
    if (hot && rng.chance(0.55)) {
      tx = playerPos.x + rng.float(-16, 16); tz = playerPos.z + rng.float(-20, -4); ty = heightAt(tx, tz);
    } else if (rng.chance(0.5)) {
      tx = rng.pick([-1, 1]) * rng.float(15, 23); tz = -199 + rng.float(-2, 2); ty = 60 + rng.float(0, 3.5); // horn tips
    } else {
      tx = rng.float(-28, 28); tz = rng.float(-196, -176); ty = heightAt(tx, tz);
    }
    const ox = tx + rng.float(-10, 10), oz = tz + rng.float(-10, -2), oy = Math.max(rng.float(92, 106), ty + 38);
    const levels = 5;
    const n = genPath(ox, oy, oz, tx, ty, tz, levels, 0.17, buf, 0);
    let seg = 0;
    const total = Math.min(n - 1, 32);
    for (let i = 0; i < total; i++) {
      writeSeg(seg++, buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2], buf[i * 3 + 3], buf[i * 3 + 4], buf[i * 3 + 5], 1, 1);
    }
    // Branches: from random points along the main path, drifting down and out.
    const nb = 2 + (rng.chance(0.6) ? 1 : 0);
    const tmp = new Float32Array(9 * 3);
    for (let b = 0; b < nb; b++) {
      const k = rng.int(4, Math.max(5, total - 8));
      const sx = buf[k * 3], sy = buf[k * 3 + 1], sz = buf[k * 3 + 2];
      const len = rng.float(10, 22), ang = rng.float(0, Math.PI * 2);
      const ex = sx + Math.cos(ang) * len, ez = sz + Math.sin(ang) * len, ey = sy - rng.float(8, 20);
      const m = genPath(sx, sy, sz, ex, Math.max(ey, ty), ez, 3, 0.2, tmp, 0);
      for (let i = 0; i < m - 1 && seg < MAXSEG; i++) writeSeg(seg++, tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2], tmp[i * 3 + 3], tmp[i * 3 + 4], tmp[i * 3 + 5], 0.42, 0.28);
    }
    bolt.geo.setDrawRange(0, seg * 6);
    bolt.geo.attributes.position.needsUpdate = true;
    bolt.geo.attributes.aDir.needsUpdate = true;
    bolt.geo.attributes.aW.needsUpdate = true;
    state.age = 0;
    state.tx = tx; state.tz = tz;
    strike.set(tx, Math.max(ty, 30), tz, 1);
    light.x = tx; light.z = tz + 16; light.y = Math.max(ty, 0) + 14;
    const dist = Math.hypot(playerPos.x - tx, playerPos.z - tz);
    state.dist = dist;
    if (g) {
      g.events.emit('thunder', { x: tx, z: tz, dist, delay: dist / 140 });
      if (dist < 70) g.fx?.burst?.(tmpA.set(tx, ty + 0.4, tz), 0xc8b8ff, 22, 9, { up: 5, life: 0.5, gravity: 14 });
    }
    if (renderer && dist < 55) renderer.pulse(0xb4a2ff, 0.07 + 0.1 * (1 - dist / 55));
  }

  return {
    clouds, bolt, light,
    freeze: false, // debug: hold the current flash frame (screenshots)
    bind(g) { state.ctx = g; },
    setAge(a) { state.age = a; },
    // Trigger a strike on demand (screenshots / tests).
    strikeNow(playerPos, renderer) { fire(playerPos, state.ctx, renderer); },
    update(dt, t, playerPos, renderer) {
      const dHero = Math.hypot(playerPos.x - STORM_CENTER.x, playerPos.z - STORM_CENTER.z);
      const active = dHero < 260;
      clouds.visible = active;
      bolt.mesh.visible = active && state.age < 0.9;
      if (this.freeze) dt = 0;
      state.next -= dt;
      if (state.next <= 0) {
        state.next = rng.float(dHero < 120 ? 4.5 : 8, dHero < 120 ? 11 : 20);
        if (active) fire(playerPos, state.ctx, renderer);
      }
      // Flash envelope: strike, quick echo, rumble.
      state.age += dt;
      const a = state.age;
      let f = Math.exp(-a * 11);
      if (a > 0.13) f = Math.max(f, 0.85 * Math.exp(-(a - 0.13) * 8));
      if (a > 0.3) f = Math.max(f, 0.45 * Math.exp(-(a - 0.3) * 4.5));
      f *= 0.8 + 0.2 * Math.sin(a * 90);
      if (a > 1.2) f = 0;
      STORM.flash.value = f;
      strike.w = f;
      bolt.mat.uniforms.uAlpha.value = a < 0.6 ? Math.max(0, f) * 1.3 : 0;
      light.intensity = f * 520;
      // Heat lightning: the cell glows from within, swelling every few seconds.
      clouds.material.uniforms.uInner.value = 0.42 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.0) + 0.22 * smooth(0.82, 1.0, Math.sin(t * 1.3) * 0.5 + Math.sin(t * 2.9) * 0.5);
    },
  };
}

// ------------------------------------------------------------------ smoke
function createSmoke(env, columns, perColumn) {
  const n = columns.length * perColumn;
  const geo = new THREE.PlaneGeometry(1, 1);
  const aP = new Float32Array(n * 4), aQ = new Float32Array(n * 4);
  const rng = new Rng(77);
  let i = 0;
  for (const c of columns) {
    for (let k = 0; k < perColumn; k++, i++) {
      aP.set([c.x + rng.float(-0.4, 0.4), c.y, c.z + rng.float(-0.4, 0.4), k / perColumn + rng.float(-0.02, 0.02)], i * 4);
      aQ.set([c.rate ?? 0.075, c.size ?? 3.2, rng.next(), rng.next()], i * 4);
    }
  }
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
  geo.setAttribute('aQ', new THREE.InstancedBufferAttribute(aQ, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: env.uTime, uWind: env.uWind, uNight: env.uNight, uDusk: env.uDusk },
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec2 uWind;
      attribute vec4 aP; attribute vec4 aQ;
      varying vec2 vUv; varying float vAge; varying float vSeed;
      void main() {
        vUv = uv; vSeed = aQ.w;
        float life = 1.0 / aQ.x;
        float age = fract(uTime * aQ.x + aP.w);
        float ts = age * life;
        vAge = age;
        vec3 wp = aP.xyz;
        wp.y += ts * 3.4 + ts * ts * 0.05;
        wp.xz += uWind * (ts * 1.0 + ts * ts * 0.1);
        wp.x += sin(ts * 0.55 + aQ.w * 20.0) * age * 2.2;
        wp.z += cos(ts * 0.47 + aQ.z * 20.0) * age * 2.2;
        float size = aQ.y * (0.35 + 2.1 * age);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        float roll = aQ.z * 6.283 + age * (aQ.w - 0.5) * 3.0;
        float c = cos(roll), s = sin(roll);
        mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight, uDusk;
      varying vec2 vUv; varying float vAge; varying float vSeed;
      ${NOISE_GLSL}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float n = fbm3(p * 1.6 + vSeed * 23.0 + vec2(0.0, vAge * 1.5));
        float body = pow(max(0.0, 1.0 - r * r), 1.3) * (0.5 + n * 0.9);
        float a = smoothstep(0.0, 0.9, body) * smoothstep(0.0, 0.1, vAge) * pow(1.0 - vAge, 1.25) * 0.5;
        vec3 smoke = mix(vec3(0.10, 0.085, 0.09), vec3(0.46, 0.42, 0.40), smoothstep(0.0, 0.7, vAge));
        smoke *= 1.0 - 0.55 * uNight;
        // lit from below by the fire, warm at dusk
        float fire = (1.0 - smoothstep(0.0, 0.24, vAge)) * (1.0 - r * 0.5);
        vec3 col = smoke + vec3(1.0, 0.45, 0.12) * fire * 0.9 + vec3(0.25, 0.12, 0.05) * uDusk * (1.0 - vAge) * 0.5;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const d = new THREE.Object3D();
  for (let k = 0; k < n; k++) mesh.setMatrixAt(k, d.matrix);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function createBeacons({ scene, env, lights, settings }) {
  const q = settings?.quality?.particles ?? 1;
  const { beacons, center } = zigguratSummit();
  const flames = beacons.map((p) => ({ x: p.x, y: p.y, z: p.z, s: 2.7 }));
  flames.push({ x: center.x, y: center.y + 0.4, z: center.z, s: 4.4 });
  scene.add(createFlames(flames, { intensity: 2.3 }));
  const halos = flames.map((f) => ({ x: f.x, y: f.y + 1.4, z: f.z, color: 0xff7a24, size: f.s * 2.5, flicker: 0.22 }));
  scene.add(createGlow(halos, { opacity: 0.55 }));
  const emitters = [
    lights.add({ x: center.x, y: center.y + 3.2, z: center.z, color: 0xff8a3a, intensity: 52, range: 44, decay: 1.5, flicker: 0.6, priority: 14 }),
    lights.add({ x: beacons[0].x, y: beacons[0].y + 1.5, z: beacons[0].z, color: 0xff7a2a, intensity: 18, range: 24, decay: 1.5, flicker: 0.7 }),
    lights.add({ x: beacons[3].x, y: beacons[3].y + 1.5, z: beacons[3].z, color: 0xff7a2a, intensity: 18, range: 24, decay: 1.5, flicker: 0.7 }),
  ];
  const per = Math.max(8, Math.round(26 * q));
  const cols = [
    { x: center.x, y: center.y + 1.0, z: center.z, size: 4.6, rate: 0.062 },
    { x: beacons[1].x, y: beacons[1].y + 0.6, z: beacons[1].z, size: 3.0, rate: 0.07 },
    { x: beacons[2].x, y: beacons[2].y + 0.6, z: beacons[2].z, size: 3.0, rate: 0.07 },
  ];
  const smoke = createSmoke(env, cols, per);
  scene.add(smoke);
  return { smoke, emitters, center, beacons };
}

// ------------------------------------------------------------------ all
export function createSetpieces(ctx) {
  const storm = createStorm(ctx);
  const beacons = createBeacons(ctx);
  return {
    storm, beacons,
    bind(g) { storm.bind(g); },
    update(dt, t, playerPos, renderer) {
      storm.update(dt, t, playerPos, renderer);
    },
  };
}

