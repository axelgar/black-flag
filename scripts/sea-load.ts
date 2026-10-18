// A full bar against a real sea on this machine, with nobody signed in anywhere. A
// stand-in for Supabase's sign-in answers on 127.0.0.1 (its public key set, and me()), the
// sea's server is started pointed at it, and bot captains come aboard over websockets with
// tokens of their own and sail with the test bot's seamanship. Nothing touches the live
// project, so a thousand of these leave no "Bot …" players to clear out.
//
//   npm run sea:load -- [captains] [--for 60] [--port 8788] [--watch] [--key KEY]
//
// It prints what the phones saw: how many came aboard, how evenly snapshots arrived, how
// far behind each phone drew, and how much each was sent. With --watch, the bar's screen
// looks on too, from before the first captain is aboard, and a screen with the wrong key
// tries to. --key sets the watch key, to put the bar's screen up against this sea yourself
// (VITE_SEA_URL=ws://127.0.0.1:8788 npm run dev, then /watch).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { SHIPS } from '../src/data/ships';
import { itemOf } from '../src/net/items';
import { Mirror, WIRE, type FromSea, type Snap } from '../src/net/protocol';
import { you } from '../src/sim/types';
import { bot } from '../tests/bot';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(args.find((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith('--')) ?? 30);
const SECS = Number(flag('for', '60'));
const PORT = Number(flag('port', '8788'));
const WATCH = args.includes('--watch');
const KEY = flag('key', crypto.randomUUID());
const AUTH = PORT + 1000;
const base = `http://127.0.0.1:${AUTH}`;

/* ------------------------------------------------- a stand-in for the sign-in -- */

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'load', alg: 'ES256', use: 'sig' };
// names the bar might sail under, so the bar's screen has real ones to place
const NAMES = ['Salt Nell', 'Red Jack', 'Grim Bart', 'Iron Cara', 'Mad Ines', 'Calico Tom', 'Black Sal', 'One-Eyed Rui',
  'Bonny Mae', 'Long Pete', 'Sweet Lou', 'Dread Ana', 'Hook Hal', 'Rum Rosa', 'Cutlass Kit', 'Silver Mo'];
