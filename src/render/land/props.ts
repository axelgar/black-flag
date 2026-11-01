// Land from files. A set of buildings, trees and rocks modelled by hand (or bought) and
// exported as one GLB dresses the islands in place of what this code grows and builds:
// where a kind has a model, every one of that kind is drawn from it, and where it has
// none, from code as before. One file for the whole set, so its parts share their
// textures: a texture is sent once and held on the GPU once, however many props use it.
//
// What a set must hold, in short (PLANS/ART_BRIEF.md has it at length):
//
//   Metres, +Y up. Each prop is a top-level node (an object, or an empty with its parts
//   under it), known by the first word of its name; the rest of the name tells variants
//   apart: house_a, house_b, palm_2, rock_tall (Blender's .001 endings are no matter). A
//   node whose name this doesn't know is looked through for props under it.
//
//     house, shack, warehouse, tavern, church, governor
//              Nassau's lots. Front (door, street side) toward +Z, the origin on the ground
//              floor. Each lot takes the variant nearest its size, scaled by up to a
//              quarter either way to fill it
//     fort, lighthouse
//              set down as made: seaward toward +Z, the origin where it meets the ground
//     palm     leaning toward +Z, the foot of its trunk at the origin; set 8 m tall
//     tree     a hardwood, its foot at the origin; set 8.5 m tall
//     bush, canopy
//              a clump of leaves (canopy: the jungle's crowns, packed over the hills); set
//              2.4 m across, and sized by the game from there
//     rock     set 2.2 m across, and sized from there: a stone in the surf to a crag
//
//   Inside a prop:
//     flag_…           an empty at the top of a flagstaff: the black flies from it
//     light            the lighthouse's lamp, where its beam turns
//     leaf_…, frond_…  leaves, which flutter; without any, a tree's top flutters by height
//     an emissive material is a lit window or lantern: dim by day, bright at dusk
//
// Every prop set down on one island is an instance of one draw per material, culled with
// her; palms, trees and leaves sway in the wind as the code ones do.

import * as THREE from 'three';
import type { PropSet } from '../../data/types';
import { flat } from '../ships/gltf';
import { lampGlow, lit, shipTime } from '../ships/materials';
import type { LotKind } from './nassau';

export type PropKind = LotKind | 'fort' | 'lighthouse' | 'palm' | 'tree' | 'bush' | 'canopy' | 'rock';

interface Fit {
  /** Sized to a height or a width in metres, fitted to its lot, or set down as made. */
  by: 'height' | 'width' | 'lot' | 'made';
  size?: number;
  /** Where its foot goes once sized: the code shape's, which is placed the same way. */
  base?: number;
  /** Centred across the ground on its own box, rather than on the origin it was made round. */
  centre?: boolean;
  /** Turned a quarter, so the way it leans (+Z) is the code palm's (+x). */
  lean?: boolean;
  /** How the wind moves it, if it does. */
  sway?: 'palm' | 'tree' | 'leaves';
}

const LOT: Fit = { by: 'lot', centre: true };
const FIT: Record<PropKind, Fit> = {
  house: LOT, shack: LOT, warehouse: LOT, tavern: LOT, church: LOT, governor: LOT,
  fort: { by: 'made' }, lighthouse: { by: 'made' },
  palm: { by: 'height', size: 8, base: 0, lean: true, sway: 'palm' },
  tree: { by: 'height', size: 8.5, base: 0, sway: 'tree' },
  bush: { by: 'width', size: 2.4, base: -0.35, centre: true, sway: 'leaves' },
  canopy: { by: 'width', size: 2.4, base: -0.35, centre: true, sway: 'leaves' },
  rock: { by: 'width', size: 2.2, base: -0.45, centre: true },
};

const KINDS: Record<string, PropKind> = {
  house: 'house', shack: 'shack', hut: 'shack', warehouse: 'warehouse', tavern: 'tavern', church: 'church',
  governor: 'governor', fort: 'fort', lighthouse: 'lighthouse', palm: 'palm', palms: 'palm', tree: 'tree', trees: 'tree',
  bush: 'bush', bushes: 'bush', shrub: 'bush', canopy: 'canopy', rock: 'rock', rocks: 'rock', boulder: 'rock',
};
const LEAVES = new Set(['leaf', 'leaves', 'frond', 'fronds', 'foliage']);
const FLAG = new Set(['flag', 'flags', 'ensign']);
const LIGHT = new Set(['light', 'lamp']);

const first = (name: string) => (name.toLowerCase().split(/[^a-z0-9]+/).find(Boolean) ?? '').replace(/\d+$/, '');
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ kit --- */

