import * as THREE from 'three';

// One shared dynamic mesh that renders every camera-facing ribbon (javelin and
// bolt trails, lightning, afterimage streaks) in a single draw call.
// A strip is a fixed-size slot of PTS points; unused points collapse to
// degenerate triangles.
const VERT = /* glsl */`
  attribute vec4 color;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    vColor = color;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    float p = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float glow = smoothstep(0.0, 0.7, p) * 0.55;
    float core = pow(p, 4.0) * 1.1;
    float a = vColor.a * (glow + core);
    if (a < 0.004) discard;
    vec3 col = mix(vColor.rgb, vec3(1.0), pow(p, 6.0) * 0.5);
    gl_FragColor = vec4(col * a, a * 0.5);
  }`;

export class RibbonBatch {
  constructor(scene, strips = 56, pts = 28) {
    this.S = strips;
    this.P = pts;
    this.pos = new Float32Array(strips * pts * 3);
    this.wid = new Float32Array(strips * pts);
    this.col = new Float32Array(strips * pts * 4);
    this.n = new Int16Array(strips);
    this.sw = new Float32Array(strips).fill(1); // width scale
    this.sa = new Float32Array(strips).fill(1); // alpha scale
    this.tp = new Float32Array(strips).fill(0); // taper power (0 = none): old points fade and thin
    this.used = new Uint8Array(strips);
    this.dirty = new Uint8Array(strips);
    this.free = [];
    for (let i = strips - 1; i >= 0; i--) this.free.push(i);

    const vcount = strips * pts * 2;
    this.vPos = new Float32Array(vcount * 3);
    this.vCol = new Float32Array(vcount * 4);
    const uv = new Float32Array(vcount * 2);
    const idx = new Uint32Array(strips * (pts - 1) * 6);
    let ii = 0;
    for (let s = 0; s < strips; s++) {
      for (let p = 0; p < pts; p++) {
        const v = (s * pts + p) * 2;
        const u = p / (pts - 1);
        uv[v * 2] = u; uv[v * 2 + 1] = 0;
        uv[v * 2 + 2] = u; uv[v * 2 + 3] = 1;
        if (p < pts - 1) {
          idx[ii++] = v; idx[ii++] = v + 1; idx[ii++] = v + 2;
          idx[ii++] = v + 1; idx[ii++] = v + 3; idx[ii++] = v + 2;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.vPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.vCol, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this.activeCount = 0;
  }

  alloc() {
    const id = this.free.pop();
    if (id === undefined) return -1;
    this.used[id] = 1; this.n[id] = 0; this.sw[id] = 1; this.sa[id] = 1; this.tp[id] = 0; this.activeCount++;
    return id;
  }

  release(id) {
    if (id < 0 || !this.used[id]) return;
    this.used[id] = 0; this.dirty[id] = 1; this.n[id] = 0; this.activeCount--;
    this.free.push(id);
  }

  clear(id) { this.n[id] = 0; }

  // Append a point (keeps at most P; older points are dropped from the front).
  push(id, x, y, z, w, r, g, b, a) {
    const P = this.P;
    let n = this.n[id];
    if (n >= P) {
      const base = id * P;
      this.pos.copyWithin(base * 3, (base + 1) * 3, (base + P) * 3);
      this.wid.copyWithin(base, base + 1, base + P);
      this.col.copyWithin(base * 4, (base + 1) * 4, (base + P) * 4);
      n = P - 1;
    }
    this.set(id, n, x, y, z, w, r, g, b, a);
    this.n[id] = n + 1;
  }

  set(id, i, x, y, z, w, r, g, b, a) {
    const k = id * this.P + i;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.wid[k] = w;
    this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = a;
    if (i >= this.n[id]) this.n[id] = i + 1;
  }

  // Rebuild vertices for the camera position. Called once per frame.
  flush(cam) {
    const { P, pos, wid, col, vPos, vCol } = this;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    let any = false;
    for (let s = 0; s < this.S; s++) {
      if (!this.used[s]) {
        if (this.dirty[s]) {
          this.dirty[s] = 0; any = true;
          vPos.fill(0, s * P * 6, (s + 1) * P * 6);
          vCol.fill(0, s * P * 8, (s + 1) * P * 8);
        }
        continue;
      }
      any = true;
      const n = this.n[s];
      const base = s * P;
      const tp = this.tp[s], sw = this.sw[s], sa = this.sa[s];
      for (let i = 0; i < P; i++) {
        const j = i < n ? i : Math.max(0, n - 1);
        const k = base + j;
        const v = (base + i) * 2;
        if (n === 0) { vCol[v * 4 + 3] = 0; vCol[v * 4 + 7] = 0; vPos.fill(0, v * 3, v * 3 + 6); continue; }
        const px = pos[k * 3], py = pos[k * 3 + 1], pz = pos[k * 3 + 2];
        const a = base + Math.max(0, j - 1), b = base + Math.min(n - 1, j + 1);
        let tx = pos[b * 3] - pos[a * 3], ty = pos[b * 3 + 1] - pos[a * 3 + 1], tz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const dx = cx - px, dy = cy - py, dz = cz - pz;
        let sx = ty * dz - tz * dy, sy = tz * dx - tx * dz, sz = tx * dy - ty * dx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const tt = n > 1 ? j / (n - 1) : 1;
        const hw = wid[k] * sw * (tp > 0 ? 0.12 + 0.88 * tt : 1) * 0.5 / sl;
        sx *= hw; sy *= hw; sz *= hw;
        vPos[v * 3] = px - sx; vPos[v * 3 + 1] = py - sy; vPos[v * 3 + 2] = pz - sz;
        vPos[v * 3 + 3] = px + sx; vPos[v * 3 + 4] = py + sy; vPos[v * 3 + 5] = pz + sz;
        const alpha = i < n ? col[k * 4 + 3] * sa * (tp > 0 ? Math.pow(tt, tp) : 1) : 0;
        for (let h = 0; h < 2; h++) {
          vCol[(v + h) * 4] = col[k * 4]; vCol[(v + h) * 4 + 1] = col[k * 4 + 1]; vCol[(v + h) * 4 + 2] = col[k * 4 + 2]; vCol[(v + h) * 4 + 3] = alpha;
        }
      }
    }
    if (any) { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; }
    this.mesh.visible = this.activeCount > 0 || any;
  }
}
