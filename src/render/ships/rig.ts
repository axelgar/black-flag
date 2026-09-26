// The rig: masts stepped in two or three pieces with their tops and crosstrees, yards and
// gaffs, the canvas they carry, and the rigging that keeps it standing — shrouds with
// ratlines to climb, stays, backstays, lifts, braces and footropes. Spars go into the
// ship's solid mesh; canvas and rope into meshes of their own.
//
// Each mast is built in its own frame (y up the mast, x forward), tipped aft by its
// rake, so a raked schooner mast carries its gaff and topmast with it.

import * as THREE from 'three';
import type { Emblem } from '../../data/types';
import { Form, type Step } from './form';
import { crewRng, outfitter, sailor } from './crew';
import type { Dress } from './hull';
import { FIN, LOD, Mesh, at, frame, type V3 } from './mesh';
import { CANVAS_REGION } from './paint';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const TAR = new THREE.Color('#231B14');    // standing rigging, tarred black
const HEMP = new THREE.Color('#6E5C44');   // running rigging
const RATLINE = new THREE.Color('#33291F');

/* --------------------------------------------------------------- rope ----- */

/** Rigging as ribbons: each vertex knows its rope's direction, which side of it it is on
 *  and how thick the rope is. The rope shader turns each to face the camera. */
export class Ropes {
  private P: number[] = [];
  private D: number[] = [];
  private E: number[] = [];
  private C: number[] = [];
  private I: number[] = [];

