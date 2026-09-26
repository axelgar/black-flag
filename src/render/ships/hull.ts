// The hull and everything fixed to it: planked sides painted in strakes that follow the
// sheer; decks, bulwarks, rails and castles; gun ports whose lids swing up and whose
// guns run out; the stern with its lit windows, galleries and lanterns; the stem, head,
// catheads and anchors; and the clutter a working deck has on it.
//
// Starboard is built and larboard is the same geometry through a mirror, so the two
// sides can never disagree.

import * as THREE from 'three';
import type { HullRecipe } from '../../data/types';
import { crewRng, outfitter, sailor } from './crew';
import { Form, type Step } from './form';
import { ANIM, FIN, LOD, MIRROR, Mesh, at, frame, type Finish, type V3 } from './mesh';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const WL = 0.1;                                // where the bottom paint stops

/** Her colours, resolved from the recipe with the defaults filled in. */
export interface Dress {
  hull: string; band: string; wale: string; bottom: string; deck: string; rail: string;
  trim: string; inside: string; gold: string; gilt: boolean; metal: string;
  spar: string;     // masts and bowsprit, bright timber; yards are tarred like her rail
}

export function dress(R: HullRecipe): Dress {
  const P = R.palette;
  return {
    hull: P.hull, band: P.wale, wale: P.rail, bottom: P.bottom, deck: P.deck, rail: P.rail,
    trim: P.trim, inside: P.inside ?? '#6E2A1E', gold: '#C9A13B',
    gilt: R.gilt ?? R.stern === 'galleon', metal: '#1E1C1A',
    spar: '#' + new THREE.Color(P.deck).lerp(new THREE.Color('#2E2116'), 0.5).getHexString(),
  };
}

export interface Gun { side: -1 | 1; muzzle: THREE.Vector3 }

export interface HullOut {
  guns: Gun[];
  /** The head of the ensign staff, where her colours fly astern. */
  ensign: THREE.Vector3 | null;
  lamps: THREE.Vector3[];
}

export interface Ports { decks: number[]; ps: number; n: number }

/** Port size, and the height of each gun deck's ports amidships, lowest first. */
export function portLayout(f: Form): Ports {
  const R = f.R;
  if (!R.gunDecks || !R.gunsPerSide) return { decks: [], ps: 0, n: 0 };
  const ps = clamp(R.length * 0.02, 0.4, 1.05);
  const top = Math.min(f.deck(0.5) + 0.24 + ps / 2, f.railMain(0.5) - 0.13 - ps / 2);
  const gap = Math.max(ps + 0.95, 1.9);
  const decks: number[] = [];
  for (let k = R.gunDecks - 1; k >= 0; k--) {
    const h = top - k * gap;
    if (h - ps / 2 > 0.8) decks.push(h);
  }
  return { decks, ps, n: R.gunsPerSide };
}

/* ------------------------------------------------------------ the skin ---- */

interface Row { y: (t: number) => number; off: number }
interface Span { color: string; fin: Finish; flat?: boolean }

/** Her strakes, keel to rail: tarred or coppered bottom, boot-topping, then topsides,
 *  wales standing proud, the band her ports are cut in, and a line of colour under the
 *  rail. Heights are amidships; each row follows the sheer the way real planking does. */
function strakes(f: Form, d: Dress, P: Ports) {
  const rows: Row[] = [], spans: Span[] = [];
  const clampY = (t: number, y: number) => { const k = f.keel(t); return clamp(y, k, Math.max(k, f.railMain(t))); };
  const line = (h: number) => (t: number) => clampY(t, f.band(t, h));
  const NB = 6;
  for (let i = 0; i <= NB; i++) {
    const e = 0.5 - 0.5 * Math.cos((Math.PI * i) / NB);
    rows.push({ y: (t) => { const k = f.keel(t); return k >= WL ? k : k + (WL - k) * e; }, off: 0 });
    if (i) spans.push({ color: d.bottom, fin: FIN.bottom });
  }
  let h = WL;
  const layer = (top: number, color: string, fin: Finish, raised = 0) => {
    top = Math.min(top, f.F);
    if (top <= h + 0.01) return;
    if (raised) {
      rows.push({ y: line(h), off: raised }); spans.push({ color, fin, flat: true });
      rows.push({ y: line(top), off: raised }); spans.push({ color, fin });
      rows.push({ y: line(top), off: 0 }); spans.push({ color, fin, flat: true });
    } else {
      const n = Math.max(1, Math.ceil((top - h) / 0.45));
      for (let i = 1; i <= n; i++) { rows.push({ y: line(h + ((top - h) * i) / n), off: 0 }); spans.push({ color, fin }); }
    }
    h = top;
  };
  const wh = 0.2 + f.L * 0.004;
  layer(WL + 0.12, d.wale, FIN.paint);                             // boot-topping
  const bands = P.decks.length
    ? P.decks.map((g) => [g - P.ps / 2 - 0.12, g + P.ps / 2 + 0.13])
    : [[f.F * 0.52, f.F * 0.52 + Math.max(0.28, f.F * 0.12)]];
  for (const [lo, hi] of bands) {
    layer(lo - wh, d.hull, FIN.planks);
    layer(lo, d.wale, FIN.planks, 0.05 + f.L * 0.0008);             // the wale, standing proud
    layer(hi, d.band, FIN.planks);
  }
  layer(f.F - 0.26, d.hull, FIN.planks);
  layer(f.F - 0.13, d.trim, FIN.paint);
  layer(f.F, d.hull, FIN.planks);
  // Above the sheer: the sides of her castles, where she has them.
  const top = (t: number) => f.railMain(t) + Math.max(0, f.rail(t) - f.railMain(t) - 0.14);
  rows.push({ y: (t) => (f.railMain(t) + top(t)) / 2, off: 0 }); spans.push({ color: d.hull, fin: FIN.planks });
  rows.push({ y: top, off: 0 }); spans.push({ color: d.hull, fin: FIN.planks });
  rows.push({ y: (t) => f.rail(t), off: 0 }); spans.push({ color: d.trim, fin: FIN.paint });
  return { rows, spans, wl: NB };
}

