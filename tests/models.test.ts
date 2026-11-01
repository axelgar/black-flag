// Ships and land from files, baked without a file: scenes put together here in three.js,
// named the way the art brief tells an artist to name them, and checked for what the game
// reads from them. If these hold, a bought or commissioned model that follows the brief
// sails, or stands on an island.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { inkNormals, outline } from '../src/render/ink';
import { propsFrom } from '../src/render/land';
import { bakeFile } from '../src/render/ships';

const mat = new THREE.MeshStandardMaterial();

/** A box mesh, `w` across (x), `h` high and `l` long (z, glTF's forward), its base at `at`. */
function box(name: string, w: number, h: number, l: number, at: [number, number, number] = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

/** A ship 10 units long along +Z, her sails a child of a node named the brief's way. */
function ship() {
  const scene = new THREE.Group();
  scene.add(box('hull', 3, 2, 10));
  const rig = new THREE.Group();
  rig.name = 'sail-main';
  rig.add(box('Cube001', 0.1, 4, 3, [0, 2, 1]));
  scene.add(rig);
  scene.add(box('flag_black', 0.05, 0.6, 1, [0, 6, 0]));
  return scene;
}

const sizeOf = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

describe('a ship from a file', () => {
  it('is scaled to the one length, bow along x, centred, keel at her lift', () => {
    const b = bakeFile(ship(), { url: 'x', lift: -2 });
    const hull = sizeOf(b.hull);
    expect(hull.max.x - hull.min.x).toBeCloseTo(TUNING.length, 3);
    expect(hull.max.z - hull.min.z).toBeCloseTo(3 * (TUNING.length / 10), 3);
    expect((hull.max.x + hull.min.x) / 2).toBeCloseTo(0, 3);
    expect(hull.min.y).toBeCloseTo(-2, 3);
    expect(b.height).toBeCloseTo(6.6 * (TUNING.length / 10) - 2, 3);
  });

  it('keeps her canvas and colours apart from her hull, to be tinted', () => {
    const b = bakeFile(ship(), { url: 'x' });
    const sail = sizeOf(b.sail);
    expect(sail.max.y).toBeCloseTo(6.6 * (TUNING.length / 10), 3);
    expect(sail.min.y).toBeCloseTo(2 * (TUNING.length / 10), 3);
    expect(sizeOf(b.hull).max.y).toBeCloseTo(2 * (TUNING.length / 10), 3);
  });

  it('turns a file that faces another way', () => {
    const scene = new THREE.Group();
    scene.add(box('hull', 10, 2, 3));            // long along x: her bow to +X, a quarter turn 3
    const b = bakeFile(scene, { url: 'x', turn: 3 });
    const hull = sizeOf(b.hull);
    expect(hull.max.x - hull.min.x).toBeCloseTo(TUNING.length, 3);
  });
});

describe('props from a file', () => {
  it('stands each palm, rock and crate on its base, a metre tall, and leaves the rest', () => {
    const scene = new THREE.Group();
    const palm = new THREE.Group();
    palm.name = 'palm_bend';
    palm.position.set(40, 3, -7);
    palm.add(box('trunk', 1, 8, 1, [0, -1, 0]));
    palm.add(box('leaves', 5, 2, 5, [0, 7, 0]));
    const rock = box('rock_a', 3, 2, 3, [-10, 0, 0]);
    scene.add(palm, rock, box('crate', 1, 0.8, 1, [20, 0, 0]), box('shack_hut', 4, 4, 4));
    const kit = propsFrom(scene, 0);
    expect(Object.keys(kit).sort()).toEqual(['crate', 'palm', 'rock']);
    expect(sizeOf(kit.crate![0].geometry).max.y).toBeCloseTo(1, 4);
    const g = kit.palm![0].geometry;
    const b = sizeOf(g);
    expect(b.min.y).toBeCloseTo(0, 4);
    expect(b.max.y).toBeCloseTo(1, 4);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(0, 4);
  });
});

describe('outlines', () => {
  it('fattens a hard-edged box along each corner, so its outline stays closed', () => {
    // a box's corners are three vertices each, one per face, each with that face's normal
    const g = inkNormals(new THREE.BoxGeometry(2, 2, 2));
    const P = g.getAttribute('position'), N = g.getAttribute('ink');
    for (let i = 0; i < P.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(P, i), n = new THREE.Vector3().fromBufferAttribute(N, i);
      expect(n.length()).toBeCloseTo(1, 5);
      // out from the middle, through the corner
      expect(n.dot(p.normalize())).toBeCloseTo(1, 5);
    }
  });

  it('outlines an instanced mesh with its own instances and count', () => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 8);
    im.count = 3;
    const o = outline(im) as THREE.InstancedMesh;
    expect(o.parent).toBe(im);
    expect(o.instanceMatrix).toBe(im.instanceMatrix);
    im.count = 5;
    o.onBeforeRender(null as never, null as never, null as never, null as never, null as never, null as never);
    expect(o.count).toBe(5);
  });
});
