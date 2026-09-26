// Nassau, 1715: the pirates' republic. Plastered houses stepping up from the harbour under
// terracotta roofs; warehouses and a tavern on the quay; a church, and the governor's
// house the captains hold their councils in now; a camp of tents and shacks along the
// beach; a fort on the western head with its guns run out; a light on the eastern point;
// and the quays the prizes are brought in to. All of it is laid out on the island's own
// slope from the chart, lot by lot, so a new sea gives a new town.

import * as THREE from 'three';
import { rng, type Rng } from '../../core/rng';
import { coastAt, type Harbour, type Island } from '../../sim/map';
import { flagTexture } from '../ships/flags';
import { boat, lantern } from '../ships/hull';
import { buntingMaterial, lampGlow, timberMaterial } from '../ships/materials';
import { FIN, Mesh, at, type Finish } from '../ships/mesh';
import { bunting, textures } from '../ships/procedural';
import { Stock, type Nursery } from './flora';
import { shape, type Flat, type Path, type Shape } from './ground';
import { masonryTexture } from './paint';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/* ----------------------------------------------------------------- plan ---- */

export type LotKind = 'house' | 'shack' | 'warehouse' | 'tavern' | 'church' | 'governor';
export interface Lot { x: number; z: number; face: number; w: number; d: number; kind: LotKind }
interface Spot { x: number; z: number; y: number; face: number }

export interface Sites {
  flats: Flat[];
  paths: Path[];
  lots: Lot[];
  fort: Spot;
  light: Spot;
  square: Spot & { r: number };
  quays: { x: number; z: number; ux: number; uz: number; len: number; w: number }[];
  camps: Spot[];
  lamps: Spot[];
  /** Keep trees off buildings, streets and walls. */
  avoid(x: number, z: number): boolean;
}

/** Lay the town out on her south face, looking down the harbour. */
export function nassauSites(is: Island, harbour: Harbour): Sites {
  const pre = shape(is);                           // the lie of the land before anything is levelled
  const r = rng(`nassau:${is.seed}`);
  const S = Math.atan2(harbour.y - is.y, harbour.x - is.x);
  const land = (a: number, f: number) => { const c = coastAt(is, a) * f; return [is.x + Math.cos(a) * c, is.y + Math.sin(a) * c] as const; };
  // the town is laid out in metres in from the waterline, so its streets follow the bay
  const inland = (a: number, d: number) => { const c = Math.max(6, coastAt(is, a) - d); return [is.x + Math.cos(a) * c, is.y + Math.sin(a) * c] as const; };
  const spot = (a: number, f: number): Spot => { const [x, z] = land(a, f); return { x, z, y: pre.height(x, z), face: a }; };
  const spotIn = (a: number, d: number): Spot => { const [x, z] = inland(a, d); return { x, z, y: pre.height(x, z), face: a }; };
  const arcIn = (d: number, a0: number, a1: number): Path => {
    const p: Path = [];
    for (let a = a0; a <= a1 + 1e-6; a += 0.04) p.push([...inland(a, d)] as [number, number]);
    return p;
  };
  const rayIn = (a: number, d0: number, d1: number): Path => [[...inland(a, d0)] as [number, number], [...inland(a, d1)] as [number, number]];

  const fortA = S + Math.PI * 0.43, lightA = S - Math.PI * 0.33;
  const fort = spot(fortA, 0.58);
  fort.y = Math.max(4.5, fort.y + 0.4);
  const light = spot(lightA, 0.88);
  light.y = Math.max(2.4, light.y);
  const church = spotIn(S, 33);
  const governor = spotIn(S - 0.36, 20);
  const square = { ...spotIn(S + 0.36, 17.5), r: 5.5 };
  const streets = [S, S + 0.66];

  const lots: Lot[] = [
    { x: church.x, z: church.z, face: S, w: 7.5, d: 15, kind: 'church' },
    { x: governor.x, z: governor.z, face: S - 0.3, w: 13, d: 9, kind: 'governor' },
  ];
  // Two lots clash if their footprints, grown by a pace, overlap: separating axes, four of them.
  const corners = (l: { x: number; z: number; face: number; w: number; d: number }, pad: number) => {
    const fx = Math.cos(l.face), fz = Math.sin(l.face), xx = fz, xz = -fx;
    const hw = l.w / 2 + pad, hd = l.d / 2 + pad;
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [l.x + xx * hw * a + fx * hd * b, l.z + xz * hw * a + fz * hd * b]);
  };
  const clash = (a: Lot, b: Lot) => {
    const A = corners(a, 0.35), B = corners(b, 0.35);
    for (const P of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % 4];
        const nx = z1 - z0, nz = x0 - x1;
        const pa = A.map(([x, z]) => x * nx + z * nz), pb = B.map(([x, z]) => x * nx + z * nz);
        if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
      }
    }
    return true;
  };
  const clear = (l: Lot) => lots.every((o) => !clash(o, l)) && Math.hypot(square.x - l.x, square.z - l.z) > square.r + Math.min(l.w, l.d) * 0.5;
  // Terraced rows across her slope, packed close the way a colonial town is: the quay
  // front of warehouses and the tavern, then houses shoulder to shoulder up the hill.
  const rows = [
    { d: 7, span: 1.1, quay: true },
    { d: 13.5, span: 1.05, quay: false },
    { d: 20, span: 0.95, quay: false },
    { d: 26.5, span: 0.82, quay: false },
    { d: 33, span: 0.62, quay: false },
  ];
  let tavern = false;
  rows.forEach((row) => {
    let a = S - row.span;
    while (a < S + row.span) {
      const c = Math.max(6, coastAt(is, a) - row.d);
      if (c < 9) { a += 0.1; continue; }
      const nearQuay = row.quay && Math.abs(a - S) < 0.3;
      const kind: LotKind = nearQuay && r() < 0.55 ? 'warehouse' : row.quay && !tavern && a > S + 0.3 ? 'tavern' : r() < 0.16 ? 'shack' : 'house';
      if (kind === 'tavern') tavern = true;
      const w = kind === 'warehouse' ? 9 + r() * 3 : kind === 'shack' ? 3.6 + r() * 1.2 : kind === 'tavern' ? 8.5 : 4.4 + r() * 2.6;
      const d = kind === 'warehouse' ? 6.5 : kind === 'shack' ? 3.4 + r() * 0.8 : 4.4 + r() * 1.5;
      const ac = a + (w / 2) / c;
      if (ac > S + row.span) break;
      const [x, z] = inland(ac, row.d);
      const onStreet = streets.some((s) => Math.abs(ac - s) < (w / 2 + 1.6) / c);
      const lot: Lot = { x, z, face: ac + (r() - 0.5) * 0.05, w, d, kind };
      if (!onStreet && clear(lot)) lots.push(lot);
      a = ac + (w / 2 + 0.35 + r() * 1.1) / c;
    }
  });

  const flats: Flat[] = [
    { x: fort.x, z: fort.z, r: 17, y: fort.y },
    { x: light.x, z: light.z, r: 5.5, y: light.y },
    { x: square.x, z: square.z, r: square.r, y: square.y },
    ...lots.map((l) => ({ x: l.x, z: l.z, r: Math.max(l.w, l.d) * 0.55 + 0.4, y: pre.height(l.x, l.z), soft: 2.5 })),
  ];
  const paths: Path[] = [
    arcIn(3, S - 1.15, S + 1.15),
    arcIn(10.3, S - 1.08, S + 1.08),
    arcIn(16.8, S - 1.0, S + 1.0),
    arcIn(23.3, S - 0.88, S + 0.88),
    arcIn(29.8, S - 0.7, S + 0.7),
    rayIn(S, 1, 31), rayIn(S + 0.66, 1, 30),
    [[...land(S + 0.72, 0.84)] as [number, number], [...land((S + 0.72 + fortA) / 2, 0.7)] as [number, number], [fort.x, fort.z]],
    [[...land(S - 0.72, 0.85)] as [number, number], [...land((S - 0.72 + lightA) / 2, 0.84)] as [number, number], [light.x, light.z]],
  ];

  // Quays: a long pier into the harbour, and a jetty either side of it.
  const quays: Sites['quays'] = [];
  for (const [a, len, w] of [[S, 32, 5.5], [S - 0.2, 16, 3], [S + 0.2, 14, 3]] as const) {
    const [x, z] = land(a, 0.93);
    const dx = harbour.x - x, dz = harbour.y - z, dd = Math.hypot(dx, dz);
    const ux = a === S ? dx / dd : Math.cos(a), uz = a === S ? dz / dd : Math.sin(a);
    quays.push({ x, z, ux, uz, len: Math.min(len, dd * 0.7), w });
  }
  // the camp: tents on the sand beyond either end of the town
  const camps: Spot[] = [];
  for (let k = 0; k < 13; k++) {
    const side = k % 2 ? 1 : -1;
    const a = S + side * (0.78 + r() * 0.34);
    camps.push(spot(a, 0.86 + r() * 0.07));
  }
  // lanterns along the waterfront
  const lamps: Spot[] = [];
  for (let a = S - 0.9; a <= S + 0.9; a += 0.2) if (Math.abs(a - S) > 0.05) lamps.push(spotIn(a, 3.8));

  const near = (x: number, z: number, p: Path, d: number) => {
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < d) return true;
    }
    return false;
  };
  const avoid = (x: number, z: number) =>
    lots.some((l) => Math.hypot(l.x - x, l.z - z) < Math.max(l.w, l.d) * 0.62 + 2.5)
    || Math.hypot(fort.x - x, fort.z - z) < 24 || Math.hypot(light.x - x, light.z - z) < 8
    || Math.hypot(square.x - x, square.z - z) < square.r + 2
    || camps.some((c) => Math.hypot(c.x - x, c.z - z) < 4)
    || paths.some((p) => near(x, z, p, 3));
  return { flats, paths, lots, fort, light, square, quays, camps, lamps, avoid };
}

