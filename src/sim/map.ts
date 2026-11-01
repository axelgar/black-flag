// The chart. One seeded scatter of islands per sea, laid out for the sea at its biggest:
// when the sea grows with its ships, only its edge moves. The islands are cover. They stop
// shot and block sight, and there are a few near the middle, where a small sea is.
//
// Pure — the renderer builds its meshes from this, and the simulation collides with it
// and looks across it. An island is a centre and a radius per bearing (a blob, nearly
// round): enough to sail round, and cheap enough to ask "am I inside it" at 120Hz.

import { rng, type Rng } from '../core/rng';
import { TAU, clamp } from '../core/vec';
import { TUNING, seaRadius } from '../data/tuning';

/** The sea at its biggest: the islands are laid out inside this. */
export const MAP_R = seaRadius(TUNING.maxShips);
/** The edge pushes ships back in from this far inside the sea's radius. */
export const EDGE = 30;
const SPOKES = 32;

export interface Island {
  id: number;
  x: number; y: number;
  r: number;                // mean radius
  radii: number[];          // per-bearing radius, SPOKES long
  peak: number;             // height of her highest point, for the renderer
  kind: 'jungle' | 'rock' | 'sand';
  seed: number;
}

export interface GameMap {
  seed: string;
  islands: Island[];
}

function blob(r: Rng, id: number, x: number, y: number, rad: number, kind: Island['kind']): Island {
  // A gentle wobble, closed round the circle: a coast with a bay or two, but round enough
  // that a ball stopped by it is stopped where it looks it should be.
  const a1 = r() * TAU, a2 = r() * TAU, f1 = 2 + Math.floor(r() * 2), f2 = 4 + Math.floor(r() * 3);
  const radii = Array.from({ length: SPOKES }, (_, i) => {
    const t = (i / SPOKES) * TAU;
    return rad * (1 + 0.12 * Math.sin(t * f1 + a1) + 0.06 * Math.sin(t * f2 + a2) + (r() - 0.5) * 0.04);
  });
  // Low, so it hides no ship from a camera high in the south (the art brief keeps hills
  // to about 6 m).
  const peak = kind === 'rock' ? Math.min(7, 2 + rad * 0.12) : kind === 'sand' ? 1.5 : Math.min(6, 2 + rad * 0.08);
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

/** Island sizes, as the art brief has them: across, in metres, and how likely each is. */
const SIZES: { r: [number, number]; odds: number }[] = [
  { r: [10, 15], odds: 0.4 },
  { r: [20, 30], odds: 0.4 },
  { r: [35, 50], odds: 0.2 },
];

export function makeMap(seed: string): GameMap {
  const r = rng(`${seed}:map`);
  const islands: Island[] = [];
  const small = seaRadius(TUNING.minShips);

  const clear = (x: number, y: number, rad: number) => {
    if (Math.hypot(x, y) + rad > MAP_R - EDGE - 30) return false;
    // room for two ships to pass between any two islands
    for (const o of islands) if (Math.hypot(x - o.x, y - o.y) < rad + o.r + 70) return false;
    return true;
  };
  const place = (inner: number, outer: number) => {
    for (let guard = 0; guard < 200; guard++) {
      const a = r() * TAU, d = inner + Math.sqrt(r()) * (outer - inner);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      const k = r(), size = k < SIZES[0].odds ? SIZES[0] : k < SIZES[0].odds + SIZES[1].odds ? SIZES[1] : SIZES[2];
      const rad = size.r[0] + r() * (size.r[1] - size.r[0]);
      if (!clear(x, y, rad)) continue;
      const kk = r();
      const kind: Island['kind'] = rad < 16 ? (kk < 0.5 ? 'sand' : 'rock') : kk < 0.6 ? 'jungle' : kk < 0.85 ? 'rock' : 'sand';
      islands.push(blob(r, islands.length, x, y, rad, kind));
      return;
    }
  };
  // a few in the middle, where a quiet night's small sea is, never right on the centre
  for (let i = 0; i < 3; i++) place(50, small * 0.75);
  // and the rest scattered over the whole sea, about one to every 70,000 m²
  const more = Math.round((Math.PI * MAP_R * MAP_R) / 70000);
  for (let i = 0; i < more; i++) place(small * 0.5, MAP_R);
  return { seed, islands };
}

/** Deepest overlap of a circle with any island, and the way out of it. */
export function landPush(m: GameMap, x: number, y: number, rad: number): { d: number; nx: number; ny: number } | null {
  let worst: { d: number; nx: number; ny: number } | null = null;
  for (const is of m.islands) {
    const dx = x - is.x, dy = y - is.y;
    const dd = Math.hypot(dx, dy);
    if (dd > is.r * 1.3 + rad) continue;
    const pen = rad - (dd - coastAt(is, Math.atan2(dy, dx)));
    if (pen > 0 && (!worst || pen > worst.d)) worst = { d: pen, nx: dx / (dd || 1), ny: dy / (dd || 1) };
  }
  return worst;
}

/** How close the nearest coast is. Negative inside. */
export function shoreDist(m: GameMap, x: number, y: number): number {
  let best = 1e9;
  for (const is of m.islands) {
    if (Math.abs(x - is.x) > is.r * 1.3 + best || Math.abs(y - is.y) > is.r * 1.3 + best) continue;
    best = Math.min(best, islandSd(is, x, y));
  }
  return best;
}

/** The island a point is on, if any. */
export function onLand(m: GameMap, x: number, y: number): boolean {
  for (const is of m.islands) {
    if (Math.abs(x - is.x) > is.r * 1.3 || Math.abs(y - is.y) > is.r * 1.3) continue;
    if (islandSd(is, x, y) < 0) return true;
  }
  return false;
}

/**
 * Can someone at a see someone at b? Islands block sight. Marches the segment in 6m steps
 * against every island whose bounding circle it passes near.
 */
export function lineOfSight(m: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return true;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  for (const is of m.islands) {
    const t = clamp((is.x - ax) * ux + (is.y - ay) * uy, 0, len);
    const cx = ax + ux * t, cy = ay + uy * t;
    if (Math.hypot(cx - is.x, cy - is.y) > is.r * 1.3) continue;
    for (let s = 0; s <= len; s += 6) {
      if (islandSd(is, ax + ux * s, ay + uy * s) < -1) return false;
    }
  }
  return true;
}

/** Is this point open water inside a sea of radius R, far enough from land to put a ship on? */
export function openWater(m: GameMap, R: number, x: number, y: number, pad: number): boolean {
  if (Math.hypot(x, y) > R - EDGE - pad) return false;
  return shoreDist(m, x, y) > pad;
}
