// The simulation.
//
// Pure. No three.js, no DOM, no clock of its own — the whole surface is create(),
// step(world, dt, input) and digest(). That is what buys the self-check: the tests run
// headless battles at a fixed timestep and get the same answer every time.
//
// Nothing in here calls Date.now() or Math.random(). Every roll goes through w.r.

import { rng } from '../core/rng';
import { clamp, q6 } from '../core/vec';
import { HEAT, HEAT_MAX } from '../data/notoriety';
import { shipById } from '../data/ships';
import { shipStats } from '../data/upgrades';
import { wavePlan } from '../data/waves';
import { stepFoe, sweep } from './ai';
import { ESCAPE_TIME, boarding, flyShots, hostile, hurt, landMarks, playerGuns, sink, wound } from './combat';
import { makeMap, type GameMap } from './map';
import { ground, helm, hullGap, rim, rimHelm, separate } from './sailing';
import { hunt, release } from './spawn';
import { stormDrift } from './weather';
import { ev, type Input, type Player, type World } from './types';

export { STRIKE_WINDOW, STRIKE_AT, BOARD_TIME, ESCAPE_TIME, isPrize, hostile, sideVec } from './combat';

/** The bit of a run a wave starts from. Read, never written — see bankWave. */
export interface RunSeed {
  seed?: string;
  ship?: string;
  upgrades?: Record<string, number>;
  heat?: number;
  plunder?: number;
  lives?: number;
  boarded?: number;
  sunk?: number;
}

const maps = new Map<string, GameMap>();
/** The chart is a pure function of the run's seed, so it is built once and kept. */
export function mapFor(seed: string): GameMap {
  let m = maps.get(seed);
  if (!m) { m = makeMap(seed); maps.set(seed, m); if (maps.size > 8) maps.delete(maps.keys().next().value!); }
  return m;
}

export const NO_INPUT: Input = { heading: null, rudder: 0, sail: 0, fireL: false, fireR: false, mortar: false };

export function create(opts: { seed?: string; wave?: number; run?: RunSeed; reduce?: boolean } = {}): World {
  const { seed = 'jackdaw', wave = 1, run = {}, reduce = false } = opts;
  const def = shipById(run.ship);
  const stats = shipStats(def, run.upgrades || {});
  const map = mapFor(seed);
  const plan = wavePlan(wave, rng(`${seed}:plan:${wave}`));
  const st = map.start;
  const ship: Player = {
    id: 0, x: st.x, y: st.y, h: st.h, v: stats.maxSpeed * 0.3, rot: 0, sail: 0.6,
    len: stats.len, beam: stats.beam, maxSpeed: stats.maxSpeed, accel: stats.accel, turnRate: stats.turnRate,
    hull: stats.hullMax, hullMax: stats.hullMax, hit: 0, dead: false,
    cool: [0, 0], volley: null, bowCool: 0.5,
    shells: stats.shellsMax, shellsMax: stats.shellsMax,
    invuln: 1.5, ramT: 0, groundT: 0,
    buffs: { powder: 0, heavy: 0, chain: 0, swivel: 0 },
    board: null, aim: null, rim: false,
  };
  return {
    seed, wave, shipId: def.id, map, plan, stats, reduce,
    r: rng(`${seed}:sim:${wave}`),
    weather: plan.weather,
    t: 0, gi: 0, quiet: 0, nextId: 1,
    phase: 'fight',
    heat: clamp(run.heat ?? 0, 0, HEAT_MAX),
    plunder: run.plunder ?? 0,
    lives: run.lives ?? stats.lives,
    boarded: run.boarded ?? 0,
    sunk: run.sunk ?? 0,
    // Escalation is gentle and in two places only: they sail faster and reload faster.
    speedMul: 1 + (wave - 1) * 0.012,
    reloadMul: Math.pow(0.975, wave - 1),
    drift: { x: 0, y: 0 }, shake: 0,
    ship, foes: [], shots: [], drops: [], marks: [], spouts: [], squads: [],
    boss: null, hunterT: 10, earlyLegend: false,
    events: [],
  };
}

/**
 * One tick. Feed it a fixed dt and the run replays exactly. The wave keeps being
 * stepped after it is won: the sea is still there, and you still have to sail home.
 */