/* ------------------------------------------------------------- building ---- */

const WALLS = ['#EDE4D0', '#E8D6A8', '#E3B98F', '#C9D6CF', '#BFD0DD', '#E9C9A6', '#D8CDB8', '#F0E0B8', '#E7C2B4'];
const SHUTTERS = ['#2F5E4A', '#2A4A6A', '#7A2E24', '#5A4030', '#3E6E7A', '#6B7A3A'];
const ROOFS = ['#B5553A', '#A94E36', '#C0643F', '#9A4632', '#B86446'];
const TRIM = '#F2EDE2', STONE = '#A99C84', WOOD = '#5A4430', DARK = '#1A1410';
const pickOf = (r: Rng) => <T>(a: T[]) => a[Math.floor(r() * a.length)];

/** A frame at a lot: x along her front, y up, z out of her front door. */
function lotFrame(x: number, y: number, z: number, face: number) {
  const F = new THREE.Vector3(Math.cos(face), 0, Math.sin(face));
  const X = new THREE.Vector3().crossVectors(UP, F);
  return new THREE.Matrix4().makeBasis(X, UP, F).setPosition(x, y, z);
}

/** A window on the wall plane z, looking out along +z: glass, a sill, open shutters. */
function windowAt(m: Mesh, x: number, y: number, z: number, shut: string, lit: boolean, w = 0.8, h = 1.1) {
  m.paint(lit ? '#1A2226' : '#1E262A', lit ? FIN.glass : FIN.unlit);
  m.quad([x - w / 2, y, z + 0.03], [x + w / 2, y, z + 0.03], [x + w / 2, y + h, z + 0.03], [x - w / 2, y + h, z + 0.03], [0, 0, 1], [[0, 0], [2, 0], [2, 3], [0, 3]]);
  m.paint(TRIM, FIN.plaster).push(at(x, y - 0.07, z + 0.07)).box(w + 0.24, 0.13, 0.16).pop();
  m.push(at(x, y + h + 0.06, z + 0.05)).box(w + 0.16, 0.1, 0.1).pop();
  m.paint(shut, FIN.paint);
  for (const s of [-1, 1]) m.push(at(x + s * (w / 2 + 0.26), y + h / 2, z + 0.05)).box(0.44, h + 0.05, 0.05).pop();
}

