// Growing things, and the rocks among them. Templates are shaped once — palms that lean
// and droop, the jungle's lumpy crowns, scrub, boulders grown from 3D noise — then set
// down many times over, baked per island into one mesh each: one draw for her plants,
// with the rocks going into her ground mesh. The vertex shader moves the plants in the
// wind by how far each vertex is from its root; the fronds flutter at their tips.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, type Rng } from '../../core/rng';
import { perlin3 } from '../noise';
import { FOLIAGE } from './paint';

type V3 = [number, number, number];

/* --------------------------------------------------------------- stock ---- */

/** A template or a whole grove: plain arrays until it is baked into a geometry. */
export class Stock {
  P: number[] = []; N: number[] = []; C: number[] = []; U: number[] = []; S: number[] = []; I: number[] = [];

  vert(p: V3, n: V3, c: THREE.Color, uv: [number, number], sway: [number, number, number]) {
    this.P.push(...p); this.N.push(...n); this.C.push(c.r, c.g, c.b); this.U.push(...uv); this.S.push(...sway);
    return this.P.length / 3 - 1;
  }

  /** Append `t`, moved by `m`, tinted by `tint`, and swaying with phase `phase`. */
  add(t: Stock, m: THREE.Matrix4, tint: THREE.Color, phase: number) {
    const base = this.P.length / 3;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < t.P.length / 3; i++) {
      v.set(t.P[i * 3], t.P[i * 3 + 1], t.P[i * 3 + 2]).applyMatrix4(m);
      n.set(t.N[i * 3], t.N[i * 3 + 1], t.N[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.P.push(v.x, v.y, v.z); this.N.push(n.x, n.y, n.z);
      this.C.push(t.C[i * 3] * tint.r, t.C[i * 3 + 1] * tint.g, t.C[i * 3 + 2] * tint.b);
      this.U.push(t.U[i * 2], t.U[i * 2 + 1]);
      this.S.push(phase, t.S[i * 3 + 1], t.S[i * 3 + 2]);
    }
    for (const i of t.I) this.I.push(base + i);
  }

  get count() { return this.P.length / 3; }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.S, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE_UV: [number, number] = [0.012, 0.988];        // a clean corner of the atlas, for bark and nuts
const leafUv = (n: THREE.Vector3): [number, number] => {
  const [u0, v0, u1, v1] = FOLIAGE.leaves;
  const a = Math.atan2(n.z, n.x) / (Math.PI * 2) + 0.5;
  return [u0 + (u1 - u0) * a, v0 + (v1 - v0) * (n.y * 0.5 + 0.5)];
};

/* ---------------------------------------------------------------- palm ---- */

/** A palm: a ringed trunk bending to +x, a crown of V-folded fronds drooping as they age,
 *  and a cluster of nuts. Height `H`, the top `bend` metres over, `F` fronds. */
function palm(r: Rng, H: number, bend: number, F: number, lo: boolean): Stock {
  const s = new Stock();
  const SEG = lo ? 4 : 6, SIDES = lo ? 5 : 6;
  const bark = [new THREE.Color('#7A6246'), new THREE.Color('#665139')];
  const at = (u: number): V3 => [bend * u * u, H * u, 0];
  const tan = (u: number) => new THREE.Vector3(2 * bend * u, H, 0).normalize();
  const rings: number[][] = [];
  for (let k = 0; k <= SEG; k++) {
    const u = k / SEG, c = at(u), T = tan(u);
    const N0 = new THREE.Vector3(-T.y, T.x, 0).normalize(), B0 = new THREE.Vector3(0, 0, 1);
    const rad = 0.28 * (1 - 0.38 * u) + 0.16 * Math.pow(1 - u, 6);
    const ring: number[] = [];
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      const d = N0.clone().multiplyScalar(Math.cos(a)).addScaledVector(B0, Math.sin(a));
      ring.push(s.vert([c[0] + d.x * rad, c[1] + d.y * rad, c[2] + d.z * rad], [d.x, d.y, d.z], bark[k % 2], WHITE_UV, [0, u * u, 0]));
    }
    rings.push(ring);
  }
  for (let k = 0; k < SEG; k++) for (let i = 0; i < SIDES; i++) {
    const a = rings[k][i], b = rings[k][i + 1], c = rings[k + 1][i + 1], d = rings[k + 1][i];
    s.I.push(a, d, b, b, d, c);
  }
  const C = at(1);
  // the fronds
  const [fu0, , fu1] = FOLIAGE.frond;
  const FS = lo ? 4 : 5;
  for (let f = 0; f < F; f++) {
    const phi = (f / F) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const young = f % 3 === 0;
    const elev = young ? 0.55 + r() * 0.3 : -0.05 + r() * 0.35;
    const droop = young ? 0.25 : 0.5 + r() * 0.3;
    const L = (young ? 3.2 : 4.2) + r() * 1.2, W = 1.25 + r() * 0.3;
    const h = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
    const side = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi));
    const tint = new THREE.Color(1, 1, 1).multiplyScalar(0.85 + r() * 0.2);
    if (!young && r() < 0.3) tint.lerp(new THREE.Color('#C9B26A'), 0.45);          // an old frond, going brown
    const row: number[][] = [];
    for (let k = 0; k <= FS; k++) {
      const u = k / FS;
      const p = new THREE.Vector3(C[0], C[1] + 0.1, C[2])
        .addScaledVector(h, L * u * Math.cos(elev))
        .add(new THREE.Vector3(0, L * u * Math.sin(elev) - droop * L * u * u, 0));
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.05)), 0.7) * 0.5;
      const lift = 0.38 * w;                                                            // folded into a shallow V
      const up = new THREE.Vector3(0, 1, 0);
      const L0 = p.clone().addScaledVector(side, -w).addScaledVector(up, lift);
      const R0 = p.clone().addScaledVector(side, w).addScaledVector(up, lift);
      const v = 1 - u * 0.985;
      const sw: [number, number, number] = [0, 1 + u * 0.5, u];
      row.push([
        s.vert([L0.x, L0.y, L0.z], [0, 1, 0], tint, [fu0, v], sw),
        s.vert([p.x, p.y, p.z], [0, 1, 0], tint, [(fu0 + fu1) / 2, v], sw),
        s.vert([R0.x, R0.y, R0.z], [0, 1, 0], tint, [fu1, v], sw),
      ]);
    }
    for (let k = 0; k < FS; k++) {
      const [a0, a1, a2] = row[k], [b0, b1, b2] = row[k + 1];
      s.I.push(a0, b0, a1, a1, b0, b1, a1, b1, a2, a2, b1, b2);
    }
  }
  // nuts under the crown
  const nut = new THREE.Color(r() < 0.5 ? '#5C4A2A' : '#6E7A2E');
  for (let k = 0; k < (lo ? 2 : 4); k++) {
    const a = (k / 4) * Math.PI * 2 + r();
    const c: V3 = [C[0] + Math.cos(a) * 0.32, C[1] - 0.35, C[2] + Math.sin(a) * 0.32];
    ball(s, c, 0.2, nut, [0, 1, 0]);
  }
  fixNormals(s, rings.length * (SIDES + 1));
  return s;
}

