// Her lines. A hull's whole shape is a function of two numbers: how far along her, t
// (0 at the taffrail, 1 at the stem head), and how high, y (metres above the
// waterline). The builders sample these; nothing else knows what shape she is.
//
// The shape is the one ships of 1715 had: a full, bluff bow that flares above the water,
// a round bilge amidships going to a V at either end, the run narrowing under a wide
// transom, the sides drawn in toward the rail (tumblehome, strongest on a galleon), the
// sheer rising at both ends, and castles stepped up at the stern and bow.

import type { HullRecipe } from '../../data/types';
import type { V3 } from './mesh';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A raised deck: from t to t, and how far above the deck below it. */
export interface Castle { from: number; to: number; h: number }

export class Form {
  readonly L: number; readonly B: number; readonly F: number; readonly D: number;
  readonly half: number;
  /** Rail above the deck, and how thick the bulwark is. */
  readonly bulwark: number; readonly thick: number;
  readonly qd: Castle | null; readonly poop: Castle | null; readonly fc: Castle | null;
  /** How far the sides draw in at the rail, and how wide the transom is, both as fractions. */
  readonly tumble: number; readonly transom: number;
  /** Height of the wing transom (the bottom of the flat stern) and of greatest breadth. */
  readonly ywt: number; readonly ymb: number;
  /** Where the entry and the run begin, and where the keel starts to turn up into the stem. */
  readonly entry: number; readonly run: number; readonly foot: number;
  /** Lean of the transom aft, and of the stem forward, per metre of height. */
  readonly rake: number; readonly stemRake: number;
  readonly ramp: number;

  constructor(readonly R: HullRecipe) {
    const L = this.L = R.length, B = this.B = R.beam, F = this.F = R.freeboard;
    this.D = R.draft;
    this.half = B / 2;
    this.bulwark = clamp(F * 0.44, 0.7, 1.5);
    this.thick = 0.12 + L * 0.0028;
    const big = R.stern === 'galleon';
    this.tumble = big ? 0.2 : R.stern === 'castle' ? 0.12 : 0.07;
    this.transom = R.stern === 'pointed' ? 0 : R.stern === 'transom' ? 0.6 : big ? 0.72 : 0.68;
    this.ywt = F * 0.24;
    this.ymb = F * 0.32;
    this.entry = big ? 0.6 : 0.56;
    this.run = big ? 0.3 : 0.36;
    this.foot = 0.8;
    this.rake = R.stern === 'pointed' ? 0 : big ? 0.16 : 0.3;
    this.stemRake = 0.2;
    this.ramp = 0.3 / L;
    const H = (k: number, lo: number, hi: number) => clamp(F * k, lo, hi);
    this.qd = R.stern === 'castle' ? { from: 0, to: L > 32 ? 0.3 : 0.25, h: H(0.44, 1.2, 2.1) }
      : big ? { from: 0, to: 0.36, h: H(0.4, 1.6, 2.5) } : null;
    this.poop = big ? { from: 0, to: 0.17, h: H(0.33, 1.4, 2.1) } : null;
    this.fc = R.forecastle ? { from: 0.84, to: 1, h: H(0.3, 1.1, 1.9) } : null;
  }

  x(t: number) { return (t - 0.5) * this.L; }

  /** How far the sheer rises over the freeboard: more at the bow than at the stern. */
  sheer(t: number) {
    const S = this.R.sheer;
    return t > 0.45 ? S * ((t - 0.45) / 0.55) ** 2 : S * 0.75 * ((0.45 - t) / 0.45) ** 2;
  }

  /** The main rail — the sheer line — ignoring castles. */
  railMain(t: number) { return this.F + this.sheer(t); }
  /** The main deck. */
  deck(t: number) { return this.railMain(t) - this.bulwark; }

  /** How far the castles lift her at t: exact for a deck; for the hull's side, full
   *  height to the break and then eased down just outside it. */
  rise(t: number, eased = true): number {
    const step = (d: number) => (eased ? smoothstep(-this.ramp, this.ramp, d + this.ramp) : d >= 0 ? 1 : 0);
    let r = 0;
    if (this.qd) r += this.qd.h * step(this.qd.to - t);
    if (this.poop) r += this.poop.h * step(this.poop.to - t);
    if (this.fc) r += this.fc.h * step(t - this.fc.from);
    return r;
  }

  /** Top of her side, castles and all. */
  rail(t: number) { return this.railMain(t) + this.rise(t); }
  /** The deck you would stand on at t. */
  floor(t: number) { return this.deck(t) + this.rise(t, false); }

  /** The keel, turning up through the forefoot into the stem. */
  keel(t: number) {
    if (t <= this.foot) return -this.D;
    const s = (t - this.foot) / (1 - this.foot);
    return -this.D + (this.rail(1) + this.D) * (1 - Math.sqrt(Math.max(0, 1 - s * s)));
  }

