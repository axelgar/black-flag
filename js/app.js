// Router, boot, input, the frame clock and the desktop clamp.
//
// This is the only file that knows about time. The simulation is stepped at a fixed
// 1/120s from an accumulator — the frame rate is allowed to wander, the physics is not,
// which is what makes a seeded run replay the same on a 60Hz phone and a 120Hz one.

import { timer } from 'd3';
import * as R from './render.js';
import * as S from './state.js';
import * as Wo from './world.js';
import * as A from './audio.js';
import * as Screens from './screens.js';

const ui = document.getElementById('ui');
const stage = document.getElementById('stage');

R.mount(
  document.getElementById('sea'),
  document.getElementById('fleet'),
  document.getElementById('fx'),
);

const FIXED = 1 / 120;

let world = null;
let paused = true;
let acc = 0;
let outcome = 0;                 // seconds left on the little pause after a wave ends
let pendingToast = null;         // the wave title, held until the HUD exists to hold it

/* ---------------------------------------------------------------- input -- */

const keys = new Set();
let pointerX = null, pointerHeld = false, wantMortar = false;

function stageX(clientX) {
  const b = stage.getBoundingClientRect();
  return ((clientX - b.left) / b.width) * S.W;
}

stage.addEventListener('pointerdown', (e) => {
  A.unlock();
  if (e.target.closest('button,a')) return;
  pointerHeld = true;
  pointerX = stageX(e.clientX);
  // A mouse has a second button's worth of intent to spend; a finger does not, so the
  // finger gets the mortar button and the mouse gets the click.
  if (e.pointerType === 'mouse') wantMortar = true;
});
stage.addEventListener('pointermove', (e) => {
  // Hover steers with a mouse; a finger has to be down. Anything else and the ship
  // would chase a stylus that is only passing through.
  if (pointerHeld || e.pointerType === 'mouse') pointerX = stageX(e.clientX);
});
const release = () => { pointerHeld = false; };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') pointerX = null; });

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'spacebar') { e.preventDefault(); wantMortar = true; A.unlock(); }
  if (k === 'escape') { e.preventDefault(); togglePause(); }
  keys.add(k);
  if (['arrowleft', 'arrowright', 'a', 'd'].includes(k)) { pointerX = null; A.unlock(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

window.addEventListener('bf:mortar', () => { wantMortar = true; });

function readInput(first) {
  const left = keys.has('arrowleft') || keys.has('a');
  const right = keys.has('arrowright') || keys.has('d');
  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const use = first && wantMortar;
  if (use) wantMortar = false;
  return { x: dx ? null : pointerX, dx, mortar: use };
}

/* ------------------------------------------------------------ run flow --- */

function seed() {
  // The only non-determinism in the whole build, and it lives here rather than inside
  // world.js so a run can always be replayed by handing its seed back.
  return Math.random().toString(36).slice(2, 10);
}

function startWave() {
  const run = S.session.run;
  world = Wo.create({ seed: run.seed, wave: run.wave, run, reduce: R.reduced() });
  R.scene.world = world;
  R.clearFx();
  acc = 0; outcome = 0;
  A.setSea(world.weather);
  const p = world.plan;
  // Held rather than shouted: startWave runs while the play screen is still a string,
  // so there is no HUD to shout into until render() has mounted it.
  pendingToast = [
    p.boss ? S.legendFor(run.wave).name : `Wave ${run.wave}`,
    p.boss ? 'SHE DOES NOT STRIKE HER COLOURS'
      : p.weather === 'storm' ? 'STORM · THE SWELL WILL SET YOU DOWN'
      : p.weather === 'fog' ? 'FOG · THEY WILL BE CLOSE BEFORE YOU SEE THEM'
      : `${p.groups.filter((g) => g.cls !== 'reef' && g.cls !== 'spout').length} SAIL SIGHTED`,
  ];
}

window.addEventListener('bf:new-run', () => {
  S.newRun(seed());
  world = null;
  location.hash = '#/play';
  if (here === '/play') render();          // already here — the hash will not fire
});

window.addEventListener('bf:abandon', () => {
  if (S.session.run) {
    S.session.lastRun = S.endRun(S.session.run, world);
    S.save();
  }
  world = null; R.scene.world = null;
  location.hash = '#/dead';
});

/**
 * Put a half-fought wave back the way it was found. The run object is the wave's start
 * line — nothing inside a wave ever writes to it, bankWave at the end is the only thing
 * that does — so throwing the world away is the whole of the rewind. Plunder, lives,
 * hull, shells and notoriety all come back to what they were when she left the beach,
 * and whatever the wave had paid out so far goes back with them. That is deliberate:
 * a retreat that banked its takings would make the first two ships of a rich wave a
 * thing to sail in for and run from, over and over.
 */
function unsailWave() {
  world = null; R.scene.world = null;
  R.clearFx();
  acc = 0; outcome = 0;
  pendingToast = null;
}

// Guarded on the wave still being fought, both here and on the screen that draws the
// buttons: during the second and a half a lost wave gets to finish its last explosion,
// either of these would be a way to decline having lost it.
const midWave = () => S.session.run && world && world.phase === 'fight';

window.addEventListener('bf:restart-wave', () => {
  if (!midWave()) return;
  unsailWave();
  location.hash = '#/play';
  if (here === '/play') render();          // already here — the hash will not fire
});

window.addEventListener('bf:retreat', () => {
  if (!midWave()) return;
  unsailWave();
  // There is nothing to bank, but the hulls the wave put in the captain's log were
  // genuinely met, and the wave-end save is the one that would have written them down.
  S.save();
  location.hash = '#/port';
});

function enterPlay() {
  if (!S.session.run) S.newRun(seed());
  const run = S.session.run;
  if (!world || world.wave !== run.wave || world.phase !== 'fight') startWave();
  else R.scene.world = world;
  A.setSea(world.weather);
  A.startShanty();
  return Screens.play();
}

/** Every ship the guest actually laid eyes on goes in the log. `seen` is a host flag on
 *  a simulation entity — the sim never reads it, and it stays out of the digest. */
function logSightings(w) {
  for (const e of w.foes) {
    if (e.seen || e.y < Wo.HORIZON) continue;
    e.seen = true;
    S.meet(e.cls === 'legend' ? e.legend.id : e.cls);
  }
}

function handle(events) {
  for (const e of events) {
    if (e.k === 'board') Screens.toast('BOARDED', `+${S.reales(e.reales)} REALES`);
    else if (e.k === 'refit') Screens.toast('SHE FLOATS', `${e.lives} LIVES LEFT`);
    else if (e.k === 'hunter') Screens.toast('HUNTERS', 'THEY HAVE STOPPED WAITING FOR YOU');
    else if (e.k === 'legend' && !world.plan.boss) Screens.toast(e.name, 'OUT OF SCHEDULE · FIVE FLAGS');
    else if (e.k === 'legend-down') { S.beat(e.id); Screens.toast(e.name, 'STRUCK FROM THE LIST'); }
  }
}

function endWave() {
  const run = S.session.run;
  S.bankWave(run, world);
  S.save();
  world = null; R.scene.world = null;
  location.hash = '#/port';
}

function endRun() {
  S.session.lastRun = S.endRun(S.session.run, world);
  S.save();
  world = null; R.scene.world = null;
  location.hash = '#/dead';
}

function togglePause() {
  const at = path();
  if (at === '/play') location.hash = '#/pause';
  else if (at === '/pause') location.hash = '#/play';
}

/* --------------------------------------------------------------- routes -- */

const ROUTES = [
  [/^\/$/,        () => Screens.title()],
  [/^\/play$/,    () => enterPlay()],
  [/^\/port$/,    () => Screens.port()],
  [/^\/dead$/,    () => Screens.dead()],
  [/^\/records$/, () => Screens.records()],
  [/^\/log$/,     () => Screens.log()],
  [/^\/menu$/,    () => Screens.menu()],
  [/^\/pause$/,   () => Screens.pause()],
];

const path = () => (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';

let teardown = null;
let here = null;

function render() {
  const p = path();
  if (p !== here) { S.nav.from = here; here = p; }

  if (teardown) { try { teardown(); } catch { /* noop */ } teardown = null; }

  let out = null;
  for (const [re, fn] of ROUTES) if (re.test(p)) { out = fn(); break; }
  if (!out) out = Screens.title();

  ui.innerHTML = out.html;
  const root = ui.firstElementChild || ui;
  stage.classList.toggle('flat', R.scene.hidden);
  if (out.mount) teardown = out.mount(root) || null;

  if (pendingToast) { Screens.toast(...pendingToast); pendingToast = null; }

  // Everything except #/play is a pause. #/pause is a scrim over a live sea, so the
  // world stays mounted under it and keeps painting; it just stops being stepped.
  paused = p !== '/play';
  if (paused) A.stopShanty();
}

window.addEventListener('hashchange', render);

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (!t || !t.dataset.go) return;
  e.preventDefault();
  Screens.buzz(6);
  location.hash = t.dataset.go;
});

// Backgrounded mid-wave, the Jackdaw should be hove to when you come back, not sunk.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && path() === '/play') location.hash = '#/pause';
});

