// The simulation.
//
// Pure. No canvas, no DOM, no clock of its own — the whole surface is create(),
// step(world, dt, input) and digest(). That is what buys the self-check: test.mjs
// runs a headless sixty-second battle at a fixed timestep and gets the same answer
// every time, which is the only way to know the wave curve and the surrender window
// still mean what they meant last month.
//
// Nothing in here calls Date.now() or Math.random(). Every roll goes through w.r.

import {
  W, H, rng, clamp, CLASSES, legendById, LEGENDS,
  wavePlan, shipStats, HEAT, heatSunk, heatEscaped, heatBoarded,
  HEAT_MAX, HUNTER_AT, EARLY_LEGEND_AT, rollDrop,
} from './state.js';

export const HORIZON = 96;        // ships enter above this line and sail down into range
export const SHIP_Y = 706;        // the Jackdaw holds her latitude; only x is yours
export const SCROLL = 92;         // px/s the sea moves past — reefs and swell share it
export const STRIKE_AT = 0.25;    // hull fraction at which the colours come down
export const STRIKE_WINDOW = 4;   // seconds a prize stays boardable. The number.
const MAX_VX = 300;               // the Jackdaw's helm, px/s
const MORTAR_Y = 250;             // where a shell lands — the top third, as planned
const MORTAR_FUSE = 1.15;

/* ---------------------------------------------------------------- make --- */

export function create({ seed = 'jackdaw', wave = 1, run = {}, reduce = false } = {}) {
  const stats = shipStats(run.upgrades || {});
  const plan = wavePlan(wave, rng(`${seed}:plan:${wave}`));
  const w = {
    seed, wave, plan, stats, reduce,
    r: rng(`${seed}:sim:${wave}`),
    weather: plan.weather,
    t: 0, gi: 0, nextId: 1,
    phase: 'fight',                              // fight | won | lost
    scroll: 0, drift: 0, shake: 0,
    heat: clamp(run.heat ?? 0, 0, HEAT_MAX),
    plunder: run.plunder ?? 0,
    lives: run.lives ?? stats.lives,
    boarded: run.boarded ?? 0,
    sunk: run.sunk ?? 0,
    // Escalation is gentle and in two places only: they arrive faster and reload faster.
    speedMul: 1 + (wave - 1) * 0.018,
    reloadMul: Math.pow(0.975, wave - 1),
    ship: {
      x: W / 2, y: SHIP_Y, vx: 0,
      hull: run.hull ?? stats.hullMax, hullMax: stats.hullMax,
      cool: 0, shells: run.shells ?? stats.shellsMax, shellsMax: stats.shellsMax,
      invuln: 1.4, ram: 0,
      buffs: { powder: 0, heavy: 0, chain: 0, swivel: 0 },
    },
    foes: [], shots: [], drops: [], rocks: [], marks: [], spouts: [],
    boss: null, hunters: 0, hunterT: 12, earlyLegend: false,
    events: [],
  };
  return w;
}

const ev = (w, k, o) => { if (w.events.length < 64) w.events.push({ k, ...o }); };

/* ---------------------------------------------------------------- step --- */

/**
 * One tick. `input` is `{ x, dx, mortar }` — x is an absolute helm target (a finger
 * or a mouse) or null, dx is -1/0/1 from the keyboard, mortar is edge-triggered by
 * the caller. Feed it a fixed dt and the run replays exactly.
 */
