// Ships from recipes. A hull is lofted from sixteen stations, bow to stern, each one a
// cross-section with a round bilge and a little tumblehome; then decks, castles, gun
// ports, masts, yards, canvas, rigging and colours go on top. Every ship in the game —
// the Jackdaw, the Spanish line, the legendaries — is one of these with different numbers.
//
// Geometry is built once per recipe and shared; each ship on the water only owns her
// materials, so she can scorch, fill her sails and strike her colours on her own.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlagKind, HullRecipe } from '../../data/types';
import { Builder, type V3 } from './builder';
import { flagTexture } from './flags';
import type { ShipModel, ShipPose } from './ShipModel';

const STATIONS = 16;
const IRON = '#1A1714';
const PORT_DARK = '#0C0A08';

/* ------------------------------------------------------------- the lines -- */

interface Lines {
  L: number; F: number;
  x: (u: number) => number;
  half: (u: number) => number;   // half-beam at the rail
  rail: (u: number) => number;   // rail height
  keel: (u: number) => number;
  deck: (u: number) => number;
  wale: (u: number) => [number, number];
  width: (u: number, y: number) => number;   // half-width at a height
}

function lines(R: HullRecipe): Lines {
  const L = R.length, F = R.freeboard, B = R.beam / 2;
  const sternW = R.stern === 'pointed' ? 0.12 : R.stern === 'transom' ? 0.56 : 0.68;
  const half = (u: number) => {
    if (u < 0.42) { const t = u / 0.42; return B * (sternW + (1 - sternW) * Math.pow(Math.sin((t * Math.PI) / 2), 0.7)); }
    const t = (u - 0.42) / 0.58;
    return B * Math.pow(Math.max(0, 1 - t * t), 0.62);
  };
  const rail = (u: number) => F + R.sheer * (u > 0.45 ? Math.pow((u - 0.45) / 0.55, 2) : Math.pow((0.45 - u) / 0.45, 2) * 0.8);
  const keel = (u: number) => -R.draft * (u > 0.78 ? 1 - Math.pow((u - 0.78) / 0.22, 1.4) * 0.8 : u < 0.05 ? 0.8 + u * 4 : 1);
  const deck = (u: number) => rail(u) - Math.min(0.55, F * 0.28);
  const wale = (u: number): [number, number] => {
    const lift = rail(u) - F;
    return [F * 0.38 + lift * 0.6, F * 0.6 + lift * 0.6];
  };
  const width = (u: number, y: number) => {
    const k = keel(u), r = rail(u);
    const v = Math.min(1, Math.max(0, (y - k) / (r - k || 1)));
    // A round bilge low down, near-vertical sides, and the sides drawn in a touch at the rail.
    const shape = Math.pow(Math.sin((Math.min(v, 0.86) / 0.86) * (Math.PI / 2)), 0.5);
    const tumble = v > 0.86 ? 1 - (v - 0.86) * 0.45 : 1;
    return half(u) * shape * tumble;
  };
  return { L, F, x: (u) => (u - 0.5) * L, half, rail, keel, deck, wale, width };
}

/* ------------------------------------------------------------ the hull ---- */

