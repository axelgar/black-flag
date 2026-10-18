// Router, boot, input, the frame clock.
//
// This is the only file that knows about time. The simulation is stepped at a fixed
// 1/120s from an accumulator — the frame rate is allowed to wander, the physics is not,
// which is what makes a seeded run replay the same on a 60Hz phone and a 120Hz one.

import './ui/app.css';
import { legendById, legendFor } from './data/legends';
import { CLASSES } from './data/enemies';
import { recipeOf } from './data/upgrades';
import { sailCount } from './data/waves';
import { SHIPS, shipById } from './data/ships';
import { session, save, meet, beat, nav, sea } from './state/session';
import { bankWave, endRun as foldRun, newRun, reales, runSeed } from './state/run';
import * as Wo from './sim/world';
import { theirs, you, type Input as Helm, type World } from './sim/types';
import { View, detectTier } from './render/view';
import * as A from './audio/audio';
import * as S from './ui/screens';
import { hudTick, toast } from './ui/hud';
import * as Input from './ui/input';
import { buzz } from './ui/haptics';
import { track, screen } from './analytics';
import { asNobody, connect, credentials, tap } from './net/cloud';
import { Link, type Berth } from './net/link';
import { RESPAWN } from './net/sea';
import { watchFrame, watchOff, watchPaint, watchScreen, watching } from './ui/watch';

const ui = document.getElementById('ui')!;
const app = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;

