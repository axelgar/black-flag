// The self-check. Everything that would rot silently lives in the simulation: the wave
// curve has to keep escalating, the surrender window has to stay exactly what it says,
// hull must never go negative, a ship behind an island must not see you, and a fixed
// seed has to replay byte-identically — the tripwire for anyone reaching for
// Math.random() inside src/sim.

import { describe, expect, it } from 'vitest';
import { rng } from '../src/core/rng';
import { CLASSES, CLASS_IDS } from '../src/data/enemies';
import { LEGENDS, legendFor } from '../src/data/legends';
import { DROPS, rollDrop } from '../src/data/drops';
import { heatBoarded, heatEscaped, heatSunk } from '../src/data/notoriety';
import { SHIPS, shipById } from '../src/data/ships';
import { UPGRADES, bribeCost, shipStats } from '../src/data/upgrades';
import { isBossWave, waveBudget, wavePlan, waveWeather } from '../src/data/waves';
import { addFoe, crowd } from '../src/sim/spawn';
import { EDGE, MAP_R, lineOfSight, openWater, islandSd } from '../src/sim/map';
import { sees } from '../src/sim/ai';
import type { Foe, Input, World } from '../src/sim/types';
import * as Wo from '../src/sim/world';
import { bankWave } from '../src/state/run';
import type { Run } from '../src/state/session';
import { bot } from './bot';

const DT = 1 / 120;
const idle: Input = { heading: null, rudder: 0, sail: 0, fireL: false, fireR: false, mortar: false };

/** A lab, not a wave: nothing more arrives, and the sea is empty until we say otherwise. */
function lab(seed: string, wave = 2, run: Wo.RunSeed = {}): World {
  const w = Wo.create({ seed, wave, run });
  w.gi = w.plan.groups.length;
  w.foes.length = 0;
  w.ship.invuln = 0;
  return w;
}

/** Put a ship on the water a given distance off the Jackdaw's starboard beam, head to head. */
function abeam(w: World, cls: string, d: number, side: 1 | -1 = 1): Foe {
  const s = w.ship;
  const e = addFoe(w, cls, s.x - Math.sin(s.h) * d * side, s.y + Math.cos(s.h) * d * side, s.h, 0);
  w.squads.push({ x: e.x, y: e.y });
  e.v = 0; e.maxSpeed = 0; e.cool = 1e9; e.coolAlt = 1e9;
  return e;
}

describe('the curve', () => {
  it('escalates, cycles its legendaries, and keeps its weather', () => {
    for (let n = 1; n < 60; n++) expect(waveBudget(n + 1)).toBeGreaterThan(waveBudget(n));
    expect(isBossWave(5) && isBossWave(20) && !isBossWave(6)).toBe(true);
    expect(waveWeather(4)).toBe('storm');
    expect(legendFor(5).id).toBe(LEGENDS[0].id);
    expect(legendFor(25).id).toBe(LEGENDS[0].id);
    expect(new Set(LEGENDS.map((l) => l.id)).size).toBe(LEGENDS.length);
  });

  it('is a pure function of wave and seed', () => {
    for (const n of [1, 4, 7, 10, 13]) {
      const a = wavePlan(n, rng(`p${n}`)), b = wavePlan(n, rng(`p${n}`));
      expect(a).toEqual(b);
      expect(a.groups.length).toBeGreaterThan(0);
      for (let i = 1; i < a.groups.length; i++) expect(a.groups[i].at).toBeGreaterThanOrEqual(a.groups[i - 1].at);
    }
    expect(wavePlan(6, rng('a')).groups).not.toEqual(wavePlan(6, rng('b')).groups);
  });

  it('never schedules a class before it exists', () => {
    for (let n = 1; n <= 4; n++) {
      for (const g of wavePlan(n, rng(`u${n}`)).groups) {
        expect(g.cls).not.toBe('manowar');
        expect(g.cls).not.toBe('frigate');
      }
    }
  });
});

