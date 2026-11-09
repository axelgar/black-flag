// The wire between a phone and a shared sea: what each says to the other, and how the
// sea's world is packed into a few kilobytes fifteen times a second and unpacked on the
// phone into a World the renderer, the HUD and the sound read exactly as if the phone
// were stepping it itself.
//
// The phone sends its hands (the sticks and the taps) and draws what the sea says
// happened a moment ago, sliding every ship between the snapshots either side of that
// moment. How long a moment is, the phone works out from its line (see the Mirror); when
// the next snapshot is late, it sails them on rather than stopping them. Every message is
// deflated on the line (server/src/index.ts), and a phone whose line falls behind is held
// back rather than sent more than it can take (net/post.ts).
//
// A snapshot carries only what changes and what a phone draws. The chart is rebuilt from
// its seed, and a ball, which flies straight, is sent once when it is fired. Every ship is
// sent as anyone looking on sees her; her own guns go only to her own phone.

import { angleTo, clamp, wrap } from '../core/vec';
import { CRATES, type CrateKind, type GameEvent, type Ship, type World } from '../sim/types';
import * as Wo from '../sim/world';

export const WIRE = 5;

/* ------------------------------------------------------------ phone → sea -- */

/** Coming aboard: who (the Supabase access token says), under what name, in which look. */
export interface Hello { t: 'hello'; v: number; token: string; name: string; look: string }
/**
 * The hands, sent as they change. `m` is the left stick on the chart (north up), or null
 * when let go. The guns are counts of presses, so a press is fired once however the
 * messages fall: `f` volleys aimed by a drag, the last of them along `fa`; `a` quick taps;
 * `u` presses on each power, in POWERS order (left out by a phone without them).
 * `n` numbers the hands, one more each time they change, so the phone knows which of its
 * own the sea has sailed her by (see mine() and net/lead.ts). `d` is how many ticks the
 * phone sailed her by the hands before these: the sea sails them as long (net/sea.ts).
 * `k` is the sea's clock at the newest snapshot the phone has heard (net/post.ts).
 */
export interface Helm { t: 'in'; n: number; m: [number, number] | null; f: number; fa: number; a: number; u?: number[]; d?: number; k?: number }
/** Going ashore from the Leave button. A dropped line is taken the same way. */
export interface Ashore { t: 'leave' }
/** Looking on, from the bar's screen: no seat and no ship, only the watch key the sea's
 *  server holds. Sent instead of a hello. */
export interface Watch { t: 'watch'; v: number; key: string }
export type ToSea = Hello | Helm | Ashore | Watch;

/* ------------------------------------------------------------ sea → phone -- */

/** A ship's seat. `c` is her colour (data/colors.ts), kept all night, or -1 for an empty seat. */
export interface Seat { id: number; seat: string; name: string; look: string; bot: boolean; left: boolean; c: number }
/** `watch` is set for a screen looking on rather than a captain coming aboard. */
export interface Welcome { t: 'welcome'; v: number; code: string; cap: number; watch?: boolean }
export interface Nope { t: 'nope'; why: 'full' | 'unknown' | 'token' | 'version' | 'bad' | 'key' | 'name' }
/** Who is in which seat. Sent whenever it changes. */
export interface Roster { t: 'roster'; seed: string; seats: Seat[] }
export interface Snap {
  t: 's';
  at: number;              // the world's clock, seconds: the sim, and every event, is stamped with it
  ck: number;              // the sea's own clock, seconds. The phone keeps time by it
  R: number;               // the sea's radius
  p: number[][];           // every ship, as anyone looking on sees her: [id, x, y, h, v, rot,
                           // sail, hull, hit, invuln, flags, streak]; flags: out 1, left 2,
                           // heavy 4, boost 8, song 16, shield 32
  me?: number[] | null;    // the phone's own ship's own (see mine()). Put on by the host, phone
                           // by phone: nobody else's phone needs to know her guns
  s: number[][];           // balls fired since the last: [id, x, y, vx, vy, fired at, life, heavy, by]
  sx: number[][];          // balls that ended early since the last, in a hull or on land: [id, at]
  c: number[][];           // crates: [id, kind, x, y, age]
  e: GameEvent[];          // what happened since the last, each stamped `at`
}
export type FromSea = Welcome | Nope | Roster | Snap;

