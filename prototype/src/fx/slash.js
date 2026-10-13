import * as THREE from 'three';

// Crescent slash ribbons for Sickle Strike. A small pool of meshes shares one
// arc geometry; the swing is an angular sweep in an arbitrary plane (axes U/V)
// so the same shader draws flat sweeps and the big overhead chop.
const VERT = /* glsl */`
  uniform vec3 uCenter, uAxU, uAxV;
  uniform float uA0, uA1, uR0, uR1;
  varying vec2 vUv;
  void main() {
    float ang = mix(uA0, uA1, uv.x);
    vec3 dir = uAxU * cos(ang) + uAxV * sin(ang);
    float r = mix(uR0, uR1, uv.y);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(uCenter + dir * r, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uColor, uHot;
  uniform float uHead, uFade, uTail, uPower, uSeed;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float u = vUv.x, v = vUv.y;
    float behind = uHead - u;
    if (behind < 0.0) discard;
    float w = pow(max(sin(3.14159 * u), 0.0), 0.65);
    float outer = 0.5 + 0.5 * w;
    float inner = 0.5 - 0.5 * w * 0.8;
    float shape = smoothstep(inner - 0.03, inner + 0.25, v) * (1.0 - smoothstep(outer - 0.03, outer + 0.015, v));
    float edge = smoothstep(outer - 0.28, outer, v);
    float tail = exp(-behind * uTail);
    float streak = 0.72 + 0.28 * sin(v * 70.0 + u * 14.0 + uSeed * 9.0) * sin(v * 23.0 - u * 6.0);
    float lead = smoothstep(0.0, 0.1, behind) ;
    float a = shape * tail * streak * uFade * (0.35 + edge * 0.9) * lead;
    // Bright white-hot head of the swing.
    float headGlow = exp(-behind * 14.0) * shape * uFade;
    vec3 col = mix(uColor, uHot, edge * edge * 0.8 + headGlow * 0.6) * uPower;
    a += headGlow * 0.6;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
  }`;

function arcGeometry(seg = 40, rows = 6) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= seg; i++) {
      pos.push(0, 0, 0);
      uv.push(i / seg, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class SlashPool {
  constructor(scene, size = 4) {
    this.geo = arcGeometry();
    this.items = [];
    for (let i = 0; i < size; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uCenter: { value: new THREE.Vector3() }, uAxU: { value: new THREE.Vector3(0, 0, 1) }, uAxV: { value: new THREE.Vector3(1, 0, 0) },
          uA0: { value: 0 }, uA1: { value: 1 }, uR0: { value: 1 }, uR1: { value: 3 },
          uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() },
          uHead: { value: 0 }, uFade: { value: 1 }, uTail: { value: 3 }, uPower: { value: 1.4 }, uSeed: { value: 0 },
        },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 8;
      scene.add(mesh);
      this.items.push({ mesh, mat, t: 0, dur: 0, hold: 0, active: false });
    }
    this.cursor = 0;
  }

  // Start a swing. delay lets the arc line up with the weapon.
  spawn({ center, axU, axV, a0, a1, r0, r1, color, hot, dur, hold = 0.12, tail = 3, power = 1.4 }) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const u = it.mat.uniforms;
    u.uCenter.value.copy(center); u.uAxU.value.copy(axU); u.uAxV.value.copy(axV);
    u.uA0.value = a0; u.uA1.value = a1; u.uR0.value = r0; u.uR1.value = r1;
    u.uColor.value.set(color); u.uHot.value.set(hot);
    u.uHead.value = 0; u.uFade.value = 1; u.uTail.value = tail; u.uPower.value = power; u.uSeed.value = Math.random();
    it.t = 0; it.dur = dur; it.hold = hold; it.active = true; it.mesh.visible = true;
    return it;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const u = it.mat.uniforms;
      const k = it.t / it.dur;
      // Ease-out sweep, then the head keeps travelling so the tail drains away.
      const sweep = Math.min(1, k);
      u.uHead.value = 1 - Math.pow(1 - sweep, 2.2);
      if (k > 1) u.uHead.value = 1 + (k - 1) * 1.6;
      const fadeStart = it.dur + it.hold * 0.3;
      u.uFade.value = it.t < fadeStart ? 1 : Math.max(0, 1 - (it.t - fadeStart) / (it.hold * 0.9 + 0.001));
      if (it.t > it.dur + it.hold * 1.4) { it.active = false; it.mesh.visible = false; }
    }
  }
}
