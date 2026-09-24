// What the weather does to the fight. The renderer has its own opinions about what it
// looks like; these are the only numbers the simulation cares about.

import type { Weather } from '../data/waves';

/** How far anyone can see, as a fraction of a clear day. Fog is the ambusher's weather. */
export const SIGHT: Record<Weather, number> = { clear: 1, storm: 0.75, fog: 0.45 };

/** Close enough that nobody needs good weather to see you. */
export const POINT_BLANK = 70;

/** The storm's set: a push that swings slowly round the compass. Steer against it. */
export function stormDrift(t: number, reduce: boolean): { x: number; y: number } {
  const a = t * 0.07 + 0.8;
  const m = 2.4 * Math.sin(t * 0.45) * (reduce ? 0.5 : 1);
  return { x: Math.cos(a) * m, y: Math.sin(a) * m };
}
