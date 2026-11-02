// A scripted guest, to check a sea end to end: `npm run captain [-- options]`. She signs in
// anonymously, taps the Black Flag ticket, sails until five in a row, and checks that the
// server wrote her free shot down. Several at once (--ships) fill the bar's TV with
// captains: to show it off, or for a quick load test.
//
//   --sea <url>       the sea server (default VITE_SEA_URL, else `npm run sea:dev` here)
//   --bar <n>         which bar's sea (default 1)
//   --ships <n>       captains at once (default 1)
//   --name <a,b,…>    their names (default Tester 1, Tester 2…)
//   --casual          sail like a casual guest rather than a good one (scripts/brain.ts)
//   --practice        no ticket, so a win is no free shot
//   --stay            keep sailing after five in a row, until --for runs out
//   --for <seconds>   how long before giving up (default 600)
//
// Each captain is a new anonymous player in the live database, marked as a test
// (user_metadata.test = 'captain'), and a win with a ticket is a real free shot.
// PLANS/SWITCHOVER.md has the SQL that clears them.
//
// Exit code: 0 every captain did what was asked, 1 something broke, 2 one ran out of time.

import { parseArgs } from 'node:util';
import { LOOKS } from '../src/data/ships';
import type { Me, Prize } from '../src/net/cloud';
import { SUPABASE_KEY, SUPABASE_URL } from '../src/net/project';
import { Mirror, WIRE, type FromSea } from '../src/net/protocol';
import { steer, taps, type Style } from './brain';

const { values: o } = parseArgs({
  options: {
    sea: { type: 'string', default: process.env.VITE_SEA_URL || 'ws://localhost:8787' },
    bar: { type: 'string', default: '1' },
    ships: { type: 'string', default: '1' },
    name: { type: 'string', default: '' },
    casual: { type: 'boolean', default: false },
    practice: { type: 'boolean', default: false },
    stay: { type: 'boolean', default: false },
    for: { type: 'string', default: '600' },
  },
});
const SB = process.env.VITE_SUPABASE_URL || SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_KEY;
const SEA = `${o.sea.replace(/\/+$/, '')}/sea/bar/${o.bar}`;
const SHIPS = Math.max(1, Number(o.ships) || 1);
const NAMES = o.name.split(',').map((s) => s.trim()).filter(Boolean);
const STYLE: Style = o.casual ? 'casual' : 'good';
const FOR = Number(o.for) || 600;