  /** A rope from a to b, sagging `sag` metres at its middle. */
  line(a: V3, b: V3, r: number, col: THREE.Color, sag = 0) {
    const len = dist(a, b);
    if (len < 1e-3) return;
    const segs = sag > 0.01 ? Math.min(8, 2 + Math.ceil(len / 5)) : 1;
    let prev = a;
    for (let i = 1; i <= segs; i++) {
      const u = i / segs;
      const p: V3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u];
      this.seg(prev, p, r, col);
      prev = p;
    }
  }

  private seg(a: V3, b: V3, r: number, col: THREE.Color) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return;
    const base = this.P.length / 3;
    const ends: [V3, number][] = [[a, -1], [a, 1], [b, -1], [b, 1]];
    for (const [p, s] of ends) {
      this.P.push(p[0], p[1], p[2]);
      this.D.push(dx / l, dy / l, dz / l);
      this.E.push(s, r);
      this.C.push(col.r, col.g, col.b);
    }
    this.I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  get count() { return this.P.length / 3; }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.D, 3));
    g.setAttribute('aRope', new THREE.Float32BufferAttribute(this.E, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

/* ------------------------------------------------------------- canvas ----- */

/** Sails, each a grid carrying its billow (so the shader can let the wind out of it),
 *  the direction it billows in, and where in the canvas atlas its cloth comes from. */
export class Canvas {
  private P: number[] = [];
  private N: number[] = [];
  private U: number[] = [];
  private B: number[] = [];
  private A: number[] = [];
  private I: number[] = [];

  sheet(nx: number, ny: number, fn: (s: number, t: number) => { p: V3; bil: number }, axis: V3, region: number, M?: THREE.Matrix4) {
    const pts: THREE.Vector3[] = [], bil: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const r = fn(i / nx, j / ny);
        pts.push(new THREE.Vector3(...r.p));
        bil.push(r.bil);
      }
    }
    const id = (i: number, j: number) => j * (nx + 1) + i;
    const nrm = pts.map((_, k) => {
      const i = k % (nx + 1), j = Math.floor(k / (nx + 1));
      const a = pts[id(Math.max(0, i - 1), j)], b = pts[id(Math.min(nx, i + 1), j)];
      const c = pts[id(i, Math.max(0, j - 1))], e = pts[id(i, Math.min(ny, j + 1))];
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), e.clone().sub(c));
      // a sheet that closes to a point (a jib's head) has no width up there: borrow the row below
      if (n.lengthSq() < 1e-10 && j < ny) {
        const a2 = pts[id(Math.max(0, i - 1), j + 1)], b2 = pts[id(Math.min(nx, i + 1), j + 1)];
        n.crossVectors(b2.clone().sub(a2), e.clone().sub(c));
      }
      return n.normalize();
    });
    const ax = new THREE.Vector3(...axis);
    if (M) {
      const nm = new THREE.Matrix3().getNormalMatrix(M);
      for (const p of pts) p.applyMatrix4(M);
      for (const n of nrm) n.applyMatrix3(nm).normalize();
      ax.transformDirection(M);
    }
    const base = this.P.length / 3;
    const ou = (region % 2) * 0.5, ov = Math.floor(region / 2) * 0.5;
    for (let k = 0; k < pts.length; k++) {
      const i = k % (nx + 1), j = Math.floor(k / (nx + 1));
      this.P.push(pts[k].x, pts[k].y, pts[k].z);
      this.N.push(nrm[k].x, nrm[k].y, nrm[k].z);
      this.U.push(ou + 0.006 + (i / nx) * 0.488, ov + 0.006 + (j / ny) * 0.488);
      this.B.push(bil[k]);
      this.A.push(ax.x, ax.y, ax.z);
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + id(i, j), b = base + id(i + 1, j), c = base + id(i + 1, j + 1), e = base + id(i, j + 1);
        this.I.push(a, b, e, b, c, e);
      }
    }
  }

  get count() { return this.P.length / 3; }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aCuv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aBillow', new THREE.Float32BufferAttribute(this.B, 1));
    g.setAttribute('aAxis', new THREE.Float32BufferAttribute(this.A, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

/** A square sail from a yard to the yard below, in its mast's frame: head and foot
 *  half-widths, billowing forward, the foot roached up in the middle. */
function squareSail(cv: Canvas, M: THREE.Matrix4, x: number, yHead: number, hHead: number, yFoot: number, hFoot: number, region: number, course = false) {
  const H = yHead - yFoot;
  const depth = H * (course ? 0.16 : 0.14);
  const roach = H * (course ? 0.08 : 0.05);
  cv.sheet(12, 9, (s, t) => {
    const z = ((-hHead + 2 * hHead * s) * (1 - t) + (-hFoot + 2 * hFoot * s) * t) * (1 - 0.035 * Math.sin(Math.PI * t));
    const y = yHead + (yFoot - yHead) * t + roach * Math.sin(Math.PI * s) * Math.pow(t, 6);
    const prof = Math.pow(Math.sin(Math.min(1, t / 0.6) * Math.PI / 2), 0.85) * (1 - 0.3 * Math.pow(Math.max(0, (t - 0.6) / 0.4), 1.4));
    const bil = depth * Math.pow(Math.sin(Math.PI * s), 0.8) * prof;
    return { p: [x + bil, y, z], bil };
  }, [1, 0, 0], region, M);
}

/** A fore-and-aft sail on four corners (a triangle when two meet): head at the luff,
 *  peak, clew and tack. It billows to starboard. */
function foreAft(cv: Canvas, A: V3, B: V3, C: V3, D: V3, depth: number, region: number, loose = false) {
  cv.sheet(9, 8, (s, t) => {
    const top = mix(A, B, s), bot = mix(D, C, s);
    const p = mix(top, bot, t);
    const along = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.9);
    const down = loose ? Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI / 2), 0.8) : Math.pow(Math.sin(Math.PI * t), 0.75);
    const bil = depth * along * down;
    return { p: [p[0], p[1], p[2] + bil], bil };
  }, [0, 0, 1], region);
}

/* --------------------------------------------------------------- masts ---- */

interface Yard { y: number; half: number; r: number; x: number }

interface Mast {
  s: Step;
  x: number; y0: number;               // where she is stepped, and the deck there
  M: THREE.Matrix4;                    // mast frame → ship
  H: number; r: number;                // height over the deck; lower mast's radius
  h1: number; h2: number;              // the top, and the crosstrees
  tw: number;                          // half-width of the top
  xt: number; rt: number;              // topmast: how far forward of the lower mast, and its radius
  xg: number; rg: number;              // topgallant
  tall3: boolean;                      // does she carry a topgallant mast
  yards: Yard[];
  square: boolean;
}

function lp(ms: Mast, p: V3): V3 {
  const v = new THREE.Vector3(...p).applyMatrix4(ms.M);
  return [v.x, v.y, v.z];
}