export function step(w, dt, input = {}) {
  if (w.phase !== 'fight') return w;

  w.t += dt;
  w.scroll += SCROLL * dt;
  w.heat = clamp(w.heat + HEAT.perSecond * dt, 0, HEAT_MAX);
  w.shake = Math.max(0, w.shake - dt * 2.6);

  // The storm's swell is a slow sine you steer against rather than a shove you
  // cannot answer — halved outright when the guest has asked for less motion.
  w.drift = w.weather === 'storm' ? Math.sin(w.t * 0.55) * 62 * (w.reduce ? 0.5 : 1) : 0;

  helm(w, dt, input);
  guns(w, dt, input);
  spawn(w, dt);
  hunt(w, dt);

  for (const e of w.foes) stepFoe(w, e, dt);
  for (const s of w.shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.age += dt; }
  for (const d of w.drops) { d.y += (SCROLL * 0.5) * dt; d.spin += dt * 2.4; }
  for (const k of w.rocks) k.y += SCROLL * dt;
  for (const p of w.spouts) { p.y += SCROLL * 0.4 * dt; p.ph += dt; }
  marks(w, dt);

  collide(w, dt);
  cull(w);
  finish(w);
  return w;
}

/* ---------------------------------------------------------------- helm --- */

function helm(w, dt, input) {
  const s = w.ship;
  if (input.x != null) {
    // Ease toward the finger rather than snapping to it: the ship has mass, and a
    // ship with mass is what makes a boarding run a commitment.
    s.vx = clamp((input.x - s.x) * 9, -MAX_VX, MAX_VX);
  } else {
    const want = (input.dx || 0) * MAX_VX;
    s.vx += (want - s.vx) * Math.min(1, dt * 11);
  }
  s.x += (s.vx + w.drift) * dt;

  // A waterspout pulls rather than pushes — you can steer out, it just costs you the turn.
  for (const p of w.spouts) {
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
    if (d < p.r * 2.4 && d > 1) s.x += (dx / d) * (1 - d / (p.r * 2.4)) * 110 * dt * (w.reduce ? 0.5 : 1);
  }

  if (s.x < 22) { s.x = 22; s.vx = Math.max(0, s.vx); }
  if (s.x > W - 22) { s.x = W - 22; s.vx = Math.min(0, s.vx); }

  s.invuln = Math.max(0, s.invuln - dt);
  s.ram = Math.max(0, s.ram - dt);
  for (const k of Object.keys(s.buffs)) if (s.buffs[k] > 0) s.buffs[k] = Math.max(0, s.buffs[k] - dt);
}

/* ---------------------------------------------------------------- guns --- */

function guns(w, dt, input) {
  const s = w.ship, st = w.stats;
  s.cool -= dt;
  if (s.cool <= 0) {
    const chain = s.buffs.chain > 0;
    const heavy = s.buffs.heavy > 0;
    const dmg = st.dmg * (heavy ? 2 : 1) * (chain ? 0.75 : 1);
    const push = (ox, vx, vy, kind, d, r, pierce) =>
      w.shots.push({ x: s.x + ox, y: s.y - 20, vx, vy, r, dmg: d, kind, pierce, foe: false, age: 0 });

    if (chain) {
      push(0, 0, -360, 'chain', dmg, 13, 3);
    } else {
      push(-5, 0, -640, 'ball', dmg, 4, heavy ? 2 : 1);
      push(5, 0, -640, 'ball', dmg, 4, heavy ? 2 : 1);
    }
    if (s.buffs.swivel !== 0) {
      push(-11, -190, -580, 'ball', dmg * 0.6, 3.4, 1);
      push(11, 190, -580, 'ball', dmg * 0.6, 3.4, 1);
    }
    s.cool = st.fireInterval * (s.buffs.powder > 0 ? 0.6 : 1);
    ev(w, 'cannon', { x: s.x, y: s.y - 20 });
  }

  if (input.mortar && s.shells > 0) {
    s.shells--;
    // The shell leads your own drift, so aiming it is a steering problem too.
    const x = clamp(s.x + s.vx * 0.35, 30, W - 30);
    w.marks.push({ x, y: MORTAR_Y, r: 78, t: MORTAR_FUSE, max: MORTAR_FUSE, own: true, dmg: 7 });
    ev(w, 'mortar', { x, y: MORTAR_Y });
  }
}

/* --------------------------------------------------------------- spawn --- */

function spawn(w, dt) {
  const p = w.plan;
  while (w.gi < p.groups.length && w.t >= p.groups[w.gi].at) spawnGroup(w, p.groups[w.gi++]);
}

