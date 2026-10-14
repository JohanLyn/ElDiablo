// Button glyphs: Xbox buttons on a pad, key caps on keyboard + mouse, lapis
// discs on touch. All variants are emitted; body[data-device] decides which one
// shows, so a device switch never needs a re-render.

const PAD_CLASS = {
  A: 'gp-a', B: 'gp-b', X: 'gp-x', Y: 'gp-y',
  LB: 'gp-bump', RB: 'gp-bump', LT: 'gp-bump', RT: 'gp-bump',
  Start: 'gp-small', Back: 'gp-small', View: 'gp-small', Menu: 'gp-small',
};

export function padGlyph(label) {
  const cls = PAD_CLASS[label] ?? 'gp-text';
  return `<kbd class="pad gp ${cls}">${label}</kbd>`;
}

export function keyGlyph(label) {
  const cls = label.length > 2 ? ' key-wide' : '';
  return `<kbd class="kbm key${cls}">${label}</kbd>`;
}

// Touch: a round lapis disc with a gold rim (`.tch` is hidden on every other device).
export function touchGlyph(label) {
  return `<kbd class="tch tg">${label}</kbd>`;
}

// One prompt token: pad label + keyboard label (+ touch label when there is one).
export const btn = (padLabel, keyLabel, touchLabel) => padGlyph(padLabel) + keyGlyph(keyLabel) + (touchLabel ? touchGlyph(touchLabel) : '');

// Style a free-standing <kbd> by its text (used for the tutorial card, whose
// markup comes from game code).
export function styleKbd(el) {
  const t = el.textContent.trim();
  el.classList.remove('gp', 'gp-a', 'gp-b', 'gp-x', 'gp-y', 'gp-bump', 'gp-small', 'gp-text', 'key', 'key-wide', 'gp-dot', 'tg');
  if (document.body.dataset.device === 'touch') el.classList.add('tg');
  else if (PAD_CLASS[t]) el.classList.add('gp', PAD_CLASS[t]);
  else if (/stick|D-pad/i.test(t)) el.classList.add('gp', 'gp-text');
  else if (t === '◆') el.classList.add('gp', 'gp-dot');
  else el.classList.add('key', ...(t.length > 2 ? ['key-wide'] : []));
}

export function watchKbd(container) {
  const run = () => container.querySelectorAll('kbd').forEach(styleKbd);
  new MutationObserver(run).observe(container, { childList: true });
  run();
}
