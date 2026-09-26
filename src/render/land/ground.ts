// Land. Each island is a heightfield over a square grid, shaped to her coastline from the
// chart so that what you see is what you run aground on: a beach running up from the
// waterline, then rounded jungle hills round an off-centre summit, cliffs up to a rugged
// plateau, or a low cay of dunes. Noise gives her ridges, gullies and spurs. Every vertex
// carries what the ground there is made of — sand, grass, rock, dirt — and the ground
// shader paints each from the shared ground texture, in world space, so no two slopes
// look alike and nothing tiles where you can see it.

import * as THREE from 'three';
import { rng } from '../../core/rng';
import { coastAt, type Island } from '../../sim/map';
import { fbm2, perlin2, ridged2 } from '../noise';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A patch levelled for something built on it: a fort, a lighthouse, a market square. */
export interface Flat { x: number; z: number; r: number; y: number; soft?: number }
/** A trodden path, as a polyline of points. */
export type Path = [number, number][];

export interface Shape {
  is: Island;
  /** Height of the ground at a point, world coordinates. */
  height(x: number, z: number): number;
  /** How far out from her centre a point is, as a fraction of the coast there. */
  frac(x: number, z: number): number;
  beachTop: number;
  flats: Flat[];
  paths: Path[];
}

const BEACH = { jungle: 0.17, rock: 0.05, sand: 1, nassau: 0.13 } as const;
const BEACH_TOP = { jungle: 1.3, rock: 0.9, sand: 1.1, nassau: 1.3 } as const;

export function shape(is: Island, flats: Flat[] = [], paths: Path[] = []): Shape {
  const n = perlin2(is.seed), n2 = perlin2(is.seed + 1), n3 = perlin2(is.seed + 2);
  const r = rng(is.seed + 7);
  const summitA = r() * TAU, summitD = 0.12 + r() * 0.26;
  const sx = is.x + Math.cos(summitA) * is.r * summitD, sz = is.y + Math.sin(summitA) * is.r * summitD;
  const bw = BEACH[is.kind], top = BEACH_TOP[is.kind];
  const P = is.peak;

  const frac = (x: number, z: number) => {
    const dx = x - is.x, dz = z - is.y;
    const c = coastAt(is, Math.atan2(dz, dx)) + n3(x / 11, z / 11) * 1.1;
    return Math.hypot(dx, dz) / Math.max(1, c);
  };

  const raw = (x: number, z: number): number => {
    const f = frac(x, z);
    // the shelf she stands on, falling away under the water
    if (f >= 1) return -Math.min(7, (f - 1) * is.r * 0.42);
    const toSummit = clamp(Math.hypot(x - sx, z - sz) / (is.r * 1.1), 0, 1);
    if (is.kind === 'sand') {
      // a low cay: sand rising gently to a spine of dunes
      const u = smooth(0, 0.55, 1 - f);
      const dunes = 0.55 + 0.45 * fbm2(n, x / 13, z / 13, 3);
      return top * Math.pow(1 - f, 0.35) * 0.9 + (P - top) * u * dunes * (1 - toSummit * 0.5);
    }
    const beachEnd = 1 - bw;
    if (f > beachEnd) {
      const u = (1 - f) / bw;
      return top * Math.pow(u, is.kind === 'rock' ? 1 : 0.75);
    }
    const t = (beachEnd - f) / beachEnd;                    // 0 at the back of the beach, 1 at her heart
    const lift = 1 - toSummit * 0.55;
    if (is.kind === 'rock') {
      // cliffs straight up out of the surf to a broken plateau, in ledges where the strata
      // are harder, cut by gullies
      const cliff = 1 - Math.pow(1 - Math.min(1, t * 4.2), 2.2);
      const crags = ridged2(n, x / 18, z / 18, 4);
      const gully = Math.pow(Math.abs(fbm2(n2, x / 26, z / 26, 3)), 0.6);
      let y = top + (P - top) * (cliff * (0.55 + 0.45 * lift) * (0.78 + 0.22 * gully) + crags * 0.42 * Math.min(1, t * 2.4));
      y += fbm2(n3, x / 7, z / 7, 3) * P * 0.07 * Math.min(1, t * 3);
      const ledge = 2.2;
      return y + (Math.round(y / ledge) * ledge - y) * 0.45 * Math.min(1, t * 5);
    }
    // jungle, and Nassau: rounded hills with spurs and gullies running down to the beach
    const hill = Math.pow(smooth(0, 1, t), 1.15);
    const relief = fbm2(n, x / 30, z / 30, 4) * 0.26 + (ridged2(n2, x / 48, z / 48, 3) - 0.5) * 0.3;
    let y = top + (P - top) * hill * lift * (0.82 + relief) + fbm2(n3, x / 7, z / 7, 2) * 0.35 * Math.min(1, t * 4);
    if (is.kind === 'nassau') {
      // the town side, facing the harbour, is a long gentle slope; the hill is behind it
      const south = clamp((z - is.y) / is.r, -1, 1);
      y = top + (y - top) * (0.4 + 0.6 * smooth(0.5, -0.6, south));
    }
    return Math.max(top * 0.9, y);
  };

  const height = (x: number, z: number): number => {
    let y = raw(x, z);
    for (const fl of flats) {
      const d = Math.hypot(x - fl.x, z - fl.z), soft = fl.soft ?? 6;
      if (d < fl.r + soft) y += (fl.y - y) * smooth(fl.r + soft, fl.r, d);
    }
    return y;
  };

  return { is, height, frac, beachTop: top, flats, paths };
}