function doorAt(m: Mesh, x: number, z: number, w = 1.1, h = 2.2, col = WOOD) {
  m.paint(col, FIN.wood);
  m.quad([x - w / 2, 0.05, z + 0.03], [x + w / 2, 0.05, z + 0.03], [x + w / 2, h, z + 0.03], [x - w / 2, h, z + 0.03], [0, 0, 1], [[0, 0], [w, 0], [w, h], [0, h]]);
  m.paint(TRIM, FIN.plaster).push(at(x, h + 0.08, z + 0.05)).box(w + 0.3, 0.16, 0.12).pop();
}

/** A roof over walls w by d and h high: hipped, or gabled with the ridge along x. */
function roof(m: Mesh, w: number, d: number, h: number, col: string, hip: boolean, wall: string, pitch = 0.55, fin: Finish = FIN.tile) {
  const oh = 0.4, tp = Math.tan(pitch), sp = Math.sin(pitch);
  const ze = d / 2 + oh, ye = h - oh * tp, top = h + (d / 2) * tp;
  const x0 = -w / 2 - oh, x1 = w / 2 + oh;
  const xr = hip ? Math.max(0, w / 2 + oh - ze) : x1;
  const v = (y: number) => (top - y) / sp;
  m.paint(col, fin);
  m.quad([x0, ye, ze], [x1, ye, ze], [xr, top, 0], [-xr, top, 0], undefined, [[x0, v(ye)], [x1, v(ye)], [xr, 0], [-xr, 0]]);
  m.quad([x1, ye, -ze], [x0, ye, -ze], [-xr, top, 0], [xr, top, 0], undefined, [[-x1, v(ye)], [-x0, v(ye)], [xr, 0], [-xr, 0]]);
  if (hip) {
    m.tri([x0, ye, -ze], [x0, ye, ze], [-xr, top, 0], undefined, undefined, undefined, [-ze, v(ye)], [ze, v(ye)], [0, 0]);
    m.tri([x1, ye, ze], [x1, ye, -ze], [xr, top, 0], undefined, undefined, undefined, [ze, v(ye)], [-ze, v(ye)], [0, 0]);
  } else {
    m.paint(wall, FIN.plaster);
    m.tri([w / 2, h, d / 2], [w / 2, h, -d / 2], [w / 2, top, 0]);
    m.tri([-w / 2, h, -d / 2], [-w / 2, h, d / 2], [-w / 2, top, 0]);
  }
  m.paint(new THREE.Color(col).multiplyScalar(0.8), fin).push(at(0, top + 0.06, 0)).box(xr * 2 + (hip ? 0.3 : 0.1), 0.16, 0.34).pop();
  return top;
}

function house(m: Mesh, lot: Lot, r: Rng, y: number) {
  const pick = pickOf(r);
  const { w, d } = lot;
  const two = lot.kind === 'tavern' || (w > 6.2 && r() < 0.45);
  const h = two ? 6.3 : 3.5 + r() * 0.4;
  const wall = pick(WALLS), shut = pick(SHUTTERS);
  m.push(lotFrame(lot.x, y, lot.z, lot.face));
  m.paint(STONE, FIN.stone).push(at(0, -0.8, 0)).box(w + 0.35, 1.7, d + 0.35).pop();
  m.paint(wall, FIN.plaster).push(at(0, h / 2, 0)).box(w, h, d).pop();
  m.paint(TRIM, FIN.plaster).push(at(0, h - 0.1, 0)).box(w + 0.18, 0.22, d + 0.18).pop();
  if (two) m.push(at(0, 3.15, 0)).box(w + 0.12, 0.16, d + 0.12).pop();
  const top = roof(m, w, d, h, pick(ROOFS), r() < 0.55, wall);
  // front: windows on each storey, the door on the ground
  const n = Math.max(2, Math.floor(w / 2.2));
  const door = Math.floor(r() * n);
  for (const fy of two ? [1.1, 4.2] : [1.1]) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / n;
      if (fy < 2 && i === door) doorAt(m, x, d / 2, lot.kind === 'tavern' ? 1.6 : 1.1);
      else windowAt(m, x, fy, d / 2, shut, r() < 0.55);
    }
  }
  // the sides
  for (const s of [1, -1]) {
    m.push(at(s * w / 2, 0, 0, s * Math.PI / 2));
    const k = Math.max(1, Math.floor(d / 3));
    for (const fy of two ? [1.1, 4.2] : [1.1]) for (let i = 0; i < k; i++) windowAt(m, -d / 2 + ((i + 0.5) * d) / k, fy, 0, shut, r() < 0.4);
    m.pop();
  }
  // a veranda on some, a chimney on others
  if (!two && r() < 0.4) {
    m.paint('#6E5640', FIN.deck).push(at(0, 0.12, d / 2 + 1.1)).box(w, 0.24, 2.2).pop();
    m.paint('#EDE7DA', FIN.paint);
    const posts = Math.max(3, Math.round(w / 2));
    for (let i = 0; i < posts; i++) m.push(at(-w / 2 + 0.2 + (i * (w - 0.4)) / (posts - 1), 1.35, d / 2 + 2.05)).box(0.14, 2.5, 0.14).pop();
    m.paint(pick(ROOFS), FIN.tile);
    m.quad([-w / 2 - 0.1, 2.6, d / 2 + 2.35], [w / 2 + 0.1, 2.6, d / 2 + 2.35], [w / 2 + 0.1, 3.1, d / 2], [-w / 2 - 0.1, 3.1, d / 2], undefined,
      [[-w / 2, 2.4], [w / 2, 2.4], [w / 2, 0], [-w / 2, 0]]);
  } else if (r() < 0.5) {
    m.paint(STONE, FIN.stone).push(at((r() - 0.5) * w * 0.6, top - 0.2, -d / 4)).box(0.62, 1.6, 0.62).pop();
  }
  if (lot.kind === 'tavern') {
    // the sign, and lanterns either side of the door
    m.paint(DARK, FIN.iron).push(at(w / 2 - 0.4, 3.3, d / 2 + 0.6)).box(0.08, 0.08, 1.2).pop();
    m.paint('#6A3A22', FIN.paint).push(at(w / 2 - 0.4, 2.8, d / 2 + 1.0)).box(0.06, 0.8, 1.0).pop();
    lantern(m, [-1.2, 2.6, d / 2 + 0.25], 0.5, { gilt: false, gold: '', metal: DARK });
    lantern(m, [1.2, 2.6, d / 2 + 0.25], 0.5, { gilt: false, gold: '', metal: DARK });
  }
  m.pop();
}