/* ------------------------------------------------------------------ packing -- */

const q = (v: number, k = 100) => Math.round(v * k) / k;

/**
 * The balls in the air, as the server has told the phones of them. A ball flies straight at
 * one speed until it splashes, so the phone needs to hear of it once, when it is fired, and
 * again only if it ends early. Note it after every step of the world, and flush it into
 * each snapshot.
 */
export class ShotLog {
  private ids = new Map<object, number>();
  private n = 0;
  private fired: number[][] = [];
  private ended: number[][] = [];

  note(w: World) {
    // a ball the world has finished with is still marked dead, though culled from w.shots
    for (const [sh, id] of this.ids) {
      const s = sh as World['shots'][number];
      if (!s.dead) continue;
      this.ids.delete(sh);
      if (s.age < s.life) this.ended.push([id, q(w.t, 1000)]);
    }
    for (const sh of w.shots) {
      if (this.ids.has(sh)) continue;
      const id = ++this.n;
      this.ids.set(sh, id);
      this.fired.push([
        id, q(sh.x - sh.vx * sh.age, 10), q(sh.y - sh.vy * sh.age, 10), q(sh.vx, 10), q(sh.vy, 10),
        q(w.t - sh.age, 1000), q(sh.life, 1000), sh.heavy ? 1 : 0, sh.by,
      ]);
    }
  }

  flush(): { s: number[][]; sx: number[][] } {
    const out = { s: this.fired, sx: this.ended };
    this.fired = []; this.ended = [];
    return out;
  }
}

/** The sea's world, as every phone needs it. `ck` is the sea's clock; `events` and the
 *  log's balls are those since the last snapshot. */
export function pack(w: World, ck: number, events: GameEvent[], log: ShotLog): Snap {
  const { s, sx } = log.flush();
  return {
    t: 's', at: q(w.t, 1000), ck: q(ck, 1000), R: q(w.R, 10),
    p: w.ships.map((c) => [
      c.id, q(c.x, 10), q(c.y, 10), q(c.h, 1000), q(c.v, 10), q(c.rot, 1000), q(c.sail), q(c.hull, 10), q(c.hit, 10),
      q(c.invuln, 10),
      (c.out ? 1 : 0) | (c.left ? 2 : 0) | (c.heavy ? 4 : 0) | (c.boost > 0 ? 8 : 0) | (c.song > 0 ? 16 : 0) | (c.shield > 0 ? 32 : 0),
      c.streak,
    ]),
    s, sx,
    c: w.crates.map((c) => [c.id, CRATES.indexOf(c.kind), q(c.x, 10), q(c.y, 10), q(c.age, 10)]),
    e: events,
  };
}

/** Which of the phone's hands the sea is sailing her by: helm number `n`, for `ticks`
 *  ticks so far. */
export interface Ran { n: number; ticks: number }

/**
 * What only a ship's own phone needs: her guns for the HUD, what she has sunk tonight, how
 * long she has been out of a fight; and, for the phone to step her ahead of the sea, which
 * of its hands she has sailed by so far and all of her own way, finely; then how long each
 * of her powers has left to recharge, in POWERS order:
 *   [ammo, reloadT, gapT, sank, calm, down, n, ticks, x, y, h, v, sail, trim, rim, boost, ...cool]
 */
export function mine(p: Ship, ran: Ran): number[] {
  return [
    p.ammo, q(p.reloadT), q(p.gapT), p.sank, q(p.calm, 10), q(p.down, 10), ran.n, ran.ticks,
    q(p.x, 1000), q(p.y, 1000), q(p.h, 10000), q(p.v, 1000), q(p.sail, 1000), q(p.trim, 1000), p.rim ? 1 : 0, q(p.boost, 1000),
    ...p.cool.map((c) => q(c, 10)),
  ];
}

