// Guns, shot, damage, striking, boarding. Everything that decides who is hurt and what
// it pays.

import { angleTo, clamp, wrap } from '../core/vec';
import { rollDrop } from '../data/drops';
import { HEAT_MAX, heatBoarded, heatSunk } from '../data/notoriety';
import { lineOfSight } from './map';
import { inHull } from './sailing';
import { ev, type Foe, type Input, type Side, type Vessel, type World } from './types';

export const STRIKE_AT = 0.25;    // hull fraction at which the colours come down
export const STRIKE_WINDOW = 6;   // seconds a prize stays boardable. The number.
export const BOARD_TIME = 0.8;    // seconds alongside it takes to put a crew across
const VOLLEY_GAP = 0.055;         // a broadside ripples bow to stern, it does not clap
const MORTAR_FUSE = 1.3;
const FOE_SHOT = 95;
const SQUAD_CALL = 520;           // how far a squadron hears one of its own open fire

/** Which way a side's guns point. Port is to the left of her heading, starboard right. */
export function sideVec(h: number, side: Side): [number, number] {
  const s = side === 1 ? 1 : -1;
  return [-Math.sin(h) * s, Math.cos(h) * s];
}

export const isPrize = (e: Foe) => e.state === 'struck' && e.strikeT > 0 && !e.dead;
export const hostile = (e: Foe) => !e.dead && (e.state === 'patrol' || e.state === 'engage');

/* ------------------------------------------------------------ the Jackdaw -- */

export function playerGuns(w: World, dt: number, input: Input) {
  const s = w.ship, st = w.stats;
  s.cool[0] = Math.max(0, s.cool[0] - dt);
  s.cool[1] = Math.max(0, s.cool[1] - dt);

  const reload = st.reload * (s.buffs.powder > 0 ? 0.6 : 1);
  if (!s.volley) {
    const side: Side | null = input.fireL && s.cool[0] <= 0 ? 0 : input.fireR && s.cool[1] <= 0 ? 1 : null;
    if (side != null) {
      s.volley = { side, next: 0, fired: 0, t: 0 };
      s.cool[side] = reload;
      ev(w, 'broadside', { side, n: st.gunsPerSide });
    }
  }
  if (s.volley) volley(w, dt);

  // Bow chasers look after themselves: nearest ship forward of the beam, if any.
  const gun = st.bowGun;
  const swivel = s.buffs.swivel !== 0;
  if (gun || swivel) {
    s.bowCool -= dt;
    if (s.bowCool <= 0) {
      const g = gun ?? { reload: 1.1, dmg: 0.5 * (1 + (w.stats.dmg - 1)), range: 130 };
      const tgt = nearestAhead(w, s, g.range, 0.75);
      if (tgt) {
        const [ax, ay] = lead(s.x, s.y, tgt, 115);
        const d = Math.hypot(ax - s.x, ay - s.y) || 1;
        const bx = s.x + Math.cos(s.h) * s.len * 0.5, by = s.y + Math.sin(s.h) * s.len * 0.5;
        w.shots.push({
          x: bx, y: by, vx: ((ax - s.x) / d) * 115 + Math.cos(s.h) * s.v, vy: ((ay - s.y) / d) * 115 + Math.sin(s.h) * s.v,
          r: 0.9, dmg: g.dmg, foe: false, kind: 'ball', pierce: 1, age: 0, life: g.range / 115, dead: false, from: s.id,
        });
        ev(w, 'bow', { x: bx, y: by, h: s.h });
        s.bowCool = g.reload * (swivel ? 0.5 : 1);
      } else {
        s.bowCool = 0.15;
      }
    }
  }

  // The mortar lands where the reticle is: on the nearest ship ahead if there is one to
  // lock, otherwise a cable's length off the bow.
  s.aim = mortarAim(w);
  if (input.mortar && s.shells > 0 && s.aim) {
    s.shells--;
    w.marks.push({ x: s.aim.x, y: s.aim.y, r: 26, t: MORTAR_FUSE, max: MORTAR_FUSE, own: true, dmg: 7, done: false });
    ev(w, 'mortar', { x: s.aim.x, y: s.aim.y, fromX: s.x, fromY: s.y, fuse: MORTAR_FUSE });
  }
}

