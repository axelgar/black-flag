// What a power she has on looks like, round her. A shield is a bubble over her with a bright
// rim where it meets the water; the song is a ring as wide as its reach, so a ship can see
// whether she is in it. The rings that close in on a singer and the notes that rise off
// her are the view's (fx.ts). Three draws for every ship on the sea.

import * as THREE from 'three';
import { TUNING as T } from '../data/tuning';

const MAX = 40;
/** The bubble's reach round her, metres: past her bow and stern. */
export const BUBBLE = T.length * 0.7;

export interface AuraDraw { x: number; y: number; shield: boolean; song: boolean }

export class Auras {
  readonly group = new THREE.Group();
  private bubble: THREE.InstancedMesh;
  private rim: THREE.InstancedMesh;
  private reach: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor() {
    const flat = (inner: number) => new THREE.RingGeometry(inner, 1, 72).rotateX(-Math.PI / 2);
    this.bubble = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#7FE3FF', transparent: true, opacity: 0.32, depthWrite: false }),
      MAX,
    );
    this.rim = new THREE.InstancedMesh(flat(0.86), new THREE.MeshBasicMaterial({ color: '#BFF4FF', depthWrite: false }), MAX);
    this.reach = new THREE.InstancedMesh(flat(0.975), new THREE.MeshBasicMaterial({ color: '#FF7AD9', transparent: true, opacity: 0.75, depthWrite: false }), MAX);
    for (const im of [this.bubble, this.rim, this.reach]) {
      im.count = 0; im.frustumCulled = false;
      this.group.add(im);
    }
    // marks on the water under the ships; the bubble over them
    this.rim.renderOrder = 2; this.reach.renderOrder = 2; this.bubble.renderOrder = 5;
  }

  draw(list: readonly AuraDraw[], t: number) {
    let b = 0, r = 0;
    const throb = 1 + Math.sin(t * 9) * 0.03;
    for (const a of list) {
      if (a.shield && b < MAX) {
        this.m.compose(this.p.set(a.x, 0, a.y), this.q, this.s.set(BUBBLE * throb, BUBBLE * 0.8 * throb, BUBBLE * throb));
        this.bubble.setMatrixAt(b, this.m);
        this.m.compose(this.p.set(a.x, 0.25, a.y), this.q, this.s.setScalar(BUBBLE * throb));
        this.rim.setMatrixAt(b, this.m);
        b++;
      }
      if (a.song && r < MAX) {
        this.m.compose(this.p.set(a.x, 0.2, a.y), this.q, this.s.setScalar(T.songRange));
        this.reach.setMatrixAt(r, this.m);
        r++;
      }
    }
    this.bubble.count = this.rim.count = b;
    this.reach.count = r;
    this.bubble.instanceMatrix.needsUpdate = this.rim.instanceMatrix.needsUpdate = this.reach.instanceMatrix.needsUpdate = true;
  }
}