const t0 = performance.now();
const log = (who: string, ...a: unknown[]) =>
  console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${who.padEnd(10)}`, ...a);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ the server -- */

/** A new anonymous player, marked as a test so she can be cleared later. */
async function signUp(): Promise<{ token: string; seat: string }> {
  const r = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { test: 'captain' } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`sign-in refused (${r.status}): ${j.msg ?? j.message ?? JSON.stringify(j)}`);
  return { token: j.access_token, seat: j.user.id };
}

async function rpc<T>(token: string, fn: string, body: object = {}): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}() failed (${r.status}): ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/* --------------------------------------------------------------------- a captain -- */

interface Done { ok: boolean; said: string }

async function captain(i: number): Promise<Done> {
  const name = NAMES[i] || `Tester ${i + 1}`;
  const say = (...a: unknown[]) => log(name, ...a);
  const { token, seat } = await signUp();
  say('signed in as test player', seat);
  if (!o.practice) {
    const r = await rpc<{ ticket?: string }>(token, 'redeem', { p_code: 'BLACKFLAG', p_via: 'link' });
    if (r?.ticket !== 'new') throw new Error(`the ticket tap gave ${JSON.stringify(r)}, not a new ticket`);
    if (!(await rpc<Me>(token, 'me')).ticket) throw new Error('tapped, but me() shows no ticket');
    say('🎟  ticket for tonight');
  }
  const had = new Set(((await rpc<Me>(token, 'me')).prizes ?? []).map((p) => p.id));

  const end = await new Promise<'won' | 'time'>((resolve, reject) => {
    const mirror = new Mirror();
    const ws = new WebSocket(SEA);
    const start = performance.now() / 1000;
    let last = start, n = 0, a = 0, lastTap = -1e9, streak = -1, sunk = 0, wasOut = true, over = false;
    const send = (m: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    const finish = (how: 'won' | 'time' | Error) => {
      if (over) return;
      over = true;
      clearInterval(helm);
      send({ t: 'leave' });
      try { ws.close(1000, 'ashore'); } catch { /* already gone */ }
      if (how instanceof Error) reject(how); else resolve(how);
    };
    ws.onopen = () => send({ t: 'hello', v: WIRE, token, name, look: LOOKS[i % LOOKS.length].id });
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as FromSea;
      if (m.t === 'welcome') say(`aboard sea ${m.code}`);
      else if (m.t === 'nope') finish(new Error(`turned away at the gangway: ${m.why}`));
      else if (m.t === 'roster') mirror.roster(m, seat);
      else if (m.t === 's') mirror.push(m, performance.now() / 1000);
    };
    ws.onclose = (e) => finish(new Error(`the line closed (${e.code}${e.reason ? `, ${e.reason}` : ''})`));

    const helm = setInterval(() => {
      const now = performance.now() / 1000, dt = now - last;
      last = now;
      if (now - start > FOR) return finish('time');
      mirror.frame(now);
      const w = mirror.world;
      if (!w || w.focus < 0) return;
      const me = w.ships[w.focus];
      for (const ev of w.events.splice(0)) {
        if (ev.k !== 'won' || ev.p !== w.focus) continue;
        say(`🏴‍☠️  five in a row, ${Math.round(now - start)} s after setting sail`);
        if (!o.stay) return finish('won');
      }
      if (me.out) {
        if (!wasOut && streak >= 0) { sunk++; say(`sunk (${sunk} so far)`); }
        wasOut = true;
        return;
      }
      wasOut = false;
      if (me.streak !== streak) { streak = me.streak; if (streak) say(`${'💀'.repeat(streak)} streak ${streak}`); }
      if (taps(w, me, now - lastTap, STYLE)) { a++; lastTap = now; }
      const m = steer(w, me, dt, STYLE);
      send({ t: 'in', n: ++n, m: m ? [Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100] : null, f: 0, fa: 0, a });
    }, 1000 / 15);
  });

  if (end === 'time') return o.stay ? { ok: true, said: `sailed for ${FOR} s` } : { ok: false, said: `no five in a row in ${FOR} s` };
  if (o.practice) return { ok: true, said: 'won five in a row (practice: no free shot)' };
  // the sea writes the win down as it happens; give the database a moment
  for (let tries = 0; tries < 10; tries++) {
    await wait(1000);
    const m = await rpc<Me>(token, 'me');
    const p: Prize | undefined = (m.prizes ?? []).find((x) => !had.has(x.id));
    if (!p) continue;
    if (m.ticket) return { ok: false, said: `free shot #${p.id} written down, but the ticket was not spent` };
    const until = new Date(p.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    say(`🥃  free shot #${p.id} written down, not yet saved with an email, good until ${until}`);
    return { ok: true, said: `won a free shot (#${p.id})` };
  }
  return { ok: false, said: 'won, but the server never wrote the free shot down (does the sea server have SUPABASE_SECRET?)' };
}

/* ------------------------------------------------------------------------- go -- */

console.log(`${SHIPS} scripted captain${SHIPS > 1 ? 's' : ''} → ${SEA}, ${o.practice ? 'practice' : 'with a ticket'}, sailing ${STYLE === 'good' ? 'well' : 'casually'}\n`);
const results = await Promise.allSettled(Array.from({ length: SHIPS }, (_, i) => wait(i * 400).then(() => captain(i))));
console.log('');
let code = 0;
results.forEach((r, i) => {
  const name = NAMES[i] || `Tester ${i + 1}`;
  if (r.status === 'rejected') { code = 1; console.log(`✗ ${name}: ${r.reason instanceof Error ? r.reason.message : r.reason}`); return; }
  if (!r.value.ok) code = r.value.said.startsWith('no five') ? code || 2 : 1;
  console.log(`${r.value.ok ? '✓' : '✗'} ${name}: ${r.value.said}`);
});
process.exit(code);