/** A small low-poly ball. */
function ball(s: Stock, c: V3, rad: number, col: THREE.Color, sway: [number, number, number]) {
  const g = new THREE.IcosahedronGeometry(rad, 0);
  const p = g.attributes.position;
  const base = s.count;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    s.vert([c[0] + x, c[1] + y, c[2] + z], [x / l, y / l, z / l], col, WHITE_UV, sway);
  }
  for (let i = 0; i < p.count; i++) s.I.push(base + i);
  g.dispose();
}

/** Recompute normals for everything after the first `skip` vertices (the fronds and nuts),
 *  from their faces — the trunk keeps its round ones. */
function fixNormals(s: Stock, skip: number) {
  const acc = new Float32Array(s.P.length);
  const v = (i: number) => new THREE.Vector3(s.P[i * 3], s.P[i * 3 + 1], s.P[i * 3 + 2]);
  for (let t = 0; t < s.I.length; t += 3) {
    const a = s.I[t], b = s.I[t + 1], c = s.I[t + 2];
    if (a < skip && b < skip && c < skip) continue;
    const n = new THREE.Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a)));
    for (const i of [a, b, c]) { acc[i * 3] += n.x; acc[i * 3 + 1] += n.y; acc[i * 3 + 2] += n.z; }
  }
  for (let i = skip; i < s.P.length / 3; i++) {
    let x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2];
    // fronds are lit as if they faced up, whichever way they are wound
    if (y < 0) { x = -x; y = -y; z = -z; }
    const l = Math.hypot(x, y, z) || 1;
    s.N[i * 3] = x / l; s.N[i * 3 + 1] = y / l; s.N[i * 3 + 2] = z / l;
  }
}

/* ---------------------------------------------------------------- crowns --- */

/** A leafy crown: a lumpy ball of leaves, flat underneath. `sway` is how much it moves. */
function crown(seed: number, detail: number, sway: number): Stock {
  const n = perlin3(`crown:${seed}`);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.28 * n(x * 1.4, y * 1.4, z * 1.4) + 0.1 * n(x * 3.3 + 5, y * 3.3, z * 3.3);
    p.setXYZ(i, x * k, Math.max(y * k * 0.8, -0.35), z * k);
  }
  g.computeVertexNormals();
  const s = new Stock();
  const nn = g.attributes.normal, col = new THREE.Color(1, 1, 1);
  const nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    nv.set(nn.getX(i), nn.getY(i), nn.getZ(i));
    // darker toward the underside, where the light does not get in
    const shade = 0.62 + 0.38 * (nv.y * 0.5 + 0.5);
    s.vert([p.getX(i), p.getY(i), p.getZ(i)], [nv.x, nv.y, nv.z], col.clone().multiplyScalar(shade), leafUv(nv), [0, sway, 0.35]);
  }
  for (let i = 0; i < g.index!.count; i++) s.I.push(g.index!.getX(i));
  g.dispose();
  return s;
}