function skin(m: Mesh, f: Form, ts: number[], rows: Row[], spans: Span[], wl: number) {
  const P: V3[][] = [], N: V3[][] = [], G: number[][] = [];
  for (const t of ts) {
    const pr: V3[] = [], nr: V3[] = [];
    for (const row of rows) {
      const y = row.y(t);
      const p = f.point(t, y), n = f.normal(t, y);
      pr.push(row.off ? [p[0] + n[0] * row.off, p[1] + n[1] * row.off, p[2] + n[2] * row.off] : p);
      nr.push(n);
    }
    // girth, measured round the section from the waterline: the planks follow it
    const g = new Array<number>(rows.length).fill(0);
    for (let j = wl + 1; j < rows.length; j++) g[j] = g[j - 1] + dist(pr[j], pr[j - 1]);
    for (let j = wl - 1; j >= 0; j--) g[j] = g[j + 1] - dist(pr[j], pr[j + 1]);
    P.push(pr); N.push(nr); G.push(g);
  }
  for (let i = 0; i < ts.length - 1; i++) {
    for (let j = 0; j < rows.length - 1; j++) {
      const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], e = P[i][j + 1];
      if (dist(a, e) < 1e-4 && dist(b, c) < 1e-4) continue;       // a strake that has run out
      if (dist(a, b) < 1e-4 && dist(e, c) < 1e-4) continue;
      const sp = spans[j];
      m.paint(sp.color, sp.fin);
      m.quad(a, b, c, e, sp.flat ? undefined : [N[i][j], N[i + 1][j], N[i + 1][j + 1], N[i][j + 1]],
        [[a[0], G[i][j]], [b[0], G[i + 1][j]], [c[0], G[i + 1][j + 1]], [e[0], G[i][j + 1]]]);
    }
  }
}

/** The flat of her stern, painted in the same strakes as her side so they wrap round. */
function transom(m: Mesh, f: Form, rows: Row[], spans: Span[]) {
  const COLS = 3;
  for (let j = 0; j < rows.length - 1; j++) {
    const y0 = rows[j].y(0), y1 = rows[j + 1].y(0);
    if (y1 - y0 < 1e-4) continue;
    const w0 = f.hb(0, y0), w1 = f.hb(0, y1);
    if (w0 < 0.01 && w1 < 0.01) continue;
    const x0 = f.xAt(0, y0), x1 = f.xAt(0, y1);
    m.paint(spans[j].color, spans[j].fin);
    for (let c = 0; c < COLS; c++) {
      const za = (w0 * c) / COLS, zb = (w0 * (c + 1)) / COLS, zc = (w1 * (c + 1)) / COLS, zd = (w1 * c) / COLS;
      m.quad([x0, y0, za], [x0, y0, zb], [x1, y1, zc], [x1, y1, zd], undefined, [[za, y0], [zb, y0], [zc, y1], [zd, y1]]);
    }
  }
}

/* ------------------------------------------------------ decks and rails --- */

function within(ts: number[], a: number, b: number): number[] {
  const out = [a];
  for (const t of ts) if (t > a + 1e-4 && t < b - 1e-4) out.push(t);
  out.push(b);
  return out;
}

/** The decks she has, as t ranges and heights above the main deck. */
function regions(f: Form) {
  const out: { a: number; b: number; lift: number }[] = [];
  out.push({ a: f.qd ? f.qd.to : 0, b: f.fc ? f.fc.from : 1, lift: 0 });
  if (f.qd) out.push({ a: f.poop ? f.poop.to : 0, b: f.qd.to, lift: f.qd.h });
  if (f.poop) out.push({ a: 0, b: f.poop.to, lift: f.qd!.h + f.poop.h });
  if (f.fc) out.push({ a: f.fc.from, b: 1, lift: f.fc.h });
  return out;
}

/** Starboard half of a deck, cambered, planked fore and aft. */
function deck(m: Mesh, f: Form, d: Dress, st: number[], lift: number) {
  const COLS = 4, camber = f.B * 0.012;
  m.paint(d.deck, FIN.deck);
  const pts = st.map((t) => {
    const y = f.deck(t) + lift;
    const w = Math.max(0, f.hb(t, y) - f.thick);
    const x = f.xAt(t, y);
    return Array.from({ length: COLS + 1 }, (_, c): V3 => [x, y + camber * (1 - (c / COLS) ** 2), (w * c) / COLS]);
  });
  for (let i = 0; i < st.length - 1; i++) {
    for (let c = 0; c < COLS; c++) {
      const p = pts[i][c], q = pts[i + 1][c], r = pts[i + 1][c + 1], s = pts[i][c + 1];
      if (p[2] === s[2] && q[2] === r[2]) continue;
      m.quad(p, s, r, q, [0, 1, 0], [[p[0], p[2]], [s[0], s[2]], [r[0], r[2]], [q[0], q[2]]]);
    }
  }
}

/** The inboard face of her bulwark, from a deck up to the rail. */
function bulwark(m: Mesh, f: Form, d: Dress, st: number[], lift: number) {
  m.paint(d.inside, FIN.paint);
  const ROWS = 2;
  const pts = st.map((t) => {
    const y0 = f.deck(t) + lift, y1 = Math.max(y0, f.rail(t));
    return Array.from({ length: ROWS + 1 }, (_, k): V3 => {
      const y = y0 + ((y1 - y0) * k) / ROWS;
      return [f.xAt(t, y), y, Math.max(0, f.hb(t, y) - f.thick)];
    });
  });
  for (let i = 0; i < st.length - 1; i++) {
    for (let k = 0; k < ROWS; k++) {
      const p = pts[i][k], q = pts[i + 1][k], r = pts[i + 1][k + 1], s = pts[i][k + 1];
      if (s[1] - p[1] < 1e-3 && r[1] - q[1] < 1e-3) continue;
      if (p[2] < 1e-3 && q[2] < 1e-3) continue;
      m.quad(p, s, r, q, undefined, [[p[0], p[1]], [s[0], s[1]], [r[0], r[1]], [q[0], q[1]]]);
    }
  }
}

/** The cap along the top of her side, stepping up and down with the castles. */
function railCap(m: Mesh, f: Form, d: Dress, ts: number[]) {
  m.paint(d.rail, FIN.wood);
  const capH = 0.09 + f.L * 0.0015, out = 0.05;
  const P = ts.map((t) => {
    const y = f.rail(t), w = f.hb(t, y);
    return { x: f.xAt(t, y), y, zo: w + out, zi: Math.max(0, w - f.thick - out) };
  });
  for (let i = 0; i < P.length - 1; i++) {
    const A = P[i], B = P[i + 1];
    if (A.zo < 0.06 && B.zo < 0.06) continue;
    m.quad([A.x, A.y + capH, A.zi], [A.x, A.y + capH, A.zo], [B.x, B.y + capH, B.zo], [B.x, B.y + capH, B.zi], [0, 1, 0],
      [[A.x, A.zi], [A.x, A.zo], [B.x, B.zo], [B.x, B.zi]]);
    m.quad([A.x, A.y - 0.07, A.zo], [B.x, B.y - 0.07, B.zo], [B.x, B.y + capH, B.zo], [A.x, A.y + capH, A.zo], undefined,
      [[A.x, 0], [B.x, 0], [B.x, 0.2], [A.x, 0.2]]);
    m.quad([A.x, A.y - 0.04, A.zi], [A.x, A.y + capH, A.zi], [B.x, B.y + capH, B.zi], [B.x, B.y - 0.04, B.zi], undefined,
      [[A.x, 0], [A.x, 0.2], [B.x, 0.2], [B.x, 0]]);
  }
  return capH;
}

