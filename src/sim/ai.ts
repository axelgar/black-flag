// The Spanish captains. One small state machine each:
//
//   patrol ─(sees you, or is shot at, or hears it from her squadron)─▶ engage
//   engage ─(hull below a quarter)─▶ struck ─(window closes)─▶ spent ─▶ gone
//
// Seeing you means being close enough for the weather *and* having no island in the
// way. A squadron behind a headland really cannot see you, and that is most of what
// makes the islands worth sailing round.

import { clamp, TAU, wrap } from '../core/vec';
import { HEAT_MAX, heatEscaped } from '../data/notoriety';
import { MAP_R, EDGE, lineOfSight, openWater, shoreDist } from './map';
import { FOE_LAY, foeBroadside, foeShot, isPrize, lead, raise, sideVec } from './combat';
import { ground, helm, rim } from './sailing';
import { POINT_BLANK, SIGHT } from './weather';
import { ev, type Foe, type Vessel, type World } from './types';
import { addFoe } from './spawn';

const SEARCH_SPEED = 12;      // a squadron's search sweeps toward where you were last heard of

export function stepFoe(w: World, e: Foe, dt: number) {
  e.hit = Math.max(0, e.hit - dt * 4);
  e.flash = Math.max(0, e.flash - dt * 5);
  e.slow = Math.max(0, e.slow - dt);

  let heading: number | null = e.h;
  let sail = 0.5;

  if (e.state === 'spent') {
    // She got away: all plain sail, stern to you, and gone into the haze in a few
    // seconds. A prize that lingers on the chart after her window reads as a ship you
    // have somehow failed to sink.
    e.spentT += dt;
    heading = Math.atan2(e.y - w.ship.y, e.x - w.ship.x); sail = 1;
  } else if (e.state === 'struck') {
    e.strikeT -= dt;
    heading = null; sail = 0;
    if (e.strikeT <= 0) {
      e.state = 'spent';
      // She got away with a crew who saw your face. That is the price of leaving prizes
      // on the water, and it is what makes the flags climb for a captain who never boards.
      w.heat = clamp(w.heat + heatEscaped(e.hullMax), 0, HEAT_MAX);
      ev(w, 'lost-prize', { id: e.id, x: e.x, y: e.y });
    }
  } else if (e.state === 'patrol') {
    [heading, sail] = patrol(w, e, dt);
  } else if (e.L) {
    [heading, sail] = legend(w, e, dt);
  } else {
    [heading, sail] = engage(w, e, dt);
  }

  if (heading != null) heading = avoid(w, e, heading);
  const mul = w.speedMul * (e.slow > 0 ? 0.55 : 1) * (e.cls === 'brulote' ? 1 + Math.min(0.9, e.chase * 0.12) : 1);
  helm(e, dt, heading, 0, sail, e.state === 'struck' ? 1 : mul);
  ground(w.map, e);
  if (e.state !== 'spent') rim(e, dt);
}

/* ---------------------------------------------------------------- patrol -- */

function patrol(w: World, e: Foe, dt: number): [number, number] {
  e.seeT -= dt;
  if (e.seeT <= 0) {
    e.seeT = 0.3;
    if (sees(w, e)) { raise(w, e); return engage(w, e, dt); }
  }
  const sq = w.squads[e.squad];
  e.wpT -= dt;
  if (e.wpT <= 0 || Math.hypot(e.wp.x - e.x, e.wp.y - e.y) < 30) {
    // A new leg of the search, somewhere round the squadron's current centre.
    for (let i = 0; i < 6; i++) {
      const a = w.r() * TAU, d = 30 + w.r() * 110;
      const x = sq.x + Math.cos(a) * d, y = sq.y + Math.sin(a) * d;
      if (openWater(w.map, x, y, e.beam + 10)) { e.wp = { x, y }; break; }
    }
    e.wpT = 18;
  }
  return [Math.atan2(e.wp.y - e.y, e.wp.x - e.x), 0.55];
}

/** Squadron centres drift toward the Jackdaw, the way word travels along a coast. */
export function sweep(w: World, dt: number) {
  const s = w.ship;
  for (const sq of w.squads) {
    const dx = s.x - sq.x, dy = s.y - sq.y, d = Math.hypot(dx, dy);
    if (d < 60) continue;
    sq.x += (dx / d) * SEARCH_SPEED * dt;
    sq.y += (dy / d) * SEARCH_SPEED * dt;
  }
}

export function sees(w: World, e: Foe): boolean {
  const s = w.ship;
  const d = Math.hypot(s.x - e.x, s.y - e.y);
  if (d < POINT_BLANK) return true;
  const sight = (e.C ? e.C.sight : 500) * SIGHT[w.weather];
  if (d > sight) return false;
  return lineOfSight(w.map, e.x, e.y, s.x, s.y);
}

/* ---------------------------------------------------------------- engage -- */

/**
 * Circle at her preferred range with her beam to you. The tangent is the heading that
 * keeps the distance; leaning it in or out is how she closes or opens it. That one line
 * is what makes a broadside ship turn her side toward you on her own.
 */