function hull(b: Builder, R: HullRecipe, S: Lines) {
  const P = R.palette;
  const rows = (u: number) => {
    const k = S.keel(u), r = S.rail(u), [w0, w1] = S.wale(u);
    const ys = [k, k * 0.45, -0.08, Math.min(w0, r - 0.3), Math.min(w1, r - 0.2), Math.max(Math.min(w1, r - 0.2) + 0.05, r - 0.32), r];
    return ys;
  };
  const colours = [P.bottom, P.bottom, P.hull, P.wale, P.hull, P.rail];

  const pt = (i: number, j: number, side: 1 | -1): V3 => {
    const u = i / (STATIONS - 1);
    const y = rows(u)[j];
    return [S.x(u), y, side * S.width(u, y)];
  };

  for (const side of [1, -1] as const) {
    for (let i = 0; i < STATIONS - 1; i++) {
      for (let j = 0; j < 6; j++) {
        const a = pt(i, j, side), bb = pt(i + 1, j, side), c = pt(i + 1, j + 1, side), d = pt(i, j + 1, side);
        if (side === 1) b.quad(a, bb, c, d, colours[j]);
        else b.quad(a, d, c, bb, colours[j]);
      }
    }
  }
  // Transom: the flat of her stern.
  if (R.stern !== 'pointed') {
    for (let j = 0; j < 6; j++) {
      b.quad(pt(0, j, -1), pt(0, j, 1), pt(0, j + 1, 1), pt(0, j + 1, -1), j < 2 ? P.bottom : j === 5 ? P.rail : P.trim);
    }
  }
  // Deck, stern to stem.
  for (let i = 0; i < STATIONS - 1; i++) {
    const u0 = i / (STATIONS - 1), u1 = (i + 1) / (STATIONS - 1);
    const y0 = S.deck(u0), y1 = S.deck(u1);
    const w0 = S.width(u0, y0) * 0.99, w1 = S.width(u1, y1) * 0.99;
    b.quad([S.x(u0), y0, -w0], [S.x(u0), y0, w0], [S.x(u1), y1, w1], [S.x(u1), y1, -w1], P.deck);
  }
  // Planking seams and hatches, so the deck reads as a deck from the chase camera.
  const hatch = (u: number, lw: number) => {
    const y = S.deck(u) + 0.04;
    b.box(S.x(u), y, 0, R.length * lw, 0.12, S.width(u, y) * 0.55, P.rail);
  };
  if (R.length > 18) { hatch(0.42, 0.06); hatch(0.62, 0.05); }
}

/** A raised deck — quarterdeck, poop or forecastle — lofted to follow the hull. */
function upper(b: Builder, R: HullRecipe, S: Lines, u0: number, u1: number, h: number, inset: number, lights: Builder | null) {
  const P = R.palette;
  const n = 5;
  const at = (k: number) => u0 + (u1 - u0) * (k / (n - 1));
  const base = (u: number) => S.rail(u) - 0.1;
  const top = (u: number) => base(u) + h;
  const w = (u: number) => S.width(u, base(u)) * inset;
  for (let k = 0; k < n - 1; k++) {
    const ua = at(k), ub = at(k + 1);
    for (const side of [1, -1] as const) {
      const a: V3 = [S.x(ua), base(ua), side * w(ua)], bb: V3 = [S.x(ub), base(ub), side * w(ub)];
      const c: V3 = [S.x(ub), top(ub), side * w(ub)], d: V3 = [S.x(ua), top(ua), side * w(ua)];
      if (side === 1) b.quad(a, bb, c, d, P.hull); else b.quad(a, d, c, bb, P.hull);
      // a trim band along the top edge
      const e: V3 = [d[0], d[1] + 0.25, d[2]], f: V3 = [c[0], c[1] + 0.25, c[2]];
      if (side === 1) b.quad(d, c, f, e, P.trim); else b.quad(d, e, f, c, P.trim);
    }
    b.quad([S.x(ua), top(ua), -w(ua)], [S.x(ua), top(ua), w(ua)], [S.x(ub), top(ub), w(ub)], [S.x(ub), top(ub), -w(ub)], P.deck);
  }
  // the end walls
  for (const u of [u0, u1]) {
    const x = S.x(u), wu = w(u);
    b.quad([x, base(u), -wu], [x, base(u), wu], [x, top(u), wu], [x, top(u), -wu], P.hull);
  }
  // Stern gallery windows, lit — you can find a galleon at dusk by them.
  if (lights && u0 < 0.02) {
    const x = S.x(u0) - 0.05, wu = w(u0);
    const count = Math.max(2, Math.round(wu * 2 / 1.4));
    for (let i = 0; i < count; i++) {
      const z = -wu * 0.8 + (i / (count - 1)) * wu * 1.6;
      lights.box(x, base(u0) + h * 0.5, z, 0.12, Math.min(0.9, h * 0.4), 0.5, '#FFD28A');
    }
  }
}

