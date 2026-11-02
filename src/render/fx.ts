// Everything that comes and goes: the balls in the air, smoke and fire at the guns,
// splashes, splinters, the foam behind every ship, and the rings that run out from a
// splash or a ship coming in. Cartoon effects, so nothing fades: a puff swells and
// shrinks away to nothing, a ring opens out and is gone. That keeps every one of them
// opaque, and all of them together are five draws.

import * as THREE from 'three';
import type { Shot } from '../sim/types';
import { toon } from './toon';

const PUFFS = 600, RINGS = 160, FOAM = 900, BALLS = 400;
const G = 30;   // gravity on a droplet, m/s²

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; age: number; life: number; c: THREE.Color; fall: boolean; drag: number }
interface Ring { x: number; z: number; r0: number; r1: number; age: number; life: number; c: THREE.Color }
interface Foam { x: number; z: number; size: number; age: number; life: number }

export const FX = {
  smoke: new THREE.Color('#FFFFFF'),
  fire: new THREE.Color('#FFB43A'),
  spray: new THREE.Color('#E8FBFF'),
  wood: new THREE.Color('#9A5B2E'),
  dust: new THREE.Color('#B9B4A6'),
  soot: new THREE.Color('#585E6B'),
  mist: new THREE.Color('#D5DCE6'),
  song: new THREE.Color('#FF7AD9'),
  shield: new THREE.Color('#7FE3FF'),
};

export class Fx {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private rings: Ring[] = [];
  private foam: Foam[] = [];
  private puffMesh: THREE.InstancedMesh;
  private ringMesh: THREE.InstancedMesh;
  private foamMesh: THREE.InstancedMesh;
  private ballMesh: THREE.InstancedMesh;
  private dotMesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private q = new THREE.Quaternion();
  /** Fewer, for reduced motion. */
  scale = 1;

