// Boot, the screens, the line to the sea, and the frame clock.
//
// The phone never steps the sea: the server does (server/, src/net/sea.ts). This device
// sends its hands and draws the Mirror the Link keeps of the world, a moment behind.

import './ui/app.css';
import { session, save } from './state/session';
import { mapFor } from './sim/world';
import type { World } from './sim/types';
import { View } from './render/view';
import * as A from './audio/audio';
import * as S from './ui/screens';
import * as P from './ui/prize';
import { hudEvents, hudState, hudTick } from './ui/hud';
import * as Input from './ui/input';
import { buzz } from './ui/haptics';
import { connect, count, credentials, me, refresh, tap } from './net/cloud';
import { Link } from './net/link';
import { inkOn } from './render/ink';

const ui = document.getElementById('ui')!;
const app = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;

let view: View;
try {
  view = new View(canvas);
} catch (err) {
  // No WebGL 2 (an old or blocklisted GPU, iOS Lockdown Mode): say so, rather than leave
  // the boot card up for ever.
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div class="nogl"><div class="logo">Black <span>Flag</span></div>
    <p>This browser can't draw the sea: it needs WebGL 2, which is switched off or not supported here. Try another browser, or turn off Lockdown Mode.</p></div>`;
  throw err;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
view.setReduced(reduced());
// the name screen's sea: the bar's chart, as it would be with nobody on it
view.setMap(mapFor('harbour'));

/** The line to the sea, while the sea is on screen. Its mirror is the world. */
let link: Link | null = null;
let world: World | null = null;
/** The phone went to sleep at sea: it comes back aboard when it wakes. */
let dozed = false;
const upright = matchMedia('(orientation: portrait) and (pointer: coarse)');

/* ---------------------------------------------------------------- input -- */

const atSea = () => path() === '/sea';
Input.attachKeys(() => { if (atSea()) ashore(); }, () => A.unlock());
Input.attachMouse(app, atSea, (x, y) => {
  const me = world?.ships[world.focus], p = view.seaAt(x, y);
  return me && p ? Math.atan2(p.y - me.y, p.x - me.x) : null;
});
// Sound may only start from a gesture, and on glass a touch becomes one when it lifts.
for (const k of ['pointerdown', 'pointerup', 'touchend', 'click'] as const) addEventListener(k, () => A.unlock(), { capture: true, passive: true });
// The page never zooms: iOS lets a pinch or a double tap zoom it whatever the viewport
// says, and a quick double tap on the right stick zoomed the whole sea.
for (const k of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(k, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let tapped = -1e9;
document.addEventListener('touchend', (e) => {
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.timeStamp - tapped < 350 && !typing && e.cancelable) e.preventDefault();
  tapped = e.timeStamp;
}, { passive: false });

/* ------------------------------------------------------------- the sea -- */

/**
 * On a phone that allows it, the sea takes the whole screen and stays sideways. Asked
 * from the tap that sets sail, because a browser only says yes to a tap. iPhones allow no
 * such thing for a page; Add to Home Screen is theirs.
 */
function takeScreen() {
  if (!Input.touchUi() || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => { /* refused, or no lock on this browser: the page still plays */ });
}

function aboard() {
  link?.close();
  Input.reset();
  const L = new Link(credentials(), session.name, session.look, () => linkChanged(L));
  link = L;
}

window.addEventListener('bf:sail', () => {
  takeScreen();
  aboard();
  go('/sea');
});

/** Leave the sea: the Leave button, Escape, or the back gesture. To the name screen, or
 *  (`to`) another. */
function ashore(to = '/') {
  if (link) { link.close(); link = null; }
  world = null; view.setWorld(null);
  A.stopShanty();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (atSea()) go(to, true);
}

function act(what: string) {
  buzz(6); A.click();
  if (what === 'leave') ashore();
  // a sign-in that failed is started over with a fresh line; a sea not reached, hailed again
  else if (what === 'again') { if (link?.why === 'token') { aboard(); linkChanged(link!); } else link?.again(); }
  else if (what === 'prize') ashore('/prize');
}

const WHY: Record<string, [string, string]> = {
  full: ['Every sea is full', 'Try again in a minute.'],
  token: ['Can\'t reach the server', 'Check the wifi, or switch to mobile data, and try again.'],
  version: ['A new version is out', 'Reload the page to sail.'],
  name: ['Pick another name', 'That one can\'t go up on the TV.'],
  server: ['The sea isn\'t answering', 'Check the wifi and try again.'],
  reach: ['Can\'t reach the sea', 'This connection may be blocking it. Switch between wifi and mobile data, and try again.'],
};

/** The lines the bar has heard say they were aboard, or turned away. */
const counted = new WeakSet<Link>();

/** The line changed: say so on the HUD. */
function linkChanged(L: Link) {
  if (!counted.has(L) && (L.state === 'aboard' || L.state === 'refused')) {
    counted.add(L);
    if (L.state === 'aboard') count('sail', { sea: L.welcome?.code });
    else count('turned_away', { why: L.why });
  }
  if (L !== link || !atSea()) return;
  if (L.state === 'aboard') hudState(null);
  else if (L.state === 'hailing') hudState('Finding the sea…');
  else if (L.state === 'lost') hudState('Lost the sea', 'Coming back…');
  else {
    const [big, sub] = WHY[L.why ?? ''] ?? ['Turned away', ''];
    hudState(big, sub, L.why === 'server' || L.why === 'reach' || L.why === 'token');
  }
  if (L.why === 'name') { ashore(); }
  if (L.roster) view.setColors(colorsOf(L));
}

const colorsOf = (L: Link) => {
  const out: number[] = [];
  for (const s of L.mirror.seats) out[s.id] = s.c;
  return out;
};

/* --------------------------------------------------------------- routes -- */

const path = () => (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';
let teardown: (() => void) | null = null;

function go(to: string, replace = false) {
  if (replace) { const u = new URL(location.href); u.hash = to; location.replace(u.href); } else location.hash = `#${to}`;
}

/** A screen drawn before the server said who this phone is: drawn again when it does. */
let waitingForMe = false;

function screenFor(p: string) {
  if (p === '/sea') return S.sea(view, act);
  if (p === '/prize' || p === '/prize/signin') return P.prize(p.endsWith('signin'));
  const pour = p.match(/^\/redeem\/(\d+)$/);
  if (pour) return P.redeem(Number(pour[1]));
  if (p === '/privacy') return P.privacy();
  return S.name(view);
}

function render() {
  const p = path();
  if (p === '/sea' && !link) { go('/', true); return; }
  if (p !== '/sea' && link) ashore();
  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }
  waitingForMe = !me && (p.startsWith('/prize') || p.startsWith('/redeem'));
  if (p !== '/sea' && p !== '/') view.setMode('show');
  const out = screenFor(p);
  ui.innerHTML = out.html;
  const root = (ui.firstElementChild as HTMLElement) || ui;
  if (out.mount) teardown = out.mount(root) || null;
  document.documentElement.classList.toggle('at-sea', p === '/sea');
  if (p === '/sea' && link) { linkChanged(link); A.startShanty(); } else A.stopShanty();
}
window.addEventListener('hashchange', render);
window.addEventListener('bf:me', () => { if (waitingForMe) render(); });

// Locking the phone is leaving: the sea docks her (or leaves her on the water a while, in
// a fight) as it would for the Leave button. She comes back aboard when the phone wakes.
document.addEventListener('visibilitychange', () => {
  A.hush(document.hidden);
  if (document.hidden && link) {
    link.close(); link = null;
    world = null; view.setWorld(null);
    dozed = true;
  } else if (!document.hidden && dozed) {
    dozed = false;
    if (atSea()) { aboard(); linkChanged(link!); }
  }
});

new ResizeObserver(() => view.resize()).observe(canvas);
addEventListener('resize', () => view.resize());
window.addEventListener('bf:touch', () => { if (atSea()) render(); });

/* ---------------------------------------------------------------- clock -- */

// Paint at most 60 a second (a 120Hz phone would spend twice the battery on the same
// picture), and at most 30 behind the name screen. A frame counts as due a little early
// and the remainder carries: Safari's clock reads whole milliseconds, and a cap set at
// exactly 60 skipped every few frames on a 60Hz iPhone.
const PAINT_HZ = 60, IDLE_HZ = 30;
let sincePaint = 0, pace = 0, last = -1;

// `?fps` on the address shows how long frames take, to measure on a phone at the bar:
// the time between pictures (what the eye gets), the time this code spends on one (what
// the phone's CPU spends), how many pixels per CSS pixel the governor has left it, and
// the draws. `?plain` draws without outlines, to see what they cost.
const query = new URLSearchParams(location.search);
if (query.has('plain')) inkOn(false);
const meter = query.has('fps') ? meterOn() : null;

function meterOn() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 7px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:11px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
  const gaps: number[] = [], cpu: number[] = [];
  let at = 0, shown = 0;
  return {
    paint(now: number, spent: number) {
      if (at) gaps.push(now - at);
      at = now;
      cpu.push(spent);
      if (now - shown < 0.5 || gaps.length < 5) return;
      shown = now;
      const ms = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] * 1000;
      const med = ms(gaps, 0.5), worst = ms(gaps, 0.95), info = view.info().render;
      el.textContent = `${(1000 / med).toFixed(0)} fps  ${med.toFixed(1)} ms  worst ${worst.toFixed(1)}\n`
        + `cpu ${ms(cpu, 0.5).toFixed(1)} ms  ×${view.pixelRatio.toFixed(2)} px  ${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris${query.has('plain') ? '  plain' : ''}`;
      gaps.length = 0; cpu.length = 0;
    },
  };
}