// Same rule for turning the phone sideways: the CSS puts a "turn her upright" card over
// the whole screen, and taking fire behind it you cannot see is the same unfairness as
// taking it in a backgrounded tab.
const sideways = matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 560px)');
sideways.addEventListener('change', () => {
  if (sideways.matches && path() === '/play') location.hash = '#/pause';
});

window.addEventListener('bf:prefs', () => {
  document.documentElement.style.setProperty('--dur', S.session.reduceMotion ? '120ms' : '');
  if (world) world.reduce = R.reduced();
  A.prefs();
});

/* ---------------------------------------------------------------- clock -- */

let last = performance.now() / 1000;
const t0 = last;

timer(() => {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  const T = now - t0;

  if (!paused && world && world.phase === 'fight') {
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 10) { Wo.step(world, FIXED, readInput(n === 0)); acc -= FIXED; n++; }
    if (n === 10) acc = 0;                        // a long stall is a dropped frame, not a debt

    if (world.events.length) {
      const evs = world.events.slice();
      world.events.length = 0;
      R.consume(evs, world);
      A.consume(evs);
      handle(evs);
    }
    logSightings(world);
    A.setHeat(world.heat);

    if (world.phase !== 'fight' && outcome === 0) {
      outcome = world.phase === 'won' ? 1.6 : 2.2;
      Screens.toast(world.phase === 'won' ? 'THE SEA IS CLEAR' : 'THE JACKDAW IS LOST',
        world.phase === 'won' ? `WAVE ${world.wave} · ${S.reales(world.plunder)} REALES` : 'ALL HANDS');
      if (world.phase === 'lost') R.whiteout(0.5, '#8E2B24');
    }
  }

  // The wave does not cut on the frame it ends — the last explosion gets to finish.
  if (outcome > 0 && world) {
    outcome -= dt;
    R.paint(dt, T);
    Screens.hudTick(world);
    if (outcome <= 0) { const won = world.phase === 'won'; won ? endWave() : endRun(); }
    return;
  }

  R.paint(dt, T);
  Screens.hudTick(world);
});