function guns(b: Builder, R: HullRecipe, S: Lines, ports: { side: -1 | 1; p: THREE.Vector3 }[]) {
  if (!R.gunDecks || !R.gunsPerSide) return;
  const size = Math.min(0.9, Math.max(0.32, R.length * 0.019));
  for (let d = 0; d < R.gunDecks; d++) {
    for (let g = 0; g < R.gunsPerSide; g++) {
      const u = 0.2 + (g / Math.max(1, R.gunsPerSide - 1)) * 0.58;
      const [w0, w1] = S.wale(u);
      const y = d === 0 ? (w0 + w1) / 2 : d === 1 ? w0 - (w1 - w0) * 1.3 : w1 + (w1 - w0) * 1.2;
      if (y > S.rail(u) - size * 0.6 || y < 0.3) continue;
      const x = S.x(u);
      for (const side of [1, -1] as const) {
        const z = side * (S.width(u, y) + 0.02);
        b.box(x, y, z, size * 1.1, size, 0.08, PORT_DARK);
        b.box(x, y + size * 0.72, z + side * 0.12, size * 1.2, size * 0.45, 0.06, R.palette.trim);
        b.cyl([x, y, z - side * 0.2], [x, y, z + side * size * 1.1], size * 0.2, size * 0.16, 5, IRON);
        if (d === 0) ports.push({ side, p: new THREE.Vector3(x, y, z + side * size * 1.1) });
      }
    }
  }
}

/* ------------------------------------------------------------- the rig ---- */

interface Mast { u: number; x: number; base: number; top: number; h: number }

function masts(R: HullRecipe, S: Lines): Mast[] {
  const at = R.masts === 1 ? [R.rig === 'fore-aft' ? 0.6 : 0.55] : R.masts === 2 ? [0.36, 0.67] : [0.22, 0.5, 0.75];
  const tall = R.masts === 1 ? [1] : R.masts === 2 ? [1, 0.9] : [0.76, 1, 0.9];
  return at.map((u, i) => {
    const base = S.deck(u);
    const h = R.mastHeight * R.length * tall[i] * 0.85;
    return { u, x: S.x(u), base, top: base + h, h };
  });
}

/** A sail as a grid, with the billow baked in and a per-vertex weight the shader uses to
 *  let the wind out of her. Corners: a b top, d c bottom; bulge along `axis`. */