function makeMast(f: Form, s: Step): Mast {
  const R = f.R, L = f.L, B = f.B;
  const square = R.rig === 'square' || (R.squareTops === true && s.role === 'fore');
  const tiers = clamp(R.tiers, 1, 4);
  const x = f.x(s.t), y0 = f.floor(s.t);
  const H = R.mastHeight * L * s.tall * 0.85;
  const r = clamp(L * 0.0115 * (0.6 + 0.4 * s.tall), 0.1, 0.8);
  const rake = R.rig === 'square' ? (s.role === 'mizzen' ? 0.06 : s.role === 'fore' ? 0.015 : 0.035) : R.rig === 'lateen' ? 0.05 : 0.085;
  const M = new THREE.Matrix4().makeRotationZ(rake).setPosition(x, y0, 0);
  const fa = R.rig !== 'square';
  const h1 = H * (fa ? 0.64 : tiers === 1 ? 0.8 : 0.45);
  const h2 = H * (fa ? 0.86 : tiers <= 2 ? 0.96 : 0.77);
  const tw = clamp(B * 0.15 * s.tall + 0.35, 0.6, 3.4);
  const rt = r * 0.62, rg = r * 0.42;
  const xt = r * 1.7, xg = xt + rt * 1.35;
  const yards: Yard[] = [];
  if (R.rig === 'square') {
    const half = B * 0.9 * s.tall * (s.role === 'mizzen' ? 0.92 : 1);
    const yr = r * 0.5;
    yards.push({ y: h1 - 0.035 * H, half, r: yr, x: r + yr });
    if (tiers >= 2) yards.push({ y: h1 + 0.72 * (h2 - h1), half: half * 0.78, r: yr * 0.8, x: xt + rt + yr * 0.8 });
    if (tiers >= 3) yards.push({ y: h2 + 0.52 * (H - h2), half: half * 0.56, r: yr * 0.62, x: xg + rg + yr * 0.62 });
    if (tiers >= 4) yards.push({ y: h2 + 0.84 * (H - h2), half: half * 0.4, r: yr * 0.46, x: xg + rg * 0.8 + yr * 0.46 });
  } else if (square) {
    // a topsail schooner's foremast: a square topsail and topgallant over her fore-and-aft sail
    const half = B * 0.62;
    yards.push({ y: h1 - 0.02 * H, half, r: r * 0.4, x: r + r * 0.4 });
    yards.push({ y: h1 + 0.6 * (H - h1), half: half * 0.72, r: r * 0.32, x: xt + rt + r * 0.32 });
    yards.push({ y: H * 0.97, half: half * 0.5, r: r * 0.26, x: xt + rt * 0.7 + r * 0.26 });
  }
  return { s, x, y0, M, H, r, h1, h2, tw, xt, rt, xg, rg, tall3: !fa && tiers >= 3, yards, square };
}

