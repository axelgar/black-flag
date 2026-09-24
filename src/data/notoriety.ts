// Notoriety is a question about witnesses, which is why all three numbers scale with
// the size of the crew: a launch and a man-o-war are not the same news in Havana.

import { clamp } from '../core/vec';

export const HEAT_MAX = 5;
export const HEAT = { perSecond: 0.004, bribe: -2 };

/** You sank a ship that had already struck. Nobody survives that, but everyone hears it. */
export const heatSunk = (hullMax: number) => 0.06 + hullMax * 0.012;
/** She struck, you never came for her, and she limped home to describe you. */
export const heatEscaped = (hullMax: number) => (0.06 + hullMax * 0.012) * 0.5;
/** Boarded. No survivors, no report, and a hold full of someone else's cargo. */
export const heatBoarded = (hullMax: number) => -(0.25 + hullMax * 0.014);

export const HUNTER_AT = 3;        // hunter squadrons come in off the edge of the chart
export const EARLY_LEGEND_AT = 5;  // and at five, a legendary comes for you out of schedule
export const heatFlags = (h: number) => clamp(Math.floor(h), 0, HEAT_MAX);