/** A row of turned balusters with a rail over them, from a to b. */
function balustrade(m: Mesh, a: V3, b: V3, h: number, post: string, rail: string, railFin: Finish = FIN.wood) {
  const len = dist(a, b);
  const n = Math.max(2, Math.round(len / (LOD.lo ? 0.7 : 0.32)));
  m.paint(post, FIN.paint);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k, z = a[2] + (b[2] - a[2]) * k;
    m.push(at(x, y, z)).lathe([[0.045, 0], [0.065, h * 0.35], [0.03, h * 0.75], [0.045, h]], 4, false).pop();
  }
  m.paint(rail, railFin).beam([a[0], a[1] + h + 0.04, a[2]], [b[0], b[1] + h + 0.04, b[2]], 0.13, 0.08);
}

/** A bulkhead across her at t, from y0 to y1, with a door and lights. Faces forward or aft. */
function breakWall(m: Mesh, f: Form, d: Dress, t: number, y0: number, y1: number, facing: 1 | -1) {
  const x = f.x(t) + facing * 0.02;
  const w0 = Math.max(0, f.hb(t, y0) - f.thick), w1 = Math.max(0, f.hb(t, y1) - f.thick);
  m.paint(d.inside, FIN.paint);
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    if (facing > 0) m.quad([x, y0, w0], [x, y0, 0], [x, y1, 0], [x, y1, w1], [1, 0, 0], [[w0, y0], [0, y0], [0, y1], [w1, y1]]);
    else m.quad([x, y0, 0], [x, y0, w0], [x, y1, w1], [x, y1, 0], [-1, 0, 0], [[0, y0], [w0, y0], [w1, y1], [0, y1]]);
    if (side < 0) m.pop();
  }
  const H = y1 - y0;
  if (H < 1) return;
  // a door on the centreline and a light either side of it
  const xo = x + facing * 0.03;
  const dh = Math.min(1.8, H * 0.82), dw = Math.min(0.9, w0 * 0.3);
  const pane = (za: number, zb: number, ya: number, yb: number, glow: boolean) => {
    m.paint(glow ? '#1A2226' : '#2A1A10', glow ? FIN.glass : FIN.dark);
    const cols = glow ? 2 : 1, rws = glow ? 2 : 1;
    if (facing > 0) m.quad([xo, ya, zb], [xo, ya, za], [xo, yb, za], [xo, yb, zb], [1, 0, 0], [[0, 0], [cols, 0], [cols, rws], [0, rws]]);
    else m.quad([xo, ya, za], [xo, ya, zb], [xo, yb, zb], [xo, yb, za], [-1, 0, 0], [[0, 0], [cols, 0], [cols, rws], [0, rws]]);
  };
  pane(-dw / 2, dw / 2, y0, y0 + dh, false);
  if (w0 > 1.4) for (const s of [1, -1]) pane(s * w0 * 0.55 - 0.3, s * w0 * 0.55 + 0.3, y0 + H * 0.45, y0 + H * 0.45 + Math.min(0.6, H * 0.35), true);
}

function decksAndRails(m: Mesh, f: Form, d: Dress, ts: number[]) {
  const R = regions(f);
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    for (const r of R) {
      const st = within(ts, r.a, r.b);
      deck(m, f, d, st, r.lift);
      bulwark(m, f, d, st, r.lift);
    }
    railCap(m, f, d, ts);
    if (side < 0) m.pop();
  }
  // the taffrail across her stern, and the inside of the stern bulwark
  const y0 = f.rail(0), w0 = f.hb(0, y0), capH = 0.09 + f.L * 0.0015;
  const x0 = f.xAt(0, y0);
  m.paint(d.rail, FIN.wood).beam([x0 + f.thick * 0.5, y0 + capH / 2, -w0 - 0.05], [x0 + f.thick * 0.5, y0 + capH / 2, w0 + 0.05], f.thick + 0.12, capH + 0.02);
  const fl = f.floor(0.001);
  const wf = Math.max(0, f.hb(0, fl) - f.thick), xi = f.xAt(0, fl) + f.thick;
  m.paint(d.inside, FIN.paint);
  const wt = Math.max(0, w0 - f.thick), xt = f.xAt(0, y0) + f.thick;
  m.quad([xi, fl, wf], [xi, fl, -wf], [xt, y0, -wt], [xt, y0, wt], [1, 0, 0]);

  // the breaks of her castles: bulkheads, and a balustrade along each edge
  const rail = d.gilt ? d.gold : d.rail, railFin = d.gilt ? FIN.gilt : FIN.wood;
  const edge = (t: number, y: number, facing: 1 | -1) => {
    const w = Math.max(0.3, f.hb(t, y) - f.thick - 0.05), x = f.x(t) + facing * 0.08;
    balustrade(m, [x, y, -w], [x, y, w], 0.78, d.inside, rail, railFin);
  };
  if (f.qd) {
    const t = f.qd.to, y = f.deck(t);
    breakWall(m, f, d, t, y, y + f.qd.h, 1);
    edge(t, y + f.qd.h, 1);
  }
  if (f.poop && f.qd) {
    const t = f.poop.to, y = f.deck(t) + f.qd.h;
    breakWall(m, f, d, t, y, y + f.poop.h, 1);
    edge(t, y + f.poop.h, 1);
  }
  if (f.fc) {
    const t = f.fc.from, y = f.deck(t);
    breakWall(m, f, d, t, y, y + f.fc.h, -1);
    edge(t, y + f.fc.h, -1);
  }
}

/* -------------------------------------------------------------- guns ------ */

/** Gun ports cut in her bands: a dark port with a glow in it, a frame, a lid hinged at
 *  the top with red paint on its inside, and the gun behind it that runs out. The lid
 *  and gun are marked for the vertex shader, which swings and slides them. */