/** Spars in the solid mesh: the mast in its sections, top, cap, crosstrees, yards, truck. */
function spars(m: Mesh, ms: Mast, d: Dress, fa: boolean, pole: boolean) {
  const { H, r, h1, h2, tw, xt, rt, xg, rg } = ms;
  m.push(ms.M);
  m.paint(d.spar, FIN.wood);
  if (pole) {
    // a launch's mast: one stick
    m.cyl([0, -0.6, 0], [0, H, 0], r, r * 0.6, 8);
    m.pop();
    return;
  }
  // lower mast, with iron hoops
  const sides = LOD.lo ? 7 : 10;
  m.cyl([0, -1.2, 0], [0, h1 + 0.08 * H, 0], r, r * 0.8, sides);
  m.paint(d.metal, FIN.iron);
  if (!LOD.lo) for (let k = 1; k < 5; k++) m.cyl([0, h1 * k * 0.2 - 0.08, 0], [0, h1 * k * 0.2 + 0.08, 0], r * 1.06, r * 1.04, sides);
  m.paint(d.spar, FIN.wood);
  if (!fa) {
    // the top: a platform to stand on, with a rail along its after edge
    m.push(frame([r * 0.35, h1, 0], [1, 0, 0], [0, 0, 1]));
    m.paint(d.deck, FIN.wood).slab([[-0.55 * tw, -tw], [0.2 * tw, -tw], [0.45 * tw, -0.62 * tw], [0.52 * tw, 0], [0.45 * tw, 0.62 * tw], [0.2 * tw, tw], [-0.55 * tw, tw]], 0.16);
    m.pop();
    m.paint(d.rail, FIN.wood);
    for (let i = 0; i <= 6; i++) m.push(at(r * 0.35 - 0.52 * tw, h1 + 0.35, -tw * 0.95 + (i / 6) * tw * 1.9)).box(0.07, 0.6, 0.07).pop();
    m.beam([r * 0.35 - 0.52 * tw, h1 + 0.66, -tw * 0.97], [r * 0.35 - 0.52 * tw, h1 + 0.66, tw * 0.97], 0.09, 0.07);
  } else {
    // a fore-and-aft mast has only crosstrees at her head
    m.beam([r * 0.4, h1, -tw * 0.7], [r * 0.4, h1, tw * 0.7], 0.14, 0.12);
    m.beam([-r, h1 + 0.1, 0], [xt + rt * 1.5, h1 + 0.1, 0], 0.12, 0.14);
  }
  // cap and topmast
  m.paint(d.metal, FIN.iron).push(at(xt * 0.5, h1 + 0.08 * H, 0)).box(xt + rt * 2 + 0.2, 0.3, Math.max(r, rt) * 2 + 0.2).pop();
  m.paint(d.spar, FIN.wood);
  const topTop = ms.tall3 ? h2 + 0.06 * H : H;
  m.cyl([xt, h1 - 0.3, 0], [xt, topTop, 0], rt, rt * 0.72, 8);
  if (ms.tall3) {
    // crosstrees and the topgallant mast
    m.beam([xt - rt * 1.4, h2, -tw * 0.5], [xt - rt * 1.4, h2, tw * 0.5], 0.12, 0.1);
    m.beam([xt + rt * 1.6, h2, -tw * 0.42], [xt + rt * 1.6, h2, tw * 0.42], 0.12, 0.1);
    m.paint(d.metal, FIN.iron).push(at((xt + xg) / 2, h2 + 0.06 * H, 0)).box(xg - xt + rt * 2 + 0.1, 0.2, rt * 2 + 0.12).pop();
    m.paint(d.spar, FIN.wood).cyl([xg, h2 - 0.2, 0], [xg, H, 0], rg, rg * 0.55, 7);
  }
  // the truck at her very head
  const tx = ms.tall3 ? xg : xt;
  m.push(at(tx, H, 0)).lathe([[0.02, 0], [Math.max(0.12, r * 0.45), 0.08], [Math.max(0.12, r * 0.45), 0.18], [0.02, 0.24]], 8, true).pop();
  // yards, tapered from the slings to the arms
  for (const y of ms.yards) {
    m.paint(d.rail, FIN.wood);
    m.cyl([y.x, y.y, 0], [y.x, y.y, y.half], y.r, y.r * 0.45, 7, true);
    m.cyl([y.x, y.y, 0], [y.x, y.y, -y.half], y.r, y.r * 0.45, 7, true);
    m.paint(d.metal, FIN.iron).cyl([y.x, y.y, -y.r * 1.6], [y.x, y.y, y.r * 1.6], y.r * 1.12, y.r * 1.12, 7);
  }
  m.pop();
}

/* ------------------------------------------------------------- the rig ---- */

export interface RigOut {
  /** Each masthead, aft to fore, and which is tallest. */
  trucks: THREE.Vector3[];
  main: number;
  height: number;
}

