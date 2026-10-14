import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { PerfMeter } from './perfmeter.js';
import { DynRes } from './dynres.js';

// Final colour grade in display space: split toning, contrast/saturation,
// vignette, film grain, plus gameplay overlays (hurt edge, screen flash).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShadowTint: { value: new THREE.Color(0.18, 0.2, 0.32) },
    uHighlightTint: { value: new THREE.Color(1.0, 0.86, 0.66) },
    uSplit: { value: 0.12 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.08 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uHurt: { value: 0 },
    uCA: { value: 0 },
    uDirt: { value: 0 },
    uAspect: { value: 1.6 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uSplit, uContrast, uSaturation, uVignette, uGrain, uHurt, uCA, uDirt, uAspect;
    uniform vec3 uShadowTint, uHighlightTint;
    uniform vec4 uFlash;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d0 = vUv - 0.5;
      // Lateral chromatic aberration, growing toward the corners (High / Ultra).
      if (uCA > 0.0) {
        vec2 off = d0 * dot(d0, d0) * uCA * 0.018;
        c.r = texture2D(tDiffuse, vUv + off).r;
        c.b = texture2D(tDiffuse, vUv - off).b;
      }
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Split toning: cool shadows, warm highlights.
      col = mix(col, col * mix(uShadowTint * 2.2, uHighlightTint * 1.15, smoothstep(0.05, 0.8, l)), uSplit);
      col = (col - 0.5) * uContrast + 0.5;
      float l2 = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l2), col, uSaturation);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r);
      // Low-life pulse at the screen edges.
      col = mix(col, vec3(0.55, 0.02, 0.04), uHurt * smoothstep(0.12, 0.5, r));
      // Lens dirt: smudges and specks that only show where light blooms hard.
      if (uDirt > 0.0) {
        vec2 q = vUv * vec2(uAspect, 1.0);
        float dirt = smoothstep(0.52, 0.9, vn(q * 3.1 + 2.0) * 0.6 + vn(q * 9.0) * 0.25 + vn(q * 23.0 + 5.0) * 0.15);
        dirt += smoothstep(0.93, 0.985, vn(q * 38.0)) * 0.6;
        float bright = smoothstep(0.62, 1.0, l2);
        col += mix(vec3(1.0), col, 0.5) * dirt * bright * bright * uDirt * 0.16;
      }
      col = mix(col, uFlash.rgb, uFlash.a);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

// Screen-space shockwaves: up to MAX_WAVES expanding refraction rings, fed by
// Renderer.shockwave(). Runs in linear HDR before tone mapping. Off on Low.
const MAX_WAVES = 4;
const ShockShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    // per wave: x, y (uv centre), radius (uv, current), amplitude
    uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform vec4 uWaves[${MAX_WAVES}];
    varying vec2 vUv;
    void main() {
      vec2 off = vec2(0.0);
      for (int i = 0; i < ${MAX_WAVES}; i++) {
        vec4 w = uWaves[i];
        if (w.w <= 0.0) continue;
        vec2 d = vUv - w.xy; d.x *= uAspect;
        float r = length(d);
        float width = max(0.012, w.z * 0.35);
        float ring = exp(-pow((r - w.z) / width, 2.0));
        off += (r > 1e-4 ? d / r : vec2(0.0)) * ring * w.w * vec2(1.0 / uAspect, 1.0);
      }
      vec4 c = texture2D(tDiffuse, vUv - off);
      // A touch of chromatic split on strong rings.
      float k = length(off) * 0.6;
      c.r = texture2D(tDiffuse, vUv - off * (1.0 + k * 8.0)).r;
      gl_FragColor = c;
    }`,
};

// CSS stand-in for the grade pass on presets without post-processing: a static
// radial vignette, a red hurt edge and a flash layer. Only opacity changes per
// frame (compositor-friendly), and only when the value moved.
class ScreenOverlay {
  constructor(canvas) {
    const root = document.createElement('div');
    root.id = 'fx-overlay';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;';
    const layer = (bg) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;inset:0;opacity:0;will-change:opacity;background:${bg};`;
      root.appendChild(d);
      return d;
    };
    // Same falloff as the grade shader: clear inside ~40-50% of the way to the corner.
    this.vig = layer('radial-gradient(ellipse farthest-corner at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.33) 72%, rgba(0,0,0,0.78) 90%, #000 100%)');
    this.hurtEl = layer('radial-gradient(ellipse farthest-corner at 50% 50%, rgba(140,5,10,0) 49%, rgba(140,5,10,0.39) 75%, rgba(140,5,10,0.84) 90%, rgba(140,5,10,1) 100%)');
    this.flashEl = layer('#fff');
    this.root = root;
    this.last = { v: -1, h: -1, f: -1 };
    canvas.after(root);
  }

  setActive(on) { this.root.style.display = on ? '' : 'none'; }

  setFlashColor(c) { this.flashEl.style.background = `#${c.getHexString()}`; }

  update(vig, hurt, flash) {
    const l = this.last;
    if (Math.abs(vig - l.v) > 0.01) { l.v = vig; this.vig.style.opacity = Math.min(1, vig).toFixed(3); }
    if (Math.abs(hurt - l.h) > 0.01 || (hurt < 0.01) !== (l.h < 0.01)) { l.h = hurt; this.hurtEl.style.opacity = Math.min(0.95, hurt).toFixed(3); }
    if (Math.abs(flash - l.f) > 0.01 || (flash < 0.01) !== (l.f < 0.01)) { l.f = flash; this.flashEl.style.opacity = Math.min(1, flash).toFixed(3); }
  }
}

