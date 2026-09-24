// A run is the thread between waves: what she carries out of Nassau and back into it.
//
// The rule that makes retreating mean anything: nothing inside a wave ever writes to the
// run. bankWave, once she is careened, is the only thing allowed to. Coming about and
// running for home both just throw the world away, and the run is where she left it.

import type { World } from '../sim/types';
import { save, session, type Run, type RunSummary } from './session';

export function newRun(seed: string, ship: string): Run {
  session.run = {
    seed, ship, wave: 1, plunder: 0, lives: -1,
    upgrades: {}, heat: 0, boarded: 0, sunk: 0, time: 0, bribes: 0, legends: 0,
  };
  save();
  return session.run;
}

/** The run as the simulation wants to read it. lives -1 is "whatever her hull gives her". */
export function runSeed(run: Run) {
  return {
    seed: run.seed, ship: run.ship, upgrades: run.upgrades, heat: run.heat,
    plunder: run.plunder, lives: run.lives < 0 ? undefined : run.lives,
    boarded: run.boarded, sunk: run.sunk,
  };
}

/** A wave survived and careened — the run's carry-over into the next one. */
export function bankWave(run: Run, w: World): Run {
  run.wave = w.wave + 1;
  run.plunder = w.plunder;
  run.lives = w.lives;
  run.heat = w.heat;
  run.boarded = w.boarded;
  run.sunk = w.sunk;
  run.legends = (run.legends || 0) + (w.plan.boss ? 1 : 0);
  run.time += w.t;
  // Careening IS the repair — hull and shells come back full at the beach, because the
  // next world is built from the run and the run carries neither. Hull is what you spend
  // inside a wave; lives are what you spend across a run.
  save();
  return run;
}

/** Fold a finished run into the record book and clear it. */
export function endRun(run: Run, w: World | null): RunSummary {
  const rec = session.records;
  const wave = w ? w.wave : run.wave;
  const time = run.time + (w ? w.t : 0);
  rec.runs++;
  rec.bestWave = Math.max(rec.bestWave, wave);
  const plunder = w ? w.plunder : run.plunder;
  rec.bestPlunder = Math.max(rec.bestPlunder, plunder);
  rec.bestTime = Math.max(rec.bestTime, time);
  // The world's tallies are cumulative for the whole run, so the run's totals go in whole.
  const boarded = w ? w.boarded : run.boarded;
  const sunk = w ? w.sunk : run.sunk;
  rec.boarded += boarded;
  rec.sunk += sunk;
  const out = { wave, time, plunder, boarded, sunk, ship: run.ship };
  session.run = null;
  save();
  return out;
}

export const reales = (n: number) => Math.round(n).toLocaleString('en-GB');
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
