// The bar's screen (/watch): the bar's sea as a chart on the TV, and down its side who is
// on a streak, what just happened, and a code to scan to play. Opened with the watch key
// the sea's server holds; nothing in the game leads here, and it never signs in.
//
// It runs unattended all night: it keeps the screen awake, hides the pointer, comes back
// after a wifi blink or a deploy on its own, and reloads itself once at dawn. On a busy
// night it turns between the bar's seas; 1–9 hold it on one, 0 lets it turn again, F is
// full screen.

import './watch.css';
import { markOf } from '../data/colors';
import { mapFor } from '../sim/world';
import type { GameEvent } from '../sim/types';
import { feedLine, standings, type Standing } from './board';
import { Chart } from './chart';
import { Watch, peek } from './line';

const KEY = 'blackflag.watch';
const BARS = 9;               // the bar's seas a busy night can open
const TURN = 60;              // seconds on one sea before the screen turns to the next live one
const LOOK = 60;              // seconds between looks at the seas this screen is not showing
const FEED = 6;               // lines of what happened, at the most
const FEED_FOR = 30;          // seconds a line stays
const BANNER_FOR = 7;         // seconds a free shot won is said across the chart
const DAWN = 6;               // the hour the screen reloads itself, fresh for the night ahead
const AGAIN = 60;             // seconds before a screen turned away (not for its key) asks again
const SKULL = '☠';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

function kept(): string {
  try { return String(JSON.parse(localStorage.getItem(KEY) || 'null')?.key ?? ''); } catch { return ''; }
}
function keep(k: string) {
  try { if (k) localStorage.setItem(KEY, JSON.stringify({ key: k })); else localStorage.removeItem(KEY); } catch { /* private mode: asked again next time */ }
}

/* --------------------------------------------------------------- state -- */

const chart = new Chart($<HTMLCanvasElement>('#chart')!);
const harbour = mapFor('harbour');    // drawn until a sea has a chart of its own
let line: Watch | null = null;
let key = '';
let bar = 1;
let pinned = false;
let turnedAt = 0;
const live = new Map<number, number>(); // captains aboard each of the bar's seas, as last seen
let feed: { html: string; at: number }[] = [];
let refused = '';
let saidAt = 0;
let last = performance.now() / 1000;
const qrs = new Map<string, string>();

/* ----------------------------------------------------------------- key -- */

function ask() {
  set($('#panel'), ''); set($('#corner'), '');
  set($('#card'), `<div class="in">
    <form class="key" id="key" autocomplete="off">
      <div class="logo">Black <span>Flag</span></div>
      <div class="sub">The bar's screen. Say the watch key to put the sea up; this screen keeps it from then on.</div>
      <input name="key" type="password" placeholder="Watch key" aria-label="Watch key">
      ${refused ? `<div class="err">${esc(refused)}</div>` : ''}
      <button class="cta" type="submit">Watch</button>
    </form></div>`, true);
  const form = $<HTMLFormElement>('#key')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const k = (form.querySelector('input')!.value || '').trim();
    if (k) { refused = ''; key = k; hail(bar); }
  });
  setTimeout(() => form.querySelector('input')?.focus(), 50);
}

function hail(b: number) {
  line?.close();
  bar = b; turnedAt = performance.now() / 1000;
  line = new Watch(key, b, changed);
  changed();
}

/** The line said something: welcome, a roster, or no. */
function changed() {
  const L = line;
  if (!L) return;
  if (L.state === 'watching' && kept() !== key) keep(key);
  if (L.state === 'refused' && L.why === 'key') {
    keep(''); line = null; key = '';
    refused = 'Not the key. Try it again.';
    ask();
    return;
  }
  // turned away for something else (too many screens on this sea): a TV has nobody to
  // press retry, so it asks again in a while
  if (L.state === 'refused') setTimeout(() => { if (line === L) hail(bar); }, AGAIN * 1000);
  if (L.state === 'watching') live.set(L.bar, L.aboard);
  draw();
}

/* --------------------------------------------------------------- frame -- */

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last);
  last = now;
  const L = line;
  if (L) L.frame(now);
  const w = L && L.state === 'watching' ? L.mirror.world : null;
  const seats = L?.mirror.seats ?? [];
  const quiet = !L || L.quiet;
  if (w?.events.length) {
    const evs = w.events.splice(0);
    if (!quiet) { chart.hear(evs, w, seats); hear(evs); }
  }
  chart.draw(w, w?.map ?? harbour, seats, dt, quiet);
  // a few times a second is plenty for words and numbers
  if (now - saidAt > 0.25) { saidAt = now; draw(); }
}

