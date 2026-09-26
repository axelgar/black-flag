// A ship's solid mesh, built by hand. Beyond position, normal and colour, every vertex
// carries two small channels the timber shader reads:
//
//   aMat   roughness, metalness, which timber map the face samples, how brightly it glows
//   aAnim  kind (0 still, 1 port lid, 2 gun, 3 port interior), side, and two numbers the
//          kind needs: a lid's hinge (y, z), or how far a gun runs in
//
// Everything is built in a local frame through a transform stack, so a gun port is
// drawn once for starboard and mirrored for larboard; a mirrored transform flips its
// winding by itself, so nothing ends up inside out.

import * as THREE from 'three';

export type V3 = [number, number, number];

/** The map a face samples. 0–3 are the timber map — panes glow when the finish does,
 *  and read as a grating when not — 4 is plain, and 5–8 the masonry map, for the land. */
export const TEX = { hull: 0, deck: 1, grain: 2, pane: 3, flat: 4, plaster: 5, tile: 6, stone: 7, thatch: 8 } as const;

export interface Finish { rough: number; metal: number; tex: number; glow: number }

export const FIN = {
  planks: { rough: 0.66, metal: 0, tex: TEX.hull, glow: 0 },
  bottom: { rough: 0.5, metal: 0, tex: TEX.hull, glow: 0 },
  deck: { rough: 0.84, metal: 0, tex: TEX.deck, glow: 0 },
  wood: { rough: 0.72, metal: 0, tex: TEX.grain, glow: 0 },
  paint: { rough: 0.5, metal: 0, tex: TEX.grain, glow: 0 },
  iron: { rough: 0.42, metal: 0.72, tex: TEX.flat, glow: 0 },
  gilt: { rough: 0.3, metal: 1, tex: TEX.flat, glow: 0 },
  dark: { rough: 0.9, metal: 0, tex: TEX.flat, glow: 0 },
  glass: { rough: 0.1, metal: 0, tex: TEX.pane, glow: 1 },
  lamp: { rough: 0.2, metal: 0, tex: TEX.flat, glow: 1.8 },
  grating: { rough: 0.8, metal: 0, tex: TEX.pane, glow: 0 },
  plaster: { rough: 0.92, metal: 0, tex: TEX.plaster, glow: 0 },
  tile: { rough: 0.78, metal: 0, tex: TEX.tile, glow: 0 },
  stone: { rough: 0.88, metal: 0, tex: TEX.stone, glow: 0 },
  thatch: { rough: 0.96, metal: 0, tex: TEX.thatch, glow: 0 },
  cloth: { rough: 0.95, metal: 0, tex: TEX.flat, glow: 0 },
  unlit: { rough: 0.3, metal: 0, tex: TEX.pane, glow: 0 },
} satisfies Record<string, Finish>;

export const ANIM = { still: 0, lid: 1, gun: 2, port: 3 } as const;

/** How much fine work the shipwright puts in: less on a phone, where it would go unseen
 *  and uncounted frames matter more. Set once, before the first ship is built. */
export const LOD = { lo: false };

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();

export class Mesh {
  private P: number[] = [];
  private N: number[] = [];
  private C: number[] = [];
  private U: number[] = [];
  private M: number[] = [];
  private A: number[] = [];

  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private flip = false;
  private stack: THREE.Matrix4[] = [];

  private col = new THREE.Color(1, 1, 1);
  private fin: Finish = FIN.wood;
  private anim: [number, number, number, number] = [0, 0, 0, 0];

  /** Colour and finish for what follows. */
  paint(color: string | THREE.Color, fin: Finish): this {
    if (typeof color === 'string') this.col.set(color); else this.col.copy(color);
    this.fin = fin;
    return this;
  }

  /** Mark what follows as moving parts — or, with no arguments, as still. */
  moving(kind = 0, side = 0, a = 0, b = 0): this { this.anim = [kind, side, a, b]; return this; }

  /** Enter a local frame; everything until the matching pop() is drawn in it. */
  push(m: THREE.Matrix4): this {
    this.stack.push(this.m.clone());
    this.m.multiply(m);
    this.sync();
    return this;
  }

  pop(): this {
    this.m.copy(this.stack.pop()!);
    this.sync();
    return this;
  }

  private sync() {
    this.nm.getNormalMatrix(this.m);
    this.flip = this.m.determinant() < 0;
  }

  /** The current frame's origin, in the mesh's own space. */
  here(p: V3 = [0, 0, 0]): THREE.Vector3 { return new THREE.Vector3(...p).applyMatrix4(this.m); }

