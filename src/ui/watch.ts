// The bar's screen: the whole sea from high above on the TV, every captain ringed in her
// own mark with her name over her, and round it the round, the standings, who sank whom
// and a code to scan to come aboard. Opened at /watch with the watch key the sea's server
// holds; nothing in the game leads here.
//
// It runs unattended all night: it keeps the screen awake, hides the pointer, comes back
// after a wifi blink or a deploy on its own, reloads itself once at dawn, and says nothing
// until S is pressed. It never signs in (see asNobody in net/cloud.ts).

import { markOf } from '../data/colors';
import { shipById } from '../data/ships';
import { clock, reales } from '../state/run';
import { session } from '../state/session';
import type { View } from '../render/view';
import { mapFor } from '../sim/world';
import type { GameEvent, World } from '../sim/types';
import * as A from '../audio/audio';
import { RESPAWN } from '../net/sea';
import { Watch, peek } from '../net/watch';
import type { Screen } from './screens';

const KEY = 'blackflag.watch';
const BARS = 9;               // the bar's seas a busy night can open
const TURN = 60;              // seconds on one sea before the screen turns to the next live one
const LOOK = 60;              // seconds between looks at the seas this screen is not showing
const FEED = 5;               // lines of who sank whom, at the most
const FEED_FOR = 25;          // seconds a line stays
const DAWN = 6;               // the hour the screen reloads itself, fresh for the night ahead
const AGAIN = 60;             // seconds before a screen turned away (not for its key) asks again

interface Kept { key: string; loud: boolean }

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

function kept(): Kept | null {
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o?.key ? { key: String(o.key), loud: !!o.loud } : null; } catch { return null; }
}
function keep(k: Kept | null) {
  try { if (k) localStorage.setItem(KEY, JSON.stringify(k)); else localStorage.removeItem(KEY); } catch { /* private mode: asked again next time */ }
}

/* --------------------------------------------------------------- state -- */

let root: HTMLElement | null = null;
let view: View | null = null;
let line: Watch | null = null;
let key = '';
let loud = false;
let bar = 1;
let pinned = false;           // held on one sea by a key or a chip, rather than turning
let turnedAt = 0;
const live = new Map<number, number>(); // captains aboard each of the bar's seas, as last seen
let looker: ReturnType<typeof setInterval> | null = null;
let dawn: ReturnType<typeof setTimeout> | null = null;
let feed: { html: string; at: number }[] = [];
let seen: World | null = null;            // the world the view was last handed
let rosterSeen: unknown = null;
let refused = '';                          // why the key form is up again
let lock: { release(): Promise<void> } | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;
let saidAt = 0;
const tags = new Map<number, { el: HTMLElement; text: string; w: number; h: number }>();
const qrs = new Map<string, string>();

/** Is the bar's screen up? */
export const watching = () => !!root;

/* -------------------------------------------------------------- screen -- */

export function watchScreen(v: View): Screen {
  view = v;
  const k = kept();
  return {
    html: `<div class="screen watch" id="watch">
      <div class="w-tags" id="w-tags"></div>
      <div class="w-corner" id="w-corner"></div>
      <div class="w-feed" id="w-feed"></div>
      <aside class="w-board" id="w-board"></aside>
      <div class="w-card" id="w-card"></div>
    </div>`,
    mount(el) {
      root = el;
      loud = !!k?.loud;
      session.sound = loud; A.prefs();
      if (k) start(k.key); else ask();
      addEventListener('keydown', onKey);
      addEventListener('click', onChip);
      addEventListener('pointermove', awake);
      addEventListener('pointerdown', full);
      addEventListener('resize', measure);
      document.addEventListener('visibilitychange', wake);
      awake(); void wake(); toDawn();
      looker = setInterval(look, LOOK * 1000);
      return () => watchOff();
    },
  };
}