describe('ships and upgrades', () => {
  it('every upgrade level buys something, on every hull', () => {
    for (const def of SHIPS) {
      const base = shipStats(def, {});
      const full = shipStats(def, { plating: 4, broadside: 4, racks: 3, ram: 3, life: 2 });
      expect(full.hullMax).toBeGreaterThan(base.hullMax);
      expect(full.dmg).toBeGreaterThan(base.dmg);
      expect(full.reload).toBeLessThan(base.reload);
      expect(full.shellsMax).toBeGreaterThan(base.shellsMax);
      expect(full.boardRepair).toBeGreaterThan(base.boardRepair);
      expect(full.lives).toBe(base.lives + 2);
      for (const u of UPGRADES) {
        for (let l = 0; l < u.max; l++) {
          const a = shipStats(def, { [u.id]: l }), b = shipStats(def, { [u.id]: l + 1 });
          expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
        }
      }
    }
    for (const u of UPGRADES) for (let l = 0; l + 1 < u.max; l++) expect(u.cost(l + 1)).toBeGreaterThan(u.cost(l));
    expect(bribeCost(3)).toBeGreaterThan(bribeCost(0));
  });

  it('the roster is actually different ships', () => {
    const sig = SHIPS.map((d) => { const b = d.base; return `${b.hull}/${b.maxSpeed}/${b.gunsPerSide}/${b.shotRange}`; });
    expect(new Set(sig).size).toBe(SHIPS.length);
    expect(new Set(SHIPS.map((s) => s.id)).size).toBe(SHIPS.length);
    expect(shipById('nonsense').id).toBe('jackdaw');
  });

  it('a world sails the hull the run chose', () => {
    for (const def of SHIPS) {
      const w = Wo.create({ seed: 'hulls', wave: 1, run: { ship: def.id } });
      expect(w.shipId).toBe(def.id);
      expect(w.ship.hullMax).toBe(shipStats(def).hullMax);
      expect(w.ship.maxSpeed).toBe(def.base.maxSpeed);
    }
  });
});

describe('notoriety and drops', () => {
  it('boarding always pays back more than sinking costs', () => {
    for (const id of CLASS_IDS) {
      const h = CLASSES[id].hull;
      expect(heatSunk(h)).toBeGreaterThan(heatEscaped(h));
      expect(heatBoarded(h)).toBeLessThan(0);
      expect(Math.abs(heatBoarded(h))).toBeGreaterThan(heatSunk(h));
    }
  });

  it('drops are reproducible and roughly as rare as they should be', () => {
    expect(rollDrop(rng('d1'), false)?.id).toBe(rollDrop(rng('d1'), false)?.id);
    const r = rng('drops');
    let n = 0; const kinds = new Set<string>();
    for (let i = 0; i < 20000; i++) { const d = rollDrop(r, false); if (d) { n++; kinds.add(d.id); } }
    expect(n / 20000).toBeGreaterThan(0.22);
    expect(n / 20000).toBeLessThan(0.34);
    expect(kinds.size).toBe(DROPS.length);
    const r2 = rng('drops');
    let b = 0;
    for (let i = 0; i < 20000; i++) if (rollDrop(r2, true)) b++;
    expect(b / 20000).toBeGreaterThan(0.55);
  });
});