/** Put her own way, as mine() sent it, on a ship. */
export function wayOf(s: Ship, m: number[]) {
  s.x = m[8]; s.y = m[9]; s.h = m[10]; s.v = m[11]; s.sail = m[12]; s.trim = m[13]; s.rim = !!m[14]; s.boost = m[15];
}

/* ---------------------------------------------------------------- the mirror -- */

// How far behind the sea a phone draws: far enough that the snapshot after the moment it
// draws is nearly always in hand already, near enough that the helm still feels like one.
// Snapshots come a GAP apart and wifi makes some of them late, so the phone keeps a few
// seconds' note of how late they come and stays a gap plus nearly all of that behind:
// about 0.08s on quiet wifi, a good deal more on a crowded one. It moves to that delay by
// running the picture a little fast or slow, never by stepping it back.
const QUICK = 3;      // the sea's clock is read off the quickest snapshot of this many seconds
const LATE = 8;       // how late snapshots have come, over this many seconds...
const COVER = 0.9;   // ...of which the delay covers this share
const WARP = 0.08;    // the picture runs at most this much fast or slow while it settles
const LEAP = 0.4;     // further from its place than this, and it jumps there instead
const FIRST = 0.12;   // the delay until there is a second of snapshots to judge by

// A snapshot held up (a lost segment sent again, a moment with no signal) leaves the
// picture past the newest one the phone has. The ships sail on as they were going, turning
// as they were turning, and only lose their way if the wait goes on. When the sea's word
// comes, each glides from where she was guessed to where she is, rather than jumping.
const RECKON = 0.6;   // past the newest snapshot, ships sail on as they were for this long...
const STOP = 0.3;     // ...then lose their way over about this long
const TURN = 0.8;     // turning no further than this, radians, however long she is sailed on
const EASE = 0.15;    // a guess put right halves about every EASE × 0.7 seconds
const SNAP = 20;      // a guess further out than this, metres, is put right at once

interface Ball { x: number; y: number; vx: number; vy: number; born: number; life: number; end: number; heavy: boolean; by: number }

/**
 * The phone's copy of a shared sea: a real World, kept by the snapshots. Build it from a
 * roster, feed it every snapshot as it arrives, and call frame() each paint: it slides
 * every ship to where she was a moment ago and lets go of the events that happened by then.
 */
export class Mirror {
  world: World | null = null;
  /** Who is in which seat, by ship id: names, looks and colours for the view and the HUD. */
  seats: Seat[] = [];
  /** How far behind the sea this phone is drawing, seconds. */
  delay = FIRST;
  /** The newest snapshot's own row for this phone's ship, as sent (see mine()). */
  own: number[] | null = null;
  /** The world's clock at the newest snapshot. */
  newest = 0;
  /** The sea's clock at the newest snapshot, for the sea to know how far behind this phone
   *  is (net/post.ts). */
  lastCk = 0;
  /** How far ahead of the sea this phone is stepping its own ship, seconds (net/lead.ts).
   *  Its own balls are drawn that far on too, so they leave from her where she is drawn. */
  ahead = 0;
  private seed = '';
  private snaps: Snap[] = [];
  private heard: { now: number; off: number; late: number }[] = [];
  private best = 0;                         // the sea's clock less ours, off the quickest recent snapshot
  private gap = 1 / 15;                     // between snapshots, on the sea's clock
  private ck: number | null = null;         // the moment being drawn, on the sea's clock
  private last = 0;                         // our clock at the last frame
  private said = -1;                        // the latest event time already handed over
  private balls = new Map<number, Ball>();
  /** Each ship's guess still being put right, by id: how far she is drawn from her place. */
  private guess = new Map<number, { x: number; y: number; h: number }>();
  /** The snapshot the last frame sailed the ships on from, if it did. */
  private basis: Snap | null = null;

