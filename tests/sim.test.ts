// The fight, headless: a sea stepped at the game's fixed rate, poked and read.

import { describe, expect, it } from 'vitest';
import { TUNING as T, seaRadius } from '../src/data/tuning';
import { fire, sink, wound } from '../src/sim/combat';
import { MAP_R, islandSd, makeMap, onLand } from '../src/sim/map';
import * as Wo from '../src/sim/world';
import type { Input, Ship, World } from '../src/sim/types';

const DT = 1 / 120;

function run(w: World, seconds: number, inputs: (Input | undefined)[] = []) {
  for (let i = 0; i < seconds / DT; i++) Wo.step(w, DT, inputs);
  return w;
}

/** A sea with two captains, side by side in open water, nobody else. */
function duel(): { w: World; a: Ship; b: Ship } {
  const w = Wo.create({ seed: 'duel' });
  const a = Wo.join(w, { seat: 'a' }), b = Wo.join(w, { seat: 'b' });
  // somewhere open, away from every island
  let x = 0, y = 0;
  for (let k = 0; k < 400; k++) {
    x = (k % 20) * 20 - 200; y = Math.floor(k / 20) * 20 - 200;
    if ([0, 60, -60].every((dx) => [0, 40].every((dy) => !onLand(w.map, x + dx, y + dy)))) break;
  }
  Object.assign(a, { x, y, h: 0, v: 0, invuln: 0 });
  Object.assign(b, { x, y: y + 40, h: 0, v: 0, invuln: 0 });
  w.crates.length = 0; w.due.length = 0;
  return { w, a, b };
}

describe('the chart', () => {
  it('lays islands out for the biggest sea, with a few in the middle and none touching', () => {
    const m = makeMap('chart');
    const small = seaRadius(T.minShips);
    expect(m.islands.filter((is) => Math.hypot(is.x, is.y) < small * 0.8).length).toBeGreaterThanOrEqual(3);
    for (const is of m.islands) {
      expect(Math.hypot(is.x, is.y) + is.r).toBeLessThan(MAP_R);
      expect(is.r).toBeGreaterThanOrEqual(10);
      expect(is.r).toBeLessThanOrEqual(50);
      expect(islandSd(is, is.x, is.y)).toBeLessThan(0);
      for (const o of m.islands) if (o !== is) expect(Math.hypot(o.x - is.x, o.y - is.y)).toBeGreaterThan(o.r + is.r + 60);
    }
  });
});

describe('the guns', () => {
  it('fires a volley of balls along the bearing aimed, from the side facing it, and spends a shot', () => {
    const { w, a } = duel();
    expect(fire(w, a, Math.PI / 2)).toBe(true);
    expect(w.shots).toHaveLength(T.balls);
    for (const s of w.shots) {
      expect(Math.atan2(s.vy, s.vx)).toBeCloseTo(Math.PI / 2, 0);
      expect(s.y).toBeGreaterThan(a.y);           // starboard: the side facing south
    }
    expect(a.ammo).toBe(T.ammo - 1);
    expect(w.events.some((e) => e.k === 'volley' && e.side === 1)).toBe(true);
  });

  it('waits the gap between volleys, runs dry, and gets its shots back one at a time', () => {
    const { w, a } = duel();
    expect(fire(w, a, 0)).toBe(true);
    expect(fire(w, a, 0)).toBe(false);            // within the gap
    run(w, T.gap + 0.01);
    expect(fire(w, a, 0)).toBe(true);
    run(w, T.gap + 0.01);
    expect(fire(w, a, 0)).toBe(true);
    run(w, T.gap + 0.01);
    expect(a.ammo).toBe(0);
    expect(fire(w, a, 0)).toBe(false);
    run(w, T.reload - T.gap);
    expect(a.ammo).toBe(1);
  });

  it('sinks a ship in as many volleys as the tuning says, all hitting', () => {
    const { w, a, b } = duel();
    let volleys = 0;
    while (!b.out && volleys < 10) {
      fire(w, a, Math.PI / 2); volleys++;
      run(w, T.reload + 0.05);
    }
    expect(b.out).toBe(true);
    expect(volleys).toBe(Math.ceil(T.hull / (T.balls * T.damage)));
  });

  it('a quick tap fires at the nearest ship', () => {
    const { w, a, b } = duel();
    Wo.step(w, DT, [{ move: null, fire: null, auto: true }]);
    run(w, 0.4);
    expect(b.hull).toBeLessThan(b.hullMax);
    expect(a.ammo).toBe(T.ammo - 1);
  });

  it('does not hurt a ship in her grace, and is stopped by an island', () => {
    const { w, a, b } = duel();
    b.invuln = 5;
    fire(w, a, Math.PI / 2);
    run(w, 1);
    expect(b.hull).toBe(b.hullMax);
    const is = w.map.islands[0];
    Object.assign(a, { x: is.x - is.r - 30, y: is.y });
    Object.assign(b, { x: is.x + is.r + 30, y: is.y, invuln: 0 });
    a.gapT = 0;
    fire(w, a, 0);
    run(w, 1.5);
    expect(b.hull).toBe(b.hullMax);
    expect(w.events.some((e) => e.k === 'thud' && e.rock)).toBe(true);
  });

  it('heavy shot from a crate doubles the next volley', () => {
    const { w, a } = duel();
    a.heavy = true;
    fire(w, a, 0);
    expect(w.shots.every((s) => s.dmg === T.damage * T.heavy)).toBe(true);
    expect(a.heavy).toBe(false);
  });
});

