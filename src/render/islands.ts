// Land. Every island on the chart, built once per run from the map:
//
//   ground   a heightfield shaped to her coastline (land/ground.ts), with her rocks
//   flora    palms, the jungle's canopy, scrub and hardwoods (land/flora.ts), in the wind
//   town     Nassau's streets, fort, light and quays (land/nassau.ts)
//
// Each island is two or three draws, culled on her own; reefs are one more.

import * as THREE from 'three';
import { rng, type Rng } from '../core/rng';
import { coastAt, type GameMap, type Island } from '../sim/map';
import { Soil, groundMaterial, groundMesh, shape, type Shape } from './land/ground';
import { Stock, floraMaterial, stock, type Nursery } from './land/flora';
import { foliageTexture, groundTexture } from './land/paint';
import { buildTown, nassauSites, type Town } from './land/nassau';
import { shipTime } from './ships/materials';

const TAU = Math.PI * 2;

/** Set her plants and rocks down according to what kind of island she is. */
function plant(sh: Shape, grove: Stock, soil: Soil, N: Nursery, lo: boolean, avoid: (x: number, z: number) => boolean) {
  const is = sh.is;
  const r = rng(is.seed + 11);
  const put = (t: Stock, x: number, z: number, y: number, rot: number, sx: number, sy: number, tint: THREE.Color) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sx, sy, sx));
    grove.add(t, m, tint, x * 0.13 + z * 0.17);
  };
  // leaf greens: olive to deep, a few going yellow; the atlas is already green, so these are tints
  const green = (k: number) => new THREE.Color().setHSL(0.2 + (r() - 0.5) * 0.08, 0.28 + r() * 0.2, 0.36 + k * 0.08 + (r() - 0.5) * 0.12).multiplyScalar(1.75);
  const slope = (x: number, z: number) => Math.hypot(sh.height(x + 1, z) - sh.height(x - 1, z), sh.height(x, z + 1) - sh.height(x, z - 1)) / 2;
  const at = (a: number, f: number) => { const c = coastAt(is, a) * f; return [is.x + Math.cos(a) * c, is.y + Math.sin(a) * c] as const; };
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];

  // the canopy: jungle crowns shoulder to shoulder over her hills
  if (is.kind === 'jungle' || is.kind === 'nassau') {
    const cell = lo ? 8.5 : 6, reach = is.r * 1.3;
    for (let gz = is.y - reach; gz < is.y + reach; gz += cell) {
      for (let gx = is.x - reach; gx < is.x + reach; gx += cell) {
        const x = gx + (r() - 0.5) * cell * 0.9, z = gz + (r() - 0.5) * cell * 0.9;
        const f = sh.frac(x, z);
        const edge = is.kind === 'nassau' ? 0.8 : 0.76;
        if (f > edge || r() < 0.05 || avoid(x, z)) continue;
        if (is.kind === 'nassau' && z > is.y - is.r * 0.12) continue;          // the town side is cleared
        const y = sh.height(x, z);
        // emergent giants here and there over the general run of the canopy
        const giant = r() < 0.12;
        const size = (f > edge - 0.14 ? 2.6 : 3.4) + r() * 2 + (giant ? 1.8 : 0);
        put(pick(N.crowns), x, z, y + size * 0.4 + 1.2 + (giant ? 2.5 : r() * 1.2), r() * TAU, size, size * (0.65 + r() * 0.35), green(giant ? 0.3 : 0));
      }
    }
  }
  // palms: along the back of her beaches, leaning out to sea
  const coast = is.r * TAU;
  const palms = is.kind === 'jungle' ? Math.round(coast / (lo ? 14 : 10)) : is.kind === 'sand' ? 4 + Math.floor(r() * 5) : is.kind === 'rock' ? (r() < 0.5 ? 2 : 0) : Math.round(coast / 16);
  for (let k = 0; k < palms; k++) {
    const a = r() * TAU;
    const f = is.kind === 'sand' ? 0.1 + r() * 0.55 : is.kind === 'rock' ? 0.55 + r() * 0.2 : 0.78 + r() * 0.1;
    const [x, z] = at(a, f);
    const y = sh.height(x, z);
    if (y < 0.7 || avoid(x, z) || slope(x, z) > 0.6) continue;
    const s = 0.85 + r() * 0.4;
    put(pick(N.palms), x, z, y - 0.2, -a + (r() - 0.5) * 1.2, s, s * (0.9 + r() * 0.25), new THREE.Color(1, 1, 1).multiplyScalar(0.9 + r() * 0.2));
  }
  // scrub at the jungle's edge, on rock plateaus, and in the lee of the dunes
  const bushes = is.kind === 'rock' ? Math.round(is.r * 0.55) : is.kind === 'sand' ? 6 + Math.floor(r() * 6) : Math.round(is.r * 0.5);
  for (let k = 0; k < bushes; k++) {
    const a = r() * TAU;
    const f = is.kind === 'rock' ? r() * 0.78 : is.kind === 'sand' ? 0.2 + r() * 0.55 : 0.64 + r() * 0.2;
    const [x, z] = at(a, f);
    const y = sh.height(x, z);
    if (y < 0.8 || avoid(x, z)) continue;
    const s = 0.9 + r() * 1.1;
    put(pick(N.bushes), x, z, y + s * 0.3, r() * TAU, s, s * 0.8, green(is.kind === 'rock' ? -0.8 : -0.3).lerp(new THREE.Color(1.2, 1.1, 0.6), is.kind === 'rock' ? 0.3 : 0));
  }
  // a few hardwoods: stunted on the rocks, tall round Nassau's hill
  const trees = is.kind === 'rock' ? Math.round(is.r * 0.12) : is.kind === 'nassau' ? 14 : is.kind === 'jungle' ? Math.round(is.r * 0.1) : 0;
  for (let k = 0; k < trees; k++) {
    const a = r() * TAU, f = 0.3 + r() * 0.45;
    const [x, z] = at(a, f);
    if (avoid(x, z) || (is.kind === 'nassau' && z > is.y)) continue;
    const s = is.kind === 'rock' ? 0.6 + r() * 0.3 : 0.9 + r() * 0.4;
    put(pick(N.trees), x, z, sh.height(x, z) - 0.2, r() * TAU, s, s, green(0));
  }
  // rocks: in the surf, at the foot of cliffs, on the tops
  const grey = is.kind === 'rock' ? '#857B6B' : '#6E685E';
  const moss = is.kind === 'jungle' || is.kind === 'nassau' ? 0.8 : 0.3;
  const stones = is.kind === 'rock' ? Math.round(is.r * 1.1) : is.kind === 'sand' ? 3 : Math.round(is.r * 0.28);
  for (let k = 0; k < stones; k++) {
    const a = r() * TAU;
    const top = is.kind === 'rock' && r() < 0.25;
    const f = top ? r() * 0.7 : 0.9 + r() * (is.kind === 'rock' ? 0.22 : 0.16);
    const [x, z] = at(a, f);
    if (avoid(x, z)) continue;
    const s = is.kind === 'rock' ? (top ? 1 + r() * 1.8 : 1.6 + r() * 3.4) : 0.8 + r() * 1.9;
    const y = Math.max(sh.height(x, z), -0.8) - s * 0.25;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.5, r() * TAU, r() * 0.5)), new THREE.Vector3(s * (0.8 + r() * 0.5), s * (0.6 + r() * 0.5), s * (0.8 + r() * 0.5)));
    soil.rock(pick(N.rocks), m, new THREE.Color(grey).multiplyScalar(0.8 + r() * 0.3), moss);
  }
}

