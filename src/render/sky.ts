// The sky dome. A gradient from horizon to zenith, the sun and its glow, and two decks of
// cloud drawn on the inside of a sphere that follows the camera: fair-weather cumulus on
// a ceiling, projected so they bunch toward the horizon the way they do, lit by stepping
// toward the sun through their own density — bright where the sun catches their edges,
// grey in their bellies, silver-lined against it — and a thin cirrus deck above. Its
// colours are the ones the fog and the sea's reflection use, so the horizon never seams.

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
float fbm(vec2 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * noise(p); p = p * 2.03 + vec2(1.7, -2.3); a *= 0.5; }
  return s;
}
// Cloud density on the ceiling, 0..1: billows from a warped fbm, thresholded by the cover.
float cloud(vec2 uv, float cover) {
  vec2 q = vec2(fbm(uv * 0.6 + vec2(0.0, uTime * 0.003), 3), fbm(uv * 0.6 + vec2(5.2, 1.3), 3));
  float d = fbm(uv + q * 1.6 + vec2(uTime * 0.006, 0.0), CLOUD_OCT);
  return smoothstep(1.02 - cover, 1.24 - cover * 0.75, d);
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uZenith, pow(y, 0.55)) : mix(uHorizon, uGround, pow(-y, 0.4));
  float sd = max(dot(d, uSunDir), 0.0);
  // the sun's disc, its glare, and the wide warmth round it
  col += uSunColor * (smoothstep(0.9993, 0.99965, sd) * 22.0 + pow(sd, 380.0) * 2.4 + pow(sd, 22.0) * 0.32 + pow(sd, 4.0) * 0.12);
  if (y > 0.0) {
    float fade = smoothstep(0.0, 0.14, y);
    vec2 uv = d.xz / (y + 0.06) * 2.6 + vec2(uTime * 0.006, uTime * 0.003);
    float cover = uCloud;
    float c = cloud(uv, cover) * fade;
    if (c > 0.003) {
      // light: step toward the sun across the ceiling and see how much cloud is in the way
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.14;
      float shade = cloud(uv + toSun, cover) * 0.6 + cloud(uv + toSun * 2.2, cover) * 0.4;
      float lit = clamp(1.2 - shade * 1.15 - c * 0.5, 0.0, 1.0);
      vec3 belly = mix(uZenith, uHorizon, 0.3) * 0.72 + vec3(0.03);
      vec3 top = uSunColor * 1.05 + uHorizon * 0.2;
      vec3 cc = mix(belly, top, lit);
      // thin edges against the sun shine
      cc += uSunColor * pow(sd, 6.0) * (1.0 - c) * 1.4;
      // storm cloud is darker all through
      cc *= 1.0 - smoothstep(0.7, 0.95, cover) * 0.45;
      col = mix(col, cc, c * 0.96);
    }
    // a high thin deck of cirrus, streaked by the wind aloft
    vec2 cu = d.xz / (y + 0.2) * vec2(0.5, 1.8) + vec2(uTime * 0.001, 0.0);
    float ci = smoothstep(0.55, 0.85, fbm(cu, 4)) * fade * (0.25 + uCloud * 0.3);
    col = mix(col, mix(uHorizon, uSunColor, 0.4 + 0.5 * pow(sd, 3.0)) * 1.05, ci * 0.45 * (1.0 - c));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(high = true) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false,
      defines: { CLOUD_OCT: high ? 5 : 4 },
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
