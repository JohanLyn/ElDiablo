import { V2_QUEST_IDS } from './quests.js';

// Local save in the browser. Storage can be unavailable (private windows,
// sandboxed previews), so every access is guarded and the game runs without it.

const KEY = 'eldiablo-kur-save-v2'; // key kept so v2 saves carry over; payload version is migrated
export const SAVE_VERSION = 3;

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, version: SAVE_VERSION, savedAt: Date.now() }));
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

// Upgrade older save payloads in place. Returns null for unknown/corrupt data.
export function migrate(data) {
  if (!data || typeof data !== 'object' || !data.player) return null;
  if (data.version === 2) {
    // v3 adds tutorial/onboarding flags; v2 heroes have already played, so skip the intro.
    data.flags = { ...(data.flags ?? {}), introDone: true, tutorialSkipped: true };
    // v2 stored the quest by index in a 5-quest chain; v3 stores the quest id.
    const q = data.quests ?? {};
    if (q.id === undefined) data.quests = { id: V2_QUEST_IDS[q.index ?? 0] ?? 'done', progress: q.progress ?? 0, accepted: q.accepted ?? false };
    data.version = 3;
  }
  return data.version === SAVE_VERSION ? data : null;
}
