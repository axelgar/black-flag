// The wave curve. Ported whole from v1: the same budget, the same unlock order, the
// same boss cycle. What changed is what a "group" becomes — in v1 it was a formation
// that came down the screen; here it is a squadron that puts to sea somewhere on the
// chart and starts looking for you.

import type { Rng } from '../core/rng';
import { CLASS_IDS } from './enemies';
import { legendFor } from './legends';

export type Weather = 'clear' | 'storm' | 'fog';
export type Formation = 'line' | 'vee' | 'column' | 'loose';

export interface Group {
  at: number;             // seconds into the wave, at the latest
  cls: string;            // a class id, 'legend', or 'spout'
  n: number;
  form: Formation;
  legend?: string;
}

export interface WavePlan { wave: number; boss: boolean; weather: Weather; groups: Group[]; last: number }

const UNLOCK: Record<string, number> = { lancha: 1, schooner: 2, brig: 3, brulote: 5, frigate: 6, manowar: 9 };
const COST: Record<string, number>   = { lancha: 1, schooner: 2, brig: 4, brulote: 3, frigate: 8, manowar: 14 };
const FORMS: Formation[] = ['line', 'vee', 'column', 'loose'];

export const unlockWave = (cls: string) => UNLOCK[cls] ?? 1;
export const isBossWave = (n: number) => n % 5 === 0;

/** Strictly increasing, by construction. The tests hold it to that. */
export const waveBudget = (n: number) => Math.round(6 + n * 3.4 + n * n * 0.22);

/** Storms every fourth wave; a fog bank on a slower cycle so the two rarely collide. */
export function waveWeather(n: number): Weather {
  if (n % 4 === 0) return 'storm';
  if (n >= 6 && n % 3 === 2) return 'fog';
  return 'clear';
}

/**
 * The spawn script for a wave. Deterministic in (n, r) and nothing else — no clock,
 * no Math.random — so a seed replays the same fleet in the same order every time.
 */
export function wavePlan(n: number, r: Rng): WavePlan {
  const boss = isBossWave(n);
  const groups: Group[] = [];
  let last = 0;

  if (boss) {
    groups.push({ at: 2, cls: 'legend', n: 1, form: 'loose', legend: legendFor(n).id });
    // Escorts put to sea behind her so the fight is never just the boss.
    const waves = Math.min(5, 1 + Math.floor(n / 5));
    for (let i = 0; i < waves; i++) {
      groups.push({ at: 14 + i * 16, cls: n >= 10 ? 'schooner' : 'lancha', n: 3, form: 'line' });
    }
    last = 14 + (waves - 1) * 16;
  } else {
    let budget = waveBudget(n), at = 1.5, guard = 0;
    const pool = CLASS_IDS.filter((k) => n >= UNLOCK[k]);
    while (budget > 0 && guard++ < 48) {
      const afford = pool.filter((k) => COST[k] <= budget);
      if (!afford.length) break;
      const cls = afford[Math.floor(r() * afford.length)];
      const most = cls === 'lancha' ? 4 : cls === 'schooner' ? 3 : cls === 'brig' ? 2 : 1;
      const count = Math.min(Math.max(1, Math.floor(budget / COST[cls])), 1 + Math.floor(r() * most));
      budget -= COST[cls] * count;
      groups.push({ at, cls, n: count, form: FORMS[Math.floor(r() * FORMS.length)] });
      // An open sea takes longer to cross than a screen did, so squadrons are spaced wider.
      at += Math.max(4, 11 - n * 0.3) + r() * 4;
    }
    last = at;
    if (n >= 12) groups.push({ at: at * 0.4, cls: 'spout', n: 1, form: 'loose' });
    if (n >= 16) groups.push({ at: at * 0.75, cls: 'spout', n: 1, form: 'loose' });
  }

  groups.sort((a, b) => a.at - b.at);   // stable, so ties keep their draw order
  return { wave: n, boss, weather: waveWeather(n), groups, last };
}

export const sailCount = (p: WavePlan) =>
  p.groups.filter((g) => g.cls !== 'spout').reduce((a, g) => a + g.n, 0);
