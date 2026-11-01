// The phone's line to the bar's sea: hail it, come aboard, send the hands, and keep a
// Mirror of the world for the view to draw. main.ts owns one while the sea is on screen.

import type { Input } from '../sim/types';
import { Mirror, WIRE, type FromSea, type Helm, type Nope, type Roster, type Welcome } from './protocol';

/** Where the seas are. Set VITE_SEA_URL for a deployed server; in development it is
 *  `npm run sea:dev` on the machine serving the page, so a phone on the same wifi works. */
export const SEA_URL: string = import.meta.env.VITE_SEA_URL
  || (import.meta.env.DEV && typeof location !== 'undefined' ? `ws://${location.hostname}:8787` : '');

export type LinkState = 'hailing' | 'aboard' | 'refused' | 'lost';

const BARS = 9;               // the bar's seas, tried in turn while each is full
const KEEPALIVE = 0.25;       // the hands are sent at least this often, changed or not
const HELM_EVERY = 0.05;      // a moving stick goes up at most this often; a press on the guns, at once
const RETRIES = 6;            // a dropped line is tried again this many times, backing off

export class Link {
  state: LinkState = 'hailing';
  /** Why the sea turned this phone away. 'server' is a line that kept dropping; 'reach', a
   *  phone that never got through to the sea at all (a wifi that blocks it, a filter). */
  why: Nope['why'] | 'server' | 'reach' | null = null;
  readonly mirror = new Mirror();
  welcome: Welcome | null = null;
  roster: Roster | null = null;
  private ws: WebSocket | null = null;
  private bar = 1;
  private tries = 0;
  private closed = false;
  private opened = false;
  private presses = { f: 0, fa: 0, a: 0 };
  private sent = '';
  private sentAt = 0;
  private sentPresses = { f: 0, a: 0 };
  private token = '';
  /** The Supabase user this phone is signed in as: the seat it sails in. */
  seat = '';

  /** Hail the sea as soon as the sign-in comes back; `creds` null is a phone the server
   *  could not sign in, turned away at the gangway. */
  constructor(creds: Promise<{ token: string; seat: string } | null>, private name: string, private look: string, private changed: () => void) {
    creds.then((c) => {
      if (this.closed) return;
      if (!c || !SEA_URL) { this.state = 'refused'; this.why = c ? 'server' : 'token'; this.changed(); return; }
      this.token = c.token; this.seat = c.seat;
      this.hail();
    }, () => { this.state = 'refused'; this.why = 'token'; this.changed(); });
  }

  private hail() {
    if (this.closed) return;
    const ws = new WebSocket(`${SEA_URL}/sea/bar/${this.bar}`);
    this.ws = ws;
    ws.onopen = () => {
      this.opened = true;
      ws.send(JSON.stringify({ t: 'hello', v: WIRE, token: this.token, name: this.name, look: this.look }));
    };
    ws.onmessage = (e) => this.hear(JSON.parse(String(e.data)) as FromSea);
    ws.onclose = () => {
      if (this.ws !== ws || this.closed || this.state === 'refused') return;
      // wifi comes and goes; the sea keeps the ship for a while, so come back for her
      this.state = this.state === 'aboard' ? 'lost' : this.state;
      this.changed();
      if (++this.tries > RETRIES) { this.state = 'refused'; this.why = this.opened ? 'server' : 'reach'; this.changed(); return; }
      setTimeout(() => this.hail(), Math.min(8000, 500 * 2 ** this.tries));
    };
  }

  private hear(m: FromSea) {
    const now = performance.now() / 1000;
    switch (m.t) {
      case 'welcome':
        this.welcome = m; this.state = 'aboard'; this.tries = 0;
        this.changed();
        break;
      case 'nope':
        if (m.why === 'full' && this.bar < BARS) { this.bar++; this.ws?.close(); this.hail(); return; }
        this.state = 'refused'; this.why = m.why; this.closed = true; this.changed();
        break;
      case 'roster': this.roster = m; this.mirror.roster(m, this.seat); this.changed(); break;
      case 's': this.mirror.push(m, now); break;
    }
  }

  /** Each frame: slide the mirror to where the sea was a moment ago. */
  frame(now: number) { this.mirror.frame(now); }

  /** The hands, as the phone reads them this frame. Presses are counted, so none is lost. */
  helm(i: Input, now = performance.now() / 1000) {
    if (i.fire != null) { this.presses.f++; this.presses.fa = Math.round(i.fire * 1000) / 1000; }
    else if (i.auto) this.presses.a++;
    const m: Helm = {
      t: 'in',
      m: i.move ? [Math.round(i.move.x * 100) / 100, Math.round(i.move.y * 100) / 100] : null,
      ...this.presses,
    };
    this.send(m, now);
  }

  private send(m: Helm, now: number) {
    const s = JSON.stringify(m);
    // A thumb on the stick changes the hands every frame, and the sea only reads them
    // thirty times a second. On bar wifi every message from every phone is airtime the
    // snapshots coming the other way wait behind, so a moving stick goes up twenty times
    // a second. A press on the guns never waits.
    const p = this.sentPresses;
    const pressed = m.f !== p.f || m.a !== p.a;
    if (!pressed && now - this.sentAt < (s === this.sent ? KEEPALIVE : HELM_EVERY)) return;
    if (this.ws?.readyState !== WebSocket.OPEN || this.state !== 'aboard') return;
    this.ws.send(s);
    this.sent = s; this.sentAt = now; this.sentPresses = { f: m.f, a: m.a };
  }

  /** Try again, from the start, after the line gave up: a guest's wifi may have come back. */
  again() {
    if (this.state !== 'refused' || (this.why !== 'server' && this.why !== 'reach') || !this.token) return;
    this.state = 'hailing'; this.why = null; this.tries = 0;
    this.changed();
    this.hail();
  }

  /** Go ashore: the Leave button. The sea docks her at once out of a fight, or leaves her
   *  on the water a while in one. */
  close() {
    this.closed = true;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' }));
      this.ws?.close(1000, 'ashore');
    } catch { /* already gone */ }
  }

  /** A ship's name, from the roster. */
  nameOf(id: number): string {
    return this.mirror.seats.find((s) => s.id === id)?.name || `Ship ${id + 1}`;
  }
}
