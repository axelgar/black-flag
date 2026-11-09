// A night on a slow line, with no sockets: the sea, a room that sends it as the server
// does, and a phone (the real Link, Mirror and Lead) with a line between them that has a
// speed, a delay that wanders, segments lost and sent again, and now and then no signal at
// all. Each way keeps its order, as TCP does, so one lost segment holds up all behind it.
//
// What comes back is what a guest would see: how far behind the sea the other ships are
// drawn, how often one of them hitches (stops dead, or jumps), how often her own ship
// does, and what the line carried.

import { deflateRawSync } from 'node:zlib';
import { vi } from 'vitest';
import { rng } from '../src/core/rng';
import type { Link as LinkClass } from '../src/net/link';
import { Post as SeaPost } from '../src/net/post';
import { WIRE, type FromSea, type ToSea } from '../src/net/protocol';
import { Sea } from '../src/net/sea';
import type { Input } from '../src/sim/types';

export interface Line {
  name: string;
  /** One way, before any queue, ms. */
  ms: number;
  /** How far that wanders either way, ms. */
  jitter: number;
  /** Sea to phone, and phone to sea, kbit/s. */
  down: number;
  up: number;
  /** The share of segments lost, each held up by `rto` ms before it is sent again. */
  loss: number;
  rto: number;
  /** No signal at all for `for` seconds, once every `every`. */
  fade?: { every: number; for: number };
}

/** Lines a phone at the bar might be on. */
export const LINES: Record<string, Line> = {
  perfect: { name: 'perfect', ms: 0, jitter: 0, down: 1e6, up: 1e6, loss: 0, rto: 200 },
  wifi: { name: 'bar wifi', ms: 40, jitter: 20, down: 5000, up: 2000, loss: 0, rto: 200 },
  weak4g: { name: 'weak 4G', ms: 70, jitter: 50, down: 800, up: 250, loss: 0.01, rto: 300 },
  bad3g: { name: 'bad 3G', ms: 120, jitter: 80, down: 250, up: 80, loss: 0.02, rto: 450, fade: { every: 20, for: 1 } },
  edge: { name: '2G (EDGE)', ms: 220, jitter: 120, down: 120, up: 50, loss: 0.02, rto: 700, fade: { every: 25, for: 1.5 } },
};

/** What a WebSocket frame and TCP/IP add to a message, bytes. */
const FRAME_BYTES = 6, SEGMENT = 1400, HEADERS = 52;

/** One way of a line: a queue at its slowest point, then the delay. */
class Pipe {
  readonly q: { at: number; data: string }[] = [];
  bytes = 0;
  private free = 0;       // when the slowest point is next free
  private landed = 0;     // when the last message landed: none lands before it
  private dict = Buffer.alloc(0);

  constructor(private kbps: number, private line: Line, private r: () => number, private zip: boolean) {}

  send(t: number, data: string) {
    let n = Buffer.byteLength(data);
    if (this.zip) {
      // permessage-deflate keeping its context: the last 32KB sent are its dictionary
      const raw = Buffer.from(data);
      n = deflateRawSync(raw, { dictionary: this.dict }).length;
      this.dict = Buffer.concat([this.dict, raw]).subarray(-32768);
    }
    const segs = Math.ceil((n + FRAME_BYTES) / SEGMENT);
    const wire = n + FRAME_BYTES + segs * HEADERS;
    this.bytes += wire;
    this.free = Math.max(this.free, t) + (wire * 8) / (this.kbps * 1000);
    let at = this.free + Math.max(0, this.line.ms + (this.r() * 2 - 1) * this.line.jitter) / 1000;
    for (let i = 0; i < segs; i++) if (this.r() < this.line.loss) at += this.line.rto / 1000;
    const f = this.line.fade;
    if (f) {
      const start = Math.floor(at / f.every) * f.every + f.every / 2;
      if (at >= start && at < start + f.for) at = start + f.for + this.line.ms / 1000;
    }
    this.landed = at = Math.max(at, this.landed);
    this.q.push({ at, data });
  }

  /** Bytes not yet onto the line at `t`, as a socket's bufferedAmount says. */
  waiting(t: number) { return Math.max(0, ((this.free - t) * this.kbps * 1000) / 8); }

  next() { return this.q.length ? this.q[0].at : Infinity; }
}

/** The WebSocket the Link opens, wired to the night's line. */
class Sock {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static made: ((s: Sock) => void) | null = null;
  readyState = Sock.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  up: ((s: string) => void) | null = null;
  waiting: () => number = () => 0;
  constructor(readonly url: string) { Sock.made?.(this); }
  get bufferedAmount() { return this.waiting(); }
  send(s: string) { this.up?.(s); }
  close() { this.readyState = Sock.CLOSED; }
}

