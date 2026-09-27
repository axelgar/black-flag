// The shaders a ship is drawn with. Four programs serve every hull afloat, however many
// there are:
//
//   timber   hull, decks, spars, guns, gilt and glass, in one draw. Colour is per vertex;
//            the grain comes from the shared timber map; and two small per-vertex
//            channels say what a face is made of and whether it is a port lid or a gun,
//            which the vertex shader swings open and runs out. Shot chars her in patches.
//   canvas   sails: they fill, luff and flap; rag and hole as she is shot; and glow where
//            the sun is behind them.
//   rope     rigging: each line is a ribbon, widened in the vertex shader to at least a
//            pixel and faded by how much of that pixel it really covers, so a shroud a
//            hundred metres off is a hairline and not a crawl of broken dashes.
//   bunting  flags and pennants, streaming.
//
// All of them are three.js's own standard or basic materials with a few lines spliced in,
// so the sun, the sky's light, shadows and fog reach them the way they reach everything.

import * as THREE from 'three';

/** One clock for every sail and flag. */
export const shipTime = { value: 0 };
/** World metres a pixel covers at one metre from the camera. */
export const ropePixel = { value: 0.0015 };
/** How lit the windows and lanterns are: a glow by day, bright at dusk and in weather. */
export const lampGlow = { value: 0.5 };
/** Rope takes no light of its own; this tints it to the sky's. */
export const ropeShade = { value: new THREE.Color(1, 1, 1) };

const NOISE = /* glsl */ `
float bfHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bfNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bfHash(i), bfHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(bfHash(i + vec3(0.0, 1.0, 0.0)), bfHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(bfHash(i + vec3(0.0, 0.0, 1.0)), bfHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(bfHash(i + vec3(0.0, 1.0, 1.0)), bfHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;

/** A ship leaving the chart dissolves rather than popping: an ordered dither against the
 *  fade, so she needs no blending, no sorting and no second program to go. */
const FADE = /* glsl */ `
uniform float uFade;
float bfBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bfBayer(vec2 a) { return bfBayer2(0.5 * a) * 0.25 + bfBayer2(a); }`;
const FADE_CUT = /* glsl */ `if (uFade < 0.999 && bfBayer(gl_FragCoord.xy) >= uFade) discard;`;
const HULL_FADE_CUT = /* glsl */ `
#ifdef BF_FADE
${FADE_CUT}
#endif`;

/** Fog, scaled per material: the player's own ship keeps her colours in a fog bank. */
const FOG = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * uFogK);
#endif`;

/* --------------------------------------------------------------- timber --- */

export interface TimberUniforms {
  uPorts: { value: THREE.Vector4 };   // lids larboard, lids starboard, guns larboard, guns starboard (0 in, 1 out)
  uGlow: { value: THREE.Vector2 };    // light in the ports, larboard and starboard
  uScorch: { value: number };
  uFogK: { value: number };
  uFade: { value: number };
}

export function timberMaterial(map: THREE.Texture, bump: boolean, masonry?: THREE.Texture): THREE.MeshStandardMaterial & { userData: { u: TimberUniforms } } {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  const u: TimberUniforms = {
    uPorts: { value: new THREE.Vector4(0, 0, 0, 0) },
    uGlow: { value: new THREE.Vector2(0, 0) },
    uScorch: { value: 0 },
    uFogK: { value: 1 },
    uFade: { value: 1 },
  };
  m.userData.u = u;
  m.defines = {};
  if (bump) m.defines.BF_BUMP = '';
  if (masonry) m.defines.BF_MASONRY = '';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTimber: { value: map }, uMasonry: { value: masonry ?? map }, uLamp: lampGlow });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec4 aMat;
attribute vec4 aAnim;
attribute vec2 aTuv;
uniform vec4 uPorts;
varying vec4 vMat;
varying vec2 vTuv;
varying vec3 vLocal;
varying float vPort;`)
      .replace('#include <beginnormal_vertex>', /* glsl */ `#include <beginnormal_vertex>