function orbitHeading(e: Foe, tx: number, ty: number, pref: number): number {
  const bearing = Math.atan2(ty - e.y, tx - e.x);
  const d = Math.hypot(tx - e.x, ty - e.y);
  const corr = clamp((d - pref) / (pref * 0.6), -0.9, 1);
  return bearing + e.orbit * (Math.PI / 2) * (1 - corr);
}

function engage(w: World, e: Foe, dt: number): [number, number] {
  const s = w.ship, C = e.C!;
  const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy);

  if (e.cls === 'lancha') {
    const [tx, ty] = lead(e.x, e.y, s, e.maxSpeed, 0.7);
    return [Math.atan2(ty - e.y, tx - e.x) + Math.sin(w.t * 2.2 + e.ph) * 0.28, 1];
  }
  if (e.cls === 'brulote') {
    e.chase += dt;
    const [tx, ty] = lead(e.x, e.y, s, e.maxSpeed, 0.8);
    return [Math.atan2(ty - e.y, tx - e.x), 1];
  }

  // Lost her in the fog, or behind an island, long enough — go back to searching.
  const sight = C.sight * SIGHT[w.weather] * 1.4;
  if (d > sight && d > C.range * 2) {
    e.seeT -= dt;
    if (e.seeT < -8) { e.state = 'patrol'; e.alert = false; e.seeT = 0.3; w.squads[e.squad] = { x: s.x, y: s.y }; }
  } else if (e.seeT < 0) e.seeT = 0.3;

  const heading = d > C.range * 2.2 ? Math.atan2(dy, dx) : orbitHeading(e, s.x, s.y, C.prefRange);
  guns(w, e, dt, d);
  return [heading, d > C.prefRange * 1.6 ? 1 : 0.75];
}

/** Which side of her faces a point, and how squarely. 1 is dead abeam. */
function beamTo(e: Foe, x: number, y: number): { side: -1 | 1; square: number } {
  const b = Math.atan2(y - e.y, x - e.x);
  const off = wrap(b - e.h);
  const side: -1 | 1 = off > 0 ? 1 : -1;
  return { side, square: Math.abs(Math.sin(off)) };
}

function guns(w: World, e: Foe, dt: number, d: number) {
  const s = w.ship, C = e.C!;
  e.cool -= dt;
  e.coolAlt -= dt;
  if (w.phase === 'lost') return;

  // The frigate's tell: her ports are open, and in a moment they will speak — along
  // whichever way her side is facing *then*, which is how you dodge it.
  if (e.broad > 0) {
    e.broad -= dt;
    if (e.broad <= 0) {
      foeBroadside(w, e, e.broadSide, C.gunsPerSide, C.shotDmg, C.range);
      e.cool = C.reload * w.reloadMul;
    }
    return;
  }

  if (C.guns === 'mortar' && e.coolAlt <= 0 && d < C.range * 1.3 && lineOfSight(w.map, e.x, e.y, s.x, s.y)) {
    const n = 2 + (w.r() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      w.marks.push({
        x: s.x + Math.cos(s.h) * s.v * 1.2 + (w.r() - 0.5) * 60,
        y: s.y + Math.sin(s.h) * s.v * 1.2 + (w.r() - 0.5) * 60,
        r: 18, t: 1.7, max: 1.7, own: false, dmg: 5, done: false,
      });
    }
    ev(w, 'mortar-in', { x: e.x, y: e.y, id: e.id });
    e.coolAlt = C.reload * 1.5 * w.reloadMul;
  }

  if (e.cool > 0 || d > C.range) return;
  if (!lineOfSight(w.map, e.x, e.y, s.x, s.y)) return;

  if (C.guns === 'aimed') {
    const [tx, ty] = lead(e.x, e.y, s, 88, 0.9);
    foeShot(w, e, e.x, e.y, Math.atan2(ty - e.y, tx - e.x) + (w.r() - 0.5) * FOE_LAY * 1.4, C.shotDmg, C.range);
    ev(w, 'foe-fire', { x: e.x, y: e.y, id: e.id, n: 1 });
    e.cool = C.reload * w.reloadMul;
    return;
  }

  const { side, square } = beamTo(e, s.x, s.y);
  if (square < 0.93) return;                       // not yet abeam; the orbit will bring her round
  if (C.guns === 'beam') {
    foeBroadside(w, e, side, C.gunsPerSide, C.shotDmg, C.range, 0.05);
    e.cool = C.reload * w.reloadMul;
  } else {
    e.broad = 0.85;
    e.broadSide = side;
    ev(w, 'ports-open', { id: e.id, side });
  }
}

/* --------------------------------------------------------------- legends -- */

