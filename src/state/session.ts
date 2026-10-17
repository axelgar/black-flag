// What this device remembers: preferences, the record book, the captain's log, which
// ships are yours, and the run in progress. localStorage, one key.

import { STARTER, SHIPS } from '../data/ships';
import type { Tap } from '../net/items';

export type { Tap, Via } from '../net/items';

export type Quality = 'auto' | 'low' | 'high';

export interface Records {
  bestWave: number; bestPlunder: number; bestTime: number;
  runs: number; boarded: number; sunk: number; legends: number;
}

export interface Run {
  seed: string;
  ship: string;
  wave: number;
  plunder: number;
  lives: number;
  upgrades: Record<string, number>;
  heat: number;
  boarded: number;
  sunk: number;
  time: number;
  bribes: number;
  legends: number;
}

export interface RunSummary { wave: number; time: number; plunder: number; boarded: number; sunk: number; ship: string }


export interface Session {
  v: 2;
  sound: boolean; haptics: boolean; reduceMotion: boolean;
  fullscreen: boolean;               // on a phone that allows it, the sea takes the whole screen
  quality: Quality;
  records: Records;
  seen: Record<string, number>;      // class or legend id → times met
  beaten: Record<string, number>;    // legend id → times beaten
  unlocked: string[];                // ship ids
  ship: string;                      // the one she sails in next
  run: Run | null;
  lastRun: RunSummary | null;
  captain: string | null;            // the name the server knows this player by, once it does
  outbox: Tap[];                     // taps not yet sent: bar wifi comes and goes
}

const KEY = 'blackflag.v2';
const V1 = 'blackflag.log';
/** Where the server sign-in keeps itself (src/net/cloud.ts), and anything it keys off it. */
export const AUTH_KEY = 'blackflag.auth';

const blank = (): Session => ({
  v: 2,
  sound: true, haptics: true, reduceMotion: false, fullscreen: true, quality: 'auto',
  records: { bestWave: 0, bestPlunder: 0, bestTime: 0, runs: 0, boarded: 0, sunk: 0, legends: 0 },
  seen: {}, beaten: {},
  unlocked: [STARTER], ship: STARTER,
  run: null, lastRun: null,
  captain: null, outbox: [],
});

const store = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

function load(): Session {
  const ls = store();
  try {
    const raw = ls?.getItem(KEY);
    if (raw) return sanitise({ ...blank(), ...JSON.parse(raw) });
    // A captain who sailed v1 keeps their record book and their log. The run in progress
    // does not survive: it was fought on a different sea.
    const old = ls?.getItem(V1);
    if (old) {
      const o = JSON.parse(old);
      const s = blank();
      if (o.records) s.records = { ...s.records, ...o.records };
      s.seen = o.seen || {}; s.beaten = o.beaten || {};
      s.sound = o.sound ?? true; s.haptics = o.haptics ?? true; s.reduceMotion = !!o.reduceMotion;
      return s;
    }
  } catch { /* a corrupt log is a blank log */ }
  return blank();
}

/** Anything a stale or hand-edited save could have got wrong, put right. */
function sanitise(s: Session): Session {
  const known = new Set(SHIPS.map((x) => x.id));
  s.unlocked = [...new Set([STARTER, ...(s.unlocked || []).filter((id) => known.has(id))])];
  if (!s.unlocked.includes(s.ship)) s.ship = STARTER;
  if (s.run && !known.has(s.run.ship)) s.run = null;
  if (!Array.isArray(s.outbox)) s.outbox = [];
  return s;
}

export const session: Session = load();

// The path the router last left, and the trail of screens back to the last root one.
// Screens reachable from more than one place read it so their ✕ goes back where the
// guest came from. Deliberately not persisted.
export const nav: { from: string | null; trail: string[] } = { from: null, trail: [] };

// The seed of the next run's chart, rolled by the host ahead of time. Not persisted.
export const sea = { next: 'nassau' };

export function save() {
  // The record book is still this device's own; what the player owns is kept on the server too
  // (src/net/cloud.ts), and a leaderboard will read from there.
  try {
    const ls = store();
    if (!ls) return;
    // A QR code opens a second tab, which unlocks her there and saves. This tab's session
    // was loaded before that, and saving it whole would put the ship back off the register.
    mergeUnlocked(ls.getItem(KEY));
    ls.setItem(KEY, JSON.stringify(session));
  } catch { /* private mode */ }
}

/** Ships unlocked in another tab are ours too. */
function mergeUnlocked(raw: string | null) {
  if (!raw) return;
  try {
    const theirs = (JSON.parse(raw) as Partial<Session>).unlocked;
    if (!Array.isArray(theirs)) return;
    const known = new Set(SHIPS.map((x) => x.id));
    for (const id of theirs) if (known.has(id) && !session.unlocked.includes(id)) session.unlocked.push(id);
  } catch { /* a corrupt save has nothing to add */ }
}
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => { if (e.key === KEY) mergeUnlocked(e.newValue); });
}

export function wipe() {
  try {
    const ls = store();
    if (!ls) return;
    ls.removeItem(KEY); ls.removeItem(V1);
    // and the sign-in with it: burning the log starts a new captain, not the same one
    // with an empty hold
    for (const k of Object.keys(ls)) if (k.startsWith(AUTH_KEY)) ls.removeItem(k);
  } catch { /* private mode */ }
}

/** Returns true if this is news — the ship was not already hers. */
export function unlockShip(id: string): boolean {
  if (session.unlocked.includes(id)) return false;
  session.unlocked.push(id);
  save();
  return true;
}

export function meet(id: string) {
  session.seen[id] = (session.seen[id] || 0) + 1;
  // not saved here — the sim meets a lot of ships a wave. The host saves at wave end.
}

export function beat(legendId: string) {
  session.beaten[legendId] = (session.beaten[legendId] || 0) + 1;
  session.records.legends = Object.values(session.beaten).reduce((a, b) => a + b, 0);
  save();
}
