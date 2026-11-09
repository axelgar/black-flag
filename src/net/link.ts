// The phone's line to the bar's sea: hail it, come aboard, send the hands, and keep a
// Mirror of the world for the view to draw, with your own ship stepped ahead of it by
// the phone itself (net/lead.ts). main.ts owns one while the sea is on screen.

import { TUNING as T } from '../data/tuning';
import { autoBearing, sideFacing } from '../sim/combat';
import { POWERS, type GameEvent, type Input } from '../sim/types';
import { FIXED, Lead } from './lead';
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
const ECHO = 1.5;             // seconds a volley shown at once waits for the sea's word of it
const HAIL_FOR = 10;          // seconds to get aboard, sign-in and all, before the guest is told why not
const OPEN_FOR = 5;           // seconds a line may take to open before it is dropped and tried again

export class Link {
  state: LinkState = 'hailing';
  /** Why the sea turned this phone away. 'server' is a line that kept dropping; 'reach', a
   *  phone that never got through to the sea at all (a wifi that blocks it, a filter). */
  why: Nope['why'] | 'server' | 'reach' | null = null;
  readonly mirror = new Mirror();
  /** Your own ship, stepped ahead of the sea. */
  readonly lead = new Lead();
  welcome: Welcome | null = null;
  roster: Roster | null = null;
  private ws: WebSocket | null = null;
  private bar = 1;
  private tries = 0;
  private closed = false;
  private opened = false;
  private presses = { f: 0, fa: 0, a: 0, u: POWERS.map(() => 0) };
  private sent = '';
  private sentAt = 0;
  private changedAt = -1;
  private sentPresses = { f: 0, a: 0, u: '' };
  /** The hands' number, one more each time they change, and the stick as last sent. */
  private n = 0;
  /** How many ticks the phone sailed her by the hands before the newest sent. */
  private d = 0;
  private sentMove: Input['move'] = null;
  private last = -1;
  /** Volleys shown at once that the sea has not yet counted, by the hands they went in. */
  private fired: number[] = [];
  /** When each volley shown at once was shown: the sea's own word of it is then not played again. */
  private shown: number[] = [];
  private lastShot = -1e9;
  private local: GameEvent[] = [];
  private token = '';
  private giveUp: ReturnType<typeof setTimeout> | undefined;
  /** The Supabase user this phone is signed in as: the seat it sails in. */
  seat = '';

  /** Hail the sea as soon as the sign-in comes back; `creds` null is a phone the server
   *  could not sign in, turned away at the gangway. */
  constructor(creds: Promise<{ token: string; seat: string } | null>, private name: string, private look: string, private changed: () => void) {
    this.wait();
    creds.then((c) => {
      if (this.closed || this.state !== 'hailing') return;
      if (!c || !SEA_URL) { this.state = 'refused'; this.why = c ? 'server' : 'token'; this.changed(); return; }
      this.token = c.token; this.seat = c.seat;
      this.hail();
    }, () => { this.state = 'refused'; this.why = 'token'; this.changed(); });
  }

  /** Coming aboard has HAIL_FOR seconds. Past that the guest is told why not, rather than
   *  left looking at "Finding the sea…": a sign-in that never came back, a sea never
   *  reached, or a sea that never answered. */
  private wait() {
    clearTimeout(this.giveUp);
    this.giveUp = setTimeout(() => {
      if (this.closed || this.state !== 'hailing') return;
      this.why = !this.token ? 'token' : this.opened ? 'server' : 'reach';
      this.state = 'refused';
      try { this.ws?.close(); } catch { /* already gone */ }
      this.changed();
    }, HAIL_FOR * 1000);
  }

  private hail() {
    if (this.closed) return;
    const ws = new WebSocket(`${SEA_URL}/sea/bar/${this.bar}`);
    this.ws = ws;
    // a line that hangs opening (a wifi that drops the sea's packets) is let go and tried
    // again, rather than waited on for as long as the browser cares to
    const slow = setTimeout(() => { if (ws.readyState === WebSocket.CONNECTING) ws.close(); }, OPEN_FOR * 1000);
    ws.onopen = () => {
      clearTimeout(slow);
      this.opened = true;
      ws.send(JSON.stringify({ t: 'hello', v: WIRE, token: this.token, name: this.name, look: this.look }));
    };
    ws.onmessage = (e) => this.hear(JSON.parse(String(e.data)) as FromSea);
    ws.onclose = () => {
      clearTimeout(slow);
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
        clearTimeout(this.giveUp);
        this.welcome = m; this.state = 'aboard'; this.tries = 0;
        this.changed();
        break;
      case 'nope':
        if (m.why === 'full' && this.bar < BARS) { this.bar++; this.ws?.close(); this.hail(); return; }
        this.state = 'refused'; this.why = m.why; this.closed = true; this.changed();
        break;
      case 'roster':
        this.roster = m;
        if (this.mirror.world && m.seed !== this.mirror.world.seed) this.lead.reset();
        this.mirror.roster(m, this.seat);
        this.changed();
        break;
      case 's': {
        this.mirror.push(m, now);
        const w = this.mirror.world;
        if (!m.me || !w) break;
        const row = m.p.find((r) => r[0] === w.focus);
        this.lead.hear({ map: w.map, R: m.R, focus: w.focus }, m.me, !row || !!(row[10] & 1), this.singers());
        this.fired = this.fired.filter((n) => n > m.me![6]);
        break;
      }
    }
  }

