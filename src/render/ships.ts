// Every ship on the sea in a handful of draws. Each look's model file is baked once into
// two shapes in her own frame (x forward, y up, z starboard; scaled to the one length
// every ship has, her waterline at y = 0): her hull, and her canvas and colours, which
// are tinted with her captain's colour. Every ship of a look is an instance of those two,
// so thirty ships cost two draws a look, plus one for the shadows and one for the rings.
//
// Nodes named sail… or flag… in the file are her canvas; everything else is hull
// (PLANS/ART_BRIEF.md).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LOOKS } from '../data/ships';
import { TUNING } from '../data/tuning';
import type { ModelFile } from '../data/types';
import { toon } from './toon';

const MAX = 40;

/** A look, baked. */
interface Kit { hull: THREE.InstancedMesh; sail: THREE.InstancedMesh; height: number; n: number }

/** One ship, as the view wants her drawn this frame. */
export interface ShipDraw {
  look: string;
  x: number; y: number; h: number;
  /** Lean, radians: + to starboard. */
  heel: number;
  pitch: number;
  /** Metres above (or, sinking, below) where she floats. */
  lift: number;
  /** 0 hidden .. 1 her full size: she pops up as she comes in. */
  scale: number;
  color: THREE.Color;
  /** Struck: her hull goes red for a moment. 0..1. */
  hit: number;
  /** Her ring: 0 none, 1 a rival's, 2 your own. */
  ring: 0 | 1 | 2;
  /** Can't be hurt: her ring shines white. */
  shine: boolean;
}

/** Read a file's meshes into her own frame, as plain floats: a packed file's are quantized. */
export function bakeFile(scene: THREE.Object3D, f: ModelFile): { hull: THREE.BufferGeometry; sail: THREE.BufferGeometry; map: THREE.Texture | null; height: number } {
  scene.updateMatrixWorld(true);
  // the file's +Z (her bow, once turned) to her +x
  const O = new THREE.Matrix4().makeRotationY(((1 + (f.turn ?? 0)) * Math.PI) / 2);
  const hull: THREE.BufferGeometry[] = [], sail: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    map ??= mat.map ?? null;
    const g = plain(mesh.geometry, O.clone().multiply(mesh.matrixWorld));
    let canvas = false;
    for (let p: THREE.Object3D | null = o; p && p !== scene; p = p.parent) if (/^(sail|flag)/i.test(p.name)) canvas = true;
    (canvas ? sail : hull).push(g);
  });
  const H = mergeGeometries(hull)!, S = sail.length ? mergeGeometries(sail)! : new THREE.BufferGeometry();
  H.computeBoundingBox();
  const box = H.boundingBox!.clone();
  if (S.getAttribute('position')) { S.computeBoundingBox(); box.max.y = Math.max(box.max.y, S.boundingBox!.max.y); }
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const s = TUNING.length / Math.max(size.x, 1e-6);
  const F = new THREE.Matrix4().makeTranslation(-mid.x * s, (f.lift ?? 0) - box.min.y * s, -mid.z * s).multiply(new THREE.Matrix4().makeScale(s, s, s));
  H.applyMatrix4(F);
  if (S.getAttribute('position')) S.applyMatrix4(F);
  return { hull: H, sail: S, map, height: (box.max.y - box.min.y) * s + (f.lift ?? 0) };
}

/** A geometry with only position, normal and uv, as floats, moved by `m`. */
function plain(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv');
  const n = P.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m);
    pos.set([v.x, v.y, v.z], i * 3);
    if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], i * 3); }
    if (U) uv.set([U.getX(i), U.getY(i)], i * 2);
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (g.index) out.setIndex(Array.from(g.index.array));
  if (!N) out.computeVertexNormals();
  return out;
}

const WHITE = new THREE.Color(1, 1, 1);
const HURT = new THREE.Color('#FF5A4A');