function volley(w: World, dt: number) {
  const s = w.ship, st = w.stats, V = s.volley!;
  V.t += dt;
  const n = st.gunsPerSide;
  const chain = s.buffs.chain > 0, heavy = s.buffs.heavy > 0;
  const [sx, sy] = sideVec(s.h, V.side);
  const fx = Math.cos(s.h), fy = Math.sin(s.h);
  while (V.fired < n && V.t >= V.next) {
    const i = V.fired;
    const k = n === 1 ? 0 : i / (n - 1) - 0.5;          // -0.5 stern .. 0.5 bow
    const along = k * s.len * 0.62;
    const px = s.x + fx * along + sx * s.beam * 0.5;
    const py = s.y + fy * along + sy * s.beam * 0.5;
    // A little fan fore and aft, a little scatter: a broadside covers a patch of sea.
    const a = Math.atan2(sy, sx) + k * 0.1 + (w.r() - 0.5) * 0.05;
    const sp = st.shotSpeed * (0.97 + w.r() * 0.06);
    const dmg = st.dmg * (heavy ? 2 : 1) * (chain ? 0.75 : 1);
    w.shots.push({
      x: px, y: py, vx: Math.cos(a) * sp + fx * s.v, vy: Math.sin(a) * sp + fy * s.v,
      r: chain ? 2.2 : 0.9, dmg, foe: false, kind: chain ? 'chain' : 'ball',
      pierce: heavy || chain ? 2 : 1, age: 0, life: st.range / sp, dead: false, from: s.id,
    });
    ev(w, 'cannon', { x: px, y: py, dx: sx, dy: sy, i });
    V.fired++;
    V.next += VOLLEY_GAP;
  }
  if (V.fired >= n) s.volley = null;
}

function nearestAhead(w: World, s: Vessel, range: number, cone: number): Foe | null {
  let best: Foe | null = null, bd = range;
  for (const e of w.foes) {
    if (!hostile(e) && !isPrize(e)) continue;
    if (isPrize(e)) continue;                   // chasers do not waste powder on a prize
    const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
    if (d > bd) continue;
    if (Math.abs(wrap(Math.atan2(dy, dx) - s.h)) > cone) continue;
    if (!lineOfSight(w.map, s.x, s.y, e.x, e.y)) continue;
    best = e; bd = d;
  }
  return best;
}

/** Where to aim so a ball fired now meets her: one step of lead is plenty at these ranges. */
export function lead(x: number, y: number, t: Vessel, speed: number, k = 1): [number, number] {
  const d = Math.hypot(t.x - x, t.y - y);
  const tt = (d / speed) * k;
  return [t.x + Math.cos(t.h) * t.v * tt, t.y + Math.sin(t.h) * t.v * tt];
}

export function mortarAim(w: World): { x: number; y: number; lock: number } | null {
  const s = w.ship;
  let best: Foe | null = null, bd = 240;
  for (const e of w.foes) {
    if (e.dead || e.state === 'spent') continue;
    const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
    if (d < 45 || d > bd) continue;
    if (Math.abs(wrap(Math.atan2(dy, dx) - s.h)) > 0.9) continue;
    best = e; bd = d;
  }
  if (best) {
    const [x, y] = lead(s.x, s.y, best, 1e9);
    const tt = MORTAR_FUSE;
    return { x: x + Math.cos(best.h) * best.v * tt, y: y + Math.sin(best.h) * best.v * tt, lock: best.id };
  }
  return { x: s.x + Math.cos(s.h) * (130 + s.v * MORTAR_FUSE), y: s.y + Math.sin(s.h) * (130 + s.v * MORTAR_FUSE), lock: 0 };
}

/* ------------------------------------------------------------ their guns -- */

export function foeShot(w: World, e: Foe, x: number, y: number, ang: number, dmg: number, range: number, speed = FOE_SHOT) {
  w.shots.push({
    x, y, vx: Math.cos(ang) * speed + Math.cos(e.h) * e.v, vy: Math.sin(ang) * speed + Math.sin(e.h) * e.v,
    r: 1, dmg, foe: true, kind: 'ball', pierce: 1, age: 0, life: range / speed, dead: false, from: e.id,
  });
  e.flash = 1;
}

/** A side's worth of guns, spread along her length, fired in the direction that side faces. */
export function foeBroadside(w: World, e: Foe, side: -1 | 1, n: number, dmg: number, range: number, fan = 0.08) {
  const [sx, sy] = sideVec(e.h, side === 1 ? 1 : 0);
  const fx = Math.cos(e.h), fy = Math.sin(e.h);
  const base = Math.atan2(sy, sx);
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5;
    const along = k * e.len * 0.6;
    foeShot(w, e, e.x + fx * along + sx * e.beam * 0.5, e.y + fy * along + sy * e.beam * 0.5,
      base + k * fan * 2 + (w.r() - 0.5) * 0.09, dmg, range);
  }
  ev(w, 'foe-fire', { x: e.x, y: e.y, id: e.id, side, n, big: n >= 5 });
}