// Owns the WebGL renderer and the post-processing chain; rebuilds it when
// the quality preset changes.
//
// Presets with `post: false` (Mobile) skip the EffectComposer: the scene renders
// straight to the canvas (tone mapped by the renderer) and the screen effects that
// still matter for feel (vignette, hurt edge, flashes) are CSS overlays above it.
// Their canvas gets hardware MSAA when the preset asks for `aa: 'msaa'` (cheap on
// tiled mobile GPUs, and it can only be chosen when the context is created).
export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: settings.quality.aa === 'msaa', powerPreference: 'high-performance' });
    this.webgl.info.autoReset = false; // one reset per frame (render()), so info covers every pass
    this.dyn = new DynRes();
    this.meter = new PerfMeter(settings, this);
    this.lastMs = 0;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.lens = false;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.grade = new ShaderPass(GradeShader);
    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.waves = []; // { pos: Vector3, age, life, strength, radius }
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    settings.onChange((k) => { if (k === 'quality') this.applyQuality(); });
    window.addEventListener('resize', () => this.resize());
  }

  attach(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.applyQuality();
  }

  applyQuality() {
    const q = this.settings.quality;
    this.ratioCap = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.dyn.configure(this.ratioCap, !!q.dynRes && !this.settings.dynResOff);
    this.webgl.setPixelRatio(this.dyn.ratio);
    this.webgl.shadowMap.enabled = q.shadows;
    this.webgl.shadowMap.needsUpdate = true;
    if (this.composer) {
      for (const p of this.composer.passes) if (p !== this.grade) p.dispose?.();
      this.composer.dispose();
      this.composer = null;
    }
    this.bloom = null;
    this.shock = null;
    this.waves.length = 0;
    if (q.post === false) {
      // Direct render: no composer. The overlay carries vignette / hurt / flash.
      this.overlay ??= new ScreenOverlay(this.canvas);
      this.overlay.setActive(true);
    } else {
      this.overlay?.setActive(false);
      const c = new EffectComposer(this.webgl);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (q.ao) {
        const ao = new GTAOPass(this.scene, this.camera, 512, 512);
        ao.blendIntensity = 0.75;
        c.addPass(ao);
      }
      if (q.bloom) c.addPass(this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.86));
      // Shockwaves only where post-processing budget exists (not on Low).
      this.shock = q.bloom ? new ShaderPass(ShockShader) : null;
      if (this.shock) { this.shock.enabled = false; c.addPass(this.shock); }
      c.addPass(new OutputPass());
      c.addPass(this.grade);
      c.addPass(q.aa === 'smaa' ? new SMAAPass() : new FXAAPass());
      this.composer = c;
    }
    this.lens = !!q.lens;
    this.resize();
    // Shadow-casting lights must rebuild their maps at the new size.
    this.scene?.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) {
        o.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
    this.lightCount = 0;
    this.scene?.traverse((o) => { if (o.isPointLight) this.lightCount++; });
  }

  get usesComposer() { return !!this.composer; }

  // Dynamic resolution moved the pixel ratio: resize the drawing buffer.
  setRatio(r) {
    this.webgl.setPixelRatio(r);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.webgl.setSize(w, h, false);
    this.composer?.setSize(w, h);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.grade.uniforms.uAspect.value = w / h;
  }

  // Brief full-screen flash (legendary drops, level ups, boss phases).
  pulse(color = 0xffffff, amount = 0.35) {
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, amount);
    this.overlay?.setFlashColor(this.flashColor);
  }

  // Expanding refraction ring at a world position (crits, slams, boss deaths).
  // strength ~0.01..0.05 (uv displacement), radius in metres at full size.
  shockwave(pos, strength = 0.025, radius = 6, life = 0.55) {
    if (!this.shock) return;
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({ pos: pos.clone(), age: 0, life, strength, radius });
  }

  updateWaves(dt) {
    if (!this.shock) return;
    const u = this.shock.uniforms;
    u.uAspect.value = this.camera.aspect;
    this.waves = this.waves.filter((w) => (w.age += dt) < w.life);
    const right = this._v2.setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i], out = u.uWaves.value[i];
      if (!w) { out.w = 0; continue; }
      const k = w.age / w.life;
      const c = this._v.copy(w.pos).project(this.camera);
      const cx = c.x * 0.5 + 0.5, cy = c.y * 0.5 + 0.5;
      // Radius in uv: project a point `radius` metres to the side.
      const e = this._v.copy(w.pos).addScaledVector(right, w.radius * (0.15 + 0.85 * Math.sqrt(k))).project(this.camera);
      const ru = Math.abs((e.x * 0.5 + 0.5) - cx) * this.camera.aspect;
      out.set(cx, cy, ru, w.strength * (1 - k) * (1 - k));
    }
    this.shock.enabled = this.waves.length > 0;
  }

  render(dt, { hurt = 0 } = {}) {
    const now = performance.now();
    if (this.lastMs) {
      const ms = now - this.lastMs;
      this.meter.frame(ms);
      const r = this.dyn.frame(ms, now);
      if (r) this.setRatio(r);
    }
    this.lastMs = now;
    this.webgl.info.reset();
    this.updateWaves(dt);
    const u = this.grade.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 1000;
    this.flash = Math.max(0, this.flash - dt * 1.8);
    u.uFlash.value.set(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash);
    u.uHurt.value += (hurt - u.uHurt.value) * Math.min(1, dt * 4);
    if (this.composer) this.composer.render(dt);
    else {
      this.overlay?.update(u.uVignette.value, u.uHurt.value, this.flash);
      this.webgl.setRenderTarget(null);
      this.webgl.render(this.scene, this.camera);
    }
  }

  // Per-region grade (e.g. greener marsh, bruised ashen tones).
  setGrade({ shadow, highlight, split, saturation, contrast }) {
    const u = this.grade.uniforms;
    if (shadow) u.uShadowTint.value.set(shadow);
    if (highlight) u.uHighlightTint.value.set(highlight);
    if (split !== undefined) u.uSplit.value = split;
    if (saturation !== undefined) u.uSaturation.value = saturation;
    if (contrast !== undefined) u.uContrast.value = contrast;
  }

  // Per-frame mood from the day cycle and region (world.js): bloom, vignette,
  // grain and lens effects. Cheap uniform writes only; no passes are added or removed.
  setMood({ bloom, bloomThr, bloomRad, vign, grain, ca }) {
    const u = this.grade.uniforms;
    if (this.bloom) {
      this.bloom.strength = bloom;
      this.bloom.threshold = bloomThr;
      this.bloom.radius = bloomRad;
    }
    u.uVignette.value = vign;
    u.uGrain.value = grain;
    u.uCA.value = this.lens ? ca : 0;
    u.uDirt.value = this.lens ? Math.min(1, bloom * 1.1) : 0;
  }

  get info() { return this.webgl.info; }
}
