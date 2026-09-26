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
import { shipById } from './data/ships';
import { session, save, meet, beat, nav } from './state/session';
import { bankWave, endRun as foldRun, newRun, reales, runSeed } from './state/run';
import * as Wo from './sim/world';
import type { World } from './sim/types';
import { View, detectTier } from './render/view';
import * as A from './audio/audio';
import * as S from './ui/screens';
import { hudTick, toast } from './ui/hud';
import * as Input from './ui/input';
import { buzz } from './ui/haptics';
import { track, screen } from './analytics';

const ui = document.getElementById('ui')!;
const app = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;

const tier = session.quality === 'auto' ? detectTier() : session.quality;
const view = new View(canvas, tier);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || session.reduceMotion;
view.setReduced(reduced());

const FIXED = 1 / 120;
let world: World | null = null;
let paused = true;
let acc = 0;
let outcome = 0;                 // seconds left on the little pause after a wave ends
let pendingToast: [string, string] | null = null;
let covered = false;

/* ---------------------------------------------------------------- input -- */

Input.attachKeys(() => togglePause(), () => A.unlock());
Input.attachMouse(app, () => path() === '/play');
// The wheel brings the chase camera in to look at your ship, or out to look for theirs.
app.addEventListener('wheel', (e) => {
  if (path() !== '/play') return;
  e.preventDefault();
  view.chaseZoom = Math.min(1.35, Math.max(0.45, view.chaseZoom * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });
addEventListener('pointerdown', () => A.unlock(), { once: true });

/* ------------------------------------------------------------ run flow --- */

function seed() {
  // The only non-determinism in the whole build, and it lives here rather than in the
  // simulation so a run can always be replayed by handing its seed back.
  return Math.random().toString(36).slice(2, 10);
}

function startWave() {
  const run = session.run!;
  world = Wo.create({ seed: run.seed, wave: run.wave, run: runSeed(run), reduce: reduced() });
  view.setWorld(world);
  acc = 0; outcome = 0;
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

window.addEventListener('bf:new-run', () => {
  newRun(seed(), session.ship);
  track('run_start', { ship: session.ship });
  world = null;
  if (path() === '/play') render(); else location.hash = '#/play';
});

window.addEventListener('bf:abandon', () => {
  if (session.run) {
    session.lastRun = foldRun(session.run, world);
    track('run_end', { reason: 'abandon', ...session.lastRun });
    save();
  }
  world = null; view.setWorld(null);
  location.hash = '#/dead';
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
  if (path() === '/play') render(); else location.hash = '#/play';
});

window.addEventListener('bf:retreat', () => {
  if (!midWave()) return;
  unsailWave();
  save();          // the hulls met were genuinely met
  location.hash = '#/port';
});

function enterPlay(): S.Screen {
  if (!session.run) newRun(seed(), session.ship);
  const run = session.run!;
  if (!world || world.wave !== run.wave || world.phase === 'lost' || world.phase === 'docked') startWave();
  else view.setWorld(world);
  A.setSea(world!.weather);
  A.startShanty();
  return S.play(view, dock);
}

/** Wave won and the sea is clear: sail in, or take the short way home from the HUD. */
function dock() {
  if (!world || world.phase !== 'clear') return;
  world.phase = 'docked';
  world.events.push({ k: 'dock' });
}

/** Every ship the guest actually laid eyes on goes in the log. `seen` is a host flag —
 *  the sim never reads it, and it stays out of the digest. */
function logSightings(w: World) {
  for (const e of w.foes) {
    if (e.seen) continue;
    if (e.state === 'patrol' && Math.hypot(e.x - w.ship.x, e.y - w.ship.y) > 320) continue;
    e.seen = true;
    meet(e.L ? e.L.id : e.cls);
  }
}

function handle(events: World['events']) {
  for (const e of events) {
    switch (e.k) {
      case 'board': toast('BOARDED', `+${reales(e.reales as number)} REALES`); buzz(24); break;
      case 'strike': toast('SHE STRIKES', 'COME ALONGSIDE TO BOARD HER'); break;
      case 'refit': toast('SHE FLOATS', `${e.lives} LIVES LEFT`); buzz(40); break;
      case 'hunter': toast('HUNTERS', 'THEY HAVE STOPPED WAITING FOR YOU'); break;
      case 'legend': if (!world!.plan.boss) toast(e.name as string, 'OUT OF SCHEDULE · FIVE FLAGS'); break;
      case 'legend-down': beat(e.id as string); toast(e.name as string, 'STRUCK FROM THE LIST'); break;
      case 'lost-prize': toast('SHE GOT AWAY', 'AND SHE WILL TALK'); break;
      case 'won': toast('THE SEA IS CLEAR', `MAKE FOR NASSAU · ${reales(world!.plunder)} REALES`); break;
      case 'hit': buzz(18); break;
      default: break;
    }
  }
}

function endWave() {
  const run = session.run!;
  bankWave(run, world!);
  save();
  track('wave_end', { wave: world!.wave, plunder: world!.plunder, ship: run.ship });
  world = null; view.setWorld(null);
  location.hash = '#/port';
}

function endRun() {
  session.lastRun = foldRun(session.run!, world);
  track('run_end', { reason: 'sunk', ...session.lastRun });
  save();
  world = null; view.setWorld(null);
  location.hash = '#/dead';
}

function togglePause() {
  const at = path();
  if (at === '/play') location.hash = '#/pause';
  else if (at === '/pause') location.hash = '#/play';
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
  [/^\/pause$/, () => S.pause(view, midWave())],
  [/^\/shipyard$/, () => S.shipyard(view)],
  [/^\/unlock\/(.+)$/, (m) => S.unlock(view, m[1])],
];

const path = () => (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';

let teardown: (() => void) | null = null;
let here: string | null = null;

function render() {
  const p = path();
  if (p !== here) { nav.from = here; here = p; screen(p); }
  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }

  let out: S.Screen | null = null;
  for (const [re, fn] of ROUTES) { const m = p.match(re); if (m) { out = fn(m); break; } }
  if (!out) out = S.title(view);

  ui.innerHTML = out.html;
  covered = !!out.covered;
  const root = (ui.firstElementChild as HTMLElement) || ui;
  if (out.mount) teardown = out.mount(root) || null;

  if (pendingToast && p === '/play') { toast(...pendingToast); pendingToast = null; }

  // Everything except #/play is a pause. #/pause is a scrim over a live sea, so the
  // world stays mounted under it and keeps being painted; it just stops being stepped.
  paused = p !== '/play';
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
  location.hash = t.dataset.go;
});

// Backgrounded mid-wave, she should be hove to when you come back, not sunk.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && path() === '/play') location.hash = '#/pause';
});