let clock = 0;

/** Call once, before the Link is imported. */
export function rig() {
  vi.stubEnv('VITE_SEA_URL', 'ws://sea.test');
  vi.stubGlobal('WebSocket', Sock);
  vi.stubGlobal('performance', { now: () => clock * 1000 });
}

export interface Night {
  line: Line;
  seconds?: number;
  seed?: string;
  /** The room's way of sending to this phone: as the server does, unless said. */
  post?: (sea: Sea, send: (s: string) => void, waiting: () => number) => Post;
  /** Deflated, as the server sends, unless false. */
  zip?: boolean;
}

/** The room's sending to one phone: told of everything the sea says, sends what it will. */
export interface Post { out(m: FromSea, me: number[] | null): void; heard?(m: ToSea): void }

/** Everything, as it comes, as the server once sent it. */
export const plainPost = (_sea: Sea, send: (s: string) => void): Post => ({
  out(m, me) {
    const s = JSON.stringify(m);
    send(m.t === 's' ? `${s.slice(0, -1)},"me":${JSON.stringify(me)}}` : s);
  },
});

/** As the server sends: a phone whose line has fallen behind is held back (net/post.ts). */
export const seaPost = (_sea: Sea, send: (s: string) => void): Post => {
  const p = new SeaPost(send);
  return {
    out(m, me) {
      const s = JSON.stringify(m);
      if (m.t === 's') p.snap(m, me, s.slice(0, -1)); else send(s);
    },
    heard(m) { if (m.t === 'in') p.hear(m.k); },
  };
};

export interface Report {
  line: string;
  /** How far behind the sea the other ships are drawn, seconds. */
  lag: { mean: number; p95: number };
  /** Hitches a minute on each other ship: a frame where she stops dead or jumps. */
  hitches: number;
  /** Of the frames another ship is under way, the share she is drawn standing still. */
  frozen: number;
  /** How far another ship is drawn from where the sea had her at the moment drawn, metres. */
  error: { mean: number; p99: number };
  /** Her own ship put right, metres, and how often a minute by more than a metre. */
  corrections: { mean: number; p99: number; big: number };
  /** Sea to phone, kbit/s. */
  kbps: number;
}

const FRAME = 1 / 60, BEAT = 1 / 30;
/** A change of velocity in one frame no ship can make, m/s. */
const HITCH = 8;
/** Seconds aboard before she is judged. */
const SETTLED = 5;