  private vert(p: V3, n: V3, uv: [number, number]) {
    tmpV.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    tmpN.set(n[0], n[1], n[2]).applyMatrix3(this.nm).normalize();
    this.P.push(tmpV.x, tmpV.y, tmpV.z);
    this.N.push(tmpN.x, tmpN.y, tmpN.z);
    this.C.push(this.col.r, this.col.g, this.col.b);
    this.U.push(uv[0], uv[1]);
    const f = this.fin;
    this.M.push(f.rough, f.metal, f.tex, f.glow);
    this.A.push(this.anim[0], this.anim[1], this.anim[2], this.anim[3]);
  }

  /** A triangle, counter-clockwise from the side that should see it. */
  tri(a: V3, b: V3, c: V3, na?: V3, nb?: V3, nc?: V3, ua: [number, number] = [0, 0], ub: [number, number] = [0, 0], uc: [number, number] = [0, 0]) {
    if (!na) {
      const n = faceNormal(a, b, c);
      na = nb = nc = n;
    }
    if (this.flip) { this.vert(a, na, ua); this.vert(c, nc!, uc); this.vert(b, nb!, ub); }
    else { this.vert(a, na, ua); this.vert(b, nb!, ub); this.vert(c, nc!, uc); }
  }

  /** A quad a b c d, counter-clockwise; flat unless normals are given. */
  quad(a: V3, b: V3, c: V3, d: V3, n?: [V3, V3, V3, V3] | V3, uv?: [[number, number], [number, number], [number, number], [number, number]]) {
    const ns = !n ? null : Array.isArray(n[0]) ? (n as [V3, V3, V3, V3]) : [n as V3, n as V3, n as V3, n as V3];
    const flat = ns ? null : faceNormal(a, b, c, d);
    const N0 = ns ? ns[0] : flat!, N1 = ns ? ns[1] : flat!, N2 = ns ? ns[2] : flat!, N3 = ns ? ns[3] : flat!;
    const U = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, N0, N1, N2, U[0], U[1], U[2]);
    this.tri(a, c, d, N0, N2, N3, U[0], U[2], U[3]);
  }

  /** A box centred on the frame's origin. UVs are in metres, grain along the longest side. */
  box(sx: number, sy: number, sz: number): this {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const long = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const uv = (p: V3, axisA: number, axisB: number): [number, number] => {
      // grain runs along the box's long axis where the face has it
      const a = axisA === long || axisB !== long ? p[axisA] : p[axisB];
      const b = axisA === long || axisB !== long ? p[axisB] : p[axisA];
      return [a, b];
    };
    const face = (a: V3, b: V3, c: V3, d: V3, n: V3, ax: number, bx: number) =>
      this.quad(a, b, c, d, n, [uv(a, ax, bx), uv(b, ax, bx), uv(c, ax, bx), uv(d, ax, bx)]);
    face([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1], 0, 1);
    face([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1], 0, 1);
    face([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0], 2, 1);
    face([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0], 2, 1);
    face([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0], 0, 2);
    face([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0], 0, 2);
    return this;
  }

  /** A box from one point to another, `w` wide and `h` deep, its up as near `up` as it can be. */
  beam(a: V3, b: V3, w: number, h: number, up: V3 = [0, 1, 0]): this {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const X = B.clone().sub(A);
    const len = X.length();
    if (len < 1e-5) return this;
    X.divideScalar(len);
    let U = new THREE.Vector3(...up);
    if (Math.abs(U.dot(X)) > 0.98) U = Math.abs(X.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const Z = new THREE.Vector3().crossVectors(X, U).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(A.add(B).multiplyScalar(0.5));
    return this.push(m).box(len, h, w).pop();
  }

  /** A tapered, smooth-sided cylinder between two points. UVs: metres along, metres round. */
  cyl(a: V3, b: V3, r0: number, r1: number, sides: number, caps = false): this {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const axis = B.clone().sub(A);
    const len = axis.length();
    if (len < 1e-5) return this;
    axis.divideScalar(len);
    const tmp = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, tmp).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const slope = (r0 - r1) / len;
    const ring = (C: THREE.Vector3, r: number) => Array.from({ length: sides + 1 }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      const dir = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t));
      const p = C.clone().addScaledVector(dir, r);
      const n = dir.clone().addScaledVector(axis, slope).normalize();
      return { p: [p.x, p.y, p.z] as V3, n: [n.x, n.y, n.z] as V3, round: t * (r0 + r1) * 0.5 };
    });
    const ra = ring(A, r0), rb = ring(B, r1);
    for (let i = 0; i < sides; i++) {
      const j = i + 1;
      this.quad(ra[i].p, ra[j].p, rb[j].p, rb[i].p, [ra[i].n, ra[j].n, rb[j].n, rb[i].n],
        [[0, ra[i].round], [0, ra[j].round], [len, rb[j].round], [len, rb[i].round]]);
    }
    if (caps) {
      const na: V3 = [-axis.x, -axis.y, -axis.z], nb: V3 = [axis.x, axis.y, axis.z];
      for (let i = 1; i < sides - 1; i++) {
        this.tri(rb[0].p, rb[i].p, rb[i + 1].p, nb, nb, nb);
        this.tri(ra[0].p, ra[i + 1].p, ra[i].p, na, na, na);
      }
    }
    return this;
  }

  /** Turn a profile of (radius, height) pairs about the frame's y axis. */
  lathe(profile: [number, number][], sides: number, capTop = true): this {
    const rows = profile.map(([r, y], i) => {
      // the profile's slope gives each ring its normal
      const [ra, ya] = profile[Math.max(0, i - 1)], [rb, yb] = profile[Math.min(profile.length - 1, i + 1)];
      const dr = rb - ra, dy = yb - ya;
      const l = Math.hypot(dr, dy) || 1;
      return Array.from({ length: sides + 1 }, (_, k) => {
        const a = (k / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        return { p: [r * c, y, r * s] as V3, n: [(dy / l) * c, -dr / l, (dy / l) * s] as V3, uv: [a * r, y] as [number, number] };
      });
    });
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
        this.quad(a.p, d.p, c.p, b.p, [a.n, d.n, c.n, b.n], [a.uv, d.uv, c.uv, b.uv]);
      }
    }
    if (capTop) {
      const top = rows[rows.length - 1], y = profile[profile.length - 1][1];
      for (let k = 0; k < sides; k++) this.tri([0, y, 0], top[k + 1].p, top[k].p, [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    }
    return this;
  }

  /** A flat polygon in the frame's XY plane, facing +Z, as a fan from its first point. */
  plate(pts: [number, number][], z = 0): this {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[0], b = pts[i], c = pts[i + 1];
      this.tri([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [0, 0, 1], [0, 0, 1], [0, 0, 1], a, b, c);
    }
    return this;
  }

  /** A polygon in the frame's XY plane (counter-clockwise), given thickness along Z. */
  slab(pts: [number, number][], depth: number): this {
    const z = depth / 2;
    this.plate(pts, z);
    const back = [...pts].reverse();
    for (let i = 1; i < back.length - 1; i++) {
      const a = back[0], b = back[i], c = back[i + 1];
      this.tri([a[0], a[1], -z], [b[0], b[1], -z], [c[0], c[1], -z], [0, 0, -1], [0, 0, -1], [0, 0, -1], a, b, c);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.quad([a[0], a[1], -z], [b[0], b[1], -z], [b[0], b[1], z], [a[0], a[1], z], undefined, [[0, 0], [len, 0], [len, depth], [0, depth]]);
    }
    return this;
  }

  get count() { return this.P.length / 3; }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aTuv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.M, 4));
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.A, 4));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function faceNormal(a: V3, b: V3, c: V3, d?: V3): V3 {
  // Newell's method, so a slightly warped quad still gets an honest normal.
  const pts = d ? [a, b, c, d] : [a, b, c];
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** A frame at `o`, x along `fwd`, y as near `up` as it can be. */
export function frame(o: V3 | THREE.Vector3, fwd: V3 | THREE.Vector3 = [1, 0, 0], up: V3 | THREE.Vector3 = [0, 1, 0]): THREE.Matrix4 {
  const O = o instanceof THREE.Vector3 ? o : new THREE.Vector3(...o);
  const X = (fwd instanceof THREE.Vector3 ? fwd.clone() : new THREE.Vector3(...fwd)).normalize();
  const U = up instanceof THREE.Vector3 ? up.clone() : new THREE.Vector3(...up);
  const Z = new THREE.Vector3().crossVectors(X, U).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(O);
}

export const at = (x: number, y: number, z: number, ry = 0, rz = 0, rx = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YZX')), new THREE.Vector3(1, 1, 1));

/** Starboard is +z; larboard is the same frame seen in a mirror. */
export const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
