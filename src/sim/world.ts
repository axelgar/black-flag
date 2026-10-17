// The simulation.
//
// Pure. No three.js, no DOM, no clock of its own — the whole surface is create(),
// step(world, dt, inputs) and digest(). That is what buys the self-check: the tests run
// headless battles at a fixed timestep and get the same answer every time.
//
// Nothing in here calls Date.now() or Math.random(). Every roll goes through w.r.
//
// A world holds any number of captains (`players`). On your own it is one; on a shared
// sea it is everyone, each ship steered by her captain's input, in the same fixed order,
// so a server can step the one world everyone sees. A world with one captain plays
// exactly as the game did before there could be more: same rolls, same digest.

import { rng } from '../core/rng';
import { clamp, q6 } from '../core/vec';
import { HEAT, HEAT_MAX } from '../data/notoriety';
import { PACE } from '../data/pace';
import { shipById } from '../data/ships';
import { shipStats } from '../data/upgrades';
import { wavePlan } from '../data/waves';
import { stepFoe, sweep } from './ai';
import { ESCAPE_TIME, boarding, flyShots, hostile, hurt, landMarks, playerGuns, sink, wound } from './combat';
import { makeMap, openWater, type GameMap } from './map';
import { ground, helm, hullGap, rim, rimHelm, separate } from './sailing';
import { hunt, release } from './spawn';
import { stormDrift } from './weather';
import { afloat, ev, type Input, type Player, type World } from './types';

export { STRIKE_WINDOW, STRIKE_AT, BOARD_TIME, ESCAPE_TIME, isPrize, hostile, sideVec } from './combat';
export { you, afloat, nearest } from './types';

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

/** One captain's place in a world: their run, who they are, and which side they are on. */
export interface Seat extends RunSeed {
  seat?: string;
  /** Captains on one team cannot hurt each other. Left out, everyone shares a team, or
   *  with `pvp` each captain is a team of their own. */
  team?: number;
}

const maps = new Map<string, GameMap>();
/** The chart is a pure function of the run's seed, so it is built once and kept. */
export function mapFor(seed: string): GameMap {
  let m = maps.get(seed);
  if (!m) { m = makeMap(seed); maps.set(seed, m); if (maps.size > 8) maps.delete(maps.keys().next().value!); }
  return m;
}

export const NO_INPUT: Input = { heading: null, rudder: 0, sail: 0, fireL: false, fireR: false, mortar: false };

export function create(opts: {
  seed?: string; wave?: number; run?: RunSeed; players?: Seat[]; pvp?: boolean; reduce?: boolean;
  /** A shared sea (see World.shared), with room for this many captains. */
  shared?: number;
} = {}): World {
  const { seed = 'jackdaw', wave = 1, run = {}, reduce = false, pvp = false } = opts;
  const seats: Seat[] = opts.players?.length ? opts.players : [run];
  const map = mapFor(seed);
  const plan = wavePlan(wave, rng(`${seed}:plan:${wave}`));
  const players = seats.map((s, i) => launch(map, s, i, pvp));
  const cap = Math.max(players.length, opts.shared ?? 0);
  return {
    seed, wave, map, plan, reduce, pvp, shared: !!opts.shared, cap,
    r: rng(`${seed}:sim:${wave}`),
    weather: plan.weather,
    // captains are 0..cap-1, and every Spaniard, drop and spout is numbered after them
    t: 0, t0: 0, gi: 0, quiet: 0, nextId: cap,
    phase: 'fight',
    // Escalation is gentle and in two places only: they sail faster and reload faster.
    speedMul: 1 + (wave - 1) * 0.012,
    reloadMul: Math.pow(0.975, wave - 1),
    drift: { x: 0, y: 0 }, shake: 0,
    players, focus: 0,
    foes: [], shots: [], drops: [], marks: [], spouts: [], squads: [],
    boss: null, hunterT: 10, earlyLegend: false,
    events: [],
  };
}

/** A captain's ship as she puts to sea: seat `i`, from her berth. The wire builds its
 *  copies of other captains' ships with this too. */
