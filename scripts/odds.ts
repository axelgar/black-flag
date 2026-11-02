// How long a guest takes to win a free shot, with the tuning as it stands: `npm run odds
// [-- options]`. The sea server's own Sea, stepped flat out with one scripted captain
// against the bots, over many seas: no network, a few seconds a row. Run it after changing
// src/data/tuning.ts, before the bar finds out.
//
//   --seas <n>          seas to sail for each row (default 30)
//   --try k=v,k=v       another row, with these settings changed: --try botSkill=0.75,hull=200
//                       (as many as you like)
//
// A scripted captain is not a guest: she never misreads the screen or puts her drink down.
// Read the times as about the quickest guests will manage.

import { parseArgs } from 'node:util';
import { TUNING } from '../src/data/tuning';
import { Sea } from '../src/net/sea';
import { POWERS } from '../src/sim/types';
import { steer, taps, type Style } from './brain';

const { values: o } = parseArgs({
  options: {
    seas: { type: 'string', default: '30' },
    try: { type: 'string', multiple: true, default: [] },
  },
});
const SEAS = Math.max(1, Number(o.seas) || 30);
const STEP = 1 / 30, LIMIT = 30 * 60;

type Tuning = typeof TUNING;
const AS_IS: Tuning = { ...TUNING };
const rows: [string, Partial<Tuning>][] = [['as it stands', {}]];
for (const t of o.try) {
  const set: Partial<Tuning> = {};
  for (const kv of t.split(',')) {
    const [k, v] = kv.split('=').map((s) => s.trim());
    if (!(k in AS_IS) || !Number.isFinite(Number(v))) throw new Error(`--try ${t}: "${kv}" is not a setting in src/data/tuning.ts and a number`);
    (set as Record<string, number>)[k] = Number(v);
  }
  rows.push([t, set]);
}

/** One sea: a captain sails until five in a row, or LIMIT runs out. */
function sail(seed: string, style: Style) {
  const sea = new Sea('ODDS', { seed });
  sea.join({ seat: 'me', name: 'Tester', look: 'jackdaw', ticket: true });
  sea.step(STEP);
  const id = sea.roster().seats.find((s) => s.seat === 'me')!.id;
  let n = 0, a = 0, t = 0, lastTap = -1e9, sunk = 0, wasOut = false, lifeFrom = 0;
  const u = POWERS.map(() => 0);
  while (t < LIMIT) {
    const w = sea.world, me = w.ships[id];
    if (!me.out) {
      if (taps(w, me, t - lastTap, style)) { a++; lastTap = t; }
      const { move: m, power } = steer(w, me, STEP, style);
      if (power != null) u[power]++;
      sea.helm('me', { t: 'in', n: ++n, m: m ? [m.x, m.y] : null, f: 0, fa: 0, a, u: [...u] });
    }
    sea.step(STEP);
    t += STEP;
    if (me.out && !wasOut) sunk++;
    if (!me.out && wasOut) lifeFrom = t;
    wasOut = me.out;
    if (sea.takeWins().length) return { t, life: t - lifeFrom, sunk };
  }
  return { t: Infinity, life: Infinity, sunk };
}

const at = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]; };
const mins = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `>${LIMIT / 60}:00`);
const share = (n: number) => `${Math.round((100 * n) / SEAS)}%`;

const head = ['settings', 'captain', 'to win, typical', 'slow (1 in 4)', 'within 5 min', 'within 15 min', 'never sunk', 'winning run'];
const table: string[][] = [];
for (const [name, set] of rows) {
  Object.assign(TUNING, AS_IS, set);
  for (const style of ['good', 'casual'] as Style[]) {
    const rs = Array.from({ length: SEAS }, (_, i) => sail(`odds${i}`, style));
    const ts = rs.map((r) => r.t), won = rs.filter((r) => Number.isFinite(r.t));
    table.push([
      style === 'good' ? name : '', style, mins(at(ts, 0.5)), mins(at(ts, 0.75)),
      share(ts.filter((t) => t <= 300).length), share(ts.filter((t) => t <= 900).length),
      share(won.filter((r) => r.sunk === 0).length), won.length ? mins(at(won.map((r) => r.life), 0.5)) : '-',
    ]);
  }
}
Object.assign(TUNING, AS_IS);

const width = head.map((h, c) => Math.max(h.length, ...table.map((r) => r[c].length)));
const line = (r: string[]) => r.map((x, c) => (c < 2 ? x.padEnd(width[c]) : x.padStart(width[c]))).join('  ');
console.log(`${SEAS} seas a row, one scripted captain against the bots (botSkill ${AS_IS.botSkill}, hull ${AS_IS.hull} as it stands)\n`);
console.log(line(head));
for (const r of table) console.log(line(r));
console.log(`\n"winning run": how long the life that won lasted. "never sunk": won without being sunk once.`);
