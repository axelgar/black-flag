// Black Flag's shared seas, on Cloudflare. One Durable Object per sea: it holds the
// sockets of everyone aboard, checks who they are with Supabase, and beats the sea
// (src/net/sea.ts) thirty times a second while anyone is aboard. The worker in front
// only works out which sea a request is for.
//
// A screen may look on at a sea, the bar's TV, by saying the watch key (WATCH_KEY, a secret:
// `npx wrangler secret put WATCH_KEY -c server/wrangler.jsonc`; server/.dev.vars on this
// machine). It takes no seat, and an empty sea stays asleep under it. With no key set,
// nobody can watch.
//
//   /sea/bar/<n>      the bar's n-th sea (n from 1). A full sea sends the phone to the next.

import { DurableObject } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { checkName } from '../../src/data/names';
import { lookById } from '../../src/data/ships';
import { TUNING } from '../../src/data/tuning';
import { WIRE, type FromSea, type Nope, type ToSea, type Watch } from '../../src/net/protocol';
import { Sea } from '../../src/net/sea';

export interface Env {
  SEA: DurableObjectNamespace<SeaRoom>;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;     // the publishable key: it is sent with the player's own token
  VENUE?: string;
  WATCH_KEY?: string;       // a secret: what a screen says to look on
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const bar = url.pathname.match(/^\/sea\/bar\/([1-9])$/);
    if (!bar) return new Response('Black Flag: shared seas\n', { status: url.pathname === '/' ? 200 : 404 });
    const headers = new Headers(req.headers);
    headers.set('x-sea-code', `BAR${bar[1]}`);
    return env.SEA.get(env.SEA.idFromName(`bar:${env.VENUE ?? 'main'}:${bar[1]}`)).fetch(new Request(req, { headers }));
  },
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Screens looking on at one sea: the bar's TV, and one or two more. */
const WATCHERS = 4;

export class SeaRoom extends DurableObject<Env> {
  private sea: Sea | null = null;
  private socks = new Map<WebSocket, string | null>();   // every socket, and its seat once aboard
  private watchers = new Set<WebSocket>();                // the screens looking on
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('A sea is sailed over a websocket.\n', { status: 426 });
    const code = req.headers.get('x-sea-code') ?? 'SEA';
    const pair = new WebSocketPair();
    const [client, ws] = [pair[0], pair[1]];
    ws.accept();
    this.socks.set(ws, null);
    ws.addEventListener('message', (e) => { void this.hear(ws, e.data, code); });
    ws.addEventListener('close', () => this.gone(ws));
    ws.addEventListener('error', () => this.gone(ws));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async hear(ws: WebSocket, data: string | ArrayBuffer, code: string) {
    let m: ToSea;
    try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    if (this.watchers.has(ws)) return;
    if (m.t === 'watch') return this.watch(ws, m, code);
    if (m.t === 'in') {
      const seat = this.socks.get(ws);
      if (seat) this.sea?.helm(seat, m);
      return;
    }
    if (m.t === 'leave') {
      const seat = this.socks.get(ws);
      if (seat) this.sea?.leave(seat);
      return;
    }
    if (m.t !== 'hello' || this.socks.get(ws)) return;
    if (m.v !== WIRE) return this.nope(ws, 'version');
    const named = checkName(typeof m.name === 'string' ? m.name : '');
    if (!('name' in named)) return this.nope(ws, 'name');
    const who = await this.who(m.token).catch(() => null);
    if (!who) return this.nope(ws, 'token');
    this.sea ??= new Sea(code);
    // the same captain on a second socket (a reload, a second tab): the newest wins
    for (const [s, seat] of this.socks) {
      if (seat === who.seat && s !== ws) { this.socks.set(s, null); try { s.close(4000, 'aboard elsewhere'); } catch { /* already gone */ } }
    }
    const why = this.sea.join({ seat: who.seat, name: named.name, look: lookById(m.look).id });
    if (why) return this.nope(ws, why);
    this.socks.set(ws, who.seat);
    this.send(ws, { t: 'welcome', v: WIRE, code: this.sea.code, cap: this.sea.cap });
    this.send(ws, this.sea.roster());
    this.start();
  }

  /** A screen asks to look on. It is sent what every phone aboard is, but its own ship. */
  private async watch(ws: WebSocket, m: Watch, code: string) {
    if (this.socks.get(ws)) return;
    if (m.v !== WIRE) return this.nope(ws, 'version');
    if (!(await this.keyed(m.key))) {
      // a second's pause for every wrong key: guessing one is slow work
      await new Promise((r) => setTimeout(r, 1000));
      return this.nope(ws, 'key');
    }
    if (this.watchers.size >= WATCHERS) return this.nope(ws, 'full');
    this.watchers.add(ws);
    const sea = this.sea;
    this.send(ws, { t: 'welcome', v: WIRE, code: sea?.code ?? code, cap: sea?.cap ?? TUNING.maxShips, watch: true });
    if (sea) this.send(ws, sea.roster());
  }

  /** Is this the watch key? Compared in constant time, both sides hashed to one length. */
  private async keyed(key: unknown) {
    const want = this.env.WATCH_KEY;
    if (!want || typeof key !== 'string' || !key) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([key, want].map((k) => crypto.subtle.digest('SHA-256', enc.encode(k))));
    return crypto.subtle.timingSafeEqual(a, b);
  }

  /** Who this token belongs to. */
  private async who(token: string) {
    const base = this.env.SUPABASE_URL;
    jwks ??= createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
    const r = await fetch(`${base}/rest/v1/rpc/me`, {
      method: 'POST', body: '{}',
      headers: { apikey: this.env.SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const me = (await r.json()) as { id: string };
    if (me.id !== payload.sub) return null;
    return { seat: me.id };
  }

  private start() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => this.beat(), 1000 / 30);
  }

  /** The heartbeat: step the sea, and send everyone aboard what it says. */
  private beat() {
    const sea = this.sea;
    if (!sea) return;
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    for (const m of sea.step(dt)) {
      const s = JSON.stringify(m);
      // a screen looking on is sent it all as it is: it has no ship of its own
      for (const ws of this.watchers) { try { ws.send(s); } catch { /* closing */ } }
      if (m.t !== 's') { for (const [ws, seat] of this.socks) if (seat) { try { ws.send(s); } catch { /* closing */ } } continue; }
      // A snapshot is the same for everyone aboard but for each phone's own ship, whose
      // guns and takings go on the end: written once, finished phone by phone.
      const head = s.slice(0, -1);
      for (const [ws, seat] of this.socks) if (seat) { try { ws.send(`${head},"me":${JSON.stringify(sea.own(seat))}}`); } catch { /* closing */ } }
    }
    if (!sea.aboard && this.timer) {
      // nobody aboard: stop beating, and let the object sleep. The bots stop with it; the
      // next captain aboard finds them where they were.
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private gone(ws: WebSocket) {
    const seat = this.socks.get(ws);
    this.socks.delete(ws);
    this.watchers.delete(ws);
    if (seat && ![...this.socks.values()].includes(seat)) this.sea?.leave(seat);
  }

  private send(ws: WebSocket, m: FromSea) {
    try { ws.send(JSON.stringify(m)); } catch { /* closing */ }
  }

  private nope(ws: WebSocket, why: Nope['why']) {
    this.send(ws, { t: 'nope', why });
    try { ws.close(4001, why); } catch { /* already gone */ }
  }
}
