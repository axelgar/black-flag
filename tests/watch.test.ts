// The bar's TV: what it says down its side. Captains only, since the room is watching the
// people in it, and a free shot won said big.

import { describe, expect, it } from 'vitest';
import { TUNING as T } from '../src/data/tuning';
import type { Roster, Seat } from '../src/net/protocol';
import * as Wo from '../src/sim/world';
import { feedLine, standings } from '../src/watch/board';
import { captains } from '../src/watch/line';

const seats: Seat[] = [
  { id: 0, seat: 'a', name: 'Marta', look: 'jackdaw', bot: false, left: false, c: 0 },
  { id: 1, seat: '', name: 'Calico Jack', look: 'jackdaw', bot: true, left: false, c: 1 },
  { id: 2, seat: 'b', name: 'Jack', look: 'jackdaw', bot: false, left: false, c: 2 },
  { id: 3, seat: '', name: 'Anne Bonny', look: 'jackdaw', bot: true, left: false, c: 3 },
  { id: 4, seat: '', name: '', look: 'jackdaw', bot: false, left: true, c: -1 },
];

function world(streaks: number[]) {
  const w = Wo.create({ seed: 't' });
  w.ships = streaks.map((n, i) => ({ ...Wo.launch({}, i), streak: n }));
  return w;
}

describe("the bar's TV", () => {
  it('counts captains aboard, not bots or empty seats', () => {
    const r: Roster = { t: 'roster', seed: 't', seats };
    expect(captains(r).map((s) => s.name)).toEqual(['Marta', 'Jack']);
    expect(captains(null)).toEqual([]);
  });

  it('lists the captains on a streak, longest first, with WANTED one short of winning', () => {
    const top = standings(world([2, 4, T.wanted, 3, 0]), seats);
    expect(top.map((s) => [s.name, s.streak, s.wanted])).toEqual([['Jack', T.wanted, true], ['Marta', 2, false]]);
    expect(standings(world([0, 0, 0, 0, 0]), seats)).toEqual([]);
  });

  it('says a free shot won big, and a win without a ticket as what it would have been', () => {
    const prize = feedLine({ k: 'won', p: 0, n: 5, prize: 7 }, seats)!;
    expect(prize.big).toBe('Marta won a free shot!');
    expect(prize.html).toContain('Marta');
    expect(feedLine({ k: 'won', p: 2, n: 5 }, seats)!.big).toBe('Jack sank five in a row!');
  });

  it('leaves out what is only bots: their wins, their fights with each other, their coming aboard', () => {
    expect(feedLine({ k: 'won', p: 1, n: 5 }, seats)).toBeNull();
    expect(feedLine({ k: 'sunk', p: 3, by: 1 }, seats)).toBeNull();
    expect(feedLine({ k: 'joined', p: 3, bot: true }, seats)).toBeNull();
    expect(feedLine({ k: 'streak', p: 1, n: T.wanted }, seats)).toBeNull();
  });

  it('tells a sinking with a captain in it, either way round, and a captain WANTED', () => {
    expect(feedLine({ k: 'sunk', p: 1, by: 0 }, seats)!.html).toMatch(/Marta.*sank.*Calico Jack/);
    expect(feedLine({ k: 'sunk', p: 2, by: 3 }, seats)!.html).toMatch(/Anne Bonny.*sank.*Jack/);
    expect(feedLine({ k: 'sunk', p: 2 }, seats)).toBeNull();
    expect(feedLine({ k: 'streak', p: 0, n: T.wanted }, seats)!.html).toContain('WANTED');
    expect(feedLine({ k: 'streak', p: 0, n: 2 }, seats)).toBeNull();
    expect(feedLine({ k: 'joined', p: 2, bot: false }, seats)!.html).toMatch(/Jack.*set sail/);
  });

  it('keeps a name from being read as markup', () => {
    const odd: Seat[] = [{ ...seats[0], name: '<b>x</b>' }];
    expect(feedLine({ k: 'won', p: 0, n: 5 }, odd)!.html).not.toContain('<b>x</b>');
  });
});
