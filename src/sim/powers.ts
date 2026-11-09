// Powers: three, each on a button of its own, and each recharging on its own, powerCool
// seconds from the press. A ship that sinks has all three again when she comes back.
//   broadside  a fan of balls at the nearest ship, without using a shot: the finisher
//   song       every ship near her is pulled toward her, however it is sailing: the one
//              that catches a ship running away, which a ship as fast can't
//   shield     balls stop at it: the way out of a fight going wrong
// Bots use them too, through the same Input (sim/bots.ts).

import { TUNING as T } from '../data/tuning';
import { autoBearing, volley } from './combat';
import { POWERS, ev, type Ship, type World } from './types';

/** All ready: a new life. */
export const fresh = () => POWERS.map(() => 0);

/** Can she use power `i` now? */
export const can = (s: Ship, i: number) => !s.out && s.cool[i] <= 0;

/** A press on power `i`. Returns whether it went off. */
export function usePower(w: World, s: Ship, i: number): boolean {
  const kind = POWERS[i];
  if (!kind || !can(s, i)) return false;
  s.cool[i] = T.powerCool;
  ev(w, 'power', { p: s.id, kind, x: s.x, y: s.y });
  if (kind === 'broadside') volley(w, s, autoBearing(w, s), T.broadsideBalls, T.broadsideSpread, false);
  else if (kind === 'song') s.song = T.songFor;
  else s.shield = T.shieldFor;
  return true;
}

/** Whatever she has on runs down, and whatever she has used recharges. */
export function powers(s: Ship, dt: number) {
  s.song = Math.max(0, s.song - dt);
  s.shield = Math.max(0, s.shield - dt);
  for (let i = 0; i < s.cool.length; i++) s.cool[i] = Math.max(0, s.cool[i] - dt);
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
 *  (net/lead.ts). The pull eases in over half a length at the edge of the reach and eases
 *  off as she comes alongside, rather than starting and stopping dead: a ship held on either
 *  edge would be pulled one tick and let go the next, and the phone, which sees the singer a
 *  moment late, would have her on the other side of it as often as not. */
export function pull(o: { x: number; y: number }, x: number, y: number, dt: number) {
  const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
  const ease = T.length / 2, alongside = T.length * 1.2;
  const k = Math.min(1, (d - alongside) / ease, (T.songRange - d) / ease);
  if (k <= 0) return;
  const f = (T.songPull * k * dt) / d;
  o.x += dx * f; o.y += dy * f;
}