function frame(ms: number) {
  requestAnimationFrame(frame);
  const now = ms / 1000;
  const dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, now - last));
  last = now;
  tick(dt);
}

function due(dt: number, hz: number): boolean {
  sincePaint += dt;
  pace += dt;
  const step = 1 / hz;
  if (pace < step * 0.75) return false;
  pace = Math.min(Math.max(0, pace - step), step * 0.5);
  return true;
}

function tick(dt: number) {
  const now = performance.now() / 1000;
  const begun = performance.now();
  const L = link;
  if (L) {
    // the hands first, so your own ship is stepped on before the sea is drawn
    const w0 = L.mirror.world, me0 = w0?.ships[w0.focus];
    if (w0) L.helm(me0 && !me0.out && !upright.matches ? Input.read() : { move: null, fire: null, auto: false }, now);
    L.frame(now);
    const w = L.mirror.world;
    if (w !== world) { world = w; view.setWorld(w); if (L.roster) view.setColors(colorsOf(L)); }
    if (w) {
      const me = w.ships[w.focus];
      view.aim = Input.aiming();
      view.aimDry = !!me && me.ammo < 1;
      if (me) { A.listen(me.x, me.y); A.setHeat(me.streak); }
      if (w.events.length) {
        const evs = w.events.slice();
        w.events.length = 0;
        view.consume(evs, w);
        A.consume(evs, (e) => e.p === w.focus);
        hudEvents(evs, w, L.mirror.seats);
        for (const e of evs) {
          if (e.p !== w.focus) continue;
          if (e.k === 'hit' || e.k === 'sunk') buzz(e.k === 'sunk' ? 80 : 25);
          if (e.k === 'streak' && !firstSink) { firstSink = true; count('first_sink'); }
          // the sea writes the win down a moment after: ask then what it came to
          if (e.k === 'won') { buzz(200); for (const ms of [2000, 6000]) setTimeout(() => { void refresh().catch(() => {}); }, ms); }
        }
      }
    }
  }
  if (upright.matches && atSea()) { sincePaint += dt; return; }
  if (!due(dt, atSea() ? PAINT_HZ : IDLE_HZ)) return;
  const d = Math.min(sincePaint, 0.1);
  view.frame(d, atSea());
  hudTick(world, L?.mirror.seats ?? [], view, d, (look) => view.heightOf(look));
  sincePaint = 0;
  meter?.paint(now, (performance.now() - begun) / 1000);
}

