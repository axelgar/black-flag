// How a scripted captain sails, standing in for a guest's thumbs: in the end-to-end check
// (scripts/captain.ts) and the odds (scripts/odds.ts).
//   good:   steers by the bots' own brain (circles at range, backs off to mend), and taps
//           the moment a shot is ready and a ship is in reach
//   casual: sails straight at the nearest ship and never backs off, and taps about once a
//           second
// Either way the tap aims itself, as a guest's quick tap does.

import { TUNING as T } from '../src/data/tuning';
import { botInput } from '../src/sim/bots';
import { nearestFoe } from '../src/sim/combat';
import type { Input, Ship, World } from '../src/sim/types';

export type Style = 'good' | 'casual';

/** Where she steers this tick. */
export function steer(w: World, me: Ship, dt: number, style: Style): Input['move'] {
  if (style === 'good') return botInput(w, me, dt).move;
  const foe = nearestFoe(w, me, 1e9);
  if (!foe) return null;
  const a = Math.atan2(foe.y - me.y, foe.x - me.x);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Does she tap the guns now, `since` seconds after her last tap? */
export function taps(w: World, me: Ship, since: number, style: Style): boolean {
  return since > (style === 'good' ? 0.3 : 1) && me.ammo > 0 && me.gapT <= 0 && !!nearestFoe(w, me, T.autoRange * 0.95);
}
