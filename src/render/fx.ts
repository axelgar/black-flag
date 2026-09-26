// Everything ephemeral: powder smoke, muzzle flash, spray, fire, splinters, rain. One
// pool of points for things that are drawn over, one for things that glow, one instanced
// mesh for wood in the water. All CPU-simulated, all a single draw call each.

import * as THREE from 'three';
import { heightAt } from './waves';

const pvert = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute vec2 aLife;      // seed, age 0..1
uniform float uScale;
varying vec4 vColor;
varying vec2 vLife;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(-mv.z, 1.0), 900.0);
  vColor = aColor;
  vLife = aLife;
}`;

// Smoke is a billowing puff, lit from above and ragged at its edge, turning as it rolls;
// glow is hot at the core and cools outward — and, for fire, cools with age too.
const pfrag = /* glsl */ `
varying vec4 vColor;
varying vec2 vLife;
uniform float uLumpy;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float seed = vLife.x, age = vLife.y;
  if (uLumpy > 0.5) {
    // turn the puff as it ages so it rolls rather than slides
    float a = seed * 6.28 + age * 1.3;
    vec2 r = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
    float n = vn(r * 4.2 + seed * 37.0) * 0.6 + vn(r * 9.0 - seed * 19.0) * 0.4;
    float edge = d + (n - 0.5) * 0.62;
    float alpha = smoothstep(1.0, 0.3, edge);
    if (alpha <= 0.01) discard;
    // lit from above: brighter on the crown, greyer underneath and in the folds
    float lit = clamp(0.55 - c.y * 1.3 + (n - 0.5) * 0.5, 0.0, 1.0);
    vec3 col = vColor.rgb * mix(0.66, 1.1, lit);
    gl_FragColor = vec4(col, alpha * clamp(vColor.a, 0.0, 1.0));
  } else {
    float core = 1.0 - smoothstep(0.0, 0.55, d);
    float alpha = smoothstep(1.0, 0.15, d + (vn(c * 6.0 + seed * 11.0 + age * 3.0) - 0.5) * 0.3);
    if (alpha <= 0.01) discard;
    vec3 col = mix(vColor.rgb, vec3(1.0, 0.96, 0.82), core * (1.0 - age * 0.8));
    gl_FragColor = vec4(col, alpha * clamp(vColor.a, 0.0, 1.0));
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface SpawnOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number; size: number; grow?: number;
  color: THREE.Color | string; alpha?: number;
  drag?: number; grav?: number;
}

class Pool {
  points: THREE.Points;
  private n = 0;
  private max: number;
  private pos: Float32Array; private col: Float32Array; private siz: Float32Array;
  private vel: Float32Array; private life: Float32Array; private age: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private a0: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private rgb: Float32Array;
  private lifeAttr: Float32Array; private seed: Float32Array;
  mat: THREE.ShaderMaterial;
  private c = new THREE.Color();

  constructor(max: number, additive: boolean, lumpy: number) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.siz = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.rgb = new Float32Array(max * 3);
    this.lifeAttr = new Float32Array(max * 2); this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 2).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pvert, fragmentShader: pfrag,
      uniforms: { uScale: { value: 400 }, uLumpy: { value: lumpy } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(o: SpawnOpts) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0; this.vel[i * 3 + 1] = o.vy ?? 0; this.vel[i * 3 + 2] = o.vz ?? 0;
    this.life[i] = o.life; this.age[i] = 0;
    this.s0[i] = o.size; this.s1[i] = o.size * (o.grow ?? 1);
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
    this.seed[i] = Math.random();
    const c = typeof o.color === 'string' ? this.c.set(o.color) : o.color;
    this.rgb[i * 3] = c.r; this.rgb[i * 3 + 1] = c.g; this.rgb[i * 3 + 2] = c.b;
  }

  update(dt: number) {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact as we go
      if (n !== i) this.move(i, n);
      this.age[n] = age;
      const k = Math.max(0, 1 - this.drag[n] * dt);
      this.vel[n * 3] *= k; this.vel[n * 3 + 1] = this.vel[n * 3 + 1] * k - this.grav[n] * dt; this.vel[n * 3 + 2] *= k;
      this.pos[n * 3] += this.vel[n * 3] * dt; this.pos[n * 3 + 1] += this.vel[n * 3 + 1] * dt; this.pos[n * 3 + 2] += this.vel[n * 3 + 2] * dt;
      const t = age / this.life[n];
      this.siz[n] = this.s0[n] + (this.s1[n] - this.s0[n]) * Math.sqrt(t);
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[n * 4] = this.rgb[n * 3]; this.col[n * 4 + 1] = this.rgb[n * 3 + 1]; this.col[n * 4 + 2] = this.rgb[n * 3 + 2];
      this.col[n * 4 + 3] = this.a0[n] * fade;
      this.lifeAttr[n * 2] = this.seed[n]; this.lifeAttr[n * 2 + 1] = t;
      n++;
    }
    this.n = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }

  private move(from: number, to: number) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.rgb[to * 3 + k] = this.rgb[from * 3 + k];
    }
    this.life[to] = this.life[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from]; this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.seed[to] = this.seed[from];
  }

  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}