/** The first ship this phone sank since the page opened has been counted. */
let firstSink = false;

/* ----------------------------------------------------------------- boot -- */

// The Black Flag tag at the bar opens /u/BLACKFLAG?src=nfc, and the QR code on its back
// /u/BLACKFLAG. Vercel rewrites that to the game; the tap is sent, and the address put
// back to the plain site, so a reload does not tap again.
const tag = location.pathname.match(/^\/u\/([^/?#]+)/);
if (tag) {
  const via = new URLSearchParams(location.search).get('src') === 'nfc' ? 'nfc' : 'link';
  history.replaceState(null, '', `/${location.search.includes('fps') ? '?fps' : ''}#/`);
  tap(decodeURIComponent(tag[1]), via).then((t) => {
    if (t === 'new') P.tell('🎟 Here\'s your ticket! Sink 5 in a row for a free shot.');
    else if (t === 'open') P.tell('You already have a ticket waiting: go and win it!');
    else if (t === 'spent') P.tell('Tonight\'s ticket has been won already. It\'s one a night: come back tomorrow!');
  }, (err) => { console.warn('[tap]', err); P.tell('Couldn\'t reach the server for your ticket. Check the wifi and tap again.'); });
}

if (!location.hash) location.hash = '#/';
render();
requestAnimationFrame(frame);
requestAnimationFrame(() => setTimeout(() => document.getElementById('boot')?.classList.add('gone'), 250));
// The model files come after the first screen is up, and the server after them.
setTimeout(() => { void view.loadModels(); }, 100);
setTimeout(() => { void connect(); }, 800);
save();

// For poking at from the console, and for the browser checks.
(window as unknown as { bf: unknown }).bf = {
  view, session,
  get world() { return world; },
  get link() { return link; },
  /** Drive the clock by hand: for a background tab, where requestAnimationFrame sleeps. */
  pump(seconds: number, fps = 60) { for (let t = 0; t < seconds; t += 1 / fps) tick(1 / fps); document.getElementById('boot')?.classList.add('gone'); },
};
