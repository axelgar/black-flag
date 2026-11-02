// The four powers, headless: what each does, once a life, and a press over the wire.

import { describe, expect, it } from 'vitest';
import { TUNING as T } from '../src/data/tuning';
import { Mirror, pack, ShotLog, type Helm, type Roster } from '../src/net/protocol';
import { Sea } from '../src/net/sea';
import { fire, foe, nearestFoe } from '../src/sim/combat';
import { onLand } from '../src/sim/map';
import { usePower } from '../src/sim/powers';
import * as Wo from '../src/sim/world';
import { POWERS, type Ship, type World } from '../src/sim/types';

const DT = 1 / 120;
const P = (k: (typeof POWERS)[number]) => POWERS.indexOf(k);

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds / DT; i++) Wo.step(w, DT);
  return w;
}

/** Two captains side by side in open water, nobody else. */
function duel(gap = 40): { w: World; a: Ship; b: Ship } {
  const w = Wo.create({ seed: 'duel' });
  const a = Wo.join(w, { seat: 'a' }), b = Wo.join(w, { seat: 'b' });
  let x = 0, y = 0;
  for (let k = 0; k < 400; k++) {
    x = (k % 20) * 20 - 200; y = Math.floor(k / 20) * 20 - 200;
    if ([0, 60, -60].every((dx) => [0, gap].every((dy) => !onLand(w.map, x + dx, y + dy)))) break;
  }
  Object.assign(a, { x, y, h: 0, v: 0, invuln: 0 });
  Object.assign(b, { x, y: y + gap, h: 0, v: 0, invuln: 0 });
  w.crates.length = 0; w.due.length = 0;
  return { w, a, b };
}

describe('the powers', () => {
  it('broadside: a fan of balls at the nearest ship, without a shot', () => {
    const { w, a } = duel();
    expect(usePower(w, a, P('broadside'))).toBe(true);
    expect(w.shots).toHaveLength(T.broadsideBalls);
    for (const s of w.shots) expect(s.vy).toBeGreaterThan(0);     // toward her, to the south
    expect(a.ammo).toBe(T.ammo);
  });

  it('each goes off once a life: used, it stays used however long she sails', () => {
    const { w, a } = duel();
    expect(usePower(w, a, P('broadside'))).toBe(true);
    run(w, 60);
    expect(usePower(w, a, P('broadside'))).toBe(false);
    expect(usePower(w, a, P('shield'))).toBe(true);
    expect(a.spent).toEqual([true, false, false, true]);
  });

  it('smoke: nobody can pick her or aim at her, until it clears or she fires', () => {
    const { w, a, b } = duel();
    usePower(w, b, P('smoke'));
    expect(foe(a, b)).toBe(false);
    expect(nearestFoe(w, a, 500)).toBeNull();
    fire(w, b, -Math.PI / 2);
    expect(b.smoke).toBe(0);
    expect(foe(a, b)).toBe(true);
    b.spent[P('smoke')] = false;
    usePower(w, b, P('smoke'));
    run(w, T.smokeFor + 0.1);
    expect(foe(a, b)).toBe(true);
  });

  it('shield: balls stop at it and do no harm', () => {
    const { w, a, b } = duel();
    usePower(w, b, P('shield'));
    fire(w, a, Math.PI / 2);
    run(w, 1);
    expect(b.hull).toBe(b.hullMax);
    expect(w.events.some((e) => e.k === 'thud' && e.shield)).toBe(true);
    run(w, T.shieldFor);
    a.gapT = 0;
    fire(w, a, Math.PI / 2);
    run(w, 1);
    expect(b.hull).toBeLessThan(b.hullMax);
  });

  it('song: a ship in range is pulled toward her, one out of range is not', () => {
    // the same sea twice, with and without the song: ships sail on as they would
    const sea = (song: boolean) => {
      const { w, a, b } = duel(70);
      const far = Wo.join(w, { seat: 'c' });
      Object.assign(far, { x: a.x, y: a.y - (T.songRange + 60), h: 0, v: 0, invuln: 0 });
      if (song) usePower(w, a, P('song'));
      run(w, 1);
      return { near: Math.hypot(b.x - a.x, b.y - a.y), far: Math.hypot(far.x - a.x, far.y - a.y) };
    };
    const sung = sea(true), not = sea(false);
    expect(sung.near).toBeLessThan(not.near - T.songPull * 0.8);
    expect(sung.far).toBeCloseTo(not.far, 3);
  });

  it('has every one again when she comes back from sinking', () => {
    const { w, b } = duel();
    for (let i = 0; i < POWERS.length; i++) usePower(w, b, i);
    b.hull = 1; b.out = true; b.down = 0;
    run(w, T.respawn + 0.1);
    expect(b.out).toBe(false);
    expect(b.spent.every((used) => !used)).toBe(true);
    expect(b.smoke + b.song + b.shield).toBe(0);
  });
});

describe('a power over the wire', () => {
  it('goes off once a press, and the phone hears it is used, and the smoke', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join({ seat: 'me', name: 'Me', look: 'jackdaw' });
    let roster: Roster | null = null;
    for (const o of sea.step(1 / 30)) if (o.t === 'roster') roster = o;
    const id = roster!.seats.find((s) => s.seat === 'me')!.id;
    const helm = (u: number[]): Helm => ({ t: 'in', n: 1, m: null, f: 0, fa: 0, a: 0, u });
    sea.helm('me', helm([0, 1, 0, 0]));
    sea.step(1 / 30);
    const me = sea.world.ships[id];
    expect(me.smoke).toBeGreaterThan(0);
    expect(me.spent[P('smoke')]).toBe(true);
    me.spent[P('smoke')] = false;
    sea.step(1 / 30);
    expect(me.spent[P('smoke')]).toBe(false);     // not set off again by the same press
    me.spent[P('smoke')] = true;

    // a phone that sends no powers at all still sails
    sea.helm('me', { t: 'in', n: 2, m: [1, 0], f: 0, fa: 0, a: 0 });
    sea.step(1 / 30);

    const mirror = new Mirror();
    mirror.roster(roster!, 'me');
    const snap = { ...pack(sea.world, sea.clock, [], new ShotLog()), me: sea.own('me') };
    mirror.push(snap, 0);
    mirror.frame(1);
    const seen = mirror.world!.ships[id];
    expect(seen.smoke).toBe(1);
    expect(seen.spent).toEqual([false, true, false, false]);
  });
});
