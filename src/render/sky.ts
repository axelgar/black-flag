// The sky dome. A gradient from horizon to zenith, the sun and its halo, and a layer of
// drifting cloud — drawn on the inside of a sphere that follows the camera. Its colours
// are the same ones the fog and the sea's reflection use, so the horizon never shows a seam.

import * as THREE from 'three';
import type { Air } from './atmosphere';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uTime, uCloud;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uZenith, pow(y, 0.55)) : mix(uHorizon, uGround, pow(-y, 0.4));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 30.0 + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.12);
  if (y > 0.0) {
    // Clouds on a flat ceiling, projected, so they bunch toward the horizon the way they do.
    vec2 uv = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float c = fbm(uv);
    float cover = smoothstep(1.0 - uCloud * 0.75, 1.15 - uCloud * 0.5, c) * smoothstep(0.0, 0.2, y);
    vec3 cc = mix(uHorizon * 1.1, vec3(1.0), 0.5) * (0.75 + 0.35 * pow(sd, 4.0));
    cc = mix(cc, uZenith * 0.8, uCloud * 0.45);
    col = mix(col, cc, cover * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
        uTime: { value: 0 }, uCloud: { value: 0.3 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
  }
  update(t: number, air: Air, cam: THREE.Vector3) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uZenith.value.copy(air.zenith); u.uHorizon.value.copy(air.horizon); u.uGround.value.copy(air.ground);
    u.uSunDir.value.copy(air.sun); u.uSunColor.value.copy(air.sunColor); u.uCloud.value = air.cloud;
    this.mesh.position.copy(cam);
  }
}
