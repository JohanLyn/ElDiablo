// Local save in the browser. Storage can be unavailable (private windows,
// sandboxed previews), so every access is guarded and the game runs without it.

const KEY = 'eldiablo-kur-save-v2';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.version === 2 ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, savedAt: Date.now(), ...data }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// Compact the fog-of-war bitmap for storage.
export function encodeBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function decodeBytes(str, length) {
  const out = new Uint8Array(length);
  try {
    const s = atob(str);
    for (let i = 0; i < Math.min(length, s.length); i++) out[i] = s.charCodeAt(i);
  } catch { /* corrupt or missing: start unexplored */ }
  return out;
}
