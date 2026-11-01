// The islands, low and chunky: every coast on the chart lofted into a little hill of flat
// faces, sand round the edge and grass or rock on top, all in one draw, and its outline
// in another. Palms and rocks from the props file are set on them once it has loaded,
// two draws for each shape.
//
// Low on purpose: the camera is high in the south, and nothing on an island may hide a
// ship behind it (the art brief keeps hills to about 6 m and palms to 8).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../core/rng';
import { coastAt, type GameMap, type Island } from '../sim/map';
import { INK, outline } from './ink';
import { toon } from './toon';

const TAU = Math.PI * 2;
const SPOKES = 32;

const C = {
  // the strip at the waterline: what shows of it above the water is the coast's outline
  wet: INK,
  sand: new THREE.Color('#F6DD94'),
  grass: new THREE.Color('#79C850'),
  grass2: new THREE.Color('#5DB043'),
  rock: new THREE.Color('#A6A3B4'),
  rock2: new THREE.Color('#8C899C'),
};

/** Rings of each island, from under the water to the top: [share of her coast radius, height as a share of her peak, metres added]. */
const PROFILE: Record<Island['kind'], [number, number, number][]> = {
  jungle: [[1.08, 0, -0.8], [1, 0, 0.35], [0.9, 0, 0.9], [0.78, 0.35, 0.9], [0.55, 0.75, 0.9], [0.3, 0.95, 0.9], [0, 1, 0.9]],
  rock: [[1.06, 0, -0.8], [1, 0, 0.3], [0.94, 0.45, 0.3], [0.75, 0.8, 0.3], [0.45, 1, 0.3], [0, 0.95, 0.3]],
  sand: [[1.1, 0, -0.8], [1, 0, 0.3], [0.7, 0.6, 0.3], [0.35, 1, 0.3], [0, 1, 0.3]],
};

/** What a ring's faces are made of, ring by ring outward-in. */
function colourOf(kind: Island['kind'], ring: number, n: number, r: () => number): THREE.Color {
  if (ring === 0) return C.wet;
  if (ring === 1 || kind === 'sand') return C.sand;
  if (kind === 'rock') return r() < 0.5 ? C.rock : C.rock2;
  return ring === n - 1 || r() < 0.35 ? C.grass2 : C.grass;
}

