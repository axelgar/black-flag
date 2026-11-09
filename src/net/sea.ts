// A shared sea: the room a server keeps for everyone sailing it. Seats, every captain's
// hands, the bots, and the one world they all sail, stepped at the game's own fixed rate.
//
// Nothing here knows about sockets or servers. The host calls join(), leave() and
// helm() as messages arrive and step() about thirty times a second, and sends on what
// step() hands back, each snapshot with own() of the phone it goes to. That is what lets
// the tests sail whole nights with no server.
//
// How a shared sea plays: it is always open, and a captain sails in whenever she likes.
// A fleet of bots sails it whoever is aboard, and any more make up the numbers to minShips:
// one no longer needed stays until it is next sunk and doesn't come back. A captain who leaves out of a fight docks
// at once and her streak waits for her; one who leaves in a fight leaves her ship on the
// sea for `linger` seconds, where it can still be sunk.

import { MARKS } from '../data/colors';
import { LOOKS } from '../data/ships';
import { TUNING as T } from '../data/tuning';
import { botName } from '../sim/bots';
import * as Wo from '../sim/world';
import { NO_INPUT } from '../sim/world';
import { POWERS, type GameEvent, type Input, type World } from '../sim/types';
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
  hands: Helmsman;        // which of their hands she is sailed by, and when the next are due
  seen: { f: number; a: number; u: number[] };   // the presses already fired
  c: number;              // their colour
  ticket: boolean;        // sailing for a free shot: spent by a win
}

interface Bot { id: number; name: string; c: number }

export type Out = Roster | Snap;

const idle = (): Helm => ({ t: 'in', n: 0, m: null, f: 0, fa: 0, a: 0, u: POWERS.map(() => 0) });
const unseen = () => ({ f: 0, a: 0, u: POWERS.map(() => 0) });

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
      had.hands = new Helmsman(); had.seen = unseen();
      had.ticket = !!a.ticket;
      if (had.name !== a.name) { had.name = a.name; this.dirty = true; }
      return null;
    }
    if (this.hands.size >= this.cap) return 'full';
    const streak = this.kept.get(a.seat) ?? 0;
    this.kept.delete(a.seat);
    const p = Wo.join(this.world, { seat: a.seat, look: a.look, streak });
    this.hands.set(a.seat, { ...a, id: p.id, online: true, gone: 0, hands: new Helmsman(), seen: unseen(), c: this.color(a.seat), ticket: !!a.ticket });
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
    h.hands = new Helmsman(); h.seen = unseen();
  }

  /** The hands, as the phone last sent them. */
  helm(seat: string, m: Helm) {
    const h = this.hands.get(seat);
    if (!h || !h.online) return;
    h.hands.hear(m, this.clock);
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
    return p && h && !p.left ? mine(p, h.hands.ran) : null;
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
   * The fleet (T.bots) is always on the water, and more bots make up the numbers to minShips.
   * One too many (a captain came aboard) is told to leave the next time it sinks; one too few
   * brings back one that was leaving, or a new one.
   */
  private crew() {
    const w = this.world;
    for (let i = this.bots.length - 1; i >= 0; i--) {
      if (w.ships[this.bots[i].id]?.left) { this.bots.splice(i, 1); this.dirty = true; }
    }
    const want = Math.max(T.bots, T.minShips - this.hands.size);
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
        // she sails by her hands as her phone did; a press fires on the first tick after
        // it arrives, once
        const m = h.hands.heard, first = n === 0, way = h.hands.tick();
        const fire = first && m.f > h.seen.f ? m.fa : null;
        const auto = first && m.a > h.seen.a;
        // one power a step: a second pressed with it goes off the step after
        const u = Array.isArray(m.u) ? m.u : [];
        const power = first ? POWERS.findIndex((_, k) => (u[k] ?? 0) > h.seen.u[k]) : -1;
        inputs[h.id] = { move: way.m ? { x: way.m[0], y: way.m[1] } : null, fire, auto: fire == null && auto, power: power >= 0 ? power : null };
        if (first) { h.seen.f = m.f; h.seen.a = m.a; }
        if (power >= 0) h.seen.u[power] = u[power];
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

/* ---------------------------------------------------------- her hands -- */

// Her phone sails her the moment it sends her hands (net/lead.ts), and goes on by them until
// it sends the next. If the sea took each the moment it arrived, a wifi that brings one
// late and the next on time would have the sea sail her a different way from her phone,
// and her phone would be put right, over and over, the worse the line the more. So each of
// her hands says how long her phone sailed the ones before (`d`), and the sea sails those
// as long. Hands that arrive early wait their turn; late ones are taken as they come, and
// the sea makes up the ticks it fell behind by, one at a time, while the hands keep coming
// with time to spare. Hands that are very late (the line was gone a moment) are not made
// up: the sea goes straight to the newest.
const SPARE = 2;          // ticks: the least the next hands should wait before they are due
const BEHIND = 30;        // ticks behind her phone past which the sea goes straight to the newest
const LOOK_BACK = 2;      // seconds of hands arriving it judges how early they come by

/** Her hands as the sea sails her by them. */
class Helmsman {
  /** The hands she is sailed by, and for how many ticks so far. */
  now: Helm = idle();
  ran: Ran = { n: 0, ticks: 0 };
  /** The newest hands heard: their presses go off at once. */
  heard: Helm = idle();
  private next: Helm[] = [];
  /** As each of the hands came, how many ticks before it was due. */
  private early: { at: number; ticks: number }[] = [];

  hear(m: Helm, clock: number) {
    const last = this.next.length ? this.next[this.next.length - 1] : this.now;
    if (m.n === last.n) return;           // the same hands again: a line kept alive
    this.heard = m;
    // a phone that doesn't say how long it sailed them: at once, as they come
    if (typeof m.d !== 'number') { this.next = []; this.now = m; return; }
    this.next.push(m);
    this.early.push({ at: clock, ticks: this.toCome() });
    while (clock - this.early[0].at > LOOK_BACK) this.early.shift();
  }

  /** The hands to sail the next tick by. */
  tick(): Helm {
    while (this.next.length) {
      const due = this.next[0].d!, t = this.ran.ticks;
      const late = this.toCome() > BEHIND;
      const ahead = t === due - 1 && this.spare();
      if (t < due && !late && !ahead) break;
      if (ahead && !late) for (const e of this.early) e.ticks--;
      this.now = this.next.shift()!;
      this.ran = { n: this.now.n, ticks: 0 };
    }
    // hands taken at once, from a phone that doesn't say how long
    if (this.now.n !== this.ran.n) this.ran = { n: this.now.n, ticks: 0 };
    this.ran.ticks++;
    return this.now;
  }

  /** Ticks of her phone's sailing still to sail before the newest hands heard. */
  private toCome() {
    let n = -this.ran.ticks;
    for (const m of this.next) n += m.d!;
    return n;
  }

  /** Have the hands lately all come with ticks to spare? */
  private spare() {
    if (this.early.length < 4) return false;
    let least = Infinity;
    for (const e of this.early) least = Math.min(least, e.ticks);
    return least > SPARE;
  }
}