function spawnGroup(w, g) {
  const base = 46 + g.x * (W - 92);
  if (g.cls === 'reef') { w.rocks.push({ x: clamp(base, 28, W - 28), y: -40, r: 16 + w.r() * 17, sd: w.r() * 6.28 }); return; }
  if (g.cls === 'spout') { w.spouts.push({ x: clamp(base, 60, W - 60), y: -60, r: 44, ph: 0 }); return; }
  if (g.cls === 'legend') { addLegend(w, legendById(g.legend)); return; }

  for (let i = 0; i < g.n; i++) {
    const o = (i - (g.n - 1) / 2);
    let x = base, y = 28;
    if (g.pat === 'line')    { x = base + o * 46; }
    else if (g.pat === 'vee'){ x = base + o * 44; y = 28 - Math.abs(o) * 26; }
    else if (g.pat === 'stagger') { x = base + o * 54; y = 28 - i * 30; }
    else if (g.pat === 'column')  { y = 28 - i * 52; }
    else if (g.pat === 'sides')   { x = i % 2 ? W - 52 : 52; y = 28 - i * 34; }
    addFoe(w, g.cls, clamp(x, 26, W - 26), y);
  }
}

function addFoe(w, cls, x, y, extra = {}) {
  const C = CLASSES[cls];
  const e = {
    id: w.nextId++, cls, C, x, y,
    hull: C.hull, hullMax: C.hull,
    rx: C.w / 2, ry: C.l / 2,
    cool: 0.8 + w.r() * 1.2, ph: w.r() * 6.28,
    struck: false, struckOnce: false, strikeT: 0, spent: false,
    flash: 0, hit: 0, list: 0, scorch: w.r(), mastGone: 0, chase: 0, broad: 0,
    hunter: false, dead: false, seen: false, ...extra,
  };
  w.foes.push(e);
  return e;
}

function addLegend(w, L) {
  const e = {
    id: w.nextId++, cls: 'legend', legend: L, C: { name: L.name, reales: L.reales, ram: 22, str: false },
    x: W / 2, y: -110, hull: L.hull, hullMax: L.hull,
    rx: L.w / 2, ry: L.l / 2,
    cool: 3.4, ph: 0, phase: 0, entered: false, spin: 0,
    struck: false, struckOnce: false, strikeT: 0, spent: false,
    flash: 0, hit: 0, list: 0, scorch: 0, mastGone: 0, dead: false, seen: false,
    ports: Array.from({ length: L.ports }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      return { dx: side * L.w * 0.36, dy: -L.l * 0.22 + row * L.l * 0.26, hull: 8, dead: false };
    }),
  };
  w.foes.push(e);
  w.boss = e;
  ev(w, 'legend', { name: L.name });
  return e;
}

/** Notoriety's teeth. Three flags puts frigates on the flanks; five brings a legendary. */
function hunt(w, dt) {
  // Counted rather than tallied — a hunter that strikes her colours has stopped hunting,
  // and a decrement in sink() would have missed that.
  w.hunters = 0;
  for (const e of w.foes) if (e.hunter && !e.struck && !e.spent) w.hunters++;

  if (w.heat >= HUNTER_AT) {
    w.hunterT -= dt;
    if (w.hunterT <= 0 && w.hunters < 2) {
      const left = w.r() < 0.5;
      addFoe(w, 'frigate', left ? -30 : W + 30, 300 + w.r() * 120, { hunter: true });
      w.hunters++;
      w.hunterT = 16;
      ev(w, 'hunter', {});
    }
  }
  if (w.heat >= EARLY_LEGEND_AT && !w.earlyLegend && !w.plan.boss && !w.boss) {
    w.earlyLegend = true;
    addLegend(w, LEGENDS[Math.floor(w.r() * LEGENDS.length)]);
  }
}

/* ----------------------------------------------------------------- ai ---- */

