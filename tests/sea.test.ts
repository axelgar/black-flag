// A shared sea, with no server: captains come aboard, sail, leave and come back, and the
// phone's copy of the sea is built from what the sea sends.

import { describe, expect, it } from 'vitest';
import { TUNING as T } from '../src/data/tuning';
import { BLIP, Sea } from '../src/net/sea';
import { Mirror, type Helm, type Roster, type Snap } from '../src/net/protocol';
import { sink } from '../src/sim/combat';

const STEP = 1 / 30;

function beat(sea: Sea, seconds: number) {
  const out: (Roster | Snap)[] = [];
  for (let i = 0; i < seconds / STEP; i++) out.push(...sea.step(STEP));
  return out;
}

const aboard = (seat: string, name = seat) => ({ seat, name, look: 'jackdaw' });
const shipOf = (sea: Sea, seat: string) => sea.world.ships[sea.roster().seats.find((s) => s.seat === seat)!.id];

describe('a shared sea', () => {
  it('makes up the numbers with bots, named, coloured and marked as bots', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    expect(sea.join(aboard('a', 'Marta'))).toBeNull();
    beat(sea, 0.1);
    const r = sea.roster();
    const live = r.seats.filter((s) => !s.left);
    expect(live).toHaveLength(T.minShips);
    expect(live.filter((s) => s.bot)).toHaveLength(T.minShips - 1);
    expect(live.find((s) => !s.bot)!.name).toBe('Marta');
    for (const s of live) { expect(s.name.length).toBeGreaterThan(0); expect(s.c).toBeGreaterThanOrEqual(0); }
  });

  it('a captain coming aboard sends a bot home the next time it sinks', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    beat(sea, 0.1);
    sea.join(aboard('b'));
    const retiring = sea.world.ships.filter((s) => s.bot && s.retire);
    expect(retiring).toHaveLength(1);
    expect(retiring[0].left).toBe(false);
    sink(sea.world, retiring[0], null);
    beat(sea, T.respawn + 0.2);
    expect(retiring[0].left).toBe(true);
    expect(sea.roster().seats.filter((s) => !s.left)).toHaveLength(T.minShips);
  });

  it('two captains of the same name are told apart', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a', 'Jack'));
    sea.join(aboard('b', 'jack'));
    const names = sea.roster().seats.filter((s) => !s.bot && !s.left).map((s) => s.name);
    expect(names).toEqual(['Jack', 'jack II']);
  });

  it('a captain who leaves out of a fight docks after a moment, and gets her streak back', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    beat(sea, 0.1);
    const s = shipOf(sea, 'a');
    s.streak = 3; s.calm = T.calm + 1;
    sea.leave('a');
    beat(sea, BLIP - 0.5);
    expect(s.left).toBe(false);
    beat(sea, 1);
    expect(s.left).toBe(true);
    expect(sea.aboard).toBe(0);
    sea.join(aboard('a'));
    expect(shipOf(sea, 'a').streak).toBe(3);
  });

  it('a captain who leaves in a fight leaves her ship on the sea a while, and it can be sunk', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    beat(sea, 0.1);
    const s = shipOf(sea, 'a');
    s.streak = 2;
    sea.leave('a');
    s.calm = 0;
    beat(sea, BLIP + 1);
    expect(s.left).toBe(false);
    sink(sea.world, s, null);
    beat(sea, T.linger);
    expect(s.left).toBe(true);
    sea.join(aboard('a'));
    expect(shipOf(sea, 'a').streak).toBe(0);
  });

  it('a phone back within the linger takes her ship back', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    beat(sea, 0.1);
    const s = shipOf(sea, 'a');
    s.calm = 0;
    sea.leave('a');
    beat(sea, 2);
    s.calm = 0;
    sea.join(aboard('a'));
    beat(sea, T.linger + 1);
    expect(shipOf(sea, 'a')).toBe(s);
    expect(s.left).toBe(false);
  });

  it('five in a row on a ticket is a free shot, once; without one, and for a bot, practice', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join({ ...aboard('a'), ticket: true });
    sea.join(aboard('b'));
    beat(sea, 0.5);
    const fifth = (by: ReturnType<typeof shipOf>) => {
      by.streak = T.win - 1;
      sink(sea.world, sea.world.ships.find((s) => s !== by && !s.out && !s.left)!, by);
      return beat(sea, 0.2).flatMap((o) => (o.t === 's' ? o.e : [])).filter((e) => e.k === 'won');
    };
    const a = shipOf(sea, 'a'), b = shipOf(sea, 'b'), bot = sea.world.ships.find((s) => s.bot)!;
    expect(fifth(a)).toEqual([expect.objectContaining({ p: a.id, prize: true })]);
    expect(fifth(a)).toEqual([expect.objectContaining({ p: a.id, prize: false })]);
    expect(fifth(b)).toEqual([expect.objectContaining({ p: b.id, prize: false })]);
    expect(fifth(bot)).toEqual([expect.objectContaining({ p: bot.id, prize: false })]);
    expect(sea.takeWins()).toEqual([{ seat: 'a', prize: true }, { seat: 'a', prize: false }, { seat: 'b', prize: false }]);
    expect(sea.takeWins()).toEqual([]);
  });

  it('turns away a captain past the most a sea holds', () => {
    const sea = new Sea('BAR1', { seed: 't', cap: 3 });
    for (const x of ['a', 'b', 'c']) expect(sea.join(aboard(x))).toBeNull();
    expect(sea.join(aboard('d'))).toBe('full');
  });

  it('fires a press once, toward the bearing it was aimed', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    beat(sea, 0.1);
    const s = shipOf(sea, 'a');
    const h: Helm = { t: 'in', n: 1, m: null, f: 1, fa: 1.2, a: 0 };
    sea.helm('a', h);
    const out = beat(sea, 0.5);
    const volleys = out.flatMap((m) => (m.t === 's' ? m.e : [])).filter((e) => e.k === 'volley' && e.p === s.id);
    expect(volleys).toHaveLength(1);
    expect(volleys[0].a).toBeCloseTo(1.2, 2);
  });
});