function shack(m: Mesh, lot: Lot, r: Rng, y: number) {
  const { w, d } = lot, h = 2.6;
  const wood = ['#8A7458', '#6E5A44', '#7E6A4E', '#94806A'][Math.floor(r() * 4)];
  m.push(lotFrame(lot.x, y, lot.z, lot.face));
  m.paint(wood, FIN.planks).push(at(0, h / 2 - 0.3, 0)).box(w, h + 0.6, d).pop();
  roof(m, w, d, h, r() < 0.6 ? '#B89B62' : '#6A5A46', false, wood, 0.75, r() < 0.6 ? FIN.thatch : FIN.planks);
  doorAt(m, -w / 4, d / 2, 0.9, 1.9, '#2A2018');
  windowAt(m, w / 4, 1.0, d / 2, '#5A4636', false, 0.6, 0.7);
  m.pop();
}

function warehouse(m: Mesh, lot: Lot, r: Rng, y: number) {
  const { w, d } = lot, h = 5.4;
  m.push(lotFrame(lot.x, y, lot.z, lot.face));
  m.paint(STONE, FIN.stone).push(at(0, -0.8, 0)).box(w + 0.3, 1.7, d + 0.3).pop();
  m.paint('#B9AC92', FIN.stone).push(at(0, h / 2, 0)).box(w, h, d).pop();
  roof(m, w, d, h, ROOFS[Math.floor(r() * ROOFS.length)], false, '#B9AC92', 0.5);
  doorAt(m, -w * 0.18, d / 2, 2.6, 3.6, '#4A3322');
  doorAt(m, w * 0.25, d / 2, 1.1, 2.3, '#4A3322');
  for (let i = 0; i < 3; i++) windowAt(m, -w / 2 + 1.4 + i * (w - 2.8) / 2, 4.1, d / 2, '#4A3322', false, 0.7, 0.6);
  // a hoist beam out of the loft
  m.paint(WOOD, FIN.wood).push(at(w * 0.25, h + 0.4, d / 2 + 0.6)).box(0.25, 0.25, 1.6).pop();
  m.pop();
}

function church(m: Mesh, lot: Lot, y: number) {
  const w = lot.w, d = lot.d, h = 7.5, white = '#F1ECE0';
  m.push(lotFrame(lot.x, y, lot.z, lot.face));
  m.paint(STONE, FIN.stone).push(at(0, -0.9, 0)).box(w + 0.5, 1.9, d + 0.5).pop();
  m.paint(white, FIN.plaster).push(at(0, h / 2, 0)).box(w, h, d).pop();
  // the roof runs back up the hill; the gable is her facade
  m.push(at(0, 0, 0, Math.PI / 2));
  roof(m, d, w, h, '#A94E36', false, white, 0.6);
  m.pop();
  doorAt(m, 0, d / 2, 1.8, 3.4, '#4A2E1C');
  m.paint('#1E262A', FIN.unlit).push(at(0, 5.7, d / 2 + 0.02)).lathe([[0.01, -0.02], [0.75, 0], [0.75, 0.04]], 12, false).pop();
  for (const s of [1, -1]) {
    m.push(at(s * w / 2, 0, 0, s * Math.PI / 2));
    for (let i = 0; i < 4; i++) windowAt(m, -d / 2 + 2 + i * (d - 4) / 3, 2.4, 0, TRIM, true, 0.9, 2.6);
    m.pop();
  }
  // the bell tower, at her front corner
  const tx = -w / 2 - 0.6, tz = d / 2 - 1.4, th = 14;
  m.paint(white, FIN.plaster).push(at(tx, th / 2 - 0.5, tz)).box(3.4, th, 3.4).pop();
  m.paint(TRIM, FIN.plaster).push(at(tx, th - 3.4, tz)).box(3.7, 0.3, 3.7).pop();
  m.push(at(tx, th - 0.5, tz)).box(3.7, 0.3, 3.7).pop();
  m.paint('#141414', FIN.dark);
  for (let k = 0; k < 4; k++) {
    m.push(at(tx, 0, tz, (k * Math.PI) / 2));
    m.quad([-0.7, th - 3.0, 1.72], [0.7, th - 3.0, 1.72], [0.7, th - 1.0, 1.72], [-0.7, th - 1.0, 1.72], [0, 0, 1]);
    m.pop();
  }
  m.paint('#C9A13B', FIN.gilt).push(at(tx, th - 2.4, tz)).lathe([[0.05, 0], [0.5, 0.05], [0.42, 0.6], [0.12, 0.9], [0.02, 0.95]], 8, true).pop();
  m.paint('#A94E36', FIN.tile).push(at(tx, th - 0.35, tz, Math.PI / 4)).lathe([[2.55, 0], [0.05, 3.2]], 4, false).pop();
  m.paint(DARK, FIN.iron);
  m.push(at(tx, th + 3.5, tz)).box(0.12, 1.4, 0.12).pop();
  m.push(at(tx, th + 3.7, tz)).box(0.7, 0.12, 0.12).pop();
  m.pop();
}