/* ---------------------------------------------------------------- mesh ---- */

export interface Ground { geometry: THREE.BufferGeometry }

const COLOUR = {
  sand: new THREE.Color('#E4D2A2'),
  jungle: new THREE.Color('#3B6E2A'),
  scrub: new THREE.Color('#6F7440'),
  lawn: new THREE.Color('#6E8A48'),
  rock: new THREE.Color('#7C7568'),
  crag: new THREE.Color('#8A8070'),
  dirt: new THREE.Color('#8C704C'),
};

const WARM = new THREE.Color('#A08664'), DARKROCK = new THREE.Color('#5E574E');

const distToPath = (x: number, z: number, p: Path) => {
  let best = 1e9;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
};

/** What the ground is made of at a point, and its base colour. */
function dress(s: Shape, x: number, z: number, y: number, ny: number, noise: number) {
  const is = s.is, slope = 1 - ny;
  let sand = 1 - smooth(s.beachTop - 0.1, s.beachTop + 0.7, y);
  let rock = smooth(0.3, 0.55, slope);
  let dirt = 0;
  if (is.kind === 'sand') sand = Math.max(sand, 1 - smooth(1.4, 3.2, y) * 0.6);
  if (is.kind === 'rock') { rock = Math.max(rock, ny > 0.9 ? 0.25 + 0.5 * noise : 0.75 + 0.25 * noise); sand *= y < 0.6 ? 1 : 0.2; }
  for (const p of s.paths) dirt = Math.max(dirt, 1 - smooth(1.8, 3.4, distToPath(x, z, p)));
  // a town's ground is trodden bare between the houses
  if (is.kind === 'nassau' && s.paths.length) {
    const toHarbour = Math.hypot(x - is.x, z - is.y - is.r * 0.55) / is.r;
    dirt = Math.max(dirt, (1 - smooth(0.35, 0.7, toHarbour)) * (0.35 + 0.4 * noise));
  }
  for (const fl of s.flats) dirt = Math.max(dirt, (1 - smooth(fl.r - 1, fl.r + 2, Math.hypot(x - fl.x, z - fl.z))) * 0.75);
  if (is.kind === 'jungle' || is.kind === 'nassau') dirt = Math.max(dirt, smooth(0.62, 0.8, noise) * 0.5 * (1 - sand));
  rock *= 1 - sand * 0.7;
  dirt *= 1 - rock;
  let grass = Math.max(0, 1 - sand - rock - dirt);
  const sum = sand + rock + dirt + grass || 1;
  sand /= sum; rock /= sum; dirt /= sum; grass /= sum;
  const green = is.kind === 'rock' ? COLOUR.scrub : is.kind === 'nassau' ? COLOUR.lawn : COLOUR.jungle;
  const col = new THREE.Color(0, 0, 0);
  const mixIn = (c: THREE.Color, w: number) => { col.r += c.r * w; col.g += c.g * w; col.b += c.b * w; };
  mixIn(COLOUR.sand, sand);
  mixIn(green, grass);
  mixIn(is.kind === 'rock' ? COLOUR.crag : COLOUR.rock, rock);
  mixIn(COLOUR.dirt, dirt);
  col.multiplyScalar(0.88 + noise * 0.24);
  // strata: the rock is banded, pale and dark, level round the island, and weathers warm
  if (rock > 0.2) {
    col.multiplyScalar(1 + rock * 0.16 * Math.sin(y * 2.3 + noise * 2.5));
    col.lerp(noise > 0.55 ? WARM : DARKROCK, rock * Math.abs(noise - 0.55) * 0.9);
  }
  return { col, w: [sand, grass, rock, dirt] as [number, number, number, number] };
}

/** Ground and the rocks on it, gathered as plain arrays and baked into one geometry. */
export class Soil {
  P: number[] = []; N: number[] = []; C: number[] = []; W: number[] = []; I: number[] = [];