/* -------------------------------------------------------------- desktop -- */
// Clamp to 390px and scale the whole stage. Never reflow.

function fit() {
  // Sideways on a phone the stage is hidden behind the rotate card, and fitting it would
  // clamp to ~0.46 and rebake the sea a thousand pixels wide for nobody to look at.
  if (sideways.matches) return;
  const mobile = window.innerWidth <= 820 || matchMedia('(pointer: coarse)').matches;
  const cap = window.innerHeight * (mobile ? 1 : 0.82);
  let s = Math.min(cap / S.H, window.innerWidth / S.W);
  if (!mobile) s = Math.min(1, s);
  stage.style.transform = `scale(${s})`;
  stage.style.transformOrigin = '0 0';
  const wrap = document.querySelector('.stagewrap');
  wrap.style.height = `${S.H * s}px`;
  wrap.style.width = `${S.W * s}px`;
  // Whatever the scale leaves over at the sides, the sea paints into — so the water
  // runs edge to edge instead of sitting in a letterbox. Desktop keeps the frame.
  R.setBleed(mobile ? (window.innerWidth / s - S.W) / 2 : 0);
}
addEventListener('resize', fit);
fit();

/* ----------------------------------------------------------------- boot -- */

if (S.session.reduceMotion) document.documentElement.style.setProperty('--dur', '120ms');
addEventListener('pointerdown', () => A.unlock(), { once: true });

if (!location.hash) location.hash = '#/';
else render();