function governor(m: Mesh, lot: Lot, y: number, flags: THREE.Vector3[]) {
  const w = lot.w, d = lot.d, h = 7, wall = '#EFE6D2', shut = '#2A4A6A';
  m.push(lotFrame(lot.x, y, lot.z, lot.face));
  m.paint(STONE, FIN.stone).push(at(0, -0.8, 0)).box(w + 0.4, 1.7, d + 0.4).pop();
  m.paint(wall, FIN.plaster).push(at(0, h / 2, 0)).box(w, h, d).pop();
  m.paint(TRIM, FIN.plaster).push(at(0, h - 0.1, 0)).box(w + 0.2, 0.24, d + 0.2).pop();
  roof(m, w, d, h, '#9A4632', true, wall, 0.5);
  const n = 5;
  for (const fy of [1.1, 4.3]) for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n;
    if (fy < 2 && i === 2) doorAt(m, x, d / 2, 1.6, 2.6, '#3A2616'); else windowAt(m, x, fy, d / 2, shut, true);
  }
  // a gallery across her front, up and down
  const gz = d / 2 + 2.4;
  m.paint('#6E5640', FIN.deck).push(at(0, 0.14, d / 2 + 1.2)).box(w + 0.4, 0.28, 2.6).pop();
  m.push(at(0, 3.35, d / 2 + 1.2)).box(w + 0.4, 0.24, 2.6).pop();
  m.paint('#EDE7DA', FIN.paint);
  for (let i = 0; i < 7; i++) m.push(at(-w / 2 + (i * w) / 6, 3.4, gz)).box(0.18, 6.8, 0.18).pop();
  for (let i = 0; i <= 26; i++) m.push(at(-w / 2 + (i * w) / 26, 3.9, gz)).box(0.06, 0.8, 0.06).pop();
  m.push(at(0, 4.32, gz)).box(w, 0.1, 0.12).pop();
  m.paint('#9A4632', FIN.tile);
  m.quad([-w / 2 - 0.2, 6.6, gz + 0.3], [w / 2 + 0.2, 6.6, gz + 0.3], [w / 2 + 0.2, 7.1, d / 2], [-w / 2 - 0.2, 7.1, d / 2], undefined, [[-w / 2, 2.6], [w / 2, 2.6], [w / 2, 0], [-w / 2, 0]]);
  // the flagstaff in her yard, flying the black
  m.paint(WOOD, FIN.wood).cyl([w / 2 + 2, 0, gz + 1.5], [w / 2 + 2, 12, gz + 1.5], 0.12, 0.07, 6, true);
  flags.push(m.here([w / 2 + 2, 11.9, gz + 1.5]));
  m.pop();
}

/** A cannon on its carriage, muzzle along +z. */
function cannon(m: Mesh, x: number, y: number, z: number, face: number) {
  m.push(at(x, y, z, face));
  m.paint('#4A3A2A', FIN.wood).push(at(0, 0.3, -0.2)).box(0.8, 0.45, 1.5).pop();
  m.paint('#2A2420', FIN.wood);
  for (const s of [-0.55, 0.45]) m.cyl([-0.5, 0.26, s], [0.5, 0.26, s], 0.26, 0.26, 8, true);
  m.paint('#1E1C1A', FIN.iron).cyl([0, 0.72, -0.9], [0, 0.72, 1.3], 0.22, 0.16, 8, true);
  m.pop();
}

/** The fort: square curtains with a bastion at every corner, a parapet with embrasures on
 *  her seaward faces and guns in them, sentry boxes on the salients, barracks within. */
function fortress(m: Mesh, f: Spot, flags: THREE.Vector3[]) {
  const h = 10, g = 3.2, e = 3.4, p = 8, H = 5.2, T = 2.6;
  const stone = '#A89A82', top = '#B7A98F';
  // the trace, anticlockwise: a bastion at each corner
  const trace: [number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const rot = (x: number, z: number): [number, number] => {
      const c = Math.cos((k * Math.PI) / 2), s = Math.sin((k * Math.PI) / 2);
      return [x * c - z * s, x * s + z * c];
    };
    trace.push(rot(h, h - g), rot(h + e, h - g), rot(h + p, h + p), rot(h - g, h + e), rot(h - g, h));
  }
  const F = new THREE.Vector3(Math.cos(f.face), 0, Math.sin(f.face));
  const X = new THREE.Vector3().crossVectors(UP, F);
  m.push(new THREE.Matrix4().makeBasis(X, UP, F).setPosition(f.x, f.y, f.z));
  for (let i = 0; i < trace.length; i++) {
    const [ax, az] = trace[i], [bx, bz] = trace[(i + 1) % trace.length];
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = dz, nz = -dx;                                     // outward
    const cx = (ax + bx) / 2 - nx * (T / 2), cz = (az + bz) / 2 - nz * (T / 2);
    const D = new THREE.Vector3(dx, 0, dz), Zb = new THREE.Vector3().crossVectors(D, UP);
    const M = new THREE.Matrix4().makeBasis(D, UP, Zb);
    m.push(new THREE.Matrix4().setPosition(cx, 0, cz).multiply(M));
    m.paint(stone, FIN.stone).push(at(0, H / 2 - 1.2, 0)).box(len + T, H + 2.4, T).pop();
    m.push(at(0, -0.6, 0)).box(len + T + 0.6, 1.6, T + 1.4).pop();                          // the batter at her foot
    m.paint(top, FIN.stone).push(at(0, H + 0.04, 0)).box(len + T, 0.08, T).pop();
    // the parapet on her outer edge: merlons and embrasures to seaward, plain to landward
    const seaward = nz > -0.2;
    m.paint(stone, FIN.stone);
    if (seaward && len > 5) {
      const n = Math.max(1, Math.floor(len / 3.6));
      for (let k = 0; k <= n; k++) {
        const t = -len / 2 + (k * len) / n;
        m.push(at(t, H + 0.55, T / 2 - 0.45)).box(k === 0 || k === n ? 1.4 : 2.3, 1.1, 0.9).pop();
        if (k < n) cannon(m, t + len / n / 2, H, T / 2 - 1.8, 0);
      }
    } else {
      m.push(at(0, H + 0.55, T / 2 - 0.45)).box(len + T, 1.1, 0.9).pop();
    }
    m.pop();
  }
  // sentry boxes on the four salients
  for (let k = 0; k < 4; k++) {
    const [sx, sz] = trace[k * 5 + 2];
    const l = Math.hypot(sx, sz), ix = sx - (sx / l) * 1.2, iz = sz - (sz / l) * 1.2;
    m.paint('#E8E0CE', FIN.plaster).push(at(ix, H, iz)).lathe([[0.9, 0], [0.9, 2.1], [1.05, 2.2]], 10, false).pop();
    m.paint('#1A1410', FIN.dark).push(at(ix, H + 0.9, iz, Math.atan2(sx, sz))).box(0.5, 1.0, 1.84).pop();
    m.paint(stone, FIN.stone).push(at(ix, H + 2.2, iz)).lathe([[1.05, 0], [0.8, 0.5], [0.3, 0.95], [0.05, 1.3]], 10, true).pop();
  }
  // within: barracks along the landward curtain, a magazine, the flagstaff
  m.paint('#D8CCB2', FIN.plaster).push(at(0, 2, -h + 4)).box(12, 4, 5).pop();
  m.push(at(0, 0, -h + 4));
  roof(m, 12, 5, 4, '#A94E36', false, '#D8CCB2', 0.5);
  for (let i = 0; i < 4; i++) windowAt(m, -4.5 + i * 3, 1.2, 2.5, '#5A4030', i % 2 === 0, 0.7, 1.0);
  m.pop();
  m.paint(stone, FIN.stone).push(at(6, 1.5, 3)).box(4, 3, 5).pop();
  m.push(at(6, 0, 3, Math.PI / 2));
  roof(m, 5, 4, 3, '#8E8474', false, stone, 0.7, FIN.stone);
  m.pop();
  // the gate, landward
  m.paint('#1A1410', FIN.dark);
  m.quad([1.6, 0, -h - 0.02], [-1.6, 0, -h - 0.02], [-1.6, 3.8, -h - 0.02], [1.6, 3.8, -h - 0.02], [0, 0, -1]);
  m.paint(WOOD, FIN.wood).cyl([-4, 0, -4], [-4, 16, -4], 0.16, 0.09, 6, true);
  flags.push(m.here([-4, 15.9, -4]));
  m.pop();
}

