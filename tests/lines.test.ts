// Not a test: `npm run lines` prints how each line plays (tests/slowline.ts), a few
// nights each, to compare a change by. ON_LINES=weak4g,bad3g picks lines; TWEAK='{"loss":0}' changes them;
// ZIP=0 or 1 sends the sea's word plain or deflated only; NIGHTS=5 sails more nights;
// PLAIN_POST=1 sends every snapshot whatever the phone has heard.

import { describe, it } from 'vitest';
import { LINES, night, plainPost, rig, say, type Line, type Report } from './slowline';

rig();
const { Link } = await import('../src/net/link');

const ONLY = process.env.ON_LINES?.split(',') ?? Object.keys(LINES);
const ZIP = process.env.ZIP === '0' ? [false] : process.env.ZIP === '1' ? [true] : [false, true];
const TWEAK: Partial<Line> = JSON.parse(process.env.TWEAK ?? '{}');
const NIGHTS = Number(process.env.NIGHTS ?? 3);

/** The mean of a few nights' reports, field by field. */
function average(rs: Report[]): Report {
  const avg = (f: (r: Report) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  return {
    line: rs[0].line,
    lag: { mean: avg((r) => r.lag.mean), p95: avg((r) => r.lag.p95) },
    hitches: avg((r) => r.hitches), frozen: avg((r) => r.frozen),
    error: { mean: avg((r) => r.error.mean), p99: avg((r) => r.error.p99) },
    corrections: { mean: avg((r) => r.corrections.mean), p99: avg((r) => r.corrections.p99), big: avg((r) => r.corrections.big) },
    kbps: avg((r) => r.kbps),
  };
}

describe.runIf(process.env.MEASURE)('how each line plays', () => it.each(ONLY)('%s', async (k) => {
  for (const zip of ZIP) {
    const rs: Report[] = [];
    for (let i = 0; i < NIGHTS; i++) rs.push(await night(Link, { line: { ...LINES[k], ...TWEAK }, zip, seed: `night${i}`, post: process.env.PLAIN_POST ? plainPost : undefined }));
    process.stdout.write(`${zip ? 'zip  ' : 'plain'} ${say(average(rs))}\n`);
  }
}, 600_000));