export function step(w: World, dt: number, input: Input = NO_INPUT): World {
  if (w.phase === 'lost' || w.phase === 'docked') return w;

  w.t += dt;
  w.shake = Math.max(0, w.shake - dt * 2.6);
  if (w.phase === 'fight') w.heat = clamp(w.heat + HEAT.perSecond * dt, 0, HEAT_MAX);
  w.drift = w.weather === 'storm' ? stormDrift(w.t, w.reduce) : { x: 0, y: 0 };

  sail(w, dt, input);
  playerGuns(w, dt, input);
  if (w.phase === 'fight') { release(w, dt); hunt(w, dt); }
  sweep(w, dt);

  for (const e of w.foes) if (!e.dead) stepFoe(w, e, dt);
  flyShots(w, dt);
  landMarks(w, dt);
  hulls(w);
  boarding(w, dt);
  flotsam(w, dt);

  cull(w);
  finish(w);
  return w;
}

/* ---------------------------------------------------------------- helm --- */

function sail(w: World, dt: number, input: Input) {
  const s = w.ship;
  const was = s.rim;
  const back = rimHelm(s);
  if (back != null && !was) ev(w, 'rim', { x: s.x, y: s.y });
  helm(s, dt, back ?? input.heading, back != null ? 0 : input.rudder, input.sail);
  s.x += w.drift.x * dt;
  s.y += w.drift.y * dt;

  // A waterspout pulls rather than pushes — you can sail out, it just costs you the turn.
  for (const p of w.spouts) {
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), reach = p.r * 4;
    if (d < reach && d > 1) {
      const k = (1 - d / reach) * 16 * dt * (w.reduce ? 0.5 : 1);
      s.x += (dx / d) * k; s.y += (dy / d) * k;
      if (d < p.r && s.groundT <= 0) { wound(w, 3, 'spout', s.x, s.y); s.groundT = 0.6; }
    }
  }

  s.groundT = Math.max(0, s.groundT - dt);
  const hit = ground(w.map, s);
  if (hit > 3.5 && s.groundT <= 0) { wound(w, 2 + hit * 0.35, 'ground'); s.groundT = 1; ev(w, 'ground', { x: s.x, y: s.y }); }
  for (const k of w.map.reefs) {
    const d = Math.hypot(k.x - s.x, k.y - s.y);
    if (d < k.r + s.beam * 0.5) {
      const nx = (s.x - k.x) / (d || 1), ny = (s.y - k.y) / (d || 1);
      s.x = k.x + nx * (k.r + s.beam * 0.5); s.y = k.y + ny * (k.r + s.beam * 0.5);
      if (s.groundT <= 0) { wound(w, 5, 'ground'); s.groundT = 1; s.v *= 0.5; ev(w, 'ground', { x: s.x, y: s.y, reef: true }); }
    }
  }
  rim(s, dt, 0.5);

  s.invuln = Math.max(0, s.invuln - dt);
  s.ramT = Math.max(0, s.ramT - dt);
  s.hit = Math.max(0, s.hit - dt * 4);
  const b = s.buffs;
  for (const k of ['powder', 'heavy', 'chain'] as const) if (b[k] > 0) b[k] = Math.max(0, b[k] - dt);
}

/* ------------------------------------------------------------ collisions -- */

function hulls(w: World) {
  const s = w.ship;
  for (const e of w.foes) {
    if (e.dead) continue;
    if (Math.abs(e.x - s.x) > (e.len + s.len) || Math.abs(e.y - s.y) > (e.len + s.len)) continue;
    const gap = hullGap(s, e);
    if (gap >= 0) continue;
    const big = e.L ? 0.85 : e.len > s.len * 1.3 ? 0.7 : 0.5;
    separate(s, e, gap, big);
    if (e.state === 'struck' || e.state === 'spent') continue;
    if (e.cls === 'brulote') { sink(w, e, false); continue; }
    if (s.invuln > 0 || s.ramT > 0) continue;
    // Ramming hurts you both. Yours is the better hull, which is the only reason it is
    // ever worth doing to a lancha.
    wound(w, e.ram, 'ram');
    if (!e.L) hurt(w, e, w.stats.ramDmg, s.x, s.y);
    s.ramT = 0.7;
    s.v *= 0.6;
    ev(w, 'ram', { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 });
  }
  // Spaniards keep off each other too, or a squadron sails as one hull.
  for (let i = 0; i < w.foes.length; i++) {
    const a = w.foes[i];
    if (a.dead) continue;
    for (let j = i + 1; j < w.foes.length; j++) {
      const b = w.foes[j];
      if (b.dead) continue;
      if (Math.abs(a.x - b.x) > (a.len + b.len) * 0.6 || Math.abs(a.y - b.y) > (a.len + b.len) * 0.6) continue;
      const gap = hullGap(a, b);
      if (gap < 0) separate(a, b, gap, 0.5);
    }
  }
}