/** Off the bar's screen, and everything it was holding. */
export function watchOff() {
  if (!root) return;
  line?.close(); line = null;
  root = null; seen = null; rosterSeen = null;
  tags.clear();
  if (looker) clearInterval(looker);
  if (dawn) clearTimeout(dawn);
  if (idle) clearTimeout(idle);
  looker = dawn = idle = null;
  removeEventListener('keydown', onKey);
  removeEventListener('click', onChip);
  removeEventListener('pointermove', awake);
  removeEventListener('pointerdown', full);
  removeEventListener('resize', measure);
  document.removeEventListener('visibilitychange', wake);
  document.body.classList.remove('w-idle');
  void lock?.release().catch(() => {}); lock = null;
}

/** The key, asked for once on this screen and kept. */
function ask() {
  const card = $('#w-card');
  if (!card) return;
  set($('#w-board'), ''); set($('#w-corner'), ''); set($('#w-feed'), '');
  const html = `
    <form class="w-key" id="w-key" autocomplete="off">
      <div class="mark">BLACK FLAG</div>
      <div class="disp">The bar's screen</div>
      <div class="sub">The whole sea, live, for the room. Say the watch key to put it up; this screen keeps it from then on.</div>
      <input name="key" type="password" placeholder="Watch key" aria-label="Watch key" autofocus>
      ${refused ? `<div class="w-err">${esc(refused)}</div>` : ''}
      <button class="cta gold" type="submit"><div><b>Watch</b><span>THE BAR'S SEA</span></div><i>→</i></button>
    </form>`;
  set(card, `<div class="w-cardin">${html}</div>`, true);
  const form = $<HTMLFormElement>('#w-key');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const k = ($<HTMLInputElement>('input', form)?.value || '').trim();
    if (k) { refused = ''; start(k); }
  });
  setTimeout(() => $<HTMLInputElement>('#w-key input')?.focus(), 50);
}

function start(k: string) {
  key = k;
  hail(bar);
}

function hail(b: number) {
  line?.close();
  bar = b; turnedAt = performance.now() / 1000;
  line = new Watch(key, b, changed);
  seen = null; rosterSeen = null;
  changed();
}

/** The line said something: the key, a roster, the round. */
function changed() {
  const L = line;
  if (!L || !root) return;
  if (L.state === 'watching' && !kept()) keep({ key, loud });
  if (L.state === 'refused' && L.why === 'key') {
    keep(null); line = null;
    refused = 'Not the key. Try it again.';
    ask();
    return;
  }
  // turned away for something else (too many screens on this sea): a TV has nobody to
  // press retry, so it asks again in a while
  if (L.state === 'refused') setTimeout(() => { if (line === L && root) hail(bar); }, AGAIN * 1000);
  live.set(L.bar, L.quiet ? 0 : L.aboard);
  draw();
}

/* --------------------------------------------------------------- frame -- */

/** Each tick: slide the sea a moment behind, hand the view its world, and play what
 *  happened. Returns the world on screen, if any. */
export function watchFrame(v: View, now: number): World | null {
  const L = line;
  if (!L) { show(v, null); return null; }
  L.frame(now);
  const w = L.quiet || L.state === 'refused' ? null : L.mirror.world;
  show(v, w);
  if (!w) return null;
  if (L.roster !== rosterSeen) {
    rosterSeen = L.roster;
    v.setMarks(new Map((L.roster?.seats ?? []).filter((s) => !s.left).map((s) => [s.id, s.c])));
  }
  if (w.weather !== v.air.look) v.setLook(w.weather);
  if (w.events.length) {
    const evs = w.events.slice();
    w.events.length = 0;
    v.consume(evs, w);
    A.listen(0, 0, v.yaw);
    A.consume(evs, () => true);
    hear(evs, L);
  }
  // a few times a second is plenty for words and numbers
  if (now - saidAt > 0.25) { saidAt = now; draw(); }
  return w;
}

