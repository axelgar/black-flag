// Powers: three, each on a button of its own, and each once a life. A ship that sinks has
// all three again when she comes back.
//   broadside  a fan of balls at the nearest ship, without using a shot: the finisher
//   song       every ship near her is pulled toward her, however it is sailing: the one
//              that catches a ship running away, which a ship as fast can't
//   shield     balls stop at it: the way out of a fight going wrong
// Bots use them too, through the same Input (sim/bots.ts).

import { TUNING as T } from '../data/tuning';
import { autoBearing, volley } from './combat';
import { POWERS, ev, type Ship, type World } from './types';

/** None used yet: a new life. */
export const fresh = () => POWERS.map(() => false);

/** Can she use power `i` now? */
export const can = (s: Ship, i: number) => !s.out && !s.spent[i];

/** A press on power `i`. Returns whether it went off. */
export function usePower(w: World, s: Ship, i: number): boolean {
  const kind = POWERS[i];
  if (!kind || !can(s, i)) return false;
  s.spent[i] = true;
  ev(w, 'power', { p: s.id, kind, x: s.x, y: s.y });
  if (kind === 'broadside') volley(w, s, autoBearing(w, s), T.broadsideBalls, T.broadsideSpread, false);
  else if (kind === 'song') s.song = T.songFor;
  else s.shield = T.shieldFor;
  return true;
}

/** Whatever she has on runs down. */
export function powers(s: Ship, dt: number) {
  s.song = Math.max(0, s.song - dt);
  s.shield = Math.max(0, s.shield - dt);
}

/** Every ship singing pulls the others near her in. */
export function sing(w: World, dt: number) {
  for (const s of w.ships) {
    if (s.out || s.song <= 0) continue;
    for (const o of w.ships) if (o !== s && !o.out) pull(o, s.x, s.y, dt);
  }
}

/** One ship pulled toward a singer at (x, y) for `dt`, if she is in reach and not already
 *  alongside. A phone pulls its own ship the same way, to step her ahead of the sea
 *  (net/lead.ts). */
export function pull(o: { x: number; y: number }, x: number, y: number, dt: number) {
  const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
  if (d > T.songRange || d < T.length * 1.2) return;
  const k = (T.songPull * dt) / d;
  o.x += dx * k; o.y += dy * k;
}
