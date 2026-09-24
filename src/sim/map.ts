// The chart. One seeded archipelago per run: a round sea with Nassau at its heart,
// islands scattered through it, reefs in the shallows between, and a current at the
// rim that sets you back in. Pure — the renderer builds its meshes from this, and the
// simulation collides with it and looks across it.
//
// An island is a centre and a radius per bearing (a star-shaped blob). That is enough
// to be interesting to sail round, and cheap enough to ask "am I inside it" at 120Hz.

import { rng, type Rng } from '../core/rng';
import { TAU, clamp } from '../core/vec';

export const MAP_R = 900;          // the sea is a disc this wide
export const EDGE = 60;            // the rim current starts this far in from the edge
const SPOKES = 32;

export interface Island {
  id: number;
  x: number; y: number;
  r: number;                // mean radius
  radii: number[];          // per-bearing radius, SPOKES long
  peak: number;             // height of her highest point, for the renderer
  kind: 'jungle' | 'rock' | 'sand' | 'nassau';
  seed: number;
}

export interface Reef { x: number; y: number; r: number }

export interface Harbour { x: number; y: number; r: number }

export interface GameMap {
  seed: string;
  islands: Island[];
  reefs: Reef[];
  nassau: Island;
  harbour: Harbour;        // sail into this after a wave to careen
  start: { x: number; y: number; h: number };
  spawns: { x: number; y: number }[];   // where squadrons put to sea from
}

function blob(r: Rng, id: number, x: number, y: number, rad: number, kind: Island['kind']): Island {
  // Two octaves of wobble, closed round the circle, so the coast has bays and headlands.
  const a1 = r() * TAU, a2 = r() * TAU, f1 = 2 + Math.floor(r() * 2), f2 = 4 + Math.floor(r() * 3);
  const radii = Array.from({ length: SPOKES }, (_, i) => {
    const t = (i / SPOKES) * TAU;
    return rad * (1 + 0.24 * Math.sin(t * f1 + a1) + 0.12 * Math.sin(t * f2 + a2) + (r() - 0.5) * 0.08);
  });
  const peak = kind === 'rock' ? rad * 0.55 : kind === 'sand' ? 3 + rad * 0.05 : rad * 0.34;
  return { id, x, y, r: rad, radii, peak, kind, seed: Math.floor(r() * 1e9) };
}

/** Her coastline radius at a given bearing, interpolated between spokes. */
export function coastAt(is: Island, ang: number): number {
  let t = (ang / TAU) * SPOKES;
  t = ((t % SPOKES) + SPOKES) % SPOKES;
  const i = Math.floor(t), f = t - i;
  return is.radii[i] * (1 - f) + is.radii[(i + 1) % SPOKES] * f;
}

/** Signed distance to her coast: negative inside. Approximate, and good enough to steer by. */
export function islandSd(is: Island, x: number, y: number): number {
  const dx = x - is.x, dy = y - is.y;
  const d = Math.hypot(dx, dy);
  return d - coastAt(is, Math.atan2(dy, dx));
}

export function makeMap(seed: string): GameMap {
  const r = rng(`${seed}:map`);
  const islands: Island[] = [];

  // Nassau: the one island that is always there, a little north of the centre, with her
  // harbour mouth opening south onto the sea you start in.
  const nassau = blob(r, 0, 0, -70, 62, 'nassau');
  islands.push(nassau);
  const harbour: Harbour = { x: 0, y: 40, r: 55 };

  const clear = (x: number, y: number, rad: number, pad: number) => {
    if (Math.hypot(x, y) + rad > MAP_R - EDGE - 40) return false;
    if (Math.hypot(x - harbour.x, y - harbour.y) < rad + 150) return false;
    for (const o of islands) if (Math.hypot(x - o.x, y - o.y) < rad + o.r * 1.3 + pad) return false;
    return true;
  };

  let guard = 0;
  while (islands.length < 15 && guard++ < 600) {
    const a = r() * TAU, d = 190 + Math.sqrt(r()) * (MAP_R - 300);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const k = r();
    const kind: Island['kind'] = k < 0.5 ? 'jungle' : k < 0.78 ? 'rock' : 'sand';
    const rad = kind === 'sand' ? 16 + r() * 18 : kind === 'rock' ? 14 + r() * 26 : 30 + r() * 46;
    if (!clear(x, y, rad, 70)) continue;
    islands.push(blob(r, islands.length, x, y, rad, kind));
  }

  const reefs: Reef[] = [];
  guard = 0;
  while (reefs.length < 22 && guard++ < 800) {
    const a = r() * TAU, d = 160 + r() * (MAP_R - 240);
    const x = Math.cos(a) * d, y = Math.sin(a) * d, rad = 5 + r() * 8;
    if (!clear(x, y, rad, 25)) continue;
    if (reefs.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + rad + 40)) continue;
    reefs.push({ x, y, r: rad });
  }

  // Squadrons put to sea from twelve points round the rim.
  const spawns = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * TAU + 0.13;
    return { x: Math.cos(a) * (MAP_R - EDGE - 40), y: Math.sin(a) * (MAP_R - EDGE - 40) };
  });

  return {
    seed, islands, reefs, nassau, harbour, spawns,
    start: { x: harbour.x, y: harbour.y + harbour.r + 25, h: Math.PI / 2 },   // just out of the mouth, heading south
  };
}

/** Deepest overlap of a circle with any island, and the way out of it. */
export function landPush(m: GameMap, x: number, y: number, rad: number): { d: number; nx: number; ny: number } | null {
  let worst: { d: number; nx: number; ny: number } | null = null;
  for (const is of m.islands) {
    const dx = x - is.x, dy = y - is.y;
    const dd = Math.hypot(dx, dy);
    if (dd > is.r * 1.5 + rad) continue;
    const pen = rad - (dd - coastAt(is, Math.atan2(dy, dx)));
    if (pen > 0 && (!worst || pen > worst.d)) worst = { d: pen, nx: dx / (dd || 1), ny: dy / (dd || 1) };
  }
  return worst;
}

/** How close the nearest coast or reef is. Negative inside. */
export function shoreDist(m: GameMap, x: number, y: number): number {
  let best = 1e9;
  for (const is of m.islands) {
    if (Math.abs(x - is.x) > is.r * 1.5 + best || Math.abs(y - is.y) > is.r * 1.5 + best) continue;
    best = Math.min(best, islandSd(is, x, y));
  }
  for (const k of m.reefs) best = Math.min(best, Math.hypot(x - k.x, y - k.y) - k.r);
  return best;
}

/**
 * Can someone at a see someone at b? Islands block sight; reefs are awash and do not.
 * Marches the segment in 12m steps against every island whose bounding circle it
 * passes near — a squadron behind a headland really cannot see you.
 */
export function lineOfSight(m: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return true;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  for (const is of m.islands) {
    // closest approach of the segment to her centre
    const t = clamp((is.x - ax) * ux + (is.y - ay) * uy, 0, len);
    const cx = ax + ux * t, cy = ay + uy * t;
    if (Math.hypot(cx - is.x, cy - is.y) > is.r * 1.45) continue;
    for (let s = 0; s <= len; s += 12) {
      if (islandSd(is, ax + ux * s, ay + uy * s) < -2) return false;
    }
  }
  return true;
}

/** Is this point open water, far enough from everything to put a ship on? */
export function openWater(m: GameMap, x: number, y: number, pad: number): boolean {
  if (Math.hypot(x, y) > MAP_R - EDGE - pad) return false;
  return shoreDist(m, x, y) > pad;
}