export class Fleet {
  readonly group = new THREE.Group();
  private kits = new Map<string, Kit>();
  private shadows: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private own: THREE.Mesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const L = TUNING.length, B = TUNING.beam;
    const blob = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({ color: '#0B2F57', transparent: true, opacity: 0.32, depthWrite: false }), MAX);
    this.shadows.count = 0; this.shadows.frustumCulled = false;
    const ring = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), MAX);
    this.rings.count = 0; this.rings.frustumCulled = false;
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    // your own ship's ring is thicker, and turns
    const own = new THREE.RingGeometry(0.9, 1, 48, 1, 0, Math.PI * 1.7).rotateX(-Math.PI / 2);
    this.own = new THREE.Mesh(own, new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.95, depthWrite: false }));
    this.own.visible = false;
    this.group.add(this.shadows, this.rings, this.own);
    this.shadowSize = { x: L * 0.6, z: B * 0.9 };
  }
  private shadowSize: { x: number; z: number };

  /** Load every look's file. Ships of a look not yet loaded are drawn as their ring and shadow only. */
  async load(loader: GLTFLoader) {
    await Promise.all(LOOKS.map(async (look) => {
      try {
        const gltf = await loader.loadAsync(look.file.url);
        const b = bakeFile(gltf.scene, look.file);
        const hull = new THREE.InstancedMesh(b.hull, toon({ map: b.map }), MAX);
        const sail = new THREE.InstancedMesh(b.sail, toon({ map: b.map }), MAX);
        for (const im of [hull, sail]) {
          im.count = 0; im.frustumCulled = false;
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
        }
        this.kits.set(look.id, { hull, sail, height: b.height, n: 0 });
        this.group.add(hull, sail);
      } catch (err) {
        console.warn('[ships] could not load', look.file.url, err);
      }
    }));
  }

  /** How tall a look stands, for the name over her. */
  height(look: string) { return this.kits.get(look)?.height ?? 14; }

  draw(ships: ShipDraw[], t: number) {
    for (const k of this.kits.values()) k.n = 0;
    let sh = 0, rg = 0;
    this.own.visible = false;
    for (const d of ships) {
      if (d.scale <= 0.001) continue;
      const k = this.kits.get(d.look) ?? this.kits.values().next().value;
      this.e.set(d.heel, -d.h, d.pitch);
      this.q.setFromEuler(this.e);
      this.p.set(d.x, d.lift, d.y);
      this.s.setScalar(d.scale);
      this.m.compose(this.p, this.q, this.s);
      if (k && k.n < MAX) {
        k.hull.setMatrixAt(k.n, this.m);
        k.sail.setMatrixAt(k.n, this.m);
        k.hull.setColorAt(k.n, this.c.copy(WHITE).lerp(HURT, d.hit));
        k.sail.setColorAt(k.n, this.c.copy(d.color).lerp(WHITE, 0.25));
        k.n++;
      }
      if (d.lift > -3) {
        // a shadow on the water under her, turned with her
        this.q.setFromAxisAngle(Y, -d.h);
        this.s.set(this.shadowSize.x * d.scale, 1, this.shadowSize.z * d.scale);
        this.m.compose(this.p.set(d.x + 1.2, 0.06, d.y - 1.4), this.q, this.s);
        this.shadows.setMatrixAt(sh++, this.m);
        if (d.ring) {
          const r = TUNING.length * 0.52 * d.scale;
          this.m.compose(this.p.set(d.x, 0.1, d.y), this.q.identity(), this.s.set(r, 1, r));
          this.rings.setMatrixAt(rg, this.m);
          this.rings.setColorAt(rg++, d.shine ? this.c.copy(WHITE) : d.color);
          if (d.ring === 2) {
            this.own.visible = true;
            this.own.position.set(d.x, 0.12, d.y);
            this.own.rotation.y = t * 1.4;
            this.own.scale.setScalar(r * 1.12);
          }
        }
      }
    }
    for (const k of this.kits.values()) {
      k.hull.count = k.sail.count = k.n;
      for (const im of [k.hull, k.sail]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    this.shadows.count = sh;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.rings.count = rg;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }
}

const Y = new THREE.Vector3(0, 1, 0);
