import { installOrnaments, fillOrnaments } from './ornaments.js';

// Alpha robustness: global error panel, WebGL fallback, narrow-screen notice,
// and the pause-on-blur / pad-disconnect hooks. Importing this module installs
// the error handlers immediately, before the game boots.

installOrnaments();
fillOrnaments();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- error panel
const errors = new Map(); // text -> count
let panel = null;

function errorPanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'err-panel';
  panel.setAttribute('role', 'alert');
  panel.innerHTML = `<div class="ep-head"><b>Something went wrong</b><span class="ep-count"></span><button type="button" class="ep-x" aria-label="Dismiss">×</button></div>
    <pre class="ep-text" tabindex="0"></pre>
    <div class="ep-actions"><button type="button" class="ep-copy">Copy details</button><button type="button" class="ep-dismiss">Dismiss</button></div>
    <div class="ep-note">The game keeps running. If it misbehaves, reload; progress is saved automatically.</div>`;
  document.body.appendChild(panel);
  const close = () => { panel.hidden = true; errors.clear(); };
  panel.querySelector('.ep-x').addEventListener('click', close);
  panel.querySelector('.ep-dismiss').addEventListener('click', close);
  panel.querySelector('.ep-copy').addEventListener('click', () => copyText(fullReport(), panel.querySelector('.ep-text'), panel.querySelector('.ep-copy')));
  // Keep key presses in the panel from reaching the game.
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  return panel;
}

function fullReport() {
  const g = window.__game;
  const head = `The Seven Gates of Kur ${g?.version ?? ''}\n${navigator.userAgent}\n${new Date().toISOString()}\n\n`;
  return head + [...errors.entries()].map(([t, n]) => `${t}${n > 1 ? `\n(x${n})` : ''}`).join('\n\n---\n\n');
}

async function copyText(text, selectEl, button) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through */ }
  if (!ok) {
    // Fallback: select the text so Ctrl+C works, and try the legacy command.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch { /* ignore */ }
    if (!ok && selectEl) {
      const r = document.createRange();
      r.selectNodeContents(selectEl);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  if (button) {
    const old = button.textContent;
    button.textContent = ok ? 'Copied' : 'Select + Ctrl+C';
    setTimeout(() => { button.textContent = old; }, 1800);
  }
}

export function reportError(err) {
  if (window.__noWebGL) return;
  const msg = err instanceof Error ? `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(1, 6).join('\n')}` : String(err);
  if (/ResizeObserver loop/i.test(msg)) return;
  errors.set(msg, (errors.get(msg) ?? 0) + 1);
  if (errors.size > 8) errors.delete(errors.keys().next().value);
  const p = errorPanel();
  p.hidden = false;
  const last = [...errors.keys()].pop();
  p.querySelector('.ep-text').textContent = last.slice(0, 700);
  const n = [...errors.values()].reduce((a, b) => a + b, 0);
  p.querySelector('.ep-count').textContent = n > 1 ? `${n} errors` : '';
}

window.addEventListener('error', (e) => {
  if (!e.error && !e.message) return; // resource load failures (fonts etc.) are not game errors
  reportError(e.error ?? `${e.message} (${e.filename ?? ''}:${e.lineno ?? ''})`);
});
window.addEventListener('unhandledrejection', (e) => reportError(e.reason ?? 'Unhandled promise rejection'));

// ---------------------------------------------------------------- WebGL
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

export function showNoWebGL(detail = '') {
  window.__noWebGL = true;
  document.getElementById('loading')?.remove();
  const el = document.createElement('div');
  el.id = 'no-webgl';
  el.innerHTML = `<div class="nw-card">
    <div class="nw-sigil">${document.querySelector('.t-sigil')?.innerHTML ?? ''}</div>
    <h1>The Gate Will Not Open</h1>
    <p>Your browser could not start 3D graphics (WebGL 2), which The Seven Gates of Kur needs.</p>
    <ul>
      <li>Turn on <b>hardware acceleration</b> in your browser settings and restart it.</li>
      <li>Update your graphics driver and browser, or try a recent Chrome, Edge or Firefox.</li>
      <li>Make sure the page is not running in a remote or restricted session.</li>
    </ul>
    <button type="button" class="nw-retry">Try again</button>
    ${detail ? `<div class="nw-detail">${esc(detail)}</div>` : ''}
  </div>`;
  document.body.appendChild(el);
  el.querySelector('.nw-retry').addEventListener('click', () => location.reload());
}

// ---------------------------------------------------------------- small screens
function desktopNotice() {
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('kur-desktop-notice') === '1'; } catch { /* ignore */ }
  if (dismissed) return;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (!(innerWidth < 700 || touchOnly)) return;
  const el = document.createElement('div');
  el.id = 'desktop-notice';
  el.innerHTML = '<span>Best played on desktop with a controller, or keyboard &amp; mouse.</span><button type="button" aria-label="Dismiss">Got it</button>';
  el.querySelector('button').addEventListener('click', () => {
    el.remove();
    try { sessionStorage.setItem('kur-desktop-notice', '1'); } catch { /* ignore */ }
  });
  document.body.appendChild(el);
}
desktopNotice();

// ---------------------------------------------------------------- in-game hooks
export function installSystem(g) {
  const s = g.settings;
  const applySettings = () => {
    document.documentElement.style.setProperty('--ui-scale', String(s.get('uiScale') ?? 1));
    document.body.classList.toggle('colorblind', !!s.get('colorblind'));
  };
  applySettings();
  s.onChange(applySettings);

  const autoPause = (reason) => {
    const ui = g.ui;
    if (!g.started || ui.mode !== null || g.player.dead) return;
    ui.openPause({ reason });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause('blur'); });
  window.addEventListener('blur', () => autoPause('blur'));

  // Controller unplugged mid-game: pause and offer a way forward.
  const lost = document.getElementById('pad-lost');
  let lastPadUse = 0;
  new MutationObserver(() => { if (document.body.dataset.device === 'pad') lastPadUse = performance.now(); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-device'] });
  if (document.body.dataset.device === 'pad') lastPadUse = performance.now();
  window.addEventListener('gamepaddisconnected', () => {
    if (!g.started || document.body.dataset.device !== 'pad' && performance.now() - lastPadUse > 15000) return;
    autoPause('pad');
    lost.hidden = false;
  });
  const clear = () => { lost.hidden = true; };
  window.addEventListener('gamepadconnected', clear);
  window.addEventListener('keydown', clear);
  window.addEventListener('mousedown', clear);
}