export interface Prop {
  kind: PropKind;
  name: string;
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material; sway: boolean }[];
  /** Its box once sized, in its own frame: a lot reads its footprint from this. */
  box: THREE.Box3;
  /** Where its flags fly from. */
  flags: THREE.Vector3[];
  /** Where a lighthouse's beam turns. */
  light: THREE.Vector3 | null;
}

/** Every prop in every set, by kind. */
export type PropKit = Map<PropKind, Prop[]>;

/** The props in loaded sets, each baked once and shared by every island. */
export function propKit(files: { set: PropSet; scene: THREE.Object3D }[]): PropKit {
  const kit: PropKit = new Map();
  for (const { set, scene } of files) {
    scene.updateMatrixWorld(true);
    const found: [THREE.Object3D, PropKind][] = [];
    const look = (o: THREE.Object3D) => {
      for (const c of o.children) { const k = KINDS[first(c.name)]; if (k) found.push([c, k]); else look(c); }
    };
    look(scene);
    for (const [node, kind] of found) {
      const p = bakeProp(node, kind, set);
      if (p.parts.length) kit.set(kind, [...(kit.get(kind) ?? []), p]);
    }
  }
  return kit;
}

/** One prop, into its own frame and sized for its kind, merged one geometry per material. */
export function bakeProp(root: THREE.Object3D, kind: PropKind, set: PropSet): Prop {
  const fit = FIT[kind];
  root.updateMatrixWorld(true);
  // where the set laid it out is no matter; how it was turned and scaled is
  const at = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  const k = set.scale ?? 1;
  const O = new THREE.Matrix4().makeRotationY((((fit.lean ? 1 : 0) + (set.turn ?? 0)) * Math.PI) / 2)
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));

  const pieces: { g: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4; leaf: boolean }[] = [];
  const marks: { flag: boolean; at: THREE.Vector3 }[] = [];
  const box = new THREE.Box3(), b = new THREE.Box3();
  root.traverseVisible((o) => {
    let leaf = false, flagged = false;
    for (let n: THREE.Object3D | null = o; n && n !== root.parent; n = n.parent) {
      const w = first(n.name);
      if (FLAG.has(w)) flagged = true;
      if (LEAVES.has(w)) leaf = true;
    }
    // a marker's origin is all that is read of it, and a flag modelled on one is not drawn
    const own = first(o.name);
    if (FLAG.has(own) || LIGHT.has(own)) marks.push({ flag: FLAG.has(own), at: new THREE.Vector3().setFromMatrixPosition(O.clone().multiply(o.matrixWorld)) });
    if (flagged) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const m = O.clone().multiply(mesh.matrixWorld);
    const g = mesh.geometry;
    if (g.groups.length && mats.length > 1) {
      for (const gr of g.groups) pieces.push({ g: slice(g, gr.start, gr.count), mat: mats[gr.materialIndex ?? 0], m, leaf });
    } else {
      pieces.push({ g, mat: mats[0], m, leaf });
    }
    g.computeBoundingBox();
    box.union(b.copy(g.boundingBox!).applyMatrix4(m));
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));

  // sized and set down for its kind
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const s = fit.by === 'height' ? fit.size! / Math.max(size.y, 1e-6)
    : fit.by === 'width' ? fit.size! / Math.max(size.x, size.z, 1e-6) : 1;
  const dx = fit.centre ? -mid.x * s : 0, dz = fit.centre ? -mid.z * s : 0;
  const dy = fit.base !== undefined ? fit.base - box.min.y * s : 0;
  const N = new THREE.Matrix4().makeTranslation(dx, dy, dz).multiply(new THREE.Matrix4().makeScale(s, s, s));

  const out = new THREE.Box3(
    new THREE.Vector3(box.min.x * s + dx, box.min.y * s + dy, box.min.z * s + dz),
    new THREE.Vector3(box.max.x * s + dx, box.max.y * s + dy, box.max.z * s + dz));
  const H = Math.max(out.max.y, 1e-6);
  const R = Math.max(-out.min.x, out.max.x, -out.min.z, out.max.z, 1e-6);

  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of pieces) {
    const vc = !!(p.mat as THREE.MeshStandardMaterial).vertexColors;
    const keep = ['position', 'normal', ...(p.g.getAttribute('uv') ? ['uv'] : []), ...(vc ? ['color'] : [])];
    const g = flat(p.g, N.clone().multiply(p.m), keep);
    if (fit.sway) g.setAttribute('aSway', sway(g, fit.sway, p.leaf, H, R));
    groups.set(p.mat, [...(groups.get(p.mat) ?? []), g]);
  }
  const parts: Prop['parts'] = [];
  for (const [material, list] of groups) {
    // one layout for all: a piece without uvs (or colours) where another has them gets zeros
    const names = new Set(list.flatMap((g) => Object.keys(g.attributes)));
    for (const g of list) for (const n of names) if (!g.getAttribute(n)) {
      const like = list.find((o) => o.getAttribute(n))!.getAttribute(n);
      g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * like.itemSize), like.itemSize));
    }
    const geometry = list.length > 1 ? mergeAll(list) : list[0];
    parts.push({ geometry, material, sway: !!fit.sway });
  }

  const flags = marks.filter((m) => m.flag).map((m) => m.at.applyMatrix4(N));
  const lamp = marks.find((m) => !m.flag);
  const light = kind === 'lighthouse'
    ? lamp ? lamp.at.applyMatrix4(N) : new THREE.Vector3((out.min.x + out.max.x) / 2, out.max.y - 2, (out.min.z + out.max.z) / 2)
    : null;
  return { kind, name: root.name, parts, box: out, flags, light };
}