describe('the chart', () => {
  it('starts her in open water, with the harbour astern', () => {
    for (const seed of ['a', 'b', 'c', 'nassau', 'jackdaw']) {
      const m = Wo.mapFor(seed);
      expect(openWater(m, m.start.x, m.start.y, 20)).toBe(true);
      expect(openWater(m, m.harbour.x, m.harbour.y, 20)).toBe(true);
      expect(m.islands.length).toBeGreaterThan(8);
    }
    expect(Wo.mapFor('x')).toEqual(Wo.mapFor('x'));
  });

  it('an island blocks sight, and open water does not', () => {
    const w = lab('sight');
    const is = w.map.islands.find((i) => i.kind !== 'nassau' && i.r > 30)!;
    const s = w.ship;
    // Jackdaw due west of the island, a frigate due east: the island is between them.
    s.x = is.x - is.r * 2.2 - 20; s.y = is.y;
    const e = addFoe(w, 'frigate', is.x + is.r * 2.2 + 20, is.y, Math.PI, 0);
    w.squads.push({ x: e.x, y: e.y });
    expect(islandSd(is, s.x, s.y)).toBeGreaterThan(0);
    expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeLessThan(CLASSES.frigate.sight);
    expect(lineOfSight(w.map, e.x, e.y, s.x, s.y)).toBe(false);
    expect(sees(w, e)).toBe(false);

    for (let i = 0; i < 60; i++) Wo.step(w, DT, idle);
    expect(e.state).toBe('patrol');

    // Sail the Jackdaw well clear to the north, where the frigate has a clear line.
    s.x = is.x + is.r * 2.2 + 20; s.y = is.y - is.r * 3 - 60;
    if (!lineOfSight(w.map, e.x, e.y, s.x, s.y)) return;   // this seed put another island there
    expect(sees(w, e)).toBe(true);
    for (let i = 0; i < 60; i++) Wo.step(w, DT, idle);
    expect(e.state).toBe('engage');
  });

  it('the rim current swings her round instead of pinning her', () => {
    const w = lab('rim');
    const s = w.ship;
    // Just inside the current, pointing straight out, helm and canvas hard for the edge.
    const a = 0.7, d = MAP_R - EDGE + 4;
    s.x = Math.cos(a) * d; s.y = Math.sin(a) * d; s.h = a; s.v = s.maxSpeed;
    const out: Input = { ...idle, heading: a, sail: 1 };
    let far = 0, t = 0, said = false;
    while (t < 20) {
      Wo.step(w, DT, out);
      far = Math.max(far, Math.hypot(s.x, s.y));
      said ||= w.events.some((e) => e.k === 'rim');
      w.events.length = 0;
      t += DT;
      if (!s.rim && Math.hypot(s.x, s.y) < MAP_R - EDGE) break;
    }
    expect(said).toBe(true);
    expect(far).toBeLessThan(MAP_R);
    // she came about and is back inside with way on, not pinned against the current
    expect(Math.hypot(s.x, s.y)).toBeLessThan(MAP_R - EDGE);
    expect(s.v).toBeGreaterThan(s.maxSpeed * 0.5);
    expect(Math.cos(s.h - Math.atan2(-s.y, -s.x))).toBeGreaterThan(0.3);
    // and well inside the chart, the helm is hers again
    s.x = 0; s.y = 300; s.h = 0; s.rim = false;
    Wo.step(w, DT, { ...idle, heading: 1, sail: 1 });
    expect(s.rim).toBe(false);
    expect(s.h).toBeGreaterThan(0);
  });

  it('a squadron hears its own open fire', () => {
    const w = lab('squad');
    const a = abeam(w, 'brig', 400);
    const b = addFoe(w, 'brig', a.x + 60, a.y, a.h, a.squad);
    b.cool = 1e9;
    w.squads.push({ x: -a.x, y: -a.y });
    const c = addFoe(w, 'brig', -a.x, -a.y, a.h, w.squads.length - 1);
    c.cool = 1e9;
    w.weather = 'fog';                // far enough that nobody sees her on their own
    a.state = 'patrol';
    // Shoot the first one; her squadmate should come about with her, the stranger not.
    w.shots.push({ x: a.x, y: a.y, vx: 0, vy: 0, r: 2, dmg: 0.1, foe: false, kind: 'ball', pierce: 1, age: 0, life: 1, dead: false, from: 0 });
    Wo.step(w, DT, idle);
    expect(a.state).toBe('engage');
    for (let i = 0; i < 5; i++) Wo.step(w, DT, idle);
    expect(b.state).toBe('engage');
    expect(c.state).toBe('patrol');
  });
});

describe('the surrender window', () => {
  it('opens at her quarter hull and lasts exactly STRIKE_WINDOW', () => {
    const w = lab('window');
    const e = abeam(w, 'schooner', 80);
    let t = 0;
    while (e.state !== 'struck' && t < 30) {
      Wo.step(w, DT, { ...idle, fireR: true });
      t += DT;
    }
    expect(e.state).toBe('struck');
    expect(e.strikeT).toBe(Wo.STRIKE_WINDOW);
    expect(Wo.isPrize(e)).toBe(true);
    expect(e.hull).toBeGreaterThan(0);

    // Hold fire and keep off. The window closes on the tick it says it will.
    w.shots.length = 0;
    let held = 0;
    while (e.state === 'struck' && held < 20) { Wo.step(w, DT, idle); held += DT; }
    expect(Math.abs(held - Wo.STRIKE_WINDOW)).toBeLessThan(DT * 2);
    expect(e.state).toBe('spent');
    expect(Wo.isPrize(e)).toBe(false);

    // And then she is gone — off the water in ESCAPE_TIME, not sailing the chart as a ghost.
    let fled = 0;
    while (w.foes.includes(e) && fled < 60) { Wo.step(w, DT, idle); fled += DT; }
    expect(w.foes.includes(e)).toBe(false);
    expect(Math.abs(fled - Wo.ESCAPE_TIME)).toBeLessThan(DT * 2);
  });

  it('a struck ship can be sunk by broadside — and it costs notoriety (v2 departure)', () => {
    const w = lab('sinkprize');
    const e = abeam(w, 'brig', 60);
    e.state = 'struck'; e.struckOnce = true; e.strikeT = 99; e.hull = e.hullMax * 0.25;
    const heat0 = w.heat;
    let t = 0;
    while (!e.dead && t < 20) { Wo.step(w, DT, { ...idle, fireR: true }); t += DT; }
    expect(e.dead).toBe(true);
    expect(w.sunk).toBe(1);
    expect(w.plunder).toBe(CLASSES.brig.reales);
    expect(w.heat).toBeGreaterThan(heat0);
  });
});

