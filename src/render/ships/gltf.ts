// Ships from files. A ship modelled by hand (in Blender, or bought) and exported as a GLB
// is drawn by this in place of the one her recipe would loft, behind the same ShipModel,
// so the view cannot tell them apart.
//
// What a file must hold, in short (PLANS/ART_BRIEF.md has it at length):
//
//   Metres, +Y up, her bow along +Z (glTF's forward). `turn` in her ModelFile puts right a
//   file that faces another way, and she is scaled to her recipe's length whatever units
//   she was made in. She is centred on her own box, fore and aft and athwartships; `lift`
//   says where her waterline is if it is not level with the file's origin.
//
//   Her parts are known by the first word of a node's name, or of the nearest node above
//   it that has a word this knows (Blender's .001 endings are no matter):
//     sail, canvas            canvas: flogs as the wind goes out of her, rags as she is shot
//     rope, rigging, line, shroud, stay, ratline
//                             rigging: dropped when she is too far off for a line to show
//     flag, ensign, pennant   not drawn: her colours fly in their place, from the top fore
//                             corner of its box and as big as it, so she can strike them
//     lid_L_n, lid_R_n        a gun-port lid, each its own node with its origin on its
//                             hinge (fore and aft, along the top of the port). L is
//                             larboard: her left, looking forward
//     gun_L_n, cannon_R_n     a gun, run out through her port, and in when she fires
//     muzzle_L_n, muzzle_R_n  an empty at a gun's mouth, where her shot leaves from;
//                             without them it leaves from where her recipe's guns are
//     anything else           her hull, timber and fittings
//
// Geometry is baked into her own frame (x forward, y up, z starboard), merged into one draw
// per material and kind, and shared by every ship sailing the same file; each ship owns
// only her materials. Files load in the background, and until one is here (or if it never
// comes) the view draws her from her recipe.

import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlagKind, HullRecipe, ModelFile } from '../../data/types';
import { flagTexture } from './flags';
import { buntingMaterial, modelMaterial, modelUniforms, type ModelUniforms } from './materials';
import { LOD } from './mesh';
import { bunting, pennants, recipeGuns, type Flag } from './procedural';
import type { ShipModel, ShipPose } from './ShipModel';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** How far a gun from a file runs out through her port, in metres. */
const RUN = 0.9;

/* -------------------------------------------------------------- loading --- */

let renderer: THREE.WebGLRenderer | null = null;
let loader: Promise<GLTFLoader> | null = null;
const fetching = new Map<string, Promise<THREE.Object3D>>();
const loaded = new Map<string, THREE.Object3D>();

/** The renderer files are read for: their textures are transcoded to what its GPU reads. */
export function shipFiles(r: THREE.WebGLRenderer) { renderer = r; }

/** Fetch a model file (a ship's, or a set of land's), once. One that fails stays failed:
 *  what it would have drawn is drawn from code. The reader itself (files.ts) is fetched
 *  with the first. */
export function loadFile(url: string): Promise<THREE.Object3D> {
  let p = fetching.get(url);
  if (!p) {
    const r = renderer;
    if (!r) return Promise.reject(new Error('shipFiles() has not been called'));
    loader ??= import('./files').then((m) => m.loaderFor(r));
    p = loader.then((l) => l.loadAsync(url)).then((g) => { loaded.set(url, g.scene); return g.scene; });
    fetching.set(url, p);
  }
  return p;
}

/* ------------------------------------------------------------------ kit --- */

export interface Part {
  kind: 'solid' | 'sail' | 'rope';
  geometry: THREE.BufferGeometry;
  /** The file's own material, which each ship clones and teaches. */
  material: THREE.Material;
}

/** A file, baked for one recipe: everything every ship sailing it shares. */
export interface FileKit {
  parts: Part[];
  /** Her guns' mouths, larboard then starboard; null if the file does not say. */
  muzzles: [THREE.Vector3[], THREE.Vector3[]] | null;
  flags: THREE.BufferGeometry | null;
  pennants: THREE.BufferGeometry | null;
  /** Her tallest truck above the water. */
  height: number;
}

const kits = new Map<string, FileKit>();

