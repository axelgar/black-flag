// What a shared sea costs, with no server and no phones: bot captains sail the real room
// (src/net/sea.ts) for a few minutes of sea time, and this prints what the Durable Object
// spends on each heartbeat and what each phone is sent, raw and as the wire compresses it.
//
//   npm run sea:bench -- [captains…] [--secs 240] [--mode rivals|crew] [--calm]
//
// Captains default to 8 and 30. They fire every gun the moment it is loaded, as a guest
// with two thumbs does; --calm leaves the firing to the test bot's own judgement.
//
// The sea's sockets negotiate permessage-deflate, which compresses each message against
// the last 32 KB that phone was sent, so "zipped" is what goes over the air.

import { performance } from 'node:perf_hooks';
import { deflateRawSync } from 'node:zlib';
import { Mirror, type Snap } from '../src/net/protocol';
import { LOBBY, Sea } from '../src/net/sea';
import { bot } from '../tests/bot';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SECS = Number(flag('secs', '240'));
const MODE = flag('mode', 'rivals') === 'crew' ? 'crew' : 'rivals';
const CALM = args.includes('--calm');
const sizes = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith('--')).map(Number);
const SHIPS = ['jackdaw', 'kestrel', 'revenant', 'maree'];
const BEAT = 1 / 30;
const WATCH = 3;          // phones whose compressed stream is measured: compressing every one is slow

/** One phone's end of permessage-deflate with context takeover: each message is
 *  compressed against the last 32 KB that phone was sent. */
class Wire {
  private seen = Buffer.alloc(0);
  raw = 0; zipped = 0; msgs = 0;
  send(msg: string) {
    const b = Buffer.from(msg);
    this.zipped += deflateRawSync(b, this.seen.length ? { dictionary: this.seen } : {}).length;
    this.raw += b.length; this.msgs++;
    this.seen = Buffer.concat([this.seen, b]).subarray(-32768);
  }
}

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const len = (v: unknown) => JSON.stringify(v ?? null).length;

function run(n: number) {
  const sea = new Sea('BENCH', MODE, { cap: Math.max(8, n), seed: () => 'bench', round: SECS + 60 });
  const seats = Array.from({ length: n }, (_, i) => ({ seat: `s${i}`, captain: `Bot ${i}`, ship: SHIPS[i % SHIPS.length] }));
  for (const s of seats) sea.join(s);
  for (let t = 0; t <= LOBBY + 0.5; t += BEAT) sea.step(BEAT);

  const presses = seats.map(() => ({ fl: 0, fr: 0, mo: 0 }));
  const wires = seats.slice(0, WATCH).map(() => new Wire());
  const beat: number[] = [], snapRaw: number[] = [], phone: number[] = [], balls: number[] = [], events: number[] = [];
  const part = { captains: 0, own: 0, spaniards: 0, balls: 0, events: 0, all: 0 };
  const mirror = new Mirror();
  let tick = 0;
  for (let b = 0; b < SECS / BEAT; b++) {
    const w = sea.world!;
    for (let i = 0; i < n; i++) {
      const p = w.players[i];
      if (!p || p.out) continue;
      const input = bot(w, tick, { mortar: true }, p);
      if (!CALM) { if (p.cool[0] <= 0) input.fireL = true; if (p.cool[1] <= 0) input.fireR = true; }
      const pr = presses[i];
      if (input.fireL) pr.fl++;
      if (input.fireR) pr.fr++;
      if (input.mortar) pr.mo++;
      sea.helm(seats[i].seat, { t: 'in', h: input.heading, r: input.rudder, s: input.sail, ...pr });
    }
    tick += 4;

    // the Durable Object's heartbeat, as server/src/index.ts beats it
    const t0 = performance.now();
    const out = sea.step(BEAT);
    const letters: string[][] = seats.map(() => []);
    for (const m of out) {
      const s = JSON.stringify(m);
      if (m.t !== 's') { for (const l of letters) l.push(s); continue; }
      const head = s.slice(0, -1);
      seats.forEach((st, i) => letters[i].push(`${head},"me":${JSON.stringify(sea.own(st.seat))}}`));
    }
    beat.push(performance.now() - t0);

    letters.forEach((l, i) => { if (i < WATCH) for (const s of l) wires[i].send(s); });
    for (const s of letters[0] ?? []) {
      const m = JSON.parse(s);
      if (m.t === 'roster') mirror.roster(m, seats[0].seat);
      if (m.t !== 's') continue;
      const snap = m as Snap;
      snapRaw.push(s.length); balls.push(sea.world!.shots.length); events.push(snap.e.length);
      part.all += s.length; part.captains += len(snap.p); part.own += len(snap.me); part.spaniards += len(snap.f);
      part.balls += len(snap.s) + len(snap.sx); part.events += len(snap.e);
      // the phone's side of it: read the message, and the mirror's work for a frame
      const p0 = performance.now();
      mirror.push(JSON.parse(s) as Snap, snap.ck);
      mirror.frame(snap.ck + mirror.delay);
      if (mirror.world) mirror.world.events.length = 0;
      phone.push(performance.now() - p0);
    }
  }

  const perPhone = (k: 'raw' | 'zipped') => avg(wires.map((x) => x[k])) / SECS;
  const share = (k: keyof typeof part) => `${Math.round((100 * part[k]) / part.all)}%`;
  return {
    captains: n,
    'beat ms p50/p99': `${pct(beat, 0.5).toFixed(2)} / ${pct(beat, 0.99).toFixed(2)}`,
    'DO cpu': `${((100 * avg(beat)) / (BEAT * 1000)).toFixed(1)}%`,
    'snap KB avg/p99': `${(avg(snapRaw) / 1024).toFixed(1)} / ${(pct(snapRaw, 0.99) / 1024).toFixed(1)}`,
    'phone KB/s raw': +(perPhone('raw') / 1024).toFixed(1),
    'phone KB/s zipped': +(perPhone('zipped') / 1024).toFixed(1),
    'sea Mbit/s zipped': +((perPhone('zipped') * n * 8) / 1e6).toFixed(2),
    'captains/own/spaniards/balls/events': ['captains', 'own', 'spaniards', 'balls', 'events'].map((k) => share(k as keyof typeof part)).join(' '),
    'balls in air avg/max': `${Math.round(avg(balls))} / ${Math.max(...balls)}`,
    'events/snap avg/max': `${Math.round(avg(events))} / ${Math.max(...events)}`,
    'phone ms/snap': +avg(phone).toFixed(3),
  };
}

const rows = (sizes.length ? sizes : [8, 30]).map(run);
for (const r of rows) {
  console.log(`\n${r.captains} captains, ${SECS}s of ${MODE}${CALM ? ', calm' : ''}`);
  for (const [k, v] of Object.entries(r)) if (k !== 'captains') console.log(`  ${k.padEnd(38)} ${v}`);
}