function sailPanel(a: V3, b: V3, c: V3, d: V3, axis: V3, depth: number, nx = 6, ny = 5): THREE.BufferGeometry {
  const pos: number[] = [], bil: number[] = [], ax: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const s = i / nx, t = j / ny;
      const top = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      const bot = [d[0] + (c[0] - d[0]) * s, d[1] + (c[1] - d[1]) * s, d[2] + (c[2] - d[2]) * s];
      const p = [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
      // Full in the belly, tight at the yard, loose at the foot.
      const w = Math.sin(s * Math.PI) * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92) * depth;
      pos.push(p[0] + axis[0] * w, p[1] + axis[1] * w, p[2] + axis[2] * w);
      bil.push(w);
      ax.push(axis[0], axis[1], axis[2]);
      uv.push(s, t);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBillow', new THREE.Float32BufferAttribute(bil, 1));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(ax, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function rig(b: Builder, R: HullRecipe, S: Lines, M: Mast[], sails: THREE.BufferGeometry[], lines: number[]) {
  const P = R.palette;
  const L = R.length;
  const r0 = Math.max(0.12, L * 0.011);
  const bowU = 1, bowX = S.x(bowU), bowY = S.rail(bowU);
  let sprit: V3 | null = null;
  if (R.bowsprit) {
    const len = L * 0.3;
    sprit = [bowX + Math.cos(0.32) * len, bowY + Math.sin(0.32) * len, 0];
    b.cyl([bowX - 1, bowY - 0.3, 0], sprit, r0 * 0.8, r0 * 0.4, 5, P.rail);
  }

  for (let m = 0; m < M.length; m++) {
    const { x, base, top, h } = M[m];
    b.cyl([x, base - 0.5, 0], [x, top, 0], r0 * (m === 1 || M.length === 1 ? 1 : 0.85), r0 * 0.4, 6, P.rail);

    if (R.rig === 'square') {
      const fr = R.tiers === 3 ? [0.3, 0.58, 0.84] : R.tiers === 2 ? [0.36, 0.72] : [0.5];
      const span = R.beam * 1.75 * (m === 1 || M.length < 3 ? 1 : 0.88);
      if (R.tiers >= 2) b.box(x, base + h * (fr[0] + fr[1]) / 2 - h * 0.1, 0, r0 * 5, 0.15, r0 * 6, P.rail);   // the top
      for (let k = 0; k < fr.length; k++) {
        const yY = base + h * fr[k];
        const hw = (span / 2) * (1 - k * 0.2);
        b.cyl([x, yY, -hw], [x, yY, hw], r0 * 0.45, r0 * 0.45, 5, P.rail);
        const below = k === 0 ? base + Math.max(1.4, R.freeboard * 0.55) : base + h * fr[k - 1] + 0.3;
        const bw = k === 0 ? hw * 1.02 : (span / 2) * (1 - (k - 1) * 0.2) * 0.96;
        sails.push(sailPanel([x + 0.25, yY - 0.2, -hw * 0.97], [x + 0.25, yY - 0.2, hw * 0.97], [x + 0.25, below, bw], [x + 0.25, below, -bw],
          [1, 0, 0], Math.min(hw * 0.4, (yY - below) * 0.35)));
        // sheets down to the rail
        lines.push(x, below, bw, x - 2, S.rail(M[m].u) + 0.2, S.width(M[m].u, S.rail(M[m].u)));
        lines.push(x, below, -bw, x - 2, S.rail(M[m].u) + 0.2, -S.width(M[m].u, S.rail(M[m].u)));
      }
    } else if (R.rig === 'fore-aft') {
      // Gaff mainsail aft of the mast, and a jib from the foremost mast to the bowsprit.
      const aft = Math.min(L * 0.46, x - S.x(0) + L * 0.06);
      const foot = base + 1.1, peak = base + h * 0.9, throat = base + h * 0.74;
      b.cyl([x, foot, 0], [x - aft, foot + 0.2, 0], r0 * 0.5, r0 * 0.4, 5, P.rail);    // boom
      b.cyl([x, throat, 0], [x - aft * 0.85, peak, 0], r0 * 0.4, r0 * 0.35, 5, P.rail); // gaff
      sails.push(sailPanel([x - 0.2, throat, 0], [x - aft * 0.85, peak, 0], [x - aft, foot + 0.3, 0], [x - 0.2, foot + 0.3, 0],
        [0, 0, 1], aft * 0.12, 6, 5));
      if (m === M.length - 1 && sprit) {
        const head: V3 = [x + 0.3, base + h * 0.86, 0];
        sails.push(sailPanel(head, head, [sprit[0] - 0.4, sprit[1] - 0.2, 0], [x + 1.2, base + 1.6, 0], [0, 0, 1], L * 0.05, 5, 5));
        lines.push(head[0], head[1], 0, sprit[0], sprit[1], 0);
      }
      // a topsail on the tallest
      if (R.masts === 1 || m === 1) {
        const tt = base + h * 0.98;
        sails.push(sailPanel([x - 0.2, tt, 0], [x - 0.2, tt, 0], [x - aft * 0.8, peak + 0.1, 0], [x - 0.2, throat + 0.5, 0], [0, 0, 1], aft * 0.06, 4, 4));
      }
    } else if (R.rig === 'lateen') {
      const lo: V3 = [x + L * 0.34, base + 1, 0], hi: V3 = [x - L * 0.3, base + h * 1.05, 0];
      b.cyl(lo, hi, r0 * 0.45, r0 * 0.3, 5, P.rail);
      const clew: V3 = [x - L * 0.18, base + 0.9, 0];
      sails.push(sailPanel(hi, hi, clew, lo, [0, 0, 1], L * 0.09, 5, 5));
    }

    // Shrouds: three a side from the masthead down to the rail.
    const hy = base + h * 0.62;
    for (const side of [1, -1]) {
      for (let k = -1; k <= 1; k++) {
        const u = M[m].u + k * 0.025;
        const ry = S.rail(u);
        lines.push(x, hy, 0, S.x(u), ry, side * S.width(u, ry) * 1.02);
      }
    }
    // Stays, forward to the next mast or the bowsprit.
    const next = M[m + 1];
    if (next) lines.push(x, top - h * 0.05, 0, next.x, next.base + next.h * 0.5, 0);
    else if (sprit) lines.push(x, top - h * 0.05, 0, sprit[0], sprit[1], 0);
  }

  if (R.oars) {
    for (const side of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const u = 0.3 + k * 0.13;
        const y = S.rail(u);
        const z = S.width(u, y) * side;
        b.cyl([S.x(u), y, z], [S.x(u) - 0.5, -0.1, z + side * 3.2], 0.07, 0.07, 4, '#6B5236');
      }
    }
  }
}

/* ------------------------------------------------------------- the kit ---- */