/** The light on the eastern point: a tapering white tower with a red band, a gallery, the
 *  lantern and its dome, and the keeper's cottage. Returns where the lamp is. */
function lighthouse(m: Mesh, s: Spot): THREE.Vector3 {
  m.push(at(s.x, s.y, s.z, -s.face));
  m.paint('#9C9078', FIN.stone).push(at(0, -1.2, 0)).lathe([[3.4, 0], [3.3, 2.4], [2.6, 2.6]], 8, true).pop();
  m.paint('#EEE8DC', FIN.plaster).push(at(0, 1.2, 0)).lathe([[2.3, 0], [1.9, 9.5]], 14, false).pop();
  m.paint('#A63A2E', FIN.plaster).push(at(0, 10.7, 0)).lathe([[1.9, 0], [1.78, 2.4]], 14, false).pop();
  m.paint('#EEE8DC', FIN.plaster).push(at(0, 13.1, 0)).lathe([[1.78, 0], [1.6, 3.4]], 14, false).pop();
  m.paint('#1E1C1A', FIN.iron).push(at(0, 16.5, 0)).lathe([[1.5, 0], [2.4, 0.25], [2.4, 0.45], [0.2, 0.5]], 14, true).pop();
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * TAU;
    m.push(at(Math.cos(a) * 2.25, 17.4, Math.sin(a) * 2.25)).box(0.07, 0.9, 0.07).pop();
  }
  m.push(at(0, 17.85, 0)).lathe([[2.28, 0], [2.32, 0.04], [2.28, 0.08]], 18, false).pop();
  m.paint('#FFE8B8', FIN.lamp).push(at(0, 16.95, 0)).lathe([[1.15, 0], [1.15, 2.0]], 12, false).pop();
  m.paint('#1E1C1A', FIN.iron);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    m.push(at(Math.cos(a) * 1.18, 17.95, Math.sin(a) * 1.18)).box(0.08, 2.0, 0.08).pop();
  }
  m.paint('#3E5E52', FIN.iron).push(at(0, 18.95, 0)).lathe([[1.4, 0], [1.2, 0.5], [0.6, 1.1], [0.1, 1.45], [0.02, 1.7]], 12, true).pop();
  const lamp = m.here([0, 17.9, 0]);
  // the keeper's cottage
  m.push(at(-6, 0, 1.5, 0.3));
  m.paint('#EEE8DC', FIN.plaster).push(at(0, 1.6, 0)).box(5, 3.2, 3.8).pop();
  roof(m, 5, 3.8, 3.2, '#A94E36', false, '#EEE8DC', 0.55);
  doorAt(m, 1.2, 1.9);
  windowAt(m, -1.1, 1.1, 1.9, '#2A4A6A', true, 0.7, 0.9);
  m.pop();
  m.pop();
  return lamp;
}

/** Quays: planked decks on piles, bollards, cargo, a crane on the long pier, and the
 *  boats that work from them. */
