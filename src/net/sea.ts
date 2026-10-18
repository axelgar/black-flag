// A shared sea: the room a server keeps for everyone sailing it. Seats, rounds, every
// captain's helm, and the one world they all sail, stepped at the game's own fixed rate.
//
// Nothing here knows about sockets or Cloudflare. The host calls join(), leave() and
// helm() as messages arrive and step() about thirty times a second, and sends on what
// step() hands back, each snapshot with own() of the phone it goes to. That is what lets
// the tests sail whole rounds with no server.
//
// How a shared sea plays:
//   lobby    the first captain aboard opens it; LOBBY seconds for the table to join
//   sailing  ROUND seconds of waves on one chart. A clear sea brings the next wave after a
//            breather. A ship that goes down pays TOLL of her plunder (to whoever sank
//            her, among rivals) and is back afloat RESPAWN seconds later.
//   results  the scoreboard, then the next round on a new chart
// Rivals can fire on each other; crew cannot. Everyone sails her ship's own numbers:
// Nassau's upgrades are for a run on your own, not for a sea you are ranked on.

import { MARKS } from '../data/colors';
import { NO_INPUT } from '../sim/world';
import * as Wo from '../sim/world';
import type { GameEvent, Input, World } from '../sim/types';
import { ShotLog, mine, pack, type Helm, type Mode, type Nope, type Round, type Roster, type Score, type Snap, type Stage } from './protocol';

export const CAP = 30;            // ships to a sea: a busy night's whole bar on one chart
export const ROUND = 8 * 60;      // a round is about one drink
export const LOBBY = 10;          // before the first round: time for the table to come aboard
export const RESULTS = 15;        // the scoreboard between rounds
export const BREATHER = 6;        // a clear sea, before the next wave puts to sea
export const RESPAWN = 5;         // a ship that goes down is back afloat after this
export const TOLL = 0.25;         // of her plunder, when she goes down
export const GRACE = 20;          // a phone that drops off keeps its seat this long
export const HUES = MARKS;        // marks on the bar's screen: each color, solid and dashed (data/colors.ts)
const FIXED = 1 / 120;
const SNAP_EVERY = 2;             // a snapshot every other step(): fifteen a second at thirty

/** Who is coming aboard: the server has checked the token, the name and the ship. */
export interface Aboard { seat: string; captain: string; ship: string }

interface Hand extends Aboard {
  id: number;             // their ship's place in the world; -1 until there is one
  online: boolean;
  gone: number;           // when the phone dropped off, by the sea's clock
  helm: Helm;
  seen: { fl: number; fr: number; mo: number };   // the presses already fired
  sank: number;           // rival captains sent down this round
  down: number;           // when their ship went down, or -1
  c: number;              // their color on the bar's screen
}

export type Out = Round | Roster | Snap;

const idle = (): Helm => ({ t: 'in', h: null, r: 0, s: 1, fl: 0, fr: 0, mo: 0 });

export class Sea {
  readonly code: string;
  readonly mode: Mode;
  readonly cap: number;
  readonly roundFor: number;
  stage: Stage = 'lobby';
  left = LOBBY;            // seconds to the end of this stage
  n = 0;                   // rounds begun
  world: World | null = null;
  clock = 0;               // seconds since the sea was opened
  private hands = new Map<string, Hand>();
  private acc = 0;
  private calls = 0;
  private events: GameEvent[] = [];
  private shots = new ShotLog();
  private clearFor = 0;
  private dirty = false;   // the roster has changed since it was last sent
  private told = { stage: '' as Stage | '', second: -1 };
  private seed: () => string;
  private colors = new Map<string, number>();   // every captain's color tonight, aboard or not

  constructor(code: string, mode: Mode, opts: { cap?: number; seed?: () => string; round?: number } = {}) {
    this.code = code;
    this.mode = mode;
    this.cap = opts.cap ?? CAP;
    this.roundFor = opts.round ?? ROUND;
    this.seed = opts.seed ?? (() => Math.random().toString(36).slice(2, 10));
  }

  /** Captains aboard, online or keeping a seat through a dropped connection. */
  get aboard() { return this.hands.size; }

