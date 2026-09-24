// How a hull moves. The same helm for the Jackdaw and for every Spaniard — the AI does
// not get to cheat on turning circles, which is what makes out-turning a frigate a
// thing a captain can learn.

import { angleTo, clamp, wrap } from '../core/vec';
import { MAP_R, EDGE, landPush, type GameMap } from './map';
import type { Vessel } from './types';

/**
 * Set the canvas, find the way, turn the wheel. `heading` is a bearing to steer for;
 * with none, `rudder` turns her at a rate. Turning bites harder with way on: a ship
 * dead in the water barely answers her helm, which is what makes a stall a mistake.
 */
export function helm(s: Vessel, dt: number, heading: number | null, rudder: number, sail: number, speedMul = 1) {
  s.sail += (clamp(sail, 0, 1) - s.sail) * Math.min(1, dt * 1.6);
  const want = s.maxSpeed * speedMul * s.sail;
  const dv = want - s.v;
  s.v += clamp(dv, -s.accel * 1.8 * dt, s.accel * dt);

  // A ship with no way on still answers a little — enough to warp her head off a lee shore.
  const bite = 0.5 + 0.5 * clamp(s.v / (s.maxSpeed || 1), 0, 1);
  const rate = s.turnRate * bite;
  const h0 = s.h;
  if (heading != null) {
    const d = angleTo(s.h, heading);
    s.h += clamp(d, -rate * dt, rate * dt);
  } else {
    s.h += clamp(rudder, -1, 1) * rate * dt;
  }
  s.h = wrap(s.h);
  s.rot = angleTo(h0, s.h) / dt;

  s.x += Math.cos(s.h) * s.v * dt;
  s.y += Math.sin(s.h) * s.v * dt;
}

/**
 * Keep her off the land. Bow, waist and stern are each tested as a circle the width of
 * her beam; any that are aground push her back out and cost her way. Returns how hard
 * she hit, in m/s, so the caller can decide whether it hurt.
 */
export function ground(m: GameMap, s: Vessel): number {
  const fx = Math.cos(s.h), fy = Math.sin(s.h);
  let hit = 0;
  for (const k of [0.38, 0, -0.38]) {
    const px = s.x + fx * s.len * k, py = s.y + fy * s.len * k;
    const p = landPush(m, px, py, s.beam * 0.55);
    if (!p) continue;
    s.x += p.nx * p.d;
    s.y += p.ny * p.d;
    // Only the part of her way that was driving into the coast is lost.
    const into = -(fx * p.nx + fy * p.ny);
    if (into > 0) { hit = Math.max(hit, s.v * into); s.v *= 1 - into * 0.7; }
    // and a firm shove off, so a ship driven onto the beach backs off it rather than
    // sitting there grinding while you work the helm round.
    s.x += p.nx * 0.35; s.y += p.ny * 0.35;
  }
  return hit;
}

/** The rim current: gentle at first, then a wall. The chart has an edge and it says so. */
export function rim(s: Vessel, dt: number) {
  const d = Math.hypot(s.x, s.y);
  const inner = MAP_R - EDGE;
  if (d <= inner) return;
  const nx = s.x / d, ny = s.y / d;
  const over = d - inner;
  s.x -= nx * over * 1.4 * dt;
  s.y -= ny * over * 1.4 * dt;
  if (d > MAP_R) { s.x = nx * MAP_R; s.y = ny * MAP_R; }
}

/** Where along her length the bow, waist and stern are. Collision works off these. */
export function spine(s: Vessel): [number, number, number, number] {
  const fx = Math.cos(s.h) * s.len * 0.4, fy = Math.sin(s.h) * s.len * 0.4;
  return [s.x + fx, s.y + fy, s.x - fx, s.y - fy];
}

/** Closest approach between two hulls' spines, less both half-beams. Negative is touching. */
export function hullGap(a: Vessel, b: Vessel): number {
  const [ax, ay, bx, by] = spine(a);
  const [cx, cy, dx, dy] = spine(b);
  let best = 1e9;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    const ux = dx - cx, uy = dy - cy;
    const l2 = ux * ux + uy * uy || 1;
    const u = clamp(((px - cx) * ux + (py - cy) * uy) / l2, 0, 1);
    best = Math.min(best, Math.hypot(px - (cx + ux * u), py - (cy + uy * u)));
  }
  return best - (a.beam + b.beam) * 0.5;
}

/** Shove two hulls apart along the line between their centres. */
export function separate(a: Vessel, b: Vessel, gap: number, aShare = 0.5) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const d = Math.hypot(dx, dy) || 1;
  const push = -gap + 0.2;
  a.x += (dx / d) * push * aShare; a.y += (dy / d) * push * aShare;
  b.x -= (dx / d) * push * (1 - aShare); b.y -= (dy / d) * push * (1 - aShare);
}

/** Is a point inside her hull? An ellipse along her heading. */
export function inHull(s: Vessel, x: number, y: number, pad = 0): boolean {
  const dx = x - s.x, dy = y - s.y;
  const c = Math.cos(s.h), sn = Math.sin(s.h);
  const along = dx * c + dy * sn, across = -dx * sn + dy * c;
  const a = s.len * 0.5 + pad, b = s.beam * 0.5 + pad;
  return (along * along) / (a * a) + (across * across) / (b * b) <= 1;
}
