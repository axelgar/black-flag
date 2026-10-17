// The wire between a phone and a shared sea: what each says to the other, and how the
// sea's world is packed into a few kilobytes fifteen times a second and unpacked on the
// phone into a World the renderer, the HUD and the sound read exactly as if the phone
// were stepping it itself.
//
// The phone never steps a shared sea. It sends its helm, and draws what the sea says
// happened a moment ago, sliding every ship between the snapshots either side of that
// moment. How long a moment is, the phone works out from its wifi (see the Mirror).
//
// A snapshot carries only what changes and what a phone draws. The chart is rebuilt from
// its seed, a Spaniard's lines from her class, and a ball, which flies straight, is sent
// once when it is fired. Every captain is sent as anyone looking on sees her; her own
// guns, shells and takings go only to her own phone.

import { CLASSES } from '../data/enemies';
import { legendById } from '../data/legends';
import type { DropId } from '../data/drops';
import { angleTo, clamp } from '../core/vec';
import { rng } from '../core/rng';
import { wavePlan } from '../data/waves';
import { portsFor } from '../sim/spawn';
import type { Foe, FoeState, GameEvent, Phase, Player, Shot, World } from '../sim/types';
import * as Wo from '../sim/world';

export const WIRE = 2;
export type Mode = 'rivals' | 'crew';
export type Stage = 'lobby' | 'sailing' | 'results';

/* ------------------------------------------------------------ phone → sea -- */

/** Coming aboard: who (the Supabase access token says), in which ship, and, to open a
 *  private sea, how it plays. */
export interface Hello { t: 'hello'; v: number; token: string; ship: string; open?: Mode }
/** The helm, sent as it changes. The guns are counts of presses, so a press is fired
 *  once however the messages fall. */
export interface Helm { t: 'in'; h: number | null; r: number; s: number; fl: number; fr: number; mo: number }
export type ToSea = Hello | Helm;

/* ------------------------------------------------------------ sea → phone -- */

export interface Seat { id: number; seat: string; captain: string; ship: string; team: number; left: boolean }
export interface Score { id: number; captain: string; ship: string; plunder: number; sunk: number; boarded: number; sank: number }
export interface Welcome { t: 'welcome'; v: number; code: string; mode: Mode; cap: number }
export interface Nope { t: 'nope'; why: 'full' | 'unknown' | 'token' | 'ship' | 'version' | 'bad' }
/** Who is in which seat. Sent whenever it changes, and with every new chart. */
export interface Roster { t: 'roster'; seed: string; wave: number; pvp: boolean; cap: number; seats: Seat[] }
/** Where the round is. `left` is seconds to the end of this stage. */
export interface Round { t: 'round'; stage: Stage; mode: Mode; left: number; n: number; scores: Score[] }
export interface Snap {
  t: 's';
  at: number;              // the world's clock, seconds: the sim, and every event, is stamped with it
  ck: number;              // the sea's own clock, seconds. The world's stands still through a lobby
                           // and starts again with every chart; this one never does, so the phone
                           // keeps time by it
  ph: Phase; wave: number; boss: number;
  p: number[][];           // every captain, as anyone looking on sees her: [id, x, y, h, v, rot,
                           // sail, hull, hit, invuln, out | left << 1]
  me?: number[] | null;    // the phone's own captain's own (see mine()). Put on by the host, phone
                           // by phone: nobody else's phone needs to know her powder
  f: (number | string)[][]; // Spaniards
  s: number[][];           // balls fired since the last: [id, x, y, vx, vy, fired at, life, foe | chain << 1]
  sx: number[][];          // balls that ended early since the last, in a hull or on rock: [id, at]
  m: number[][];           // shells falling
  d: (number | string)[][]; // flotsam
  w: number[][];           // waterspouts
  e: GameEvent[];          // what happened since the last, each stamped `at`
}
export type FromSea = Welcome | Nope | Roster | Round | Snap;

/* ------------------------------------------------------------------ packing -- */

const q = (v: number, k = 100) => Math.round(v * k) / k;
const STATES: FoeState[] = ['patrol', 'engage', 'struck', 'spent'];

/**
 * The balls in the air, as the server has told the phones of them. A ball flies straight at
 * one speed until it splashes, so the phone needs to hear of it once, when it is fired, and
 * again only if it ends early. Sent every snapshot instead, balls were near half of every
 * byte of a busy sea. Note it after every step of the world, and flush it into each snapshot.
 */