  /** A line that is h high amidships, carried along the sheer the way strakes are. */
  band(t: number, h: number) { return h + this.sheer(t) * clamp(h / this.F, 0, 1); }

  /** How full she is at t, as a fraction of her beam. */
  plan(t: number, y: number) {
    const up = clamp(y / this.F, -1, 1.6);
    if (t > this.entry) {
      const s = (t - this.entry) / (1 - this.entry);
      const e = clamp(1.7 + 0.5 * up, 1.15, 2.5);          // bluffer up high: the bow flares
      return Math.pow(Math.max(0, 1 - Math.pow(s, e)), 1 / e);
    }
    if (t < this.run) {
      const s = (this.run - t) / this.run;
      const tw = this.transom * smoothstep(this.ywt, this.ywt + this.F * 0.5, y);
      const e = clamp(1.45 + 1.1 * clamp(up, 0, 1), 1.2, 2.6);
      const f = Math.pow(Math.max(0, 1 - Math.pow(s, e)), 1 / e);
      return tw + (1 - tw) * f;
    }
    return 1;
  }

  /** Half-breadth of her outside at t, y. */
  hb(t: number, y: number): number {
    const k = this.keel(t);
    if (y <= k) return 0;
    const top = Math.max(this.railMain(t), k + 0.3);
    const span = top - k;
    const v = (y - k) / span;
    const vmb = clamp((this.ymb - k) / span, 0.14, 0.8);
    let sec: number;
    if (v < vmb) {
      const full = clamp(1 - Math.pow(Math.abs(t - 0.52) / 0.52, 2.4), 0, 1);
      const p = 1.1 + 1.5 * full;                          // a round bilge amidships, a V at the ends
      sec = Math.pow(Math.max(0, 1 - Math.pow((vmb - v) / vmb, p)), 1 / p);
    } else {
      const q = (v - vmb) / (1 - vmb);
      sec = Math.max(0.42, 1 - this.tumble * q * q);
    }
    return this.half * this.plan(t, y) * sec;
  }

  /** x at t, y: the transom leans aft above the water and the stem forward. */
  xAt(t: number, y: number) {
    let x = this.x(t);
    if (t < 0.06) x -= this.rake * Math.max(0, y - this.ywt) * (1 - t / 0.06);
    if (t > 0.9) x += this.stemRake * Math.max(0, y) * ((t - 0.9) / 0.1);
    return x;
  }

  point(t: number, y: number, side = 1): V3 {
    return [this.xAt(t, y), y, side * this.hb(t, y)];
  }

  /** Outward normal of the hull's skin, by finite differences of the lines themselves. */
  normal(t: number, y: number, side = 1): V3 {
    const t0 = Math.max(0, t - 0.0025), t1 = Math.min(1, t + 0.0025);
    const a = this.point(t0, y), b = this.point(t1, y);
    const c = this.point(t, y - 0.03), d = this.point(t, y + 0.03);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, side * nz];
  }

  /** Stations bow to stern: close together at the ends where she curves, and either side
   *  of every castle break so the steps come out crisp. */
  stations(n = 40): number[] {
    const ts: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      ts.push(0.6 * (0.5 - 0.5 * Math.cos(Math.PI * k)) + 0.4 * k);
    }
    const r = this.ramp;
    if (this.qd) ts.push(this.qd.to, this.qd.to + r, this.qd.to + r * 2);
    if (this.poop) ts.push(this.poop.to, this.poop.to + r, this.poop.to + r * 2);
    if (this.fc) ts.push(this.fc.from - r * 2, this.fc.from - r, this.fc.from);
    ts.push(this.foot);
    ts.sort((a, b) => a - b);
    const out: number[] = [];
    for (const t of ts) if (t >= 0 && t <= 1 && (!out.length || t - out[out.length - 1] > 0.002)) out.push(t);
    if (out[out.length - 1] < 1) out.push(1);
    return out;
  }

  /** Where a length along her is, as t. */
  tOf(x: number) { return x / this.L + 0.5; }

  /** Where her masts step, and how tall each is against the tallest. Aft to fore. */
  masts(): Step[] {
    const R = this.R;
    if (R.masts <= 1) return [{ t: R.rig === 'fore-aft' ? 0.6 : R.rig === 'lateen' ? 0.62 : 0.55, tall: 1, role: 'single' }];
    if (R.masts === 2) return [{ t: 0.35, tall: 1, role: 'main' }, { t: 0.67, tall: 0.9, role: 'fore' }];
    return [{ t: 0.21, tall: 0.78, role: 'mizzen' }, { t: 0.5, tall: 1, role: 'main' }, { t: 0.76, tall: 0.9, role: 'fore' }];
  }

  /** Where the stem is at height y. */
  stemX(y: number) {
    let lo = this.foot, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (this.keel(m) < y) lo = m; else hi = m; }
    return this.xAt(hi, y);
  }
}

export interface Step { t: number; tall: number; role: 'fore' | 'main' | 'mizzen' | 'single' }