interface Kit {
  hull: THREE.BufferGeometry;
  sails: THREE.BufferGeometry | null;
  rigging: THREE.BufferGeometry;
  lights: THREE.BufferGeometry | null;
  glow: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];   // port, starboard
  ports: { side: -1 | 1; p: THREE.Vector3 }[];
  flagAt: THREE.Vector3;
  flagSize: number;
  height: number;
}

const kits = new Map<string, Kit>();

function kit(R: HullRecipe): Kit {
  const key = JSON.stringify(R);
  const hit = kits.get(key);
  if (hit) return hit;

  const S = lines(R);
  const b = new Builder();
  const lb = new Builder();
  hull(b, R, S);
  if (R.stern === 'castle' || R.stern === 'galleon') upper(b, R, S, 0, 0.26, R.freeboard * 0.42, 0.97, lb);
  if (R.stern === 'galleon') upper(b, R, S, 0, 0.14, R.freeboard * 0.36, 0.9, lb);
  if (R.forecastle) upper(b, R, S, 0.8, 0.93, R.freeboard * 0.28, 0.95, null);
  const ports: Kit['ports'] = [];
  guns(b, R, S, ports);
  const M = masts(R, S);
  const sails: THREE.BufferGeometry[] = [];
  const lineData: number[] = [];
  rig(b, R, S, M, sails, lineData);

  // A lantern on the taffrail.
  if (R.length > 18) {
    const y = S.rail(0) + (R.stern === 'galleon' ? R.freeboard * 0.8 : R.stern === 'castle' ? R.freeboard * 0.45 : 0) + 0.6;
    lb.box(S.x(0) + 0.3, y, 0, 0.35, 0.5, 0.35, '#FFD28A');
  }

  // Port glow: a warm square over each lower-deck port, shown when her ports are open.
  const glow = ([-1, 1] as const).map((side) => {
    const gb = new Builder();
    for (const p of ports) if (p.side === side) gb.box(p.p.x, p.p.y, p.p.z - side * 1.0, Math.max(0.4, R.length * 0.02), Math.max(0.35, R.length * 0.017), 0.1, '#FF9A3C');
    return gb.pos.length ? gb.geometry() : null;
  }) as Kit['glow'];

  const tallest = M.reduce((a, m) => (m.top > a.top ? m : a), M[0]);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(lineData, 3));

  const k: Kit = {
    hull: b.geometry(),
    sails: sails.length ? mergeGeometries(sails) : null,
    rigging: rg,
    lights: lb.pos.length ? lb.geometry() : null,
    glow,
    ports,
    flagAt: new THREE.Vector3(tallest.x, tallest.top + 0.2, 0),
    flagSize: Math.max(1.6, R.length * 0.1),
    height: tallest.top,
  };
  kits.set(key, k);
  return k;
}

/* ------------------------------------------------------------ materials --- */

const shared = {
  time: { value: 0 },
  rigging: null as THREE.LineBasicMaterial | null,
  lights: null as THREE.MeshBasicMaterial | null,
  glow: null as THREE.MeshBasicMaterial | null,
  flags: new Map<FlagKind, THREE.MeshStandardMaterial>(),
};

/** Every flag and every sail reads one clock. */
export const setShipTime = (t: number) => { shared.time.value = t; };

function sailMaterial(color: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const fill = { value: 1 }, phase = { value: Math.random() * 6 };
  m.userData.fill = fill;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFill = fill; sh.uniforms.uTime = shared.time; sh.uniforms.uPhase = phase;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBillow;\nattribute vec3 aAxis;\nuniform float uFill, uTime, uPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float luff = 1.0 - uFill;
        float flap = sin(uTime * 3.3 + position.y * 0.7 + position.x * 0.3 + uPhase) * (0.06 + luff * 0.5)
                   + sin(uTime * 8.1 + position.z * 1.3 + uPhase) * luff * 0.25;
        transformed -= aAxis * aBillow * (luff * 0.85 - flap);`);
  };
  m.customProgramCacheKey = () => 'sail';
  return m;
}

function flagMaterial(kind: FlagKind): THREE.MeshStandardMaterial {
  const hit = shared.flags.get(kind);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ map: flagTexture(kind), roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float d = -position.x;
        transformed.z += sin(d * 2.1 - uTime * 7.0) * d * 0.14;
        transformed.y -= d * d * 0.012;`);
  };
  m.customProgramCacheKey = () => 'flag';
  shared.flags.set(kind, m);
  return m;
}