/** The sea, or the harbour while nobody is aboard. */
function show(v: View, w: World | null) {
  if (w === seen && (w ? v.mode === 'watch' : v.mode === 'title')) return;
  seen = w;
  v.refloatIn = RESPAWN;
  // a card over the sea is centred on the sea; over the harbour, on the screen
  document.getElementById('watch')?.classList.toggle('on-sea', !!w);
  if (w) {
    v.setWorld(w);
    v.setLook(w.weather, true);
    v.setMode('watch');
    measure();
  } else {
    v.setWorld(null);
    v.setMap(mapFor(v.chart ?? 'nassau'));
    v.setLook('dusk');
    v.setShowcase('revenant');
    v.setMode('title');
  }
}

/** Who sank whom, who took a prize, and the Spanish worth naming, for the feed. */
function hear(evs: GameEvent[], L: Watch) {
  const who = (id: unknown) => {
    const n = id as number;
    return `<i class="dot${markOf(L.mark(n)).dashed ? ' dashed' : ''}" style="--c:${markOf(L.mark(n)).color}"></i><b>${esc(L.captain(n))}</b>`;
  };
  const at = performance.now() / 1000;
  const add = (html: string) => { feed.push({ html, at }); if (feed.length > FEED) feed.shift(); };
  for (const e of evs) {
    switch (e.k) {
      case 'toll':
        if (e.by != null) add(`${who(e.by)} sank ${who(e.p)}${(e.reales as number) > 0 ? `<em>+${reales(e.reales as number)}</em>` : ''}`);
        else add(`${who(e.p)} went down`);
        break;
      case 'board': add(`${who(e.p)} took a prize<em>+${reales(e.reales as number)}</em>`); break;
      case 'joined': add(`${who(e.p)} came aboard`); break;
      case 'legend': add(`<b class="foe">${esc(e.name)}</b> puts to sea`); break;
      case 'legend-down': add(`<b class="foe">${esc(e.name)}</b> is struck from the list`); break;
      default: break;
    }
  }
}

/* ---------------------------------------------------------------- words -- */