  /** A captain comes aboard, or back aboard after a dropped connection. */
  join(a: Aboard): Nope['why'] | null {
    const had = this.hands.get(a.seat);
    if (had) {
      had.online = true; had.captain = a.captain;
      this.dirty = true;
      return null;
    }
    if (this.hands.size >= this.cap) return 'full';
    const h: Hand = { ...a, id: -1, online: true, gone: 0, helm: idle(), seen: { fl: 0, fr: 0, mo: 0 }, sank: 0, down: -1, c: this.color(a.seat) };
    if (!this.world) {
      // the first aboard opens the sea: a chart to look at while the table comes aboard
      this.hands.set(a.seat, h);
      this.stage = 'lobby'; this.left = LOBBY;
      this.world = this.fresh();
    } else {
      const p = Wo.join(this.world, { ship: a.ship, seat: a.seat, lives: 1 });
      if (!p) return 'full';
      h.id = p.id;
      this.hands.set(a.seat, h);
    }
    this.dirty = true;
    return null;
  }

  /** The phone dropped off. Their ship keeps the seat for GRACE seconds, hove to. */
  leave(seat: string) {
    const h = this.hands.get(seat);
    if (!h || !h.online) return;
    h.online = false; h.gone = this.clock;
    h.helm = idle();
  }

  /** The helm, as the phone last sent it. */
  helm(seat: string, m: Helm) {
    const h = this.hands.get(seat);
    if (!h || !h.online) return;
    h.helm = m;
  }

  /** The sea's heartbeat. Returns what every phone aboard should be sent. */
  step(dt: number): Out[] {
    const out: Out[] = [];
    this.clock += dt;
    for (const [seat, h] of this.hands) {
      if (h.online || this.clock - h.gone < GRACE) continue;
      this.hands.delete(seat);
      if (this.world && h.id >= 0) Wo.leave(this.world, h.id);
      this.dirty = true;
    }
    if (!this.hands.size) {
      // nobody left aboard: the sea waits, empty, for the next to open it. A screen looking
      // on is told once, by a round with nobody in it.
      const was = this.world;
      this.stage = 'lobby'; this.left = LOBBY; this.world = null; this.told = { stage: '', second: -1 };
      if (was) out.push(this.round());
      return out;
    }

    this.left -= dt;
    if (this.stage === 'lobby' && this.left <= 0) this.begin(false);
    else if (this.stage === 'sailing') { this.sail(dt); if (this.left <= 0) this.end(); }
    else if (this.stage === 'results' && this.left <= 0) this.begin(true);

    if (this.dirty && this.world) { out.push(this.roster()); this.dirty = false; }
    const second = Math.max(0, Math.ceil(this.left));
    if (this.told.stage !== this.stage || this.told.second !== second) {
      out.push(this.round());
      this.told = { stage: this.stage, second };
    }
    if (++this.calls % SNAP_EVERY === 0 && this.world) {
      out.push(pack(this.world, this.clock, this.events, this.shots));
      this.events = [];
    }
    return out;
  }

  /** What only this captain's own phone is sent with each snapshot: her guns, shells and
   *  takings (see mine()). Null for a seat with no ship on the water. */
  own(seat: string): number[] | null {
    const h = this.hands.get(seat), w = this.world;
    const p = h && w && h.id >= 0 ? w.players[h.id] : null;
    return p && !p.left ? mine(p) : null;
  }

  /** Where the round is, and who is winning it. */
  round(): Round {
    return { t: 'round', stage: this.stage, mode: this.mode, left: Math.max(0, Math.ceil(this.left)), n: this.n, scores: this.scores() };
  }

  /** Who is in which seat, on which chart. */
  roster(): Roster {
    const w = this.world!;
    const seats = w.players.map((p) => {
      const h = [...this.hands.values()].find((x) => x.id === p.id);
      return h && !p.left
        ? { id: p.id, seat: h.seat, captain: h.captain, ship: p.shipId, team: p.team, left: false, c: h.c }
        : { id: p.id, seat: '', captain: '', ship: p.shipId, team: p.team, left: true, c: -1 };
    });
    return { t: 'roster', seed: w.seed, wave: w.wave, pvp: w.pvp, cap: this.cap, seats };
  }

  scores(): Score[] {
    const w = this.world;
    if (!w) return [];
    const rows: Score[] = [];
    for (const h of this.hands.values()) {
      const p = h.id >= 0 ? w.players[h.id] : null;
      if (!p || p.left) continue;
      rows.push({ id: p.id, captain: h.captain, ship: p.shipId, plunder: p.plunder, sunk: p.sunk, boarded: p.boarded, sank: h.sank });
    }
    return rows.sort((a, b) => b.plunder - a.plunder || b.sank - a.sank || b.sunk - a.sunk || a.id - b.id);
  }

