// A set of land from a file, baked without a file: a scene put together here in three.js,
// named the way the art brief tells an artist to name hers, and checked for what the game
// reads from it. If these hold, a bought or commissioned set that follows the brief dresses
// the islands.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Dress, propKit, propMaterial } from '../src/render/land/props';

const mat = new THREE.MeshStandardMaterial();
const leaves = new THREE.MeshStandardMaterial({ transparent: true });
const glass = new THREE.MeshStandardMaterial({ emissive: new THREE.Color('#ffcc88') });

/** A box mesh, `w` across (x), `h` high and `l` long (z, glTF's forward), its base at y0. */
function box(name: string, w: number, h: number, l: number, at: [number, number, number] = [0, 0, 0], m = mat) {
  const g = new THREE.BoxGeometry(w, h, l, 1, 2, 1);
  g.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

const empty = (name: string, at: [number, number, number]) => {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(...at);
  return o;
};

/** A set as an artist would hand it over: props in a row, in units of half a metre. */
function set() {
  const scene = new THREE.Group();
  // a palm 4 units tall leaning toward +Z, laid out 10 units along
  const palm = new THREE.Group();
  palm.name = 'palm_a';
  palm.position.set(10, 0, 0);
  palm.add(box('trunk', 0.4, 4, 0.4), box('frond001', 2, 0.2, 2, [0, 4, 1], leaves));
  scene.add(palm);
  scene.add(box('rock_big', 5, 2, 4, [20, 0, 0]));
  // a house 12 by 10 units (6 m by 5 m), its front toward +Z, with a lit window
  const house = new THREE.Group();
  house.name = 'house_a';
  house.position.set(30, 0, 0);
  house.add(box('walls', 12, 8, 10), box('window', 2, 2, 0.1, [0, 2, 5], glass));
  scene.add(house);
  const fort = new THREE.Group();
  fort.name = 'fort';
  fort.position.set(-40, 0, 0);
  fort.add(box('curtain', 60, 10, 60));
  const staff = empty('flag_main', [10, 30, -10]);
  staff.add(box('cloth', 0.1, 2, 3));                           // a flag modelled on it: not drawn
  fort.add(staff);
  scene.add(fort);
  // a collection the exporter put everything else in, and a camera it brought along
  const coll = empty('Collection', [0, 0, 50]);
  coll.add(box('tree_oak', 4, 16, 4));
  scene.add(coll, empty('Camera', [0, 5, 5]));
  return scene;
}

const SET = { url: 'x', scale: 0.5 };

describe('a set of land from a file', () => {
  it('knows its props by name, under a collection or not, and ignores what it does not know', () => {
    const kit = propKit([{ set: SET, scene: set() }]);
    expect([...kit.keys()].sort()).toEqual(['fort', 'house', 'palm', 'rock', 'tree']);
  });

  it('sizes a palm to 8 m, its foot at the origin, leaning the way the code palm does', () => {
    const p = propKit([{ set: SET, scene: set() }]).get('palm')![0];
    expect(p.box.max.y - p.box.min.y).toBeCloseTo(8, 1);
    expect(p.box.min.y).toBeCloseTo(0, 2);
    // its fronds hang out toward +Z in the file: toward +x, the code palm's lean, in the game
    expect(p.box.max.x).toBeGreaterThan(2);
    expect(Math.abs(p.box.max.z + p.box.min.z)).toBeLessThan(0.5);
  });

  it('sizes a rock to 2.2 m across, centred, and sunk as the code boulder is', () => {
    const p = propKit([{ set: SET, scene: set() }]).get('rock')![0];
    const size = p.box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeCloseTo(2.2, 2);
    expect(p.box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 2);
    expect(p.box.min.y).toBeCloseTo(-0.45, 2);
  });

  it('keeps a building at the size it was made, in metres, centred on its footprint', () => {
    const p = propKit([{ set: SET, scene: set() }]).get('house')![0];
    const size = p.box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(6, 2);
    expect(size.z).toBeCloseTo(5.025, 3);                      // the window stands proud of the wall
    expect(p.box.min.y).toBeCloseTo(0, 2);
    expect(p.parts).toHaveLength(2);                           // one geometry per material
  });

  it('fits a building to its lot, but only by a quarter either way', () => {
    const kit = propKit([{ set: SET, scene: set() }]);
    const d = new Dress(kit);
    expect(d.fit('house', new THREE.Matrix4(), 7.2, 7)).toBe(true);
    expect(d.fit('house', new THREE.Matrix4().makeTranslation(50, 0, 0), 30, 30)).toBe(true);
    expect(d.fit('church', new THREE.Matrix4(), 7.5, 15)).toBe(false);  // no model: built from code
    const g = d.build(false, false)!;
    const im = g.children.find((c) => c.name === 'house_a') as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    im.getMatrixAt(0, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(1.2, 3);
    im.getMatrixAt(1, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(1.25, 3);
  });

  it('flies the flag from the empty on the staff, and does not draw the one modelled there', () => {
    const kit = propKit([{ set: SET, scene: set() }]);
    const fort = kit.get('fort')![0];
    expect(fort.flags).toHaveLength(1);
    expect(fort.flags[0].y).toBeCloseTo(15, 3);
    expect(fort.box.max.y).toBeCloseTo(5, 3);                  // the cloth is no part of her
    const d = new Dress(kit);
    const frame = new THREE.Matrix4().makeTranslation(100, 4, 0);
    expect(d.stand('fort', frame)).not.toBeNull();
    expect(d.flags[0].x).toBeCloseTo(105, 3);
    expect(d.flags[0].y).toBeCloseTo(19, 3);
  });

  it('puts a plant or a rock down one instance each, and says when it has no model', () => {
    const d = new Dress(propKit([{ set: SET, scene: set() }]));
    for (let i = 0; i < 5; i++) expect(d.put('palm', new THREE.Matrix4().makeTranslation(i * 9, 0, i * 4))).toBe(true);
    expect(d.put('bush', new THREE.Matrix4())).toBe(false);
    expect(d.count).toBe(5);
    const g = d.build(true, false)!;
    expect(g.children.every((c) => (c as THREE.InstancedMesh).count === 5)).toBe(true);
    expect(g.children.every((c) => c.castShadow)).toBe(true);
  });

  it('sways a palm from its foot, its fronds most, and does not sway a rock', () => {
    const kit = propKit([{ set: SET, scene: set() }]);
    const palm = kit.get('palm')![0];
    const trunk = palm.parts.find((p) => p.material === mat)!, fronds = palm.parts.find((p) => p.material === leaves)!;
    const sw = trunk.geometry.getAttribute('aSway'), pos = trunk.geometry.getAttribute('position');
    let foot = 0, top = 0, high = 0;
    for (let i = 0; i < sw.count; i++) {
      if (pos.getY(i) < 0.1) foot = Math.max(foot, sw.getY(i));
      if (pos.getY(i) > high) { high = pos.getY(i); top = sw.getY(i); }
    }
    expect(foot).toBe(0);
    expect(top).toBeGreaterThan(0.9);
    const fz = fronds.geometry.getAttribute('aSway');
    expect(Math.max(...Array.from({ length: fz.count }, (_, i) => fz.getZ(i)))).toBeGreaterThan(0.5);
    expect(kit.get('rock')![0].parts[0].geometry.getAttribute('aSway')).toBeUndefined();
  });

  it('cuts a blended material out, writing its depth, and dims and brightens what glows', () => {
    const cut = propMaterial(leaves, true, false);
    expect(cut.transparent).toBe(false);
    expect(cut.depthWrite).toBe(true);
    expect(cut.alphaTest).toBeGreaterThan(0);
    const a2c = propMaterial(leaves, true, true);
    expect(a2c.alphaToCoverage).toBe(true);
    expect(a2c.alphaTest).toBe(0);
    expect(propMaterial(leaves, true, false)).toBe(cut);       // one per material, for every island
    const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    propMaterial(glass, false, false).onBeforeCompile(sh as never, null as never);
    expect(sh.fragmentShader).toContain('uLamp');
    expect(sh.vertexShader).not.toContain('aSway');
  });
});