describe('the mirror', () => {
  it('builds the phone\'s sea from the roster and snapshots: ships, balls and crates', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    const m = new Mirror();
    let now = 0;
    const take = (out: (Roster | Snap)[]) => {
      for (const o of out) {
        if (o.t === 'roster') m.roster(o, 'a');
        else m.push({ ...o, me: sea.own('a') }, now);
      }
    };
    for (let i = 0; i < 90; i++) { now += STEP; take(sea.step(STEP)); }
    sea.helm('a', { t: 'in', n: 1, m: null, f: 1, fa: 0, a: 0 });
    for (let i = 0; i < 6; i++) { now += STEP; take(sea.step(STEP)); }
    m.frame(now + 0.2);
    const w = m.world!;
    expect(w.ships.filter((s) => !s.left)).toHaveLength(T.minShips);
    const mine = w.ships[w.focus];
    const real = shipOf(sea, 'a');
    expect(mine.seat).toBe('a');
    expect(Math.hypot(mine.x - real.x, mine.y - real.y)).toBeLessThan(15);
    expect(mine.ammo).toBeLessThan(T.ammo);
    expect(w.shots.length).toBeGreaterThan(0);
    expect(w.crates.length).toBe(sea.world.crates.length);
    expect(m.seats.find((s) => s.id === w.focus)!.name).toBe('a');
  });

  it('a ship back from the bottom is drawn where she came back, never partway across the sea', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    const m = new Mirror();
    let now = 0, back: { x: number; y: number } | null = null, seen: { x: number; y: number } | null = null, out = false;
    const bot = () => sea.world.ships.find((s) => s.bot && !s.retire)!;
    const run = (seconds: number) => {
      for (let i = 0; i < seconds / STEP; i++) {
        now += STEP;
        const was = bot().out;
        for (const o of sea.step(STEP)) {
          if (o.t === 'roster') m.roster(o, 'a');
          else m.push({ ...o, me: sea.own('a') }, now);
        }
        if (was && !bot().out) back = { x: bot().x, y: bot().y };
        // a phone paints twice for each snapshot
        for (const f of [0, 0.5]) {
          m.frame(now + f * STEP);
          const s = m.world!.ships[bot().id];
          if (s.out) out = true;
          else if (out && !seen) seen = { x: s.x, y: s.y };
        }
      }
    };
    run(1);
    back = seen = null; out = false;
    sink(sea.world, bot(), null);
    run(T.respawn + 1);
    expect(back).not.toBeNull();
    expect(seen).not.toBeNull();
    expect(Math.hypot(seen!.x - back!.x, seen!.y - back!.y)).toBeLessThan(3);
  });
});