  /** Each frame: slide the mirror to where the sea was a moment ago, and put your own ship
   *  where the phone has her now. */
  frame(now: number) {
    this.mirror.ahead = this.lead.ship ? this.lead.ahead * FIXED : 0;
    this.mirror.frame(now);
    const w = this.mirror.world;
    if (!w) return;
    this.lead.show(w);
    const me = w.ships[w.focus], own = this.mirror.own;
    if (me && own) me.ammo = Math.max(0, own[0] - this.fired.length);
    // the sea's word of a volley already shown is not played twice
    this.shown = this.shown.filter((t) => now - t < ECHO);
    if (this.shown.length) {
      for (let i = 0; i < w.events.length; i++) {
        const e = w.events[i];
        if (e.k !== 'volley' || e.p !== w.focus || !this.shown.length) continue;
        this.shown.shift();
        w.events.splice(i--, 1);
      }
    }
    if (this.local.length) { w.events.push(...this.local); this.local = []; }
  }

  /** The hands, as the phone reads them this frame. Presses are counted, so none is lost. */
  helm(i: Input, now = performance.now() / 1000) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, now - this.last);
    this.last = now;
    if (i.fire != null) { this.presses.f++; this.presses.fa = Math.round(i.fire * 1000) / 1000; }
    else if (i.auto) this.presses.a++;
    if (i.power != null) this.presses.u[i.power]++;
    const m: Omit<Helm, 'n'> = {
      t: 'in',
      m: i.move ? [Math.round(i.move.x * 100) / 100, Math.round(i.move.y * 100) / 100] : null,
      ...this.presses, u: [...this.presses.u],
    };
    const sent = this.send(m, now);
    if (sent && (i.fire != null || i.auto)) this.volley(i.fire, now);
    const w = this.mirror.world;
    if (w) this.lead.advance({ map: w.map, R: w.R }, dt, this.n, this.sentMove, this.singers());
  }

  /** Was it sent? */
  private send(m: Omit<Helm, 'n'>, now: number): boolean {
    const s = JSON.stringify(m);
    // A thumb on the stick changes the hands every frame, and the sea only reads them
    // thirty times a second. On bar wifi every message from every phone is airtime the
    // snapshots coming the other way wait behind, so a moving stick goes up twenty times
    // a second. A press on the guns never waits.
    // The first change after a still spell goes at once: your own ship turns when it is
    // sent (net/lead.ts), so a change kept waiting is a helm that answers late.
    const p = this.sentPresses;
    const pressed = m.f !== p.f || m.a !== p.a || String(m.u) !== p.u;
    if (!pressed && (s === this.sent ? now - this.sentAt < KEEPALIVE : now - this.changedAt < HELM_EVERY)) return false;
    if (this.ws?.readyState !== WebSocket.OPEN || this.state !== 'aboard') return false;
    // the sea sails her by each of her hands as long as the phone did: say how long that was
    if (s !== this.sent) { this.d = this.n > 0 ? this.lead.ticksOf(this.n) : 0; this.n++; this.changedAt = now; }
    this.ws.send(JSON.stringify({ ...m, n: this.n, d: this.d, k: this.mirror.lastCk }));
    this.sent = s; this.sentAt = now; this.sentPresses = { f: m.f, a: m.a, u: String(m.u) };
    this.sentMove = m.m ? { x: m.m[0], y: m.m[1] } : null;
    return true;
  }

  /** A press on the guns, shown at once from your ship where the phone has her, if she has
   *  a shot ready. The sea fires it a moment later from the same place. */
  private volley(bearing: number | null, now: number) {
    const w = this.mirror.world, s = this.lead.ship, own = this.mirror.own;
    if (!w || !s || !own) return;
    const me = w.ships[w.focus];
    if (!me || me.out || own[0] - this.fired.length < 1 || now - this.lastShot < T.gap) return;
    const a = bearing ?? autoBearing(w, me);
    this.local.push({ k: 'volley', p: w.focus, side: sideFacing(me.h, a), a, heavy: me.heavy, x: me.x, y: me.y });
    this.fired.push(this.n);
    this.shown.push(now);
    this.lastShot = now;
  }

  /** Every other ship singing, where she is drawn: the phone's own ship is pulled toward
   *  each as it steps her (net/lead.ts). */
  private singers(): [number, number][] {
    const w = this.mirror.world;
    if (!w) return [];
    return w.ships.filter((s) => s.song > 0 && !s.out && s.id !== w.focus).map((s) => [s.x, s.y]);
  }

  /** Try again, from the start, after the line gave up: a guest's wifi may have come back. */
  again() {
    if (this.state !== 'refused' || (this.why !== 'server' && this.why !== 'reach') || !this.token) return;
    this.state = 'hailing'; this.why = null; this.tries = 0;
    this.wait();
    this.changed();
    this.hail();
  }

  /** Go ashore: the Leave button. The sea docks her at once out of a fight, or leaves her
   *  on the water a while in one. */
  close() {
    this.closed = true;
    clearTimeout(this.giveUp);
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