describe('streaks', () => {
  it('gives the sink to the last hit, adds one to that streak and clears the sunk ship\'s', () => {
    const { w, a, b } = duel();
    const c = Wo.join(w, { seat: 'c' });
    b.streak = 3;
    wound(w, b, b.hull - 1, c);
    wound(w, b, 5, a);
    expect(b.out).toBe(true);
    expect(b.streak).toBe(0);
    expect(a.streak).toBe(1);
    expect(c.streak).toBe(0);
    expect(w.events.find((e) => e.k === 'sunk')).toMatchObject({ p: b.id, by: a.id, lost: 3 });
  });

  it('wins at five in a row, and starts again from nothing', () => {
    const { w, a, b } = duel();
    for (let i = 0; i < T.win; i++) { b.out = false; b.invuln = 0; b.hull = 1; wound(w, b, 5, a); }
    expect(w.events.filter((e) => e.k === 'won')).toHaveLength(1);
    expect(w.events.find((e) => e.k === 'won')).toMatchObject({ p: a.id, n: T.win });
    expect(a.streak).toBe(0);
    expect(a.sank).toBe(T.win);
  });

  it('a sunk ship is back at a quiet edge after the respawn, whole and in her grace', () => {
    const { w, a, b } = duel();
    sink(w, b, a);
    run(w, T.respawn - 0.1);
    expect(b.out).toBe(true);
    run(w, 0.2);
    expect(b.out).toBe(false);
    expect(b.hull).toBe(b.hullMax);
    expect(b.invuln).toBeGreaterThan(0);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(100);
    expect(onLand(w.map, b.x, b.y)).toBe(false);
  });

  it('a bot making room for a captain leaves when it sinks, instead of coming back', () => {
    const { w, a } = duel();
    const bot = Wo.join(w, { bot: true });
    bot.retire = true;
    sink(w, bot, a);
    run(w, T.respawn + 0.1);
    expect(bot.left).toBe(true);
  });
});

describe('the hull', () => {
  it('mends after a while without being hit', () => {
    const { w, b } = duel();
    wound(w, b, 50, null);
    const left = b.hullMax - 50;
    run(w, T.mendAfter - 0.2);
    expect(b.hull).toBe(left);
    run(w, 2.2);
    expect(b.hull).toBeGreaterThan(left);
  });
});

describe('the sea', () => {
  it('grows at once as ships join, and closes in slowly as they leave', () => {
    const w = Wo.create({ seed: 'grow' });
    for (let i = 0; i < 5; i++) Wo.join(w, { bot: true });
    expect(w.R).toBeCloseTo(seaRadius(5), 5);
    const more = Array.from({ length: 15 }, () => Wo.join(w, { seat: 'x' }));
    expect(w.R).toBeCloseTo(seaRadius(20), 5);
    for (const s of more) Wo.leave(w, s.id);
    run(w, 1);
    expect(w.R).toBeCloseTo(seaRadius(20) - T.edgeSpeed, 0);
    run(w, 60);
    expect(w.R).toBeCloseTo(seaRadius(5), 5);
  });

  it('keeps a crate for every few ships, and a taken one comes back later', () => {
    const w = Wo.create({ seed: 'crates' });
    for (let i = 0; i < 6; i++) Object.assign(Wo.join(w, { seat: `c${i}` }), { trim: 0, v: 0 });
    run(w, 0.1);
    expect(w.crates).toHaveLength(Math.ceil(6 / T.shipsPerCrate));
    const s = w.ships[0], c = w.crates[0];
    Object.assign(s, { x: c.x, y: c.y, hull: 10 });
    run(w, 0.1);
    expect(w.crates).toHaveLength(1);
    if (c.kind === 'repair') expect(s.hull).toBeGreaterThan(10 + T.hull * T.repair - 1);
    Object.assign(s, { x: s.x + 200 });
    run(w, T.crateEvery + 0.1);
    expect(w.crates).toHaveLength(2);
  });
});

describe('bots', () => {
  it('fight each other: within a few minutes ships sink and streaks are won and lost', () => {
    const w = Wo.create({ seed: 'bots' });
    for (let i = 0; i < 5; i++) Wo.join(w, { bot: true });
    let sunk = 0, volleys = 0;
    for (let i = 0; i < 180 / DT; i++) {
      Wo.step(w, DT);
      for (const e of w.events) { if (e.k === 'sunk') sunk++; if (e.k === 'volley') volleys++; }
      w.events.length = 0;
    }
    expect(volleys).toBeGreaterThan(50);
    expect(sunk).toBeGreaterThan(3);
    for (const s of w.ships) expect(onLand(w.map, s.x, s.y)).toBe(false);
  });

  it('replay the same sea the same way, every time', () => {
    const sail = () => {
      const w = Wo.create({ seed: 'replay' });
      for (let i = 0; i < 5; i++) Wo.join(w, { bot: true });
      return Wo.digest(run(w, 30));
    };
    expect(sail()).toBe(sail());
  });
});
