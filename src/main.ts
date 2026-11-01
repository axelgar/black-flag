// Boot, the two screens, the line to the sea, and the frame clock.
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
import { hudEvents, hudState, hudTick } from './ui/hud';
import * as Input from './ui/input';
import { buzz } from './ui/haptics';
import { connect, credentials } from './net/cloud';
import { Link } from './net/link';

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

/** Leave the sea: the Leave button, Escape, or the back gesture. */
function ashore() {
  if (link) { link.close(); link = null; }
  world = null; view.setWorld(null);
  A.stopShanty();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (atSea()) go('/', true);
}

function act(what: string) {
  buzz(6); A.click();
  if (what === 'leave') ashore();
  else if (what === 'again') link?.again();
}

const WHY: Record<string, [string, string]> = {
  full: ['Every sea is full', 'Try again in a minute.'],
  token: ['Can\'t sign in', 'The server didn\'t answer. Check the wifi and try again.'],
  version: ['A new version is out', 'Reload the page to sail.'],
  name: ['Pick another name', 'That one can\'t go up on the TV.'],
  server: ['Lost the sea', 'The line kept dropping. Check the wifi and try again.'],
  reach: ['Can\'t reach the sea', 'This wifi may be blocking it. Try mobile data.'],
};

/** The line changed: say so on the HUD. */
function linkChanged(L: Link) {
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

function render() {
  const p = path();
  if (p === '/sea' && !link) { go('/', true); return; }
  if (p !== '/sea' && link) ashore();
  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }
  const out = p === '/sea' ? S.sea(view, act) : S.name(view);
  ui.innerHTML = out.html;
  const root = (ui.firstElementChild as HTMLElement) || ui;
  if (out.mount) teardown = out.mount(root) || null;
  document.documentElement.classList.toggle('at-sea', p === '/sea');
  if (p === '/sea' && link) { linkChanged(link); A.startShanty(); } else A.stopShanty();
}
window.addEventListener('hashchange', render);

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
  const L = link;
  if (L) {
    L.frame(now);
    const w = L.mirror.world;
    if (w !== world) { world = w; view.setWorld(w); if (L.roster) view.setColors(colorsOf(L)); }
    if (w) {
      const me = w.ships[w.focus];
      L.helm(me && !me.out && !upright.matches ? Input.read() : { move: null, fire: null, auto: false }, now);
      view.aim = Input.aiming();
      view.aimDry = !!me && me.ammo < 1;
      if (me) { A.listen(me.x, me.y); A.setHeat(me.streak); }
      if (w.events.length) {
        const evs = w.events.slice();
        w.events.length = 0;
        view.consume(evs, w);
        A.consume(evs, (e) => e.p === w.focus);
        hudEvents(evs, w, L.mirror.seats);
        for (const e of evs) if (e.p === w.focus && (e.k === 'hit' || e.k === 'sunk')) buzz(e.k === 'sunk' ? 80 : 25);
      }
    }
  }
  if (upright.matches && atSea()) { sincePaint += dt; return; }
  if (!due(dt, atSea() ? PAINT_HZ : IDLE_HZ)) return;
  const d = Math.min(sincePaint, 0.1);
  view.frame(d, atSea());
  hudTick(world, L?.mirror.seats ?? [], view, d, (look) => view.heightOf(look));
  sincePaint = 0;
}

/* ----------------------------------------------------------------- boot -- */

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