function gunDecks(m: Mesh, f: Form, d: Dress, P: Ports, out: HullOut) {
  if (!P.decks.length) return;
  const ps = P.ps, sides = LOD.lo ? 5 : f.L > 40 ? 8 : 7;
  const top = P.decks.length - 1;
  const lidRed = '#7C2A1C';
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    P.decks.forEach((h, k) => {
      const n = P.n + (k < top ? 1 : 0);            // lower decks run the full length
      const t0 = k < top ? 0.13 : 0.17, t1 = k < top ? 0.86 : 0.83;
      for (let g = 0; g < n; g++) {
        let t = t0 + ((t1 - t0) * (g + 0.5)) / n;
        // keep the weather-deck ports clear of the castle breaks
        for (const c of [f.qd?.to, f.poop?.to, f.fc?.from]) if (c != null && Math.abs(t - c) < 0.02) t = c + (t < c ? -0.02 : 0.02);
        const y = f.band(t, h);
        const S = new THREE.Vector3(...f.point(t, y));
        const N = new THREE.Vector3(...f.normal(t, y));
        const T = new THREE.Vector3(...f.point(Math.min(1, t + 0.002), y)).sub(new THREE.Vector3(...f.point(Math.max(0, t - 0.002), y))).normalize();
        const Z = N.clone().addScaledVector(T, -N.dot(T)).normalize();
        const Y = new THREE.Vector3().crossVectors(Z, T).normalize();
        const F = new THREE.Matrix4().makeBasis(T, Y, Z).setPosition(S);

        m.push(F);
        // the port: dark, lit from inside when she is cleared for action
        m.paint('#140A07', FIN.dark).moving(ANIM.port, side);
        m.plate([[-ps / 2, -ps / 2], [ps / 2, -ps / 2], [ps / 2, ps / 2], [-ps / 2, ps / 2]], 0.02);
        m.moving();
        // its frame
        m.paint(d.wale, FIN.paint);
        const fb = 0.09;
        m.push(at(0, ps / 2 + fb / 2, 0.035)).box(ps + fb * 2, fb, 0.07).pop();
        m.push(at(0, -ps / 2 - fb / 2, 0.035)).box(ps + fb * 2, fb, 0.07).pop();
        m.push(at(ps / 2 + fb / 2, 0, 0.035)).box(fb, ps, 0.07).pop();
        m.push(at(-ps / 2 - fb / 2, 0, 0.035)).box(fb, ps, 0.07).pop();
        // the lid, hinged along its top edge
        const hinge = m.here([0, ps / 2 + 0.02, 0.05]);
        m.moving(ANIM.lid, side, hinge.y, hinge.z);
        m.paint(d.rail, FIN.paint).push(at(0, 0.01, 0.1)).box(ps + 0.04, ps + 0.04, 0.04).pop();
        m.paint(lidRed, FIN.paint).push(at(0, 0.01, 0.065)).box(ps - 0.02, ps - 0.02, 0.03).pop();
        m.moving();
        m.pop();

        // The gun, horizontal whatever the tumblehome does, run out through her port.
        const H = new THREE.Vector3(N.x, 0, N.z).normalize();
        const reach = ps * 0.6 + 0.35;
        const run = reach + 0.2;
        const breech = S.clone().addScaledVector(H, -1.05), muzzle = S.clone().addScaledVector(H, reach);
        const rb = ps * 0.17, rm = ps * 0.13;
        m.paint(d.metal, FIN.iron).moving(ANIM.gun, side, run);
        m.cyl(breech.toArray() as V3, muzzle.toArray() as V3, rb, rm, sides, LOD.lo);
        if (!LOD.lo) {
          const swell = S.clone().addScaledVector(H, reach - ps * 0.14);
          m.cyl(swell.toArray() as V3, muzzle.toArray() as V3, rm * 1.28, rm * 1.22, sides, true);
          m.paint('#050404', FIN.dark);
          m.cyl(muzzle.clone().addScaledVector(H, -0.02).toArray() as V3, muzzle.clone().addScaledVector(H, 0.005).toArray() as V3, rm * 0.62, rm * 0.62, sides, true);
        }
        // on the weather deck the carriage can be seen, and runs out with her gun
        if (k === top) {
          const fl = f.floor(t);
          const hc = clamp(y - fl - rb * 1.1, 0.25, 0.8);
          const c = S.clone().addScaledVector(H, -f.thick - ps * 0.62);
          m.paint(d.inside, FIN.paint);
          m.beam([c.x - H.x * ps * 0.6, fl + hc / 2, c.z - H.z * ps * 0.6], [c.x + H.x * ps * 0.6, fl + hc / 2, c.z + H.z * ps * 0.6], ps * 0.75, hc);
          m.paint(d.rail, FIN.wood);
          const ax = new THREE.Vector3(H.z, 0, -H.x).multiplyScalar(ps * 0.45);
          if (!LOD.lo) for (const e of [-0.4, 0.4]) {
            const wc = c.clone().addScaledVector(H, e * ps);
            m.cyl([wc.x - ax.x, fl + 0.14, wc.z - ax.z], [wc.x + ax.x, fl + 0.14, wc.z + ax.z], 0.14, 0.14, 8, true);
          }
        }
        m.moving();
        out.guns.push({ side, muzzle: new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z * side) });
      }
    });
    if (side < 0) m.pop();
  }
}

/** A pair of bow chasers on her foredeck, pointing over the head. */
function chasers(m: Mesh, f: Form, d: Dress) {
  const t = 0.93, fl = f.floor(t);
  const w = Math.max(0.3, f.hb(t, fl) - f.thick);
  const r = clamp(f.L * 0.005, 0.1, 0.2);
  for (const s of [1, -1]) {
    const z = s * w * 0.42, x = f.x(t);
    m.paint(d.inside, FIN.paint).push(at(x, fl + 0.22, z)).box(1.0, 0.44, 0.5).pop();
    m.paint(d.metal, FIN.iron).cyl([x - 0.5, fl + 0.55, z], [x + 1.6, fl + 0.62, z * 0.8], r * 1.3, r, 8, true);
  }
}

/* ------------------------------------------------------------- stern ------ */

interface Lights { y0: number; y1: number; gallery: boolean }

/** Her stern windows: the great cabin under the quarterdeck, the captain's under the
 *  poop, or on a flush-decked ship a row of lights just under her deck. */
function sternRows(f: Form): Lights[] {
  const d0 = f.deck(0);
  const rows: Lights[] = [];
  if (f.qd) rows.push({ y0: d0 + 0.32, y1: d0 + f.qd.h - 0.3, gallery: !!f.poop });
  if (f.poop && f.qd) rows.push({ y0: d0 + f.qd.h + 0.3, y1: d0 + f.qd.h + f.poop.h - 0.3, gallery: false });
  if (!f.qd) rows.push({ y0: d0 - 0.8, y1: d0 - 0.25, gallery: false });
  return rows.filter((r) => r.y1 - r.y0 > 0.3 && r.y0 > f.ywt + 0.25);
}

