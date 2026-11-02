// The simulation.
//
// Pure. No three.js, no DOM, no clock of its own — the whole surface is create(),
// step(world, dt, inputs), join(), leave() and digest(). That is what buys the self-check:
// the tests run headless fights at a fixed timestep and get the same answer every time.
//
// Nothing in here calls Date.now() or Math.random(). Every roll goes through w.r.
//
// A world is one sea: every ship on it, captains' and bots', each steered by its own
// input in the same fixed order, so a server can step the one world everyone sees. There
// are no rounds. A ship that sinks is back at a quiet edge a few seconds later, her streak
// gone; five sinks in a row without sinking wins.

import { rng } from '../core/rng';
import { TAU, clamp, q6 } from '../core/vec';
import { TUNING as T, seaRadius } from '../data/tuning';
import { botInput } from './bots';
import { autoBearing, fire, flyShots, reload } from './combat';
import { EDGE, makeMap, openWater, type GameMap } from './map';
import { fresh, powers, sing, usePower } from './powers';
import { ground, helm, hullGap, rim, rimHelm, separate } from './sailing';
import { CRATES, aboard, ev, type Input, type Ship, type World } from './types';

export { you, afloat, aboard } from './types';

const maps = new Map<string, GameMap>();
/** The chart is a pure function of the sea's seed, so it is built once and kept. */
export function mapFor(seed: string): GameMap {
  let m = maps.get(seed);
  if (!m) { m = makeMap(seed); maps.set(seed, m); if (maps.size > 8) maps.delete(maps.keys().next().value!); }
  return m;
}

export const NO_INPUT: Input = { move: null, fire: null, auto: false };

/** Who is coming aboard. */
export interface Seat {
  seat?: string;
  bot?: boolean;
  look?: string;
  /** A streak she brings back with her, kept while she was docked. */
  streak?: number;
}

export function create(opts: { seed?: string } = {}): World {
  const seed = opts.seed ?? 'black-flag';
  return {
    seed, map: mapFor(seed), r: rng(`${seed}:sim`), t: 0,
    R: seaRadius(T.minShips),
    ships: [], focus: 0, shots: [], crates: [], due: [], nextId: 1,
    events: [],
  };
}

/** A fresh ship for seat `i`, not yet placed. The wire builds its copies of ships with this too. */
export function launch(seat: Seat, i: number): Ship {
  return {
    id: i, seat: seat.seat ?? '', bot: !!seat.bot, look: seat.look ?? 'jackdaw',
    x: 0, y: 0, h: 0, v: 0, rot: 0, sail: 1, trim: 1,
    len: T.length, beam: T.beam, maxSpeed: T.speed, accel: T.accel, turnRate: T.turn,
    hull: T.hull, hullMax: T.hull, hit: 0, dead: false,
    streak: seat.streak ?? 0, sank: 0,
    ammo: T.ammo, reloadT: T.reload, gapT: 0, heavy: false, boost: 0,
    calm: T.calm, mendT: 0, invuln: T.grace, down: 0,
    out: false, left: false, retire: false, rim: false,
    spent: fresh(), song: 0, shield: 0, brain: null,
  };
}

/** A ship comes aboard: into a seat someone left, or a new one, at a quiet edge. */
export function join(w: World, seat: Seat): Ship {
  let i = w.ships.findIndex((s) => s.left);
  if (i < 0) i = w.ships.length;
  const s = launch(seat, i);
  w.ships[i] = s;
  // the sea grows for her at once, before she is placed in it
  w.R = Math.max(w.R, seaRadius(aboard(w).length));
  place(w, s);
  ev(w, 'joined', { p: i, bot: s.bot });
  return s;
}

/** She leaves the sea, and her seat is free. */
export function leave(w: World, id: number) {
  const s = w.ships[id];
  if (!s || s.left) return;
  s.out = true; s.left = true;
  ev(w, 'left', { p: id });
}