/** Her file, baked for her recipe, once it has loaded; null until then. */
export function shipKit(f: ModelFile, R: HullRecipe): FileKit | null {
  const scene = loaded.get(f.url);
  if (!scene) return null;
  const key = JSON.stringify([f, R.length, R.palette.trim]);
  let k = kits.get(key);
  if (!k) { k = bake(scene, f, R); kits.set(key, k); }
  return k;
}

type Kind = 'solid' | 'sail' | 'rope' | 'flag' | 'pennant' | 'lid' | 'gun' | 'muzzle';

const WORDS: Record<string, Kind> = {
  sail: 'sail', sails: 'sail', canvas: 'sail',
  rope: 'rope', ropes: 'rope', rigging: 'rope', rig: 'rope', line: 'rope', lines: 'rope',
  shroud: 'rope', shrouds: 'rope', stay: 'rope', stays: 'rope', ratline: 'rope', ratlines: 'rope',
  flag: 'flag', flags: 'flag', ensign: 'flag', pennant: 'pennant', pennants: 'pennant',
  lid: 'lid', lids: 'lid', gun: 'gun', guns: 'gun', cannon: 'gun', cannons: 'gun', muzzle: 'muzzle',
};

interface Role { kind: Kind; side: -1 | 0 | 1; node: THREE.Object3D }

/** What a node is: by the first word of its name, or of the nearest node above it with a
 *  word this knows. A lid, gun or muzzle that names no side is only a fitting. */
function roleOf(o: THREE.Object3D, top: THREE.Object3D): Role {
  for (let n: THREE.Object3D | null = o; n && n !== top; n = n.parent) {
    const words = n.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const kind = words.length ? WORDS[words[0].replace(/\d+$/, '')] : undefined;
    if (!kind) continue;
    const side = words[1] === 'l' ? -1 : words[1] === 'r' ? 1 : 0;
    if ((kind === 'lid' || kind === 'gun' || kind === 'muzzle') && !side) return { kind: 'solid', side: 0, node: o };
    return { kind, side, node: n };
  }
  return { kind: 'solid', side: 0, node: o };
}

interface Piece { geometry: THREE.BufferGeometry; material: THREE.Material; role: Role; m: THREE.Matrix4 }

/**
 * Bake a file for a recipe: every mesh into her own frame, scaled to her length, sorted by
 * what it is, and merged. Reads the file's scene and never changes it, so one file can be
 * baked for any number of recipes.
 */