  constructor() {
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon(), PUFFS);
    this.puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 3), 3);
    this.ringMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ depthWrite: false }), RINGS);
    this.ringMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 3), 3);
    this.foamMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#E9FBFF', depthWrite: false }), FOAM);
    this.ballMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon(), BALLS);
    this.ballMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BALLS * 3), 3);
    this.dotMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0B2F57', transparent: true, opacity: 0.3, depthWrite: false }), BALLS);
    for (const im of [this.puffMesh, this.ringMesh, this.foamMesh, this.ballMesh, this.dotMesh]) {
      im.count = 0; im.frustumCulled = false;
      this.group.add(im);
    }
    // the water's marks under everything that stands on it
    this.foamMesh.renderOrder = 1; this.ringMesh.renderOrder = 2; this.dotMesh.renderOrder = 2;
  }

  puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, c: THREE.Color, fall = false, drag = 2.5) {
    if (this.puffs.length >= PUFFS) this.puffs.shift();
    this.puffs.push({ x, y, z, vx, vy, vz, size, age: 0, life, c, fall, drag });
  }

  ring(x: number, z: number, r0: number, r1: number, life: number, c: THREE.Color = FX.spray) {
    if (this.rings.length >= RINGS) this.rings.shift();
    this.rings.push({ x, z, r0, r1, age: 0, life, c });
  }

  wake(x: number, z: number, size: number) {
    if (this.foam.length >= FOAM) this.foam.shift();
    this.foam.push({ x, z, size, age: 0, life: 1.1 });
  }

  /* ------------------------------------------------------------ recipes -- */

  /** A volley: smoke rolling out along the bearing from her side, and the flash of the guns. */
  volley(x: number, y: number, h: number, side: number, bearing: number, heavy: boolean) {
    const fx = Math.cos(h), fy = Math.sin(h);
    const sx = -fy * side, sy = fx * side;
    const bx = Math.cos(bearing), by = Math.sin(bearing);
    const n = Math.max(2, Math.round(3 * this.scale));
    for (let i = 0; i < n; i++) {
      const along = (i / (n - 1) - 0.5) * 12;
      const px = x + fx * along + sx * 4.5, py = y + fy * along + sy * 4.5;
      this.puff(px, 2.6, py, bx * 9, 1.5, by * 9, heavy ? 3.4 : 2.6, 0.9 + Math.random() * 0.3, FX.smoke);
      this.puff(px + bx * 1.5, 2.6, py + by * 1.5, bx * 14, 0.5, by * 14, heavy ? 2.4 : 1.6, 0.22, FX.fire);
    }
  }

  splash(x: number, y: number) {
    const n = Math.max(3, Math.round(5 * this.scale));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.puff(x, 0.5, y, Math.cos(a) * s, 9 + Math.random() * 5, Math.sin(a) * s, 0.7 + Math.random() * 0.5, 0.7, FX.spray, true, 0.3);
    }
    this.ring(x, y, 0.5, 5, 0.6);
  }

  /** A ball home in a hull: splinters and a white flash. */
  hit(x: number, y: number) {
    const n = Math.max(3, Math.round(6 * this.scale));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 5;
      this.puff(x, 3, y, Math.cos(a) * s, 7 + Math.random() * 6, Math.sin(a) * s, 0.45 + Math.random() * 0.35, 0.8, FX.wood, true, 0.2);
    }
    this.puff(x, 3, y, 0, 1, 0, 2.6, 0.25, FX.fire);
    this.puff(x, 3.5, y, 0, 2, 0, 2.2, 0.5, FX.smoke);
  }

  /** A ball stopped by an island. */
  dust(x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puff(x, 1.5, y, Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3, 1.4 + Math.random(), 0.7, FX.dust);
    }
  }

  /** A ship goes down: smoke, fire and a ring of foam. */
  sink(x: number, y: number) {
    for (let i = 0; i < Math.round(10 * this.scale); i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      this.puff(x + Math.cos(a) * 4, 2 + Math.random() * 3, y + Math.sin(a) * 4, Math.cos(a) * s, 4 + Math.random() * 4, Math.sin(a) * s, 3 + Math.random() * 2.5, 1.2 + Math.random() * 0.6, i % 3 === 0 ? FX.fire : FX.soot);
    }
    this.ring(x, y, 4, 22, 1.1);
    this.ring(x, y, 2, 14, 0.8);
  }

  /** A ship comes in, or a crate is taken: a ring and a burst in her colour. */
  pop(x: number, y: number, c: THREE.Color, big = 14) {
    this.ring(x, y, 3, big, 0.55, c);
    for (let i = 0; i < Math.round(6 * this.scale); i++) {
      const a = (i / 6) * Math.PI * 2;
      this.puff(x + Math.cos(a) * 3, 2, y + Math.sin(a) * 3, Math.cos(a) * 8, 6, Math.sin(a) * 8, 1.1, 0.5, c, true, 1);
    }
  }

  /** Smoke laid round a ship: a bank of grey puffs that hangs a while. */
  smokeBank(x: number, y: number, n = 16, reach = 14) {
    for (let i = 0; i < Math.max(2, Math.round(n * this.scale)); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * reach;
      this.puff(x + Math.cos(a) * r, 2 + Math.random() * 4, y + Math.sin(a) * r, Math.cos(a) * 2, 0.6, Math.sin(a) * 2, 5 + Math.random() * 3, 2.4 + Math.random(), FX.mist);
    }
  }

  /* -------------------------------------------------------------- frame -- */

  /** The balls in the air: high in the middle of their flight, with a shadow under each. */
  balls(shots: readonly Shot[]) {
    let n = 0;
    for (const s of shots) {
      if (n >= BALLS) break;
      const k = Math.min(1, s.age / s.life);
      const z = 2.2 + Math.sin(k * Math.PI) * 5;
      const r = s.heavy ? 1.15 : 0.8;
      this.m.compose(this.p.set(s.x, z, s.y), this.q.identity(), this.s.setScalar(r));
      this.ballMesh.setMatrixAt(n, this.m);
      this.ballMesh.setColorAt(n, s.heavy ? HEAVY : IRON);
      this.m.compose(this.p.set(s.x, 0.08, s.y), this.q, this.s.setScalar(r * 1.1));
      this.dotMesh.setMatrixAt(n, this.m);
      n++;
    }
    this.ballMesh.count = this.dotMesh.count = n;
    this.ballMesh.instanceMatrix.needsUpdate = this.dotMesh.instanceMatrix.needsUpdate = true;
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
  }

  frame(dt: number) {
    let n = 0;
    for (const p of this.puffs) {
      p.age += dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d;
      if (p.fall) p.vy -= G * dt; else p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life && p.y > -1);
    for (const p of this.puffs) {
      const k = p.age / p.life;
      // swell fast, then shrink away
      const s = p.size * (k < 0.18 ? 0.4 + (k / 0.18) * 0.6 : 1 - ((k - 0.18) / 0.82) ** 1.6);
      this.m.compose(this.p.set(p.x, p.y, p.z), this.q.identity(), this.s.setScalar(Math.max(0.01, s)));
      this.puffMesh.setMatrixAt(n, this.m);
      this.puffMesh.setColorAt(n, p.c);
      n++;
    }
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const r of this.rings) {
      const k = r.age / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 2);
      // the ring thins as it opens: drawn as a squashed copy, its width shrinks with it
      this.m.compose(this.p.set(r.x, 0.14, r.z), this.q.identity(), this.s.set(rad, 1, rad));
      this.ringMesh.setMatrixAt(n, this.m);
      this.ringMesh.setColorAt(n, r.c);
      n++;
    }
    this.ringMesh.count = n;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (const f of this.foam) f.age += dt;
    this.foam = this.foam.filter((f) => f.age < f.life);
    for (const f of this.foam) {
      const k = f.age / f.life;
      const s = f.size * (k < 0.2 ? 0.6 + k * 2 : 1 - (k - 0.2) / 0.8);
      this.m.compose(this.p.set(f.x, 0.04, f.z), this.q.identity(), this.s.set(Math.max(0.01, s * (1 + k)), 1, Math.max(0.01, s * (1 + k))));
      this.foamMesh.setMatrixAt(n++, this.m);
    }
    this.foamMesh.count = n;
    this.foamMesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.puffs = []; this.rings = []; this.foam = []; }
}

const IRON = new THREE.Color('#2E2A33');
const HEAVY = new THREE.Color('#FF6A1F');