function draw() {
  const L = line;
  if (!root || !L) return;
  const r = L.round, stage = r?.stage ?? 'lobby';
  const cap = L.welcome?.cap ?? 30;

  // the corner over the sea: which of the bar's seas, and the chips to choose one
  const seas = [...live].filter(([, n]) => n > 0).map(([b]) => b).sort((a, b) => a - b);
  const chips = seas.length > 1 || bar > 1
    ? `<div class="w-seas">${[...new Set([...seas, bar])].sort((a, b) => a - b).map((b) =>
      `<button class="w-sea${b === bar ? ' on' : ''}" data-bar="${b}">SEA ${b}${b === bar && pinned ? ' · HELD' : ''}</button>`).join('')}</div>`
    : '';
  const w = L.mirror.world;
  const weather = w && !L.quiet && stage === 'sailing'
    ? `<div class="w-wave">${w.plan.boss ? 'A LEGEND AT SEA' : `WAVE ${w.wave}`}${w.weather === 'storm' ? ' · STORM' : w.weather === 'fog' ? ' · FOG' : ''}</div>` : '';
  set($('#w-corner'), L.state === 'watching' ? `${chips}${weather}` : '');

  // the card over the sea: what the round is doing, or why there is no sea. The lobby's
  // sits low, over open water: the fleet it counts down is forming up in the middle.
  let card = '', low = false;
  if (L.state === 'hailing') card = `<div class="eyebrow">The bar's sea${bar > 1 ? ` ${bar}` : ''}</div><div class="disp">Hailing the sea…</div>`;
  else if (L.state === 'lost') card = `<div class="eyebrow">Lost the wind</div><div class="disp">Coming about…</div>`;
  else if (L.state === 'refused') card = `<div class="eyebrow">The sea is out of reach</div><div class="disp">${L.why === 'full' ? 'Too many screens' : L.why === 'bad' ? 'No seas on this site' : 'Not tonight'}</div>`;
  else if (L.quiet) card = `<div class="eyebrow">The bar's sea${bar > 1 ? ` ${bar}` : ''} is quiet</div><div class="disp">Who puts to sea first?</div>
      <div class="w-qr big">${qr(joinUrl())}</div><div class="w-scan">Scan to come aboard · <b>${esc(joinHost())}</b></div>`;
  else if (r && stage === 'lobby') {
    low = true;
    card = `<div><div class="eyebrow">Round ${r.n + 1} · coming aboard</div><div class="disp">Puts to sea in</div></div><div class="w-count">${r.left}</div>`;
  }
  else if (r && stage === 'results') {
    const top = r.scores[0];
    card = top ? `<div class="eyebrow">Round ${r.n} · over</div>${named(top.id, L)}<div class="disp">takes it</div>
      <div class="w-prize">${reales(top.plunder)} <span>REALES</span></div><div class="w-next">Next round in ${r.left}</div>` : '';
  }
  set($('#w-card'), card ? `<div class="w-cardin${low ? ' low' : ''}">${card}</div>` : '', true);

  // the standings, live
  let board = '';
  if (L.state === 'watching' && !L.quiet && r) {
    const mode = r.mode === 'rivals' ? 'RIVALS' : 'CREW';
    const head = `<div class="w-brand"><div class="mark">BLACK FLAG</div><div class="eyebrow">The bar's sea${bar > 1 ? ` ${bar}` : ''} · ${mode}</div></div>
      <div class="w-round"><div class="disp">${stage === 'lobby' ? `Round ${r.n + 1}` : `Round ${r.n}`}</div>
      <div class="w-clock">${stage === 'sailing' ? clock(r.left) : stage === 'lobby' ? `0:${String(r.left).padStart(2, '0')}` : 'OVER'}</div></div>`;
    const rows = r.scores;
    const fit = Math.max(4, Math.floor((innerHeight * 0.56) / Math.max(30, innerHeight * 0.043)));
    const shown = rows.slice(0, rows.length > fit ? fit - 1 : fit);
    const list = shown.map((s, i) => `<div class="w-row${i === 0 && stage !== 'lobby' && s.plunder > 0 ? ' first' : ''}">
        <span class="k">${stage === 'lobby' ? '·' : i + 1}</span>${swatch(L.mark(s.id))}
        <span class="c">${esc(s.captain)}<small>${esc(shipById(s.ship).name)}</small></span>
        <span class="v">${stage === 'lobby' ? '' : reales(s.plunder)}</span></div>`).join('');
    const more = rows.length - shown.length;
    board = `${head}<div class="eyebrow w-label">${stage === 'lobby' ? 'Coming aboard' : stage === 'results' ? 'Final standings' : 'Standings · reales'}</div>
      <div class="w-rows">${list}${more > 0 ? `<div class="w-more">and ${more} more aboard</div>` : ''}</div>
      <div class="w-join">${L.aboard >= cap ? '<div class="w-scan">This sea is full · the next is open</div>' : ''}
        <div class="w-qr">${qr(joinUrl())}</div><div class="w-scan">Scan to come aboard<br><b>${esc(joinHost())}</b></div></div>`;
  }
  set($('#w-board'), board, true);

  // who sank whom
  const now = performance.now() / 1000;
  feed = feed.filter((f) => now - f.at < FEED_FOR);
  set($('#w-feed'), L.quiet ? '' : feed.map((f) => `<div class="w-line">${f.html}</div>`).join(''));

  // a busy night's seas: on to the next live one after a while, unless held
  if (!pinned && L.state === 'watching' && now - turnedAt > TURN) {
    const others = seas.filter((b) => b !== bar);
    const next = L.quiet ? others[0] : others.find((b) => b > bar) ?? others[0];
    if (next) hail(next);
    else turnedAt = now;
  }
}

/** A captain's name in her mark, for the results card. */
function named(id: number, L: Watch) {
  const m = markOf(L.mark(id));
  return `<div class="w-who"><i class="dot${m.dashed ? ' dashed' : ''}" style="--c:${m.color}"></i>${esc(L.captain(id))}</div>`;
}