export function bake(scene: THREE.Object3D, f: ModelFile, R: HullRecipe): FileKit {
  scene.updateMatrixWorld(true);
  // the file's +Z (her bow, once turned) to her x; its -X, her starboard, to her z
  const O = new THREE.Matrix4().makeRotationY(((1 + (f.turn ?? 0)) * Math.PI) / 2);
  const pieces: Piece[] = [];
  const marks: { side: -1 | 1; at: THREE.Vector3 }[] = [];
  const box = new THREE.Box3(), b = new THREE.Box3();
  const inst = new THREE.Matrix4();

  scene.traverseVisible((o) => {
    const role = roleOf(o, scene);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const g = mesh.geometry;
      // a file can place one mesh many times over (a row of guns, say): each is a piece
      const im = mesh as THREE.InstancedMesh;
      for (let i = 0; i < (im.isInstancedMesh ? im.count : 1); i++) {
        const m = O.clone().multiply(mesh.matrixWorld);
        if (im.isInstancedMesh) { im.getMatrixAt(i, inst); m.multiply(inst); }
        if (g.groups.length && mats.length > 1) {
          for (const gr of g.groups) pieces.push({ geometry: slice(g, gr.start, gr.count), material: mats[gr.materialIndex ?? 0], role, m });
        } else {
          pieces.push({ geometry: g, material: mats[0], role, m });
        }
        if (role.kind !== 'flag' && role.kind !== 'pennant') {
          g.computeBoundingBox();
          box.union(b.copy(g.boundingBox!).applyMatrix4(m));
        }
      }
    } else if (role.kind === 'muzzle' && role.node === o && role.side) {
      marks.push({ side: role.side, at: new THREE.Vector3().setFromMatrixPosition(O.clone().multiply(o.matrixWorld)) });
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));

  // scaled to her length, centred on her box, and her waterline at y = 0
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const s = f.scale ?? R.length / Math.max(size.x, 1e-6);
  const lift = f.lift ?? 0;
  const F = new THREE.Matrix4().makeTranslation(-mid.x * s, lift, -mid.z * s).multiply(new THREE.Matrix4().makeScale(s, s, s));
  const place = (v: THREE.Vector3) => v.applyMatrix4(F);

  // everything but the colours, by kind and material
  const groups = new Map<string, { kind: Part['kind']; material: THREE.Material; list: { g: THREE.BufferGeometry; role: Role; m: THREE.Matrix4 }[] }>();
  const colours = new Map<THREE.Object3D, { box: THREE.Box3; pennant: boolean }>();
  for (const p of pieces) {
    const m = F.clone().multiply(p.m);
    if (p.role.kind === 'flag' || p.role.kind === 'pennant') {
      p.geometry.computeBoundingBox();
      const c = colours.get(p.role.node) ?? { box: new THREE.Box3(), pennant: p.role.kind === 'pennant' };
      c.box.union(b.copy(p.geometry.boundingBox!).applyMatrix4(m));
      colours.set(p.role.node, c);
      continue;
    }
    const kind: Part['kind'] = p.role.kind === 'sail' ? 'sail' : p.role.kind === 'rope' ? 'rope' : 'solid';
    const key = `${kind}:${p.material.uuid}`;
    const gr = groups.get(key) ?? { kind, material: p.material, list: [] };
    gr.list.push({ g: p.geometry, role: p.role, m });
    groups.set(key, gr);
  }

  const parts: Part[] = [];
  for (const gr of groups.values()) {
    const vc = !!(gr.material as THREE.MeshStandardMaterial).vertexColors;
    const has = (name: string) => gr.list.some((e) => !!e.g.getAttribute(name));
    const keep = ['position', 'normal', ...(has('uv') ? ['uv'] : []), ...(has('uv1') ? ['uv1'] : []), ...(vc ? ['color'] : [])];
    const anim = gr.kind === 'solid' && gr.list.some((e) => e.role.kind === 'lid' || e.role.kind === 'gun');
    const geos = gr.list.map((e) => {
      const g = flat(e.g, e.m, keep);
      if (anim) g.setAttribute('aAnim', animOf(g, e.role, F.clone().multiply(O)));
      if (gr.kind === 'sail') g.setAttribute('aSail', freedom(g));
      return g;
    });
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (merged) {
      parts.push({ kind: gr.kind, geometry: merged, material: gr.material });
      if (geos.length > 1) for (const g of geos) g.dispose();
    } else {
      for (const g of geos) parts.push({ kind: gr.kind, geometry: g, material: gr.material });
    }
  }

  // her colours fly from the top fore corner of each flag's box, and are as big as it
  const flags: Flag[] = [], pens: { at: THREE.Vector3; len: number; w: number; ph: number }[] = [];
  let ph = 0;
  for (const c of colours.values()) {
    const sz = c.box.getSize(new THREE.Vector3());
    const at = new THREE.Vector3(c.box.max.x, c.box.max.y, (c.box.min.z + c.box.max.z) / 2);
    const w = Math.max(0.6, sz.x, sz.z), h = Math.max(0.4, sz.y);
    if (c.pennant) pens.push({ at, len: w, w: Math.min(h, w * 0.12), ph: 2.3 + ph });
    else flags.push({ at, w, h, ph });
    ph += 1.7;
  }

  const muzzles: FileKit['muzzles'] = marks.length
    ? [marks.filter((k) => k.side === -1).map((k) => place(k.at)), marks.filter((k) => k.side === 1).map((k) => place(k.at))]
    : null;

  return {
    parts,
    muzzles,
    flags: flags.length ? bunting(flags) : null,
    pennants: pens.length ? pennants(pens, R.palette.trim) : null,
    height: box.max.y * s + lift,
  };
}

/** One draw-group of a geometry, as a geometry of its own. */
function slice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = g.clone();
  if (g.index) out.setIndex(Array.from(g.index.array.slice(start, start + count)));
  else out.setIndex(Array.from({ length: count }, (_, i) => start + i));
  out.clearGroups();
  return out;
}