function stepFoe(w, e, dt) {
  if (e.cls === 'legend') return stepLegend(w, e, dt);
  const s = w.ship;
  e.hit = Math.max(0, e.hit - dt * 4);
  e.flash = Math.max(0, e.flash - dt * 5);

  const far = e.y < HORIZON;
  let vy = e.C.speed * w.speedMul;

  if (e.spent) {
    // Abandoned and running before the wind. Nothing to gain, so get her off the water.
    vy *= 1.8;
    e.x += Math.sin(w.t * 0.9 + e.ph) * 18 * dt;
  } else if (e.struck) {
    e.strikeT -= dt;
    // A struck ship has no way on and no helm: she stops being a ship and becomes a hulk
    // drifting down on the current, at the current's speed, whatever she used to be.
    // This constant is what actually sets the difficulty of boarding — not the window.
    // Halving her own speed instead (which is what "she has lost way" first suggested)
    // stranded every prize up-screen and a beeline bot took one in six of them at ANY
    // window length. Measured over thirty simulated waves, a bot that chases every prize
    // and ignores everything else takes: x1.0 → 44%, x1.15 → 55%, x1.3 → 74%, x1.7 → 100%.
    // 1.15 is the one where the chase is still a commitment and the run still kills you.
    vy = SCROLL * 1.15;
    e.list += (0.28 - e.list) * dt * 2;
    if (e.strikeT <= 0) {
      e.spent = true;
      // She got away with a crew who saw your face. That is the price of leaving prizes
      // on the water, and it is what makes the flags climb for a captain who never boards.
      w.heat = clamp(w.heat + heatEscaped(e.hullMax), 0, HEAT_MAX);
      ev(w, 'lost-prize', { x: e.x, y: e.y });
    }
  } else if (e.hunter) {
    // Hunters do not descend, they hold station off your quarter and work you over.
    const ty = clamp(s.y - 250, 200, 560);
    const dx = s.x - e.x, dy = ty - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    e.x += (dx / d) * 66 * dt;
    e.y += (dy / d) * 66 * dt;
    vy = 0;
  } else if (e.cls === 'brulote') {
    e.chase += dt;
    vy *= 1 + Math.min(1.5, e.chase * 0.38);     // she never stops gathering way
    const dx = s.x - e.x;
    e.x += Math.sign(dx) * Math.min(Math.abs(dx), 82 * dt);
  } else if (e.cls === 'lancha') {
    e.x += Math.sin(w.t * 2.6 + e.ph) * 64 * dt;
  } else if (e.cls === 'schooner') {
    const dx = s.x - e.x;
    e.x += Math.sign(dx) * Math.min(Math.abs(dx), 34 * dt);
  }

  // A hunter holds station, so she moves herself above. Once she strikes she is no
  // longer hunting anything and drifts off with the rest of the wrecks.
  if (!e.hunter || e.struck || e.spent) e.y += vy * dt;
  e.x = clamp(e.x, 16, W - 16);

  if (far || e.struck || e.spent || !e.C.guns) return;
  if (e.y > 640) return;                          // past you, no longer a threat worth a shot

  // The frigate telegraphs: she turns her beam to you for the better part of a second
  // before the wall of five comes out. Reading that turn is the whole answer to her.
  if (e.C.guns === 'broadside' && e.broad > 0) {
    e.broad -= dt;
    if (e.broad <= 0) { fireBroadside(w, e); e.cool = e.C.reload * w.reloadMul; }
    return;
  }

  e.cool -= dt;
  if (e.cool > 0) return;
  if (e.C.guns === 'broadside') { e.broad = 0.8; return; }
  fire(w, e);
  e.cool = e.C.reload * w.reloadMul;
}

function foeShot(w, e, vx, vy, dmg = 3, r = 4.4) {
  w.shots.push({ x: e.x, y: e.y + e.ry * 0.6, vx, vy, r, dmg, kind: 'ball', pierce: 1, foe: true, age: 0 });
  e.flash = 1;
}