describe('boarding', () => {
  it('coming alongside slow puts a crew across', () => {
    const w = lab('board');
    const e = abeam(w, 'brig', 18);
    e.state = 'struck'; e.struckOnce = true; e.strikeT = Wo.STRIKE_WINDOW; e.hull = e.hullMax * 0.25;
    w.ship.v = 0; w.ship.hull = 5;
    const heat0 = w.heat;
    let t = 0;
    while (!e.dead && t < 3) { Wo.step(w, DT, idle); t += DT; }
    expect(w.boarded).toBe(1);
    expect(t).toBeGreaterThanOrEqual(Wo.BOARD_TIME - DT);
    expect(w.plunder).toBe(CLASSES.brig.reales * 2);
    expect(w.ship.hull).toBeGreaterThan(5);
    expect(w.heat).toBeLessThan(heat0 + 0.001);
  });

  it('tearing past at full sail is not boarding', () => {
    const w = lab('brush');
    const e = abeam(w, 'brig', 18);
    e.state = 'struck'; e.struckOnce = true; e.strikeT = 99; e.hull = e.hullMax * 0.25;
    w.ship.v = w.ship.maxSpeed;
    for (let i = 0; i < 30; i++) Wo.step(w, DT, { ...idle, sail: 1, heading: w.ship.h });
    expect(w.boarded).toBe(0);
  });

  it('a mortar shell still finishes a prize, at the base rate', () => {
    const w = lab('mortar');
    const e = abeam(w, 'brig', 120);
    e.state = 'struck'; e.struckOnce = true; e.strikeT = 99; e.hull = e.hullMax * 0.25;
    w.marks.push({ x: e.x, y: e.y, r: 26, t: 0, max: 1.3, own: true, dmg: 99, done: false });
    const heat0 = w.heat;
    Wo.step(w, DT, idle);
    expect(w.sunk).toBe(1);
    expect(w.plunder).toBe(CLASSES.brig.reales);
    expect(w.heat).toBeGreaterThan(heat0);
  });
});