const tier = session.quality === 'auto' ? detectTier() : session.quality;
let view: View;
try {
  view = new View(canvas, tier);
} catch (err) {
  // No WebGL 2 (an old or blocklisted GPU, iOS Lockdown Mode): say so, rather than leave
  // the boot card up for ever.
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div style="max-width:420px;padding:0 28px;text-align:center"><div class="mark">BLACK FLAG</div>
    <p class="sub" style="margin-top:18px">This browser cannot draw the sea: it needs WebGL 2, which is switched off or not supported here. Try another browser, or turn off Lockdown Mode.</p></div>`;
  throw err;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || session.reduceMotion;
view.setReduced(reduced());

const FIXED = 1 / 120;
let world: World | null = null;
let paused = true;
let acc = 0;
let outcome = 0;                 // seconds left on the little pause after a wave ends
let pendingToast: [string, string] | null = null;
let covered = false;
let rimSaid = -1e9;             // when the rim current was last announced, so it is not nagged
/** The line to a shared sea, while one is on screen. Its mirror is the world then. */
let link: Link | null = null;
let seaLook = '';                // the shared sea's weather as last drawn: a new wave may change it
let seaSaid = 0;                 // when the sea's overlays were last brought up to date
/** At sea: sailing a run of your own, or aboard a shared sea. */
const atSea = () => path() === '/play' || path() === '/aboard';
const upright = matchMedia('(orientation: portrait) and (pointer: coarse)');   // the turn-me card is up

/* ---------------------------------------------------------------- input -- */

Input.attachKeys(() => togglePause(), () => A.unlock());
Input.attachMouse(app, atSea);
// The wheel brings the chase camera in to look at your ship, or out to look for theirs.
app.addEventListener('wheel', (e) => {
  if (!atSea()) return;
  e.preventDefault();
  view.chaseZoom = Math.min(1.35, Math.max(0.45, view.chaseZoom * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });
// Sound may only start from a gesture, and on glass a touch becomes one when it lifts,
// not when it lands (iOS is strict about it). So every kind of tap asks, which also
// wakes the sound again after the phone has been locked.
for (const k of ['pointerdown', 'pointerup', 'touchend', 'click'] as const) addEventListener(k, () => A.unlock(), { capture: true, passive: true });

/* ------------------------------------------------------------ run flow --- */

function seed() {
  // The only non-determinism in the whole build, and it lives here rather than in the
  // simulation so a run can always be replayed by handing its seed back.
  return Math.random().toString(36).slice(2, 10);
}
// The next run's chart is rolled ahead of time, so the harbour behind the title is the
// one she will sail from and weighing anchor does not stop to raise a new archipelago.
sea.next = seed();

function startWave() {
  const run = session.run!;
  world = Wo.create({ seed: run.seed, wave: run.wave, run: runSeed(run), reduce: reduced() });
  view.setWorld(world);
  acc = 0; outcome = 0; rimSaid = -1e9;
  Input.resetHelm();
  A.setSea(world.weather);
  const p = world.plan;
  track('wave_start', { wave: run.wave, boss: p.boss, weather: p.weather, ship: run.ship });
  pendingToast = [
    p.boss ? legendFor(run.wave).name : `Wave ${run.wave}`,
    p.boss ? 'SHE DOES NOT STRIKE HER COLOURS'
      : p.weather === 'storm' ? 'STORM · THE SWELL WILL SET YOU DOWN'
      : p.weather === 'fog' ? 'FOG · THEY WILL BE CLOSE BEFORE YOU SEE THEM'
      : `${sailCount(p)} SAIL ABROAD · THEY ARE LOOKING FOR YOU`,
  ];
}

/**
 * On a phone that allows it, the sea takes the whole screen — no address bar, no tab
 * strip — and stays sideways. Asked from the tap that puts her to sea, because a browser
 * only says yes to a tap. iPhones allow no such thing for a page; Add to Home Screen is
 * theirs. Leaving full screen is the phone's own back gesture, and the Articles can
 * switch it off.
 */
function takeScreen() {
  if (!session.fullscreen || !Input.touchUi() || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => { /* refused, or no lock on this browser: the page still plays */ });
}
window.addEventListener('bf:fullscreen', () => {
  if (session.fullscreen) takeScreen();
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});

window.addEventListener('bf:new-run', () => {
  takeScreen();
  // A run given up for a new one still goes in the book.
  if (session.run) {
    session.lastRun = foldRun(session.run, midWave() ? world : null);
    track('run_end', { reason: 'scuttled', ...session.lastRun });
  }
  newRun(sea.next, session.ship);
  sea.next = seed();
  track('run_start', { ship: session.ship });
  world = null;
  if (path() === '/play') render(); else go('/play');
});

window.addEventListener('bf:abandon', () => {
  if (session.run) {
    session.lastRun = foldRun(session.run, world);
    track('run_end', { reason: 'abandon', ...session.lastRun });
    save();
  }
  world = null; view.setWorld(null);
  go('/dead', true);
});

/**
 * Put a half-fought wave back the way it was found. The run is the wave's start line —
 * nothing inside a wave ever writes to it — so throwing the world away is the whole of
 * the rewind. A retreat that banked its takings would make the first two ships of a
 * rich wave a thing to sail in for and run from, over and over.
 */
function unsailWave() {
  world = null; view.setWorld(null);
  acc = 0; outcome = 0; pendingToast = null;
}

const midWave = () => !!session.run && !!world && world.phase === 'fight';

window.addEventListener('bf:restart-wave', () => {
  if (!midWave()) return;
  unsailWave();
  if (path() === '/play') render(); else go('/play', true);
});

window.addEventListener('bf:retreat', () => {
  if (!midWave()) return;
  unsailWave();
  save();          // the hulls met were genuinely met
  go('/port', true);
});

function enterPlay(): S.Screen {
  // Only the buttons that say so start a run; #/play reached any other way (the system
  // back gesture from the summary, a stale bookmark) goes to the title instead.
  if (!session.run) { history.replaceState(null, '', at('/')); here = '/'; nav.trail = ['/']; return S.title(view); }
  const run = session.run;
  if (world && (world.phase === 'lost' || world.phase === 'docked')) {
    // Its result is already written; only the curtain was still to come.
    const to = world.phase === 'docked' ? '/port' : '/dead';
    world = null; view.setWorld(null); outcome = 0;
    history.replaceState(null, '', at(to)); here = to; nav.trail = [to];
    return to === '/port' ? S.port(view) : S.dead(view);
  }
  if (!world || world.wave !== run.wave) startWave();
  else view.setWorld(world);
  A.setSea(world!.weather);
  A.startShanty();
  return S.play(view, dock);
}

/* ----------------------------------------------------------- shared sea -- */

// A shared sea runs on a server (server/, src/net/sea.ts). This device only sends its
// helm and draws the mirror the line keeps; nothing in a run of your own is touched.
window.addEventListener('bf:sea', (e) => {
  const berth = (e as CustomEvent<Berth>).detail;
  ashore();
  takeScreen();
  link = new Link(berth, credentials(), session.ship, () => S.seaTick(link));
  track('sea_join', { kind: berth.kind, mode: berth.kind === 'open' ? berth.mode : undefined, ship: session.ship });
  go('/aboard');
});

window.addEventListener('bf:ashore', () => { ashore(); go('/', true); });

/** Leave the shared sea on screen, if there is one. */
function ashore() {
  if (!link) return;
  link.close();
  link = null;
  world = null; view.setWorld(null);
  seaLook = '';
  A.stopShanty();
}

function enterAboard(): S.Screen {
  if (!link) { history.replaceState(null, '', at('/sea')); here = '/sea'; nav.trail = ['/sea']; return S.seaMenu(view); }
  A.startShanty();
  const out = S.aboard(view);
  requestAnimationFrame(() => S.seaTick(link));
  return out;
}

/** What only a shared sea says: who went down and who sent them, who came aboard, the
 *  next wave. The rest is handle()'s, as it is on your own. */
function handleSea(events: World['events']) {
  const w = world!, me = you(w).id, L = link!;
  for (const e of events) {
    switch (e.k) {
      case 'toll': {
        const n = reales(e.reales as number), by = e.by as number | undefined;
        if (e.p === me) toast(by != null ? `SUNK BY ${L.captain(by).toUpperCase()}` : 'SHE GOES DOWN', `−${n} REALES · AFLOAT AGAIN IN ${RESPAWN}S`);
        else if (by === me) toast(`${L.captain(e.p as number).toUpperCase()} GOES DOWN`, `+${n} REALES`);
        if (e.p === me) buzz(60);
        break;
      }
      case 'refloat': if (e.p === me) toast('AFLOAT AGAIN', 'OUT OF THE HARBOUR MOUTH'); break;
      case 'joined': if (e.p !== me) toast(`${L.captain(e.p as number)} comes aboard`, 'ANOTHER SAIL ON THE SEA'); break;
      case 'wave': {
        const p = w.plan;
        toast(p.boss ? legendFor(w.wave).name : `Wave ${w.wave}`, p.boss ? 'SHE DOES NOT STRIKE HER COLOURS'
          : p.weather === 'storm' ? 'STORM · THE SWELL WILL SET YOU DOWN' : p.weather === 'fog' ? 'FOG · THEY WILL BE CLOSE BEFORE YOU SEE THEM'
          : `${sailCount(p)} SAIL ABROAD`);
        break;
      }
      default: break;
    }
  }
}

/** Wave won and the sea is clear: sail in, or take the short way home from the HUD. */
function dock() {
  if (!world || world.phase !== 'clear') return;
  world.phase = 'docked';
  world.events.push({ k: 'dock' });
}

/** A prize near enough that letting go of the stick should bring her alongside. */
function prizeClose(w: World) {
  const s = you(w);
  for (const e of w.foes) {
    if (!Wo.isPrize(e)) continue;
    const reach = (e.len + s.len) * 0.5 * 0.85 + 12;
    if (Math.hypot(e.x - s.x, e.y - s.y) < reach * 1.6) return true;
  }
  return false;
}

/** Every ship the guest actually laid eyes on goes in the log. `seen` is a host flag —
 *  the sim never reads it, and it stays out of the digest. */
function logSightings(w: World) {
  for (const e of w.foes) {
    if (e.seen) continue;
    const me = you(w);
    if (e.state === 'patrol' && Math.hypot(e.x - me.x, e.y - me.y) > 320) continue;
    e.seen = true;
    meet(e.L ? e.L.id : e.cls);
  }
}

function handle(events: World['events']) {
  for (const e of events) {
    // another captain's boarding, refit or wound is theirs to hear about, not yours
    if (theirs(world!, e)) continue;
    switch (e.k) {
      case 'board': toast('BOARDED', `+${reales(e.reales as number)} REALES`); buzz(24); break;
      case 'strike': toast('SHE STRIKES', 'COME ALONGSIDE TO BOARD HER'); break;
      case 'refit': toast('SHE FLOATS', `${e.lives} LIVES LEFT`); buzz(40); break;
      case 'hunter': toast('HUNTERS', 'THEY HAVE STOPPED WAITING FOR YOU'); break;
      case 'legend': if (!world!.plan.boss) toast(e.name as string, 'OUT OF SCHEDULE · FIVE FLAGS'); break;
      case 'legend-down': beat(e.id as string); toast(e.name as string, 'STRUCK FROM THE LIST'); break;
      case 'lost-prize': toast('SHE GOT AWAY', 'AND SHE WILL TALK'); break;
      case 'rim': if (world!.t - rimSaid > 12) { rimSaid = world!.t; toast('THE EDGE OF THE CHART', 'THE CURRENT TURNS YOU BACK'); } break;
      case 'won': toast('THE SEA IS CLEAR', world!.shared ? 'THE NEXT WAVE IS PUTTING TO SEA' : `MAKE FOR NASSAU · ${reales(you(world!).plunder)} REALES`); break;
      case 'hit': buzz(18); break;
      default: break;
    }
  }
}

/**
 * A wave is won or lost the moment it happens, and written down then — not when the
 * curtain falls on it a second or two later. Pausing, backgrounding the phone or turning
 * it upright in that moment used to leave the result unwritten, and "Make sail" rebuilt
 * the wave from the run: a death undone, or a won wave's plunder thrown away.
 */
function settle() {
  const run = session.run!;
  if (world!.phase === 'docked') {
    bankWave(run, world!);
    save();
    track('wave_end', { wave: world!.wave, plunder: you(world!).plunder, ship: run.ship });
  } else {
    session.lastRun = foldRun(run, world);
    track('run_end', { reason: 'sunk', ...session.lastRun });
    save();
  }
}

/** The curtain: off the water and on to Nassau or the summary. */
function curtain() {
  const to = world!.phase === 'docked' ? '/port' : '/dead';
  world = null; view.setWorld(null);
  go(to, true);
}

/** In the second or two between a wave's end and its curtain nothing may pause it. */
const ending = () => outcome > 0 && !!world && (world.phase === 'lost' || world.phase === 'docked');

function togglePause() {
  if (ending()) return;
  const at = path();
  if (at === '/play' || at === '/aboard') go('/pause');
  else if (at === '/pause') go(link ? '/aboard' : '/play');
}

/** Hove to, if she is at sea and the wave is still being fought. */
function heaveTo() {
  if (atSea() && !ending()) go('/pause');
}

/** Move between screens: replace for moves the back gesture should not walk back through. */
function go(to: string, replace = false) {
  if (replace) location.replace(at(to)); else location.hash = `#${to}`;
}
/** This page's own address with another route on it — a bare '#/x' handed to
 *  location.replace is read against whichever page's script made the call. */