/* --------------------------------------------------------------- flotsam -- */

function flotsam(w: World, dt: number) {
  const s = w.ship;
  for (const d of w.drops) {
    d.age += dt;
    if (d.dead) continue;
    if (Math.hypot(d.x - s.x, d.y - s.y) < s.len * 0.5 + 6) { d.dead = true; take(w, d.kind, d.x, d.y); }
    else if (d.age > 40) d.dead = true;
  }
  for (const p of w.spouts) {
    p.age += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}

function take(w: World, kind: string, x: number, y: number) {
  const s = w.ship;
  if (kind === 'rum') s.hull = Math.min(s.hullMax, s.hull + s.hullMax * 0.3);
  else if (kind === 'shells') s.shells = Math.min(s.shellsMax + 3, s.shells + 3);
  else if (kind === 'swivel') s.buffs.swivel = -1;      // -1 is "the rest of this wave"
  else s.buffs[kind as 'powder' | 'heavy' | 'chain'] = 12;
  ev(w, 'take', { kind, x, y });
}

/* --------------------------------------------------------------- tidy up -- */

/** filter() in place — the order is kept exactly, so the digest does not move. */
function keep<T>(a: T[], ok: (x: T) => boolean) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (ok(a[i])) a[n++] = a[i];
  a.length = n;
}

function cull(w: World) {
  keep(w.shots, (s) => !s.dead);
  keep(w.foes, (e) => {
    if (e.dead) return false;
    if (e.state === 'spent' && e.spentT >= ESCAPE_TIME) {
      ev(w, 'gone', { id: e.id });
      return false;
    }
    return true;
  });
  keep(w.drops, (d) => !d.dead);
  keep(w.marks, (m) => !m.done);
  keep(w.spouts, (p) => p.age < p.life);
  if (w.boss && w.boss.dead) w.boss = null;
}

/* ----------------------------------------------------------------- ends -- */

function finish(w: World) {
  if (w.phase === 'fight') {
    if (w.gi < w.plan.groups.length) return;
    // A prize still inside her window is still a decision; the wave waits for it.
    if (w.foes.some((e) => hostile(e) || (e.state === 'struck' && e.strikeT > 0))) return;
    w.phase = 'clear';
    ev(w, 'won', { wave: w.wave });
  }
  if (w.phase === 'clear') {
    if (atNassau(w)) { w.phase = 'docked'; ev(w, 'dock', {}); }
  }
}

/** Home: the harbour mouth, or close enough under Nassau's lee from any side — the
 *  beacon points at the harbour, and a captain who comes in from the north should not
 *  have to find his way round the island to be allowed to stop. */
export function atNassau(w: World): boolean {
  const h = w.map.harbour, n = w.map.nassau, s = w.ship;
  return Math.hypot(s.x - h.x, s.y - h.y) < h.r || Math.hypot(s.x - n.x, s.y - n.y) < n.r * 1.4 + 45;
}

/* -------------------------------------------------------------- readers -- */

export const alive = (w: World) => w.phase === 'fight' || w.phase === 'clear';

/**
 * A compact fingerprint of the entire simulation. The tests run two identical headless
 * battles and compare these — if a float path drifts, or someone reaches for
 * Math.random() in here, the strings stop matching.
 */
export function digest(w: World): string {
  const s = w.ship;
  const head = [w.t, w.plunder, w.heat, w.lives, w.sunk, w.boarded, s.x, s.y, s.h, s.hull, s.shells].map(q6);
  const foes = w.foes.map((e) => `${e.cls}:${q6(e.x)},${q6(e.y)},${q6(e.h)},${q6(e.hull)},${e.state[0]}`);
  const rest = [w.shots.length, w.drops.length, w.marks.length, w.spouts.length, w.gi, w.phase];
  return [...head, foes.join('|'), ...rest].join(';');
}