function stern(m: Mesh, f: Form, d: Dress, out: HullOut) {
  if (f.R.stern === 'pointed') return;
  const rows = sternRows(f);
  const gild = d.gilt ? d.gold : d.trim, gildFin = d.gilt ? FIN.gilt : FIN.paint;
  const X = (y: number, off = 0.035) => f.xAt(0, y) - off;
  const big = f.R.stern === 'galleon';

  for (const r of rows) {
    const ym = (r.y0 + r.y1) / 2;
    const w = f.hb(0, ym) - f.thick * 0.5;
    const n = Math.max(2, Math.floor((2 * w * 0.86) / 1.25));
    const span = w * 0.86, pitch = (2 * span) / n, ww = Math.min(0.95, pitch * 0.62);
    const panesY = Math.max(2, Math.round((r.y1 - r.y0) / 0.32));
    for (let i = 0; i < n; i++) {
      const zc = -span + pitch * (i + 0.5), z0 = zc - ww / 2, z1 = zc + ww / 2;
      m.paint('#141B1F', FIN.glass);
      m.quad([X(r.y0), r.y0, z0], [X(r.y0), r.y0, z1], [X(r.y1), r.y1, z1], [X(r.y1), r.y1, z0], undefined, [[0, 0], [3, 0], [3, panesY], [0, panesY]]);
      m.paint(gild, gildFin);
      m.beam([X(r.y0, 0.08), r.y0 - 0.05, z0 - 0.06], [X(r.y1, 0.08), r.y1 + 0.05, z0 - 0.06], 0.1, 0.1);
      m.beam([X(r.y0, 0.08), r.y0 - 0.05, z1 + 0.06], [X(r.y1, 0.08), r.y1 + 0.05, z1 + 0.06], 0.1, 0.1);
    }
    // moldings above and below the row, the full width of her stern
    const wl = f.hb(0, r.y0 - 0.1) - 0.05, wu = f.hb(0, r.y1 + 0.1) - 0.05;
    m.paint(gild, gildFin);
    m.beam([X(r.y0 - 0.12, 0.09), r.y0 - 0.12, -wl], [X(r.y0 - 0.12, 0.09), r.y0 - 0.12, wl], 0.14, 0.16);
    m.beam([X(r.y1 + 0.12, 0.09), r.y1 + 0.12, -wu], [X(r.y1 + 0.12, 0.09), r.y1 + 0.12, wu], 0.14, 0.16);

    if (r.gallery && big) {
      // the stern walk: a balcony with a balustrade, under a little roof
      const gd = 0.8 + f.L * 0.008, yf = r.y0 - 0.22, xg = X(yf, 0);
      m.paint(d.hull, FIN.planks).push(at(xg - gd / 2, yf, 0)).box(gd, 0.14, wl * 2 + 0.2).pop();
      balustrade(m, [xg - gd + 0.06, yf + 0.07, -wl], [xg - gd + 0.06, yf + 0.07, wl], 0.72, d.trim, gild, gildFin);
      for (const s of [1, -1]) balustrade(m, [xg - 0.05, yf + 0.07, s * wl], [xg - gd + 0.06, yf + 0.07, s * wl], 0.72, d.trim, gild, gildFin);
      m.paint(gild, gildFin);
      for (let i = 0; i <= 4; i++) {
        const z = -wl + (2 * wl * i) / 4;
        m.beam([xg, yf - 0.9, z], [xg - gd * 0.8, yf - 0.07, z], 0.12, 0.14);
      }
      const yr = r.y1 + 0.28, xr = X(yr, 0);
      m.paint(d.hull, FIN.planks).push(at(xr - gd / 2 + 0.05, yr, 0)).box(gd + 0.1, 0.12, wu * 2 + 0.3).pop();
      m.paint(gild, gildFin).push(at(xr - gd + 0.02, yr, 0)).box(0.1, 0.16, wu * 2 + 0.34).pop();
    }
  }

  // Quarter galleries: bay windows at her quarters, the mark of a great ship.
  if (big && rows.length) {
    const lo = rows[0].y0 - 0.45, hi = rows[rows.length - 1].y1 + 0.3;
    const len = Math.min(3.6, f.L * 0.06), tm = 0.012 + len / f.L / 2, xm = f.x(tm);
    const ym = (lo + hi) / 2, H = hi - lo, dep = 0.8;
    for (const side of [1, -1] as const) {
      if (side < 0) m.push(MIRROR);
      const z = f.hb(tm, ym);
      m.paint(d.hull, FIN.planks).push(at(xm, ym, z + dep / 2 - 0.25)).box(len, H, dep + 0.5).pop();
      m.paint(gild, gildFin);
      m.push(at(xm, hi + 0.06, z + dep / 2 - 0.2)).box(len + 0.16, 0.14, dep + 0.5).pop();
      m.push(at(xm, lo - 0.06, z + dep / 2 - 0.2)).box(len + 0.16, 0.14, dep + 0.5).pop();
      m.push(at(xm, hi + 0.12, z + dep * 0.45)).lathe([[len * 0.42, 0], [len * 0.3, 0.35], [len * 0.1, 0.75], [0.06, 1.05]], 6, true).pop();
      m.push(at(xm, lo - 0.12, z + dep * 0.45)).lathe([[0.05, -1.1], [len * 0.12, -0.8], [len * 0.3, -0.35], [len * 0.4, 0]], 6, true).pop();
      const zf = z + dep - 0.25 + 0.01;
      for (const r of rows) {
        m.paint('#141B1F', FIN.glass);
        const x0 = xm - len * 0.32, x1 = xm + len * 0.32;
        m.quad([x0, r.y0, zf], [x1, r.y0, zf], [x1, r.y1, zf], [x0, r.y1, zf], [0, 0, 1], [[0, 0], [3, 0], [3, 3], [0, 3]]);
        m.paint(gild, gildFin);
        m.push(at(xm, r.y0 - 0.06, zf + 0.03)).box(len * 0.72, 0.1, 0.08).pop();
        m.push(at(xm, r.y1 + 0.06, zf + 0.03)).box(len * 0.72, 0.1, 0.08).pop();
      }
      if (side < 0) m.pop();
    }
  }

  // The taffrail: a carved and gilded crest on a great ship.
  const y0 = f.rail(0) + 0.09 + f.L * 0.0015, x0 = f.xAt(0, y0);
  const w0 = f.hb(0, f.rail(0));
  if (big || (f.R.stern === 'castle' && f.L > 34)) {
    const W = w0 * 0.62, Hc = 0.6 + f.L * 0.022;
    const arch: [number, number][] = [];
    for (let k = 0; k <= 14; k++) { const a = (Math.PI * k) / 14; arch.push([Math.cos(a) * W, Math.sin(a) * Hc]); }
    m.push(frame([x0 + 0.1, y0, 0], [0, 0, 1], [0, 1, 0]));
    m.paint(gild, gildFin).push(at(0, -0.02, -0.02)).slab(arch.map(([a, b]) => [a * 1.07, b * 1.08 + 0.02]), 0.16).pop();
    m.paint(d.trim, FIN.paint).push(at(0, 0, 0.05)).slab(arch, 0.14).pop();
    const disc: [number, number][] = [];
    for (let k = 0; k < 12; k++) { const a = (Math.PI * 2 * k) / 12; disc.push([Math.cos(a) * Hc * 0.28, Hc * 0.45 + Math.sin(a) * Hc * 0.32]); }
    m.paint(gild, gildFin).push(at(0, 0, 0.13)).slab(disc, 0.08).pop();
    m.pop();
  }

  // Stern lanterns, and the ensign staff.
  if (f.L > 16) {
    const s = clamp(f.L * 0.024, 0.45, 1.25);
    const spots: V3[] = big ? [[x0 - 0.1, y0 + 0.62 + f.L * 0.022, 0], [x0 - 0.35, y0 + s * 0.75, -w0 * 0.82], [x0 - 0.35, y0 + s * 0.75, w0 * 0.82]]
      : [[x0 - 0.35, y0 + s * 0.75, 0]];
    for (const p of spots) {
      m.paint(d.metal, FIN.iron).beam([p[0] + 0.55, y0 - 0.02, p[2]], [p[0], p[1] - s * 0.6, p[2]], 0.08, 0.08);
      lantern(m, p, s, d);
      out.lamps.push(new THREE.Vector3(...p));
    }
    const foot: V3 = [x0 + 0.25, y0, big ? w0 * 0.45 : 0];
    const len = 2 + f.L * 0.1;
    const head: V3 = [foot[0] - len * 0.34, foot[1] + len * 0.94, foot[2]];
    m.paint(d.rail, FIN.wood).cyl(foot, head, 0.07 + f.L * 0.001, 0.045, 5);
    out.ensign = new THREE.Vector3(...head);
  }
}

