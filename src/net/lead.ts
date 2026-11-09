// Your own ship, at once. The phone steps its own ship itself, at the sim's own rate, by
// the very hands it has sent the sea, instead of waiting a round trip to be told she
// moved. Everything else on the sea is drawn as the Mirror has it, a moment behind.
//
// Every tick the phone notes which hands it sailed by: helm number n, and how many ticks
// of n so far. Each snapshot says the same of the sea (mine() in protocol.ts) along with
// her way as the sea has it. The phone takes that, sails her on through every tick of its
// own the sea has not sailed yet, and has where she is now. If that is not where she is
// drawn, the difference is eased away over a fraction of a second rather than jumped,
// unless it is large or she has just come back into the sea.
//
// A ship singing nearby pulls her too (sim/powers.ts): the phone pulls her toward every
// singer it can see, as the sea does, rather than be told a moment late and corrected.
//
// What it can't know (a bump from another ship, the sea closing in a moment early, a song
// that began a moment ago) comes back as a small correction. PLANS/PREDICTION.md has the
// reasoning.

import { angleTo, wrap } from '../core/vec';
import { pull } from '../sim/powers';
import * as Wo from '../sim/world';
import type { Input, Ship, World } from '../sim/types';
import { wayOf } from './protocol';

export const FIXED = 1 / 120;
/** Ticks of hands kept: far more than any round trip a bar's wifi takes. */
const KEEP = 240;
/** A correction this large (metres) is a jump, not a glide. */
const JUMP = 15;
/** How quickly a correction is eased away: it halves about every SETTLE × 0.7 seconds. */
const SETTLE = 0.1;

type Move = Input['move'];
interface Tick { n: number; k: number; move: Move }
/** Where every other ship singing is: [x, y]. */
export type Singers = readonly (readonly [number, number])[];

/** One tick of her own: her helm, then any song pulling her. */
function sail(w: Pick<World, 'map' | 'R'>, s: Ship, move: Move, singers: Singers) {
  Wo.move(w, s, FIXED, { move, fire: null, auto: false });
  for (const [x, y] of singers) pull(s, x, y, FIXED);
}

export class Lead {
  /** Her as the phone has stepped her, without the eased correction. Null while she is out. */
  ship: Ship | null = null;
  /** Every correction that was eased, metres, for the tests and the load check. */
  readonly corrections: number[] = [];
  private log: Tick[] = [];
  private n = -1;
  private k = 0;
  private acc = 0;
  private off = { x: 0, y: 0, h: 0 };
  /** How far her last tick took her. She is drawn that much further on for the part of a
   *  tick not stepped yet, so a paint that falls between ticks finds her between them. */
  private step = { x: 0, y: 0, h: 0 };

  /** Step her on by `dt`, sailing by helm `n`, the hands most lately sent. */
  advance(w: Pick<World, 'map' | 'R'>, dt: number, n: number, move: Move, singers: Singers = []) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 24) {
      if (n !== this.n) { this.n = n; this.k = 0; }
      this.log.push({ n, k: this.k++, move });
      if (this.log.length > KEEP) this.log.shift();
      if (this.ship) this.tick(w, this.ship, move, singers);
      this.acc -= FIXED; steps++;
    }
    if (steps === 24) this.acc = 0;
    const d = Math.exp(-dt / SETTLE);
    this.off.x *= d; this.off.y *= d; this.off.h *= d;
  }

  /**
   * The sea's word on her: her own row of a snapshot, and the world it came in (its chart
   * and radius). She is put where the sea says and sailed on through the ticks it has not
   * sailed yet.
   */
  hear(w: Pick<World, 'map' | 'R' | 'focus'>, me: number[], out: boolean, singers: Singers = []) {
    if (out) { this.ship = null; return; }
    const was = this.ship ? { x: this.ship.x + this.off.x, y: this.ship.y + this.off.y, h: this.ship.h + this.off.h } : null;
    const s = this.ship ?? Wo.launch({}, w.focus);
    wayOf(s, me);
    // the ticks the sea has already sailed are done with; the rest are sailed again
    const n = me[6], ticks = me[7];
    const from = this.log.findIndex((t) => t.n > n || (t.n === n && t.k >= ticks));
    const rest = from < 0 ? [] : this.log.slice(from);
    if (from > 0) this.log.splice(0, from);
    else if (from < 0) this.log.length = 0;
    if (!was) this.step = { x: 0, y: 0, h: 0 };
    for (const t of rest) this.tick(w, s, t.move, singers);
    this.ship = s;
    if (!was) { this.off = { x: 0, y: 0, h: 0 }; return; }
    const ox = was.x - s.x, oy = was.y - s.y, d = Math.hypot(ox, oy);
    if (d > JUMP) { this.off = { x: 0, y: 0, h: 0 }; return; }
    this.corrections.push(d);
    if (this.corrections.length > 2000) this.corrections.splice(0, 1000);
    this.off = { x: ox, y: oy, h: angleTo(s.h, was.h) };
  }

  /** Draw her where the phone has her: over the Mirror's copy, eased correction and all. */
  show(w: World) {
    const s = this.ship, m = w.ships[w.focus];
    if (!s || !m || m.out) return;
    const f = this.acc / FIXED, d = this.step;
    m.x = s.x + this.off.x + d.x * f; m.y = s.y + this.off.y + d.y * f; m.h = wrap(s.h + this.off.h + d.h * f);
    m.v = s.v; m.rot = s.rot; m.sail = s.sail;
  }

  /** One tick of hers, noting how far it took her. */
  private tick(w: Pick<World, 'map' | 'R'>, s: Ship, move: Move, singers: Singers) {
    const x = s.x, y = s.y, h = s.h;
    sail(w, s, move, singers);
    this.step = { x: s.x - x, y: s.y - y, h: angleTo(h, s.h) };
  }

  /** How many ticks she has been stepped by helm `n` so far: 0 for any other. */
  ticksOf(n: number) { return n === this.n ? this.k : 0; }

  /** How far ahead of the sea's newest word the phone has stepped her, in ticks: the
   *  ticks of hands the sea has not sailed yet. */
  get ahead() { return this.log.length; }

  /** Start again: a new line, a new chart. */
  reset() { this.ship = null; this.log = []; this.n = -1; this.k = 0; this.acc = 0; this.off = { x: 0, y: 0, h: 0 }; this.step = { x: 0, y: 0, h: 0 }; }
}