/** A geometry as plain floats in her own frame, with exactly the attributes in `keep` and
 *  an index. Quantized and interleaved attributes (a compressed file's) are read back out
 *  to floats first: baking a transform into int16s would clip her. */
export function flat(g: THREE.BufferGeometry, m: THREE.Matrix4, keep: string[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const n = g.getAttribute('position').count;
  for (const name of keep) {
    const a = g.getAttribute(name);
    const size = name === 'position' || name === 'normal' || name === 'color' ? 3 : 2;
    const arr = new Float32Array(n * size);
    if (a) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[i * size + c] = c < a.itemSize ? a.getComponent(i, c) : 0;
    else if (name === 'color') arr.fill(1);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
  // a mirrored node turns her faces inside out unless they are wound the other way round
  if (m.determinant() < 0) for (let i = 0; i + 2 < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  out.setIndex(idx);
  if (!g.getAttribute('normal')) out.deleteAttribute('normal');
  out.applyMatrix4(m);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** Per vertex, what the shader moves, as the timber's `aAnim`: 1 for a lid, with its side
 *  and its hinge (y, z) in her frame; 2 for a gun, with its side and how far it runs out;
 *  0 for everything that keeps still. `toHer` takes the file's world to her frame. */
function animOf(g: THREE.BufferGeometry, role: Role, toHer: THREE.Matrix4): THREE.BufferAttribute {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 4);
  if (role.kind === 'lid' || role.kind === 'gun') {
    const hinge = new THREE.Vector3().setFromMatrixPosition(toHer.clone().multiply(role.node.matrixWorld));
    const v = role.kind === 'lid' ? [1, role.side, hinge.y, hinge.z] : [2, role.side, RUN, 0];
    for (let i = 0; i < n; i++) a.set(v, i * 4);
  }
  return new THREE.BufferAttribute(a, 4);
}

/** How far each point of a sail is free to move, in metres: nothing at the edges of her
 *  box across its two widest ways, most at its middle, scaled by how big she is. */
function freedom(g: THREE.BufferGeometry): THREE.BufferAttribute {
  g.computeBoundingBox();
  const bb = g.boundingBox!, size = bb.getSize(new THREE.Vector3());
  const axes = [0, 1, 2].sort((i, j) => size.getComponent(j) - size.getComponent(i));
  const [a, c] = axes;
  const span = Math.min(size.getComponent(a), size.getComponent(c));
  const p = g.getAttribute('position'), n = p.count, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (p.getComponent(i, a) - bb.min.getComponent(a)) / Math.max(size.getComponent(a), 1e-6);
    const v = (p.getComponent(i, c) - bb.min.getComponent(c)) / Math.max(size.getComponent(c), 1e-6);
    out[i] = Math.sin(Math.PI * clamp(u, 0, 1)) * Math.sin(Math.PI * clamp(v, 0, 1)) * span;
  }
  return new THREE.BufferAttribute(out, 1);
}

/* ---------------------------------------------------------------- ship ---- */

export class GltfShip implements ShipModel {
  root = new THREE.Group();
  len: number; beam: number; height: number;
  private u: ModelUniforms = modelUniforms();
  private mats: THREE.MeshStandardMaterial[] = [];
  private solid: THREE.MeshStandardMaterial[] = [];
  private bodies: THREE.Mesh[] = [];
  private ropes: THREE.Mesh[] = [];
  private flag: THREE.Mesh | null = null;
  private pennant: THREE.Mesh | null = null;
  private flagKind: FlagKind;
  private muzzles: [THREE.Vector3[], THREE.Vector3[]];
  private tatter: number;
  private lastT = -1;
  private lids = 0;
  private lidsWant = 0;
  private run: [number, number] = [0, 0];

  constructor(K: FileKit, R: HullRecipe) {
    this.len = R.length; this.beam = R.beam; this.height = K.height;
    this.flagKind = R.flag;
    this.tatter = R.tatter ?? 0;
    this.root.rotation.order = 'YZX';
    for (const p of K.parts) {
      const mat = modelMaterial(p.material, p.kind === 'sail' ? 'sail' : 'solid', this.u);
      this.mats.push(mat);
      if (p.kind !== 'sail') this.solid.push(mat);
      const mesh = new THREE.Mesh(p.geometry, mat);
      (p.kind === 'rope' ? this.ropes : this.bodies).push(mesh);
      this.root.add(mesh);
    }
    if (K.flags) {
      this.flag = new THREE.Mesh(K.flags, buntingMaterial(this.flagKind, flagTexture(this.flagKind)));
      this.root.add(this.flag);
    }
    if (K.pennants) {
      this.pennant = new THREE.Mesh(K.pennants, buntingMaterial('pennant', null));
      this.root.add(this.pennant);
    }
    if (K.muzzles) this.muzzles = K.muzzles;
    else {
      const g = recipeGuns(R);
      this.muzzles = [g.filter((x) => x.side === -1).map((x) => x.muzzle), g.filter((x) => x.side === 1).map((x) => x.muzzle)];
    }
  }

  gunPorts(side: -1 | 1) { return this.muzzles[side === -1 ? 0 : 1]; }

  pose(p: ShipPose) {
    const dt = this.lastT < 0 ? 0 : clamp(p.t - this.lastT, 0, 0.1);
    this.lastT = p.t;
    this.root.position.set(p.x, p.heave, p.z);
    this.root.rotation.set(p.roll, -p.h, p.pitch);

    const u = this.u;
    u.uFill.value += (p.fill - u.uFill.value) * Math.min(1, dt * 5);
    u.uTatter.value = Math.min(0.7, this.tatter + Math.pow(p.damage, 1.3) * 0.5);
    u.uScorch.value = clamp(p.damage * 1.05, 0, 1);
    if (this.flag) {
      const want: FlagKind = p.struck ? 'white' : this.flagKind;
      const fm = buntingMaterial(want, flagTexture(want));
      if (this.flag.material !== fm) this.flag.material = fm;
    }

    // as a lofted ship's: ports open and guns run out slowly, and snap back when she fires
    this.lids += clamp(this.lidsWant - this.lids, -dt * 1.4, dt * 1.4);
    for (let i = 0; i < 2; i++) {
      const out = this.lids > 0.85 ? 1 : 0;
      this.run[i] = Math.min(this.lids, this.run[i] + (out - this.run[i] > 0 ? dt * 0.7 : -dt * 2));
    }
    const ease = (v: number) => v * v * (3 - 2 * v);
    u.uPorts.value.set(ease(this.lids), ease(this.lids), ease(this.run[0]), ease(this.run[1]));
  }

  ready(on: boolean) { this.lidsWant = on ? 1 : 0; }

  fired(side: -1 | 1) { this.run[side === -1 ? 0 : 1] = 0; }

  /** A file's ports have no light in them to show; they open, which is the tell. */
  portsOpen(_side: -1 | 1, open: boolean) { if (open) this.lidsWant = 1; }

  detail(distance: number) {
    for (const r of this.ropes) r.visible = distance < (LOD.lo ? 260 : 520) && this.faded > 0.55;
    if (this.pennant) this.pennant.visible = this.faded > 0.35 && (!LOD.lo || distance < 420);
  }

  private faded = 1;
  fade(k: number) {
    if (k === this.faded) return;
    if (k < 1 && this.faded >= 1) {
      for (const m of this.solid) { m.defines = { ...m.defines, BF_FADE: '' }; m.needsUpdate = true; }
    }
    this.faded = k;
    this.u.uFade.value = k;
    if (k <= 0.55) for (const r of this.ropes) r.visible = false;
    if (this.flag) this.flag.visible = k > 0.35;
    if (this.pennant) this.pennant.visible = k > 0.35;
    if (k < 1 && this.bodies[0]?.castShadow) this.setShadows(false);
  }

  fog(k: number) { this.u.uFogK.value = k; }

  setShadows(on: boolean) {
    for (const m of this.bodies) m.castShadow = m.receiveShadow = on;
  }

  dispose() {
    // Geometry is shared through the kit cache; only this ship's own materials go.
    for (const m of this.mats) m.dispose();
  }
}