function hear(evs: GameEvent[]) {
  const L = line!;
  const now = performance.now() / 1000;
  for (const e of evs) {
    const said = feedLine(e, L.mirror.seats);
    if (!said) continue;
    feed.unshift({ html: said.html, at: now });
    if (feed.length > FEED) feed.pop();
    if (said.big) banner(said.big, !!e.prize);
  }
}

/** A win, said across the top of the chart for the room. */
function banner(text: string, prize: boolean) {
  const el = $('#banner');
  if (!el) return;
  el.innerHTML = `<div class="big">${prize ? '🥃 ' : ''}${esc(text)}</div>
    <div class="small">${prize ? 'Five in a row on a Black Flag ticket' : 'With a Black Flag, that\'s a free shot'}</div>`;
  el.classList.remove('on', 'gold');
  void el.offsetWidth;
  el.classList.add('on');
  el.classList.toggle('gold', prize);
  clearTimeout(bannerT);
  bannerT = setTimeout(() => el.classList.remove('on'), BANNER_FOR * 1000);
}
let bannerT: ReturnType<typeof setTimeout> | undefined;

/* --------------------------------------------------------------- words -- */

function draw() {
  const L = line;
  if (!L) return;
  const now = performance.now() / 1000;

  // the corner: which of the bar's seas, when more than one has captains
  const seas = [...live].filter(([, n]) => n > 0).map(([b]) => b);
  const shown = [...new Set([...seas, bar])].sort((a, b) => a - b);
  set($('#corner'), L.state === 'watching' && (seas.length > 1 || bar > 1)
    ? shown.map((b) => `<button class="sea${b === bar ? ' on' : ''}" data-bar="${b}">SEA ${b}${b === bar && pinned ? ' · HELD' : ''}</button>`).join('')
    : '');

  // the card over the chart: why there is no sea, or a quiet sea's call to come aboard
  let card = '';
  if (L.state === 'hailing') card = `<div class="eyebrow">The bar's sea${bar > 1 ? ` ${bar}` : ''}</div><div class="disp">Finding the sea…</div>`;
  else if (L.state === 'lost') card = `<div class="eyebrow">Lost the sea</div><div class="disp">Coming back…</div>`;
  else if (L.state === 'refused') card = `<div class="eyebrow">The sea is out of reach</div><div class="disp">${L.why === 'full' ? 'Too many screens' : L.why === 'bad' ? 'No seas on this site' : 'Not tonight'}</div>`;
  else if (L.quiet) card = `<div class="eyebrow">The sea is quiet</div><div class="disp">Who sets sail first?</div>
      <div class="qr big">${qr(joinUrl())}</div>
      <div class="cta-line">Order a <b>Black Flag</b> to play for a free shot</div>
      <div class="scan">or scan to practise · <b>${esc(location.host)}</b></div>`;
  set($('#card'), card ? `<div class="in">${card}</div>` : '', true);

  // down the side
  const w = L.mirror.world;
  const top = L.state === 'watching' && !L.quiet ? standings(w, L.mirror.seats) : [];
  feed = feed.filter((f) => now - f.at < FEED_FOR);
  const busy = L.state === 'watching' && !L.quiet;
  set($('#panel'), `
    <div class="brand"><div class="logo">Black <span>Flag</span></div>
      <div class="eyebrow"><i class="live"></i>The bar's sea${bar > 1 ? ` ${bar}` : ''} · live</div></div>
    <div class="rule">Sink <b>5 ships in a row</b> without going down to win a <b>free shot</b> 🥃</div>
    ${L.state === 'watching' && L.quiet ? `<section><h3>How it works</h3><ol class="how">
      <li><span>Order a <b>Black Flag</b> at the bar</span></li>
      <li><span>Tap the card it comes with on your phone</span></li>
      <li><span>Sink <b>5 in a row</b> on the TV's sea</span></li>
      <li><span>Show the bartender your <b>free shot</b></span></li></ol></section>` : ''}
    ${busy ? `<section class="streaks"><h3>On a streak</h3>${top.length ? top.map(row).join('') : '<div class="none">Nobody yet. Who\'s first?</div>'}</section>` : ''}
    ${busy && feed.length ? `<section class="feed"><h3>Just now</h3>${feed.map((f) => `<div class="line">${f.html}</div>`).join('')}</section>` : ''}
    ${busy ? `<div class="join"><div class="qr">${qr(joinUrl())}</div>
      <div><div class="cta-line">Order a <b>Black Flag</b> to play for a free shot</div>
      <div class="scan">or scan to practise<br><b>${esc(location.host)}</b></div></div></div>` : ''}`, true);
  chart.room = $('#panel')?.getBoundingClientRect().width ?? 0;

  // a busy night's seas: on to the next live one after a while, unless held
  if (!pinned && L.state === 'watching' && now - turnedAt > TURN) {
    const others = seas.filter((b) => b !== bar).sort((a, b) => a - b);
    const next = L.quiet ? others[0] : others.find((b) => b > bar) ?? others[0];
    if (next) hail(next);
    else turnedAt = now;
  }
}

