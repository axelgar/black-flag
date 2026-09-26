// A tiny mesh builder: triangles with a flat colour each, in one non-indexed buffer.
// Flat shading and per-face colour is the islands' whole low-poly look, and building a
// coast, its town and its fort into one of these makes them a single draw call. Ships
// have their own, richer builder in ships/mesh.ts.

import * as THREE from 'three';

export type V3 = [number, number, number];

export class Builder {
  pos: number[] = [];
  col: number[] = [];
  extra: Record<string, { size: number; data: number[] }> = {};
  private c = new THREE.Color();

  constructor(extras: Record<string, number> = {}) {
    for (const [k, size] of Object.entries(extras)) this.extra[k] = { size, data: [] };
  }

  private push(p: V3, col: THREE.Color, ex?: Record<string, number[]>) {
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(col.r, col.g, col.b);
    for (const [k, e] of Object.entries(this.extra)) {
      const v = ex?.[k] ?? new Array(e.size).fill(0);
      e.data.push(...v);
    }
  }

  tri(a: V3, b: V3, c: V3, color: string | THREE.Color, ex?: [Record<string, number[]>, Record<string, number[]>, Record<string, number[]>]) {
    const col = typeof color === 'string' ? this.c.set(color) : color;
    this.push(a, col, ex?.[0]); this.push(b, col, ex?.[1]); this.push(c, col, ex?.[2]);
  }

  /** a b c d counter-clockwise, seen from the side the face should face. */
  quad(a: V3, b: V3, c: V3, d: V3, color: string | THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** An axis-aligned box, optionally turned about Y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: string, rotY = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const p = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const v = [
      p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz),
      p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz),
    ];
    this.quad(v[4], v[5], v[6], v[7], color);   // +z
    this.quad(v[1], v[0], v[3], v[2], color);   // -z
    this.quad(v[5], v[1], v[2], v[6], color);   // +x
    this.quad(v[0], v[4], v[7], v[3], color);   // -x
    this.quad(v[3], v[7], v[6], v[2], color);   // +y
    this.quad(v[0], v[1], v[5], v[4], color);   // -y
  }

  /** A tapered cylinder between two points. */
  cyl(a: V3, b: V3, r0: number, r1: number, sides: number, color: string, caps = false) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const axis = B.clone().sub(A).normalize();
    const tmp = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, tmp).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const ring = (C: THREE.Vector3, r: number) => Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      const p = C.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
      return [p.x, p.y, p.z] as V3;
    });
    const ra = ring(A, r0), rb = ring(B, r1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(ra[i], ra[j], rb[j], rb[i], color);
    }
    if (caps) {
      for (let i = 1; i < sides - 1; i++) {
        this.tri(rb[0], rb[i], rb[i + 1], color);
        this.tri(ra[0], ra[i + 1], ra[i], color);
      }
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [k, e] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