  /** Set a boulder down: `geo` is flat-faced and non-indexed, moved by `m`. */
  rock(geo: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color, moss = 0) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const base = this.P.length / 3;
    const green = new THREE.Color('#4E6A2E');
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      nv.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
      const top = moss * Math.max(0, nv.y - 0.55) / 0.45;
      const c = col.clone().lerp(green, top * 0.8);
      this.P.push(v.x, v.y, v.z); this.N.push(nv.x, nv.y, nv.z); this.C.push(c.r, c.g, c.b);
      this.W.push(0, top, 1 - top, 0);
      this.I.push(base + i);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aBiome', new THREE.Float32BufferAttribute(this.W, 4));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

/** Her ground: a square grid over her, cells wholly under the shelf dropped. */
export function groundMesh(s: Shape, cell: number, soil = new Soil()): Soil {
  const is = s.is;
  const reach = Math.max(...is.radii) * 1.14 + 4;
  const N = Math.ceil((reach * 2) / cell);
  const x0 = is.x - (N * cell) / 2, z0 = is.y - (N * cell) / 2;
  const tint = perlin2(is.seed + 3);
  const H = new Float32Array((N + 1) * (N + 1));
  const F = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      H[j * (N + 1) + i] = s.height(x, z);
      F[j * (N + 1) + i] = s.frac(x, z);
    }
  }
  const keep = (i: number, j: number) => {
    let under = 0;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (F[(j + b) * (N + 1) + i + a] > 1.1) under++;
    return under < 4;
  };
  const index = new Int32Array((N + 1) * (N + 1)).fill(-1);
  const { P, N: Nn, C, W, I } = soil;
  const vert = (i: number, j: number) => {
    const k = j * (N + 1) + i;
    if (index[k] >= 0) return index[k];
    const x = x0 + i * cell, z = z0 + j * cell, y = H[k];
    // normal from the heights either side
    const hx = (H[j * (N + 1) + Math.min(N, i + 1)] - H[j * (N + 1) + Math.max(0, i - 1)]) / (cell * (i > 0 && i < N ? 2 : 1));
    const hz = (H[Math.min(N, j + 1) * (N + 1) + i] - H[Math.max(0, j - 1) * (N + 1) + i]) / (cell * (j > 0 && j < N ? 2 : 1));
    const nl = Math.hypot(hx, 1, hz);
    const nx = -hx / nl, ny = 1 / nl, nz = -hz / nl;
    const d = dress(s, x, z, y, ny, 0.5 + 0.5 * fbm2(tint, x / 16, z / 16, 3));
    index[k] = P.length / 3;
    P.push(x, y, z); Nn.push(nx, ny, nz); C.push(d.col.r, d.col.g, d.col.b); W.push(...d.w);
    return index[k];
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!keep(i, j)) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
      // alternate the diagonal so the grid does not show as a grain
      if ((i + j) % 2) I.push(a, d, b, b, d, c); else I.push(a, d, c, a, c, b);
    }
  }
  return soil;
}

/* ------------------------------------------------------------ material ---- */

/** The ground shader: the base colour per vertex, and the detail of each kind of ground
 *  painted over it from the shared texture — laid flat for sand, grass and dirt, stood up
 *  on end for rock faces so strata run level round a cliff. The water's edge is wet. */
export function groundMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGround = { value: map };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBiome;\nvarying vec4 vBiome;\nvarying vec3 vWorld;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBiome = aBiome;\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform sampler2D uGround;
varying vec4 vBiome;
varying vec3 vWorld;
varying vec3 vWN;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
vec2 gp = vWorld.xz;
vec4 d1 = texture2D(uGround, gp / 9.0);
vec4 d2 = texture2D(uGround, gp / 33.0 + 0.37);
float steep = smoothstep(0.35, 0.75, 1.0 - abs(vWN.y));
vec2 side = abs(vWN.x) > abs(vWN.z) ? vec2(vWorld.z, vWorld.y) : vec2(vWorld.x, vWorld.y);
vec4 d3 = texture2D(uGround, side * vec2(1.0, 1.8) / 11.0);
float gSand = mix(d1.r, d2.r, 0.35);
float gGrass = mix(d1.g, d2.g, 0.45);
float gRock = mix(mix(d1.b, d2.b, 0.4), d3.b, steep);
float gDirt = mix(d1.a, d2.a, 0.3);
float gDetail = dot(vBiome, vec4(gSand, gGrass, gRock, gDirt));
diffuseColor.rgb *= gDetail * 1.14;
// the grass is greener in the hollows and yellower on the tops
diffuseColor.rgb *= mix(vec3(1.0), vec3(1.08, 1.05, 0.82), vBiome.y * smoothstep(0.55, 0.8, d2.g));
float gWet = (1.0 - smoothstep(0.08, 0.7, vWorld.y)) * (vBiome.x + vBiome.z * 0.6);
diffuseColor.rgb *= 1.0 - gWet * 0.38;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness - gWet * 0.5;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
{
  // the detail as a bump: grains, blades and cracks catch the light
  vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(gDetail), dFdy(gDetail));
  normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2) * 1.6);
}`);
  };
  m.customProgramCacheKey = () => 'bf-ground';
  return m;
}