  /** Who is aboard, and on which chart. A new chart is a new world. */
  roster(r: Roster, me: string) {
    if (!this.world || r.seed !== this.seed) {
      this.seed = r.seed;
      this.world = Wo.create({ seed: r.seed });
      this.snaps = []; this.balls.clear(); this.said = -1; this.guess.clear(); this.basis = null;
      // as often as not a new chart is a new sea clock too (a server that restarted), so it
      // is judged afresh
      this.heard = []; this.ck = null; this.delay = FIRST; this.newest = 0; this.lastCk = 0; this.own = null;
    }
    const w = this.world;
    for (const s of r.seats) {
      const had = w.ships[s.id];
      if (!had || had.look !== s.look || had.seat !== s.seat || had.bot !== s.bot) {
        w.ships[s.id] = Wo.launch({ seat: s.seat, look: s.look, bot: s.bot }, s.id);
        w.ships[s.id].out = true;
      }
      w.ships[s.id].left = s.left;
      if (s.left) w.ships[s.id].out = true;
    }
    w.ships.length = Math.max(0, ...r.seats.map((s) => s.id + 1));
    for (let i = 0; i < w.ships.length; i++) {
      if (!w.ships[i]) { w.ships[i] = Wo.launch({}, i); w.ships[i].out = w.ships[i].left = true; }
    }
    this.seats = r.seats;
    const mine = r.seats.find((s) => s.seat === me && !s.left);
    w.focus = mine ? mine.id : -1;
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

    for (const r of s.s) this.balls.set(r[0], { x: r[1], y: r[2], vx: r[3], vy: r[4], born: r[5], life: r[6], end: r[5] + r[6], heavy: !!r[7], by: r[8] });
    for (const [id, at] of s.sx) { const b = this.balls.get(id); if (b) b.end = Math.min(b.end, at); }
    if (s.me) this.own = s.me;
    this.newest = Math.max(this.newest, s.at);
    this.lastCk = Math.max(this.lastCk, s.ck);
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
  }