/** She has seen you, and so has everyone in earshot of her guns. */
export function raise(w: World, e: Foe) {
  if (e.state !== 'patrol') return;
  e.state = 'engage';
  e.alert = true;
  e.orbit = angleTo(e.h, Math.atan2(w.ship.y - e.y, w.ship.x - e.x)) > 0 ? -1 : 1;
  ev(w, 'alert', { id: e.id, x: e.x, y: e.y });
  for (const o of w.foes) {
    if (o === e || o.squad !== e.squad || o.state !== 'patrol') continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) > SQUAD_CALL) continue;
    o.state = 'engage';
    o.alert = true;
    o.orbit = e.orbit;
  }
}

/* ---------------------------------------------------------------- damage -- */

/** The one rule the whole game turns on: a ship that can strike her colours always gets
 *  to, exactly once, instead of dying. So every kill is a decision you made with a white
 *  flag already up. */
export function hurt(w: World, e: Foe, dmg: number, x: number, y: number) {
  if (e.dead) return;
  if (e.L) return hurtLegend(w, e, dmg, x, y);
  e.hull -= dmg;
  e.hit = 1;
  raise(w, e);

  if (e.strikes && !e.struckOnce && e.hull <= e.hullMax * STRIKE_AT) {
    e.struckOnce = true;
    e.state = 'struck';
    e.strikeT = STRIKE_WINDOW;
    e.hull = e.hullMax * STRIKE_AT;
    ev(w, 'strike', { id: e.id, x: e.x, y: e.y });
    return;
  }
  if (e.hull <= 0) { e.hull = 0; sink(w, e, false); }
}

function hurtLegend(w: World, e: Foe, dmg: number, x: number, y: number) {
  // Gun ports are the weak point, and the only way to hurt her fast. Everywhere else is
  // oak a foot thick.
  let best = null, bd = 7.5;
  const fx = Math.cos(e.h), fy = Math.sin(e.h);
  for (const p of e.ports!) {
    if (p.dead) continue;
    const [sx, sy] = sideVec(e.h, p.side === 1 ? 1 : 0);
    const px = e.x + fx * p.fwd + sx * e.beam * 0.5, py = e.y + fy * p.fwd + sy * e.beam * 0.5;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) {
    best.hull -= dmg;
    e.hull -= dmg * 3;
    if (best.hull <= 0) { best.dead = true; ev(w, 'port-down', { id: e.id, x, y }); }
  } else {
    e.hull -= dmg * 0.35;
  }
  e.hit = 1;
  if (e.hull <= 0) { e.hull = 0; sink(w, e, false); }
}

export function sink(w: World, e: Foe, byBoard: boolean) {
  if (e.dead) return;
  e.dead = true;
  const reales = e.reales;

  if (byBoard) {
    w.plunder += reales * 2;
    w.boarded++;
    w.heat = clamp(w.heat + heatBoarded(e.hullMax), 0, HEAT_MAX);
    w.ship.hull = Math.min(w.ship.hullMax, w.ship.hull + w.stats.boardRepair);
    ev(w, 'board', { id: e.id, x: e.x, y: e.y, reales: reales * 2 });
  } else {
    w.plunder += reales;
    w.sunk++;
    // Only a ship that had already struck costs you notoriety. With the broadside in
    // your hands, that is always a decision and never a side effect.
    if (e.struckOnce) w.heat = clamp(w.heat + heatSunk(e.hullMax), 0, HEAT_MAX);
    ev(w, 'boom', { id: e.id, x: e.x, y: e.y, big: !!e.L || e.cls === 'manowar', reales });
  }
  ev(w, 'sunk', { id: e.id, boarded: byBoard });

  if (e.cls === 'brulote') {
    // She goes up whether she reached you or not — dying is her attack too.
    w.marks.push({ x: e.x, y: e.y, r: 24, t: 0.25, max: 0.25, own: false, dmg: 9, done: false });
    ev(w, 'fireship', { x: e.x, y: e.y });
  }
  if (e.L) {
    if (w.boss === e) w.boss = null;
    w.shake = 1.4;
    ev(w, 'legend-down', { id: e.L.id, name: e.L.name, x: e.x, y: e.y });
  }

  const d = rollDrop(w.r, byBoard);
  if (d) w.drops.push({ id: w.nextId++, x: e.x, y: e.y, kind: d.id, dur: d.dur, age: 0, dead: false });
  w.shake = Math.max(w.shake, e.L ? 1.4 : e.hullMax > 12 ? 0.7 : 0.35);
}