export function buildRig(m: Mesh, cv: Canvas, rp: Ropes, f: Form, d: Dress, emblem: Emblem): RigOut {
  const R = f.R, L = f.L;
  const masts = f.masts().map((s) => makeMast(f, s));
  const fa = R.rig !== 'square';
  const rs = clamp(L * 0.0016, 0.03, 0.1);          // standing rigging
  const rr = rs * 0.65, rat = rs * 0.42;            // running rigging, ratlines
  const plain = (k: number) => (k % 2 ? CANVAS_REGION.plain2 : CANVAS_REGION.none);
  const mark = emblem === 'none' ? null : CANVAS_REGION[emblem];
  let sailNo = 0;

  // ---- bowsprit and jib-boom
  let sprit: { foot: V3; cap: V3; mid: V3; end: V3 } | null = null;
  if (R.bowsprit) {
    const t0 = 0.9, foot: V3 = [f.x(t0), f.floor(t0) + 0.35, 0];
    const stem: V3 = [f.stemX(f.rail(1)) + 0.2, f.rail(1) + 0.25, 0];
    const ang = fa ? 0.17 : 0.3;
    const len = L * (fa ? 0.3 : 0.24);
    const dir: V3 = [Math.cos(ang), Math.sin(ang), 0];
    const cap: V3 = [stem[0] + dir[0] * len, stem[1] + dir[1] * len, 0];
    const rb = clamp(L * 0.0085, 0.1, 0.55);
    m.paint(d.spar, FIN.wood).cyl(foot, cap, rb, rb * 0.62, 9);
    m.paint(d.metal, FIN.iron).push(at(cap[0], cap[1], 0, 0, ang)).box(rb * 1.6, rb * 2.2, rb * 1.8).pop();
    const jbFrom = mix(foot, cap, 0.62), jl = L * (fa ? 0.18 : 0.19);
    const end: V3 = [cap[0] + dir[0] * jl, cap[1] + dir[1] * jl + rb * 0.9, 0];
    m.paint(d.spar, FIN.wood).cyl([jbFrom[0], jbFrom[1] + rb * 0.9, 0], end, rb * 0.5, rb * 0.3, 7);
    // dolphin striker under the cap, and the ropes that hold it all down
    const striker: V3 = [cap[0] - 0.1, cap[1] - L * 0.055, 0];
    m.cyl([cap[0], cap[1] - rb, 0], striker, rb * 0.3, rb * 0.25, 6);
    const cut: V3 = [f.stemX(0.4) + 0.15, 0.4, 0];
    rp.line(cap, cut, rs, TAR);
    rp.line(striker, end, rs * 0.8, TAR);
    rp.line(striker, [f.stemX(1) + 0.2, 1, 0], rs * 0.8, TAR);
    for (const s of [1, -1]) {
      const bow = f.hb(0.94, f.rail(0.94));
      rp.line(mix(foot, cap, 0.72), [f.x(0.94), f.rail(0.94) - 0.2, s * (bow + 0.1)], rs * 0.8, TAR);
      rp.line(end, [f.x(0.9), f.rail(0.9) + 0.2, s * (f.hb(0.9, f.rail(0.9)) + 0.4)], rr * 0.8, HEMP, 0.15);
    }
    // a spritsail under the bowsprit, on the great ships
    if (R.stern === 'galleon' && !fa) {
      const at0 = mix(stem, cap, 0.55), half = f.B * 0.42;
      m.paint(d.rail, FIN.wood).cyl([at0[0], at0[1] - 0.4, -half], [at0[0], at0[1] - 0.4, half], rb * 0.35, rb * 0.35, 6, true);
      const Mf = new THREE.Matrix4().setPosition(at0[0] + 0.3, 0, 0);
      squareSail(cv, Mf, 0, at0[1] - 0.55, half * 0.95, at0[1] - 0.55 - f.B * 0.32, half, plain(sailNo++));
    }
    sprit = { foot, cap, mid: mix(foot, cap, 0.45), end };
  }

  // ---- masts and yards
  for (const ms of masts) spars(m, ms, d, fa && !ms.square, R.rig === 'lateen');

  masts.forEach((ms, i) => {
    const { H, r, h1, h2, tw, xt, xg } = ms;
    const aft = masts[i - 1], fwd = masts[i + 1];
    const t = ms.s.t;
    const railY = f.rail(t);

    // ---- square canvas, courses to royals
    if (ms.yards.length) {
      const courseFoot = Math.max(railY + 1.1, ms.y0 + 2.0) - ms.y0;
      const hasCourse = R.rig === 'square' && ms.s.role !== 'mizzen';
      ms.yards.forEach((y, k) => {
        const below = ms.yards[k - 1];
        if (k === 0 && !hasCourse) return;
        const yHead = y.y - y.r * 0.8;
        const yFoot = below ? below.y + below.r : courseFoot;
        const hFoot = below ? below.half * 0.97 : y.half * 1.02;
        // The Spanish wear the Cross of Burgundy on their courses; a pirate her skull on
        // the main topsail, where the whole sea can read it.
        const main = ms.s.role === 'main' || ms.s.role === 'single';
        let region = plain(sailNo++);
        if (mark === CANVAS_REGION.cross && k === 0 && (main || ms.s.role === 'fore')) region = mark;
        if (mark === CANVAS_REGION.skull && main && (k === 1 || ms.yards.length === 1)) region = mark;
        squareSail(cv, ms.M, y.x + y.r * 0.9, yHead, y.half * 0.96, yFoot, hFoot, region, k === 0);
      });
    }

    // ---- fore-and-aft canvas: the spanker on a ship's mizzen or a brig's main; gaff
    //      sails on a schooner or sloop; a lateen on a launch
    const aftRoom = aft ? ms.x - aft.x - 1.5 : ms.x - f.x(0) + (fa ? L * 0.08 : L * 0.06);
    const spanker = !fa && (ms.s.role === 'mizzen' || (masts.length === 2 && i === 0));
    if (R.rig === 'lateen') {
      const lo: V3 = [ms.x + L * 0.3, ms.y0 + 1.1, 0], hi: V3 = [ms.x - L * 0.28, ms.y0 + H * 1.02, 0];
      m.paint(d.rail, FIN.wood).cyl(lo, hi, r * 0.45, r * 0.3, 6, true);
      foreAft(cv, hi, hi, [ms.x - L * 0.16, ms.y0 + 0.9, 0], [lo[0] - 0.4, lo[1] + 0.1, 0], L * 0.07, plain(sailNo++), true);
      rp.line(lo, [f.x(0.9), f.rail(0.9), 0], rr, HEMP, 0.1);
    } else if (spanker || fa) {
      const gl = Math.min(aftRoom * (fa ? 0.8 : 0.9), H * 0.42);
      const bl = aft ? aftRoom * 0.9 : aftRoom;
      const throat = fa ? H * 0.6 : h1 - 0.1 * H;
      const boomY = Math.max(railY - ms.y0 + 1.1, 1.6);
      const gAng = fa ? 0.5 : 0.36;
      const tl = (p: V3) => lp(ms, p);
      const T = tl([-r, throat, 0]), P = tl([-r - gl * Math.cos(gAng), throat + gl * Math.sin(gAng), 0]);
      const Bm = tl([-r, boomY, 0]);
      const C: V3 = [ms.x - bl, Bm[1] + (fa ? 0.25 : 0.15), 0];
      m.paint(d.rail, FIN.wood);
      m.cyl(T, P, r * 0.42, r * 0.3, 7, true);
      m.cyl(Bm, [C[0] - 0.4, C[1] - 0.1, 0], r * 0.48, r * 0.36, 7, true);
      const region = mark != null && (ms.s.role === 'main' || ms.s.role === 'single') && fa ? mark : plain(sailNo++);
      foreAft(cv, [T[0] - 0.15, T[1] - 0.2, 0], [P[0] + 0.1, P[1] - 0.12, 0], [C[0] + 0.3, C[1] + 0.1, 0], [Bm[0] - 0.15, Bm[1] + 0.15, 0], Math.max(0.6, gl * 0.13), region);
      // peak and throat halyards, topping lift, sheet
      const head = tl([0, fa ? h1 : h1 + 0.06 * H, 0]);
      rp.line(head, P, rr, HEMP);
      rp.line(head, mix(T, P, 0.5), rr, HEMP);
      rp.line(tl([xt, fa ? H * 0.9 : h2, 0]), [C[0], C[1], 0], rr, HEMP);
      rp.line([C[0] + 0.3, C[1], 0], [Math.max(f.x(0.02), C[0] + 1.2), f.rail(0.03) + 0.1, 0], rr, HEMP);
      // a gaff topsail over the mainsail of a fore-and-after
      if (fa && !ms.square) {
        const top = tl([xt, H * 0.97, 0]);
        foreAft(cv, top, top, [P[0] + 0.3, P[1] + 0.1, 0], [T[0] + 0.1, T[1] + 0.35, 0], Math.max(0.4, gl * 0.08), plain(sailNo++));
      }
    }

    // ---- headsails, from the foremost mast to the bowsprit
    if (!fwd && sprit) {
      const stays: [V3, V3][] = [];
      const head1 = lp(ms, [0, h1 + 0.02 * H, 0]), head2 = lp(ms, [xt, ms.tall3 ? h2 : H * 0.9, 0]), head3 = lp(ms, [ms.tall3 ? xg : xt, H * 0.93, 0]);
      stays.push([head1, sprit.mid]);
      stays.push([head2, sprit.cap]);
      if (ms.tall3 || fa) stays.push([head3, sprit.end]);
      stays.forEach(([top, bottom], k) => {
        rp.line(top, bottom, rs * (k === 0 ? 1.2 : 0.9), TAR);
        if (k === 0 && !fa) return;                      // the forestay carries no sail on a ship
        const tack = mix(bottom, top, 0.05), head = mix(bottom, top, fa ? 0.86 : k === 1 ? 0.7 : 0.6);
        const reach = dist(tack, head);
        const clew: V3 = [tack[0] - reach * 0.55, tack[1] + reach * 0.1, 0];
        const tc = clamp(f.tOf(clew[0]), 0, 1);
        clew[1] = Math.max(clew[1], f.rail(tc) + 1.4);
        foreAft(cv, head, head, clew, tack, reach * 0.07, plain(sailNo++), true);
        const ts = clamp(f.tOf(clew[0] - 2.5), 0, 1);
        rp.line(clew, [f.x(ts), f.rail(ts), f.hb(ts, f.rail(ts))], rr * 0.8, HEMP, 0.25);
      });
    }

    // ---- standing rigging: shrouds with ratlines, topmast shrouds, backstays, stays
    const chainY = railY - 0.28;
    const nS = clamp(Math.round(L / (fa ? 10 : 7) * ms.s.tall), 2, 7);
    const span = clamp(L * 0.075, 1.2, 5.5);
    const hbR = f.hb(t, railY);
    // the channel: a ledge on her side the shrouds are set up to, with a deadeye for each
    for (const side of [1, -1]) {
      const zc = side * (hbR + 0.28);
      m.paint(d.rail, FIN.wood).push(at(ms.x - span * 0.45, chainY, side * (hbR + 0.18))).box(span * 1.15, 0.12, 0.55).pop();
      const lowers: V3[] = [], uppers: V3[] = [];
      for (let k = 0; k < nS; k++) {
        const x = ms.x - span + (span * 1.1 * k) / Math.max(1, nS - 1);
        const low: V3 = [x, chainY + 0.28, zc];
        const up = lp(ms, [-r * 0.3 + (k - (nS - 1) / 2) * 0.05, h1 - (fa ? 0.3 : 0.15), side * r * 1.05]);
        m.paint(d.metal, FIN.dark).cyl([x, chainY + 0.1, zc], [x, chainY + 0.42, zc], 0.11 + L * 0.002, 0.11 + L * 0.002, 6, true);
        rp.line(low, up, rs, TAR);
        lowers.push(low); uppers.push(up);
      }
      // ratlines, rung by rung, first shroud to last
      const rung = (k: number, y: number): V3 => { const a = lowers[k], b = uppers[k]; return mix(a, b, (y - a[1]) / (b[1] - a[1])); };
      const yTop = Math.min(...uppers.map((u) => u[1])) - 0.6;
      for (let y = chainY + 0.9; y < yTop; y += LOD.lo ? 0.8 : 0.5) rp.line(rung(0, y), rung(nS - 1, y), rat, RATLINE, 0.03);

      if (!fa || ms.square) {
        // topmast shrouds from the rim of the top
        const lo2: V3[] = [], up2: V3[] = [];
        const n2 = clamp(nS - 2, 2, 4);
        for (let k = 0; k < n2; k++) {
          const low = lp(ms, [r * 0.35 - 0.4 * tw + (k * 0.7 * tw) / Math.max(1, n2 - 1), h1 + 0.1, side * tw * 0.96]);
          const up = lp(ms, [xt, h2 - 0.25, side * ms.rt * 1.05]);
          rp.line(low, up, rs * 0.85, TAR);
          lo2.push(low); up2.push(up);
        }
        const rung2 = (k: number, y: number): V3 => { const a = lo2[k], b = up2[k]; return mix(a, b, (y - a[1]) / (b[1] - a[1])); };
        for (let y = lo2[0][1] + 0.5; y < up2[0][1] - 0.5; y += LOD.lo ? 0.8 : 0.5) rp.line(rung2(0, y), rung2(n2 - 1, y), rat * 0.9, RATLINE, 0.02);
        // futtock shrouds under the top
        for (let k = 0; k < n2; k++) rp.line(lo2[k], lp(ms, [0, h1 - 1.4, side * r]), rs * 0.7, TAR);
        if (ms.tall3) {
          for (const k of [-1, 1]) rp.line(lp(ms, [xt + k * ms.rt * 1.5, h2, side * tw * 0.45]), lp(ms, [xg, H * 0.9, side * ms.rg]), rs * 0.7, TAR);
        }
      }
      // backstays, from the topmast heads down to her side abaft the shrouds
      const bsT = clamp(f.tOf(ms.x - span - clamp(L * 0.05, 1, 3)), 0.02, 1);
      const bsX = f.x(bsT);
      const bsLow: V3 = [bsX, f.rail(bsT) - 0.2, side * (f.hb(bsT, f.rail(bsT)) + 0.25)];
      rp.line(lp(ms, [xt, fa ? H * 0.88 : h2 - 0.1, side * ms.rt]), bsLow, rs * 0.9, TAR);
      if (ms.tall3) rp.line(lp(ms, [xg, H * 0.92, side * ms.rg]), [bsLow[0] - 1, bsLow[1], bsLow[2]], rs * 0.8, TAR);
    }
    // stays, in the middle line, to the next mast forward
    if (fwd) {
      rp.line(lp(ms, [0, h1 + 0.02 * H, 0]), lp(fwd, [0, 1.6, 0]), rs * 1.2, TAR);
      rp.line(lp(ms, [xt, fa ? H * 0.9 : h2, 0]), lp(fwd, [0, fwd.h1 - 0.2, 0]), rs, TAR);
      if (ms.tall3 && fwd.tall3) rp.line(lp(ms, [xg, H * 0.93, 0]), lp(fwd, [fwd.xt, fwd.h2, 0]), rs * 0.8, TAR);
    } else if (!sprit) {
      rp.line(lp(ms, [0, h1, 0]), [f.stemX(f.rail(1)), f.rail(1) + 0.2, 0], rs, TAR);
    }

    // ---- running rigging on every yard: lifts, braces, footropes
    ms.yards.forEach((y, k) => {
      const above: V3 = k === 0 ? [0, h1 + 0.06 * H, 0] : k === 1 ? [xt, (ms.tall3 ? h2 : H) - 0.1, 0] : [xg, H * 0.98, 0];
      for (const side of [1, -1]) {
        const arm = lp(ms, [y.x, y.y, side * y.half * 0.97]);
        rp.line(arm, lp(ms, above), rr, HEMP);
        const brace: V3 = aft ? lp(aft, [0, Math.min(aft.H * 0.7, y.y * 0.72), side * aft.r])
          : [f.x(0.05), f.rail(0.05) + 0.2, side * (f.hb(0.05, f.rail(0.05)) - 0.1)];
        rp.line(arm, brace, rr * 0.8, HEMP, 0.25);
        rp.line(lp(ms, [y.x - y.r, y.y - y.r * 1.5, side * y.r * 2]), lp(ms, [y.x - y.r, y.y - y.r * 1.5, side * y.half * 0.94]), rr * 0.7, HEMP, Math.max(0.35, y.half * 0.07));
      }
      rp.line(lp(ms, [y.x, y.y + y.r, 0]), lp(ms, above), rr * 0.9, HEMP);
    });
    // a course's sheets, down to her side abaft the mast
    if (ms.yards.length && R.rig === 'square' && ms.s.role !== 'mizzen') {
      const cf = Math.max(railY + 1.1, ms.y0 + 2.0);
      const y = ms.yards[0];
      for (const side of [1, -1]) {
        const clew = lp(ms, [y.x + 0.3, cf - ms.y0, side * y.half * 1.0]);
        const tt = clamp(t - 0.1, 0.02, 1);
        rp.line(clew, [f.x(tt), f.rail(tt) + 0.1, side * (f.hb(tt, f.rail(tt)) - 0.1)], rr, HEMP, 0.3);
      }
    }
  });

  // Hands aloft: a lookout in the main top, and men out on the main yard.
  const cr = crewRng(R), dressFor = outfitter(R);
  const mm = masts.find((ms) => ms.s.role === 'main' || ms.s.role === 'single');
  if (mm && R.rig === 'square' && !LOD.lo && mm.yards.length) {
    m.push(mm.M);
    sailor(m, mm.r * 0.35 - mm.tw * 0.3, mm.h1 + 0.08, mm.tw * 0.35, dressFor(cr), 0.2);
    const y = mm.yards[0];
    for (const side of [1, -1]) {
      const z = side * y.half * (0.35 + cr() * 0.3);
      sailor(m, y.x - y.r - 0.42, y.y - 1.5, z, dressFor(cr), 0, 0.42, 0.7);
    }
    m.pop();
  }

  // oars, for a launch
  if (R.oars) {
    m.paint('#6B5236', FIN.wood);
    for (const side of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const t = 0.28 + k * 0.14, y = f.rail(t), z = f.hb(t, y) * side;
        m.cyl([f.x(t), y, z * 0.7], [f.x(t) - 0.6, -0.1, z + side * 3.4], 0.06, 0.05, 5);
        m.push(at(f.x(t) - 0.62, -0.08, z + side * 3.3)).box(0.1, 0.05, 0.9).pop();
      }
    }
  }

  const trucks = masts.map((ms) => new THREE.Vector3(...lp(ms, [headX(ms, R.rig === 'lateen'), ms.H + 0.24, 0])));
  let main = 0;
  trucks.forEach((p, i) => { if (p.y > trucks[main].y) main = i; });
  return { trucks, main, height: trucks[main].y };
}

/** How far forward of her step a mast's head is: on the topgallant, the topmast, or a pole. */
const headX = (ms: Mast, pole: boolean) => (pole ? 0 : ms.tall3 ? ms.xg : ms.xt);