/** A hardwood: a crooked trunk and a crown of two or three lumps. */
function tree(r: Rng, lo: boolean): Stock {
  const s = new Stock();
  const H = 3 + r() * 2.5;
  const bark = new THREE.Color('#5E4A36');
  const SIDES = 5;
  const lean = (r() - 0.5) * 0.8;
  const ring = (y: number, rad: number, dx: number) =>
    Array.from({ length: SIDES + 1 }, (_, i) => {
      const a = (i / SIDES) * Math.PI * 2;
      return s.vert([dx + Math.cos(a) * rad, y, Math.sin(a) * rad], [Math.cos(a), 0, Math.sin(a)], bark, WHITE_UV, [0, (y / H) * 0.2, 0]);
    });
  const r0 = ring(0, 0.34, 0), r1 = ring(H, 0.2, lean);
  for (let i = 0; i < SIDES; i++) s.I.push(r0[i], r1[i], r0[i + 1], r0[i + 1], r1[i], r1[i + 1]);
  const lumps = lo ? 2 : 3;
  for (let k = 0; k < lumps; k++) {
    const c = crown(Math.floor(r() * 1e6), 1, 0.12);
    const sc = 2.2 + r() * 1.6;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(lean + (r() - 0.5) * 2.4, H + 0.6 + r() * 1.4, (r() - 0.5) * 2.4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)),
      new THREE.Vector3(sc, sc * (0.75 + r() * 0.3), sc));
    s.add(c, m, new THREE.Color(1, 1, 1), 0);
  }
  return s;
}

/* ---------------------------------------------------------------- rocks ---- */

/** A boulder grown from noise: rounded, fractured, flat enough underneath to sit. Faces
 *  are flat — rock breaks along planes. Returns plain arrays for the ground mesh. */
export function boulder(seed: number, detail: number) {
  const n = perlin3(`rock:${seed}`);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.32 * n(x * 1.1, y * 1.1, z * 1.1) + 0.12 * n(x * 2.7 + 3, y * 2.7, z * 2.7);
    p.setXYZ(i, x * k, Math.max(y * k * 0.72, -0.45), z * k);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/* ------------------------------------------------------------- the stock --- */

export interface Nursery {
  palms: Stock[];
  crowns: Stock[];
  bushes: Stock[];
  trees: Stock[];
  rocks: THREE.BufferGeometry[];
}

let nursery: Nursery | null = null;

/** Every template, shaped once. */
export function stock(lo: boolean): Nursery {
  if (nursery) return nursery;
  const r = rng('nursery');
  nursery = {
    palms: [
      palm(r, 7.5, 1.6, lo ? 8 : 11, lo), palm(r, 9.5, 2.6, lo ? 8 : 12, lo),
      palm(r, 6, 0.6, lo ? 7 : 10, lo), palm(r, 8.5, 3.4, lo ? 8 : 11, lo),
    ],
    crowns: [crown(1, 1, 0.1), crown(2, 1, 0.1), crown(3, 1, 0.1)],
    bushes: [crown(11, 1, 0.05), crown(12, 0, 0.05)],
    trees: [tree(r, lo), tree(r, lo), tree(r, lo)],
    rocks: [boulder(21, lo ? 1 : 2), boulder(22, 1), boulder(23, lo ? 1 : 2), boulder(24, 1)],
  };
  return nursery;
}

/* ------------------------------------------------------------ material ---- */

/** Leaves: the foliage atlas, cut out; moved by the wind; lit through from behind. */
export function floraMaterial(map: THREE.Texture, time: { value: number }, a2c: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, alphaTest: a2c ? 0 : 0.42 });
  m.alphaToCoverage = a2c;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSway;\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
float ph = aSway.x + uTime;
vec3 wind = vec3(0.82, 0.0, 0.57);
float sway = aSway.y * (sin(ph * 0.9) * 0.22 + sin(ph * 2.3 + 1.7) * 0.06);
float flutter = aSway.z * sin(ph * 5.7 + position.y * 1.7 + position.x) * 0.16;
transformed += wind * (sway + flutter) + vec3(0.0, flutter * 0.7, 0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
// far off, a frond is a smear of mip and its cut-out would thin to nothing: hold it up
vec2 bfDuv = fwidth(vMapUv) * 1024.0;
diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + max(log2(max(bfDuv.x, bfDuv.y)), 0.0) * 0.35));`)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  float back = saturate(-dot(normal, directionalLights[0].direction));
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * back * 0.4 * vec3(0.9, 1.1, 0.6);
}
#endif`);
  };
  m.customProgramCacheKey = () => `bf-flora${a2c ? '-a2c' : ''}`;
  return m;
}
