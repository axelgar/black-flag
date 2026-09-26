// The swell. One set of Gerstner waves, described once, evaluated twice: on the GPU to
// move the ocean's vertices, and here on the CPU so a hull rides the same water the sea
// is drawn with. Render-only — the simulation's sea is flat, which is what keeps it
// cheap and deterministic.

import * as THREE from 'three';

export interface Wave { dir: number; len: number; amp: number; steep: number }

export const WAVES: Wave[] = [
  { dir: 0.35, len: 62, amp: 0.55, steep: 0.55 },
  { dir: 1.25, len: 36, amp: 0.34, steep: 0.5 },
  { dir: -0.55, len: 22, amp: 0.2, steep: 0.45 },
  { dir: 2.35, len: 13, amp: 0.1, steep: 0.4 },
];

const G = 9.81;

/** Per-wave constants packed the way the shader wants them: (dx, dz, k, ω) and (A, Q). */
export function packed(count: number) {
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const w = WAVES[i];
    const on = i < count;
    const k = (Math.PI * 2) / w.len;
    a.push(Math.cos(w.dir), Math.sin(w.dir), k, Math.sqrt(G * k));
    b.push(on ? w.amp : 0, on ? w.steep / (k * w.amp * count) : 0);
  }
  return { a, b };
}

export const swell = { amp: 1, count: 4 };

/** The swell as shader uniforms, shared by the sea and by everything painted on it, so a
 *  mark on the water rides the same waves the water is drawn with. The ocean owns and
 *  updates them; everyone else reads. */
export const seaUniforms = {
  uTime: { value: 0 },
  uAmp: { value: 1 },
  uWA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
  uWB: { value: [0, 1, 2, 3].map(() => new THREE.Vector2()) },
};

/** GLSL: the height of the sea at a world xz, from the shared uniforms. */
export const SEA_HEIGHT = /* glsl */ `
uniform float uTime, uAmp;
uniform vec4 uWA[4];
uniform vec2 uWB[4];
float seaHeight(vec2 xz) {
  float y = 0.0;
  for (int i = 0; i < 4; i++) y += uWB[i].x * uAmp * sin(uWA[i].z * dot(uWA[i].xy, xz) - uWA[i].w * uTime);
  return y;
}`;

/** Height of the sea at a point. Ignores the horizontal part of the Gerstner motion,
 *  which at these steepnesses is a few centimetres of error nobody on a deck will feel. */
export function heightAt(x: number, z: number, t: number): number {
  let y = 0;
  for (let i = 0; i < swell.count; i++) {
    const w = WAVES[i];
    const k = (Math.PI * 2) / w.len;
    const f = k * (Math.cos(w.dir) * x + Math.sin(w.dir) * z) - Math.sqrt(G * k) * t;
    y += w.amp * Math.sin(f);
  }
  return y * swell.amp;
}

/** How a hull sits on that sea: heave, and the pitch and roll between bow, stern and beam. */
export function ride(x: number, z: number, h: number, len: number, beam: number, t: number) {
  const fx = Math.cos(h), fz = Math.sin(h);
  const l = len * 0.4, b = beam * 0.6;
  const bow = heightAt(x + fx * l, z + fz * l, t), stern = heightAt(x - fx * l, z - fz * l, t);
  const star = heightAt(x - fz * b, z + fx * b, t), port = heightAt(x + fz * b, z - fx * b, t);
  // Big hulls bridge the small waves: damp by length, so a man-o-war wallows and a
  // lancha bounces, the way they should.
  const damp = Math.min(1, 26 / len);
  return {
    heave: (bow + stern + star + port) * 0.25,
    pitch: Math.atan2(bow - stern, len * 0.8) * (0.6 + damp * 0.4),
    roll: Math.atan2(star - port, beam * 1.2) * (0.35 + damp * 0.3),
  };
}
