// The three powers, headless: what each does, once a life, the bots reaching for them, a
// phone stepping its own ship through a song, and a press over the wire.

import { describe, expect, it } from 'vitest';
import { TUNING as T } from '../src/data/tuning';
import { Lead } from '../src/net/lead';
import { Mirror, pack, ShotLog, type Helm, type Roster } from '../src/net/protocol';
import { Sea } from '../src/net/sea';
import { botInput } from '../src/sim/bots';
import { fire } from '../src/sim/combat';
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

/** Two captains `gap` apart, north and south, in open water, nobody else. */
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
    expect(w.events.find((e) => e.k === 'volley')?.n).toBe(T.broadsideBalls);
  });

  it('broadside: most of it hits a ship alongside, and hurts more than a volley', () => {
    const { w, a, b } = duel();
    usePower(w, a, P('broadside'));
    run(w, 1);
    expect(b.hullMax - b.hull).toBeGreaterThan(T.balls * T.damage);
  });

  it('each goes off once a life: used, it stays used however long she sails', () => {
    const { w, a } = duel();
    expect(usePower(w, a, P('broadside'))).toBe(true);
    run(w, 60);
    expect(usePower(w, a, P('broadside'))).toBe(false);
    expect(usePower(w, a, P('shield'))).toBe(true);
    expect(a.spent).toEqual(POWERS.map((k) => k === 'broadside' || k === 'shield'));
  });

  it('shield: balls stop at it and do no harm, until it is down', () => {
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
    expect(b.song + b.shield).toBe(0);
  });
});

describe('a bot and its powers', () => {
  /** What a bot asks for over a few seconds, thinking as often as it does. */
  function asks(w: World, s: Ship, seconds = 4, each = () => {}) {
    const got = new Set<number>();
    for (let i = 0; i < seconds / DT; i++) { each(); const p = botInput(w, s, DT).power; if (p != null) got.add(p); }
    return got;
  }

  it('puts the shield up when it is being hit and losing', () => {
    const { w, a } = duel();
    a.bot = true; a.hull = a.hullMax * 0.3;
    expect(asks(w, a, 4, () => { a.mendT = 0; }).has(P('shield'))).toBe(true);
  });

  it('sings to a ship getting away, and not to one standing still', () => {
    const { w, a, b } = duel(T.songRange * 0.8);
    a.bot = true;
    Object.assign(b, { h: Math.PI / 2, v: T.speed });          // heading south, away from her
    expect(asks(w, a).has(P('song'))).toBe(true);
    const still = duel(T.songRange * 0.8);
    still.a.bot = true;
    expect(asks(still.w, still.a).has(P('song'))).toBe(false);
  });

  it('lets go a broadside at a hurt ship close by', () => {
    const { w, a, b } = duel();
    a.bot = true; b.hull = b.hullMax * 0.4;
    expect(asks(w, a).has(P('broadside'))).toBe(true);
  });
});

describe('a phone in a song', () => {
  it('pulls its own ship toward the singer as it steps her, as the sea does', () => {
    const { w, a, b } = duel(70);
    const lead = new Lead();
    const R = 5000;                       // a sea wide enough that its edge leaves her be
    // the phone has her where the sea has her, lying still
    lead.hear({ map: w.map, R, focus: b.id }, [3, 0, 0, 0, 0, 0, 0, 0, b.x, b.y, b.h, 0, 0, 0, 0, 0, 0], false);
    const before = Math.hypot(lead.ship!.x - a.x, lead.ship!.y - a.y);
    for (let i = 0; i < 60; i++) lead.advance({ map: w.map, R }, 1 / 60, 0, null, [[a.x, a.y]]);
    expect(Math.hypot(lead.ship!.x - a.x, lead.ship!.y - a.y)).toBeCloseTo(before - T.songPull, 0);
  });
});

describe('a power over the wire', () => {
  it('goes off once a press, and the phone hears it is used, and the song', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join({ seat: 'me', name: 'Me', look: 'jackdaw' });
    let roster: Roster | null = null;
    for (const o of sea.step(1 / 30)) if (o.t === 'roster') roster = o;
    const id = roster!.seats.find((s) => s.seat === 'me')!.id;
    const helm = (u: number[]): Helm => ({ t: 'in', n: 1, m: null, f: 0, fa: 0, a: 0, u });
    sea.helm('me', helm(POWERS.map((k) => (k === 'song' ? 1 : 0))));
    sea.step(1 / 30);
    const me = sea.world.ships[id];
    expect(me.song).toBeGreaterThan(0);
    expect(me.spent[P('song')]).toBe(true);
    me.spent[P('song')] = false;
    sea.step(1 / 30);
    expect(me.spent[P('song')]).toBe(false);     // not set off again by the same press
    me.spent[P('song')] = true;

    // a phone that sends no powers at all still sails
    sea.helm('me', { t: 'in', n: 2, m: [1, 0], f: 0, fa: 0, a: 0 });
    sea.step(1 / 30);

    const mirror = new Mirror();
    mirror.roster(roster!, 'me');
    const snap = { ...pack(sea.world, sea.clock, [], new ShotLog()), me: sea.own('me') };
    mirror.push(snap, 0);
    mirror.frame(1);
    const seen = mirror.world!.ships[id];
    expect(seen.song).toBe(1);
    expect(seen.spent).toEqual(POWERS.map((k) => k === 'song'));
  });
});
