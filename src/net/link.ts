// The phone's line to a shared sea: hail it, come aboard, send the helm, and keep a
// Mirror of the world for the view to draw. main.ts owns one while a shared sea is on
// screen; the screens read status() to show the round and the scoreboard.

import type { Input } from '../sim/types';
import { Mirror, WIRE, type FromSea, type Helm, type Mode, type Nope, type Roster, type Round, type Welcome } from './protocol';

/** Where the seas are. Set VITE_SEA_URL for a deployed server; in development it is
 *  `npm run sea:dev` on the machine serving the page, so a phone on the same wifi works. */
export const SEA_URL: string = import.meta.env.VITE_SEA_URL
  || (import.meta.env.DEV && typeof location !== 'undefined' ? `ws://${location.hostname}:8787` : '');

/** Which sea: the bar's, a private one to open, or a private one to join by its code. */
export type Berth = { kind: 'bar' } | { kind: 'open'; mode: Mode } | { kind: 'code'; code: string };

export type LinkState = 'hailing' | 'aboard' | 'refused' | 'lost';

const BARS = 9;               // the bar's seas, tried in turn while each is full
const KEEPALIVE = 0.25;       // the helm is sent at least this often, changed or not
const HELM_EVERY = 0.05;      // a moving stick goes up at most this often; a press on the guns, at once
const RETRIES = 6;            // a dropped line is tried again this many times, backing off

/** Four letters nobody will misread off a phone held across a table. */
export function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

export class Link {
  state: LinkState = 'hailing';
  why: Nope['why'] | 'server' | null = null;
  readonly mirror = new Mirror();
  welcome: Welcome | null = null;
  round: Round | null = null;
  roster: Roster | null = null;
  private ws: WebSocket | null = null;
  private bar = 1;
  private tries = 0;
  private closed = false;
  private presses = { fl: 0, fr: 0, mo: 0 };
  private sent = '';
  private sentAt = 0;
  private sentPresses = { fl: 0, fr: 0, mo: 0 };
  private berth: Berth;
  /** A private sea's four letters, to share across the table. Empty for the bar's. */
  readonly code: string;

  private token = '';
  /** The Supabase user this phone is signed in as: the seat it sails in. */
  seat = '';

  /** Hail a sea as soon as the sign-in comes back; `creds` null is a phone the server
   *  could not sign in, turned away at the gangway. */
  constructor(berth: Berth, creds: Promise<{ token: string; seat: string } | null>, private ship: string, private changed: () => void) {
    this.berth = berth.kind === 'open' ? { kind: 'open', mode: berth.mode } : berth;
    this.code = berth.kind === 'open' ? newCode() : berth.kind === 'code' ? berth.code.toUpperCase() : '';
    creds.then((c) => {
      if (this.closed) return;
      if (!c || !SEA_URL) { this.state = 'refused'; this.why = c ? 'server' : 'token'; this.changed(); return; }
      this.token = c.token; this.seat = c.seat;
      this.hail();
    }, () => { this.state = 'refused'; this.why = 'token'; this.changed(); });
  }

  private url() {
    return this.berth.kind === 'bar' ? `${SEA_URL}/sea/bar/${this.bar}` : `${SEA_URL}/sea/code/${this.code}`;
  }

  private hail() {
    if (this.closed) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: WIRE, token: this.token, ship: this.ship, open: this.berth.kind === 'open' ? this.berth.mode : undefined }));
    };
    ws.onmessage = (e) => this.hear(JSON.parse(String(e.data)) as FromSea);
    ws.onclose = () => {
      if (this.ws !== ws || this.closed || this.state === 'refused') return;
      // wifi comes and goes; the sea keeps the seat for a while, so come back for it
      this.state = this.state === 'aboard' ? 'lost' : this.state;
      this.changed();
      if (++this.tries > RETRIES) { this.state = 'refused'; this.why = 'server'; this.changed(); return; }
      setTimeout(() => this.hail(), Math.min(8000, 500 * 2 ** this.tries));
    };
  }

  private hear(m: FromSea) {
    const now = performance.now() / 1000;
    switch (m.t) {
      case 'welcome':
        this.welcome = m; this.state = 'aboard'; this.tries = 0;
        // a private sea we opened is joined by its code from now on, if the line drops
        if (this.berth.kind === 'open') this.berth = { kind: 'code', code: this.code };
        this.changed();
        break;
      case 'nope':
        if (m.why === 'full' && this.berth.kind === 'bar' && this.bar < BARS) { this.bar++; this.ws?.close(); this.hail(); return; }
        this.state = 'refused'; this.why = m.why; this.closed = true; this.changed();
        break;
      case 'roster': this.roster = m; this.mirror.roster(m, this.seat); this.changed(); break;
      case 'round': this.round = m; this.changed(); break;
      case 's': this.mirror.push(m, now); break;
    }
  }

  /** Each frame: slide the mirror to where the sea was a moment ago. */
  frame(now: number) { this.mirror.frame(now); }

  /** The helm, as the phone reads it this frame. Presses are counted, so none is lost. */
  helm(i: Input, now = performance.now() / 1000) {
    if (i.fireL) this.presses.fl++;
    if (i.fireR) this.presses.fr++;
    if (i.mortar) this.presses.mo++;
    this.send({ t: 'in', h: i.heading == null ? null : Math.round(i.heading * 1000) / 1000, r: Math.round(i.rudder * 100) / 100, s: Math.round(i.sail * 100) / 100, ...this.presses }, now);
  }

  /** Hands off the stick (paused, or looking away): she holds her course and her canvas. */
  hold(sail: number, now = performance.now() / 1000) {
    this.send({ t: 'in', h: null, r: 0, s: Math.round(sail * 100) / 100, ...this.presses }, now);
  }

  private send(m: Helm, now: number) {
    const s = JSON.stringify(m);
    // A thumb on the stick changes the helm every frame, sixty or a hundred and twenty
    // times a second, and the sea only reads it thirty. On bar wifi every message from
    // every phone is airtime the snapshots coming the other way wait behind, so a moving
    // stick goes up twenty times a second. A press on the guns never waits.
    const p = this.sentPresses;
    const pressed = m.fl !== p.fl || m.fr !== p.fr || m.mo !== p.mo;
    if (!pressed && now - this.sentAt < (s === this.sent ? KEEPALIVE : HELM_EVERY)) return;
    if (this.ws?.readyState !== WebSocket.OPEN || this.state !== 'aboard') return;
    this.ws.send(s);
    this.sent = s; this.sentAt = now; this.sentPresses = { fl: m.fl, fr: m.fr, mo: m.mo };
  }

  /** Go ashore. */
  close() {
    this.closed = true;
    try { this.ws?.close(1000, 'ashore'); } catch { /* already gone */ }
  }

  /** The name a captain in this sea sails under. */
  captain(id: number): string {
    return this.round?.scores.find((s) => s.id === id)?.captain ?? `Captain ${id + 1}`;
  }
}
