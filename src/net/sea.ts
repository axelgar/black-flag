// A shared sea: the room a server keeps for everyone sailing it. Seats, every captain's
// hands, the bots, and the one world they all sail, stepped at the game's own fixed rate.
//
// Nothing here knows about sockets or Cloudflare. The host calls join(), leave() and
// helm() as messages arrive and step() about thirty times a second, and sends on what
// step() hands back, each snapshot with own() of the phone it goes to. That is what lets
// the tests sail whole nights with no server.
//
// How a shared sea plays: it is always open, and a captain sails in whenever she likes.
// Bots make up the numbers to minShips; when a captain comes aboard, one of them stays
// until it is next sunk and doesn't come back. A captain who leaves out of a fight docks
// at once and her streak waits for her; one who leaves in a fight leaves her ship on the
// sea for `linger` seconds, where it can still be sunk.

import { MARKS } from '../data/colors';
import { LOOKS } from '../data/ships';
import { TUNING as T } from '../data/tuning';
import { botName } from '../sim/bots';
import * as Wo from '../sim/world';
import { NO_INPUT } from '../sim/world';
import type { GameEvent, Input, World } from '../sim/types';
import { ShotLog, mine, pack, type Helm, type Nope, type Ran, type Roster, type Snap } from './protocol';

export const HUES = MARKS;        // colours, each solid and dashed on the bar's screen (data/colors.ts)
/** A phone that drops off out of a fight docks after this long, so a moment's wifi does not move her. */
export const BLIP = 3;
const FIXED = 1 / 120;
const SNAP_EVERY = 2;             // a snapshot every other step(): fifteen a second at thirty

/** Who is coming aboard: the server has checked the token and the name, and asked the
 *  database whether they hold a ticket tonight. */
export interface Aboard { seat: string; name: string; look: string; ticket?: boolean }

/** Five in a row by a captain, for the host to write down: a free shot if `prize`. */
export interface Win { seat: string; prize: boolean }

interface Hand extends Aboard {
  id: number;             // their ship's place in the world
  online: boolean;
  gone: number;           // when the phone dropped off, by the sea's clock
  helm: Helm;
  seen: { f: number; a: number };   // the presses already fired
  ran: Ran;               // which of their hands she is sailing by, and for how many ticks
  c: number;              // their colour
  ticket: boolean;        // sailing for a free shot: spent by a win
}

interface Bot { id: number; name: string; c: number }

export type Out = Roster | Snap;

const idle = (): Helm => ({ t: 'in', n: 0, m: null, f: 0, fa: 0, a: 0 });

export class Sea {
  readonly code: string;
  readonly cap: number;
  world: World;
  clock = 0;               // seconds since the sea was opened
  /** Streaks of captains who docked out of a fight, kept for when they come back. */
  readonly kept = new Map<string, number>();
  private hands = new Map<string, Hand>();
  private bots: Bot[] = [];
  private botsMade = 0;
  private acc = 0;
  private calls = 0;
  private events: GameEvent[] = [];
  private shots = new ShotLog();
  private dirty = true;    // the roster has changed since it was last sent
  private colors = new Map<string, number>();   // every captain's colour tonight, aboard or not
  private wins: Win[] = [];

  constructor(code: string, opts: { cap?: number; seed?: string } = {}) {
    this.code = code;
    this.cap = opts.cap ?? T.maxShips;
    this.world = Wo.create({ seed: `${code}:${opts.seed ?? Math.random().toString(36).slice(2, 10)}` });
  }

  /** Captains aboard, online or with a ship still lingering. */
  get aboard() { return this.hands.size; }