/* ---------------------------------------------------------------- ship ---- */

export class ProceduralShip implements ShipModel {
  root = new THREE.Group();
  len: number; beam: number; height: number;
  private hullMat: THREE.MeshStandardMaterial;
  private sailMat: THREE.MeshStandardMaterial;
  private flag: THREE.Mesh;
  private flagKind: FlagKind;
  private glow: (THREE.Mesh | null)[] = [];
  private weak: THREE.Mesh[] = [];
  private kit: Kit;
  private meshes: THREE.Mesh[] = [];
  private whole = new THREE.Color(1, 1, 1);
  private burnt = new THREE.Color(0.32, 0.26, 0.22);

  constructor(R: HullRecipe, weakPoints?: { fwd: number; side: -1 | 1 }[]) {
    const K = this.kit = kit(R);
    this.len = R.length; this.beam = R.beam; this.height = K.height;
    this.flagKind = R.flag;
    this.root.rotation.order = 'YZX';

    this.hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
    const hullMesh = new THREE.Mesh(K.hull, this.hullMat);
    this.meshes.push(hullMesh);
    this.root.add(hullMesh);

    this.sailMat = sailMaterial(R.palette.sail);
    if (K.sails) { const s = new THREE.Mesh(K.sails, this.sailMat); this.meshes.push(s); this.root.add(s); }

    shared.rigging ??= new THREE.LineBasicMaterial({ color: '#1C1611', transparent: true, opacity: 0.55 });
    this.root.add(new THREE.LineSegments(K.rigging, shared.rigging));

    shared.lights ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFC878').multiplyScalar(2.2) });
    if (K.lights) this.root.add(new THREE.Mesh(K.lights, shared.lights));

    shared.glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF8A2A').multiplyScalar(3) });
    this.glow = K.glow.map((g) => {
      if (!g) return null;
      const m = new THREE.Mesh(g, shared.glow!);
      m.visible = false;
      this.root.add(m);
      return m;
    });

    const fs = K.flagSize;
    const fg = new THREE.PlaneGeometry(fs * 1.5, fs, 8, 3);
    fg.translate((fs * 1.5) / 2, 0, 0);
    fg.rotateY(Math.PI);
    this.flag = new THREE.Mesh(fg, flagMaterial(this.flagKind));
    this.flag.position.copy(K.flagAt).add(new THREE.Vector3(0, -fs * 0.5, 0));
    this.root.add(this.flag);

    if (weakPoints) {
      const S = lines(R);
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF5A36').multiplyScalar(2.5) });
      for (const p of weakPoints) {
        const u = p.fwd / R.length + 0.5;
        const y = (S.wale(u)[0] + S.wale(u)[1]) / 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 0.3), wm);
        m.position.set(p.fwd, y, p.side * (S.width(u, y) + 0.3));
        this.root.add(m);
        this.weak.push(m);
      }
    }
  }

  gunPorts(side: -1 | 1) {
    return this.kit.ports.filter((p) => p.side === side).map((p) => p.p);
  }

  pose(p: ShipPose) {
    this.root.position.set(p.x, p.heave, p.z);
    this.root.rotation.set(p.roll, -p.h, p.pitch);
    const f = this.sailMat.userData.fill as { value: number };
    f.value += (p.fill - f.value) * 0.08;
    const want: FlagKind = p.struck ? 'white' : this.flagKind;
    const fm = flagMaterial(want);
    if (this.flag.material !== fm) this.flag.material = fm;
    this.hullMat.color.copy(this.whole).lerp(this.burnt, Math.min(1, p.damage * 0.9));
  }

  portsOpen(side: -1 | 1, open: boolean) {
    const g = this.glow[side === -1 ? 0 : 1];
    if (g) g.visible = open;
  }

  weakPoints(alive: boolean[]) {
    this.weak.forEach((m, i) => { m.visible = alive[i] ?? false; });
  }

  setShadows(on: boolean) {
    for (const m of this.meshes) m.castShadow = on;
  }

  dispose() {
    // Geometry is shared through the kit cache; only this ship's own materials go.
    this.hullMat.dispose();
    this.sailMat.dispose();
    for (const m of this.weak) m.geometry.dispose();
    this.flag.geometry.dispose();
  }
}
