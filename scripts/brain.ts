// How a scripted captain sails, standing in for a guest's thumbs: in the end-to-end check
// (scripts/captain.ts) and the odds (scripts/odds.ts).
//   good:   steers by the bots' own brain (circles at range, backs off to mend, uses each
//           power when a bot would), and taps the moment a shot is ready and a ship is in
//           reach
//   casual: sails straight at the nearest ship and never backs off, taps about once a
//           second, and presses a power as soon as it is any use
// Either way the tap aims itself, as a guest's quick tap does.

import { TUNING as T } from '../src/data/tuning';
import { botInput } from '../src/sim/bots';
import { nearestFoe } from '../src/sim/combat';
import { can } from '../src/sim/powers';
import { POWERS, type Input, type Ship, type World } from '../src/sim/types';

export type Style = 'good' | 'casual';

/** Where she steers this tick, and the power she presses, if any (POWERS order). */
export function steer(w: World, me: Ship, dt: number, style: Style): { move: Input['move']; power: number | null } {
  if (style === 'good') { const i = botInput(w, me, dt); return { move: i.move, power: i.power ?? null }; }
  const foe = nearestFoe(w, me, 1e9);
  if (!foe) return { move: null, power: null };
  const a = Math.atan2(foe.y - me.y, foe.x - me.x);
  return { move: { x: Math.cos(a), y: Math.sin(a) }, power: press(me, Math.hypot(foe.x - me.x, foe.y - me.y)) };
}

/** A casual guest's thumb on the powers: the shield when the hull is low, the broadside at
 *  anything close, the song at anything not yet close. */
function press(me: Ship, d: number): number | null {
  const shield = POWERS.indexOf('shield'), broadside = POWERS.indexOf('broadside'), song = POWERS.indexOf('song');
  if (can(me, shield) && me.hull < me.hullMax * 0.4) return shield;
  if (can(me, broadside) && d < T.autoRange * 0.7) return broadside;
  if (can(me, song) && d > T.range * 0.6 && d < T.songRange) return song;
  return null;
}

/** Does she tap the guns now, `since` seconds after her last tap? */
export function taps(w: World, me: Ship, since: number, style: Style): boolean {
  return since > (style === 'good' ? 0.3 : 1) && me.ammo > 0 && me.gapT <= 0 && !!nearestFoe(w, me, T.autoRange * 0.95);
}