  /** A captain comes aboard, or back aboard after a dropped connection. */
  join(a: Aboard): Nope['why'] | null {
    const had = this.hands.get(a.seat);
    if (had) {
      // a new line is a new phone's count of hands, from nothing
      had.online = true;
      had.helm = idle(); had.seen = { f: 0, a: 0 }; had.ran = { n: 0, ticks: 0 };
      had.ticket = !!a.ticket;
      if (had.name !== a.name) { had.name = a.name; this.dirty = true; }
      return null;
    }
    if (this.hands.size >= this.cap) return 'full';
    const streak = this.kept.get(a.seat) ?? 0;
    this.kept.delete(a.seat);
    const p = Wo.join(this.world, { seat: a.seat, look: a.look, streak });
    this.hands.set(a.seat, { ...a, id: p.id, online: true, gone: 0, helm: idle(), seen: { f: 0, a: 0 }, ran: { n: 0, ticks: 0 }, c: this.color(a.seat), ticket: !!a.ticket });
    this.drain();
    this.crew();
    this.dirty = true;
    return null;
  }

  /** The phone went ashore (the Leave button) or dropped off: see step() for what happens to her ship. */
  leave(seat: string) {
    const h = this.hands.get(seat);
    if (!h || !h.online) return;
    h.online = false; h.gone = this.clock;
    h.helm = idle(); h.seen = { f: 0, a: 0 }; h.ran = { n: 0, ticks: 0 };
  }

  /** The hands, as the phone last sent them. */
  helm(seat: string, m: Helm) {
    const h = this.hands.get(seat);
    if (!h || !h.online) return;
    h.helm = m;
  }

  /** The sea's heartbeat. Returns what every phone aboard should be sent. */
  step(dt: number): Out[] {
    const out: Out[] = [];
    this.clock += dt;
    this.ashore();
    this.sail(dt);
    if (this.dirty) { out.push(this.roster()); this.dirty = false; }
    if (++this.calls % SNAP_EVERY === 0) {
      out.push(pack(this.world, this.clock, this.events, this.shots));
      this.events = [];
    }
    return out;
  }

  /** What only this captain's own phone is sent with each snapshot: her guns (see mine()). */
  own(seat: string): number[] | null {
    const h = this.hands.get(seat);
    const p = h ? this.world.ships[h.id] : null;
    return p && h && !p.left ? mine(p, h.ran) : null;
  }

  /** Who is in which seat, under what name, in which colour. Two captains of the same name
   *  are told apart by a number, Jack and Jack II. */
  roster(): Roster {
    const w = this.world;
    const hands = [...this.hands.values()];
    const named = new Map<string, number>();
    const seats = w.ships.map((p) => {
      const h = hands.find((x) => x.id === p.id);
      const b = this.bots.find((x) => x.id === p.id);
      if (p.left || (!h && !b)) return { id: p.id, seat: '', name: '', look: p.look, bot: false, left: true, c: -1 };
      const base = h ? h.name : b!.name;
      const n = (named.get(base.toLowerCase()) ?? 0) + 1;
      named.set(base.toLowerCase(), n);
      const name = n === 1 ? base : `${base} ${ROMAN[n] ?? n}`;
      return { id: p.id, seat: h ? h.seat : '', name, look: p.look, bot: !h, left: false, c: h ? h.c : b!.c };
    });
    return { t: 'roster', seed: w.seed, seats };
  }

  /**
   * A captain's colour, kept all night so the table can find her by it. The one she had
   * before, if nobody aboard has it now; otherwise the least worn. Bots take theirs the
   * same way.
   */
  private color(seat: string | null): number {
    const worn = new Array<number>(HUES).fill(0);
    for (const h of this.hands.values()) worn[h.c]++;
    for (const b of this.bots) worn[b.c]++;
    const had = seat != null ? this.colors.get(seat) : undefined;
    const c = had != null && !worn[had] ? had : worn.indexOf(Math.min(...worn));
    if (seat != null) this.colors.set(seat, c);
    return c;
  }

  /* ------------------------------------------------------------ the crew -- */