export class ShotLog {
  private ids = new Map<Shot, number>();
  private n = 0;
  private fired: number[][] = [];
  private ended: number[][] = [];

  note(w: World) {
    // a ball the world has finished with is still marked dead, though culled from w.shots
    for (const [sh, id] of this.ids) {
      if (!sh.dead) continue;
      this.ids.delete(sh);
      if (sh.age < sh.life) this.ended.push([id, q(w.t, 1000)]);
    }
    for (const sh of w.shots) {
      if (this.ids.has(sh)) continue;
      const id = ++this.n;
      this.ids.set(sh, id);
      this.fired.push([
        id, q(sh.x - sh.vx * sh.age, 10), q(sh.y - sh.vy * sh.age, 10), q(sh.vx, 10), q(sh.vy, 10),
        q(w.t - sh.age, 1000), q(sh.life, 1000), (sh.foe ? 1 : 0) | (sh.kind === 'chain' ? 2 : 0),
      ]);
    }
  }

  flush(): { s: number[][]; sx: number[][] } {
    const out = { s: this.fired, sx: this.ended };
    this.fired = []; this.ended = [];
    return out;
  }

  /** A new chart: nothing in the air. The numbering runs on, so no phone mistakes one ball for another. */
  clear() { this.ids.clear(); this.fired = []; this.ended = []; }
}

/** The sea's world, as every phone needs it. `ck` is the sea's clock; `events` and the
 *  log's balls are those since the last snapshot. */
export function pack(w: World, ck: number, events: GameEvent[], log: ShotLog): Snap {
  const { s, sx } = log.flush();
  return {
    t: 's', at: q(w.t, 1000), ck: q(ck, 1000), ph: w.phase, wave: w.wave, boss: w.boss?.id ?? -1,
    p: w.players.map((c) => [
      c.id, q(c.x, 10), q(c.y, 10), q(c.h, 1000), q(c.v, 10), q(c.rot, 1000), q(c.sail), q(c.hull, 10), q(c.hit, 10),
      q(c.invuln, 10), (c.out ? 1 : 0) | (c.left ? 2 : 0),
    ]),
    f: w.foes.map((e) => [
      e.id, e.cls, e.L ? e.L.id : '', q(e.x, 10), q(e.y, 10), q(e.h, 1000), q(e.v, 10), q(e.rot, 1000), q(e.sail),
      q(e.hull, 10), q(e.hit, 10), q(e.flash, 10), STATES.indexOf(e.state), q(e.strikeT, 10), q(e.spentT, 10), q(e.broad, 10), e.broadSide,
      (e.alert ? 1 : 0) | (e.hunter ? 2 : 0) | (e.dead ? 4 : 0),
      e.ports ? e.ports.reduce((m, p, i) => m | (p.dead ? 1 << i : 0), 0) : 0, e.phase,
    ]),
    s, sx,
    m: w.marks.map((m) => [q(m.x, 10), q(m.y, 10), m.r, q(m.t), m.max, m.own ? 1 : 0]),
    d: w.drops.map((d) => [d.id, d.kind, q(d.x, 10), q(d.y, 10), q(d.age, 10), d.dur]),
    w: w.spouts.map((p) => [p.id, q(p.x, 10), q(p.y, 10), p.r, q(p.age, 10), p.life, q(p.vx), q(p.vy)]),
    e: events,
  };
}

/** What only a captain's own phone needs: her guns and shells for the HUD, her takings,
 *  her buffs, a boarding under way and where her mortar would land. */
export function mine(p: Player): number[] {
  return [
    p.shells, q(p.cool[0]), q(p.cool[1]), p.plunder, q(p.heat), p.lives, p.boarded, p.sunk,
    q(p.buffs.powder, 10), q(p.buffs.heavy, 10), q(p.buffs.chain, 10), p.buffs.swivel,
    p.board ? p.board.id : -1, p.board ? q(p.board.t) : 0,
    p.aim ? q(p.aim.x, 10) : 0, p.aim ? q(p.aim.y, 10) : 0, p.aim ? p.aim.lock : -1,
  ];
}

/* ---------------------------------------------------------------- the mirror -- */

