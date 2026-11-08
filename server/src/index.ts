// Black Flag's shared seas, on Render: one Node process that holds every sea. A room has
// the sockets of everyone aboard, checks who they are with Supabase, and beats its sea
// (src/net/sea.ts) thirty times a second while anyone is aboard. The seas are in this
// process's memory, so it must stay one instance: a second would be a second set of seas.
//
// A screen may look on at a sea, the bar's TV, by saying the watch key (WATCH_KEY, a secret
// set on the service in Render's dashboard; server/.dev.vars on this machine). It takes no
// seat, and an empty sea stays asleep under it. With no key set, nobody can watch.
//
// Five in a row is written down by the server, never by a phone: it calls record_win in
// the database with the project's secret key (SUPABASE_SECRET, a secret set the same way).
// Without it the sea still plays, and wins go unrecorded.
//
//   /sea/bar/<n>      the bar's n-th sea (n from 1). A full sea sends the phone to the next.
//   /                 says the server is up, for Render's health check

import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { WebSocketServer, type WebSocket } from 'ws';
import { checkName } from '../../src/data/names';
import { lookById } from '../../src/data/ships';
import { TUNING } from '../../src/data/tuning';
import { SUPABASE_KEY, SUPABASE_URL } from '../../src/net/project';
import { WIRE, type FromSea, type Nope, type ToSea, type Watch } from '../../src/net/protocol';
import { Sea, type Win } from '../../src/net/sea';

const { WATCH_KEY, SUPABASE_SECRET } = process.env;

/** Screens looking on at one sea: the bar's TV, and one or two more. */
const WATCHERS = 4;
/** The most a phone has reason to say at once: a hello, with its token. */
const LONGEST = 16 * 1024;
/** How often every line is asked whether it is still there. */
const ASK_EVERY = 30_000;
/** Nobody aboard for this long and the night is over: the next captain finds a new sea,
 *  with no streak kept from another night. */
const NIGHT_OVER = 60 * 60 * 1000;

const rooms = new Map<string, SeaRoom>();
const wires = new WebSocketServer({ noServer: true, maxPayload: LONGEST });
const answered = new WeakSet<WebSocket>();   // the lines that have answered since last asked

/** Which of the bar's seas a path is for. */
const barOf = (url = '') => url.split('?')[0].match(/^\/sea\/bar\/([1-9])$/)?.[1];

const server = createServer((req, res) => {
  if (barOf(req.url)) res.writeHead(426).end('A sea is sailed over a websocket.\n');
  else res.writeHead(req.url === '/' ? 200 : 404).end('Black Flag: shared seas\n');
});

server.on('upgrade', (req, socket, head) => {
  const bar = barOf(req.url);
  if (!bar) { socket.destroy(); return; }
  wires.handleUpgrade(req, socket, head, (ws) => {
    answered.add(ws);
    ws.on('pong', () => answered.add(ws));
    let room = rooms.get(bar);
    if (!room) rooms.set(bar, room = new SeaRoom(`BAR${bar}`));
    room.add(ws);
  });
});

// A phone that goes dark mid-sea (a lock screen, a tunnel) closes nothing, and its ship
// would sail on for ever: a line that hasn't answered since it was last asked is dropped.
setInterval(() => {
  for (const ws of wires.clients) {
    if (answered.delete(ws)) ws.ping();
    else ws.terminate();
  }
}, ASK_EVERY);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

class SeaRoom {
  private sea: Sea | null = null;
  private socks = new Map<WebSocket, string | null>();   // every socket, and its seat once aboard
  private watchers = new Set<WebSocket>();                // the screens looking on
  private timer: ReturnType<typeof setInterval> | null = null;
  private empty: ReturnType<typeof setTimeout> | undefined;
  private last = 0;

  constructor(private code: string) {}

  add(ws: WebSocket) {
    this.socks.set(ws, null);
    // every sea shares this process: what one phone breaks must not end the night for the rest
    ws.on('message', (data) => { this.hear(ws, data.toString()).catch((err) => console.warn('[sea] a message broke', err)); });
    ws.on('close', () => this.gone(ws));
    ws.on('error', () => this.gone(ws));
  }

