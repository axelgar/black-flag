// Gradient noise for the land: seeded, smooth, and cheap enough to evaluate for every
// vertex of every island at start-up. Perlin's improved noise in two and three
// dimensions, and the fractal sums built on it.

import { rng } from '../core/rng';

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** A permutation table from a seed; every noise below reads one. */
function perm(seed: number | string): Uint8Array {
  const r = rng(typeof seed === 'string' ? seed : `noise:${seed}`);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
}

const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** 2D gradient noise, about -1..1. */
export function perlin2(seed: number | string) {
  const P = perm(seed);
  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (h: number, dx: number, dy: number) => { const v = G2[h & 7]; return v[0] * dx + v[1] * dy; };
    const aa = P[P[X] + Y], ab = P[P[X] + Y + 1], ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.1;
  };
}

/** 3D gradient noise, about -1..1 — for rocks, which are shapes and not surfaces. */
export function perlin3(seed: number | string) {
  const P = perm(seed);
  const grad = (h: number, x: number, y: number, z: number) => {
    const k = h & 15;
    const u = k < 8 ? x : y, v = k < 4 ? y : k === 12 || k === 14 ? x : z;
    return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
  };
  return (x: number, y: number, z: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    const l = (a: number, b: number, t: number) => a + t * (b - a);
    return l(
      l(l(grad(P[AA], xf, yf, zf), grad(P[BA], xf - 1, yf, zf), u), l(grad(P[AB], xf, yf - 1, zf), grad(P[BB], xf - 1, yf - 1, zf), u), v),
      l(l(grad(P[AA + 1], xf, yf, zf - 1), grad(P[BA + 1], xf - 1, yf, zf - 1), u), l(grad(P[AB + 1], xf, yf - 1, zf - 1), grad(P[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
      w,
    );
  };
}

/** Fractal sum: `oct` octaves, each twice the frequency and half the weight. About -1..1. */
export function fbm2(n: (x: number, y: number) => number, x: number, y: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); norm += a; a *= 0.5; f *= 2.02; }
  return s / norm;
}

/** Ridged fractal: sharp crests where the noise crosses zero. 0..1. */
export function ridged2(n: (x: number, y: number) => number, x: number, y: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(n(x * f + i * 11.7, y * f + i * 5.3)); s += a * v * v; norm += a; a *= 0.5; f *= 2.05; }
  return s / norm;
}
