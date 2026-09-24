// Two dimensions are all the simulation needs. The sea is the XZ plane; the renderer
// is the only thing that knows there is an up.
//
// Headings are radians with forward = (cos h, sin h). With +y running south on the
// chart, starboard (the right hand, looking forward) is (-sin h, cos h).

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Wrap an angle into (-π, π]. */
export function wrap(a: number): number {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed shortest turn from a to b. */
export const angleTo = (a: number, b: number) => wrap(b - a);

export const hyp = Math.hypot;

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** Distance from point p to segment ab. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Round to six places for a digest, so -0 and float dust never split two replays. */
export const q6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