/**
 * Put her at a quiet edge: of points round the sea a little inside its edge, the one
 * furthest from every other ship, on open water, pointing in. A little grace, full hull,
 * full guns.
 */
export function place(w: World, s: Ship) {
  const others = w.ships.filter((o) => o !== s && !o.out);
  let best = { x: 0, y: w.R * 0.6, score: -1 };
  const spin = w.r() * TAU;
  for (let i = 0; i < 16; i++) {
    const a = spin + (i / 16) * TAU;
    for (const k of [0.8, 0.65, 0.5]) {
      const x = Math.cos(a) * w.R * k, y = Math.sin(a) * w.R * k;
      if (!openWater(w.map, w.R, x, y, s.beam + 6)) continue;
      const score = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - x, o.y - y))) : 1e6 - i;
      if (score > best.score) best = { x, y, score };
      break;
    }
  }
  Object.assign(s, {
    x: best.x, y: best.y, h: Math.atan2(-best.y, -best.x), v: s.maxSpeed * 0.5, rot: 0, sail: 1, trim: 1,
    hull: s.hullMax, hit: 0, out: false, down: 0, invuln: T.grace, calm: T.calm, mendT: 0,
    ammo: T.ammo, reloadT: T.reload, gapT: 0, heavy: false, boost: 0, rim: false,
    spent: fresh(), song: 0, shield: 0,
  });
}

/**
 * One tick. Feed it a fixed dt and the sea replays exactly. `inputs` is one per ship, in
 * `ships` order; a ship without one holds her course. Bots steer themselves.
 */
export function step(w: World, dt: number, inputs: readonly (Input | undefined)[] = []): World {
  w.t += dt;
  edge(w, dt);
  for (const s of w.ships) {
    if (s.left) continue;
    if (s.out) { comeBack(w, s, dt); continue; }
    const input = s.bot ? botInput(w, s, dt) : inputs[s.id] ?? NO_INPUT;
    sail(w, s, dt, input);
    reload(s, dt);
    powers(s, dt);
    if (input.power != null) usePower(w, s, input.power);
    if (input.fire != null) fire(w, s, input.fire);
    else if (input.auto) fire(w, s, autoBearing(w, s));
  }
  sing(w, dt);
  flyShots(w, dt);
  hulls(w);
  crates(w, dt);
  cull(w);
  return w;
}

/* ---------------------------------------------------------------- helm --- */

/** The stick past this is a heading; this far out is full sail. */
const DEAD = 0.18, FULL = 0.75;

/**
 * Her helm, her way and where they take her, for one tick: all of a tick that is her own,
 * which is what lets a phone step its own ship ahead of the sea (net/lead.ts). It reads
 * only her, the chart and the sea's radius.
 */
export function move(w: Pick<World, 'map' | 'R'>, s: Ship, dt: number, input: Input) {
  const back = rimHelm(s, w.R);
  let heading: number | null = null;
  const m = input.move;
  if (m) {
    const k = Math.hypot(m.x, m.y);
    if (k > DEAD) {
      heading = Math.atan2(m.y, m.x);
      s.trim = clamp((k - DEAD) / (FULL - DEAD), 0.25, 1);
    }
  }
  helm(s, dt, back ?? heading, 0, s.trim, s.boost > 0 ? 1 + T.boost : 1);
  ground(w.map, s);
  rim(s, w.R, dt, 0.8);
  s.boost = Math.max(0, s.boost - dt);
}

function sail(w: World, s: Ship, dt: number, input: Input) {
  move(w, s, dt, input);
  s.invuln = Math.max(0, s.invuln - dt);
  s.hit = Math.max(0, s.hit - dt * 4);
  s.calm += dt;
  s.mendT += dt;
  if (s.mendT >= T.mendAfter && s.hull < s.hullMax) s.hull = Math.min(s.hullMax, s.hull + T.mend * dt);
}

/** Sunk: back at a quiet edge after a few seconds. A bot that is making room for a
 *  captain leaves instead. */