const named = new Map<string, string>();
const auth = createServer((req, res) => {
  if (req.url === '/auth/v1/.well-known/jwks.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
  if (req.url === '/rest/v1/rpc/me' && req.method === 'POST') {
    // the token was signed here, so its subject is read rather than checked again
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const sub = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').sub as string;
    res.setHeader('content-type', 'application/json');
    if (!named.has(sub)) named.set(sub, named.size < NAMES.length ? NAMES[named.size] : `Load ${sub.slice(0, 4)}`);
    res.end(JSON.stringify({ id: sub, captain: named.get(sub), items: SHIPS.map((s) => itemOf(s.id)) }));
    req.resume();
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((ok) => auth.listen(AUTH, '127.0.0.1', ok));

const token = (sub: string) => new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg: 'ES256', kid: 'load' }).setSubject(sub).setIssuer(`${base}/auth/v1`)
  .setAudience('authenticated').setIssuedAt().setExpirationTime('2h').sign(privateKey);

/* ------------------------------------------------------------- the sea -- */

const state = mkdtempSync(join(tmpdir(), 'black-flag-load-'));
const sea = spawn('npx', ['wrangler', 'dev', '-c', 'server/wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(PORT),
  '--var', `SUPABASE_URL:${base}`, '--var', `WATCH_KEY:${KEY}`, '--persist-to', state], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
sea.stdout.on('data', (d) => { log += d; });
sea.stderr.on('data', (d) => { log += d; });
// npx starts wrangler, and wrangler the runtime: the whole group goes down together
const done = (code: number) => { try { process.kill(-sea.pid!, 'SIGTERM'); } catch { /* gone */ } auth.close(); rmSync(state, { recursive: true, force: true }); process.exit(code); };
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not up yet */ }
  if (i > 60) { console.error(`the sea did not come up:\n${log}`); done(1); }
  await new Promise((r) => setTimeout(r, 500));
}

/* ------------------------------------------------------------ the bots -- */

interface Bot { name: string; aboard: boolean; nope: string; arrivals: number[]; bytes: number; delays: number[]; own: number }
const bots: Bot[] = [];
const t0 = performance.now() / 1000;

async function captain(i: number) {
  const b: Bot = { name: `bot${i}`, aboard: false, nope: '', arrivals: [], bytes: 0, delays: [], own: 0 };
  bots.push(b);
  const seat = crypto.randomUUID();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sea/bar/1`);
  const mirror = new Mirror();
  const presses = { fl: 0, fr: 0, mo: 0 };
  let tick = 0;
  const tok = await token(seat);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: WIRE, token: tok, ship: SHIPS[i % SHIPS.length].id }));
  ws.onmessage = (ev) => {
    const raw = String(ev.data), now = performance.now() / 1000;
    const m = JSON.parse(raw) as FromSea;
    b.bytes += raw.length;
    if (m.t === 'welcome') b.aboard = true;
    else if (m.t === 'nope') b.nope = m.why;
    else if (m.t === 'roster') mirror.roster(m, seat);
    else if (m.t === 's') {
      mirror.push(m as Snap, now);
      b.arrivals.push(now);
      if ((m as Snap).me) b.own++;
    }
  };
  // the helm, twenty times a second, and a frame of the mirror with it
  const helm = setInterval(() => {
    const now = performance.now() / 1000;
    mirror.frame(now);
    if (mirror.world) { mirror.world.events.length = 0; if (now - t0 > 15) b.delays.push(mirror.delay); }
    const w = mirror.world;
    if (!w || ws.readyState !== WebSocket.OPEN) return;
    const s = you(w);
    if (!s || s.out) return;
    const input = bot(w, tick++, { mortar: true }, s);
    if (s.cool[0] <= 0) input.fireL = true;           // two thumbs, every gun the moment it is loaded
    if (s.cool[1] <= 0) input.fireR = true;
    if (input.fireL) presses.fl++;
    if (input.fireR) presses.fr++;
    if (input.mortar) presses.mo++;
    ws.send(JSON.stringify({ t: 'in', h: input.heading, r: input.rudder, s: input.sail, ...presses }));
  }, 50);
  setTimeout(() => { clearInterval(helm); ws.close(1000, 'ashore'); }, SECS * 1000);
}

/* ---------------------------------------------------------- the screen -- */

interface Screen { welcome: boolean; nope: string; quiet: boolean; arrivals: number[]; delays: number[]; own: number; drawn: number }
const screen: Screen = { welcome: false, nope: '', quiet: false, arrivals: [], delays: [], own: 0, drawn: 0 };
const stranger = { nope: '', snaps: 0 };

function watch(key: string, onto: (m: FromSea, now: number) => void) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sea/bar/1`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', v: WIRE, key }));
  ws.onmessage = (ev) => onto(JSON.parse(String(ev.data)) as FromSea, performance.now() / 1000);
  return ws;
}

if (WATCH) {
  watch('not the key', (m) => { if (m.t === 'nope') stranger.nope = m.why; if (m.t === 's') stranger.snaps++; });
  const mirror = new Mirror();
  const ws = watch(KEY, (m, now) => {
    if (m.t === 'welcome') screen.welcome = !!m.watch;
    else if (m.t === 'nope') screen.nope = m.why;
    else if (m.t === 'round' && !screen.arrivals.length && !m.scores.length) screen.quiet = true;
    else if (m.t === 'roster') mirror.roster(m, '');
    else if (m.t === 's') { mirror.push(m as Snap, now); screen.arrivals.push(now); if ((m as Snap).me !== undefined) screen.own++; }
  });
  const paint = setInterval(() => {
    const now = performance.now() / 1000;
    mirror.frame(now);
    const w = mirror.world;
    if (!w) return;
    w.events.length = 0;
    if (now - t0 > 15) screen.delays.push(mirror.delay);
    screen.drawn = Math.max(screen.drawn, w.players.filter((p) => !p.left).length);
  }, 50);
  setTimeout(() => { clearInterval(paint); ws.close(1000, 'off'); }, (SECS + 1) * 1000);
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`${N} captains aboard a sea on 127.0.0.1:${PORT} for ${SECS}s${WATCH ? ', the bar\'s screen looking on' : ''}…`);
for (let i = 0; i < N; i++) { void captain(i); await new Promise((r) => setTimeout(r, 40)); }
await new Promise((r) => setTimeout(r, SECS * 1000 + 1500));

/* ----------------------------------------------------------- the count -- */

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const aboard = bots.filter((b) => b.aboard);
const gaps = aboard.flatMap((b) => b.arrivals.slice(1).map((t, i) => t - b.arrivals[i]).filter((_, i) => b.arrivals[i] - t0 > 15));
const span = (b: Bot) => (b.arrivals.at(-1)! - b.arrivals[0]) || 1;
const turned = bots.filter((b) => b.nope).map((b) => b.nope);
console.log(JSON.stringify({
  aboard: `${aboard.length} of ${N}`, turnedAway: turned.length ? turned : undefined,
  snapshotsPerSecond: +(aboard.reduce((a, b) => a + b.arrivals.length / span(b), 0) / Math.max(1, aboard.length)).toFixed(1),
  'gap ms p50/p99/max': `${Math.round(pct(gaps, 0.5) * 1000)} / ${Math.round(pct(gaps, 0.99) * 1000)} / ${Math.round(Math.max(0, ...gaps) * 1000)}`,
  'drawn behind ms (avg)': Math.round((1000 * aboard.reduce((a, b) => a + b.delays.reduce((x, y) => x + y, 0) / Math.max(1, b.delays.length), 0)) / Math.max(1, aboard.length)),
  'KB/s raw per phone': +(aboard.reduce((a, b) => a + b.bytes / span(b), 0) / Math.max(1, aboard.length) / 1024).toFixed(1),
  everySnapshotHadOwnShip: aboard.every((b) => b.own === b.arrivals.length),
  screen: WATCH ? {
    welcomed: screen.welcome, turnedAway: screen.nope || undefined, toldTheSeaWasQuiet: screen.quiet,
    snapshotsPerSecond: +(screen.arrivals.length / ((screen.arrivals.at(-1)! - screen.arrivals[0]) || 1)).toFixed(1),
    'drawn behind ms (avg)': Math.round((1000 * screen.delays.reduce((x, y) => x + y, 0)) / Math.max(1, screen.delays.length)),
    shipsDrawn: screen.drawn, sentAShipOfItsOwn: screen.own > 0,
    wrongKey: stranger.nope ? `turned away (${stranger.nope}), ${stranger.snaps} snapshots` : 'NOT TURNED AWAY',
  } : undefined,
}, null, 1));
done(0);