// A lid swings about its hinge, which runs fore and aft along the top of the port.
float bfSide = aAnim.y;
bool bfLid = aAnim.x > 0.5 && aAnim.x < 1.5;
float bfAng = bfLid ? -bfSide * (bfSide > 0.0 ? uPorts.y : uPorts.x) * 1.3 : 0.0;
float bfC = cos(bfAng), bfS = sin(bfAng);
objectNormal.yz = vec2(objectNormal.y * bfC - objectNormal.z * bfS, objectNormal.y * bfS + objectNormal.z * bfC);`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
if (bfLid) {
  vec2 d = transformed.yz - aAnim.zw;
  transformed.yz = aAnim.zw + vec2(d.x * bfC - d.y * bfS, d.x * bfS + d.y * bfC);
} else if (aAnim.x > 1.5 && aAnim.x < 2.5) {
  // a gun runs out through her port, and recoils in when she fires
  float run = bfSide > 0.0 ? uPorts.w : uPorts.z;
  transformed.z -= bfSide * (1.0 - run) * aAnim.z;
}
vPort = aAnim.x > 2.5 ? (bfSide > 0.0 ? 1.0 : 0.0) : -1.0;
vMat = aMat;
float bfK = aMat.z;
vTuv = aTuv / (bfK < 0.5 ? vec2(8.0, 4.0) : bfK < 1.5 ? vec2(8.0, 4.8) : bfK < 2.5 ? vec2(4.0, 1.2) : bfK < 4.5 ? vec2(16.0)
  : bfK < 5.5 ? vec2(4.0) : bfK < 6.5 ? vec2(4.0, 5.6) : vec2(3.0));
vLocal = position;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform sampler2D uTimber;
uniform sampler2D uMasonry;
uniform vec2 uGlow;
uniform float uScorch, uLamp, uFogK;
varying vec4 vMat;
varying vec2 vTuv;
varying vec3 vLocal;
varying float vPort;
${NOISE}
${FADE}
float bfPick(vec4 t, vec4 t2, float k) {
  return k < 0.5 ? t.r : k < 1.5 ? t.g : k < 2.5 ? t.b : k < 3.5 ? t.a : k < 4.5 ? 1.0
    : k < 5.5 ? t2.r : k < 6.5 ? t2.g : k < 7.5 ? t2.b : t2.a;
}
vec3 bfBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos)), vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
${HULL_FADE_CUT}
vec4 bfTex = texture2D(uTimber, vTuv);
#ifdef BF_MASONRY
vec4 bfTex2 = texture2D(uMasonry, vTuv);
#else
vec4 bfTex2 = vec4(1.0);
#endif
float bfK = vMat.z;
float bfD = bfPick(bfTex, bfTex2, bfK);
bool bfPane = bfK > 2.5 && bfK < 3.5;
// glass is lit by the panes; everything else, gratings included, is darkened in its seams
if (!(bfPane && vMat.w > 0.0)) diffuseColor.rgb *= bfPane ? mix(0.25, 1.0, bfD) : bfD;
// char: patches that spread over her as she is holed, wood only
float bfN = bfNoise(vLocal * 0.42) * 0.62 + bfNoise(vLocal * 1.9) * 0.38;
float bfThr = uScorch * 0.6;
float bfBurn = (1.0 - smoothstep(bfThr - 0.1, bfThr, bfN)) * (1.0 - vMat.y) * step(0.001, uScorch);
// Weather on her planking: wet and dark where the sea slaps her, a line of weed at the
// water, and grime run down her sides from every port and scupper.
float bfSide = step(bfK, 0.5);
float bfWet = (1.0 - smoothstep(0.0, 1.2, vLocal.y)) * bfSide;
float bfWeed = (1.0 - smoothstep(0.04, 0.4, abs(vLocal.y - 0.12))) * (0.45 + 0.55 * bfNoise(vLocal * vec3(0.6, 4.0, 0.6))) * bfSide;
float bfStreak = smoothstep(0.58, 0.86, bfNoise(vec3(vLocal.x * 1.9, vLocal.y * 0.14, vLocal.z * 1.9))) * bfSide * step(0.3, vLocal.y);
diffuseColor.rgb *= (1.0 - bfWet * 0.28) * (1.0 - bfStreak * 0.2);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.13, 0.06), bfWeed * 0.4);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.18 + vec3(0.03, 0.025, 0.022), bfBurn * 0.85);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `float roughnessFactor = clamp(vMat.x + (1.0 - bfD) * 0.22 + bfBurn * 0.25 - bfWet * 0.32, 0.05, 1.0);`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `float metalnessFactor = vMat.y;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
#ifdef BF_BUMP
if (bfK < 2.5 || bfK > 4.5) {
  vec2 dx = dFdx(vTuv), dy = dFdy(vTuv);
  #ifdef BF_MASONRY
  float hx = bfPick(texture2D(uTimber, vTuv + dx), texture2D(uMasonry, vTuv + dx), bfK);
  float hy = bfPick(texture2D(uTimber, vTuv + dy), texture2D(uMasonry, vTuv + dy), bfK);
  #else
  float hx = bfPick(texture2D(uTimber, vTuv + dx), vec4(1.0), bfK), hy = bfPick(texture2D(uTimber, vTuv + dy), vec4(1.0), bfK);
  #endif
  normal = bfBump(-vViewPosition, normal, vec2(hx - bfD, hy - bfD) * 1.6, faceDirection);
}
#endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.6, 0.26) * vMat.w * uLamp * (bfPane ? bfTex.a * bfTex.a : 1.0);
if (vPort > -0.5) totalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * 2.4 * mix(uGlow.x, uGlow.y, vPort);`)
      .replace('#include <fog_fragment>', FOG);
  };
  m.customProgramCacheKey = () => `bf-timber${bump ? '-b' : ''}${masonry ? '-m' : ''}`;
  return m as THREE.MeshStandardMaterial & { userData: { u: TimberUniforms } };
}

/* --------------------------------------------------------------- canvas --- */

export interface CanvasUniforms {
  uFill: { value: number };
  uTatter: { value: number };
  uPhase: { value: number };
  uFogK: { value: number };
  uFade: { value: number };
}

const SAIL_VERTEX_HEAD = /* glsl */ `#include <common>
attribute float aBillow;
attribute vec3 aAxis;
attribute vec2 aCuv;
uniform float uFill, uTime, uPhase;
varying vec2 vCuv;`;

const SAIL_MOTION = /* glsl */ `#include <begin_vertex>
// Full, she holds her shape with a ripple running through her; as the wind goes out of
// her she falls slack and flogs.
float luff = 1.0 - uFill;
float ph = uTime + uPhase;
float ripple = sin(ph * 2.7 + position.y * 0.5 + position.x * 0.31) * 0.045 + sin(ph * 4.3 + position.z * 0.7 + position.y * 0.2) * 0.03;
float flap = sin(ph * 7.1 + position.z * 1.05 + position.y * 0.45) * luff * 0.32 + sin(ph * 3.3 + position.y * 0.85) * luff * 0.24;
transformed -= aAxis * aBillow * (luff * 0.85 - ripple - flap);
vCuv = aCuv;`;

export function canvasMaterial(map: THREE.Texture, color: string, ink: string, a2c: boolean): {
  mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; u: CanvasUniforms;
} {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
  mat.alphaToCoverage = a2c;
  const u: CanvasUniforms = { uFill: { value: 1 }, uTatter: { value: 0 }, uPhase: { value: Math.random() * 20 }, uFogK: { value: 1 }, uFade: { value: 1 } };
  const shared = { uCanvas: { value: map }, uTime: shipTime, uInk: { value: new THREE.Color(ink) } };
  if (a2c) mat.defines = { BF_A2C: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, shared);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', SAIL_VERTEX_HEAD).replace('#include <begin_vertex>', SAIL_MOTION);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform sampler2D uCanvas;
uniform float uTatter, uFogK;
uniform vec3 uInk;
varying vec2 vCuv;
${FADE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
${FADE_CUT}
vec4 bfC = texture2D(uCanvas, vCuv);
float bfCut = bfC.a - uTatter;
#ifdef BF_A2C
  diffuseColor.a = clamp(bfCut / max(fwidth(bfC.a), 1e-3) + 0.5, 0.0, 1.0);
  if (diffuseColor.a < 0.02) discard;
#else
  if (bfCut < 0.0) discard;
#endif
diffuseColor.rgb *= mix(0.46, 1.1, bfC.r);
diffuseColor.rgb = mix(diffuseColor.rgb, uInk, bfC.g * 0.94);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.52, 0.38), bfC.b * 0.85);
// a rip's edge is frayed and darker
if (uTatter > 0.0) diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.035, bfCut));`)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
// Cloth is thin: with the sun behind her, a sail glows.
#if NUM_DIR_LIGHTS > 0
{
  float bfNL = dot(normal, directionalLights[0].direction);
  float bfBack = saturate(-bfNL);
  // and it scatters: a sail catches the sun at any angle, never quite edge-dark
  float bfWrap = saturate(bfNL * 0.5 + 0.5);
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * (bfBack * 0.32 + bfWrap * bfWrap * 0.16);
}
#endif`)
      .replace('#include <fog_fragment>', FOG);
  };
  mat.customProgramCacheKey = () => `bf-canvas${a2c ? '-a2c' : ''}`;

  // Her shadow has her holes in it, and moves as she fills.
  const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, shared);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', SAIL_VERTEX_HEAD).replace('#include <begin_vertex>', SAIL_MOTION);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCanvas;\nuniform float uTatter;\nvarying vec2 vCuv;')
      .replace('#include <alphatest_fragment>', 'if (texture2D(uCanvas, vCuv).a < max(uTatter, 0.001)) discard;');
  };
  depth.customProgramCacheKey = () => 'bf-canvas-depth';
  return { mat, depth, u };
}

