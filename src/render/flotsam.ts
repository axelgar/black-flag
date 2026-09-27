// What floats, and what spins on the sea. Cargo out of a wreck bobs on the swell where it
// went down — a rum barrel, a crate of shells, a powder keg, heavy shot, chain, a raft with
// a swivel gun on it — each ringed in gold on the water so you can find it and sail through
// it. Waterspouts are funnels of spray, pinched at the waist and spreading into the cloud,
// streaming round as they drift, with the sea boiling at their foot.

import * as THREE from 'three';
import type { DropId } from '../data/drops';
import type { World } from '../sim/types';
import { Fx } from './fx';
import { timberMaterial } from './ships/materials';
import { FIN, Mesh, at } from './ships/mesh';
import { textures } from './ships/procedural';
import { SEA_HEIGHT, heightAt, seaUniforms } from './waves';

const KINDS: DropId[] = ['rum', 'shells', 'powder', 'heavy', 'chain', 'swivel'];
const MAX = 12;

function barrel(m: Mesh, len: number, rad: number, wood: string, band: string) {
  m.push(at(0, 0, 0, 0, Math.PI / 2));             // on its side, bung up
  m.paint(wood, FIN.wood).lathe([[rad * 0.82, -len / 2], [rad, -len * 0.2], [rad * 1.03, 0], [rad, len * 0.2], [rad * 0.82, len / 2]], 10, true);
  m.paint(band, FIN.iron);
  for (const k of [-0.36, 0.36]) m.push(at(0, len * k, 0)).lathe([[rad * 0.99, -0.04], [rad * 1.04, 0.04]], 10, false).pop();
  m.pop();
}

function crate(m: Mesh, s: number, wood: string) {
  m.paint(wood, FIN.planks).box(s, s * 0.7, s * 0.8);
  m.paint('#2A2420', FIN.iron);
  for (const k of [-0.32, 0.32]) m.push(at(k * s, 0, 0)).box(0.06, s * 0.72, s * 0.82).pop();
}

/** One mesh per kind of cargo, built once. */
function cargo(kind: DropId): THREE.BufferGeometry {
  const m = new Mesh();
  if (kind === 'rum') barrel(m, 1.5, 0.55, '#6A4A2A', '#2A2420');
  else if (kind === 'powder') { barrel(m, 1.1, 0.46, '#3E3228', '#8E2B24'); m.paint('#8E2B24', FIN.paint).push(at(0, 0.47, 0)).box(0.5, 0.05, 0.3).pop(); }
  else if (kind === 'shells') {
    crate(m, 1.4, '#7A6448');
    m.paint('#1E1C1A', FIN.iron);
    for (const x of [-0.3, 0.3]) m.push(at(x, 0.62, 0)).lathe([[0.02, -0.28], [0.26, -0.12], [0.28, 0.05], [0.18, 0.22], [0.02, 0.28]], 8, true).pop();
  } else if (kind === 'heavy') {
    crate(m, 1.3, '#6B5134');
    m.paint('#1E1C1A', FIN.iron);
    for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [0, 0.22]]) m.push(at(x, 0.62, z)).lathe([[0.02, -0.2], [0.2, 0], [0.02, 0.2]], 8, true).pop();
  } else if (kind === 'chain') {
    crate(m, 1.3, '#5E4A34');
    m.paint('#2A2622', FIN.iron);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, b = ((i + 1) / 12) * Math.PI * 2;
      m.cyl([Math.cos(a) * 0.38, 0.55, Math.sin(a) * 0.38], [Math.cos(b) * 0.38, 0.55, Math.sin(b) * 0.38], 0.07, 0.07, 5);
    }
  } else {
    // a raft of spars with a swivel gun on a post
    m.paint('#6E5A40', FIN.wood);
    for (let i = -2; i <= 2; i++) m.cyl([-1.4, 0, i * 0.34], [1.4, 0, i * 0.34], 0.16, 0.16, 6, true);
    m.paint('#4A3A2A', FIN.wood).cyl([0, 0.1, 0], [0, 0.9, 0], 0.08, 0.08, 6);
    m.paint('#1E1C1A', FIN.iron).cyl([-0.5, 0.95, 0], [0.6, 1.0, 0], 0.09, 0.06, 7, true);
  }
  return m.geometry();
}

/* --------------------------------------------------------------- spouts --- */

const spoutVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vFog;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const spoutFrag = /* glsl */ `
uniform float uTime, uFogNear, uFogFar;
uniform vec3 uColor, uFogColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vFog;
float h21(vec2 p) { p = fract(mod(p, 289.0) * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  // streaks spiralling up the funnel, the whole of it turning
  vec2 p = vec2(vUv.x * 8.0 + vUv.y * 5.0 - uTime * 1.6, vUv.y * 3.0 - uTime * 0.9);
  float s = vn(p) * 0.6 + vn(p * 2.3 + 3.1) * 0.4;
  float rim = pow(max(1.0 - abs(dot(vN, vV)), 0.0), 1.4);
  float ends = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float a = (0.18 + rim * 0.62) * (0.45 + s * 0.8) * ends;
  vec3 col = mix(uColor * 0.62, uColor, s);
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vFog) * 0.8);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A funnel: wide at the sea, pinched at the waist, flaring into the cloud. Height 1. */
function funnel(): THREE.BufferGeometry {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = 1.25 * Math.exp(-t * 14) + 0.34 + 0.2 * t + 1.4 * Math.pow(t, 3.2);
    prof.push(new THREE.Vector2(r, t));
  }
  return new THREE.LatheGeometry(prof, 20);
}

/* ---------------------------------------------------------------- whole --- */

export class Flotsam {
  group = new THREE.Group();
  private kinds = new Map<DropId, THREE.InstancedMesh>();
  private rings: THREE.InstancedMesh;
  private ringMat: THREE.ShaderMaterial;
  private spouts: THREE.Mesh[] = [];
  private spoutMat: THREE.ShaderMaterial;
  private spoutGeo = funnel();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private flat = new THREE.Quaternion();
  private ringS = new THREE.Vector3();
  private counts = new Map<DropId, number>();

  constructor(high: boolean) {
    const tex = textures();
    const mat = timberMaterial(tex.timber, high);
    for (const k of KINDS) {
      const im = new THREE.InstancedMesh(cargo(k), mat, MAX);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = high;
      this.kinds.set(k, im);
      this.group.add(im);
    }
    // a gold ring on the water round each piece of cargo, breathing so the eye finds it
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...seaUniforms, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `${SEA_HEIGHT}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  wp.y = seaHeight(wp.xz) + 0.15 + 0.3 * uAmp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
      fragmentShader: /* glsl */ `uniform float uPulse; varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float pulse = 0.5 + 0.5 * sin(uPulse * 3.0);
  float ring = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
  float a = ring * (0.35 + 0.35 * pulse) + (1.0 - smoothstep(0.0, 0.8, r)) * 0.08;
  gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const plane = new THREE.PlaneGeometry(1, 1, 6, 6);
    plane.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(plane, this.ringMat, MAX * KINDS.length);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    this.group.add(this.rings);

    this.spoutMat = new THREE.ShaderMaterial({
      vertexShader: spoutVert, fragmentShader: spoutFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uColor: { value: new THREE.Color('#DDE6E4') },
        uFogColor: { value: new THREE.Color() }, uFogNear: { value: 300 }, uFogFar: { value: 1500 },
      },
    });
    // one funnel from the start, hidden, so its program is compiled with everything else
    // and not on the frame the first waterspout rises
    this.spout();
  }

  private spout(): THREE.Mesh {
    const sm = new THREE.Mesh(this.spoutGeo, this.spoutMat);
    sm.renderOrder = 2;
    sm.visible = false;
    this.spouts.push(sm);
    this.group.add(sm);
    return sm;
  }

  sync(w: World, t: number, fx: Fx, fog: THREE.Fog) {
    this.ringMat.uniforms.uPulse.value = t;
    const counts = this.counts;
    counts.clear();
    let rings = 0;
    for (const d of w.drops) {
      if (d.dead) continue;
      const im = this.kinds.get(d.kind);
      if (!im) continue;
      const n = counts.get(d.kind) ?? 0;
      if (n >= MAX) continue;
      counts.set(d.kind, n + 1);
      const y = heightAt(d.x, d.y, t);
      // it bobs, rolls and turns slowly on the swell, and settles in from above as it surfaces
      const rise = Math.min(1, d.age / 1.2);
      this.e.set(Math.sin(t * 1.3 + d.id) * 0.18, d.id * 1.7 + t * 0.12, Math.sin(t * 1.1 + d.id * 2.3) * 0.2);
      this.q.setFromEuler(this.e);
      this.v.set(d.x, y + 0.15 - (1 - rise) * 1.5, d.y);
      im.setMatrixAt(n, this.m.compose(this.v, this.q, this.s));
      const size = 7 + Math.sin(t * 3 + d.id) * 0.4;
      this.v.set(d.x, y + 0.08, d.y);
      this.rings.setMatrixAt(rings++, this.m.compose(this.v, this.flat, this.ringS.set(size, 1, size)));
      // it fades out of sight in the last seconds before it sinks
      if (d.age > 36 && Math.floor(t * 8) % 2) im.setMatrixAt(n, this.m.makeScale(0, 0, 0));
    }
    for (const [k, im] of this.kinds) {
      im.count = counts.get(k) ?? 0;
      im.visible = im.count > 0;
      if (im.count) im.instanceMatrix.needsUpdate = true;
    }
    this.rings.count = rings;
    this.rings.visible = rings > 0;
    if (rings) this.rings.instanceMatrix.needsUpdate = true;

    // spouts
    const u = this.spoutMat.uniforms;
    u.uTime.value = t;
    u.uFogColor.value.copy(fog.color); u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
    while (this.spouts.length < w.spouts.length) this.spout();
    this.spouts.forEach((sm, i) => {
      const p = w.spouts[i];
      sm.visible = !!p;
      if (!p) return;
      const grow = Math.min(1, p.age / 3) * Math.min(1, (p.life - p.age) / 3);
      const H = 90 * grow;
      sm.position.set(p.x, heightAt(p.x, p.y, t) - 0.5, p.y);
      sm.scale.set(p.r * grow, Math.max(0.01, H), p.r * grow);
      sm.rotation.y = t * 1.3;
      // the sea boiling at its foot
      if (grow > 0.3 && Math.random() < 0.9) fx.spray(p.x, p.y, p.r, t);
    });
  }

  clear() {
    for (const im of this.kinds.values()) { im.count = 0; im.visible = false; }
    this.rings.count = 0;
    this.rings.visible = false;
    for (const sm of this.spouts) sm.visible = false;
  }
}