function reefs(m: GameMap, soil: Soil, N: Nursery, r: Rng) {
  for (const k of m.reefs) {
    const n = 4 + Math.floor(k.r / 2.5);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * k.r * 0.85;
      const s = 1 + r() * 2.4;
      const mm = new THREE.Matrix4().compose(
        new THREE.Vector3(k.x + Math.cos(a) * d, -0.7 + r() * 0.8 - s * 0.2, k.y + Math.sin(a) * d),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.6, r() * TAU, r() * 0.6)),
        new THREE.Vector3(s, s * (0.5 + r() * 0.4), s * (0.8 + r() * 0.4)));
      soil.rock(N.rocks[Math.floor(r() * N.rocks.length)], mm, new THREE.Color(r() < 0.3 ? '#4A4038' : '#3A3632').multiplyScalar(0.9 + r() * 0.3), 0.15);
    }
  }
}

export class Islands {
  group = new THREE.Group();
  private key = '';
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private floraMat: THREE.MeshStandardMaterial | null = null;
  private towns: Town[] = [];
  private nursery: ReturnType<typeof stock> | null = null;

  build(m: GameMap, high: boolean, aniso = 4) {
    if (this.key === m.seed) return;
    this.key = m.seed;
    this.clear();
    const lo = !high;
    this.groundMat ??= groundMaterial(groundTexture(high ? 1024 : 512, aniso));
    this.floraMat ??= floraMaterial(foliageTexture(high ? 1024 : 512, aniso), shipTime, high);
    // The nursery (every palm, crown, tree and rock shape) is the same for every chart.
    const N = (this.nursery ??= stock(lo));

    for (const is of m.islands) {
      const sites = is.kind === 'nassau' ? nassauSites(is, m.harbour) : null;
      const sh = shape(is, sites?.flats ?? [], sites?.paths ?? []);
      const cell = Math.max(1.4, Math.min(3, is.r / 26)) * (lo ? 1.6 : 1);
      const soil = groundMesh(sh, cell);
      const grove = new Stock();
      plant(sh, grove, soil, N, lo, sites ? sites.avoid : () => false);
      this.add(soil.geometry(), this.groundMat, high, true);
      if (grove.count) this.add(grove.geometry(), this.floraMat, high, false);
      if (sites) {
        const town = buildTown(sh, m.harbour, sites, N, lo, aniso);
        this.towns.push(town);
        this.group.add(town.group);
        if (town.grove.count) this.add(town.grove.geometry(), this.floraMat, high, false);
      }
    }
    const reef = new Soil();
    reefs(m, reef, N, rng(`${m.seed}:reefs`));
    if (reef.I.length) this.add(reef.geometry(), this.groundMat, high, true);
  }

  private add(g: THREE.BufferGeometry, mat: THREE.Material, shadows: boolean, receive: boolean) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows && receive;
    this.group.add(mesh);
  }

  /** Once a frame: Nassau's lamps, flags and smoke. */
  update(t: number) { for (const tw of this.towns) tw.update(t); }

  private clear() {
    for (const tw of this.towns) tw.dispose();
    this.towns = [];
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
  }
}

export type { Island };