  private async hear(ws: WebSocket, data: string) {
    let m: ToSea;
    try { m = JSON.parse(data); } catch { return; }
    if (this.watchers.has(ws)) return;
    if (m.t === 'watch') return this.watch(ws, m);
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
    if (!this.socks.has(ws)) return;   // gone while they were being checked: no ghost ship
    this.sea ??= new Sea(this.code);
    // the same captain on a second socket (a reload, a second tab): the newest wins
    for (const [s, seat] of this.socks) {
      if (seat === who.seat && s !== ws) { this.socks.set(s, null); try { s.close(4000, 'aboard elsewhere'); } catch { /* already gone */ } }
    }
    const why = this.sea.join({ seat: who.seat, name: named.name, look: lookById(m.look).id, ticket: who.ticket });
    if (why) return this.nope(ws, why);
    this.socks.set(ws, who.seat);
    this.send(ws, { t: 'welcome', v: WIRE, code: this.sea.code, cap: this.sea.cap });
    this.send(ws, this.sea.roster());
    this.start();
  }

  /** A screen asks to look on. It is sent what every phone aboard is, but its own ship. */
  private async watch(ws: WebSocket, m: Watch) {
    if (this.socks.get(ws)) return;
    if (m.v !== WIRE) return this.nope(ws, 'version');
    if (!this.keyed(m.key)) {
      // a second's pause for every wrong key: guessing one is slow work
      await new Promise((r) => setTimeout(r, 1000));
      return this.nope(ws, 'key');
    }
    if (this.watchers.size >= WATCHERS) return this.nope(ws, 'full');
    this.watchers.add(ws);
    const sea = this.sea;
    this.send(ws, { t: 'welcome', v: WIRE, code: sea?.code ?? this.code, cap: sea?.cap ?? TUNING.maxShips, watch: true });
    if (sea) this.send(ws, sea.roster());
  }

  /** Is this the watch key? Compared in constant time, both sides hashed to one length. */
  private keyed(key: unknown) {
    if (!WATCH_KEY || typeof key !== 'string' || !key) return false;
    const hash = (k: string) => createHash('sha256').update(k).digest();
    return timingSafeEqual(hash(key), hash(WATCH_KEY));
  }

  /** Who this token belongs to, and whether they hold a ticket tonight. */
  private async who(token: string) {
    jwks ??= createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/me`, {
      method: 'POST', body: '{}',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const me = (await r.json()) as { id: string; ticket?: boolean };
    if (me.id !== payload.sub) return null;
    return { seat: me.id, ticket: !!me.ticket };
  }

  private start() {
    clearTimeout(this.empty);
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      try { this.beat(); } catch (err) { this.broke(err); }
    }, 1000 / 30);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A sea that throws is let go, rather than taking the other seas down with the process.
   *  Its phones come back to a new one. */
  private broke(err: unknown) {
    console.error('[sea] a sea broke', err);
    this.stop();
    this.sea = null;
    for (const ws of this.socks.keys()) ws.close(1011, 'the sea broke');
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
    for (const w of sea.takeWins()) void this.record(w);
    if (!sea.aboard) {
      // nobody aboard: stop beating. The bots stop with it; the next captain aboard finds
      // them where they were, unless the night is over by then.
      this.stop();
      this.empty = setTimeout(() => { this.sea = null; }, NIGHT_OVER);
    }
  }

  /** Write a win down: a free shot, or practice. Tried three times over a few seconds;
   *  the database spends the ticket once however often it is asked. */
  private async record(w: Win) {
    const key = SUPABASE_SECRET;
    if (!key) { console.warn('[sea] no SUPABASE_SECRET: a win went unrecorded'); return; }
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_win`, {
          method: 'POST', body: JSON.stringify({ p_player: w.seat, p_sea: this.sea?.code ?? null }),
          headers: { apikey: key, 'Content-Type': 'application/json' },
        });
        if (r.ok) return;
        console.warn('[sea] record_win said', r.status, await r.text());
      } catch (err) { console.warn('[sea] record_win failed', err); }
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** i));
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

const port = Number(process.env.PORT) || 8787;
server.listen(port, '0.0.0.0', () => console.log(`[sea] open on port ${port}`));
