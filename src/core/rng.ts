// Seeded randomness. Every roll the simulation makes goes through one of these, which
// is what lets a seed replay the same sea, the same fleet and the same battle forever.

export type Rng = () => number;

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 — same seed, same fleet, forever. */
export function rng(seed: string | number): Rng {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)];
