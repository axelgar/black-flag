// A ship from a file, baked without a file: a scene put together here in three.js, named
// the way the art brief tells an artist to name hers, and checked for what the game reads
// from it. If these hold, a bought or commissioned ship that follows the brief sails.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHIPS } from '../src/data/ships';
import { recipeOf } from '../src/data/upgrades';
import { bake } from '../src/render/ships/gltf';
import { modelMaterial, modelUniforms } from '../src/render/ships/materials';

const R = recipeOf(SHIPS[0]);                     // the Jackdaw: 30m
const mat = new THREE.MeshStandardMaterial();
const canvas = new THREE.MeshStandardMaterial();

/** A box mesh, `w` across (x), `h` high and `l` long (z, glTF's forward), its base at y0. */
function box(name: string, w: number, h: number, l: number, at: [number, number, number] = [0, 0, 0], m = mat) {
  const g = new THREE.BoxGeometry(w, h, l, 2, 2, 2);
  g.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

/** A ship 10 units long along +Z, as an artist would hand her over. */
function ship() {
  const scene = new THREE.Group();
  const hull = box('Hull', 3, 2, 10);
  scene.add(hull);
  hull.add(box('Sail001', 0.1, 4, 3, [0, 3, 1], canvas));   // Blender's Sail.001, once loaded
  scene.add(box('rope_main', 0.05, 5, 0.05, [1, 2, 0]));
  scene.add(box('flag_main', 0.05, 0.6, 1, [0, 7, 0]));
  scene.add(box('gunwale', 3, 0.2, 10, [0, 2, 0]));        // a "gun…" word that is not a gun
  const lid = new THREE.Group();
  lid.name = 'lid_L_0';
  lid.position.set(1.5, 1.5, 2);                           // her left is the file's +X
  lid.add(box('Cube003', 0.1, 0.5, 0.5, [0, -0.5, 0]));
  scene.add(lid);
  scene.add(box('gun_R_0', 0.4, 0.4, 0.4, [-1.2, 1, 0]));
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle_R_0';
  muzzle.position.set(-1.6, 1.2, 0);
  scene.add(muzzle);
  return scene;
}

const kinds = (k: ReturnType<typeof bake>) => k.parts.map((p) => p.kind).sort();

describe('a ship from a file', () => {
  it('is scaled to her recipe, bow forward, centred, at her waterline', () => {
    const k = bake(ship(), { url: 'x', lift: -1 }, R);
    const all = new THREE.Box3();
    for (const p of k.parts) { p.geometry.computeBoundingBox(); all.union(p.geometry.boundingBox!); }
    const size = all.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(R.length, 1);               // her length runs along x
    expect(size.z).toBeCloseTo(9.15, 1);                   // 3 across and a lid proud of her side, scaled by 3
    expect(all.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 1);
    expect(all.min.y).toBeCloseTo(-1, 1);                  // her keel under the water
    expect(k.height).toBeCloseTo(all.max.y, 1);
  });

  it('knows her parts by name, and merges them one draw per material and kind', () => {
    const k = bake(ship(), { url: 'x' }, R);
    expect(kinds(k)).toEqual(['rope', 'sail', 'solid']);
    expect(k.flags).not.toBeNull();                         // her colours fly where the flag was
    expect(k.muzzles?.[0]).toHaveLength(0);
    expect(k.muzzles?.[1]).toHaveLength(1);
    expect(k.muzzles![1][0].z).toBeGreaterThan(0);          // the file's -X is her starboard
  });

  it('swings her lids on their hinges and runs her guns out, each on her own side', () => {
    const k = bake(ship(), { url: 'x' }, R);
    const solid = k.parts.find((p) => p.kind === 'solid')!.geometry;
    const anim = solid.getAttribute('aAnim');
    const seen = new Map<number, number>();
    for (let i = 0; i < anim.count; i++) if (anim.getX(i)) seen.set(anim.getX(i), anim.getY(i));
    expect(seen.get(1)).toBe(-1);                           // a lid, larboard
    expect(seen.get(2)).toBe(1);                            // a gun, starboard
    let hinge = -1;
    for (let i = 0; i < anim.count; i++) if (anim.getX(i) === 1) hinge = anim.getW(i);
    expect(hinge).toBeLessThan(0);                          // her larboard is -z
  });

  it('leaves her canvas still at its edges and free in its middle', () => {
    const k = bake(ship(), { url: 'x' }, R);
    const free = k.parts.find((p) => p.kind === 'sail')!.geometry.getAttribute('aSail');
    const v = Array.from({ length: free.count }, (_, i) => free.getX(i));
    expect(Math.min(...v)).toBeCloseTo(0, 5);
    expect(Math.max(...v)).toBeGreaterThan(1);
  });

  it('turns a file that faces another way', () => {
    const scene = new THREE.Group();
    const hull = box('Hull', 10, 2, 3);                     // long along +X
    scene.add(hull);
    const k = bake(scene, { url: 'x', turn: 3 }, R);
    const g = k.parts[0].geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.getSize(new THREE.Vector3()).x).toBeCloseTo(R.length, 1);
  });

  it('keeps a mirrored part facing out', () => {
    const scene = new THREE.Group();
    const half = box('Hull', 3, 2, 10);
    half.scale.x = -1;
    scene.add(half);
    const g = bake(scene, { url: 'x' }, R).parts[0].geometry;
    // every face's winding still agrees with its normals
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), idx = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
      const face = b.sub(a).cross(c.sub(a));
      nn.fromBufferAttribute(n, idx.getX(i));
      expect(face.dot(nn)).toBeGreaterThan(0);
    }
  });

  it('draws a blended material solid, cut out, and in front of the sky', () => {
    // as GLTFLoader reads a file's BLEND: see-through and writing no depth
    const blend = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
    for (const kind of ['solid', 'sail'] as const) {
      const m = modelMaterial(blend, kind, modelUniforms());
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(true);
      expect(m.alphaTest).toBe(0.5);
    }
  });
});
