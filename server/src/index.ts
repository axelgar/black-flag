// Black Flag's shared seas, on Cloudflare. One Durable Object per sea: it holds the
// sockets of everyone aboard, checks who they are with Supabase, and beats the sea
// (src/net/sea.ts) thirty times a second while anyone is aboard. The worker in front
// only works out which sea a request is for.
//
//   /sea/bar/<n>      the bar's n-th sea (n from 1); its mode is the venue's, BAR_MODE
//   /sea/code/<CODE>  a private sea: four letters, opened by whoever says how it plays

import { DurableObject } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { STARTER } from '../../src/data/ships';
import { itemOf } from '../../src/net/items';
import { WIRE, type FromSea, type Mode, type Nope, type ToSea } from '../../src/net/protocol';
import { Sea } from '../../src/net/sea';

export interface Env {
  SEA: DurableObjectNamespace<SeaRoom>;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;     // the publishable key: it is sent with the player's own token
  VENUE?: string;
  BAR_MODE?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const bar = url.pathname.match(/^\/sea\/bar\/([1-9])$/);
    const code = url.pathname.match(/^\/sea\/code\/([A-Za-z]{4})$/);
    if (!bar && !code) return new Response('Black Flag: shared seas\n', { status: url.pathname === '/' ? 200 : 404 });
    const name = bar ? `bar:${env.VENUE ?? 'main'}:${bar[1]}` : `code:${code![1].toUpperCase()}`;
    const headers = new Headers(req.headers);
    headers.set('x-sea-code', bar ? `BAR${bar[1]}` : code![1].toUpperCase());
    if (bar) headers.set('x-sea-mode', env.BAR_MODE === 'crew' ? 'crew' : 'rivals');
    return env.SEA.get(env.SEA.idFromName(name)).fetch(new Request(req, { headers }));
  },
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** A private sea's code is forgotten this long after it was last opened, if nobody is aboard. */
const FORGET = 7 * 24 * 3600 * 1000;

export class SeaRoom extends DurableObject<Env> {
  private sea: Sea | null = null;
  private socks = new Map<WebSocket, string | null>();   // every socket, and its seat once aboard
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('A sea is sailed over a websocket.\n', { status: 426 });
    const code = req.headers.get('x-sea-code') ?? 'SEA';
    const mode = req.headers.get('x-sea-mode') as Mode | null;
    const pair = new WebSocketPair();
    const [client, ws] = [pair[0], pair[1]];
    ws.accept();
    this.socks.set(ws, null);
    ws.addEventListener('message', (e) => { void this.hear(ws, e.data, code, mode); });
    ws.addEventListener('close', () => this.gone(ws));
    ws.addEventListener('error', () => this.gone(ws));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async hear(ws: WebSocket, data: string | ArrayBuffer, code: string, barMode: Mode | null) {
    let m: ToSea;
    try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    if (m.t === 'in') {
      const seat = this.socks.get(ws);
      if (seat) this.sea?.helm(seat, m);
      return;
    }
    if (m.t !== 'hello' || this.socks.get(ws)) return;
    if (m.v !== WIRE) return this.nope(ws, 'version');
    const who = await this.who(m.token).catch(() => null);
    if (!who) return this.nope(ws, 'token');
    if (m.ship !== STARTER && !who.items.includes(itemOf(m.ship))) return this.nope(ws, 'ship');
    if (!this.sea) {
      // A bar's sea plays the venue's way; a private one, the way whoever opened it said.
      // That is written down, so the code still works after the server restarts.
      const mode = barMode ?? (await this.ctx.storage.get<Mode>('mode')) ?? m.open;
      if (!mode) return this.nope(ws, 'unknown');
      if (!barMode) {
        await this.ctx.storage.put('mode', mode);
        await this.ctx.storage.setAlarm(Date.now() + FORGET);
      }
      this.sea ??= new Sea(code, mode);
    }
    // the same captain on a second socket (a reload, a second tab): the newest wins
    for (const [s, seat] of this.socks) {
      if (seat === who.seat && s !== ws) { this.socks.set(s, null); try { s.close(4000, 'aboard elsewhere'); } catch { /* already gone */ } }
    }
    const why = this.sea.join({ seat: who.seat, captain: who.captain, ship: m.ship });
    if (why) return this.nope(ws, why);
    this.socks.set(ws, who.seat);
    this.send(ws, { t: 'welcome', v: WIRE, code: this.sea.code, mode: this.sea.mode, cap: this.sea.cap });
    this.send(ws, this.sea.roster());
    this.send(ws, this.sea.round());
    this.start();
  }

  /** Who this token belongs to, the name they sail under, and what they own. */
  private async who(token: string) {
    const base = this.env.SUPABASE_URL;
    jwks ??= createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
    const r = await fetch(`${base}/rest/v1/rpc/me`, {
      method: 'POST', body: '{}',
      headers: { apikey: this.env.SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const me = (await r.json()) as { id: string; captain: string; items: string[] };
    if (me.id !== payload.sub) return null;
    return { seat: me.id, captain: me.captain, items: me.items };
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
      if (m.t !== 's') { for (const [ws, seat] of this.socks) if (seat) { try { ws.send(s); } catch { /* closing */ } } continue; }
      // A snapshot is the same for everyone aboard but for each phone's own ship, whose
      // guns and takings go on the end: written once, finished phone by phone.
      const head = s.slice(0, -1);
      for (const [ws, seat] of this.socks) if (seat) { try { ws.send(`${head},"me":${JSON.stringify(sea.own(seat))}}`); } catch { /* closing */ } }
    }
    if (!sea.aboard && this.timer) {
      // nobody aboard: stop beating, and let the object sleep. A private sea keeps its
      // mode for as long as the object stays awake, so its code works for a while yet.
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** A week on: forget a private sea nobody is sailing, so its code is free again. */
  async alarm() {
    if (this.sea?.aboard) { await this.ctx.storage.setAlarm(Date.now() + FORGET); return; }
    this.sea = null;
    await this.ctx.storage.deleteAll();
  }

  private gone(ws: WebSocket) {
    const seat = this.socks.get(ws);
    this.socks.delete(ws);
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