  /**
   * Bots make up the numbers to minShips. One too many (a captain came aboard) is told to
   * leave the next time it sinks; one too few brings back one that was leaving, or a new one.
   */
  private crew() {
    const w = this.world;
    for (let i = this.bots.length - 1; i >= 0; i--) {
      if (w.ships[this.bots[i].id]?.left) { this.bots.splice(i, 1); this.dirty = true; }
    }
    const want = Math.max(0, T.minShips - this.hands.size);
    const staying = this.bots.filter((b) => !w.ships[b.id].retire);
    for (let i = staying.length - 1; i >= want; i--) w.ships[staying[i].id].retire = true;
    let n = staying.length;
    for (const b of this.bots) {
      if (n >= want) break;
      const s = w.ships[b.id];
      if (s.retire) { s.retire = false; n++; }
    }
    for (; n < want; n++) {
      const s = Wo.join(w, { bot: true, look: LOOKS[this.botsMade % LOOKS.length].id });
      this.bots.push({ id: s.id, name: botName(this.botsMade++), c: this.color(null) });
      this.dirty = true;
    }
  }

  /**
   * Captains whose phones are gone. Out of a fight, a ship docks once the phone has been
   * gone a moment (BLIP), and her streak is kept. In one, she sails on for `linger`
   * seconds, hove to on her last course, and can still be sunk; then she docks with what
   * streak she still has.
   */
  private ashore() {
    const w = this.world;
    for (const [seat, h] of this.hands) {
      if (h.online) continue;
      const s = w.ships[h.id];
      const away = this.clock - h.gone;
      const calm = s.out || s.calm >= T.calm;
      if (!(calm && away >= BLIP) && away < T.linger) continue;
      if (s.streak > 0) this.kept.set(seat, s.streak);
      Wo.leave(w, h.id);
      this.hands.delete(seat);
      this.dirty = true;
    }
    this.crew();
  }

  private sail(dt: number) {
    const w = this.world;
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED && n < 12) {
      const inputs: Input[] = [];
      for (const h of this.hands.values()) {
        if (!h.online) { inputs[h.id] = NO_INPUT; continue; }
        const m = h.helm, first = n === 0;
        // a press fires on the first tick after it arrives, once
        const fire = first && m.f > h.seen.f ? m.fa : null;
        const auto = first && m.a > h.seen.a;
        inputs[h.id] = { move: m.m ? { x: m.m[0], y: m.m[1] } : null, fire, auto: fire == null && auto };
        if (first) h.seen = { f: m.f, a: m.a };
        if (m.n !== h.ran.n) h.ran = { n: m.n, ticks: 0 };
        h.ran.ticks++;
      }
      Wo.step(w, FIXED, inputs);
      this.shots.note(w);
      this.drain();
      this.acc -= FIXED; n++;
    }
    if (n === 12) this.acc = 0;       // a long stall is a dropped beat, not a debt
  }

  /** Take what the world just said and stamp it with the time. Its numbers go out to the
   *  centimetre: a full-length float is eighteen characters on the wire. */
  private drain() {
    const w = this.world;
    for (const e of w.events) {
      for (const f in e) { const v = e[f]; if (typeof v === 'number' && !Number.isInteger(v)) e[f] = Math.round(v * 100) / 100; }
      e.at = Math.round(w.t * 1000) / 1000;
      if (e.k === 'won') this.won(e);
      this.events.push(e);
      if (e.k === 'left' || e.k === 'joined') this.dirty = true;
    }
    w.events.length = 0;
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  /** Five in a row: a free shot on a ticket, which it spends, and practice without. Every
   *  phone is told which, and the host is handed the win to write down. A bot's is practice. */
  private won(e: GameEvent) {
    let h: Hand | null = null;
    for (const x of this.hands.values()) if (x.id === e.p) h = x;
    e.prize = !!h?.ticket;
    if (!h) return;
    this.wins.push({ seat: h.seat, prize: h.ticket });
    h.ticket = false;
  }

  /** The wins since last asked, for the host to write down. */
  takeWins(): Win[] {
    return this.wins.splice(0);
  }
}

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