export function lantern(m: Mesh, p: V3, s: number, d: Pick<Dress, 'gilt' | 'gold' | 'metal'>) {
  const metal = d.gilt ? d.gold : d.metal, fin = d.gilt ? FIN.gilt : FIN.iron;
  m.push(at(p[0], p[1], p[2]));
  m.paint(metal, fin).lathe([[0.03 * s, -0.62 * s], [0.14 * s, -0.55 * s], [0.2 * s, -0.42 * s], [0.3 * s, -0.34 * s]], 8, false);
  m.paint('#FFD9A0', FIN.lamp).lathe([[0.3 * s, -0.34 * s], [0.33 * s, 0], [0.36 * s, 0.24 * s]], 8, false);
  m.paint(metal, fin).lathe([[0.36 * s, 0.24 * s], [0.41 * s, 0.3 * s], [0.28 * s, 0.44 * s], [0.1 * s, 0.58 * s], [0.03 * s, 0.78 * s]], 8, true);
  m.pop();
}

/* -------------------------------------------------------------- head ------ */

function head(m: Mesh, f: Form, d: Dress) {
  const kw = 0.1 + f.L * 0.003, kd = 0.2 + f.L * 0.006;
  // keel and stem, following the forefoot round and up past the rail
  m.paint(d.bottom, FIN.bottom).beam([f.x(0.003), -f.D - kd / 2 + 0.06, 0], [f.x(f.foot) + 0.2, -f.D - kd / 2 + 0.06, 0], kw * 2, kd);
  const kp = (t: number): V3 => { const y = f.keel(t); return [f.xAt(t, y), y, 0]; };
  const N = 12;
  for (let i = 0; i < N; i++) {
    const A = kp(f.foot + ((1 - f.foot) * i) / N), B = kp(f.foot + ((1 - f.foot) * (i + 1)) / N);
    const tx = B[0] - A[0], ty = B[1] - A[1], l = Math.hypot(tx, ty) || 1;
    const nx = ty / l, ny = -tx / l, off = kd * 0.45;
    const mid = (A[1] + B[1]) / 2;
    m.paint(mid < WL ? d.bottom : d.hull, mid < WL ? FIN.bottom : FIN.planks);
    m.beam([A[0] + nx * off - tx * 0.04, A[1] + ny * off - ty * 0.04, 0], [B[0] + nx * off + tx * 0.04, B[1] + ny * off + ty * 0.04, 0], kw * 2, kd, [nx, ny, 0]);
  }
  const top = kp(1);
  m.paint(d.rail, FIN.wood).beam([top[0] - 0.1, top[1] - 0.2, 0], [top[0] + 0.12, top[1] + 0.45, 0], kw * 2, kd * 0.8, [1, 0, 0]);

  // rudder: broad at the heel, narrowing to a head that runs up under the counter, hung on
  // the sternpost with iron pintles
  const c = clamp(f.L * 0.036, 0.7, 2.3), rt = f.ywt + 0.3, x0 = f.x(0);
  m.paint(d.bottom, FIN.bottom).slab([[x0 - 0.04, -f.D], [x0 - 0.04, rt], [x0 - c * 0.35, rt], [x0 - c, f.ywt - 0.35], [x0 - c, -f.D + 0.12]], kw * 1.4);
  m.paint(d.metal, FIN.iron);
  for (const k of [0.15, 0.45, 0.75]) m.push(at(x0 - 0.18, -f.D + (f.ywt + f.D) * k, 0)).box(0.42, 0.09, kw * 1.6).pop();

  const gild = d.gilt ? d.gold : d.trim, gildFin = d.gilt ? FIN.gilt : FIN.paint;
  // The head: a knee carrying her figure, headrails, and a grating to stand on.
  if (f.R.forecastle || f.R.stern === 'galleon') {
    const yT = f.deck(1) - 0.15, xs = f.stemX(yT), kl = f.L * 0.075;
    const yL = Math.max(0.3, f.F * 0.3);
    m.paint(d.hull, FIN.planks);
    m.slab([[xs - 0.1, yT + 0.1], [f.stemX(yL), yL], [xs + kl * 0.82, yT - 0.6], [xs + kl, yT + 0.12]], kw * 1.8);
    // the figure: gilded, leaning out over the sea
    const s = clamp(f.L * 0.05, 1.1, 3.2);
    const a = 0.95;
    m.push(frame([xs + kl * 0.97, yT + 0.05, 0], [Math.sin(a), -Math.cos(a), 0], [Math.cos(a), Math.sin(a), 0]));
    m.paint(gild, gildFin);
    m.lathe([[0.05 * s, 0], [0.19 * s, 0.08 * s], [0.25 * s, 0.3 * s], [0.21 * s, 0.5 * s], [0.12 * s, 0.63 * s], [0.07 * s, 0.68 * s]], 7, false);
    m.push(at(0, 0.8 * s, 0)).lathe([[0.02 * s, -0.13 * s], [0.12 * s, -0.07 * s], [0.13 * s, 0.03 * s], [0.1 * s, 0.1 * s], [0.02 * s, 0.14 * s]], 7, true).pop();
    m.push(at(0, 0.93 * s, 0)).lathe([[0.08 * s, 0], [0.12 * s, 0.08 * s], [0.06 * s, 0.06 * s]], 6, false).pop();
    for (const k of [1, -1]) m.cyl([0, 0.56 * s, k * 0.17 * s], [0.28 * s, 0.34 * s, k * 0.2 * s], 0.055 * s, 0.045 * s, 5, true);
    m.pop();
    // headrails sweeping from her bows down to the figure
    m.paint(gild, gildFin);
    for (const side of [1, -1] as const) {
      if (side < 0) m.push(MIRROR);
      for (let k = 0; k < 2; k++) {
        const t = 0.955, ya = f.rail(t) - 0.35 - k * 0.45;
        const A = new THREE.Vector3(f.x(t), ya, f.hb(t, ya) + 0.05);
        const B = new THREE.Vector3(xs + kl * 0.9, yT + 0.2 - k * 0.3, 0.12);
        const C = new THREE.Vector3((A.x + B.x) / 2, Math.min(A.y, B.y) - 0.35, A.z * 0.7);
        let prev = A;
        for (let i = 1; i <= 6; i++) {
          const u = i / 6;
          const p = A.clone().multiplyScalar((1 - u) ** 2).addScaledVector(C, 2 * u * (1 - u)).addScaledVector(B, u * u);
          m.beam(prev.toArray() as V3, p.toArray() as V3, 0.12, 0.12);
          prev = p;
        }
      }
      if (side < 0) m.pop();
    }
    const wg = f.hb(0.97, yT) * 0.85;
    m.paint(d.deck, FIN.grating);
    m.tri([xs, yT - 0.02, -wg], [xs, yT - 0.02, wg], [xs + kl * 0.85, yT - 0.02, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 0], [0, 2 * wg], [kl * 2, wg]);
  }

  // catheads, anchors, hawse holes
  const la = clamp(f.L * 0.06, 1.1, 3.6);
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    const tc = 0.9, yc = f.rail(tc) - 0.08, zc = f.hb(tc, yc);
    const cs = 0.18 + f.L * 0.004;
    const tip: V3 = [f.x(tc) + 0.55, yc + 0.18, zc + 0.8 + f.L * 0.01];
    m.paint(d.rail, FIN.wood).beam([f.x(tc) - 0.5, yc, zc - 0.5], tip, cs, cs);
    if (f.L > 18) anchor(m, [tip[0] - 0.2, tip[1] - 0.15, tip[2] - 0.25], la, d);
    if (f.L > 20) {
      for (const t of [0.952, 0.968]) {
        const y = f.deck(t) - 0.25, p = new THREE.Vector3(...f.point(t, y)), n = new THREE.Vector3(...f.normal(t, y));
        m.paint('#0E0B09', FIN.dark).cyl(p.clone().addScaledVector(n, -0.1).toArray() as V3, p.clone().addScaledVector(n, 0.05).toArray() as V3, 0.12 + f.L * 0.002, 0.12 + f.L * 0.002, 8, true);
      }
    }
    if (side < 0) m.pop();
  }
}