/* ----------------------------------------------------------------- rope --- */

let rope: THREE.MeshBasicMaterial | null = null;

export function ropeMaterial(): THREE.MeshBasicMaterial {
  if (rope) return rope;
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uPixel: ropePixel, uShade: ropeShade });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec3 aDir;
attribute vec2 aRope;
uniform float uPixel;
varying float vCover;
varying float vEdge;`)
      .replace('#include <project_vertex>', /* glsl */ `
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
vec3 bfDir = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
vec3 bfSide = cross(bfDir, normalize(mvPosition.xyz));
float bfL = length(bfSide);
bfSide = bfL > 1e-5 ? bfSide / bfL : vec3(1.0, 0.0, 0.0);
// at least a pixel and a half wide; thinner than that, fainter instead
float bfPx = uPixel * max(0.5, -mvPosition.z);
float bfW = max(aRope.y, bfPx * 0.75);
vCover = aRope.y / bfW;
vEdge = aRope.x;
mvPosition.xyz += bfSide * bfW * aRope.x;
gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uShade;\nvarying float vCover;\nvarying float vEdge;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= uShade;
diffuseColor.a *= (1.0 - smoothstep(0.45, 1.0, abs(vEdge))) * clamp(vCover * 1.6, 0.16, 1.0);`);
  };
  m.customProgramCacheKey = () => 'bf-rope';
  rope = m;
  return m;
}

/* -------------------------------------------------------------- bunting --- */

const flagCache = new Map<string, THREE.MeshStandardMaterial>();

/** A flag or pennant streaming aft from its hoist; `aFly` is how far along it a vertex is. */
export function buntingMaterial(key: string, map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const hit = flagCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: !map, roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shipTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFly;\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
float fly = aFly.x, ph = aFly.y;
transformed.z += (sin(fly * 1.9 - uTime * 7.5 + ph) * 0.62 + sin(fly * 4.3 - uTime * 11.0 + ph) * 0.22) * fly * 0.11;
transformed.y += sin(fly * 1.3 - uTime * 5.0 + ph) * fly * 0.04 - fly * fly * 0.006;`);
  };
  m.customProgramCacheKey = () => 'bf-bunting';
  flagCache.set(key, m);
  return m;
}