  /** Where the sea is, a moment ago. */
  frame(now: number) {
    const w = this.world;
    if (!w || !this.snaps.length) return;
    const want = now + this.best - this.delay;
    const dt = this.ck == null ? 0 : Math.max(0, now - this.last);
    if (this.ck == null || Math.abs(want - this.ck) > LEAP) this.ck = want;
    else this.ck += dt * (1 + clamp((want - this.ck - dt) * 2, -WARP, WARP));
    this.last = now;
    const ck = this.ck;

    // the snapshots either side; past the newest, the newest, to sail the ships on from
    const snaps = this.snaps, newest = snaps[snaps.length - 1];
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].ck > ck) i--;
    const on = sailOn(ck - newest.ck);
    if (on > 0) i = snaps.length - 1;
    const a = snaps[i], b = snaps[Math.min(i + 1, snaps.length - 1)];
    const span = b.ck - a.ck;
    const k = span > 0 ? clamp((ck - a.ck) / span, 0, 1) : 1;
    const t = a.at + (b.at - a.at) * k + on;

    // what happened, as it comes due. Never past the newest snapshot's time, though the
    // ships sail on beyond it: what happened there has not been heard yet.
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

    w.t = t;
    w.R = a.R + (b.R - a.R) * k;
    this.ships(w, a, b, k, on);
    this.glide(w, ck, dt, on > 0 ? newest : null);
    w.shots = [];
    // your own balls in your own ship's time, the rest in the sea's a moment ago
    const own = this.ahead > 0 ? newest.at + this.ahead : t;
    for (const [id, ball] of this.balls) {
      if (ball.end < t - 1) { this.balls.delete(id); continue; }
      const at = ball.by === w.focus ? own : t;
      if (at < ball.born || at >= ball.end) continue;
      const age = at - ball.born;
      w.shots.push({
        x: ball.x + ball.vx * age, y: ball.y + ball.vy * age, vx: ball.vx, vy: ball.vy, age, life: ball.life,
        r: ball.heavy ? 1.6 : 1, dmg: 0, heavy: ball.heavy, dead: false, by: ball.by,
      });
    }
    w.crates = b.c.map((r) => ({ id: r[0], kind: CRATES[r[1]] as CrateKind, x: r[2], y: r[3], age: r[4], dead: false }));
  }

  private ships(w: World, a: Snap, b: Snap, k: number, on: number) {
    const prev = new Map(a.p.map((r) => [r[0], r]));
    for (const r of b.p) {
      const s = w.ships[r[0]];
      if (!s) continue;
      // back from the bottom, she comes back somewhere else: she is there at once, not
      // slid across the sea to it
      const o = prev.get(r[0]);
      slide(s, o && (o[10] & 1) === (r[10] & 1) ? o : r, r, k);
      if (on > 0 && !(r[10] & 1)) reckon(s, r, on);
      s.hit = r[8]; s.invuln = r[9];
      const f = r[10];
      s.out = !!(f & 1) || s.left; s.heavy = !!(f & 4); s.boost = f & 8 ? 1 : 0;
      s.song = f & 16 ? 1 : 0; s.shield = f & 32 ? 1 : 0;
      s.streak = r[11];
    }
    // her own: the guns the HUD shows
    const me = w.ships[w.focus], m = this.own;
    if (!me || !m) return;
    me.ammo = m[0]; me.reloadT = m[1]; me.gapT = m[2]; me.sank = m[3]; me.calm = m[4]; me.down = m[5];
    me.cool = m.slice(16);
  }

  /**
   * Put right a guess, gently. While the last frame sailed the ships on from a snapshot
   * (`basis`) and a newer one has come since, every ship is somewhere other than where she
   * was guessed: she is drawn where the guess had her, and glides to where the sea says.
   * `from` is the snapshot this frame sailed them on from, if it did.
   */
  private glide(w: World, ck: number, dt: number, from: Snap | null) {
    const fade = Math.exp(-dt / EASE);
    for (const [id, g] of this.guess) {
      g.x *= fade; g.y *= fade; g.h *= fade;
      if (Math.abs(g.x) + Math.abs(g.y) + Math.abs(g.h) < 1e-3) this.guess.delete(id);
    }
    const was = this.basis;
    if (was && was !== from) {
      const on = sailOn(ck - was.ck), at = { x: 0, y: 0, h: 0, v: 0 };
      for (const r of was.p) {
        const s = w.ships[r[0]];
        if (!s || s.out || r[10] & 1) continue;
        reckon(at, r, on);
        const dx = at.x - s.x, dy = at.y - s.y;
        if (Math.hypot(dx, dy) > SNAP) { this.guess.delete(r[0]); continue; }
        const g = this.guess.get(r[0]) ?? { x: 0, y: 0, h: 0 };
        g.x += dx; g.y += dy; g.h += angleTo(s.h, at.h);
        this.guess.set(r[0], g);
      }
    }
    this.basis = from;
    for (const [id, g] of this.guess) {
      const s = w.ships[id];
      if (!s || s.out) { this.guess.delete(id); continue; }
      s.x += g.x; s.y += g.y; s.h = wrap(s.h + g.h);
    }
  }
}

/** How long past the newest snapshot the ships are sailed on for, `past` seconds past it:
 *  as long, at first, then less and less as they lose their way. 0 for none. */
function sailOn(past: number) {
  if (past <= 0) return 0;
  return past <= RECKON ? past : RECKON + STOP * (1 - Math.exp(-(past - RECKON) / STOP));
}

/** Sail a ship on from her row in a snapshot for `t` seconds, as she was going: her way,
 *  and her turn, up to TURN. */
function reckon(s: { x: number; y: number; h: number; v: number }, r: number[], t: number) {
  const v = r[4], h = r[3], turn = clamp(r[5] * t, -TURN, TURN);
  if (Math.abs(turn) < 1e-4) {
    s.x = r[1] + Math.cos(h) * v * t;
    s.y = r[2] + Math.sin(h) * v * t;
  } else {
    // round an arc the length she sails, as far round as she turns
    const R = (v * t) / turn;
    s.x = r[1] + R * (Math.sin(h + turn) - Math.sin(h));
    s.y = r[2] - R * (Math.cos(h + turn) - Math.cos(h));
  }
  s.h = wrap(h + turn);
  s.v = v;
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