function swatch(c: number) {
  const m = markOf(c);
  return `<i class="dot${m.dashed ? ' dashed' : ''}" style="--c:${m.color}"></i>`;
}

/* ---------------------------------------------------------------- names -- */

/**
 * Each paint: every captain's name over her ring, in her mark. Placed leader first, each
 * above her ring if it is free, else below, right or left of it; with no room anywhere it
 * shrinks to her initials. The standings' column and the corners are kept clear.
 */
export function watchPaint(v: View) {
  const host = $('#w-tags'), L = line, w = seen;
  if (!host || !L || !w || v.mode !== 'watch') { if (host && host.childElementCount) { host.innerHTML = ''; tags.clear(); } return; }
  const order = new Map((L.round?.scores ?? []).map((s, i) => [s.id, i]));
  const ships = w.players.filter((p) => !p.left).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const mpp = v.metresPerPixel();
  const W = innerWidth, H = innerHeight, right = W * (1 - v.watchRoom);
  const placed: [number, number, number, number][] = [];
  const free = (x: number, y: number, w2: number, h2: number) => x >= 4 && y >= 4 && x + w2 <= right - 8 && y + h2 <= H - 4
    && placed.every(([a, b, c, d]) => x + w2 <= a || a + c <= x || y + h2 <= b || b + d <= y);
  const keepIds = new Set<number>();
  for (const o of ships) {
    const p = v.project(o.x, 0, o.y);
    let t = tags.get(o.id);
    if (!p || !p.on) { if (t) t.el.style.display = 'none'; continue; }
    keepIds.add(o.id);
    const name = L.captain(o.id), m = markOf(L.mark(o.id));
    const text = `${m.color}|${m.dashed}|${name}`;
    if (!t) { const el = document.createElement('div'); host.appendChild(el); t = { el, text: '', w: 0, h: 0 }; tags.set(o.id, t); }
    if (t.text !== text) {
      t.text = text;
      t.el.className = 'w-tag';
      t.el.style.setProperty('--c', m.color);
      t.el.innerHTML = `<i class="dot${m.dashed ? ' dashed' : ''}"></i><b>${esc(name)}</b><s>${esc(initials(name))}</s>`;
      t.el.style.display = '';
      t.w = t.el.offsetWidth; t.h = t.el.offsetHeight;
    }
    t.el.style.display = '';
    t.el.classList.toggle('down', o.out);
    const rp = v.ringOf(o) / mpp, gap = 4;
    const spots: [number, number][] = [
      [p.x - t.w / 2, p.y - rp - gap - t.h], [p.x - t.w / 2, p.y + rp + gap],
      [p.x + rp + gap, p.y - t.h / 2], [p.x - rp - gap - t.w, p.y - t.h / 2],
    ];
    const spot = spots.find(([x, y]) => free(x, y, t!.w, t!.h));
    if (spot) {
      t.el.classList.remove('short');
      placed.push([spot[0], spot[1], t.w, t.h]);
      t.el.style.transform = `translate(${Math.round(spot[0])}px,${Math.round(spot[1])}px)`;
    } else {
      // her initials, as small as they come, wherever there is room round her ring. In a
      // fleet bunched too tight even for those (the lines off the harbour mouth), she goes
      // unnamed for the moment: her ring is on the water and her name in the standings.
      t.el.classList.add('short');
      const sw = t.h * 1.7;
      const short: [number, number][] = [
        [p.x - sw / 2, p.y - rp - gap - t.h], [p.x - sw / 2, p.y + rp + gap],
        [p.x + rp + gap, p.y - t.h / 2], [p.x - rp - gap - sw, p.y - t.h / 2],
      ];
      const at = short.find(([sx, sy]) => free(sx, sy, sw, t!.h));
      if (!at) { t.el.style.display = 'none'; continue; }
      placed.push([at[0], at[1], sw, t.h]);
      t.el.style.transform = `translate(${Math.round(at[0])}px,${Math.round(at[1])}px)`;
    }
  }
  for (const [id, t] of tags) if (!keepIds.has(id)) { t.el.remove(); tags.delete(id); }
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

/* ------------------------------------------------------------- the room -- */

/** 1–9 hold the screen on that sea, 0 lets it turn again; F for full screen; S for sound. */
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest?.('input')) return;
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(k) && line) { pinned = true; if (Number(k) !== bar) hail(Number(k)); else draw(); }
  else if (k === '0') { pinned = false; turnedAt = performance.now() / 1000; draw(); }
  else if (k === 'f') full();
  else if (k === 's') {
    loud = !loud;
    session.sound = loud;
    A.unlock(); A.prefs();
    if (key && kept()) keep({ key, loud });
  }
}