// How far behind the sea a phone draws: far enough that the snapshot after the moment it
// draws is nearly always in hand already, near enough that the helm still feels like one.
// Snapshots come a GAP apart and wifi makes some of them late, so the phone keeps a few
// seconds' note of how late they come and stays a gap plus nearly all of that behind:
// about 0.08s on quiet wifi, a good deal more on a crowded one. It moves to that delay by
// running the picture a little fast or slow, never by stepping it back. (The picture used
// to step back by however late each late snapshot was, many times a minute on bar wifi.)
const QUICK = 3;      // the sea's clock is read off the quickest snapshot of this many seconds
const LATE = 8;       // how late snapshots have come, over this many seconds...
const COVER = 0.95;   // ...of which the delay covers this share
const SLIDE = 0.15;   // past the newest snapshot, ships sail on this long before they wait
const WARP = 0.08;    // the picture runs at most this much fast or slow while it settles
const LEAP = 0.4;     // further from its place than this, and it jumps there instead
const FIRST = 0.12;   // the delay until there is a second of snapshots to judge by

interface Ball { x: number; y: number; vx: number; vy: number; born: number; life: number; end: number; flags: number }

/**
 * The phone's copy of a shared sea: a real World, kept by the snapshots. Build it from a
 * roster, feed it every snapshot as it arrives, and call frame() each paint: it slides
 * every ship to where she was a moment ago and lets go of the events that happened by then.
 */
export class Mirror {
  world: World | null = null;
  /** How far behind the sea this phone is drawing, seconds. */
  delay = FIRST;
  private seed = '';
  private snaps: Snap[] = [];
  private heard: { now: number; off: number; late: number }[] = [];
  private best = 0;                         // the sea's clock less ours, off the quickest recent snapshot
  private gap = 1 / 15;                     // between snapshots, on the sea's clock
  private ck: number | null = null;         // the moment being drawn, on the sea's clock
  private last = 0;                         // our clock at the last frame
  private said = -1;                        // the latest event time already handed over
  private foes = new Map<number, Foe>();
  private balls = new Map<number, Ball>();

  /** Who is aboard, and on which chart. A new chart is a new world. */
  roster(r: Roster, me: string) {
    if (!this.world || r.seed !== this.seed) {
      this.seed = r.seed;
      this.world = Wo.create({ seed: r.seed, wave: r.wave, shared: r.cap, pvp: r.pvp });
      this.world.players.length = 0;
      this.snaps = []; this.foes.clear(); this.balls.clear(); this.said = -1;
      // as often as not a new chart is a new sea clock too (a server that restarted), so it
      // is judged afresh
      this.heard = []; this.ck = null; this.delay = FIRST;
    }
    const w = this.world;
    for (const s of r.seats) {
      const had = w.players[s.id];
      if (!had || had.shipId !== s.ship || had.seat !== s.seat) {
        w.players[s.id] = Wo.launch(w.map, { ship: s.ship, seat: s.seat, team: s.team, lives: 1 }, s.id, r.pvp);
      }
      w.players[s.id].left = s.left;
      if (s.left) w.players[s.id].out = true;
    }
    // any seat never filled is a ship that is not there
    for (let i = 0; i < w.players.length; i++) {
      if (!w.players[i]) { w.players[i] = Wo.launch(w.map, {}, i, r.pvp); w.players[i].out = w.players[i].left = true; }
    }
    const mine = r.seats.find((s) => s.seat === me && !s.left);
    w.focus = mine ? mine.id : Math.max(0, r.seats.findIndex((s) => !s.left));
  }

  /** A snapshot off the wire, as it arrives by our clock. */
  push(s: Snap, now: number) {
    // The sea's clock against ours: a snapshot can arrive late but never early, so the
    // quickest of the last few seconds says it best. Every other is that much late.
    const off = s.ck - now;
    let best = off;
    for (const h of this.heard) if (now - h.now <= QUICK && h.off > best) best = h.off;
    this.best = best;
    this.heard.push({ now, off, late: best - off });
    while (now - this.heard[0].now > LATE) this.heard.shift();
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && s.ck > prev.ck) this.gap += (Math.min(0.25, s.ck - prev.ck) - this.gap) * 0.1;
    const late = this.heard.map((h) => h.late).sort((x, y) => x - y);
    const want = this.gap + late[Math.floor((late.length - 1) * COVER)] + 0.012;
    this.delay = Math.min(0.5, this.heard.length < 15 ? Math.max(FIRST, want) : want);