function quays(m: Mesh, sites: Sites, r: Rng) {
  const deckY = 1.7;
  sites.quays.forEach((q, qi) => {
    const face = Math.atan2(q.uz, q.ux);
    const Fv = new THREE.Vector3(q.ux, 0, q.uz), X = new THREE.Vector3().crossVectors(UP, Fv);
    m.push(new THREE.Matrix4().makeBasis(X, UP, Fv).setPosition(q.x, 0, q.z));
    // along +z
    m.paint('#7A6448', FIN.deck).push(at(0, deckY, q.len / 2)).box(q.w, 0.3, q.len).pop();
    m.paint('#3E3226', FIN.wood);
    for (let t = 1; t <= q.len; t += 3.4) for (const s of [-1, 1]) m.cyl([s * (q.w / 2 - 0.15), -4, t], [s * (q.w / 2 - 0.15), deckY + 0.1, t], 0.22, 0.2, 6);
    m.paint('#2A2420', FIN.iron);
    for (let t = 4; t < q.len; t += 7) for (const s of [-1, 1]) m.cyl([s * (q.w / 2 - 0.35), deckY + 0.15, t], [s * (q.w / 2 - 0.35), deckY + 0.75, t], 0.2, 0.17, 7, true);
    // cargo
    const stacks = Math.floor(q.len / 9);
    for (let k = 0; k < stacks; k++) {
      const t = 3 + r() * (q.len - 6), x = (r() - 0.5) * (q.w - 2);
      if (r() < 0.5) {
        m.paint('#6B5134', FIN.wood).push(at(x, deckY + 0.6, t, r())).box(1, 0.9, 1).pop();
        m.push(at(x + 0.2, deckY + 1.5, t, r())).box(0.8, 0.8, 0.8).pop();
      } else {
        for (let b = 0; b < 3; b++) {
          m.paint('#5A4028', FIN.wood).push(at(x + (b - 1) * 0.75, deckY + 0.15, t)).lathe([[0.3, 0], [0.36, 0.45], [0.3, 0.9]], 8, true).pop();
        }
      }
    }
    if (qi === 0) {
      // a crane at the pier head
      const t = q.len - 2.2;
      m.paint('#4E3C2A', FIN.wood);
      m.cyl([q.w / 2 - 0.8, deckY, t], [q.w / 2 - 0.8, deckY + 6.5, t], 0.22, 0.18, 6, true);
      m.cyl([q.w / 2 - 0.8, deckY + 2.2, t], [q.w / 2 + 3.2, deckY + 6.8, t + 0.5], 0.15, 0.12, 6, true);
      m.paint('#6E5C44', FIN.wood).cyl([q.w / 2 + 3.2, deckY + 6.7, t + 0.5], [q.w / 2 + 3.2, deckY + 2.8, t + 0.5], 0.03, 0.03, 4);
      m.paint('#6B5134', FIN.wood).push(at(q.w / 2 + 3.2, deckY + 2.4, t + 0.5)).box(0.9, 0.8, 0.9).pop();
      lantern(m, [0, deckY + 3.2, q.len - 0.6], 0.55, { gilt: false, gold: '', metal: '#1E1C1A' });
      m.paint('#2A2420', FIN.wood).cyl([0, deckY, q.len - 0.6], [0, deckY + 2.6, q.len - 0.6], 0.1, 0.08, 6);
    }
    m.pop();
    // boats alongside, and one drawn up on the beach
    for (let k = 0; k < (qi === 0 ? 3 : 1); k++) {
      const t = 6 + k * 8 + r() * 3, side = k % 2 ? 1 : -1;
      const bx = q.x + q.ux * t + X.x * side * (q.w / 2 + 1.5), bz = q.z + q.uz * t + X.z * side * (q.w / 2 + 1.5);
      m.push(new THREE.Matrix4().makeRotationY(-face + (r() - 0.5) * 0.2).setPosition(bx, 0.35, bz));
      boat(m, 0, 0, 5 + r() * 1.5, 1.7, { band: SHUTTERS[Math.floor(r() * SHUTTERS.length)], deck: '#7A6448' });
      m.pop();
    }
  });
}

/** The pirates' camp: tents and lean-tos on the sand, a fire, casks. */
function camp(m: Mesh, sh: Shape, spots: Spot[], r: Rng) {
  const cloth = ['#E6DDC6', '#CDB892', '#D8CBA8', '#B8A67E', '#E0D2B0'];
  for (const s of spots) {
    const y = sh.height(s.x, s.z);
    const face = s.face + Math.PI / 2 + (r() - 0.5) * 0.8;
    m.push(at(s.x, y, s.z, -face));
    const c = cloth[Math.floor(r() * cloth.length)];
    if (r() < 0.7) {
      // an A-frame tent along x
      const L = 2.8 + r() * 1.2, W = 2.4 + r() * 0.6, Hh = 1.8 + r() * 0.5;
      m.paint(c, FIN.cloth);
      m.quad([-L / 2, 0, W / 2], [L / 2, 0, W / 2], [L / 2, Hh, 0], [-L / 2, Hh, 0]);
      m.quad([L / 2, 0, -W / 2], [-L / 2, 0, -W / 2], [-L / 2, Hh, 0], [L / 2, Hh, 0]);
      m.tri([-L / 2, 0, -W / 2], [-L / 2, 0, W / 2], [-L / 2, Hh, 0]);
      m.paint('#2A2218', FIN.dark).tri([L / 2, 0, W / 2], [L / 2, 0, -W / 2], [L / 2, Hh, 0]);
      m.paint('#5A4632', FIN.wood);
      for (const e of [-1, 1]) m.cyl([e * (L / 2 + 0.05), 0, 0], [e * (L / 2 + 0.05), Hh + 0.35, 0], 0.05, 0.05, 4);
    } else {
      // a lean-to: canvas stretched from two poles to the sand
      m.paint('#5A4632', FIN.wood);
      for (const e of [-1.3, 1.3]) m.cyl([e, 0, 1], [e, 2.2, 1], 0.06, 0.06, 4);
      m.paint(c, FIN.cloth);
      m.quad([-1.6, 0.1, -1.2], [1.6, 0.1, -1.2], [1.6, 2.2, 1], [-1.6, 2.2, 1]);
      m.quad([1.6, 0.1, -1.2], [-1.6, 0.1, -1.2], [-1.6, 2.2, 1], [1.6, 2.2, 1]);
    }
    if (r() < 0.45) {
      // a fire, ringed with stones
      m.paint('#5A5650', FIN.stone);
      for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; m.push(at(Math.cos(a) * 0.7, 0.08, 3 + Math.sin(a) * 0.7, a)).box(0.3, 0.2, 0.22).pop(); }
      m.paint('#FF9A4A', FIN.lamp).push(at(0, 0.12, 3)).lathe([[0.4, 0], [0.12, 0.35], [0.02, 0.45]], 6, true).pop();
    }
    if (r() < 0.5) m.paint('#5A4028', FIN.wood).push(at(1.8, 0, -0.8)).lathe([[0.3, 0], [0.36, 0.45], [0.3, 0.9]], 8, true).pop();
    m.pop();
  }
}