function row(s: Standing) {
  const skulls = `<span class="sk">${SKULL.repeat(s.streak)}</span><span class="sk off">${SKULL.repeat(Math.max(0, 5 - s.streak))}</span>`;
  return `<div class="row${s.wanted ? ' wanted' : ''}"><i class="dot${markOf(s.c).dashed ? ' dashed' : ''}" style="--c:${markOf(s.c).color}"></i>
    <span class="who">${esc(s.name)}</span>${s.wanted ? '<span class="tag">WANTED</span>' : ''}<span class="skulls">${skulls}</span></div>`;
}

/* ------------------------------------------------------------- the room -- */

/** 1–9 hold the screen on that sea, 0 lets it turn again; F for full screen. */
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input')) return;
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(k) && line) { pinned = true; if (Number(k) !== bar) hail(Number(k)); else draw(); }
  else if (k === '0') { pinned = false; turnedAt = performance.now() / 1000; draw(); }
  else if (k === 'f') full();
});

/** A sea's button: hold the screen on that sea, or, on the one already held, let it turn. */
addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bar]');
  if (!b || !line) return;
  const n = Number(b.dataset.bar);
  if (n === bar) { pinned = !pinned; turnedAt = performance.now() / 1000; draw(); } else { pinned = true; hail(n); }
});

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
let idle: ReturnType<typeof setTimeout> | undefined;
function awake() {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 3000);
}

/** Keep the screen from sleeping, and ask again whenever the page comes back to the front. */
async function wake() {
  if (document.hidden) return;
  try { await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* not allowed: the TV's own settings will have to do */ }
}

/** Once a night, at dawn, the page starts again: nothing a night left behind lasts. */
function toDawn() {
  const now = new Date(), at = new Date(now);
  at.setHours(DAWN, 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  setTimeout(() => location.reload(), at.getTime() - now.getTime());
}

/* ---------------------------------------------------------------- bits -- */

/** The game, for practice: a scan of the TV is not a ticket. */
const joinUrl = () => `${location.origin}/`;

/** A QR code to the game, drawn once and kept. The library comes in its own chunk. */
function qr(url: string): string {
  const got = qrs.get(url);
  if (got !== undefined) return got;
  qrs.set(url, '');
  import('qrcode').then((Q) => Q.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#10233F', light: '#FFFFFF' } }))
    .then((svg) => { qrs.set(url, svg); draw(); })
    .catch(() => {});
  return '';
}

/** Write into an element only when what it says has changed. */
function set(el: HTMLElement | null, html: string, show = false) {
  if (!el || el.dataset.h === html) return;
  el.innerHTML = html; el.dataset.h = html;
  if (show) el.classList.toggle('on', !!html.trim());
}

/* ---------------------------------------------------------------- boot -- */

addEventListener('resize', () => chart.resize());
addEventListener('pointermove', awake);
addEventListener('pointerdown', full);
document.addEventListener('visibilitychange', () => { void wake(); });
awake(); void wake(); toDawn();
setInterval(() => { void look(); }, LOOK * 1000);
key = kept();
if (key) hail(bar); else ask();
// the fonts come from Google: draw the chart's names again once they are in
void document.fonts?.ready.then(() => chart.resize());
requestAnimationFrame(frame);