describe('damage', () => {
  it('hull clamps, a lethal hit costs one life, and a refit is whole', () => {
    const w = lab('hull', 1, { lives: 2 });
    const boom = () => w.marks.push({ x: w.ship.x, y: w.ship.y, r: 90, t: 0, max: 1, own: false, dmg: 9999, done: false });
    boom();
    Wo.step(w, DT, idle);
    expect(w.ship.hull).toBeGreaterThanOrEqual(0);
    expect(w.lives).toBe(1);
    expect(w.ship.hull).toBe(w.ship.hullMax);
    expect(w.ship.invuln).toBeGreaterThan(0);

    w.ship.invuln = 0;
    boom();
    Wo.step(w, DT, idle);
    expect(w.phase).toBe('lost');
    expect(w.ship.hull).toBeGreaterThanOrEqual(0);
  });

  it('notoriety stays on its dial', () => {
    const w = Wo.create({ seed: 'heat', wave: 1, run: { heat: 4.9 } });
    for (let i = 0; i < 120 * 90; i++) Wo.step(w, DT, idle);
    expect(w.heat).toBeLessThanOrEqual(5);
    expect(w.heat).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------- the replay -- */

const RUN: Wo.RunSeed = { upgrades: { broadside: 2, plating: 1, racks: 2 } };

function battle(seed: string, wave: number, run: Wo.RunSeed = RUN, limit = 90) {
  const w = Wo.create({ seed, wave, run });
  let i = 0;
  while ((w.phase === 'fight' || w.phase === 'clear') && w.t < limit) {
    Wo.step(w, DT, bot(w, i++, { mortar: true }));
    w.events.length = 0;
  }
  return { digest: Wo.digest(w), w };
}

describe('the replay', () => {
  it('a fixed seed replays byte-identically', () => {
    for (const [seed, wave] of [['replay', 3], ['replay', 8], ['ghost', 5], ['ghost', 12]] as const) {
      const a = battle(seed, wave), b = battle(seed, wave);
      expect(a.digest).toBe(b.digest);
      expect(a.w.ship.hull).toBeGreaterThanOrEqual(0);
      expect(a.w.heat).toBeGreaterThanOrEqual(0);
      expect(a.w.heat).toBeLessThanOrEqual(5);
    }
    expect(battle('replay', 3).digest).not.toBe(battle('ghost', 3).digest);
  });

  it('every wave from 1 to 20 ends — won or lost, never stalled', () => {
    for (let n = 1; n <= 20; n++) {
      const { w } = battle(`clear${n}`, n, RUN, 420);
      expect(w.phase, `wave ${n} stalled at t=${w.t.toFixed(0)}`).not.toBe('fight');
      expect(w.foes.every((e) => e.hull >= 0)).toBe(true);
    }
  }, 120_000);
});

/* ---------------------------------------------- the wave is not the run -- */

describe('the wave is not the run', () => {
  it('a wave in progress never writes back to the run it was built from', () => {
    const run: Run = {
      seed: 'retreat', ship: 'jackdaw', wave: 3, plunder: 400, lives: 3,
      upgrades: { plating: 1, broadside: 1 }, heat: 1.2, boarded: 2, sunk: 5, time: 90, bribes: 1, legends: 0,
    };
    const before = JSON.stringify(run);
    const seed = { ...run, lives: run.lives };
    const { w } = battle('retreat', 3, seed);
    expect(w.heat !== 1.2 || w.sunk !== 5).toBe(true);
    expect(JSON.stringify(run)).toBe(before);

    const again = Wo.create({ seed: 'retreat', wave: 3, run: seed });
    expect(again.plunder).toBe(400);
    expect(again.heat).toBe(1.2);
    expect(again.lives).toBe(3);
    expect(again.ship.hull).toBe(shipStats(shipById('jackdaw'), run.upgrades).hullMax);
  });

  it('careening banks the wave and refits her', () => {
    const run: Run = {
      seed: 'refit', ship: 'kestrel', wave: 1, plunder: 0, lives: 3, upgrades: {}, heat: 0,
      boarded: 0, sunk: 0, time: 0, bribes: 0, legends: 0,
    };
    const w = Wo.create({ seed: 'refit', wave: 1, run: { ship: 'kestrel' } });
    w.ship.hull = 2; w.ship.shells = 0; w.plunder = 900; w.heat = 1.4;
    bankWave(run, w);
    expect(run.wave).toBe(2);
    expect(run.plunder).toBe(900);
    expect(run.heat).toBe(1.4);
    const next = Wo.create({ seed: 'refit', wave: 2, run: { ship: run.ship, upgrades: run.upgrades } });
    expect(next.ship.hull).toBe(next.ship.hullMax);
    expect(next.ship.shells).toBe(next.ship.shellsMax);
    expect(next.shipId).toBe('kestrel');
  });
});

describe('the harbour', () => {
  it('a clear sea and a ship in the harbour mouth is a docking', () => {
    const w = lab('dock');
    Wo.step(w, DT, idle);
    expect(w.phase).toBe('clear');
    w.ship.x = w.map.harbour.x; w.ship.y = w.map.harbour.y;
    Wo.step(w, DT, idle);
    expect(w.phase).toBe('docked');
  });
});

describe('play-test fixes', () => {
  it('coming in under Nassau from the north is home too', () => {
    const w = lab('north');
    Wo.step(w, DT, idle);
    expect(w.phase).toBe('clear');
    const n = w.map.nassau;
    w.ship.x = n.x; w.ship.y = n.y - n.r * 1.4 - 20;
    Wo.step(w, DT, idle);
    expect(w.phase).toBe('docked');
  });

  it('the first squadron of a wave puts to sea within reach', () => {
    for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5']) {
      const w = Wo.create({ seed, wave: 3 });
      while (!w.foes.length) Wo.step(w, DT, idle);
      const s = w.ship;
      const d = Math.min(...w.foes.map((e) => Math.hypot(e.x - s.x, e.y - s.y)));
      expect(d).toBeLessThan(700);
    }
  });

  it('timed squadrons wait while the water is crowded', () => {
    const w = Wo.create({ seed: 'crowd', wave: 12 });
    for (let i = 0; i < 120 * 120; i++) {
      Wo.step(w, DT, idle);
      const live = w.foes.filter((e) => Wo.hostile(e) && !e.hunter && !e.L).length;
      // one squadron may land on top of the cap; never two
      expect(live).toBeLessThanOrEqual(crowd(w.wave) + 4);
    }
  });

  it('La Dama Negra sends a screen of launches, not an endless stream', () => {
    const w = Wo.create({ seed: 'dama', wave: 10, run: { upgrades: { plating: 4 } } });
    w.plan.groups = w.plan.groups.filter((g) => g.cls === 'legend');
    let launched = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 120 * 200 && w.phase === 'fight'; i++) {
      Wo.step(w, DT, bot(w, i));
      for (const e of w.foes) if (e.cls === 'lancha' && !seen.has(e.id)) { seen.add(e.id); launched++; }
      w.events.length = 0;
    }
    expect(launched).toBeLessThanOrEqual(10 + 2);
  });
});