/** One draw-group of a geometry, as a geometry of its own. */
function slice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = g.clone();
  if (g.index) out.setIndex(Array.from(g.index.array.slice(start, start + count)));
  else out.setIndex(Array.from({ length: count }, (_, i) => start + i));
  out.clearGroups();
  return out;
}

/** Geometries of one layout as one, their indices offset. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const total = list.reduce((n, g) => n + g.getAttribute('position').count, 0);
  for (const name of Object.keys(list[0].attributes)) {
    const size = list[0].getAttribute(name).itemSize, arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) { const a = g.getAttribute(name); arr.set(a.array as Float32Array, o); o += a.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx: number[] = [];
  let base = 0;
  for (const g of list) { for (const i of g.index!.array) idx.push(base + i); base += g.getAttribute('position').count; g.dispose(); }
  out.setIndex(idx);
  return out;
}

/** Per vertex, how the wind moves it, as the code plants' `aSway` (its phase comes from
 *  where each one stands): how far it sways, and how much it flutters. A palm bends from
 *  its foot and its fronds flutter toward their tips; a hardwood barely bends and its crown
 *  flutters; a clump of leaves only flutters. */
function sway(g: THREE.BufferGeometry, how: 'palm' | 'tree' | 'leaves', leaf: boolean, H: number, R: number): THREE.BufferAttribute {
  const p = g.getAttribute('position'), out = new Float32Array(p.count * 3);
  const step = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    const h = clamp(p.getY(i) / H, 0, 1), r = clamp(Math.hypot(p.getX(i), p.getZ(i)) / R, 0, 1);
    let s: number, f: number;
    if (how === 'palm') { s = 1.2 * h * h; f = leaf ? r : step(0.62, 1, h) * r; if (leaf) s = Math.max(s, 1); }
    else if (how === 'tree') { s = 0.25 * h; f = leaf ? 0.35 : 0.35 * step(0.45, 0.8, h); }
    else { s = 0.08; f = 0.35; }
    out.set([0, s, f], i * 3);
  }
  return new THREE.BufferAttribute(out, 3);
}

/* ----------------------------------------------------------- materials --- */

const mats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A set's own material, taught the land's ways: its emissive parts (windows, lanterns) are
 * dim by day and bright at dusk, as Nassau's are; a blended one is cut out instead, so it
 * can be drawn in one with everything else and writes its depth; and one that sways is
 * moved by the wind once it stands where it is, so the wind blows one way across the
 * island however each was turned. Shared by every island.
 */