// Same rule for turning the phone upright: a card covers the sea, and taking fire behind
// it you cannot see is the same unfairness as taking it in a backgrounded tab.
const upright = matchMedia('(orientation: portrait) and (pointer: coarse)');
upright.addEventListener('change', () => { if (upright.matches && path() === '/play') location.hash = '#/pause'; });

window.addEventListener('bf:prefs', () => {
  view.setReduced(reduced());
  if (world) world.reduce = reduced();
  A.prefs();
});

addEventListener('resize', () => view.resize());

/* ---------------------------------------------------------------- clock -- */

// Paint at most 60fps, and at most 30 on a screen that is only idling behind UI. A paper
// screen that covers the sea entirely paints nothing at all.
const PAINT_MIN = 1 / 61;
const IDLE_MIN = 1 / 31;
let paintAcc = 0;
let last = performance.now() / 1000;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  tick(dt);
}

function tick(dt: number) {

  if (!paused && world && (world.phase === 'fight' || world.phase === 'clear')) {
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 10) { Wo.step(world, FIXED, Input.read(view.yaw, n === 0)); acc -= FIXED; n++; }
    if (n === 10) acc = 0;                          // a long stall is a dropped frame, not a debt

    if (world.events.length) {
      const evs = world.events.slice();
      world.events.length = 0;
      view.consume(evs, world);
      A.listen(world.ship.x, world.ship.y, view.yaw);
      A.consume(evs);
      handle(evs);
    }
    logSightings(world);
  }

  if (!paused && world && (world.phase === 'lost' || world.phase === 'docked') && outcome === 0) {
    outcome = world.phase === 'docked' ? 0.9 : 2.4;
    if (world.phase === 'lost') toast(`THE ${shipById(world.shipId).name.toUpperCase()} IS LOST`, 'ALL HANDS');
    else view.whiteout(0.25, '#FFE7B0');
  }

  // The wave does not cut on the frame it ends — the last explosion gets to finish.
  if (outcome > 0 && world) {
    outcome -= dt;
    paintAcc += dt;
    if (paintAcc >= PAINT_MIN) { view.frame(paintAcc); hudTick(world, view, paintAcc); paintAcc = 0; }
    if (outcome <= 0) { outcome = 0; if (world.phase === 'docked') endWave(); else endRun(); }
    return;
  }

  paintAcc += dt;
  if (covered) return;
  if (paintAcc < (paused ? IDLE_MIN : PAINT_MIN)) return;
  view.frame(paintAcc);
  hudTick(world, view, paintAcc);
  paintAcc = 0;
}

/* ----------------------------------------------------------------- boot -- */

if (session.reduceMotion) document.documentElement.style.setProperty('--dur', '120ms');

// A QR code opens /u/<CODE>. Vercel rewrites that to the app; here it becomes a hash
// route, and the address bar is put back to the plain site so a reload does not
// re-announce the ship.
const qr = location.pathname.match(/^\/u\/([^/?#]+)/);
if (qr) history.replaceState(null, '', `/#/unlock/${qr[1]}`);

if (!location.hash) location.hash = '#/';
render();
requestAnimationFrame(frame);
requestAnimationFrame(() => setTimeout(() => document.getElementById('boot')?.classList.add('gone'), 250));

// For poking at from the console, and for the browser checks.
(window as unknown as { bf: unknown }).bf = {
  view, session, get world() { return world; },
  /** Drive the clock by hand — for a background tab, where requestAnimationFrame sleeps. */
  pump(seconds: number, fps = 60) { for (let t = 0; t < seconds; t += 1 / fps) tick(1 / fps); document.getElementById('boot')?.classList.add('gone'); },
  /** Look at any hull in the game at anchor: `inspect('foe', 'manowar')`, `inspect('legend', 'dama', 2)`. */
  inspect(kind: 'ship' | 'foe' | 'legend', id: string, zoom = 1) {
    const R = kind === 'foe' ? CLASSES[id]?.recipe : kind === 'legend' ? legendById(id).recipe : recipeOf(shipById(id));
    view.inspect(R ?? null, zoom);
  },
};