function anchor(m: Mesh, top: V3, la: number, d: Dress) {
  const [x, y, z] = top, r = la * 0.045;
  m.paint(d.metal, FIN.iron);
  m.cyl([x, y, z], [x, y - la, z], r, r * 1.15, 6);
  const cy = y - la;
  for (const s of [1, -1]) {
    const tip: V3 = [x + s * la * 0.42, cy + la * 0.3, z];
    m.cyl([x, cy, z], tip, r * 1.1, r * 0.75, 6, true);
    m.beam([tip[0] - s * la * 0.14, tip[1] - la * 0.1, z], [tip[0] + s * la * 0.02, tip[1] + la * 0.03, z], la * 0.2, la * 0.04, [0, 0, 1]);
  }
  m.paint(d.rail, FIN.wood).beam([x, y - la * 0.1, z - la * 0.42], [x, y - la * 0.1, z + la * 0.42], r * 2.4, r * 2.4);
}

/* --------------------------------------------------------- furniture ----- */

/** Hatches, capstan, wheel, a boat on the booms, casks and a galley chimney. */
function furniture(m: Mesh, f: Form, d: Dress, steps: Step[]) {
  const L = f.L, B = f.B;
  const on = (t: number) => f.floor(t) + f.B * 0.012;           // on the crown of the deck
  const cr = crewRng(f.R), dressFor = outfitter(f.R);
  const clear = (t: number, pad = 0.035) => steps.every((s) => Math.abs(s.t - t) > pad);
  const main = steps.find((s) => s.role === 'main' || s.role === 'single')!;
  const fore = steps.find((s) => s.role === 'fore');
  const mizzen = steps.find((s) => s.role === 'mizzen');

  // hatches: a raised coaming with a grating
  const hatch = (t: number, len: number, wid: number) => {
    if (!clear(t, len / L / 2 + 0.02)) return;
    const y = on(t);
    m.paint(d.rail, FIN.wood).push(at(f.x(t), y + 0.16, 0)).box(len, 0.32, wid).pop();
    m.paint(d.deck, FIN.grating);
    m.quad([f.x(t) - len / 2 + 0.08, y + 0.33, -wid / 2 + 0.08], [f.x(t) - len / 2 + 0.08, y + 0.33, wid / 2 - 0.08],
      [f.x(t) + len / 2 - 0.08, y + 0.33, wid / 2 - 0.08], [f.x(t) + len / 2 - 0.08, y + 0.33, -wid / 2 + 0.08], [0, 1, 0],
      [[0, 0], [wid * 3, 0], [wid * 3, len * 3], [0, len * 3]]);
  };
  const waist = (t: number) => (!f.qd || t > f.qd.to + 0.02) && (!f.fc || t < f.fc.from - 0.02);

  const tHatch = fore ? (main.t + fore.t) / 2 : main.t + 0.13;
  if (L > 14) hatch(tHatch, L * 0.07, B * 0.24);
  const tAft = main.t - 0.09;
  if (L > 24 && waist(tAft)) hatch(tAft, L * 0.05, B * 0.2);

  // the capstan, with its bars shipped
  const tCap = mizzen ? (mizzen.t + main.t) / 2 + 0.03 : f.qd ? Math.max(f.qd.to + 0.04, main.t - 0.09) : main.t - 0.12;
  if (L > 18 && clear(tCap)) {
    const s = clamp(L * 0.032, 0.6, 1.4), y = on(tCap), x = f.x(tCap);
    m.paint(d.rail, FIN.wood).push(at(x, y, 0))
      .lathe([[0.5 * s, 0], [0.42 * s, 0.1 * s], [0.34 * s, 0.4 * s], [0.34 * s, 0.7 * s], [0.5 * s, 0.8 * s], [0.5 * s, 0.95 * s], [0.2 * s, 1.02 * s]], 10, true).pop();
    m.paint(d.deck, FIN.wood);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      m.beam([x - Math.cos(a) * 1.6 * s, y + 0.88 * s, -Math.sin(a) * 1.6 * s], [x + Math.cos(a) * 1.6 * s, y + 0.88 * s, Math.sin(a) * 1.6 * s], 0.07, 0.07);
    }
  }

  // the wheel, on the quarterdeck just aft of the mizzen or the main
  const aftMast = mizzen ?? main;
  const tWheel = f.qd ? clamp(aftMast.t - 0.06, 0.05, f.qd.to - 0.04) : Math.min(0.12, aftMast.t - 0.08);
  if (L > 16 && clear(tWheel, 0.025)) {
    const y = on(tWheel), x = f.x(tWheel);
    const rw = 0.55 + L * 0.006, hub = y + rw + 0.35;
    m.paint(d.rail, FIN.wood);
    for (const s of [1, -1]) m.beam([x + 0.12, y, s * 0.25], [x + 0.12, hub + 0.1, s * 0.25], 0.12, 0.12);
    m.paint(d.deck, FIN.wood);
    const SP = 10;
    for (let i = 0; i < SP; i++) {
      const a0 = (i / SP) * Math.PI * 2, a1 = ((i + 1) / SP) * Math.PI * 2;
      m.beam([x, hub + Math.sin(a0) * rw, Math.cos(a0) * rw], [x, hub + Math.sin(a1) * rw, Math.cos(a1) * rw], 0.09, 0.09, [1, 0, 0]);
      if (i % 2 === 0) m.beam([x, hub, 0], [x, hub + Math.sin(a0) * (rw + 0.18), Math.cos(a0) * (rw + 0.18)], 0.05, 0.05, [1, 0, 0]);
    }
    m.paint(d.gold, FIN.gilt).cyl([x - 0.12, hub, 0], [x + 0.14, hub, 0], 0.12, 0.12, 8, true);
    // the binnacle before it
    m.paint(d.rail, FIN.wood).push(at(x + 0.9, y + 0.5, 0)).box(0.5, 1.0, 0.55).pop();
    m.paint(d.gold, FIN.gilt).push(at(x + 0.9, y + 1.0, 0)).lathe([[0.2, 0], [0.18, 0.12], [0.08, 0.22], [0.02, 0.25]], 8, true).pop();
    // and a hand on it
    sailor(m, x - 0.5, y, 0, dressFor(cr, false), 0, 0.1, 0.9);
  }

  // A ship's boat on the booms over the main hatch.
  if (L > 25) {
    const t = tHatch, y = on(t) + 0.9;
    boat(m, f.x(t), y, L * 0.17, Math.max(1.3, B * 0.24), d);
    m.paint(d.rail, FIN.wood);
    for (const k of [-0.3, 0.3]) m.push(at(f.x(t) + k * L * 0.17, on(t) + 0.45, 0)).box(0.25, 0.9, B * 0.3).pop();
  }

  // casks lashed at the mast's foot, crates by the rail, the galley chimney forward
  const cask = (x: number, y: number, z: number, r: number) => {
    m.paint('#5A4028', FIN.wood).push(at(x, y, z))
      .lathe([[r * 0.82, 0], [r, r * 0.6], [r * 1.02, r * 1.1], [r, r * 1.6], [r * 0.82, r * 2.2]], 9, true).pop();
    m.paint(d.metal, FIN.iron);
    if (!LOD.lo) for (const k of [0.35, 1.85]) m.push(at(x, y + r * k, z)).lathe([[r * 0.97, 0], [r * 1.0, r * 0.1]], 9, false).pop();
  };
  if (L > 14) {
    const t = (fore ?? main).t + 0.035, y = on(t);
    if (clear(t, 0.02) && waist(t)) for (const [dz, k] of [[0.9, 0], [1.6, 1], [-1.2, 2]] as const) cask(f.x(t) + k * 0.25, y, dz * (B / 8), 0.3 + L * 0.004);
    const tc = main.t + 0.06;
    if (clear(tc, 0.03) && waist(tc)) {
      const w = Math.max(0.5, f.hb(tc, y) - f.thick - 0.7);
      m.paint('#6B5134', FIN.wood).push(at(f.x(tc), on(tc) + 0.3, w)).box(0.9, 0.6, 0.7).pop();
      m.push(at(f.x(tc) + 0.1, on(tc) + 0.8, w - 0.05, 0.3)).box(0.6, 0.4, 0.55).pop();
    }
  }
  if (L > 24 && fore) {
    const t = Math.min(0.97, fore.t + 0.07);
    m.paint(d.metal, FIN.iron).cyl([f.x(t), on(t), 0.4], [f.x(t), on(t) + 1.3, 0.4], 0.18, 0.16, 8, true);
  }

  // Her people: an officer on the quarterdeck, and hands about the deck, clear of the
  // masts, the capstan and the boat on the booms.
  const busy = [tCap, tWheel, ...(L > 25 ? [tHatch - 0.05, tHatch, tHatch + 0.05] : [])];
  if (f.qd) {
    const t = Math.max(0.06, f.qd.to - 0.05);
    if (clear(t, 0.025)) sailor(m, f.x(t), on(t), f.hb(t, on(t)) * 0.35, dressFor(cr, true), Math.PI * 0.1);
  }
  const n = Math.round((L / 3.2) * (LOD.lo ? 0.5 : 1));
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const t = 0.07 + cr() * 0.88;
    if (!clear(t, 0.03) || busy.some((b) => Math.abs(b - t) < 0.035)) continue;
    const fl = on(t);
    const w = Math.max(0, f.hb(t, fl) - f.thick - 0.6);
    if (w < 0.4) continue;
    const z = (cr() * 2 - 1) * w * 0.62;
    sailor(m, f.x(t), fl, z, dressFor(cr), cr() * Math.PI * 2, 0, cr() < 0.3 ? 0.9 : 0);
    i++;
  }
}

