// The bar's screen's line to a sea: the watch key instead of a token, no ship and no helm,
// and a Mirror kept of everything, as a phone keeps one. A TV has nobody to press retry, so
// it hails for ever; and after a deploy, when the sea says this page is out of date, it
// reloads itself.

import { SEA_URL } from './link';
import { Mirror, WIRE, type FromSea, type Nope, type Roster, type Round, type Welcome } from './protocol';

export type WatchState = 'hailing' | 'watching' | 'refused' | 'lost';

const PATIENCE = 10;          // seconds between tries, at the most
const PEEK = 5;               // seconds a look at another sea waits for its answer
const RELOADED = 'blackflag.watch.reloaded';
const RELOAD_EVERY = 10 * 60; // seconds: a page newer than the sea must not reload for ever

export class Watch {
  state: WatchState = 'hailing';
  why: Nope['why'] | null = null;
  readonly mirror = new Mirror();
  welcome: Welcome | null = null;
  round: Round | null = null;
  roster: Roster | null = null;
  /** Nobody is aboard: the sea is waiting for its first captain. */
  quiet = true;
  private ws: WebSocket | null = null;
  private tries = 0;
  private closed = false;

  /** Look on at the bar's `bar`-th sea. */
  constructor(private key: string, readonly bar: number, private changed: () => void) {
    if (!SEA_URL) { this.state = 'refused'; this.why = 'bad'; queueMicrotask(changed); return; }
    this.hail();
  }

  private hail() {
    if (this.closed) return;
    const ws = new WebSocket(`${SEA_URL}/sea/bar/${this.bar}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', v: WIRE, key: this.key }));
    ws.onmessage = (e) => this.hear(JSON.parse(String(e.data)) as FromSea);
    ws.onclose = () => {
      if (this.ws !== ws || this.closed || this.state === 'refused') return;
      this.state = this.state === 'watching' ? 'lost' : this.state;
      this.changed();
      setTimeout(() => this.hail(), Math.min(PATIENCE, 0.5 * 2 ** this.tries++) * 1000);
    };
  }

  private hear(m: FromSea) {
    switch (m.t) {
      case 'welcome': this.welcome = m; this.state = 'watching'; this.tries = 0; this.changed(); break;
      case 'nope':
        if (m.why === 'version') { this.outdated(); return; }
        this.state = 'refused'; this.why = m.why; this.closed = true; this.changed();
        break;
      case 'roster': this.roster = m; this.quiet = false; this.mirror.roster(m, ''); this.changed(); break;
      case 'round': this.round = m; this.quiet = !m.scores.length; this.changed(); break;
      case 's': this.mirror.push(m, performance.now() / 1000); break;
    }
  }

  /** The sea and this page speak different wires. After a deploy it is the page that is
   *  behind, and a reload brings it up; if the sea is the one behind, reloading would
   *  only loop, so it reloads at most once in a while and otherwise waits for the sea. */
  private outdated() {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOADED)) || 0; } catch { /* no storage: reload */ }
    if (Date.now() - last > RELOAD_EVERY * 1000) {
      try { sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* no storage */ }
      location.reload();
      return;
    }
    this.tries = Math.max(this.tries, 8);       // the onclose that follows waits its longest
  }

  /** Each frame: slide the mirror to where the sea was a moment ago. */
  frame(now: number) { this.mirror.frame(now); }

  /** Captains aboard, by the last round. */
  get aboard() { return this.round?.scores.length ?? 0; }
  /** Every seat taken: a captain coming aboard now is sent to the next sea. */
  get full() { return !!this.welcome && this.aboard >= this.welcome.cap; }

  /** The name a captain sails under, by her place in the world. */
  captain(id: number): string {
    return this.roster?.seats.find((s) => s.id === id && !s.left)?.captain ?? `Captain ${id + 1}`;
  }

  /** Her mark on this screen (data/colors.ts), by her place in the world. */
  mark(id: number): number {
    return this.roster?.seats.find((s) => s.id === id && !s.left)?.c ?? 0;
  }

  close() {
    this.closed = true;
    try { this.ws?.close(1000, 'off'); } catch { /* already gone */ }
  }
}

/** How many captains are aboard the bar's `bar`-th sea: a look that reads the round and
 *  goes. -1 if it could not be told. */
export function peek(key: string, bar: number): Promise<number> {
  return new Promise((done) => {
    if (!SEA_URL) { done(-1); return; }
    const ws = new WebSocket(`${SEA_URL}/sea/bar/${bar}`);
    const end = (n: number) => { clearTimeout(timer); ws.onclose = null; try { ws.close(1000, 'seen'); } catch { /* gone */ } done(n); };
    const timer = setTimeout(() => end(-1), PEEK * 1000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', v: WIRE, key }));
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as FromSea;
      if (m.t === 'round') end(m.scores.length);
      else if (m.t === 'nope') end(-1);
    };
    ws.onclose = () => end(-1);
  });
}