function at(to: string) {
  const u = new URL(location.href);
  u.hash = to;
  return u.href;
}

/* --------------------------------------------------------------- routes -- */

const ROUTES: [RegExp, (m: RegExpMatchArray) => S.Screen][] = [
  [/^\/$/, () => S.title(view)],
  [/^\/play$/, () => enterPlay()],
  [/^\/port$/, () => S.port(view)],
  [/^\/dead$/, () => S.dead(view)],
  [/^\/records$/, () => S.records()],
  [/^\/log$/, () => S.log()],
  [/^\/menu$/, () => S.menu(view)],
  [/^\/pause$/, () => S.pause(view, midWave(), !!link)],
  [/^\/sea$/, () => S.seaMenu(view)],
  [/^\/aboard$/, () => enterAboard()],
  [/^\/shipyard$/, () => S.shipyard(view)],
  [/^\/unlock\/(.+)$/, (m) => S.unlock(view, m[1])],
  [/^\/watch$/, () => watchScreen(view)],
];

const path = () => (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';

let teardown: (() => void) | null = null;
let here: string | null = null;

/** Where a wave being fought may not be left for: the back gesture walks the hash
 *  history, and reaching the shop with the wave still live made its upgrades free. */
const NOT_MID_WAVE = new Set(['/port', '/dead']);
/** Screens that are somewhere in themselves; the rest are opened from one of these, and
 *  their back button walks the trail back to it. */
const ROOTS = /^\/($|play$|pause$|port$|dead$|aboard$|unlock\/)/;

function render() {
  let p = path();
  if (midWave() && NOT_MID_WAVE.has(p)) { location.replace(at('/pause')); return; }
  if ((p === '/play' || p === '/aboard') && upright.matches) { location.replace(at('/pause')); return; }
  // anywhere but the shared sea, its pause and the Articles is ashore
  if (link && p !== '/aboard' && p !== '/pause' && p !== '/menu') ashore();
  if (p !== '/watch') watchOff();
  if (p !== here) {
    nav.from = here; here = p; screen(p);
    // The trail: a root starts it again; a screen already on it is gone back to; anything
    // else is a step further. Back buttons read it, so two screens that link to each
    // other can no longer send the guest between them for ever.
    const i = nav.trail.lastIndexOf(p);
    if (ROOTS.test(p)) nav.trail = [p];
    else if (i >= 0) nav.trail.length = i + 1;
    else nav.trail.push(p);
  }
  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }

  let out: S.Screen | null = null;
  for (const [re, fn] of ROUTES) { const m = p.match(re); if (m) { out = fn(m); break; } }
  if (!out) out = S.title(view);
  p = path();                     // a route may have sent the guest somewhere else

  ui.innerHTML = out.html;
  covered = !!out.covered;
  const root = (ui.firstElementChild as HTMLElement) || ui;
  if (out.mount) teardown = out.mount(root) || null;

  if (pendingToast && p === '/play') { toast(...pendingToast); pendingToast = null; }
  if (p === '/aboard') S.seaTick(link);

  // Everything except #/play is a pause. #/pause is a scrim over a live sea, so the
  // world stays mounted under it and keeps being painted; it just stops being stepped.
  paused = p !== '/play' && p !== '/aboard';
  if (paused) A.stopShanty();
  if (p !== '/play' && p !== '/pause' && world && world.phase !== 'fight' && world.phase !== 'clear') { world = null; view.setWorld(null); }
}