/** A little boat, right way up, planked and painted, with thwarts. */
export function boat(m: Mesh, x: number, y: number, len: number, beam: number, d: Pick<Dress, 'band' | 'deck'>) {
  const S = 9, K = 4, dep = beam * 0.42;
  const pt = (i: number, k: number, inset = 0): V3 => {
    const u = i / (S - 1), v = k / K;                         // u stern to bow, v keel to gunwale
    const hb = (beam / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)), 0.55) * Math.pow(v, 0.45);
    return [x + (u - 0.5) * len, y - dep + v * dep + Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.15, Math.max(0, hb - inset)];
  };
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    for (let i = 0; i < S - 1; i++) {
      for (let k = 0; k < K; k++) {
        m.paint(k === K - 1 ? d.band : '#D8CDB4', FIN.paint);
        m.quad(pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1));
        if (LOD.lo) continue;
        m.paint(d.deck, FIN.wood);
        m.quad(pt(i, k, 0.06), pt(i, k + 1, 0.06), pt(i + 1, k + 1, 0.06), pt(i + 1, k, 0.06));
      }
    }
    if (side < 0) m.pop();
  }
  m.paint(d.deck, FIN.wood);
  for (const u of [0.3, 0.5, 0.7]) m.push(at(x + (u - 0.5) * len, y - dep * 0.25, 0)).box(0.22, 0.06, beam * 0.85).pop();
}

/* ------------------------------------------------------------- whole ----- */

export function buildHull(m: Mesh, f: Form, d: Dress): HullOut {
  const out: HullOut = { guns: [], ensign: null, lamps: [] };
  const P = portLayout(f);
  const ts = f.stations(LOD.lo ? (f.L > 40 ? 32 : 26) : f.L > 40 ? 46 : 38);
  const { rows, spans, wl } = strakes(f, d, P);
  for (const side of [1, -1] as const) {
    if (side < 0) m.push(MIRROR);
    skin(m, f, ts, rows, spans, wl);
    transom(m, f, rows, spans);
    if (side < 0) m.pop();
  }
  decksAndRails(m, f, d, ts);
  gunDecks(m, f, d, P, out);
  if (f.R.chasers) chasers(m, f, d);
  stern(m, f, d, out);
  head(m, f, d);
  furniture(m, f, d, f.masts());
  return out;
}