  /**
   * A captain's color on the bar's screen, kept all night so the table can find her by it.
   * The one she had before, if nobody aboard has it now; otherwise the first nobody aboard
   * has. Past HUES aboard they repeat, the least worn first, and her name tells her apart.
   */
  private color(seat: string): number {
    const worn = new Array<number>(HUES).fill(0);
    for (const h of this.hands.values()) worn[h.c]++;
    const had = this.colors.get(seat);
    const c = had != null && !worn[had] ? had : worn.indexOf(Math.min(...worn));
    this.colors.set(seat, c);
    return c;
  }

  /* ------------------------------------------------------------ the round -- */

  /** A new chart with everyone aboard on it, numbered in the order they came aboard. */
  private fresh(): World {
    const hands = [...this.hands.values()];
    const w = Wo.create({
      seed: `${this.code}:${this.n + 1}:${this.seed()}`, wave: 1,
      players: hands.map((h) => ({ ship: h.ship, seat: h.seat, lives: 1 })),
      shared: this.cap, pvp: this.mode === 'rivals',
    });
    hands.forEach((h, i) => { h.id = i; });
    this.shots.clear();
    return w;
  }

  private begin(freshChart: boolean) {
    if (freshChart || !this.world) this.world = this.fresh();
    for (const h of this.hands.values()) { h.sank = 0; h.down = -1; h.seen = { fl: h.helm.fl, fr: h.helm.fr, mo: h.helm.mo }; }
    this.n++;
    this.stage = 'sailing';
    this.left = this.roundFor;
    this.acc = 0; this.clearFor = 0; this.events = [];
    this.dirty = true;
  }

  private end() {
    this.stage = 'results';
    this.left = RESULTS;
  }

  private sail(dt: number) {
    const w = this.world!;
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED && n < 12) {
      const inputs: Input[] = [];
      for (const h of this.hands.values()) {
        if (h.id < 0) continue;
        if (!h.online) { inputs[h.id] = NO_INPUT; continue; }
        const m = h.helm, first = n === 0;
        // a press fires on the first tick after it arrives, once
        inputs[h.id] = {
          heading: m.h, rudder: m.r, sail: m.s,
          fireL: first && m.fl > h.seen.fl, fireR: first && m.fr > h.seen.fr, mortar: first && m.mo > h.seen.mo,
        };
        if (first) h.seen = { fl: m.fl, fr: m.fr, mo: m.mo };
      }
      Wo.step(w, FIXED, inputs);
      this.shots.note(w);
      this.drain(w);
      this.acc -= FIXED; n++;
    }
    if (n === 12) this.acc = 0;       // a long stall is a dropped beat, not a debt

    if (w.phase === 'clear') {
      this.clearFor += dt;
      if (this.clearFor >= BREATHER) { Wo.nextWave(w); this.clearFor = 0; this.drain(w); }
    } else this.clearFor = 0;

    for (const h of this.hands.values()) {
      const p = h.id >= 0 ? w.players[h.id] : null;
      if (p && p.out && !p.left && h.down >= 0 && this.clock - h.down >= RESPAWN) {
        Wo.refloat(w, p);
        h.down = -1;
        this.drain(w);
      }
    }
  }

  /** Take what the world just said, stamp it with the time, and act on what a shared sea
   *  has rules for. Its numbers go out to the centimetre: a full-length float is eighteen
   *  characters on the wire, and a busy sea says a few hundred of them a second. */
  private drain(w: World) {
    for (const e of w.events) {
      for (const f in e) { const v = e[f]; if (typeof v === 'number' && !Number.isInteger(v)) e[f] = Math.round(v * 100) / 100; }
      e.at = Math.round(w.t * 1000) / 1000;
      this.events.push(e);
      if (e.k === 'dead') this.sunk(w, e);
    }
    w.events.length = 0;
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  /** A ship went down: she pays her toll, and is back afloat after RESPAWN. */
  private sunk(w: World, e: GameEvent) {
    const p = w.players[e.p as number];
    const h = [...this.hands.values()].find((x) => x.id === p.id);
    if (h) h.down = this.clock;
    const toll = Math.floor(p.plunder * TOLL);
    p.plunder -= toll;
    const by = typeof e.by === 'number' && this.mode === 'rivals' ? w.players[e.by] : null;
    if (by) {
      by.plunder += toll;
      const bh = [...this.hands.values()].find((x) => x.id === by.id);
      if (bh) bh.sank++;
    }
    this.events.push({ k: 'toll', p: p.id, by: by?.id, reales: toll, at: Math.round(w.t * 1000) / 1000 });
  }
}