window.addEventListener('hashchange', render);

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  if (!t || !t.dataset.go) return;
  e.preventDefault();
  buzz(6);
  A.click();
  if (t.dataset.go === '#/play') takeScreen();
  location.hash = t.dataset.go;
});

// Backgrounded mid-wave, she should be hove to when you come back, not sunk — and the
// sound goes quiet with the screen.
document.addEventListener('visibilitychange', () => {
  A.hush(document.hidden);
  if (document.hidden) heaveTo();
});
// A notification shade or control centre pulled down over the game leaves the page
// "visible", but nobody is sailing her.
addEventListener('blur', () => heaveTo());

// Same rule for turning the phone upright: a card covers the sea, and taking fire behind
// it you cannot see is the same unfairness as taking it in a backgrounded tab.
upright.addEventListener('change', () => { if (upright.matches) heaveTo(); });

window.addEventListener('bf:prefs', () => {
  view.setReduced(reduced());
  if (world) world.reduce = reduced();
  A.prefs();
});

addEventListener('resize', () => view.resize());
window.addEventListener('bf:pause', () => togglePause());
// A finger on a screen that said it had none: put the stick and the thumb buttons up.
window.addEventListener('bf:touch', () => { if (atSea() || path() === '/') render(); });

/* ---------------------------------------------------------------- clock -- */