export function launch(map: GameMap, seat: Seat, i: number, pvp: boolean): Player {
  const def = shipById(seat.ship);
  const stats = shipStats(def, seat.upgrades || {});
  const at = berth(map, i, stats.beam);
  return {
    id: i, seat: seat.seat ?? '', shipId: def.id, stats,
    team: seat.team ?? (pvp ? i + 1 : 1),
    plunder: seat.plunder ?? 0,
    heat: clamp(seat.heat ?? 0, 0, HEAT_MAX),
    lives: seat.lives ?? stats.lives,
    boarded: seat.boarded ?? 0,
    sunk: seat.sunk ?? 0,
    out: false, left: false,
    // out of the harbour under all plain sail and already making way: a wave that opened
    // with her crawling up to half speed was the slowest minute of every wave
    x: at.x, y: at.y, h: at.h, v: stats.maxSpeed * 0.75, rot: 0, sail: 1,
    len: stats.len, beam: stats.beam, maxSpeed: stats.maxSpeed, accel: stats.accel, turnRate: stats.turnRate,
    hull: stats.hullMax, hullMax: stats.hullMax, hit: 0, dead: false,
    cool: [0, 0], volley: null, bowCool: 0.5,
    shells: stats.shellsMax, shellsMax: stats.shellsMax,
    invuln: 1.5, ramT: 0, groundT: 0,
    buffs: { powder: 0, heavy: 0, chain: 0, swivel: 0 },
    board: null, aim: null, rim: false, want: [false, false],
  };
}

/** Where the i-th captain puts to sea: the first out of the harbour mouth, the next eight
 *  line abreast of her, alternately to starboard and port. A crowded sea forms more lines
 *  of nine, each sixty metres further out to sea than the last (a galleon is forty-six
 *  long), rather than one line reaching halfway across the chart. Each drops astern round
 *  any land. */
function berth(map: GameMap, i: number, beam: number): { x: number; y: number; h: number } {
  const st = map.start;
  if (i === 0) return st;
  const line = Math.floor(i / 9), j = i % 9;
  const side = j % 2 ? 1 : -1, rank = Math.ceil(j / 2);
  const px = -Math.sin(st.h) * side, py = Math.cos(st.h) * side;
  const fx = Math.cos(st.h), fy = Math.sin(st.h);
  const ox = st.x + fx * line * 60, oy = st.y + fy * line * 60;
  for (let back = 0; back < 8; back++) {
    const x = ox + px * rank * 45 - fx * back * 30, y = oy + py * rank * 45 - fy * back * 30;
    if (openWater(map, x, y, beam + 8)) return { x, y, h: st.h };
  }
  return { x: ox - fx * rank * 40, y: oy - fy * rank * 40, h: st.h };
}

/**
 * One tick. Feed it a fixed dt and the run replays exactly. `input` is one captain's
 * helm and guns, or one per captain in `players` order; a ship without one holds her
 * course. The wave keeps being stepped after it is won: the sea is still there, and you
 * still have to sail home.
 */
export function step(w: World, dt: number, input: Input | readonly Input[] = NO_INPUT): World {
  if (w.phase === 'lost' || w.phase === 'docked') return w;
  const inputs = Array.isArray(input) ? input : [input as Input];

  w.t += dt;
  w.shake = Math.max(0, w.shake - dt * 2.6);
  if (w.phase === 'fight') for (const p of afloat(w)) p.heat = clamp(p.heat + HEAT.perSecond * dt, 0, HEAT_MAX);
  w.drift = w.weather === 'storm' ? stormDrift(w.t, w.reduce) : { x: 0, y: 0 };

  for (const p of w.players) if (!p.out) sail(w, p, dt, inputs[p.id] ?? NO_INPUT);
  for (const p of w.players) if (!p.out) playerGuns(w, p, dt, inputs[p.id] ?? NO_INPUT);
  if (w.phase === 'fight') { release(w, dt); hunt(w, dt); }
  sweep(w, dt);

  for (const e of w.foes) if (!e.dead) stepFoe(w, e, dt);
  flyShots(w, dt);
  landMarks(w, dt);
  hulls(w);
  for (const p of w.players) if (!p.out) boarding(w, p, dt);
  flotsam(w, dt);

  cull(w);
  finish(w);
  return w;
}

/* ---------------------------------------------------------------- helm --- */

