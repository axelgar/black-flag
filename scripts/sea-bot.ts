// A captain made of arithmetic, aboard a shared sea: company for trying a sea on your
// own, and the far end of the wire for testing the server.
//
//   npm run sea:bot -- [url] [--ship kestrel] [--for 60] [--open rivals|crew]
//
// url defaults to the bar's first sea on `npm run sea:dev` (ws://localhost:8787/sea/bar/1).
// It signs in to Supabase as a new anonymous player named "Bot …", so bots are easy to
// find and clear out: delete from auth.users where id in
//   (select id from public.players where captain like 'Bot %').

import { Mirror, WIRE, type FromSea, type Helm, type Mode, type Snap } from '../src/net/protocol';
import { you } from '../src/sim/types';
import { bot } from '../tests/bot';

const SUPABASE = 'https://vspueoyeaorfmbmefhiv.supabase.co';
const KEY = 'sb_publishable_mbZmUcrjjPBgNHqvdgu2_g_D_Xvyamy';

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const url = args.find((a) => /^wss?:\/\//.test(a)) ?? 'ws://localhost:8787/sea/bar/1';
const ship = flag('ship') ?? 'jackdaw';
const seconds = Number(flag('for') ?? 0);
const open = flag('open') as Mode | undefined;

async function signIn() {
  const r = await fetch(`${SUPABASE}/auth/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const s = (await r.json()) as { access_token: string; user: { id: string } };
  if (!s.access_token) throw new Error(`no anonymous sign-in: ${JSON.stringify(s)}`);
  const name = `Bot ${s.user.id.slice(0, 4)}`;
  await fetch(`${SUPABASE}/rest/v1/rpc/rename_captain`, {
    method: 'POST', body: JSON.stringify({ p_captain: name }),
    headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
  });
  return { token: s.access_token, seat: s.user.id, name };
}

const me = await signIn();
const mirror = new Mirror();
const stats = { snaps: 0, bytes: 0, maxBytes: 0, first: 0, last: 0, rounds: [] as string[] };
const presses = { fl: 0, fr: 0, mo: 0 };
let tick = 0;

const ws = new WebSocket(url);
ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: WIRE, token: me.token, ship, open }));
ws.onmessage = (ev) => {
  const raw = String(ev.data);
  const m = JSON.parse(raw) as FromSea;
  const now = performance.now() / 1000;
  if (m.t === 'welcome') console.log(`${me.name} aboard ${m.code} (${m.mode}, ${m.cap} ships)`);
  else if (m.t === 'nope') { console.error(`turned away: ${m.why}`); process.exit(1); }
  else if (m.t === 'roster') mirror.roster(m, me.seat);
  else if (m.t === 'round') {
    const line = `${m.stage} ${m.left}s · ${m.scores.map((s) => `${s.captain} ${s.plunder}`).join(', ')}`;
    if (!stats.rounds.length || m.left % 15 === 0 || m.stage !== stats.rounds.at(-1)!.split(' ')[0]) console.log(`round ${m.n}: ${line}`);
    stats.rounds.push(line);
  } else if (m.t === 's') {
    mirror.push(m as Snap, now);
    stats.snaps++; stats.bytes += raw.length; stats.maxBytes = Math.max(stats.maxBytes, raw.length);
    stats.first ||= now; stats.last = now;
  }
};
ws.onclose = (e) => { console.log(`the sea closed the line: ${e.code} ${e.reason}`); summary(); process.exit(0); };

// the helm, twenty times a second
setInterval(() => {
  mirror.frame(performance.now() / 1000);
  const w = mirror.world;
  if (!w || ws.readyState !== WebSocket.OPEN) return;
  const s = you(w);
  if (!s || s.out) return;
  const input = bot(w, tick++, { mortar: true }, s);
  if (input.fireL) presses.fl++;
  if (input.fireR) presses.fr++;
  if (input.mortar) presses.mo++;
  const helm: Helm = { t: 'in', h: input.heading, r: input.rudder, s: input.sail, ...presses };
  ws.send(JSON.stringify(helm));
}, 50);

function summary() {
  const span = stats.last - stats.first || 1;
  const s = mirror.world ? you(mirror.world) : null;
  console.log(JSON.stringify({
    captain: me.name, snapshotsPerSecond: +(stats.snaps / span).toFixed(1),
    avgBytes: Math.round(stats.bytes / Math.max(1, stats.snaps)), maxBytes: stats.maxBytes,
    kbPerSecond: +((stats.bytes / span) / 1024).toFixed(1),
    plunder: s?.plunder, sunk: s?.sunk, broadsides: presses.fl + presses.fr,
  }));
}
if (seconds) setTimeout(() => { summary(); ws.close(1000, 'ashore'); process.exit(0); }, seconds * 1000);