// Paint at most 60fps, and at most 30 on a screen that is only idling behind UI. A paper
// screen that covers the sea entirely, or a phone held upright behind its turn-me card,
// paints nothing at all.
//
// A frame counts as due a little early and the remainder carries: frame intervals jitter
// and Safari's clock only reads whole milliseconds, so a cap set exactly at 60 was
// skipping every few frames on a 60Hz iPhone — and a 90Hz screen still averages 60.
const PAINT_HZ = 60;
const IDLE_HZ = 30;
let sincePaint = 0;               // real time since the last paint: what the picture animates by
let pace = 0;                     // the pacing budget
let last = -1;

function frame(ms: number) {
  requestAnimationFrame(frame);
  const now = ms / 1000;
  const dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, now - last));
  last = now;
  tick(dt);
}

/** Is a painted frame due? Spends the pacing budget if so. */
function due(dt: number, hz: number): boolean {
  sincePaint += dt;
  pace += dt;
  const step = 1 / hz;
  if (pace < step * 0.75) return false;
  pace = Math.min(Math.max(0, pace - step), step * 0.5);
  return true;
}

function paint() {
  // after a spell behind a card or in the background, the picture resumes, it does not jump
  const dt = Math.min(sincePaint, 0.1);
  view.frame(dt, !paused);
  hudTick(world, view, dt);
  watchPaint(view);
  sincePaint = 0;
}