function fire(w, e) {
  const s = w.ship;
  if (e.C.guns === 'aimed') {
    const dx = s.x - e.x, dy = s.y - e.y, d = Math.max(1, Math.hypot(dx, dy));
    foeShot(w, e, (dx / d) * 250, (dy / d) * 250);
  } else if (e.C.guns === 'spread') {
    for (const a of [-0.22, 0.22]) foeShot(w, e, Math.sin(a) * 230, Math.cos(a) * 230);
  } else if (e.C.guns === 'mortar') {
    const n = 2 + (w.r() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      w.marks.push({
        x: clamp(s.x + (w.r() - 0.5) * 190, 30, W - 30),
        y: clamp(s.y + (w.r() - 0.5) * 120, 420, H - 60),
        r: 58, t: 1.5, max: 1.5, own: false, dmg: 5,
      });
    }
    ev(w, 'mortar-in', { x: e.x, y: e.y });
  }
  ev(w, 'foe-fire', { x: e.x, y: e.y });
}

function fireBroadside(w, e) {
  for (let i = 0; i < 5; i++) {
    const off = (i - 2) * 26;
    w.shots.push({ x: e.x + off, y: e.y + e.ry * 0.5, vx: off * 0.5, vy: 235, r: 4.4, dmg: 3, kind: 'ball', pierce: 1, foe: true, age: 0 });
  }
  e.flash = 1;
  ev(w, 'foe-fire', { x: e.x, y: e.y, big: true });
}

/* ------------------------------------------------------------ legends ---- */

function stepLegend(w, e, dt) {
  const s = w.ship, L = e.legend;
  e.hit = Math.max(0, e.hit - dt * 4);
  e.flash = Math.max(0, e.flash - dt * 5);

  if (!e.entered) {
    e.y += L.speed * 1.6 * dt;
    if (e.y >= 196) { e.entered = true; e.y = 196; }
    return;
  }

  const frac = e.hull / e.hullMax;
  const phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  if (phase !== e.phase) { e.phase = phase; e.cool = 1.2; ev(w, 'legend-phase', { n: phase }); }

  e.spin += dt;
  const amp = L.pattern === 'spiral' ? 118 : 92;
  e.x = W / 2 + Math.sin(e.spin * (0.42 + phase * 0.16)) * amp;
  // La Fortuna would rather run you down than out-shoot you, so every phase she takes
  // brings her further down the screen. The others hold their station.
  e.y = 196 + (L.pattern === 'spiral' ? phase * 62 : 0) + Math.sin(e.spin * 0.31) * 26;

  e.cool -= dt;
  if (e.cool > 0) return;
  const live = e.ports.filter((p) => !p.dead).length;
  const power = live / e.ports.length;
  const reload = (2.6 - phase * 0.5) * (0.55 + power * 0.6) * w.reloadMul;

  if (L.pattern === 'sweep') {
    const sweep = Math.sin(e.spin * 0.8);
    for (let i = 0; i < 6 + phase; i++) {
      const x = 40 + ((i / (5 + phase)) * (W - 80));
      w.shots.push({ x, y: e.y + e.ry * 0.4, vx: sweep * 40, vy: 210, r: 5, dmg: 4, kind: 'ball', pierce: 1, foe: true, age: 0 });
    }
  } else if (L.pattern === 'shroud') {
    if (w.r() < 0.5 + phase * 0.2) { addFoe(w, 'lancha', e.x - 40, e.y + 30); addFoe(w, 'lancha', e.x + 40, e.y + 30); }
    for (let i = -1 - phase; i <= 1 + phase; i++) {
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.max(1, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx) + i * 0.16;
      w.shots.push({ x: e.x, y: e.y, vx: Math.cos(a) * 245, vy: Math.sin(a) * 245, r: 4.6, dmg: 4, kind: 'ball', pierce: 1, foe: true, age: 0 });
    }
  } else if (L.pattern === 'rain') {
    for (let i = 0; i < 3 + phase; i++) {
      w.marks.push({
        x: clamp(s.x + (w.r() - 0.5) * 240, 30, W - 30),
        y: clamp(s.y + (w.r() - 0.5) * 200, 400, H - 50),
        r: 56, t: 1.45, max: 1.45, own: false, dmg: 5,
      });
    }
    ev(w, 'mortar-in', { x: e.x, y: e.y });
  } else {
    const n = 8 + phase * 3;
    for (let i = 0; i < n; i++) {
      const a = e.spin * 1.6 + (i / n) * Math.PI * 2;
      w.shots.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.abs(Math.sin(a)) * 120 + 90, r: 4.6, dmg: 4, kind: 'ball', pierce: 1, foe: true, age: 0 });
    }
  }
  e.flash = 1;
  e.cool = reload;
  ev(w, 'foe-fire', { x: e.x, y: e.y, big: true });
}