/** A sea's chip: hold the screen on that sea, or, on the one already held, let it turn. */
function onChip(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bar]');
  if (!b || !line) return;
  const n = Number(b.dataset.bar);
  if (n === bar) { pinned = !pinned; turnedAt = performance.now() / 1000; draw(); } else { pinned = true; hail(n); }
}

/** Look at the seas this screen is not showing: the next one along only while this one is
 *  full, or while it had captains when last seen. On a quiet night, never. */
async function look() {
  if (!line || !key) return;
  const cap = line.welcome?.cap ?? 30;
  for (let b = 1; b <= BARS; b++) {
    if (b === bar) continue;
    const want = b === 1 || (live.get(b - 1) ?? 0) >= cap || (live.get(b) ?? 0) > 0;
    if (!want) break;
    const n = await peek(key, b);
    if (n >= 0) live.set(b, n);
  }
  // nobody left on this one, and someone on another: go there
  if (line?.quiet && !pinned) { const other = [...live].find(([b, n]) => b !== bar && n > 0); if (other) hail(other[0]); }
  draw();
}

function full() {
  if (document.fullscreenElement || !document.fullscreenEnabled) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

/** The pointer goes when it stops moving. */
function awake() {
  document.body.classList.remove('w-idle');
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('w-idle'), 3000);
}

/** Keep the screen from sleeping, and ask again whenever the page comes back to the front. */
async function wake() {
  if (document.hidden || !root) return;
  try { lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed: the TV's own settings will have to do */ }
}

/** Once a night, at dawn, the page starts again: nothing a night left behind lasts. */
function toDawn() {
  const now = new Date(), at = new Date(now);
  at.setHours(DAWN, 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  dawn = setTimeout(() => location.reload(), at.getTime() - now.getTime());
}

/** The standings' column takes its share of the screen; the sea is framed in the rest. */
function measure() {
  const b = $('#w-board');
  if (!view || !b) return;
  const share = b.childElementCount ? b.getBoundingClientRect().width / innerWidth : 0.3;
  view.watchRoom = Math.round(Math.max(0.2, Math.min(0.42, share)) * 100) / 100;
}

/* ---------------------------------------------------------------- bits -- */

const joinUrl = () => `${location.origin}/`;
const joinHost = () => location.host;

/** A QR code to the game, drawn once a URL and kept. The library comes in its own chunk,
 *  so the game itself never pays for it. */
function qr(url: string): string {
  const got = qrs.get(url);
  if (got !== undefined) return got;
  qrs.set(url, '');
  import('qrcode').then((Q) => Q.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0A1C24', light: '#F2E7CE' } }))
    .then((svg) => { qrs.set(url, svg); draw(); })
    .catch(() => {});
  return '';
}

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;

/** Write into an element only when what it says has changed. */
function set(el: HTMLElement | null, html: string, show = false) {
  if (!el || el.dataset.h === html) return;
  el.innerHTML = html; el.dataset.h = html;
  if (show) el.classList.toggle('on', !!html);
  if (el.id === 'w-board') measure();
}