export async function night(Link: typeof LinkClass, o: Night): Promise<Report> {
  const seconds = o.seconds ?? 60, seed = o.seed ?? 'slow';
  const r = rng(`${seed}:line`);
  const sea = new Sea('BAR1', { seed });
  // three more captains on good wifi, sailing circles: the phone sees them as it sees bots
  for (let i = 0; i < 3; i++) sea.join({ seat: `o${i}`, name: `Other ${i}`, look: 'jackdaw' });
  const zip = o.zip ?? true;
  const down = new Pipe(o.line.down, o.line, r, zip), up = new Pipe(o.line.up, o.line, r, zip);
  const post = (o.post ?? seaPost)(sea, (s) => down.send(clock, s), () => down.waiting(clock));
  let sock = null as Sock | null;
  let aboard = false;
  Sock.made = (s) => {
    sock = s;
    s.up = (m) => up.send(clock, m);
    s.waiting = () => up.waiting(clock);
    s.readyState = Sock.OPEN;
    queueMicrotask(() => s.onopen?.());
  };
  clock = 0;
  const L = new Link(Promise.resolve({ token: 't', seat: 'me' }), 'Me', 'jackdaw', () => {});
  for (let i = 0; i < 5; i++) await Promise.resolve();

  // her thumb: hard over one way and the other, swinging round, and a tap on the guns
  const steer = (t: number): Input => {
    const a = Math.floor(t * 1.5) % 2 ? 0.9 : -0.9, turn = t * 0.3;
    return { move: { x: Math.cos(turn + a), y: Math.sin(turn + a) }, fire: null, auto: Math.floor(t * 60) % 90 === 0 };
  };
  let nextFrame = 0, nextBeat = 0, beats = 0;
  const lag: number[] = [], errors: number[] = [];
  const was = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  let hitches = 0, shipFrames = 0, moving = 0, frozen = 0, corr0 = 0;
  // where every ship really was, beat by beat, to judge the picture by
  const truth: { t: number; at: Map<number, [number, number]> }[] = [];
  const truly = (id: number, t: number): [number, number] | null => {
    let i = truth.length - 1;
    while (i > 0 && truth[i - 1].t >= t) i--;
    if (i < 1) return null;
    const a = truth[i - 1], b = truth[i], p = a.at.get(id), q = b.at.get(id);
    if (!p || !q || t < a.t || t > b.t) return null;
    const k = (t - a.t) / (b.t - a.t || 1);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };

  while (clock < seconds) {
    const t = Math.min(nextFrame, nextBeat, down.next(), up.next());
    clock = t;
    if (t === up.next()) {
      const m = JSON.parse(up.q.shift()!.data) as ToSea;
      post.heard?.(m);
      if (m.t === 'hello') {
        sea.join({ seat: 'me', name: m.name, look: m.look });
        aboard = true;
        post.out({ t: 'welcome', v: WIRE, code: sea.code, cap: sea.cap }, null);
        post.out(sea.roster(), null);
      } else if (m.t === 'in') sea.helm('me', m);
    } else if (t === down.next()) {
      sock?.onmessage?.({ data: down.q.shift()!.data });
    } else if (t === nextBeat) {
      nextBeat += BEAT; beats++;
      for (let i = 0; i < 3; i++) sea.helm(`o${i}`, { t: 'in', n: beats, m: [Math.cos(t * 0.4 + i * 2), Math.sin(t * 0.4 + i * 2)], f: 0, fa: 0, a: 0 });
      for (const m of sea.step(BEAT)) if (aboard) post.out(m, m.t === 's' ? sea.own('me') : null);
      truth.push({ t: sea.world.t, at: new Map(sea.world.ships.filter((s) => !s.out && s.down <= 0).map((s) => [s.id, [s.x, s.y]])) });
      if (truth.length > 400) truth.shift();
    } else {
      nextFrame += FRAME;
      const w0 = L.mirror.world, me0 = w0?.ships[w0.focus];
      if (w0) L.helm(me0 && !me0.out ? steer(t) : { move: null, fire: null, auto: false }, t);
      L.frame(t);
      const w = L.mirror.world;
      if (!w) continue;
      w.events.length = 0;
      if (t < SETTLED) { corr0 = L.lead.corrections.length; continue; }
      lag.push(sea.world.t - w.t);
      for (const s of w.ships) {
        if (s.out || s.id === w.focus) { was.delete(s.id); continue; }
        const p = was.get(s.id);
        const vx = p ? (s.x - p.x) / FRAME : 0, vy = p ? (s.y - p.y) / FRAME : 0;
        was.set(s.id, { x: s.x, y: s.y, vx, vy });
        if (!p) continue;
        shipFrames++;
        if (Math.hypot(vx - p.vx, vy - p.vy) > HITCH) hitches++;
        const real = truly(s.id, w.t);
        if (real) { const e = Math.hypot(s.x - real[0], s.y - real[1]); if (e < 30) errors.push(e); }
        if (s.v > 4) { moving++; if (Math.hypot(vx, vy) < 0.5) frozen++; }
      }
    }
  }
  L.close();
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const ls = sorted(lag), cs = sorted(L.lead.corrections.slice(corr0)), es = sorted(errors);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const at = (xs: number[], q: number) => xs[Math.floor((xs.length - 1) * q)] ?? 0;
  return {
    line: o.line.name,
    lag: { mean: mean(ls), p95: at(ls, 0.95) },
    hitches: (hitches / Math.max(1, shipFrames)) * 3600,
    frozen: frozen / Math.max(1, moving),
    error: { mean: mean(es), p99: at(es, 0.99) },
    corrections: { mean: mean(cs), p99: at(cs, 0.99), big: (cs.filter((c) => c > 1).length / (seconds - SETTLED)) * 60 },
    kbps: (down.bytes * 8) / 1000 / seconds,
  };
}

/** A report as one line, for the eye. */
export const say = (r: Report) => [
  r.line.padEnd(10),
  `lag ${r.lag.mean.toFixed(2)}s (p95 ${r.lag.p95.toFixed(2)})`,
  `hitches/min ${r.hitches.toFixed(1).padStart(5)}`,
  `frozen ${(r.frozen * 100).toFixed(1).padStart(4)}%`,
  `off ${r.error.mean.toFixed(2)}m (p99 ${r.error.p99.toFixed(1)})`,
  `own put right ${r.corrections.mean.toFixed(2)}m (p99 ${r.corrections.p99.toFixed(1)}, >1m ${r.corrections.big.toFixed(1).padStart(4)}/min)`,
  `${r.kbps.toFixed(0)} kbit/s`,
].join('  ');
