// Wakes. Every hull drags a ribbon of foam behind her, sampled from where she has been,
// spreading and fading with age and laid on the swell so it rides the waves. One buffer
// for every ship on the water.

import * as THREE from 'three';
import { heightAt, swell } from './waves';

const N = 28;              // points of history per ship
const EVERY = 0.12;        // seconds between samples
const MAX = 48;            // ships

const vert = /* glsl */ `
attribute vec2 aUv;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vUv = aUv; vAlpha = aAlpha;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uFoam;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
float hash(vec2 p) { p = fract(mod(p, 289.0) * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // Two bright edges (the Kelvin arms) and churned water down the middle.
  float across = abs(vUv.y * 2.0 - 1.0);
  float edge = smoothstep(0.55, 0.95, across) * (1.0 - smoothstep(0.95, 1.0, across));
  float churn = (1.0 - smoothstep(0.0, 0.45, across)) * (1.0 - vUv.x) * 0.9;
  float n = noise(vWorld.xz * 0.8 + uTime * 0.3) * 0.55 + noise(vWorld.xz * 2.6) * 0.45;
  float a = max(edge * 0.8, churn * 0.6) * smoothstep(0.35, 0.8, n + 0.15) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uFoam, a * 0.55);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Trail { pts: { x: number; z: number; w: number; t: number }[]; clock: number; seen: boolean }

export class Wakes {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  private trails = new Map<number, Trail>();
  private pos = new Float32Array(MAX * N * 2 * 3);
  private uv = new Float32Array(MAX * N * 2 * 2);
  private al = new Float32Array(MAX * N * 2);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let s = 0; s < MAX; s++) {
      for (let i = 0; i < N - 1; i++) {
        const a = (s * N + i) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uFoam: { value: new THREE.Color('#F2FBF8') }, uTime: { value: 0 } },
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  begin() { for (const t of this.trails.values()) t.seen = false; }

  /** Report where a ship's stern is this frame. `beam` sets how wide her wake starts. */
  track(id: number, x: number, z: number, beam: number, speed: number, dt: number, t: number) {
    let tr = this.trails.get(id);
    if (!tr) { tr = { pts: [], clock: 0, seen: true }; this.trails.set(id, tr); }
    tr.seen = true;
    // A ship that jumped (a refit, a new wave) starts a new wake, not a streak across the sea.
    if (tr.pts.length && Math.hypot(tr.pts[0].x - x, tr.pts[0].z - z) > 25) tr.pts.length = 0;
    tr.clock += dt;
    const w = beam * 0.5 * Math.min(1, speed / 6);
    if (tr.clock >= EVERY || !tr.pts.length) {
      tr.clock = 0;
      // the oldest point is recycled as the newest: no garbage for every ship, every sample
      const p = tr.pts.length >= N ? tr.pts.pop()! : { x: 0, z: 0, w: 0, t: 0 };
      p.x = x; p.z = z; p.w = w; p.t = t;
      tr.pts.unshift(p);
    } else {
      const p = tr.pts[0];
      p.x = x; p.z = z; p.w = w;
    }
  }

  end(t: number, foam: THREE.Color) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uFoam.value.copy(foam);
    let s = 0;
    // riding a little higher in a big sea: the sea's mesh is coarser than the swell's sums
    const lift = 0.08 + 0.12 * swell.amp;
    for (const [id, tr] of this.trails) {
      // A ship that has gone keeps her wake until it has faded.
      if (!tr.seen) {
        tr.pts.pop();
        if (!tr.pts.length) { this.trails.delete(id); continue; }
      }
      if (s >= MAX) break;
      const P = tr.pts;
      for (let i = 0; i < N; i++) {
        const p = P[Math.min(i, P.length - 1)];
        const q = P[Math.min(i + 1, P.length - 1)] ?? p;
        const r = P[Math.min(Math.max(0, i - 1), P.length - 1)];
        let dx = r.x - q.x, dz = r.z - q.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        const age = t - p.t;
        const spread = p.w * (0.6 + age * 1.1) + age * 0.9;
        const y = heightAt(p.x, p.z, t) + lift;
        const o = (s * N + i) * 2;
        const B = this.pos, U = this.uv, k = o * 3, j = o * 2;
        B[k] = p.x - dz * spread; B[k + 1] = y; B[k + 2] = p.z + dx * spread;
        B[k + 3] = p.x + dz * spread; B[k + 4] = y; B[k + 5] = p.z - dx * spread;
        const u = i / (N - 1);
        U[j] = u; U[j + 1] = 0; U[j + 2] = u; U[j + 3] = 1;
        const a = i >= P.length - 1 ? 0 : Math.max(0, 1 - age / (N * EVERY)) * Math.min(1, p.w / 1.2);
        this.al[o] = a; this.al[o + 1] = a;
      }
      s++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, s * (N - 1) * 6);
    this.mesh.visible = s > 0;
    // send the GPU the ships that have wakes, not the whole buffer
    const verts = s * N * 2;
    for (const [name, size] of [['position', 3], ['aUv', 2], ['aAlpha', 1]] as const) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      a.clearUpdateRanges();
      if (verts) { a.addUpdateRange(0, verts * size); a.needsUpdate = true; }
    }
  }

  clear() { this.trails.clear(); }
}
