// The crates afloat: a wooden crate bobbing on the water, a ring round it in its colour,
// and over it, turned to the camera, what is in it: a plus for repairs, a bolt for speed,
// a burst for a heavy shot. Readable from across the sea at a glance, by colour first
// and shape second. Everything is inked (ink.ts).
//
// The crate is the props file's (src/data/props.ts); until it loads, a plain box.

import * as THREE from 'three';
import type { Crate } from '../sim/types';
import { outline } from './ink';
import type { Prop } from './land';
import { toon } from './toon';

const MAX = 32;
/** The crate's height, metres: about five across. */
const SIZE = 3.4;
/** The sign over it: how big, and how high. */
const SIGN = 7.5, SIGN_AT = 10;

export const CRATE_COLOR: Record<Crate['kind'], THREE.Color> = {
  repair: new THREE.Color('#3FD46A'),
  // yellow, not blue: a blue sign is lost on a blue sea
  speed: new THREE.Color('#FFD23F'),
  heavy: new THREE.Color('#FF5A3C'),
};

const KINDS = Object.keys(CRATE_COLOR) as Crate['kind'][];

/** The signs, a metre across, flat in x and y, a little thick. */
function sign(kind: Crate['kind']): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  if (kind === 'repair') {
    const w = 0.19, l = 0.5;
    pts.push([-w, l], [w, l], [w, w], [l, w], [l, -w], [w, -w], [w, -l], [-w, -l], [-w, -w], [-l, -w], [-l, w], [-w, w]);
  } else if (kind === 'speed') {
    pts.push([0.12, 0.55], [-0.32, -0.02], [-0.04, -0.02], [-0.14, -0.55], [0.32, 0.06], [0.04, 0.06]);
  } else {
    const n = 9;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.3 : i % 4 ? 0.5 : 0.58;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
  g.translate(0, 0, -0.11);
  return g;
}

export class Crates {
  readonly group = new THREE.Group();
  private box: THREE.InstancedMesh;
  private signs = new Map<Crate['kind'], THREE.InstancedMesh>();
  private rings: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  /** `tilt`: how far the camera looks down, radians, so the signs can face it. */
  constructor(private tilt: number) {
    this.box = this.crateMesh(new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, 0.5, 0), null);
    for (const k of KINDS) {
      const im = new THREE.InstancedMesh(sign(k), toon({ color: CRATE_COLOR[k] }), MAX);
      im.count = 0; im.frustumCulled = false;
      outline(im);
      this.signs.set(k, im);
      this.group.add(im);
    }
    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), MAX);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 2;
    this.group.add(this.rings);
  }

  private crateMesh(g: THREE.BufferGeometry, map: THREE.Texture | null): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(g, toon({ map }), MAX);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    im.count = 0; im.frustumCulled = false;
    outline(im);
    this.group.add(im);
    return im;
  }

  /** The props file's crate: set on its base, a metre tall. */
  setModel(p: Prop) {
    this.group.remove(this.box);
    this.box.dispose();
    this.box = this.crateMesh(p.geometry, p.map);
  }

  /** `ease`: a crate swells in over its first moments, 0..1 to its size. */
  draw(crates: Crate[], t: number, ease: (k: number) => number) {
    const counts = new Map<Crate['kind'], number>(KINDS.map((k) => [k, 0]));
    let n = 0;
    for (const c of crates) {
      if (c.dead || n >= MAX) continue;
      const k = Math.max(0.01, ease(Math.min(1, c.age / 0.4)));
      const bob = Math.sin(t * 2 + c.id) * 0.45;
      // the crate, rocking on the swell
      this.e.set(0.12 * Math.sin(t * 1.7 + c.id), t * 0.5 + c.id, 0.12 * Math.cos(t * 1.3 + c.id));
      this.m.compose(this.p.set(c.x, -0.9 + bob, c.y), this.q.setFromEuler(this.e), this.s.setScalar(SIZE * k));
      this.box.setMatrixAt(n, this.m);
      this.box.setColorAt(n, this.c.set(0xffffff).lerp(CRATE_COLOR[c.kind], 0.22));
      // its ring on the water
      const r = 7 * k * (1 + 0.06 * Math.sin(t * 3 + c.id));
      this.m.compose(this.p.set(c.x, 0.08, c.y), this.q.identity(), this.s.set(r, 1, r));
      this.rings.setMatrixAt(n, this.m);
      this.rings.setColorAt(n, CRATE_COLOR[c.kind]);
      // the sign over it, turned to the camera, rocking a little
      const im = this.signs.get(c.kind)!, i = counts.get(c.kind)!;
      this.e.set(-this.tilt, Math.sin(t * 1.6 + c.id) * 0.45, 0);
      this.m.compose(this.p.set(c.x, SIGN_AT + bob * 1.6, c.y), this.q.setFromEuler(this.e), this.s.setScalar(SIGN * k));
      im.setMatrixAt(i, this.m);
      counts.set(c.kind, i + 1);
      n++;
    }
    this.box.count = this.rings.count = n;
    for (const im of [this.box, this.rings]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    for (const [k, im] of this.signs) { im.count = counts.get(k)!; im.instanceMatrix.needsUpdate = true; }
  }

  hide() { this.box.count = this.rings.count = 0; for (const im of this.signs.values()) im.count = 0; }
}