    for (const r of s.s) this.balls.set(r[0], { x: r[1], y: r[2], vx: r[3], vy: r[4], born: r[5], life: r[6], end: r[5] + r[6], flags: r[7] });
    for (const [id, at] of s.sx) { const b = this.balls.get(id); if (b) b.end = Math.min(b.end, at); }
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
  }

  /** Where the sea is, a moment ago. */
  frame(now: number) {
    const w = this.world;
    if (!w || !this.snaps.length) return;
    const want = now + this.best - this.delay;
    if (this.ck == null || Math.abs(want - this.ck) > LEAP) this.ck = want;
    else {
      const dt = Math.max(0, now - this.last);
      this.ck += dt * (1 + clamp((want - this.ck - dt) * 2, -WARP, WARP));
    }
    this.last = now;
    const ck = this.ck;

    // the snapshots either side; past the newest, the last two, to slide on from
    const snaps = this.snaps, newest = snaps[snaps.length - 1];
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].ck > ck) i--;
    if (i === snaps.length - 1 && i > 0) i--;
    const a = snaps[i], b = snaps[Math.min(i + 1, snaps.length - 1)];
    const span = b.ck - a.ck;
    const k = span > 0 ? clamp((ck - a.ck) / span, 0, 1 + SLIDE / span) : 1;
    // the world's own time then: it stands still in a lobby, and runs with the clock otherwise
    const t = a.at + (b.at - a.at) * k;

    // what happened, as it comes due. Never past the newest snapshot's time, though the
    // ships slide on beyond it: what happened there has not been heard yet.
    for (const s of snaps) {
      for (const e of s.e) {
        const at = e.at as number;
        if (at <= this.said || at > t) continue;
        w.events.push(e);
      }
    }
    this.said = Math.max(this.said, Math.min(t, newest.at));
    if (w.events.length > 200) w.events.splice(0, w.events.length - 200);
    snaps.splice(0, Math.max(0, i - 1));      // keep one behind, for a late frame

    w.t = t; w.phase = b.ph;
    if (b.wave !== w.wave) {
      // the next wave's plan, and so its weather, is the chart's own: worked out, not sent
      w.wave = b.wave;
      w.plan = wavePlan(b.wave, rng(`${w.seed}:plan:${b.wave}`));
      w.weather = w.plan.weather;
    }
    this.captains(w, a, b, k);
    this.spaniards(w, a, b, k);
    w.shots = [];
    for (const [id, ball] of this.balls) {
      if (ball.end < t - 1) { this.balls.delete(id); continue; }
      if (t < ball.born || t >= ball.end) continue;
      const age = t - ball.born, foe = !!(ball.flags & 1), chain = !!(ball.flags & 2);
      w.shots.push({
        x: ball.x + ball.vx * age, y: ball.y + ball.vy * age, vx: ball.vx, vy: ball.vy, age, life: ball.life,
        r: chain ? 2.2 : 0.9, dmg: 0, foe, kind: chain ? 'chain' : 'ball', pierce: 1, dead: false, from: -1, by: -1, team: foe ? 0 : 1,
      });
    }
    w.marks = b.m.map((r) => ({ x: r[0], y: r[1], r: r[2], t: r[3], max: r[4], own: !!r[5], by: -1, at: -1, dmg: 0, done: false }));
    w.drops = b.d.map((r) => ({ id: r[0] as number, kind: r[1] as DropId, x: r[2] as number, y: r[3] as number, age: r[4] as number, dur: r[5] as number, dead: false }));
    w.spouts = b.w.map((r) => ({ id: r[0], x: r[1], y: r[2], r: r[3], age: r[4], life: r[5], vx: r[6], vy: r[7] }));
    w.boss = w.foes.find((e) => e.id === b.boss) ?? null;
  }

  private captains(w: World, a: Snap, b: Snap, k: number) {
    const prev = new Map(a.p.map((r) => [r[0], r]));
    for (const r of b.p) {
      const s = w.players[r[0]];
      if (!s) continue;
      slide(s, prev.get(r[0]) ?? r, r, k);
      s.hit = r[8]; s.invuln = r[9]; s.out = !!(r[10] & 1) || s.left;
    }
    // her own: the guns, shells and takings the HUD shows
    const me = w.players[w.focus], m = b.me ?? a.me;
    if (!me || !m) return;
    me.shells = m[0]; me.cool = [m[1], m[2]]; me.plunder = m[3]; me.heat = m[4]; me.lives = m[5]; me.boarded = m[6]; me.sunk = m[7];
    me.buffs = { powder: m[8], heavy: m[9], chain: m[10], swivel: m[11] };
    me.board = m[12] >= 0 ? { id: m[12], t: m[13] } : null;
    me.aim = m[16] >= 0 ? { x: m[14], y: m[15], lock: m[16] } : null;
  }

  private spaniards(w: World, a: Snap, b: Snap, k: number) {
    const prev = new Map(a.f.map((r) => [r[0] as number, r]));
    const live = new Set<number>();
    w.foes = [];
    for (const r of b.f) {
      const id = r[0] as number;
      live.add(id);
      let e = this.foes.get(id);
      if (!e) { e = ghost(w, id, r[1] as string, r[2] as string); this.foes.set(id, e); }
      const o = prev.get(id) ?? r;
      slide(e, [0, o[3], o[4], o[5], o[6], o[7], o[8], o[9]] as number[], [0, r[3], r[4], r[5], r[6], r[7], r[8], r[9]] as number[], k);
      e.hit = r[10] as number; e.flash = r[11] as number; e.state = STATES[r[12] as number];
      e.strikeT = r[13] as number; e.spentT = r[14] as number; e.broad = r[15] as number; e.broadSide = r[16] as -1 | 1;
      const f = r[17] as number;
      e.alert = !!(f & 1); e.hunter = !!(f & 2); e.dead = !!(f & 4);
      if (e.ports) { const mask = r[18] as number; e.ports.forEach((p, i) => { p.dead = !!(mask & (1 << i)); }); }
      e.phase = r[19] as number;
      w.foes.push(e);
    }
    for (const id of this.foes.keys()) if (!live.has(id)) this.foes.delete(id);
  }
}

