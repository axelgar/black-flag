// Dark outlines, the cartoon way: everything solid is drawn a second time inside out, a
// pixel or two fatter, in ink. Only its back faces are drawn, so the fat copy shows only
// round its edges, and where one part stands in front of another. No post-processing
// pass: an outline costs one more draw for each thing outlined, and next to nothing per
// pixel, since nearly all of it is hidden behind the thing itself.
//
// The width is set in screen pixels, so a ship far off and one close by are inked alike.

import * as THREE from 'three';

export const INK = new THREE.Color('#16203A');

const uniforms = {
  uInk: { value: INK },
  /** Outline width, CSS pixels. */
  uPx: { value: 1.6 },
  /** The canvas's height, CSS pixels. */
  uH: { value: 800 },
};

let material: THREE.ShaderMaterial | null = null;

/** The one ink every outline is drawn in, instanced or not. */
export function ink(): THREE.ShaderMaterial {
  material ??= new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      attribute vec3 ink;
      uniform float uPx, uH;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = ink;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p;
        // a CSS pixel at this depth, in metres
        float px = 2.0 * -mv.z / (projectionMatrix[1][1] * uH);
        mv.xyz += normalize(mat3(modelViewMatrix) * n) * uPx * px;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() {
        gl_FragColor = vec4(uInk, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return material;
}

/** Outlines on or off: off only to measure what they cost (`?plain`). */
export function inkOn(on: boolean) { ink().visible = on; }

/** How wide every outline is, in CSS pixels, on a canvas this many CSS pixels tall. */
export function inkWidth(px: number, cssH: number) {
  uniforms.uPx.value = px;
  uniforms.uH.value = cssH;
}

/**
 * The directions a shape is fattened along: at each corner, every face that meets there
 * averaged. A model with hard edges has a normal per face at a corner, and fattened
 * along those its outline would split open at every corner.
 */
export function inkNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getAttribute('ink')) return g;
  const P = g.getAttribute('position');
  if (!P) return g;
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  const q = Math.max(size.x, size.y, size.z, 1e-6) * 1e-4;
  const key = (i: number) => `${Math.round(P.getX(i) / q)},${Math.round(P.getY(i) / q)},${Math.round(P.getZ(i) / q)}`;
  const keys = Array.from({ length: P.count }, (_, i) => key(i));
  const sum = new Map<string, THREE.Vector3>();
  const at = (i: number) => sum.get(keys[i]) ?? sum.set(keys[i], new THREE.Vector3()).get(keys[i])!;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), w = new THREE.Vector3();
  const I = g.index, tris = (I ? I.count : P.count) / 3;
  for (let t = 0; t < tris; t++) {
    const ids = [0, 1, 2].map((k) => (I ? I.getX(t * 3 + k) : t * 3 + k));
    ids.forEach((id, k) => v[k].fromBufferAttribute(P, id));
    n.subVectors(v[1], v[0]).cross(e1.subVectors(v[2], v[0]));
    if (n.lengthSq() === 0) continue;
    n.normalize();
    // each face counts by the angle it makes at the corner, so a face cut into two
    // triangles counts the same as one that isn't
    for (let k = 0; k < 3; k++) {
      e1.subVectors(v[(k + 1) % 3], v[k]); e2.subVectors(v[(k + 2) % 3], v[k]);
      at(ids[k]).add(w.copy(n).multiplyScalar(e1.angleTo(e2)));
    }
  }
  const out = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const n = sum.get(keys[i])!;
    if (n.lengthSq() > 0) n.normalize();
    out.set([n.x, n.y, n.z], i * 3);
  }
  g.setAttribute('ink', new THREE.BufferAttribute(out, 3));
  return g;
}

/**
 * Ink a mesh: its shape, fattened, drawn in ink just after it, as a child of it, so it
 * goes where the mesh goes and hides when it hides. An instanced mesh's outline shares
 * its instances and keeps to its count.
 */
export function outline(mesh: THREE.Mesh): THREE.Mesh {
  const g = inkNormals(mesh.geometry);
  let o: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const im = mesh as THREE.InstancedMesh;
    const oi = new THREE.InstancedMesh(g, ink(), im.instanceMatrix.count);
    oi.instanceMatrix = im.instanceMatrix;
    oi.count = im.count;
    oi.frustumCulled = im.frustumCulled;
    // the renderer reads the count after this, so it is always the mesh's own
    oi.onBeforeRender = () => { oi.count = im.count; };
    o = oi;
  } else o = new THREE.Mesh(g, ink());
  o.renderOrder = mesh.renderOrder + 0.5;
  mesh.add(o);
  return o;
}
