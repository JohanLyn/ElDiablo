import * as THREE from 'three';
import { getEnv, NOISE_GLSL } from './common.js';

// Soft additive light halos (lanterns, braziers, rune glints) as a single Points
// draw call, plus instanced billboard flames driven by a noise shader.

// items: [{ x, y, z, color, size, flicker }]
export function createGlow(items, { opacity = 0.55 } = {}) {
  const env = getEnv();
  const n = items.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n * 2);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    pos.set([it.x, it.y, it.z], i * 3);
    c.set(it.color ?? 0xffa860);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = it.size ?? 1.2;
    ph[i * 2] = Math.random() * 100; ph[i * 2 + 1] = it.flicker ?? 0.2;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: env.uTime, uPx: env.uPxScale, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`
      uniform float uTime, uPx; attribute vec3 aColor; attribute float aSize; attribute vec2 aPh;
      varying vec3 vCol; varying float vA;
      void main() {
        float f = 1.0 + aPh.y * (sin(uTime * 9.0 + aPh.x) * 0.5 + sin(uTime * 14.3 + aPh.x * 2.1) * 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * f * uPx / -mv.z, 2.0, 220.0);
        vCol = aColor * f; vA = 1.0;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity; varying vec3 vCol; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d));
        gl_FragColor = vec4(vCol * a * uOpacity, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

// Instanced camera-facing flames. Each instance: position + uniform scale (height in metres).
// color: [core, mid, edge] hex values.
export function createFlames(positions, { scale = 1, colors = [0xfff2c0, 0xff9a30, 0xd0300a], intensity = 2.0 } = {}) {
  const env = getEnv();
  const n = positions.length;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: env.uTime, uIntensity: { value: intensity },
      uC0: { value: new THREE.Color(colors[0]) }, uC1: { value: new THREE.Color(colors[1]) }, uC2: { value: new THREE.Color(colors[2]) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vSeed;
      void main() {
        vUv = uv;
        mat4 m = modelMatrix * instanceMatrix;
        vec3 org = vec3(m[3]);
        float h = length(vec3(m[1]));
        vSeed = org.x * 0.37 + org.z * 0.61;
        vec4 mv = viewMatrix * vec4(org, 1.0);
        vec2 q = position.xy * vec2(0.62, 1.0) * h;
        mv.xy += q;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uIntensity; uniform vec3 uC0, uC1, uC2;
      varying vec2 vUv; varying float vSeed;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0, vUv.y);
        float t = uTime * 2.4 + vSeed;
        // Flame body: narrows with height, licked sideways by noise.
        float n = fbm3(vec2(p.x * 1.6 + sin(t * 0.7) * 0.4, p.y * 2.2 - t));
        float width = (1.0 - p.y) * 0.85 * (0.7 + 0.5 * n);
        float body = smoothstep(width, width * 0.25, abs(p.x + (n - 0.5) * 0.5 * p.y));
        float top = smoothstep(1.0, 0.55 + n * 0.25, p.y);
        float a = body * top * smoothstep(0.0, 0.08, p.y);
        float heat = clamp(a * 1.4 - p.y * 0.5 + n * 0.25, 0.0, 1.0);
        vec3 col = mix(uC2, uC1, smoothstep(0.1, 0.55, heat));
        col = mix(col, uC0, smoothstep(0.55, 0.95, heat));
        gl_FragColor = vec4(col * a * uIntensity, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  const d = new THREE.Object3D();
  positions.forEach((p, i) => {
    d.position.set(p.x, p.y, p.z);
    d.scale.setScalar((p.s ?? 1) * scale);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}