/** Slide a ship between two snapshots (k past 1 sails her on from the newer): position and
 *  way on straight, heading round the short way; the rest as the newer one has it. */
function slide(s: { x: number; y: number; h: number; v: number; rot: number; sail: number; hull: number }, o: number[], r: number[], k: number) {
  s.x = o[1] + (r[1] - o[1]) * k;
  s.y = o[2] + (r[2] - o[2]) * k;
  s.h = o[3] + angleTo(o[3], r[3]) * k;
  s.v = o[4] + (r[4] - o[4]) * Math.min(1, k);
  s.rot = r[5]; s.sail = r[6]; s.hull = r[7];
}

/** A Spaniard as the phone knows her: her class's lines and numbers, placed by snapshots. */
function ghost(w: World, id: number, cls: string, legend: string): Foe {
  const L = legend ? legendById(legend) : null;
  const C = L ? null : CLASSES[cls];
  const R = L ? L.recipe : C!.recipe;
  const hullMax = L ? L.hull : C!.hull;
  return {
    id, cls, C, L, x: 0, y: 0, h: 0, v: 0, rot: 0, sail: 0.5,
    len: R.length, beam: R.beam, maxSpeed: (L ? L.speed : C!.speed) * w.speedMul, accel: 0, turnRate: 0,
    hull: hullMax, hullMax, hit: 0, dead: false,
    reales: L ? L.reales : C!.reales, ram: 0, strikes: !!C?.strikes,
    state: 'patrol', alert: false, squad: 0, wp: { x: 0, y: 0 }, wpT: 0, seeT: 0, orbit: 1,
    cool: 0, coolAlt: 0, broad: 0, broadSide: 1, strikeT: 0, struckOnce: false, by: -1, spentT: 0,
    hunter: false, chase: 0, slow: 0, ph: 0, ports: L ? portsFor(L) : null, phase: 0, flash: 0, detour: 0, seen: false,
  };
}

/** Which captain a seat string sails, in a roster, or -1. */
export const seatOf = (r: Roster, seat: string) => r.seats.find((s) => s.seat === seat && !s.left)?.id ?? -1;