export function wound(w: World, dmg: number, x = w.ship.x, y = w.ship.y) {
  const s = w.ship;
  if (w.phase === 'lost' || s.invuln > 0) return;
  s.hull -= dmg;
  s.hit = 1;
  w.shake = Math.max(w.shake, 0.5);
  ev(w, 'hit', { x, y, dmg });
  if (s.hull > 0) return;

  s.hull = 0;
  w.lives--;
  if (w.lives <= 0) { w.phase = 'lost'; ev(w, 'dead', {}); return; }
  // Refit: full hull, grace, and the water round you cleared of everything already in
  // the air, so the frame you come back on is not the frame you die on again.
  s.hull = s.hullMax;
  s.invuln = 2.5;
  for (const sh of w.shots) if (sh.foe && Math.hypot(sh.x - s.x, sh.y - s.y) < 260) sh.dead = true;
  for (const m of w.marks) if (!m.own) m.done = true;
  ev(w, 'refit', { lives: w.lives });
}

/* ------------------------------------------------------------ shot in air -- */

export function flyShots(w: World, dt: number) {
  const s = w.ship;
  for (const sh of w.shots) {
    if (sh.dead) continue;
    sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.age += dt;
    if (sh.age >= sh.life) {
      sh.dead = true;
      ev(w, 'splash', { x: sh.x, y: sh.y, foe: sh.foe });
      continue;
    }
    if (sh.foe) {
      if (s.invuln <= 0 && inHull(s, sh.x, sh.y, sh.r)) { sh.dead = true; wound(w, sh.dmg, sh.x, sh.y); }
      else hitLand(w, sh);
      continue;
    }
    for (const e of w.foes) {
      if (e.dead || e.state === 'spent' || e.id === sh.from) continue;
      if (Math.abs(e.x - sh.x) > e.len || Math.abs(e.y - sh.y) > e.len) continue;
      if (!inHull(e, sh.x, sh.y, sh.r)) continue;
      hurt(w, e, sh.dmg, sh.x, sh.y);
      if (sh.kind === 'chain') e.slow = 4;
      ev(w, 'thud', { x: sh.x, y: sh.y, id: e.id });
      if (--sh.pierce <= 0) { sh.dead = true; break; }
      // A ball that goes through keeps going, but not through the same ship twice.
      sh.from = e.id;
    }
    if (!sh.dead) hitLand(w, sh);
  }
}

/** Shot does not pass through rock. Islands and reefs are cover from both sides. */
function hitLand(w: World, sh: { x: number; y: number; dead: boolean }) {
  for (const k of w.map.reefs) {
    if (Math.abs(k.x - sh.x) < k.r && Math.hypot(k.x - sh.x, k.y - sh.y) < k.r) {
      sh.dead = true; ev(w, 'thud', { x: sh.x, y: sh.y, rock: true }); return;
    }
  }
  for (const is of w.map.islands) {
    const dx = sh.x - is.x, dy = sh.y - is.y;
    if (Math.abs(dx) > is.r * 1.4 || Math.abs(dy) > is.r * 1.4) continue;
    const d = Math.hypot(dx, dy);
    if (d < is.r * 0.7) { sh.dead = true; ev(w, 'thud', { x: sh.x, y: sh.y, rock: true }); return; }
  }
}

/* ------------------------------------------------------------ telegraphs -- */

export function landMarks(w: World, dt: number) {
  for (const m of w.marks) {
    if (m.done) continue;
    m.t -= dt;
    if (m.t > 0) continue;
    m.done = true;
    if (m.own) {
      for (const e of w.foes) {
        if (e.dead || e.state === 'spent') continue;
        // The shell's own landing point, not the ship's centre — a mortar dropped on a
        // legendary's gun ports has to count as a gun-port hit.
        if (Math.hypot(e.x - m.x, e.y - m.y) < m.r + e.len * 0.3) hurt(w, e, m.dmg, m.x, m.y);
      }
    } else {
      const s = w.ship;
      if (Math.hypot(s.x - m.x, s.y - m.y) < m.r + s.beam * 0.5) wound(w, m.dmg, m.x, m.y);
    }
    w.shake = Math.max(w.shake, 0.6);
    ev(w, 'boom', { x: m.x, y: m.y, big: m.r > 20, splash: true });
  }
}

/* -------------------------------------------------------------- boarding -- */

/**
 * Coming alongside. The nearest prize within a hull's length and a bit, with you not
 * tearing past her, counts up; BOARD_TIME of it and she is yours. Drift out of reach
 * and the count starts again — a boarding is a commitment, not a brush past.
 */
export function boarding(w: World, dt: number) {
  const s = w.ship;
  let best: Foe | null = null, bd = 1e9;
  for (const e of w.foes) {
    if (!isPrize(e)) continue;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    const reach = (e.len + s.len) * 0.5 * 0.85 + 12;
    if (d < reach && d < bd) { best = e; bd = d; }
  }
  if (!best || Math.abs(s.v) > s.maxSpeed * 0.75) { s.board = null; return; }
  if (!s.board || s.board.id !== best.id) s.board = { id: best.id, t: 0 };
  s.board.t += dt;
  if (s.board.t >= BOARD_TIME) { s.board = null; sink(w, best, true); }
}
