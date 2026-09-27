// The sea. One polar grid that follows the camera — dense under the ship, thinning out
// to the horizon — displaced by the Gerstner swell in the vertex shader and shaded in
// the fragment shader: depth from a baked distance-to-shore texture, sky in the Fresnel,
// the sun's glint, foam on the crests and in the surf round every island and reef.

import * as THREE from 'three';
import type { GameMap } from '../sim/map';
import { EDGE, MAP_R, shoreDist } from '../sim/map';
import type { Air } from './atmosphere';
import { packed, seaUniforms, swell } from './waves';

const SHORE_SIZE = 2400;             // metres covered by the shore texture, centred on 0,0
const SHORE_RES = 256;
/** Hulls the sea knows about, for the foam where each meets the water. */
export const MAX_HULLS = 16;

const vert = /* glsl */ `
uniform float uTime, uAmp;
uniform vec4 uWA[4];
uniform vec2 uWB[4];
uniform vec2 uCenter;
varying vec3 vWorld;
varying vec3 vN;
varying float vCrest;
void main() {
  vec2 xz = position.xz + uCenter;
  vec3 P = vec3(xz.x, 0.0, xz.y);
  vec3 N = vec3(0.0, 1.0, 0.0);
  float crest = 0.0;
  // Far out, the swell fades flat: the grid is too coarse there to carry it, and the
  // fog would hide it anyway.
  float fade = 1.0 - smoothstep(500.0, 1600.0, length(position.xz));
  for (int i = 0; i < 4; i++) {
    float A = uWB[i].x * uAmp * fade;
    float Q = uWB[i].y / max(uAmp, 1.0);
    vec2 D = uWA[i].xy;
    float k = uWA[i].z, w = uWA[i].w;
    float f = k * dot(D, xz) - w * uTime;
    float c = cos(f), s = sin(f);
    P.x += Q * A * D.x * c;
    P.z += Q * A * D.y * c;
    P.y += A * s;
    N.x -= D.x * k * A * c;
    N.z -= D.y * k * A * c;
    N.y -= Q * k * A * s;
    crest += A * s;
  }
  vN = normalize(N);
  vCrest = crest / max(uAmp, 0.3);
  vWorld = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uDeep, uShallow, uFoam, uZenith, uHorizon, uSunDir, uSunColor;
uniform float uTime, uFogNear, uFogFar, uSunI, uDetail;
uniform sampler2D uShore;
uniform vec3 uShoreRect;
uniform vec4 uHulls[${MAX_HULLS}];   // x, z, heading, half-length at the waterline
uniform vec4 uHullB[${MAX_HULLS}];   // half-beam, -, way (0..1), reach squared
uniform int uHullN;
uniform vec2 uRim;                   // where the rim current starts, and the chart's edge
varying vec3 vWorld;
varying vec3 vN;
varying float vCrest;

// The lattice is wrapped before it is hashed: a sea whose clock has run for an hour puts
// lattice coordinates in the hundreds of thousands, where a float has too few bits left
// for the hash and the foam goes blocky.
float hash(vec2 p) { p = fract(mod(p, 289.0) * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Small ripples as a slope, from two drifting layers of noise. Cheap, and enough to break
// the big waves' clean highlights into the sparkle a real sea has.
vec2 ripples(vec2 p, float t) {
  vec2 a = p * 0.45 + vec2(t * 0.35, t * 0.21);
  float e = 0.25;
#ifdef BF_LOW
  // one layer on a phone: the sea is most of the screen and every noise here is per pixel
  float n0 = noise(a), nx = noise(a + vec2(e, 0.0)), nz = noise(a + vec2(0.0, e));
#else
  vec2 b = p * 1.1 + vec2(-t * 0.27, t * 0.4);
  float n0 = noise(a) + 0.5 * noise(b);
  float nx = noise(a + vec2(e, 0.0)) + 0.5 * noise(b + vec2(e * 2.4, 0.0));
  float nz = noise(a + vec2(0.0, e)) + 0.5 * noise(b + vec2(0.0, e * 2.4));
#endif
  return vec2(n0 - nx, n0 - nz) * 1.6;
}

// The rim current's streaks: long along the way it runs, thin across it. Measured in arc
// length round the chart, so they are the same size wherever you meet them.
float rimStreak(float along, float rr) {
  vec2 q = vec2(along * 0.02 + uTime * 0.15, rr * 0.5);
  return smoothstep(0.64, 0.9, noise(q) * 0.6 + noise(q * vec2(2.7, 2.1) + 4.7) * 0.42);
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  vec2 rp = ripples(vWorld.xz, uTime) * uDetail * (1.0 - smoothstep(60.0, 420.0, dist));
  vec3 N = normalize(vN + vec3(rp.x, 0.0, rp.y) * 0.22);

  vec2 suv = (vWorld.xz - uShoreRect.xy) / uShoreRect.z;
  float sd = texture2D(uShore, suv).r;          // 0.2 is the coastline, 1 is open ocean
  float depth = smoothstep(0.2, 0.62, sd);

  vec3 water = mix(uShallow, uDeep, depth);
  // Light on a sandy bottom: in the shallows the sea is paler, and caustics play over it.
  float shoal = 1.0 - smoothstep(0.2, 0.34, sd);
  water = mix(water, uShallow * vec3(1.18, 1.12, 0.92), shoal * 0.5);
#ifndef BF_LOW
  vec2 cp = vWorld.xz * 0.32;
  float c1 = noise(cp + vec2(uTime * 0.31, uTime * 0.17));
  float c2 = noise(cp * 1.37 + vec2(-uTime * 0.23, uTime * 0.29) + 7.3);
  float caus = pow(max(0.0, 1.0 - abs(c1 - c2) * 3.2), 5.0);
  water += uShallow * caus * 0.45 * (1.0 - depth) * uDetail;
#endif
  // Light through the crest of a wave, green in the shallows and teal in the deep.
  float sss = clamp(vCrest * 0.7 + 0.25, 0.0, 1.0);
  water += uShallow * sss * 0.22 * (1.0 - depth * 0.4);
  float ndl = max(dot(N, uSunDir), 0.0);
  water *= 0.6 + 0.4 * ndl;

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(R.y, 0.6));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(water, sky, fres * 0.85);
  // The glint uses the big waves only — with the ripples in, a high sun turns the whole
  // play area into a mirror and you cannot see a ship on it.
  vec3 Rs = reflect(-V, normalize(vN + vec3(rp.x, 0.0, rp.y) * 0.06));
  float spec = pow(max(dot(Rs, uSunDir), 0.0), 600.0);
  col += uSunColor * spec * uSunI * 0.55;

  // Foam: on the crests, and in bands of surf running in to every coast and reef.
  float n = noise(vWorld.xz * 0.18 + vec2(uTime * 0.12, -uTime * 0.07));
  float n2 = noise(vWorld.xz * 0.6 - uTime * 0.2);
  float crestFoam = smoothstep(0.78, 1.05, vCrest * 0.5 + n * 0.3 + n2 * 0.25) * smoothstep(0.35, 0.7, n2);
  // Surf: a lacy swash line where the sea runs up the sand, and waves breaking as they
  // come in over the shelf — each a bright front with foam trailing behind it, broken into
  // lengths, never a ring.
#ifdef BF_LOW
  float lace = smoothstep(0.3, 0.75, n * 0.45 + n2 * 0.65);
#else
  float lace = smoothstep(0.3, 0.75, noise(vWorld.xz * 0.9 + uTime * 0.4) * 0.6 + n2 * 0.5);
#endif
  float swash = (1.0 - smoothstep(0.2, 0.232 + n * 0.02 + sin(uTime * 1.1 + n * 6.0) * 0.006, sd)) * (0.55 + 0.45 * lace);
  float ph = fract(sd * 7.5 + uTime * 0.22 + n * 0.35);
  float breaker = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.04, 0.42, ph));
  float lengths = smoothstep(0.42, 0.7, noise(vWorld.xz * 0.045 + vec2(uTime * 0.05, 0.0)) + n2 * 0.25);
  float near = 1.0 - smoothstep(0.215, 0.42, sd);
  float surf = max(swash, breaker * lengths * near * (0.5 + 0.5 * lace));
  // Where a hull meets the sea: a collar of broken water hugging her, pushed up into a
  // bow wave as she gathers way, and the water in her lee a shade darker.
  float collar = 0.0, lee = 0.0;
  for (int i = 0; i < ${MAX_HULLS}; i++) {
    if (i >= uHullN) break;
    vec4 H = uHulls[i], B = uHullB[i];
    vec2 d = vWorld.xz - H.xy;
    if (dot(d, d) > B.w) continue;
    vec2 f = vec2(cos(H.z), sin(H.z));
    vec2 l = vec2(dot(d, f), dot(d, vec2(-f.y, f.x)));
    float e = length(l / vec2(H.w, B.x));
    float fwd = smoothstep(-0.2, 1.0, l.x / H.w);
    float wide = 1.16 + fwd * B.z * 0.55;
    collar = max(collar, (1.0 - smoothstep(0.97, wide, e)) * smoothstep(0.8, 0.98, e) * (0.28 + B.z * 0.85 * fwd));
    lee = max(lee, 1.0 - smoothstep(0.9, 2.1, e));
  }
  col *= 1.0 - lee * 0.22;
#ifdef BF_LOW
  float froth = smoothstep(0.35, 0.8, n2 * 0.75 + n * 0.5);
#else
  float froth = smoothstep(0.35, 0.8, n2 * 0.75 + noise(vWorld.xz * 1.7 + uTime * 0.6) * 0.5);
#endif
  float foam = clamp(max(max(crestFoam * 0.4, surf) * (0.75 + n2 * 0.35), collar * froth * 1.3), 0.0, 1.0);
  // The edge of the chart: a current racing round the world, darker and streaked white,
  // so a captain sees it coming instead of finding it by feel. Two angles, each seamed on
  // the far side from the other, and blended, so the streaks have no join.
  float rr = length(vWorld.xz);
  float rimK = smoothstep(uRim.x - 70.0, uRim.x + 15.0, rr);
  if (rimK > 0.0) {
    float a1 = atan(vWorld.z, vWorld.x), a2 = atan(-vWorld.z, -vWorld.x);
    float streak = mix(rimStreak(a1 * rr, rr), rimStreak(a2 * rr, rr), smoothstep(0.55, 0.85, abs(a1) / 3.14159265));
    col = mix(col, col * vec3(0.62, 0.74, 0.84), rimK * 0.6);
    foam = max(foam, streak * rimK * (0.4 + 0.3 * n2));
  }
  col = mix(col, uFoam * (0.7 + 0.3 * ndl), foam);

  float fog = smoothstep(uFogNear, uFogFar, dist);
  // and past it, a wall of sea mist: the world stops, and says so
  fog = max(fog, smoothstep(uRim.y - 40.0, uRim.y + 110.0, rr) * 0.9);
  col = mix(col, uHorizon, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A disc of rings and spokes, dense at the middle. Rings are spaced linearly near the
 *  centre (where the ship is) and then fall off fast toward the horizon. */
function polarGrid(rings: number, spokes: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  const radius = (i: number) => 2.6 * i + 2600 * Math.pow(i / rings, 4);
  for (let i = 1; i <= rings; i++) {
    const r = radius(i);
    for (let j = 0; j < spokes; j++) {
      const a = (j / spokes) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < spokes; j++) idx.push(0, 1 + ((j + 1) % spokes), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * spokes, a1 = 1 + i * spokes;
    for (let j = 0; j < spokes; j++) {
      const j1 = (j + 1) % spokes;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class Ocean {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  shore: THREE.DataTexture;
  private shoreKey = '';

  constructor(high: boolean) {
    const data = new Uint8Array(SHORE_RES * SHORE_RES).fill(255);
    this.shore = new THREE.DataTexture(data, SHORE_RES, SHORE_RES, THREE.RedFormat, THREE.UnsignedByteType);
    this.shore.magFilter = THREE.LinearFilter;
    this.shore.minFilter = THREE.LinearFilter;
    this.shore.wrapS = this.shore.wrapT = THREE.ClampToEdgeWrapping;
    this.shore.needsUpdate = true;

    const count = high ? 4 : 3;
    swell.count = count;
    const { a, b } = packed(count);
    seaUniforms.uWA.value.forEach((v, i) => v.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]));
    seaUniforms.uWB.value.forEach((v, i) => v.set(b[i * 2], b[i * 2 + 1]));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      defines: high ? {} : { BF_LOW: '' },
      uniforms: {
        ...seaUniforms, uCenter: { value: new THREE.Vector2() },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunI: { value: 1 },
        uFogNear: { value: 300 }, uFogFar: { value: 1500 }, uDetail: { value: high ? 1 : 0.6 },
        uShore: { value: this.shore },
        uHulls: { value: Array.from({ length: MAX_HULLS }, () => new THREE.Vector4()) },
        uHullB: { value: Array.from({ length: MAX_HULLS }, () => new THREE.Vector4()) },
        uHullN: { value: 0 },
        uShoreRect: { value: new THREE.Vector3(-SHORE_SIZE / 2, -SHORE_SIZE / 2, SHORE_SIZE) },
        uRim: { value: new THREE.Vector2(MAP_R - EDGE, MAP_R) },
      },
    });
    this.mesh = new THREE.Mesh(high ? polarGrid(190, 160) : polarGrid(130, 112), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** The hulls afloat this frame: where each is, which way she heads, how long and broad
   *  she is at the waterline, and how much way she has on, 0..1. */
  private hullN = 0;
  beginHulls() { this.hullN = 0; }
  hull(x: number, z: number, h: number, len: number, beam: number, way: number) {
    if (this.hullN >= MAX_HULLS) return;
    const u = this.mat.uniforms;
    const hl = len * 0.47, hb = beam * 0.5;
    const reach = hl * 1.8 + 4;
    u.uHulls.value[this.hullN].set(x, z, h, hl);
    u.uHullB.value[this.hullN].set(hb, 0, Math.min(1, Math.max(0, way)), reach * reach);
    this.hullN++;
  }
  endHulls() { this.mat.uniforms.uHullN.value = this.hullN; }

  /** Bake distance-to-shore for a chart. Once per run; a few tens of milliseconds. */
  bakeShore(m: GameMap) {
    if (this.shoreKey === m.seed) return;
    this.shoreKey = m.seed;
    const d = this.shore.image.data as Uint8Array;
    for (let j = 0; j < SHORE_RES; j++) {
      for (let i = 0; i < SHORE_RES; i++) {
        const x = -SHORE_SIZE / 2 + ((i + 0.5) / SHORE_RES) * SHORE_SIZE;
        const z = -SHORE_SIZE / 2 + ((j + 0.5) / SHORE_RES) * SHORE_SIZE;
        const sd = shoreDist(m, x, z);
        // coast at 0.2, open water by 80m out
        d[j * SHORE_RES + i] = Math.round(Math.min(1, Math.max(0, 0.2 + sd / 100)) * 255);
      }
    }
    this.shore.needsUpdate = true;
  }

  update(t: number, air: Air, cx: number, cz: number) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uAmp.value = air.swell;
    swell.amp = air.swell;
    // Snap the grid's centre so its vertices do not swim across the swell as it follows.
    u.uCenter.value.set(Math.round(cx / 8) * 8, Math.round(cz / 8) * 8);
    u.uDeep.value.copy(air.deep); u.uShallow.value.copy(air.shallow); u.uFoam.value.copy(air.foam);
    u.uZenith.value.copy(air.zenith); u.uHorizon.value.copy(air.horizon);
    u.uSunDir.value.copy(air.sun); u.uSunColor.value.copy(air.sunColor); u.uSunI.value = air.sunIntensity;
    u.uFogNear.value = air.fogNear; u.uFogFar.value = air.fogFar;
  }
}