/* ------------------------------------------------------------ damage ----- */

/** The one rule the whole game turns on: a ship that can strike her colours always
 *  gets to, exactly once, instead of dying. So every kill is a decision you made
 *  with a white flag already up. */
function hurt(w, e, dmg, x, y) {
  if (e.dead) return;
  if (e.cls === 'legend') return hurtLegend(w, e, dmg, x, y);
  e.hull -= dmg;
  e.hit = 1;

  if (e.C.str && !e.struckOnce && e.hull <= e.hullMax * STRIKE_AT) {
    e.struckOnce = true; e.struck = true; e.strikeT = STRIKE_WINDOW;
    e.hull = e.hullMax * STRIKE_AT;
    e.mastGone = 1;
    ev(w, 'strike', { x: e.x, y: e.y });
    return;
  }
  if (e.hull <= 0) sink(w, e, false);
}

function hurtLegend(w, e, dmg, x, y) {
  // Gun ports are the weak point, and the only way to hurt her fast. Everywhere else
  // is oak a foot thick.
  let best = null, bd = 26;
  for (const p of e.ports) {
    if (p.dead) continue;
    const d = Math.hypot((e.x + p.dx) - x, (e.y + p.dy) - y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) {
    best.hull -= dmg;
    e.hull -= dmg * 3;
    if (best.hull <= 0) { best.dead = true; ev(w, 'port-down', { x: e.x + best.dx, y: e.y + best.dy }); }
  } else {
    e.hull -= dmg * 0.35;
  }
  e.hit = 1;
  if (e.hull <= 0) sink(w, e, false);
}

function sink(w, e, byBoard) {
  if (e.dead) return;
  e.dead = true;
  const reales = e.cls === 'legend' ? e.legend.reales : e.C.reales;

  if (byBoard) {
    w.plunder += reales * 2;
    w.boarded++;
    w.heat = clamp(w.heat + heatBoarded(e.hullMax), 0, HEAT_MAX);
    w.ship.hull = Math.min(w.ship.hullMax, w.ship.hull + w.stats.boardRepair);
    ev(w, 'board', { x: e.x, y: e.y, reales: reales * 2 });
  } else {
    w.plunder += reales;
    w.sunk++;
    // Only a ship that had already struck costs you notoriety — and the only thing that
    // can sink one now is a mortar shell, so it is a decision, not a side effect.
    if (e.struckOnce) w.heat = clamp(w.heat + heatSunk(e.hullMax), 0, HEAT_MAX);
    ev(w, 'boom', { x: e.x, y: e.y, big: e.cls === 'legend' || e.cls === 'manowar', reales });
  }

  if (e.cls === 'brulote') {
    // She goes up whether she reached you or not — dying is her attack too.
    w.marks.push({ x: e.x, y: e.y, r: 62, t: 0.35, max: 0.35, own: false, dmg: 8 });
  }
  if (e.cls === 'legend') {
    w.boss = null;
    w.shake = 1.4;
    ev(w, 'legend-down', { id: e.legend.id, name: e.legend.name, x: e.x, y: e.y });
  }
  if (e.hunter) w.hunters = Math.max(0, w.hunters - 1);

  const d = rollDrop(w.r, byBoard);
  if (d) w.drops.push({ x: e.x, y: e.y, kind: d.id, dur: d.dur, spin: 0 });
  w.shake = Math.max(w.shake, e.cls === 'legend' ? 1.4 : e.hullMax > 12 ? 0.7 : 0.35);
}

function wound(w, dmg) {
  const s = w.ship;
  if (w.phase !== 'fight' || s.invuln > 0) return;
  s.hull -= dmg;
  w.shake = Math.max(w.shake, 0.5);
  ev(w, 'hit', { x: s.x, y: s.y, dmg });
  if (s.hull > 0) return;

  s.hull = 0;
  w.lives--;
  if (w.lives <= 0) { w.phase = 'lost'; ev(w, 'dead', {}); return; }
  // Refit: full hull, two seconds of grace, and the water round you cleared so the
  // frame you come back on is not the frame you die on again.
  s.hull = s.hullMax;
  s.invuln = 2;
  s.x = W / 2;
  w.shots = w.shots.filter((sh) => !sh.foe);
  w.marks = w.marks.filter((m) => m.own);
  ev(w, 'refit', { lives: w.lives });
}

/* ---------------------------------------------------------- collisions --- */

const near = (ax, ay, arx, ary, bx, by, br) => {
  const dx = ax - bx, dy = ay - by, rx = arx + br, ry = ary + br;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
};

function collide(w, dt) {
  const s = w.ship;

  for (const sh of w.shots) {
    if (sh.dead) continue;

    if (sh.foe) {
      if (s.invuln <= 0 && near(s.x, s.y, 15, 23, sh.x, sh.y, sh.r)) { sh.dead = true; wound(w, sh.dmg); }
      continue;
    }
    for (const e of w.foes) {
      // The gun crews will not fire on a struck ship, and round shot passes over her.
      // This is a departure from the plan and it is load-bearing: your bow chasers point
      // exactly where a prize is, so with auto-fire every ship that struck died about a
      // third of a second later and boarding never happened once in sixty simulated waves.
      // Sinking a prize is still available — it is what the mortar is for.
      if (e.dead || e.spent || e.struck || e.y < HORIZON - 20) continue;
      if (!near(e.x, e.y, e.rx, e.ry, sh.x, sh.y, sh.r)) continue;
      hurt(w, e, sh.dmg, sh.x, sh.y);
      ev(w, 'thud', { x: sh.x, y: sh.y });
      if (--sh.pierce <= 0) { sh.dead = true; break; }
    }
    if (sh.dead) continue;
    for (const k of w.rocks) {
      if (Math.hypot(k.x - sh.x, k.y - sh.y) < k.r + sh.r) { sh.dead = true; ev(w, 'thud', { x: sh.x, y: sh.y, rock: true }); break; }
    }
  }

  for (const e of w.foes) {
    if (e.dead || e.y < HORIZON) continue;
    if (!near(e.x, e.y, e.rx, e.ry, s.x, s.y, 15)) continue;
    if (e.struck && e.strikeT > 0 && !e.spent) { sink(w, e, true); continue; }
    if (s.invuln > 0) continue;
    if (e.cls === 'legend') { wound(w, 8); s.x += Math.sign(s.x - e.x) * 26; continue; }
    // Ramming hurts you both. Yours is the better hull, which is the only reason it is
    // ever worth doing to a lancha.
    wound(w, e.C.ram);
    hurt(w, e, w.stats.ramDmg, s.x, s.y);
    s.ram = 0.25;
    s.x = clamp(s.x + Math.sign(s.x - e.x || 1) * 22, 22, W - 22);
  }

  if (s.invuln <= 0) {
    for (const k of w.rocks) {
      if (Math.hypot(k.x - s.x, k.y - s.y) < k.r + 14) {
        wound(w, 5);
        s.x = clamp(s.x + Math.sign(s.x - k.x || 1) * 30, 22, W - 22);
        s.invuln = Math.max(s.invuln, 0.5);
      }
    }
  }

  for (const d of w.drops) {
    if (d.dead || Math.hypot(d.x - s.x, d.y - s.y) > 30) continue;
    d.dead = true;
    take(w, d);
  }
}

function take(w, d) {
  const s = w.ship;
  if (d.kind === 'rum') s.hull = Math.min(s.hullMax, s.hull + 7);
  else if (d.kind === 'shells') s.shells = Math.min(s.shellsMax + 3, s.shells + 3);
  else if (d.kind === 'swivel') s.buffs.swivel = -1;      // -1 is "the rest of this wave"
  else s.buffs[d.kind] = 12;
  ev(w, 'take', { kind: d.kind, x: d.x, y: d.y });
}

/* ---------------------------------------------------------- telegraphs --- */

function marks(w, dt) {
  for (const m of w.marks) {
    m.t -= dt;
    if (m.t > 0) continue;
    m.done = true;
    if (m.own) {
      for (const e of w.foes) {
        if (e.dead || e.y < HORIZON) continue;
        // The shell's own landing point, not the ship's centre — a mortar dropped on a
        // legendary's gun ports has to count as a gun-port hit.
        if (Math.hypot(e.x - m.x, e.y - m.y) < m.r + e.rx * 0.6) hurt(w, e, m.dmg, m.x, m.y);
      }
    } else if (Math.hypot(w.ship.x - m.x, w.ship.y - m.y) < m.r) {
      wound(w, m.dmg);
    }
    w.shake = Math.max(w.shake, 0.6);
    ev(w, 'boom', { x: m.x, y: m.y, big: m.r > 60, splash: true });
  }
}

/* ------------------------------------------------------------- tidy up --- */

function cull(w) {
  w.shots = w.shots.filter((s) => !s.dead && s.y > -60 && s.y < H + 60 && s.x > -60 && s.x < W + 60 && s.age < 6);
  w.foes = w.foes.filter((e) => !e.dead && e.y < H + 100);
  w.drops = w.drops.filter((d) => !d.dead && d.y < H + 40);
  w.rocks = w.rocks.filter((k) => k.y < H + 60);
  w.spouts = w.spouts.filter((p) => p.y < H + 80);
  w.marks = w.marks.filter((m) => !m.done);
  if (w.boss && w.boss.dead) w.boss = null;
}

function finish(w) {
  if (w.phase !== 'fight') return;
  if (w.gi < w.plan.groups.length) return;
  if (w.t < w.plan.last + 1) return;
  if (w.foes.some((e) => !e.spent)) return;
  w.phase = 'won';
  ev(w, 'won', { wave: w.wave });
}

/* -------------------------------------------------------------- readers -- */

export const heatOf = (w) => w.heat;
export const alive = (w) => w.phase === 'fight';

/** True while a foe is a prize rather than an obstacle. The renderer and the HUD
 *  both ask this rather than each deciding for themselves. */
export const isPrize = (e) => e.struck && e.strikeT > 0 && !e.spent && !e.dead;

/**
 * A compact fingerprint of the entire simulation. test.mjs runs two identical
 * headless battles and compares these — if a floating-point path drifts, or someone
 * reaches for Math.random() in here, the strings stop matching.
 */
export function digest(w) {
  const n = (v) => (Math.round(v * 1e6) / 1e6 + 0);
  const head = [w.t, w.plunder, w.heat, w.lives, w.sunk, w.boarded, w.ship.x, w.ship.hull, w.ship.shells].map(n);
  const foes = w.foes.map((e) => `${e.cls}:${n(e.x)},${n(e.y)},${n(e.hull)},${e.struck ? 1 : 0}${e.spent ? 'x' : ''}`);
  const rest = [w.shots.length, w.drops.length, w.rocks.length, w.marks.length, w.gi, w.phase];
  return [...head, foes.join('|'), ...rest].join(';');
}