function comeBack(w: World, s: Ship, dt: number) {
  s.down += dt;
  if (s.down < T.respawn) return;
  if (s.retire) { leave(w, s.id); return; }
  place(w, s);
  ev(w, 'back', { p: s.id });
}

/* ------------------------------------------------------------ the edge --- */

/** The sea grows at once when ships join (see join) and closes in slowly when they leave. */
function edge(w: World, dt: number) {
  const want = seaRadius(aboard(w).length);
  if (want > w.R) w.R = want;
  else if (want < w.R) w.R = Math.max(want, w.R - T.edgeSpeed * dt);
}

/* ------------------------------------------------------------ collisions -- */

/** Ships keep off each other: touching is a bump, not a ram. */
function hulls(w: World) {
  for (let i = 0; i < w.ships.length; i++) {
    const a = w.ships[i];
    if (a.out) continue;
    for (let j = i + 1; j < w.ships.length; j++) {
      const b = w.ships[j];
      if (b.out) continue;
      if (Math.abs(a.x - b.x) > (a.len + b.len) || Math.abs(a.y - b.y) > (a.len + b.len)) continue;
      const gap = hullGap(a, b);
      if (gap < 0) separate(a, b, gap, 0.5);
    }
  }
}

/* ---------------------------------------------------------------- crates -- */

function crates(w: World, dt: number) {
  for (const c of w.crates) {
    c.age += dt;
    if (c.dead) continue;
    // first come, first served: the ship that sails through it takes it
    const s = w.ships.find((p) => !p.out && Math.hypot(c.x - p.x, c.y - p.y) < p.len * 0.5 + 3);
    if (!s) continue;
    c.dead = true;
    take(s, c.kind);
    w.due.push(w.t + T.crateEvery);
    ev(w, 'take', { kind: c.kind, x: c.x, y: c.y, p: s.id });
  }
  // one for every few ships aboard, each due a while after the last was taken
  const want = Math.ceil(aboard(w).length / T.shipsPerCrate);
  const have = w.crates.filter((c) => !c.dead).length + w.due.length;
  for (let i = have; i < want; i++) w.due.push(w.t);
  for (let i = w.due.length - 1; i >= 0; i--) {
    if (w.due[i] > w.t) continue;
    w.due.splice(i, 1);
    if (w.crates.filter((c) => !c.dead).length < want) spawnCrate(w);
  }
}

function take(s: Ship, kind: string) {
  if (kind === 'repair') s.hull = Math.min(s.hullMax, s.hull + s.hullMax * T.repair);
  else if (kind === 'speed') s.boost = T.boostFor;
  else s.heavy = true;
}

/** A crate in open water, away from every ship, inside the sea. */
function spawnCrate(w: World) {
  for (let guard = 0; guard < 30; guard++) {
    const a = w.r() * TAU, d = Math.sqrt(w.r()) * (w.R - EDGE - 30);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (!openWater(w.map, w.R, x, y, 10)) continue;
    if (w.ships.some((s) => !s.out && Math.hypot(s.x - x, s.y - y) < 60)) continue;
    w.crates.push({ id: w.nextId++, x, y, kind: CRATES[Math.floor(w.r() * CRATES.length)], age: 0, dead: false });
    return;
  }
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
  keep(w.crates, (c) => !c.dead);
}

/* -------------------------------------------------------------- readers -- */

/**
 * A compact fingerprint of the entire simulation. The tests run two identical headless
 * fights and compare these: if a float path drifts, or someone reaches for Math.random()
 * in here, the strings stop matching.
 */
export function digest(w: World): string {
  const ships = w.ships.map((s) => [s.x, s.y, s.h, s.hull, s.streak, s.sank, s.ammo].map(q6).join(',') + (s.out ? 'o' : '') + (s.left ? 'l' : ''));
  return [q6(w.t), q6(w.R), ships.join('|'), w.shots.length, w.crates.map((c) => `${c.kind[0]}${q6(c.x)},${q6(c.y)}`).join('|')].join(';');
}
