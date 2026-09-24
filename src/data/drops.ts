// What floats up out of a wreck. dur -1 means "the rest of this wave".

import type { Rng } from '../core/rng';

export type DropId = 'rum' | 'shells' | 'powder' | 'heavy' | 'chain' | 'swivel';

export interface DropDef { id: DropId; label: string; short: string; odds: number; dur: number }

export const DROPS: DropDef[] = [
  { id: 'rum',    label: 'Rum barrel',  short: 'RUM',    odds: 26, dur: 0 },
  { id: 'shells', label: 'Shells',      short: 'SHELLS', odds: 20, dur: 0 },
  { id: 'powder', label: 'Powder keg',  short: 'POWDER', odds: 16, dur: 12 },
  { id: 'heavy',  label: 'Heavy shot',  short: 'HEAVY',  odds: 14, dur: 12 },
  { id: 'chain',  label: 'Chain shot',  short: 'CHAIN',  odds: 12, dur: 12 },
  { id: 'swivel', label: 'Swivel crew', short: 'SWIVEL', odds: 8,  dur: -1 },
];
const TOTAL = DROPS.reduce((a, d) => a + d.odds, 0);

/** Boarding pays better in cargo as well as coin — that is most of why you board. */
export function rollDrop(r: Rng, boarded: boolean): DropDef | null {
  if (r() > (boarded ? 0.62 : 0.28)) return null;
  let p = r() * TOTAL;
  for (const d of DROPS) { p -= d.odds; if (p <= 0) return d; }
  return DROPS[0];
}