function tick(dt: number) {
  view.holdYaw = !paused && Input.steering();
  if (link) { tickSea(dt); return; }
  if (watching()) { tickWatch(dt); return; }

  if (!paused && world && (world.phase === 'fight' || world.phase === 'clear')) {
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 10) {
      // this device steers the captain it is looking through; every other ship holds her course
      const helm: Helm[] = [];
      helm[world.focus] = Input.read(view.yaw, n === 0);
      Wo.step(world, FIXED, helm);
      acc -= FIXED; n++;
    }
    if (n === 10) acc = 0;                          // a long stall is a dropped frame, not a debt

    if (world.events.length) {
      const evs = world.events.slice();
      world.events.length = 0;
      view.consume(evs, world);
      A.listen(you(world).x, you(world).y, view.yaw);
      A.consume(evs, (e) => theirs(world!, e));
      handle(evs);
    }
    logSightings(world);
    Input.nearPrize(prizeClose(world));
  }

  if (!paused && world && (world.phase === 'lost' || world.phase === 'docked') && outcome === 0) {
    outcome = world.phase === 'docked' ? 0.9 : 2.4;
    if (world.phase === 'lost') toast(`THE ${shipById(you(world).shipId).name.toUpperCase()} IS LOST`, 'ALL HANDS');
    else view.whiteout(0.25, '#FFE7B0');
    settle();
  }

  // The wave does not cut on the frame it ends — the last explosion gets to finish.
  if (outcome > 0 && world) {
    outcome -= dt;
    if (due(dt, PAINT_HZ)) paint();
    if (outcome <= 0) { outcome = 0; curtain(); }
    return;
  }

  if (covered || upright.matches) { sincePaint += dt; return; }
  if (due(dt, paused ? IDLE_HZ : PAINT_HZ)) paint();
}

/** A frame of a shared sea: slide the mirror, send the helm, and play what happened. */
function tickSea(dt: number) {
  const L = link!, now = performance.now() / 1000;
  L.frame(now);
  const w = L.mirror.world;
  if (w !== world) { world = w; view.setWorld(world); seaLook = world?.weather ?? ''; if (world) A.setSea(world.weather); }
  if (world) {
    if (world.weather !== seaLook) { seaLook = world.weather; view.setLook(world.weather); A.setSea(world.weather); }
    if (!paused && !you(world).out) L.helm(Input.read(view.yaw, true), now);
    else L.hold(Input.sailLevel(), now);
    if (world.events.length) {
      const evs = world.events.slice();
      world.events.length = 0;
      view.consume(evs, world);
      A.listen(you(world).x, you(world).y, view.yaw);
      A.consume(evs, (e) => theirs(world!, e));
      handleSea(evs);
      handle(evs);
    }
    logSightings(world);
    Input.nearPrize(prizeClose(world));
  }
  if (now - seaSaid > 0.25 && path() === '/aboard') { seaSaid = now; S.seaTick(L); }
  if (covered || upright.matches) { sincePaint += dt; return; }
  if (due(dt, paused ? IDLE_HZ : PAINT_HZ)) paint();
}

