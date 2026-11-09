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

/** With no fleet of bots, for as long as `f` runs: bots only make up the numbers. */
function noFleet(f: () => void) {
  const had = T.bots;
  T.bots = 0;
  try { f(); } finally { T.bots = had; }
}

describe('a shared sea', () => {
  it('keeps its fleet of bots on the water however many captains are aboard', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    const bots = () => sea.roster().seats.filter((s) => !s.left && s.bot).length;
    sea.join(aboard('a'));
    beat(sea, 0.1);
    expect(bots()).toBe(T.bots);
    sea.join(aboard('b'));
    sea.join(aboard('c'));
    beat(sea, 0.1);
    expect(bots()).toBe(T.bots);
    expect(sea.world.ships.filter((s) => s.bot && s.retire)).toHaveLength(0);
  });

  it('makes up the numbers with bots, named, coloured and marked as bots', () => noFleet(() => {
    const sea = new Sea('BAR1', { seed: 't' });
    expect(sea.join(aboard('a', 'Marta'))).toBeNull();
    beat(sea, 0.1);
    const r = sea.roster();
    const live = r.seats.filter((s) => !s.left);
    expect(live).toHaveLength(T.minShips);
    expect(live.filter((s) => s.bot)).toHaveLength(T.minShips - 1);
    expect(live.find((s) => !s.bot)!.name).toBe('Marta');
    for (const s of live) { expect(s.name.length).toBeGreaterThan(0); expect(s.c).toBeGreaterThanOrEqual(0); }
  }));

  it('a captain coming aboard sends a bot home the next time it sinks', () => noFleet(() => {
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
  }));

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
    expect(w.ships.filter((s) => !s.left)).toHaveLength(T.bots + 1);
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

describe('her hands, as the sea sails her by them', () => {
  const TICK = 1 / 120;
  const hands = (n: number, d: number): Helm => ({ t: 'in', n, m: [Math.cos(n), Math.sin(n)], f: 0, fa: 0, a: 0, d });
  /** Which of her hands the sea is sailing her by, and for how many ticks so far. */
  const ran = (sea: Sea) => sea.own('a')!.slice(6, 8);

  it('sails each as long as her phone did, though they come all at once', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    for (const [n, d] of [[1, 0], [2, 6], [3, 4], [4, 8]]) sea.helm('a', hands(n, d));
    const by: number[] = [];
    for (let i = 0; i < 21; i++) { sea.step(TICK); by.push(ran(sea)[0]); }
    expect(by).toEqual([...Array(6).fill(1), ...Array(4).fill(2), ...Array(8).fill(3), 4, 4, 4]);
  });

  it('takes hands that come late at once, then makes up the ticks it fell behind by', () => {
    // her phone sends new hands every 6 ticks; the line takes 12 ticks, and once 16
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    const wire: { at: number; m: Helm }[] = [];
    const sailed = new Map<number, number>();
    let behind = 0;
    for (let t = 0, n = 0; t < 120 * 5; t++) {
      if (t % 6 === 0) { n++; wire.push({ at: t + (n === 20 ? 16 : 12), m: hands(n, n > 1 ? 6 : 0) }); }
      while (wire.length && wire[0].at <= t) sea.helm('a', wire.shift()!.m);
      sea.step(TICK);
      const [k, ticks] = ran(sea);
      sailed.set(k, ticks);
      behind = t + 1 - (6 * (k - 1) + ticks);     // how far behind her phone the sea is sailing her
    }
    expect(sailed.get(19)).toBe(10);              // waiting on the late hands
    const short = [...sailed].filter(([k, ticks]) => k > 20 && k < 90 && ticks === 5);
    expect(short).toHaveLength(2);                // two of the four made up, two kept in hand
    expect(behind).toBe(12 + 2);
    for (const [k, ticks] of sailed) if (k > 1 && k < 90 && k !== 19) expect(ticks).toBeGreaterThanOrEqual(5);
  });

  it('goes straight to the newest hands when the line was gone a moment', () => {
    const sea = new Sea('BAR1', { seed: 't' });
    sea.join(aboard('a'));
    sea.helm('a', hands(1, 0));
    for (let i = 0; i < 66; i++) sea.step(TICK);
    // half a second with nothing, then all the line held at once
    for (let n = 2; n <= 11; n++) sea.helm('a', hands(n, 6));
    sea.step(TICK);
    const [n] = ran(sea);
    expect(n).toBeGreaterThan(2);
    expect((11 - n) * 6).toBeLessThanOrEqual(30);
  });
});

describe('the mirror on a line that holds a snapshot up', () => {
  /** A sea of bots, a mirror of it, and frames painted sixty times a second; `held` says
   *  when snapshots are kept back, all to come at once when it ends. */
  function watch(seconds: number, held: (t: number) => boolean) {
    const sea = new Sea('BAR1', { seed: 'held' });
    sea.join(aboard('a'));
    const m = new Mirror();
    const late: Snap[] = [];
    const drawn: Map<number, { x: number; y: number; v: number }>[] = [];
    for (let f = 0, now = 0; now < seconds; f++, now = f / 60) {
      if (f % 2 === 0) {
        for (const o of sea.step(STEP)) {
          if (o.t === 'roster') m.roster(o, 'a');
          else late.push({ ...o, me: sea.own('a') });
        }
      }
      if (!held(now)) for (const s of late.splice(0)) m.push(s, now);
      m.frame(now);
      drawn.push(new Map(m.world!.ships.filter((s) => !s.out && s.id !== m.world!.focus).map((s) => [s.id, { x: s.x, y: s.y, v: s.v }])));
    }
    return drawn;
  }
  const moved = (a: Map<number, { x: number; y: number }>, b: Map<number, { x: number; y: number }>, id: number) =>
    Math.hypot(b.get(id)!.x - a.get(id)!.x, b.get(id)!.y - a.get(id)!.y);

  it('sails the ships on while it waits, and glides each to where the sea says', () => {
    const drawn = watch(5, (t) => t >= 3 && t < 3.5);
    let checked = 0;
    for (let f = 2.5 * 60; f < drawn.length; f++) {
      const a = drawn[f - 1], b = drawn[f];
      for (const id of b.keys()) {
        if (!a.has(id)) continue;
        const d = moved(a, b, id);
        // while it waits, never stopped dead under way; and never a jump: a frame at full
        // sail is 0.4 m, and a guess put right is spread over many
        if (f / 60 >= 3 && f / 60 < 3.5 && a.get(id)!.v > 10) { expect(d).toBeGreaterThan(0.1); checked++; }
        expect(d).toBeLessThan(1.5);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('and stops them, gently, if the wait goes on', () => {
    const drawn = watch(6, (t) => t >= 3);
    const end = drawn.length - 1, a = drawn[end - 1], b = drawn[end];
    for (const id of b.keys()) if (a.has(id)) expect(moved(a, b, id)).toBeLessThan(0.01);
  });
});
