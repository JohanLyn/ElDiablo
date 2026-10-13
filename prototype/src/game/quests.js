// Main story chain. Each quest has one objective; game systems report events
// with QuestLog.notify() and the log advances. Markers name world POIs.

export const QUESTS = [
  {
    id: 'q1', title: 'Ash at the Outpost',
    giver: 'ninsun',
    intro: 'Gatewalker. The First Gate of Kur has cracked, and its servants spill across the plains. Before you descend, prove the gods still answer you. The Sunfields burn. Drive out the Gallu.',
    objective: { type: 'kill', region: 'sunfields', count: 10, text: 'Slay Gallu in the Sunfields' },
    marker: 'wp-sunfields',
    reward: { xp: 120, gold: 80 },
  },
  {
    id: 'q2', title: 'Waters of Enki',
    intro: 'The fields breathe again. To the west, the Reed Marsh hides an old shrine of Enki. Wake its waypoint so our scouts can follow you.',
    objective: { type: 'discover', id: 'wp-marsh', text: 'Activate the Reed Marsh waypoint' },
    marker: 'wp-marsh',
    reward: { xp: 200, gold: 120 },
  },
  {
    id: 'q3', title: 'Sting of the Desert',
    intro: 'Scouts speak of a scorpion-man champion, Aqrabu the Venomed, who commands the Dune Ruins to the east. His death will break their line.',
    objective: { type: 'named', id: 'aqrabu', text: 'Slay Aqrabu the Venomed in the Dune Ruins' },
    marker: 'named-aqrabu',
    reward: { xp: 420, gold: 250, item: { rarity: 'rare' } },
  },
  {
    id: 'q4', title: 'The Ganzir Stair',
    intro: 'The way is open. North, past the Ashen Approach, the First Gate waits. Its stair descends into Ganzir. Enter it.',
    objective: { type: 'enter', id: 'dungeon', text: 'Enter the Ganzir Stair beneath the First Gate' },
    marker: 'dungeon-entrance',
    reward: { xp: 300, gold: 150 },
  },
  {
    id: 'q5', title: 'Keeper of the First Gate',
    intro: 'Neti, Keeper of the First Gate, bars the descent. Strip him of his crown as he would strip you of yours.',
    objective: { type: 'boss', id: 'neti', text: 'Defeat Neti, Keeper of the First Gate' },
    marker: 'boss-neti',
    reward: { xp: 900, gold: 600, item: { rarity: 'legendary' } },
  },
];

export class QuestLog {
  constructor(state) {
    // index of the active quest; QUESTS.length means the chain is finished
    this.index = state?.index ?? 0;
    this.progress = state?.progress ?? 0;
    this.accepted = state?.accepted ?? false; // q1 must be accepted from Ninsun
    this.listeners = [];
  }

  get active() { return this.accepted ? QUESTS[this.index] ?? null : null; }
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
    if (o.type === 'kill' && event.type === 'kill' && event.region === o.region) hit = true;
    if (o.type === 'discover' && event.type === 'discover' && event.id === o.id) hit = true;
    if (o.type === 'named' && event.type === 'kill' && event.named === o.id) hit = true;
    if (o.type === 'enter' && event.type === 'enter' && event.id === o.id) hit = true;
    if (o.type === 'boss' && event.type === 'kill' && event.boss === o.id) hit = true;
    if (!hit) return null;
    this.progress++;
    if (this.progress >= (o.count ?? 1)) {
      this.index++;
      this.progress = 0;
      this.emit('completed', q);
      // Later quests auto-start (Ninsun briefs you through the tracker).
      if (!this.done) this.emit('accepted', QUESTS[this.index]);
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

  toJSON() { return { index: this.index, progress: this.progress, accepted: this.accepted }; }
}