/** A frame of the bar's screen. Thirty a second: from that high nothing moves fast enough
 *  to want more, and it halves what the laptop behind the TV has to draw. */
function tickWatch(dt: number) {
  world = watchFrame(view, performance.now() / 1000);
  if (due(dt, WATCH_HZ)) paint();
}
const WATCH_HZ = 30;

/* ----------------------------------------------------------------- boot -- */

if (session.reduceMotion) document.documentElement.style.setProperty('--dur', '120ms');

// A tag or a QR code opens /u/<CODE>. Vercel rewrites that to the app; here it becomes a
// hash route, and the address bar is put back to the plain site so a reload does not
// re-announce the ship. The tap is written down now, once per page it opens: the tag
// at the bar carries ?src=nfc, so the server can tell a tap on it from a scan or a link.
const qr = location.pathname.match(/^\/u\/([^/?#]+)/);
if (qr) {
  tap(decodeURIComponent(qr[1]), new URLSearchParams(location.search).get('src') === 'nfc' ? 'nfc' : 'link');
  history.replaceState(null, '', `/#/unlock/${qr[1]}`);
}

// The bar's screen is /watch, and it is nobody: it never signs in, so the TV makes no player.
if (location.pathname.replace(/\/+$/, '') === '/watch') history.replaceState(null, '', '/#/watch');
if (location.hash.startsWith('#/watch')) asNobody();

if (!location.hash) location.hash = '#/';
render();
requestAnimationFrame(frame);
requestAnimationFrame(() => setTimeout(() => document.getElementById('boot')?.classList.add('gone'), 250));
// The server comes after the sea: sign in, send any taps waiting, and learn the captain's name.
setTimeout(() => { void connect(); }, 1200);

// For poking at from the console, and for the browser checks.
(window as unknown as { bf: unknown }).bf = {
  view, session, get world() { return world; },
  /** The line to the shared sea on screen, if there is one. */
  get link() { return link; },
  /** Drive the clock by hand — for a background tab, where requestAnimationFrame sleeps. */
  pump(seconds: number, fps = 60) { for (let t = 0; t < seconds; t += 1 / fps) tick(1 / fps); document.getElementById('boot')?.classList.add('gone'); },
  /** A shared sea before there is a server: this wave again from the top, with other
   *  captains' ships in line with yours. They heave to; the sim, the view, the HUD and the
   *  minimap treat them as they will real ones. `crew('kestrel')`, or a full sea's start
   *  to see what a phone makes of it: `crew('mix', false, 29)`. */
  crew(ship = 'kestrel', pvp = false, n = 1) {
    const run = session.run;
    if (!run) return 'no run at sea';
    const ships = ship === 'mix' ? SHIPS.map((s) => s.id) : [ship];
    const others = Array.from({ length: n }, (_, i) => ({ ship: ships[i % ships.length] }));
    world = Wo.create({ seed: run.seed, wave: run.wave, players: [runSeed(run), ...others], pvp, reduce: reduced() });
    view.setWorld(world);
    acc = 0; outcome = 0;
    return world.players.map((p) => `${p.id}: ${p.shipId}`);
  },
  /** Look at any hull in the game at anchor: `inspect('foe', 'manowar')`, `inspect('legend', 'dama', 2)`. */
  inspect(kind: 'ship' | 'foe' | 'legend', id: string, zoom = 1) {
    const R = kind === 'foe' ? CLASSES[id]?.recipe : kind === 'legend' ? legendById(id).recipe : recipeOf(shipById(id));
    view.inspect(R ?? null, zoom);
  },
};
