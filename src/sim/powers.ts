// Powers: four to try out, each on a button of its own with its own wait.
//   broadside  a fan of balls at the nearest ship, without using a shot
//   smoke      nobody else sees her, aims at her or picks her, until it clears or she fires
//   song       every ship near her is pulled toward her
//   shield     balls stop at it
// Captains only, for now: bots don't use them.

import { TUNING as T } from '../data/tuning';
import { autoBearing, volley } from './combat';
import { POWERS, ev, type Ship, type World } from './types';

const WAIT = { broadside: 'broadsideWait', smoke: 'smokeWait', song: 'songWait', shield: 'shieldWait' } as const;

/** How long power `kind` takes to be ready again. */
export const waitOf = (kind: keyof typeof WAIT) => T[WAIT[kind]];

/** All four ready. */
export const ready = () => POWERS.map(() => 0);

/** A press on power `i`. Returns whether it went off. */
export function usePower(w: World, s: Ship, i: number): boolean {
  const kind = POWERS[i];
  if (!kind || s.out || s.cool[i] > 0) return false;
  s.cool[i] = T[WAIT[kind]];
  ev(w, 'power', { p: s.id, kind, x: s.x, y: s.y });
  if (kind === 'broadside') volley(w, s, autoBearing(w, s), T.broadsideBalls, T.broadsideSpread, false);
  else if (kind === 'smoke') s.smoke = T.smokeFor;
  else if (kind === 'song') s.song = T.songFor;
  else s.shield = T.shieldFor;
  return true;
}

/** The waits run down, and so does whatever she has on. */
export function powers(s: Ship, dt: number) {
  for (let i = 0; i < s.cool.length; i++) s.cool[i] = Math.max(0, s.cool[i] - dt);
  s.smoke = Math.max(0, s.smoke - dt);
  s.song = Math.max(0, s.song - dt);
  s.shield = Math.max(0, s.shield - dt);
}

/** Every ship singing pulls the others near her in, short of touching. */
export function sing(w: World, dt: number) {
  for (const s of w.ships) {
    if (s.out || s.song <= 0) continue;
    for (const o of w.ships) {
      if (o === s || o.out) continue;
      const dx = s.x - o.x, dy = s.y - o.y, d = Math.hypot(dx, dy);
      if (d > T.songRange || d < s.len * 1.2) continue;
      const k = (T.songPull * dt) / d;
      o.x += dx * k; o.y += dy * k;
    }
  }
}
