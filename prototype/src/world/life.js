import * as THREE from 'three';
import { createSetpieces } from './setpieces.js';
import { updateTownGlow } from './townDressing.js';
import { NOISE_GLSL } from './shaders/common.js';
import { Rng } from '../core/rng.js';
import { heightAt, regionAt, isWater, WATER_LEVEL } from './terrain.js';

// The "living world": set pieces (storm, beacons) and ambient critters, all instanced
// and allocation-free per frame. world.js owns one instance (see the hook lines there).
//   - bird flocks: doves feed in the Sunfields and burst when the hero walks up, vultures
//     circle over the Dune Ruins, crows haunt the Ashen Approach (simple boids, one
//     InstancedMesh with GPU-flapped wings, plus soft ground shadows)
//   - Reed Marsh: jumping fish with splash rings, dragonflies (GPU points)
//   - dust devils drifting through the ruins
//   - wind gusts: a surge of env.uWind plus visible streaks racing over the grass
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let _radial = null;
function radialTexture() {
  if (_radial || typeof document === 'undefined') return _radial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _radial = new THREE.CanvasTexture(c);
  return _radial;
}

// ------------------------------------------------------------------ birds
// One bird, span 1 m: a body, and two swept wings whose y offset grows with aWing (0 root .. 1 tip).
function birdGeometry() {
  const P = [];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  const W = [];
  const wing = (a, b, c) => { W.push(Math.abs(a[0]) * 2, Math.abs(b[0]) * 2, Math.abs(c[0]) * 2); };
  const tris = [];
  const T = (a, b, c) => { tris.push([a, b, c]); };
  T([0, 0, 0.3], [-0.05, 0, -0.14], [0.05, 0, -0.14]); // body
  T([-0.05, 0, -0.14], [0.05, 0, -0.14], [0, 0, -0.3]); // tail
  for (const s of [-1, 1]) {
    const rf = [0.04 * s, 0, 0.13], rb = [0.04 * s, 0, -0.1], mf = [0.24 * s, 0, 0.08], mb = [0.24 * s, 0, -0.2], tip = [0.5 * s, 0, -0.16];
    T(rf, rb, mb); T(rf, mb, mf); T(mf, mb, tip);
  }
  for (const [a, b, c] of tris) { tri(a, b, c); wing(a, b, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  return g;
}

const FLIGHT_VS = /* glsl */`
  uniform float uTime; uniform vec3 uFogColor; uniform vec2 uFog; uniform float uLight;
  attribute float aWing; attribute vec4 aBird; attribute vec3 aCol;  // aBird: phase, flapRate, flapAmp, fold
  varying vec3 vCol; varying float vFog; varying float vTone;
  void main() {
    vec3 p = position;
    float fl = sin(uTime * aBird.y + aBird.x);
    float amp = aBird.z * (1.0 - aBird.w);
    p.y += fl * amp * aWing * aWing * 0.55 + (aBird.z > 0.0 ? 0.0 : 0.0);
    p.z += abs(fl) * amp * aWing * 0.08 - aWing * aWing * 0.1 * aBird.w;
    // folded (perched): wings pulled in and tilted up
    p.x *= 1.0 - aBird.w * 0.62;
    p.y += aBird.w * aWing * 0.1;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vFog = smoothstep(uFog.x, uFog.y, -mv.z);
    vCol = aCol * uLight;
    vTone = 0.78 + 0.22 * aWing + fl * 0.05 * aWing;
  }`;
const FLIGHT_FS = /* glsl */`
  uniform vec3 uFogColor;
  varying vec3 vCol; varying float vFog; varying float vTone;
  void main() { gl_FragColor = vec4(mix(vCol * vTone, uFogColor, vFog), 1.0); }`;

// Pale doves, dark vultures, black crows.
const KINDS = {
  dove: { span: 1.2, flap: [15, 19], amp: 0.8, speed: 7.5, color: [0.92, 0.89, 0.8], jitter: 0.12 },
  vulture: { span: 3.4, flap: [1.3, 1.8], amp: 0.28, speed: 5.2, color: [0.2, 0.15, 0.11], jitter: 0.12 },
  crow: { span: 1.5, flap: [9, 12], amp: 0.7, speed: 7.2, color: [0.07, 0.055, 0.1], jitter: 0.1 },
};

function pickSpots(rng, region, n, near, minSep, tries = 400) {
  const out = [];
  for (let i = 0; i < tries && out.length < n; i++) {
    const x = near.x + rng.float(-near.r, near.r), z = near.z + rng.float(-near.r, near.r);
    if (regionAt(x, z) !== region || isWater(x, z)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < minSep)) continue;
    out.push({ x, z });
  }
  return out;
}

// Population scale: `life` < 1 (Mobile) thins every creature count; otherwise the particle quality sets a floor of half.
const popScale = (q, life) => (life < 1 ? life : Math.max(0.5, q));

function createFlocks({ scene, env, tod, q, life = 1, rng }) {
  // [kind, count, spot, radius, altitude lo, hi, perch]
  const defs = [];
  // Doves feed on the ground in the Sunfields, bursting up when the hero comes near.
  for (const s of pickSpots(rng, 'sunfields', 3, { x: 0, z: 30, r: 90 }, 55)) defs.push({ kind: 'dove', n: 16, x: s.x, z: s.z, R: 15, alt: [5, 9], perch: true });
  for (const s of pickSpots(rng, 'sunfields', 1, { x: 40, z: 70, r: 40 }, 30)) defs.push({ kind: 'dove', n: 12, x: s.x, z: s.z, R: 18, alt: [6, 10], perch: false });
  // Vultures circle the broken lamassu and the ziggurat.
  defs.push({ kind: 'vulture', n: 5, x: 162, z: 14, R: 20, alt: [10, 15], perch: false });
  defs.push({ kind: 'vulture', n: 4, x: 110, z: -40, R: 13, alt: [9, 13], perch: false });
  // Crows over the Ashen Approach.
  defs.push({ kind: 'crow', n: 9, x: 4, z: -128, R: 15, alt: [5, 8], perch: false });
  defs.push({ kind: 'crow', n: 6, x: -14, z: -102, R: 11, alt: [5, 7.5], perch: false });

  let total = 0;
  const flocks = defs.map((d, fi) => {
    const k = KINDS[d.kind];
    const n = Math.max(life < 1 ? 3 : 4, Math.round(d.n * popScale(q, life)));
    const f = { ...d, k, n, base: total, theta: rng.float(0, TAU), dir: rng.chance(0.5) ? 1 : -1, state: d.perch ? 'perch' : 'fly', timer: 0, cool: 0, gy: 0, gyT: 0 };
    total += n;
    f.pos = new Float32Array(n * 3); f.vel = new Float32Array(n * 3); f.rest = new Float32Array(n * 3);
    f.yaw = new Float32Array(n); f.bank = new Float32Array(n); f.fold = new Float32Array(n); f.off = new Float32Array(n * 4);
    f.landed = new Uint8Array(n);
    f.gy = heightAt(d.x, d.z);
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), r = Math.sqrt(rng.next()) * (d.perch ? 5.5 : 2);
      const rx = d.x + Math.cos(a) * r, rz = d.z + Math.sin(a) * r;
      f.rest.set([rx, heightAt(rx, rz) + 0.12, rz], i * 3);
      f.off.set([rng.float(-0.45, 0.45), rng.float(0.8, 1.2), rng.float(0, 1), rng.float(-1, 1)], i * 4);
      if (d.perch) { f.pos.set([rx, heightAt(rx, rz) + 0.12, rz], i * 3); f.fold[i] = 1; f.landed[i] = 1; f.yaw[i] = rng.float(0, TAU); }
      else {
        const th = f.theta + f.off[i * 4];
        f.pos.set([d.x + Math.cos(th) * d.R, rng.float(d.alt[0], d.alt[1]), d.z + Math.sin(th) * d.R], i * 3);
        f.vel.set([-Math.sin(th) * f.dir * k.speed, 0, Math.cos(th) * f.dir * k.speed], i * 3);
      }
    }
    return f;
  });

  const geo = birdGeometry();
  const aBird = new Float32Array(total * 4), aCol = new Float32Array(total * 3);
  flocks.forEach((f) => {
    for (let i = 0; i < f.n; i++) {
      const b = (f.base + i) * 4;
      aBird.set([rng.float(0, TAU), rng.float(f.k.flap[0], f.k.flap[1]), f.k.amp, f.fold[i]], b);
      const j = 1 + rng.float(-f.k.jitter, f.k.jitter);
      aCol.set([f.k.color[0] * j, f.k.color[1] * j, f.k.color[2] * j], (f.base + i) * 3);
    }
  });
  const attrBird = new THREE.InstancedBufferAttribute(aBird, 4);
  attrBird.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBird', attrBird);
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
  const fogColor = scene.fog?.color ?? new THREE.Color(0xaaaaaa);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: env.uTime, uFogColor: { value: fogColor }, uFog: { value: new THREE.Vector2(40, 130) }, uLight: { value: 1 } },
    vertexShader: FLIGHT_VS, fragmentShader: FLIGHT_FS,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  // Soft blob shadows on the ground under every bird.
  const sMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sGeo = new THREE.PlaneGeometry(1, 1);
  sGeo.rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(sGeo, sMat, total);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  scene.add(shadows);

  const d = new THREE.Object3D();
  d.rotation.order = 'YXZ';
  const _sun = tod?.sunDir ?? new THREE.Vector3(-0.4, 0.8, 0.3);
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);

  function update(dt, t, hero, ctx) {
    mat.uniforms.uFog.value.set(ctx.fogNear, ctx.fogFar);
    mat.uniforms.uLight.value = 0.55 + 0.45 * (1 - tod.night);
    let dirty = false;
    for (const f of flocks) {
      const k = f.k;
      const dh = Math.hypot(hero.x - f.x, hero.z - f.z);
      if (dh > 170) { // far away: keep them parked, skip the work
        for (let i = 0; i < f.n; i++) { mesh.setMatrixAt(f.base + i, hide); shadows.setMatrixAt(f.base + i, hide); }
        dirty = true; continue;
      }
      f.gyT -= dt;
      if (f.gyT <= 0) { f.gyT = 1.2; f.gy = heightAt(f.x, f.z); }
      f.theta += (k.speed * 0.85 / f.R) * f.dir * dt;
      f.timer += dt; f.cool -= dt;
      // State machine: perched doves burst when approached, wheel for a while, then land again.
      if (f.state === 'perch') {
        if (dh < f.R * 0.8) {
          let near = false;
          for (let i = 0; i < f.n; i++) if (Math.hypot(f.pos[i * 3] - hero.x, f.pos[i * 3 + 2] - hero.z) < 8.5) { near = true; break; }
          if (near) { f.state = 'scatter'; f.timer = 0; f.landed.fill(0); ctx.onBurst?.(f); }
        }
      } else if (f.state === 'scatter') {
        if (f.timer > 3.2) { f.state = 'fly'; f.timer = 0; f.cool = 6; }
      } else if (f.state === 'fly') {
        if (f.cool <= 0 && dh < f.R + 10) {
          let near = false;
          for (let i = 0; i < f.n; i++) if (Math.hypot(f.pos[i * 3] - hero.x, f.pos[i * 3 + 2] - hero.z) < 11) { near = true; break; }
          if (near) { f.state = 'scatter'; f.timer = 0; }
        }
        if (f.perch && f.timer > 32 && dh > 28) { f.state = 'land'; f.timer = 0; }
      } else if (f.state === 'land') {
        if (dh < 14) { f.state = 'fly'; f.timer = 0; f.cool = 5; }
        else {
          let all = true;
          for (let i = 0; i < f.n; i++) if (!f.landed[i]) { all = false; break; }
          if (all || f.timer > 25) f.state = 'perch';
        }
      }
      const flying = f.state !== 'perch';
      for (let i = 0; i < f.n; i++) {
        const o = i * 3, id = f.base + i;
        let px = f.pos[o], py = f.pos[o + 1], pz = f.pos[o + 2];
        let vx = f.vel[o], vy = f.vel[o + 1], vz = f.vel[o + 2];
        const ang = f.off[i * 4];
        if (f.state === 'perch') {
          // peck and shuffle
          f.fold[i] = 1;
          if (f.off[i * 4 + 2] > 0.995) f.off[i * 4 + 2] = 0;
          py = f.rest[o + 1] + Math.max(0, Math.sin(t * 3 + f.off[i * 4 + 3] * 40)) * 0.05;
          f.pos[o + 1] = py;
          vx = vy = vz = 0;
        } else {
          const speed = k.speed * f.off[i * 4 + 1];
          let tx, ty, tz, rate = 1.8, sp = speed;
          if (f.state === 'scatter') {
            // away from the hero, fanned out, climbing
            let ax = px - hero.x, az = pz - hero.z;
            const l = Math.hypot(ax, az) || 1;
            const rot = ang * 2.2;
            const cx = Math.cos(rot), sx = Math.sin(rot);
            ax /= l; az /= l;
            tx = px + (ax * cx - az * sx) * 30; tz = pz + (ax * sx + az * cx) * 30;
            ty = py + 14 + f.off[i * 4 + 2] * 6; rate = 3.2; sp = speed * 1.5;
            f.fold[i] = Math.max(0, f.fold[i] - dt * 5);
          } else if (f.state === 'land') {
            tx = f.rest[o]; tz = f.rest[o + 2];
            const dx = tx - px, dz = tz - pz, dd = Math.hypot(dx, dz);
            ty = dd < 8 ? f.rest[o + 1] : Math.max(f.rest[o + 1] + 3, py - 1);
            sp = Math.min(speed, 1.5 + dd * 0.9);
            if (dd < 0.7 && py < f.rest[o + 1] + 0.5) { f.landed[i] = 1; f.fold[i] = Math.min(1, f.fold[i] + dt * 4); }
            else f.fold[i] = Math.max(0, f.fold[i] - dt * 4);
          } else {
            const th = f.theta + ang;
            const rr = f.R * (0.82 + 0.36 * f.off[i * 4 + 2]);
            tx = f.x + Math.cos(th) * rr; tz = f.z + Math.sin(th) * rr;
            ty = f.gy + f.alt[0] + (f.alt[1] - f.alt[0]) * (0.5 + 0.5 * Math.sin(t * 0.21 + f.off[i * 4 + 3] * 9));
            f.fold[i] = Math.max(0, f.fold[i] - dt * 5);
          }
          let dx = tx - px, dy = ty - py, dz = tz - pz;
          const dl = Math.hypot(dx, dy * 0.6, dz) || 1;
          let wx = (dx / dl) * sp, wy = clamp((dy / dl) * sp, -3.2, 5.5), wz = (dz / dl) * sp;
          // separation from near neighbours
          for (let j = 0; j < f.n; j += 1) {
            if (j === i) continue;
            const qx = px - f.pos[j * 3], qy = py - f.pos[j * 3 + 1], qz = pz - f.pos[j * 3 + 2];
            const q2 = qx * qx + qy * qy + qz * qz;
            if (q2 < 5 && q2 > 1e-4) { const iv = 1.6 / q2; wx += qx * iv; wy += qy * iv * 0.4; wz += qz * iv; }
          }
          const r2 = 1 - Math.exp(-rate * dt);
          vx += (wx - vx) * r2; vy += (wy - vy) * r2; vz += (wz - vz) * r2;
          px += vx * dt; py += vy * dt; pz += vz * dt;
          if (f.state !== 'land' || f.landed[i] === 0) { /* free flight */ }
          if (f.state === 'land' && f.landed[i]) { px += (f.rest[o] - px) * 0.2; pz += (f.rest[o + 2] - pz) * 0.2; py = f.rest[o + 1]; vx = vy = vz = 0; }
          f.pos[o] = px; f.pos[o + 1] = py; f.pos[o + 2] = pz;
          f.vel[o] = vx; f.vel[o + 1] = vy; f.vel[o + 2] = vz;
        }
        // orientation: heading from velocity, pitch from climb, bank from turn rate
        const sp2 = Math.hypot(vx, vz);
        if (sp2 > 0.4) {
          const yaw = Math.atan2(vx, vz);
          let dyaw = yaw - f.yaw[i];
          dyaw -= Math.round(dyaw / TAU) * TAU;
          f.yaw[i] += dyaw * Math.min(1, dt * 7);
          f.bank[i] += (clamp(-dyaw / Math.max(dt, 1e-3) * 0.16, -0.8, 0.8) - f.bank[i]) * Math.min(1, dt * 5);
        } else f.bank[i] *= 0.9;
        const pitch = sp2 > 0.4 ? Math.atan2(vy, sp2) * 0.8 : 0;
        d.position.set(px, py, pz);
        d.rotation.set(-pitch, f.yaw[i], f.bank[i]);
        d.scale.setScalar(k.span);
        d.updateMatrix();
        mesh.setMatrixAt(id, d.matrix);
        aBird[id * 4 + 3] = f.fold[i];
        // ground shadow, thrown along the sun's direction
        const h = Math.max(0, py - f.gy);
        const gx = px - (_sun.x / Math.max(0.25, _sun.y)) * h, gz = pz - (_sun.z / Math.max(0.25, _sun.y)) * h;
        const alpha = clamp(1 - h / 60, 0.2, 1);
        d.position.set(gx, f.gy + 0.35, gz);
        d.rotation.set(0, f.yaw[i], 0);
        d.scale.set(k.span * 0.9 * alpha, 1, k.span * 0.65 * alpha);
        d.updateMatrix();
        shadows.setMatrixAt(id, d.matrix);
      }
      void flying;
      dirty = true;
    }
    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;
      attrBird.needsUpdate = true;
    }
  }
  return { flocks, mesh, shadows, update };
}