/* ----------------------------------------------------------------- wood -- */

class Debris {
  mesh: THREE.InstancedMesh;
  private items: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; life: number; age: number }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private sc = new THREE.Vector3();
  constructor(private max: number) {
    const g = new THREE.BoxGeometry(1, 0.25, 0.4);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#5C4128', roughness: 0.9, flatShading: true }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  spawn(x: number, y: number, z: number, n: number, force: number, size = 1) {
    for (let i = 0; i < n && this.items.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      this.items.push({
        p: new THREE.Vector3(x, y, z),
        v: new THREE.Vector3(Math.cos(a) * force * Math.random(), force * (0.6 + Math.random()), Math.sin(a) * force * Math.random()),
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        w: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        s: size * (0.5 + Math.random() * 1.4), life: 6 + Math.random() * 5, age: 0,
      });
    }
  }
  update(dt: number, t: number) {
    this.items = this.items.filter((d) => (d.age += dt) < d.life);
    this.items.forEach((d, i) => {
      const sea = heightAt(d.p.x, d.p.z, t);
      if (d.p.y > sea + 0.1) {
        d.v.y -= 16 * dt;
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      } else {
        // afloat: bob on the swell, lose way, and slowly go under at the end
        d.v.multiplyScalar(Math.max(0, 1 - dt * 2));
        d.v.y = 0;
        d.p.y = sea - Math.max(0, d.age - d.life + 2) * 0.4;
      }
      d.p.addScaledVector(d.v, dt);
      this.q.setFromEuler(d.r);
      this.sc.setScalar(d.s);
      this.m.compose(d.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.items = []; this.mesh.count = 0; }
}

/* ----------------------------------------------------------------- rain -- */

class Rain {
  lines: THREE.LineSegments;
  private n = 900;
  private pos: Float32Array;
  on = false;
  constructor() {
    this.pos = new Float32Array(this.n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#B8CCD2', transparent: true, opacity: 0.35 }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    for (let i = 0; i < this.n; i++) this.reset(i, new THREE.Vector3(), true);
  }
  private reset(i: number, c: THREE.Vector3, anywhere: boolean) {
    const x = c.x + (Math.random() - 0.5) * 260, z = c.z + (Math.random() - 0.5) * 260;
    const y = anywhere ? Math.random() * 90 : 90;
    this.pos.set([x, y, z, x - 0.6, y + 3.2, z - 0.3], i * 6);
  }
  update(dt: number, c: THREE.Vector3) {
    this.lines.visible = this.on;
    if (!this.on) return;
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      const dy = 70 * dt;
      this.pos[o + 1] -= dy; this.pos[o + 4] -= dy;
      this.pos[o] += 12 * dt; this.pos[o + 3] += 12 * dt;
      if (this.pos[o + 1] < 0 || Math.abs(this.pos[o] - c.x) > 150 || Math.abs(this.pos[o + 2] - c.z) > 150) this.reset(i, c, false);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ fx ---- */

const SMOKE = new THREE.Color('#D8D2C4');
const DARK = new THREE.Color('#3A3430');
const FIRE = new THREE.Color('#FF8A2A').multiplyScalar(2.2);
const FLASH = new THREE.Color('#FFD08A').multiplyScalar(3);
const SPRAY = new THREE.Color('#F2FBF8');
const GOLD = new THREE.Color('#FFD36A').multiplyScalar(2);

export class Fx {
  group = new THREE.Group();
  smoke = new Pool(2200, false, 1);
  glow = new Pool(1200, true, 0);
  wood = new Debris(220);
  rain = new Rain();
  scale = 1;              // reduced motion / low tier cut the counts

  constructor() {
    this.group.add(this.smoke.points, this.glow.points, this.wood.mesh, this.rain.lines);
  }

  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.smoke.mat.uniforms.uScale.value = s;
    this.glow.mat.uniforms.uScale.value = s;
  }

  private n(k: number) { return Math.max(1, Math.round(k * this.scale)); }

  /** One gun: a flash at the muzzle and a bank of powder smoke rolling out along the shot. */
  muzzle(x: number, y: number, z: number, dx: number, dz: number, big = 1) {
    this.glow.spawn({ x, y, z, vx: dx * 6, vz: dz * 6, life: 0.14, size: 3.2 * big, grow: 1.6, color: FLASH });
    this.glow.spawn({ x: x + dx * 1.5, y, z: z + dz * 1.5, vx: dx * 14, vz: dz * 14, life: 0.1, size: 2.2 * big, grow: 2.4, color: FIRE });
    // the bank of powder smoke a broadside leaves hanging over the water
    for (let i = 0; i < this.n(6); i++) {
      const s = 3 + Math.random() * 9;
      this.smoke.spawn({
        x, y, z, vx: dx * s + (Math.random() - 0.5) * 1.8, vy: 0.4 + Math.random() * 1.1, vz: dz * s + (Math.random() - 0.5) * 1.8,
        life: 3 + Math.random() * 2.5, size: (2.2 + Math.random() * 1.4) * big, grow: 4.2, color: SMOKE, alpha: 0.6, drag: 1.2,
      });
    }
  }

  splash(x: number, z: number, t: number, big = false) {
    const y = heightAt(x, z, t);
    const n = this.n(big ? 26 : 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (big ? 3 : 1);
      this.smoke.spawn({
        x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (1 + Math.random() * 2), vy: (big ? 12 : 7) + Math.random() * (big ? 10 : 5), vz: Math.sin(a) * (1 + Math.random() * 2),
        life: 0.9 + Math.random() * 0.5, size: big ? 2.2 : 1.2, grow: 1.8, color: SPRAY, alpha: 0.85, grav: 18,
      });
    }
  }

  /** Shot into timber: splinters and a puff. */
  thud(x: number, y: number, z: number) {
    this.wood.spawn(x, y, z, this.n(3), 6, 0.6);
    this.smoke.spawn({ x, y, z, vy: 1, life: 1.2, size: 2, grow: 2.2, color: DARK, alpha: 0.5, drag: 1 });
    this.glow.spawn({ x, y, z, life: 0.12, size: 2.2, grow: 1.2, color: FLASH });
  }

  /** A ship going up, or a shell landing. */
  explode(x: number, y: number, z: number, big: boolean, t: number) {
    const k = big ? 2 : 1;
    for (let i = 0; i < this.n(8 * k); i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 6 * k;
      this.glow.spawn({ x, y: y + 1, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 8, vz: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, size: 5 * k, grow: 2.2, color: FIRE, drag: 2 });
    }
    for (let i = 0; i < this.n(10 * k); i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3 * k;
      this.smoke.spawn({ x, y: y + 2, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 5, vz: Math.sin(a) * s, life: 3 + Math.random() * 3, size: 5 * k, grow: 4, color: DARK, alpha: 0.7, drag: 0.6 });
    }
    this.wood.spawn(x, y + 1, z, this.n(10 * k), 10 * k, big ? 1.4 : 1);
    this.splash(x, z, t, true);
  }

  /** A damaged ship smoulders: call every frame she is hurt, with how badly. */
  burn(x: number, y: number, z: number, amount: number, dt: number) {
    if (Math.random() > amount * dt * 14 * this.scale) return;
    const j = () => (Math.random() - 0.5) * 3;
    this.smoke.spawn({ x: x + j(), y, z: z + j(), vy: 3 + Math.random() * 2, vx: 1.5, life: 3.5, size: 2.5, grow: 4, color: DARK, alpha: 0.55, drag: 0.4 });
    if (amount > 0.55) this.glow.spawn({ x: x + j(), y, z: z + j(), vy: 2 + Math.random() * 3, life: 0.6, size: 1.8, grow: 0.5, color: FIRE });
  }

  /** The glowing wad behind a Spanish ball, so you can read incoming fire at a glance. */
  ember(x: number, y: number, z: number) {
    this.glow.spawn({ x, y, z, life: 0.22, size: 1.6, grow: 0.3, color: FIRE, alpha: 0.9 });
  }

  trail(x: number, y: number, z: number) {
    this.smoke.spawn({ x, y, z, vy: 0.5, life: 1.2, size: 1.4, grow: 2.2, color: SMOKE, alpha: 0.4, drag: 1 });
  }

  bowSpray(x: number, y: number, z: number, speed: number) {
    if (Math.random() > speed * 0.05 * this.scale) return;
    this.smoke.spawn({
      x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
      life: 0.6, size: 1.2, grow: 1.6, color: SPRAY, alpha: 0.6, grav: 12,
    });
  }

  sparkle(x: number, y: number, z: number, n = 24) {
    for (let i = 0; i < this.n(n); i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 8;
      this.glow.spawn({ x, y: y + 2, z, vx: Math.cos(a) * s, vy: 4 + Math.random() * 8, vz: Math.sin(a) * s, life: 0.9 + Math.random() * 0.6, size: 1.4, grow: 0.4, color: GOLD, grav: 9 });
    }
  }

  update(dt: number, t: number, cam: THREE.Vector3) {
    this.smoke.update(dt);
    this.glow.update(dt);
    this.wood.update(dt, t);
    this.rain.update(dt, cam);
  }

  clear() { this.smoke.clear(); this.glow.clear(); this.wood.clear(); }
}
