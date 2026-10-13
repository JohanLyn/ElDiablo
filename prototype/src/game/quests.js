// Main story chain. Each quest has one objective; game systems report events
// with QuestLog.notify() and the log advances. Markers name world POIs.

export const QUESTS = [
  {
    id: 'q0', title: 'The Road to Eridu',
    intro: 'A merchant caravan burns on the south road. The Gallu have come this far already.',
    objective: { type: 'event', id: 'ambush', text: 'Drive off the demons attacking the caravan' },
    marker: 'ambush',
    reward: { xp: 60, gold: 30 },
  },
  {
    id: 'q1', title: 'Ash at the Outpost',
    giver: 'ninsun',
    intro: 'Gatewalker. The First Gate of Kur has cracked, and its servants spill across the plains. Before you descend, prove the gods still answer you. The Sunfields burn. Drive out the Gallu.',
    objective: { type: 'kill', region: 'sunfields', enemy: 'gallu', count: 8, text: 'Slay Gallu in the Sunfields' },
    marker: 'wp-sunfields',
    reward: { xp: 150, gold: 80 },
  },
  {
    id: 'q1b', title: 'The Ritual Stones',
    intro: 'The Gallu gather at the old standing stones west of the crossroads, chanting the gate open wider. Break their ritual before it is finished.',
    objective: { type: 'event', id: 'ev-ritual', text: 'Break the Ritual of the Gallu at the standing stones' },
    marker: 'ev-ritual',
    reward: { xp: 250, gold: 120 },
  },
  {
    id: 'q2', title: 'Waters of Enki',
    intro: 'The fields breathe again. To the west, the Reed Marsh hides an old shrine of Enki. Wake its waypoint so our scouts can follow you.',
    objective: { type: 'discover', id: 'wp-marsh', text: 'Activate the Reed Marsh waypoint' },
    marker: 'wp-marsh',
    reward: { xp: 200, gold: 120 },
  },
  {
    id: 'q2b', title: 'The Drowned Cistern',
    intro: 'Beneath the Shrine of Enki lies a flooded cistern. Something there sings with a drowned voice, and the reeds die where it echoes. Silence it.',
    objective: { type: 'boss', id: 'cistern-guardian', text: 'Slay the Drowned Voice in the Cistern of Enki' },
    marker: 'cistern-entrance',
    reward: { xp: 450, gold: 200 },
  },
  {
    id: 'q3', title: 'Sting of the Desert',
    intro: 'Scouts speak of a scorpion-man champion, Aqrabu the Venomed, who commands the Dune Ruins to the east. His death will break their line.',
    objective: { type: 'named', id: 'aqrabu', text: 'Slay Aqrabu the Venomed in the Dune Ruins' },
    marker: 'named-aqrabu',
    reward: { xp: 600, gold: 250, item: { rarity: 'rare' } },
  },
  {
    id: 'q4', title: 'The Ganzir Stair',
    intro: 'The way is open. North, past the Ashen Approach, the First Gate waits. Its stair descends into Ganzir. Enter it.',
    objective: { type: 'enter', id: 'dungeon', text: 'Enter the Ganzir Stair beneath the First Gate' },
    marker: 'dungeon-entrance',
    reward: { xp: 400, gold: 150 },
  },
  {
    id: 'q5', title: 'Keeper of the First Gate',
    intro: 'Neti, Keeper of the First Gate, bars the descent. Strip him of his crown as he would strip you of yours.',
    objective: { type: 'boss', id: 'neti', text: 'Defeat Neti, Keeper of the First Gate' },
    marker: 'boss-neti',
    reward: { xp: 1200, gold: 600, item: { rarity: 'legendary' } },
  },
];

// Quest ids of the v2 chain, by index, for save migration.
export const V2_QUEST_IDS = ['q1', 'q2', 'q3', 'q4', 'q5'];

export class QuestLog {
  // state: { id, progress, accepted } (index is accepted for older saves).
  constructor(state) {
    const byId = state?.id ? QUESTS.findIndex((q) => q.id === state.id) : -1;
    this.index = state?.id === 'done' ? QUESTS.length : byId >= 0 ? byId : (state?.index ?? 0);
    this.progress = state?.progress ?? 0;
    // Quests with a giver wait until you talk to them; the first quest starts at once.
    this.accepted = state?.accepted ?? !QUESTS[this.index]?.giver;
    this.listeners = [];
  }

  get active() { return this.accepted ? QUESTS[this.index] ?? null : null; }
  // The quest waiting to be picked up from an NPC (if any).
  get pending() { return !this.accepted && !this.done ? QUESTS[this.index] : null; }
  get done() { return this.index >= QUESTS.length; }

  onChange(fn) { this.listeners.push(fn); }
  emit(kind, quest) { for (const fn of this.listeners) fn(kind, quest); }

  accept() {
    if (this.accepted || this.done) return;
    this.accepted = true;
    this.progress = 0;
    this.emit('accepted', QUESTS[this.index]);
  }

  // Report a game event; returns the completed quest (if any).
  notify(event) {
    const q = this.active;
    if (!q) return null;
    const o = q.objective;
    let hit = false;
    if (o.type === 'kill' && event.type === 'kill' && event.region === o.region && (!o.enemy || event.enemy === o.enemy)) hit = true;
    if (o.type === 'event' && event.type === 'event' && event.id === o.id) hit = true;
    if (o.type === 'discover' && event.type === 'discover' && event.id === o.id) hit = true;
    if (o.type === 'named' && event.type === 'kill' && event.named === o.id) hit = true;
    if (o.type === 'enter' && event.type === 'enter' && event.id === o.id) hit = true;
    if (o.type === 'boss' && event.type === 'kill' && (event.boss === o.id || event.named === o.id)) hit = true;
    if (!hit) return null;
    this.progress++;
    if (this.progress >= (o.count ?? 1)) {
      this.index++;
      this.progress = 0;
      this.emit('completed', q);
      // The next quest starts at once unless someone has to give it to you.
      this.accepted = this.done || !QUESTS[this.index].giver;
      if (!this.done && this.accepted) this.emit('accepted', QUESTS[this.index]);
      return q;
    }
    this.emit('progress', q);
    return null;
  }

  objectiveText() {
    const q = this.active;
    if (!q) return null;
    const o = q.objective;
    return o.count ? `${o.text} (${this.progress}/${o.count})` : o.text;
  }

  toJSON() { return { id: this.done ? 'done' : QUESTS[this.index].id, progress: this.progress, accepted: this.accepted }; }
}