function sail(w: World, s: Player, dt: number, input: Input) {
  const was = s.rim;
  const back = rimHelm(s);
  if (back != null && !was) ev(w, 'rim', { x: s.x, y: s.y, p: s.id });
  helm(s, dt, back ?? input.heading, back != null ? 0 : input.rudder, input.sail);
  s.x += w.drift.x * dt;
  s.y += w.drift.y * dt;

  // A waterspout pulls rather than pushes — you can sail out, it just costs you the turn.
  // Never harder than most of her own best speed: at 16m/s it out-pulled the Jackdaw and
  // the galleon, and a ship caught near the core stayed there until the spout died.
  const pull = Math.min(16, s.maxSpeed * 0.6) * (w.reduce ? 0.5 : 1);
  for (const sp of w.spouts) {
    const dx = sp.x - s.x, dy = sp.y - s.y, d = Math.hypot(dx, dy), reach = sp.r * 4;
    if (d < reach && d > 1) {
      const k = (1 - d / reach) * pull * dt;
      s.x += (dx / d) * k; s.y += (dy / d) * k;
      if (d < sp.r && s.groundT <= 0) { wound(w, s, 3, 'spout', s.x, s.y); s.groundT = 0.6; }
    }
  }

  s.groundT = Math.max(0, s.groundT - dt);
  const hit = ground(w.map, s);
  // what hurts is how hard she hit for the pace she sails at, so a scrape is still a scrape
  if (hit > 3.5 * PACE && s.groundT <= 0) { wound(w, s, 2 + (hit / PACE) * 0.35, 'ground'); s.groundT = 1; ev(w, 'ground', { x: s.x, y: s.y, p: s.id }); }
  for (const k of w.map.reefs) {
    const d = Math.hypot(k.x - s.x, k.y - s.y);
    if (d < k.r + s.beam * 0.5) {
      const nx = (s.x - k.x) / (d || 1), ny = (s.y - k.y) / (d || 1);
      s.x = k.x + nx * (k.r + s.beam * 0.5); s.y = k.y + ny * (k.r + s.beam * 0.5);
      if (s.groundT <= 0) { wound(w, s, 5, 'ground'); s.groundT = 1; s.v *= 0.5; ev(w, 'ground', { x: s.x, y: s.y, reef: true, p: s.id }); }
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
  for (const s of w.players) {
    if (s.out) continue;
    for (const e of w.foes) {
      if (e.dead) continue;
      if (Math.abs(e.x - s.x) > (e.len + s.len) || Math.abs(e.y - s.y) > (e.len + s.len)) continue;
      const gap = hullGap(s, e);
      if (gap >= 0) continue;
      const big = e.L ? 0.85 : e.len > s.len * 1.3 ? 0.7 : 0.5;
      separate(s, e, gap, big);
      if (e.state === 'struck' || e.state === 'spent') continue;
      if (e.cls === 'brulote') { sink(w, e, false, s); continue; }
      if (s.invuln > 0 || s.ramT > 0) continue;
      // Ramming hurts you both. Yours is the better hull, which is the only reason it is
      // ever worth doing to a lancha.
      wound(w, s, e.ram, 'ram');
      if (!e.L) hurt(w, e, s.stats.ramDmg, s.x, s.y, s);
      s.ramT = 0.7;
      s.v *= 0.6;
      ev(w, 'ram', { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2, p: s.id });
    }
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
  // and captains off each other: touching another captain's ship is a bump, not a ram
  for (let i = 0; i < w.players.length; i++) {
    const a = w.players[i];
    if (a.out) continue;
    for (let j = i + 1; j < w.players.length; j++) {
      const b = w.players[j];
      if (b.out) continue;
      if (Math.abs(a.x - b.x) > (a.len + b.len) || Math.abs(a.y - b.y) > (a.len + b.len)) continue;
      const gap = hullGap(a, b);
      if (gap < 0) separate(a, b, gap, 0.5);
    }
  }
}

/* --------------------------------------------------------------- flotsam -- */

function flotsam(w: World, dt: number) {
  for (const d of w.drops) {
    d.age += dt;
    if (d.dead) continue;
    // first come, first served: the captain who sails through it takes it
    const s = w.players.find((p) => !p.out && Math.hypot(d.x - p.x, d.y - p.y) < p.len * 0.5 + 6);
    if (s) { d.dead = true; take(w, s, d.kind, d.x, d.y); }
    else if (d.age > 40) d.dead = true;
  }
  for (const p of w.spouts) {
    p.age += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}

function take(w: World, s: Player, kind: string, x: number, y: number) {
  if (kind === 'rum') s.hull = Math.min(s.hullMax, s.hull + s.hullMax * 0.3);
  else if (kind === 'shells') s.shells = Math.min(s.shellsMax + 3, s.shells + 3);
  else if (kind === 'swivel') s.buffs.swivel = -1;      // -1 is "the rest of this wave"
  else s.buffs[kind as 'powder' | 'heavy' | 'chain'] = 12;
  ev(w, 'take', { kind, x, y, p: s.id });
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
  if (w.phase === 'clear' && !w.shared) {
    // home when every captain still afloat is in
    if (afloat(w).every((p) => atNassau(w, p))) { w.phase = 'docked'; ev(w, 'dock', {}); }
  }
}

/* ---------------------------------------------------------- a shared sea -- */

/** A shared sea does not go home between waves: the next puts to sea on the same chart,
 *  with every captain where they are and the clock still running. */
export function nextWave(w: World) {
  w.wave++;
  w.plan = wavePlan(w.wave, rng(`${w.seed}:plan:${w.wave}`));
  w.weather = w.plan.weather;
  w.t0 = w.t; w.gi = 0; w.quiet = 0;
  w.phase = 'fight';
  w.speedMul = 1 + (w.wave - 1) * 0.012;
  w.reloadMul = Math.pow(0.975, w.wave - 1);
  w.hunterT = 10; w.earlyLegend = false;
  ev(w, 'wave', { wave: w.wave });
}

/** A captain comes aboard a sea already sailing: into a seat someone left, or a new one.
 *  She puts to sea from the harbour mouth with a little grace. Null when the sea is full. */
export function join(w: World, seat: Seat): Player | null {
  let i = w.players.findIndex((p) => p.left);
  if (i < 0) { i = w.players.length; if (i >= w.cap) return null; }
  const p = launch(w.map, seat, i, w.pvp);
  p.invuln = 3;
  w.players[i] = p;
  ev(w, 'joined', { p: i });
  return p;
}

/** Her captain has gone ashore. The ship leaves the sea, and the seat is free. */
export function leave(w: World, id: number) {
  const p = w.players[id];
  if (!p || p.left) return;
  p.out = true; p.left = true;
  ev(w, 'left', { p: id });
}

/** Back afloat after going down, with what she had won and the notoriety she had earned,
 *  out of the harbour mouth again with a little grace. */
export function refloat(w: World, p: Player, lives = 1) {
  const at = berth(w.map, p.id, p.beam);
  Object.assign(p, {
    x: at.x, y: at.y, h: at.h, v: p.maxSpeed * 0.5, rot: 0, sail: 1, dead: false, out: false, lives,
    hull: p.hullMax, hit: 0, invuln: 3, ramT: 0, groundT: 0, shells: p.shellsMax, cool: [0, 0], volley: null,
    bowCool: 0.5, board: null, aim: null, rim: false, want: [false, false], buffs: { powder: 0, heavy: 0, chain: 0, swivel: 0 },
  });
  ev(w, 'refloat', { p: p.id });
}

/** Home: the harbour mouth, or close enough under Nassau's lee from any side — the
 *  beacon points at the harbour, and a captain who comes in from the north should not
 *  have to find the way round the island to be allowed to stop. */
export function atNassau(w: World, s: Player = w.players[0]): boolean {
  const h = w.map.harbour, n = w.map.nassau;
  return Math.hypot(s.x - h.x, s.y - h.y) < h.r || Math.hypot(s.x - n.x, s.y - n.y) < n.r * 1.4 + 45;
}

/* -------------------------------------------------------------- readers -- */

export const alive = (w: World) => w.phase === 'fight' || w.phase === 'clear';

/**
 * A compact fingerprint of the entire simulation. The tests run two identical headless
 * battles and compare these — if a float path drifts, or someone reaches for
 * Math.random() in here, the strings stop matching. The first captain is written where
 * the only one always was, so a world of one prints as it always did.
 */
export function digest(w: World): string {
  const [s, ...crew] = w.players;
  const head = [w.t, s.plunder, s.heat, s.lives, s.sunk, s.boarded, s.x, s.y, s.h, s.hull, s.shells].map(q6);
  const foes = w.foes.map((e) => `${e.cls}:${q6(e.x)},${q6(e.y)},${q6(e.h)},${q6(e.hull)},${e.state[0]}`);
  const rest = [w.shots.length, w.drops.length, w.marks.length, w.spouts.length, w.gi, w.phase];
  const others = crew.map((p) => [p.plunder, p.heat, p.lives, p.sunk, p.boarded, p.x, p.y, p.h, p.hull, p.shells].map(q6).join(','));
  return [...head, foes.join('|'), ...rest, ...(others.length ? [others.join('|')] : [])].join(';');
}