// ------------------------------------------------------------ marsh life
function createMarsh({ scene, env, q, life = 1, rng }) {
  // Dragonflies: GPU points tiled around the hero, hovering and darting.
  const nd = Math.round(46 * popScale(q, life));
  const pos = new Float32Array(nd * 3), seed = new Float32Array(nd * 4);
  for (let i = 0; i < nd; i++) seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
  const gd = new THREE.BufferGeometry();
  gd.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gd.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  gd.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const dMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: env.uTime, uPx: env.uPxScale, uHero: { value: new THREE.Vector3() }, uMix: { value: 0 }, uWater: { value: WATER_LEVEL } },
    vertexShader: /* glsl */`
      uniform float uTime, uPx, uMix, uWater; uniform vec3 uHero;
      attribute vec4 aSeed; varying vec4 vS; varying float vFade;
      void main() {
        const float BOX = 46.0;
        vec2 c = (fract((aSeed.xy * BOX - uHero.xz) / BOX) - 0.5) * BOX;
        vec3 p = vec3(uHero.x + c.x, uWater + 0.6 + aSeed.z * 1.5, uHero.z + c.y);
        float t = uTime + aSeed.w * 50.0;
        float dart = pow(abs(sin(t * 0.45 + aSeed.z * 20.0)), 7.0);
        p += vec3(sin(t * 0.8) * 1.4 + sin(t * 2.3 + aSeed.x * 9.0) * 0.3 + sin(t * 2.0 + aSeed.y * 30.0) * dart * 3.0,
                  sin(t * 1.5) * 0.25, cos(t * 0.65 + aSeed.y * 6.0) * 1.4 + cos(t * 2.1 + aSeed.x * 9.0) * 0.3 + cos(t * 2.0 + aSeed.x * 30.0) * dart * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(1.5 * uPx / -mv.z, 4.0, 72.0);
        vS = aSeed;
        float edge = 1.0 - smoothstep(18.0, 23.0, length(c));
        vFade = uMix * edge;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec4 vS; varying float vFade;
      float ell(vec2 p, vec2 c, vec2 r, float rot) {
        float cs = cos(rot), sn = sin(rot);
        vec2 q = p - c; q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / r;
        return smoothstep(1.0, 0.3, length(q));
      }
      void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float a = vS.x * 6.283 + uTime * 0.25 * (vS.w - 0.5);
        float ca = cos(a), sa = sin(a);
        p = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
        float body = smoothstep(0.1, 0.03, abs(p.x)) * smoothstep(0.62, 0.5, abs(p.y + 0.04)) + smoothstep(0.15, 0.05, length(p - vec2(0.0, 0.52)));
        float beat = 0.5 + 0.5 * sin(uTime * 55.0 + vS.x * 40.0);
        float w = 0.0;
        for (int i = 0; i < 2; i++) {
          float s = i == 0 ? 1.0 : -1.0;
          w += ell(p, vec2(s * 0.42, 0.2), vec2(0.4, 0.11), s * 0.28) * (0.4 + 0.5 * beat);
          w += ell(p, vec2(s * 0.38, -0.02), vec2(0.36, 0.1), -s * 0.2) * (0.4 + 0.5 * (1.0 - beat));
        }
        vec3 col = vec3(0.25, 1.0, 0.8) * body * 1.5 + vec3(0.7, 0.92, 1.0) * w * 0.5;
        gl_FragColor = vec4(col * vFade, 1.0);
      }`,
  });
  const dragonflies = new THREE.Points(gd, dMat);
  dragonflies.frustumCulled = false;
  dragonflies.renderOrder = 4;
  scene.add(dragonflies);

  // Fish: silver arcs out of the water, with splash rings.
  const NF = 3, NR = 10;
  const fishGeo = new THREE.SphereGeometry(0.5, 7, 5);
  fishGeo.scale(0.1, 0.12, 0.55);
  const tail = new THREE.ConeGeometry(0.16, 0.3, 4);
  tail.rotateX(-Math.PI / 2); tail.translate(0, 0, -0.52); tail.scale(0.3, 1, 1);
  const fp = [fishGeo.toNonIndexed(), tail.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; });
  const fcol = [[0.72, 0.8, 0.86], [0.55, 0.62, 0.7]];
  fp.forEach((g, gi) => { const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = fcol[gi][0]; c[i + 1] = fcol[gi][1]; c[i + 2] = fcol[gi][2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); });
  const fishMerged = mergeSimple(fp);
  const fishMesh = new THREE.InstancedMesh(fishMerged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.5, emissive: 0x1a2a38, emissiveIntensity: 0.6 }), NF);
  fishMesh.frustumCulled = false;
  fishMesh.count = 0;
  fishMesh.visible = false;
  scene.add(fishMesh);

  const ringGeo = new THREE.PlaneGeometry(1, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const aAge = new Float32Array(NR);
  const ringAttr = new THREE.InstancedBufferAttribute(aAge, 1);
  ringAttr.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('aAge', ringAttr);
  const ringMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */`
      attribute float aAge; varying vec2 vUv; varying float vAge;
      void main() {
        vUv = uv; vAge = aAge;
        float s = 0.5 + aAge * 2.6;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * s, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vAge;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.12, 0.0, abs(r - (0.55 + vAge * 0.35))) ;
        float a = ring * pow(max(0.0, 1.0 - vAge), 1.6) * step(vAge, 0.999);
        gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * a * 0.9, 1.0);
      }`,
  });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, NR);
  rings.frustumCulled = false;
  rings.renderOrder = 4;
  rings.visible = false;
  scene.add(rings);

  const jumps = [];
  for (let i = 0; i < NF; i++) jumps.push({ t: -1, dur: 0.8, x0: 0, z0: 0, dx: 0, dz: 0, h: 1, landed: false });
  const ringT = new Float32Array(NR).fill(-1); // age seconds, -1 = free
  const ringPos = new Float32Array(NR * 2);
  const RING_LIFE = 1.5;
  const d = new THREE.Object3D();
  d.rotation.order = 'YXZ';
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < NR; i++) rings.setMatrixAt(i, hide);
  let next = 1.5;
  const spot = { x: 0, y: 0, z: 0 };

  const addRing = (x, z, delay = 0) => {
    for (let i = 0; i < NR; i++) if (ringT[i] < 0) { ringT[i] = -delay * 0; ringPos[i * 2] = x; ringPos[i * 2 + 1] = z; ringT[i] = 0; return; }
  };

  return {
    dragonflies, fishMesh, rings,
    jumpNow() { next = 0; }, // debug: spawn a jump on the next tick
    update(dt, t, hero, region, ctx) {
      const inMarsh = region === 'marsh';
      dMat.uniforms.uHero.value.copy(hero);
      const m = dMat.uniforms.uMix;
      m.value += ((inMarsh ? 1 : 0) - m.value) * Math.min(1, dt * 1.2);
      dragonflies.visible = m.value > 0.02;
      // spawn a jump
      next -= dt;
      if (inMarsh && next <= 0) {
        next = rng.float(1.1, 3.0);
        const j = jumps.find((x) => x.t < 0);
        if (j) {
          for (let tries = 0; tries < 24; tries++) {
            const a = rng.float(0, TAU), r = rng.float(5, 24);
            const x = hero.x + Math.cos(a) * r, z = hero.z + Math.sin(a) * r;
            if (!isWater(x, z) || !isWater(x + Math.cos(a) * 1.8, z + Math.sin(a) * 1.8)) continue;
            const h = rng.float(0, TAU);
            j.t = 0; j.dur = rng.float(0.62, 0.85); j.x0 = x; j.z0 = z; j.dx = Math.cos(h) * rng.float(1.3, 2.2); j.dz = Math.sin(h) * rng.float(1.3, 2.2); j.h = rng.float(0.9, 1.5); j.landed = false;
            addRing(x, z);
            spot.x = x; spot.y = WATER_LEVEL + 0.1; spot.z = z;
            ctx.fx?.burst?.(spot, 0xcfeaff, 7, 2.6, { up: 2.6, life: 0.45, gravity: 9 });
            break;
          }
        }
      }
      let nf = 0;
      for (const j of jumps) {
        if (j.t < 0) continue;
        j.t += dt;
        const u = j.t / j.dur;
        if (u >= 1) {
          j.t = -1;
          addRing(j.x0 + j.dx, j.z0 + j.dz);
          spot.x = j.x0 + j.dx; spot.y = WATER_LEVEL + 0.1; spot.z = j.z0 + j.dz;
          ctx.fx?.burst?.(spot, 0xcfeaff, 6, 2.2, { up: 2.2, life: 0.4, gravity: 9 });
          continue;
        }
        const y = WATER_LEVEL + 4 * j.h * u * (1 - u) + 0.05;
        d.position.set(j.x0 + j.dx * u, y, j.z0 + j.dz * u);
        const vy = 4 * j.h * (1 - 2 * u), hs = Math.hypot(j.dx, j.dz) / j.dur;
        d.rotation.set(-Math.atan2(vy, hs), Math.atan2(j.dx, j.dz), Math.sin(u * 40) * 0.25);
        d.scale.setScalar(1.35);
        d.updateMatrix();
        fishMesh.setMatrixAt(nf++, d.matrix);
      }
      fishMesh.count = nf;
      fishMesh.visible = nf > 0;
      fishMesh.instanceMatrix.needsUpdate = true;
      let any = false;
      for (let i = 0; i < NR; i++) {
        if (ringT[i] < 0) { aAge[i] = 1; continue; }
        ringT[i] += dt;
        if (ringT[i] >= RING_LIFE) { ringT[i] = -1; rings.setMatrixAt(i, hide); aAge[i] = 1; continue; }
        any = true;
        aAge[i] = ringT[i] / RING_LIFE;
        d.position.set(ringPos[i * 2], WATER_LEVEL + 0.04, ringPos[i * 2 + 1]);
        d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix();
        rings.setMatrixAt(i, d.matrix);
      }
      rings.visible = any;
      if (any) { rings.instanceMatrix.needsUpdate = true; ringAttr.needsUpdate = true; }
    },
  };
}