function legend(w: World, e: Foe, dt: number): [number, number] {
  const s = w.ship, L = e.L!;
  const frac = e.hull / e.hullMax;
  const phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  if (phase !== e.phase) { e.phase = phase; e.cool = 1.4; ev(w, 'legend-phase', { n: phase, id: e.id }); }

  // La Fortuna would rather run you down than out-shoot you, so every phase she takes
  // brings her in closer. The others hold their range and work their guns.
  const pref = L.pattern === 'spiral' ? 150 - phase * 35 : 150;
  const d = Math.hypot(s.x - e.x, s.y - e.y);
  const heading = d > 380 ? Math.atan2(s.y - e.y, s.x - e.x) : orbitHeading(e, s.x, s.y, pref);

  e.cool -= dt;
  if (e.cool > 0 || d > 260 || w.phase === 'lost') return [heading, 1];
  const live = e.ports!.filter((p) => !p.dead).length;
  const power = live / e.ports!.length;
  // Aimed fans and point-blank rings are the two patterns that punish a captain who has
  // not yet found the ports; they come round a little slower than a broadside does.
  const slow = L.pattern === 'shroud' ? 1.4 : L.pattern === 'spiral' ? 1.3 : 1;
  // Every gun port shot out slows her down. (It used to be the other way about: a
  // legendary with her ports shot away fired twice as often as a whole one, which made
  // doing the one thing the fight asks of you the worst thing you could do.)
  const reload = (2.8 - phase * 0.5) * (1.15 + (1 - power) * 0.8) * w.reloadMul * slow;

  if (L.pattern === 'sweep') {
    const { side } = beamTo(e, s.x, s.y);
    foeBroadside(w, e, side, 6 + phase * 2, 3, 230, 0.3);
  } else if (L.pattern === 'shroud') {
    // She sends a screen of launches, not an endless stream: boarding them used to be
    // answered with two more every volley, and wave 10 was a wall of rams. `chase` is unused
    // on a legendary, so it counts what she has put in the water.
    if (e.chase < 4 + phase * 3 && w.r() < 0.45 + phase * 0.2) {
      e.chase += 2;
      const [sx, sy] = sideVec(e.h, 1);
      for (const k of [-1, 1]) {
        const f = addFoe(w, 'lancha', e.x + sx * k * 30, e.y + sy * k * 30, e.h, e.squad);
        f.state = 'engage'; f.alert = true;
      }
    }
    // Aimed where you are, not where you will be: a ship with way on sails out of it, and
    // one lying still does not. Leading the shot made her fan a certainty at any speed.
    const b = Math.atan2(s.y - e.y, s.x - e.x) + (w.r() - 0.5) * FOE_LAY;
    const fan = 1 + Math.floor(phase / 2);
    for (let i = -fan; i <= fan; i++) foeShot(w, e, e.x, e.y, b + i * 0.16, 3, 240);
    ev(w, 'foe-fire', { x: e.x, y: e.y, id: e.id, n: fan * 2 + 1, big: true });
  } else if (L.pattern === 'rain') {
    for (let i = 0; i < 3 + phase; i++) {
      w.marks.push({
        x: s.x + Math.cos(s.h) * s.v * 1.3 + (w.r() - 0.5) * 90,
        y: s.y + Math.sin(s.h) * s.v * 1.3 + (w.r() - 0.5) * 90,
        r: 18, t: 1.6, max: 1.6, own: false, dmg: 5, done: false,
      });
    }
    ev(w, 'mortar-in', { x: e.x, y: e.y, id: e.id });
  } else {
    const n = 8 + phase * 3;
    for (let i = 0; i < n; i++) foeShot(w, e, e.x, e.y, w.t * 1.6 + (i / n) * TAU, 3, 200, 80);
    ev(w, 'foe-fire', { x: e.x, y: e.y, id: e.id, n, big: true });
  }
  e.cool = reload;
  return [heading, 1];
}

/* ----------------------------------------------------------- seamanship -- */

const TURNS = [0.45, 0.9, 1.4, 2, 2.7];

/**
 * Look ahead along the heading she wants; if there is land there, find the nearest
 * heading that has none. A ship that cannot see the coast in front of her is a wreck.
 * Once she has picked a side to go round, she keeps to it until the way ahead is clear:
 * the nearest clear heading flips from one side to the other as she slows, and a ship
 * that took each in turn ground against the rocks for minutes at a time.
 */
export function avoid(w: World, e: Vessel & { detour?: -1 | 0 | 1 }, want: number): number {
  const look = e.len * 0.6 + e.v * 3.5 + 12;
  const pad = e.beam * 0.6 + 6;
  const clear = (a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (const k of [0.5, 1]) {
      const x = e.x + c * look * k, y = e.y + s * look * k;
      if (shoreDist(w.map, x, y) < pad || Math.hypot(x, y) > MAP_R - EDGE * 0.5) return false;
    }
    return true;
  };
  if (clear(want)) { e.detour = 0; return want; }
  const sides: (-1 | 1)[] = e.detour ? [e.detour, e.detour === 1 ? -1 : 1] : [1, -1];
  if (e.detour) {
    for (const sg of sides) for (const off of TURNS) if (clear(want + off * sg)) { e.detour = sg; return want + off * sg; }
  } else {
    for (const off of TURNS) for (const sg of sides) if (clear(want + off * sg)) { e.detour = sg; return want + off * sg; }
  }
  return want + Math.PI * 0.5 * (e.detour || 1);
}

export { isPrize, raise };