/** The market square: stalls under striped awnings, and a well. */
function market(m: Mesh, sq: Sites['square'], r: Rng) {
  const y = sq.y;
  m.push(at(sq.x, y, sq.z, -sq.face));
  m.paint('#8E8676', FIN.stone).push(at(0, 0, 0)).lathe([[1.1, 0], [1.1, 0.9], [0.9, 0.9], [0.9, 0.5]], 12, false).pop();
  m.paint('#1A2A2E', FIN.dark).push(at(0, 0.6, 0)).lathe([[0.9, 0], [0.01, 0.02]], 12, false).pop();
  m.paint(WOOD, FIN.wood);
  for (const s of [-1, 1]) m.push(at(s * 0.95, 1.6, 0)).box(0.14, 2.2, 0.14).pop();
  m.push(at(0, 2.7, 0)).box(2.2, 0.14, 0.14).pop();
  const stripes = [['#B03A2E', '#EDE4D0'], ['#2A4A6A', '#EDE4D0'], ['#3E6E4A', '#E8D6A8']];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4, d = sq.r - 2.2;
    m.push(at(Math.cos(a) * d, 0, Math.sin(a) * d, -a + Math.PI / 2));
    m.paint(WOOD, FIN.wood);
    for (const [px, pz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) m.push(at(px, 1.15 + (pz < 0 ? 0.2 : 0), pz)).box(0.1, 2.3 + (pz < 0 ? 0.4 : 0), 0.1).pop();
    const [c0, c1] = stripes[k % stripes.length];
    for (let i = 0; i < 6; i++) {
      const x0 = -1.5 + (i * 3) / 6, x1 = -1.5 + ((i + 1) * 3) / 6;
      m.paint(i % 2 ? c0 : c1, FIN.cloth);
      m.quad([x0, 2.3, 1.1], [x1, 2.3, 1.1], [x1, 2.75, -1.1], [x0, 2.75, -1.1]);
    }
    m.paint('#6B5134', FIN.wood).push(at(0, 0.45, 0.3)).box(2.4, 0.9, 1.0).pop();
    for (let i = 0; i < 4; i++) m.paint(['#C9A13B', '#8E2B24', '#4E6A2E', '#D8C8A0'][Math.floor(r() * 4)], FIN.paint).push(at(-0.9 + i * 0.6, 1.02, 0.3)).box(0.4, 0.25, 0.4).pop();
    m.pop();
  }
  m.pop();
}

/* ---------------------------------------------------------------- town ---- */

export interface Town {
  group: THREE.Group;
  /** Palms and trees about the streets, drawn with her island's plants. */
  grove: Stock;
  update(t: number): void;
  dispose(): void;
}

export function buildTown(sh: Shape, _harbour: Harbour, sites: Sites, N: Nursery, lo: boolean, aniso: number): Town {
  const m = new Mesh();
  const r = rng(`nassau:town:${sh.is.seed}`);
  const flagsAt: THREE.Vector3[] = [];
  for (const lot of sites.lots) {
    const y = sh.height(lot.x, lot.z);
    if (lot.kind === 'church') church(m, lot, y);
    else if (lot.kind === 'governor') governor(m, lot, y, flagsAt);
    else if (lot.kind === 'warehouse') warehouse(m, lot, r, y);
    else if (lot.kind === 'shack') shack(m, lot, r, y);
    else house(m, lot, r, y);
  }
  fortress(m, sites.fort, flagsAt);
  const lamp = lighthouse(m, sites.light);
  quays(m, sites, r);
  camp(m, sh, sites.camps, r);
  market(m, sites.square, r);
  for (const l of sites.lamps) {
    const y = sh.height(l.x, l.z);
    m.paint('#2A2420', FIN.wood).cyl([l.x, y, l.z], [l.x, y + 3.2, l.z], 0.09, 0.07, 5);
    lantern(m, [l.x, y + 3.55, l.z], 0.5, { gilt: false, gold: '', metal: '#1E1C1A' });
  }

  // palms along the waterfront and about the square
  const grove = new Stock();
  for (let k = 0; k < 26; k++) {
    const a = sites.lamps.length ? Math.atan2(sites.lamps[0].z - sh.is.y, sites.lamps[0].x - sh.is.x) : 0;
    const aa = a + (r() * 1.5);
    const f = 0.8 + r() * 0.08;
    const c = coastAt(sh.is, aa) * f;
    const x = sh.is.x + Math.cos(aa) * c, z = sh.is.y + Math.sin(aa) * c;
    if (sites.lots.some((l) => Math.hypot(l.x - x, l.z - z) < Math.max(l.w, l.d) * 0.6 + 1.5)) continue;
    if (sites.camps.some((s) => Math.hypot(s.x - x, s.z - z) < 3.5)) continue;
    const s = 0.9 + r() * 0.35;
    const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, sh.height(x, z) - 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -aa + (r() - 0.5), 0)), new THREE.Vector3(s, s, s));
    grove.add(N.palms[Math.floor(r() * N.palms.length)], mm, new THREE.Color(1, 1, 1), x * 0.13 + z * 0.17);
  }

  const tex = textures();
  const mat = timberMaterial(tex.timber, !lo, masonryTexture(lo ? 512 : 1024, aniso));
  const solid = new THREE.Mesh(m.geometry(), mat);
  solid.castShadow = solid.receiveShadow = !lo;
  const group = new THREE.Group();
  group.add(solid);

  // the black flag over the fort and the governor's house
  const flagMat = buntingMaterial('black', flagTexture('black'));
  const flagMeshes = flagsAt.map((p, i) => {
    const g = bunting([{ at: new THREE.Vector3(0, 0, 0), w: 3.6, h: 2.4, ph: i * 2.1 }]);
    const fm = new THREE.Mesh(g, flagMat);
    fm.position.copy(p);
    fm.rotation.y = 2.53;                     // streaming down the trade wind
    group.add(fm);
    return fm;
  });

  // the light's beam, sweeping the harbour mouth at dusk and in weather
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#FFE3AE') } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() { float a = uOpacity * pow(vUv.y, 2.2) * pow(abs(dot(vN, vV)), 1.4); gl_FragColor = vec4(uColor * a, a); }`,
  });
  const cone = new THREE.ConeGeometry(6, 70, 20, 1, true);
  cone.translate(0, -35, 0);
  cone.rotateZ(Math.PI / 2);
  const beam = new THREE.Group();
  for (const s of [0, Math.PI]) {
    const b = new THREE.Mesh(cone, beamMat);
    b.rotation.y = s;
    b.rotation.z = -0.04;
    beam.add(b);
  }
  beam.position.copy(lamp);
  group.add(beam);

  return {
    group,
    grove,
    update(t: number) {
      beam.rotation.y = t * 0.55;
      beamMat.uniforms.uOpacity.value = Math.max(0, Math.min(0.32, (lampGlow.value - 0.45) * 0.35));
      beam.visible = beamMat.uniforms.uOpacity.value > 0.005;
    },
    dispose() {
      solid.geometry.dispose();
      mat.dispose();
      cone.dispose();
      beamMat.dispose();
      for (const f of flagMeshes) f.geometry.dispose();
    },
  };
}