function mergeSimple(geos) {
  // tiny merge for two non-indexed geometries with position/normal/color
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ------------------------------------------------------------ dust devils
function createDevils({ scene, env, q, life = 1, rng }) {
  const ND = 3, PER = Math.round(64 * popScale(q, life));
  const n = ND * PER;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) rnd.set([Math.floor(i / PER), rng.next(), rng.next(), rng.next()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aR', new THREE.BufferAttribute(rnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const dev = Array.from({ length: ND }, () => ({ pos: new THREE.Vector4(0, 0, 0, 0), vx: 0, vz: 0, age: 0, life: 0, seed: 0 }));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: env.uTime, uPx: env.uPxScale, uDev: { value: dev.map((d) => d.pos) }, uSun: { value: new THREE.Color(0.86, 0.7, 0.48) }, uNight: env.uNight },
    vertexShader: /* glsl */`
      uniform float uTime, uPx; uniform vec4 uDev[${ND}];
      attribute vec4 aR; varying float vA; varying float vH;
      void main() {
        vec4 d = uDev[int(aR.x + 0.5)];     // x, z, groundY, strength
        float H = 9.0;
        float h = fract(aR.y + uTime * (0.09 + aR.z * 0.06)) ;
        float hh = h * H;
        float ang = aR.w * 6.283 + uTime * (3.2 - h * 1.6) * (0.8 + aR.z * 0.4);
        float rad = 0.35 + h * 2.6 * (0.6 + aR.z * 0.6) + 0.15 * sin(uTime * 2.0 + aR.y * 30.0);
        vec3 p = vec3(d.x + cos(ang) * rad + sin(uTime * 0.4 + h * 3.0) * h * 0.8, d.z + 0.2 + hh, d.y + sin(ang) * rad);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((1.1 + h * 2.4) * uPx / -mv.z, 2.0, 96.0);
        vA = d.w * smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.78, 1.0, h)) * 0.55;
        vH = h;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uNight; varying float vA; varying float vH;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, r) * vA;
        if (a < 0.003) discard;
        vec3 col = uSun * (1.0 - 0.6 * uNight) * (0.8 + vH * 0.3);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  scene.add(points);
  let spawnT = 2;
  return {
    points, dev,
    update(dt, hero, region, wind) {
      const inRuins = region === 'ruins';
      let anyAlive = false;
      spawnT -= dt;
      for (const d of dev) {
        if (d.life <= 0) {
          if (inRuins && spawnT <= 0) {
            const a = rng.float(0, TAU), r = rng.float(18, 46);
            d.pos.x = hero.x + Math.cos(a) * r; d.pos.y = hero.z + Math.sin(a) * r;
            if (regionAt(d.pos.x, d.pos.y) !== 'ruins') continue;
            d.pos.z = heightAt(d.pos.x, d.pos.y);
            d.life = rng.float(22, 40); d.age = 0; d.seed = rng.float(0, 50);
            d.vx = rng.float(-1, 1); d.vz = rng.float(-1, 1);
            spawnT = rng.float(3, 7);
          }
          d.pos.w = 0;
          continue;
        }
        anyAlive = true;
        d.age += dt;
        // drift with the wind plus a lazy wander, sticking to the ground
        const wob = Math.sin(d.age * 0.35 + d.seed) * 1.1, wob2 = Math.cos(d.age * 0.29 + d.seed * 1.7) * 1.1;
        d.pos.x += (wind.x * 2.4 + wob) * dt; d.pos.y += (wind.y * 2.4 + wob2) * dt;
        d.pos.z += (heightAt(d.pos.x, d.pos.y) - d.pos.z) * Math.min(1, dt * 3);
        const fade = Math.min(1, d.age / 3, (d.life - d.age) / 4);
        d.pos.w = Math.max(0, fade);
        if (d.age >= d.life || Math.hypot(d.pos.x - hero.x, d.pos.y - hero.z) > 90) d.life = 0;
      }
      points.visible = anyAlive;
    },
  };
}

// ------------------------------------------------------------ wind gusts
// A gust is a surge of env.uWind (the grass and reeds bend harder) with a visible front of
// streaks racing across the field in the wind direction.
function createGusts({ scene, env, q, life = 1, rng }) {
  const n = Math.round(120 * popScale(q, life));
  const pos = new Float32Array(n * 3), a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([rng.float(-46, 46), rng.float(-16, 16), rng.float(0.5, 2.6), rng.float(2.5, 6.5)], i * 4);
  const geo = new THREE.BufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(a, 4)); // across, along, height, length
  void pos;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uHero: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector2(1, 0) }, uFront: { value: -999 }, uAmp: { value: 0 }, uTime: env.uTime, uNight: env.uNight },
    vertexShader: /* glsl */`
      uniform vec3 uHero; uniform vec2 uDir; uniform float uFront, uAmp, uTime;
      attribute vec4 aR; varying vec2 vUv; varying float vA;
      void main() {
        vUv = uv;
        vec2 perp = vec2(-uDir.y, uDir.x);
        float along = uFront + aR.y;
        vec3 p = vec3(uHero.x, uHero.y + aR.z * 0.6, uHero.z);
        p.xz += uDir * along + perp * aR.x;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vec2 dv = (viewMatrix * vec4(uDir.x, 0.0, uDir.y, 0.0)).xy;
        float dl = length(dv); dv = dl > 1e-3 ? dv / dl : vec2(1.0, 0.0);
        vec2 pv = vec2(-dv.y, dv.x);
        mv.xy += dv * position.x * aR.w + pv * position.y * 0.06;
        gl_Position = projectionMatrix * mv;
        float front = exp(-pow((aR.y) / 9.0, 2.0));
        vA = uAmp * front * (0.6 + 0.4 * sin(uTime * 6.0 + aR.x));
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight; varying vec2 vUv; varying float vA;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0, y = abs(vUv.y - 0.5) * 2.0;
        float a = (1.0 - x * x) * (1.0 - y) * vA * smoothstep(0.0, 0.25, 1.0 - x);
        vec3 col = vec3(1.0, 0.95, 0.8) * (1.0 - 0.7 * uNight);
        gl_FragColor = vec4(col * a * 0.55, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const dm = new THREE.Object3D();
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, dm.matrix);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  scene.add(mesh);
  const st = { next: rng.float(6, 14), t: -1, dur: 4.2, dir: new THREE.Vector2(1, 0), amp: 0 };
  const baseWind = new THREE.Vector2();
  return {
    mesh, st,
    start() { st.t = 0; },
    // hero: position; wind: env.uWind.value (already set for this frame - we scale it)
    update(dt, hero, region, wind) {
      st.next -= dt;
      const grassy = region === 'sunfields' || region === 'marsh' || region === 'town';
      if (st.next <= 0 && st.t < 0) {
        st.next = rng.float(14, 30);
        if (grassy) st.t = 0;
      }
      if (st.t < 0) { mesh.visible = false; return 0; }
      st.t += dt;
      const u = st.t / st.dur;
      if (u >= 1) { st.t = -1; mesh.visible = false; return 0; }
      baseWind.copy(wind);
      const wl = baseWind.length() || 1;
      st.dir.copy(baseWind).divideScalar(wl);
      const front = -70 + u * 140; // metres along the wind from the hero
      const u2 = mat.uniforms;
      u2.uHero.value.copy(hero);
      u2.uDir.value.copy(st.dir);
      u2.uFront.value = front;
      u2.uAmp.value = grassy ? 1 : 0;
      mesh.visible = grassy;
      // surge: strongest while the front passes the hero
      const bump = Math.exp(-(front * front) / (2 * 22 * 22));
      const k = 1 + 1.7 * bump;
      wind.multiplyScalar(k);
      return bump;
    },
  };
}

// ------------------------------------------------------------------ all
export function createLiving(ctx) {
  const { scene, tod, env, settings } = ctx;
  const q = settings?.quality?.particles ?? 1;
  const life = settings?.quality?.life ?? 1;
  const rng = new Rng(31337);
  const setpieces = createSetpieces(ctx);
  const flocks = createFlocks({ scene, env, tod, q, life, rng });
  const marsh = createMarsh({ scene, env, q, life, rng });
  const devils = createDevils({ scene, env, q, life, rng });
  const gusts = settings?.quality?.grass > 0 ? createGusts({ scene, env, q, life, rng }) : null;
  const shared = { fogNear: 40, fogFar: 130, fx: null, onBurst: null };
  let game = null;
  const living = {
    setpieces, flocks, marsh, devils, gusts,
    bind(g) {
      game = g; shared.fx = g.fx; setpieces.bind(g);
      shared.onBurst = (f) => g.events.emit('birdsScatter', { x: f.x, z: f.z });
    },
    update(dt, t, playerPos, renderer) {
      setpieces.update(dt, t, playerPos, renderer);
      updateTownGlow(tod, t);
      if (scene.fog) { shared.fogNear = scene.fog.near; shared.fogFar = scene.fog.far; }
      const region = regionAt(playerPos.x, playerPos.z);
      if (region === 'dungeon' || region === 'cistern') return; // nothing outdoors to animate
      flocks.update(dt, t, playerPos, shared);
      marsh.update(dt, t, playerPos, region, shared);
      devils.update(dt, playerPos, region, env.uWind.value);
      gusts?.update(dt, playerPos, region, env.uWind.value);
      void game;
    },
  };
  scene.userData.living = living; // main.js binds the game context to it
  return living;
}