function islandGeometry(is: Island): THREE.BufferGeometry {
  const r = rng(is.seed);
  const prof = PROFILE[is.kind];
  const pos: number[] = [], col: number[] = [];
  // every vertex of every ring, with a little wobble so the faces catch the light differently
  const ring = prof.map(([f, h, add], k) => Array.from({ length: SPOKES }, (_, i) => {
    const a = (i / SPOKES) * TAU;
    const c = coastAt(is, a) * f;
    const j = k > 1 && k < prof.length - 1 ? (r() - 0.5) * 0.5 : 0;
    return new THREE.Vector3(is.x + Math.cos(a) * c, h * is.peak + add + j, is.y + Math.sin(a) * c);
  }));
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col3: THREE.Color) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) col.push(col3.r, col3.g, col3.b);
  };
  for (let k = 0; k < prof.length - 1; k++) {
    for (let i = 0; i < SPOKES; i++) {
      const j = (i + 1) % SPOKES;
      const o0 = ring[k][i], o1 = ring[k][j], i0 = ring[k + 1][i], i1 = ring[k + 1][j];
      const c = colourOf(is.kind, k, prof.length - 1, r);
      // wound so the faces look up: the y axis is up and the chart's +y (south) is +z
      tri(o0, i0, o1, c);
      if (k < prof.length - 2) tri(o1, i0, i1, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export type PropKind = 'palm' | 'rock' | 'crate';
/** A prop's shape, ready to set down: base at y = 0, a height of 1. */
export interface Prop { geometry: THREE.BufferGeometry; map: THREE.Texture | null }

export class Land {
  readonly group = new THREE.Group();
  private ground: THREE.Mesh | null = null;
  private props: THREE.InstancedMesh[] = [];
  private map: GameMap | null = null;
  private kit: Partial<Record<PropKind, Prop[]>> = {};

  setMap(m: GameMap) {
    if (this.map === m) return;
    this.map = m;
    this.clear();
    const geos = m.islands.map(islandGeometry);
    const g = mergeGeometries(geos)!;
    for (const x of geos) x.dispose();
    this.ground = new THREE.Mesh(g, toon({ vertexColors: true }));
    outline(this.ground);
    this.group.add(this.ground);
    this.dress();
  }

  /** The props file has loaded: palms and rocks, each kind a list of shapes to pick from. */
  setProps(kit: Partial<Record<PropKind, Prop[]>>) {
    this.kit = kit;
    this.dress();
  }

  private dress() {
    for (const p of this.props) { this.group.remove(p); p.dispose(); }
    this.props = [];
    const m = this.map;
    if (!m) return;
    const at = new Map<Prop, THREE.Matrix4[]>();
    const put = (kind: PropKind, r: () => number, x: number, y: number, z: number, size: number) => {
      const list = this.kit[kind];
      if (!list?.length) return;
      const p = list[Math.floor(r() * list.length)];
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * TAU);
      const s = size * (0.8 + r() * 0.4);
      (at.get(p) ?? at.set(p, []).get(p)!).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)));
    };
    for (const is of m.islands) {
      const r = rng(is.seed + 7);
      const palms = is.kind === 'jungle' ? Math.round(is.r / 4) : is.kind === 'sand' ? 2 + Math.floor(r() * 3) : r() < 0.4 ? 1 : 0;
      for (let i = 0; i < palms; i++) {
        const a = r() * TAU, f = is.kind === 'jungle' ? 0.25 + r() * 0.6 : 0.2 + r() * 0.5;
        const c = coastAt(is, a) * f;
        put('palm', r, is.x + Math.cos(a) * c, heightOn(is, f) - 0.2, is.y + Math.sin(a) * c, 6 + r() * 2);
      }
      const rocks = is.kind === 'rock' ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
      for (let i = 0; i < rocks; i++) {
        const a = r() * TAU, f = is.kind === 'rock' ? r() * 0.7 : 0.85 + r() * 0.15;
        const c = coastAt(is, a) * f;
        put('rock', r, is.x + Math.cos(a) * c, heightOn(is, f) - 0.3, is.y + Math.sin(a) * c, is.kind === 'rock' ? 3 + r() * 3 : 1.5 + r() * 1.5);
      }
    }
    for (const [p, ms] of at) {
      const im = new THREE.InstancedMesh(p.geometry, toon({ map: p.map }), ms.length);
      ms.forEach((mx, i) => im.setMatrixAt(i, mx));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      outline(im);
      this.props.push(im);
      this.group.add(im);
    }
  }

  private clear() {
    if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); this.ground = null; }
  }
}

/** The ground's height at a share of her coast radius, near enough to set a prop on. */
function heightOn(is: Island, f: number): number {
  const prof = PROFILE[is.kind];
  for (let k = 0; k < prof.length - 1; k++) {
    const [fa, ha, aa] = prof[k], [fb, hb, ab] = prof[k + 1];
    if (f <= fa && f >= fb) {
      const t = (fa - f) / (fa - fb || 1);
      return (ha + (hb - ha) * t) * is.peak + aa + (ab - aa) * t;
    }
  }
  return is.peak;
}

/** The props file's palms, rocks and crate, each set on its base and a metre tall. */
export function propsFrom(scene: THREE.Object3D, turn: number): Partial<Record<PropKind, Prop[]>> {
  scene.updateMatrixWorld(true);
  const O = new THREE.Matrix4().makeRotationY((turn * Math.PI) / 2);
  const out: Partial<Record<PropKind, Prop[]>> = {};
  for (const node of scene.children) {
    const kind: PropKind | null = /^palm/i.test(node.name) ? 'palm' : /^rock/i.test(node.name) ? 'rock' : /^crate/i.test(node.name) ? 'crate' : null;
    if (!kind) continue;
    const geos: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null;
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      map ??= ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial).map ?? null;
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const a = mesh.geometry.getAttribute(name);
        if (!a) continue;
        const arr = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent(i, j);
        g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      }
      if (mesh.geometry.index) g.setIndex(Array.from(mesh.geometry.index.array));
      // into the node's own frame, so the prop stands where the node does, not where it was laid out
      g.applyMatrix4(O.clone().multiply(new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(mesh.matrixWorld)));
      geos.push(g);
    });
    if (!geos.length) continue;
    const g = geos.length > 1 ? mergeGeometries(geos) ?? geos[0] : geos[0];
    g.computeBoundingBox();
    const b = g.boundingBox!, h = Math.max(1e-3, b.max.y - b.min.y);
    g.translate(0, -b.min.y, 0);
    g.scale(1 / h, 1 / h, 1 / h);
    (out[kind] ??= []).push({ geometry: g, map });
  }
  return out;
}