export function propMaterial(src: THREE.Material, swaying: boolean, a2c: boolean): THREE.MeshStandardMaterial {
  const key = `${src.uuid}:${swaying}:${a2c}`;
  let m = mats.get(key);
  if (m) return m;
  m = src instanceof THREE.MeshStandardMaterial ? src.clone() : lit(src);
  if (m.transparent || m.alphaTest > 0) {
    m.transparent = false;
    m.depthWrite = true;
    // as the code plants: alpha-to-coverage where the picture is multisampled, else a cut-out
    m.alphaToCoverage = a2c;
    m.alphaTest = a2c ? 0 : Math.max(m.alphaTest, 0.42);
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: shipTime, uLamp: lampGlow });
    if (swaying) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSway;\nuniform float uTime;')
        .replace('#include <project_vertex>', /* glsl */ `vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
float ph = uTime + instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
#else
float ph = uTime;
#endif
vec3 wind = vec3(0.82, 0.0, 0.57);
float sway = aSway.y * (sin(ph * 0.9) * 0.22 + sin(ph * 2.3 + 1.7) * 0.06);
float flutter = aSway.z * sin(ph * 5.7 + mvPosition.y * 1.7 + mvPosition.x) * 0.16;
mvPosition.xyz += wind * (sway + flutter) + vec3(0.0, flutter * 0.7, 0.0);
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLamp;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uLamp * 1.5;');
  };
  m.customProgramCacheKey = () => `bf-prop${swaying ? '-sway' : ''}`;
  mats.set(key, m);
  return m;
}

/* ---------------------------------------------------------------- dress --- */

/** A cheap, steady number in [0, 1) from where something stands. */
const hash = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * One island's props: the code that lays her out offers each thing it would build or
 * grow here, and is told whether a model has taken it. Then built, one instanced draw per
 * prop and material.
 */
export class Dress {
  /** Where the props' flags fly from, in the world. */
  readonly flags: THREE.Vector3[] = [];
  private placed = new Map<Prop, { m: THREE.Matrix4[]; shade: number[] }>();
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private kit: PropKit) {}

  has(kind: PropKind) { return !!this.kit.get(kind)?.length; }

  /** A plant or a rock at `m` (as the code shape would be placed), its variant picked by
   *  where it stands. `shade` darkens it: a reef's rocks are wet. */
  put(kind: PropKind, m: THREE.Matrix4, shade = 1): boolean {
    const list = this.kit.get(kind);
    if (!list?.length) return false;
    const e = m.elements;
    this.add(list[Math.floor(hash(e[12], e[14]) * list.length)], m, shade * (0.88 + 0.24 * hash(e[14], e[12])));
    return true;
  }

  /** A building on a lot `w` along its front and `d` deep, in the lot's `frame` (its door
   *  toward +z): the variant nearest the lot's size, give or take a little at random so a
   *  street isn't all one house, scaled to fill it. */
  fit(kind: PropKind, frame: THREE.Matrix4, w: number, d: number): boolean {
    const list = this.kit.get(kind);
    if (!list?.length) return false;
    const e = frame.elements;
    let best = list[0], bestS = 1, score = Infinity;
    list.forEach((p, i) => {
      const sz = p.box.getSize(new THREE.Vector3());
      const s = Math.min(w / Math.max(sz.x, 1e-6), d / Math.max(sz.z, 1e-6));
      const v = Math.abs(Math.log(s)) + hash(e[12] + i * 7.1, e[14]) * 0.3;
      if (v < score) { score = v; best = p; bestS = clamp(s, 0.8, 1.25); }
    });
    this.add(best, frame.clone().multiply(new THREE.Matrix4().makeScale(bestS, bestS, bestS)), 1);
    return true;
  }

  /** A one-off (the fort, the light) in its `frame`, seaward toward +z. Where its beam
   *  turns, for a lighthouse; null if there is no model of it. */
  stand(kind: PropKind, frame: THREE.Matrix4): { light: THREE.Vector3 | null } | null {
    const list = this.kit.get(kind);
    if (!list?.length) return null;
    const p = list[0];
    this.add(p, frame, 1);
    return { light: p.light ? p.light.clone().applyMatrix4(frame) : null };
  }

  private add(p: Prop, m: THREE.Matrix4, shade: number) {
    const e = this.placed.get(p) ?? { m: [], shade: [] };
    e.m.push(m.clone());
    e.shade.push(shade);
    this.placed.set(p, e);
    for (const f of p.flags) this.flags.push(f.clone().applyMatrix4(m));
  }

  get count() { let n = 0; for (const e of this.placed.values()) n += e.m.length; return n; }

  /** Her props as instanced draws; null if nothing was set down. */
  build(shadows: boolean, a2c: boolean): THREE.Group | null {
    if (!this.placed.size) return null;
    const group = new THREE.Group();
    const c = new THREE.Color();
    for (const [p, e] of this.placed) {
      for (const part of p.parts) {
        const im = new THREE.InstancedMesh(part.geometry, propMaterial(part.material, part.sway, a2c), e.m.length);
        e.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(e.shade[i])); });
        im.computeBoundingSphere();
        im.castShadow = shadows;
        im.receiveShadow = shadows;
        im.name = p.name;
        group.add(im);
        this.meshes.push(im);
      }
    }
    return group;
  }

  /** Geometry and materials are the kit's, kept for the next chart; only the instances go. */
  dispose() { for (const m of this.meshes) m.dispose(); this.meshes = []; }
}
