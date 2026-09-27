// What the renderer needs from a ship, however she was made. A procedural hull and a
// loaded GLTF both honour this, so swapping a ship's art is a change to her ShipDef and
// nothing else.

import type * as THREE from 'three';

export interface ShipPose {
  x: number; z: number; h: number;     // world position and heading
  heave: number; pitch: number; roll: number;
  fill: number;                        // how much wind is in her canvas, 0..1
  struck: boolean;
  damage: number;                      // 0 whole .. 1 wrecked
  t: number;
}

export interface ShipModel {
  root: THREE.Object3D;
  len: number;
  beam: number;
  /** Where her guns are, in her own frame: x forward, y up, z starboard. */
  gunPorts(side: -1 | 1): THREE.Vector3[];
  /** Height of her tallest truck, for labels and the camera. */
  height: number;
  pose(p: ShipPose): void;
  /** Open (or close) a side's ports — the frigate's tell. */
  portsOpen(side: -1 | 1, open: boolean): void;
  /** Clear for action: lids up, guns run out. */
  ready?(on: boolean): void;
  /** A side has fired: its guns recoil and are run out again. */
  fired?(side: -1 | 1): void;
  /** A legendary's weak points: show the live ones, hide the dead. */
  weakPoints?(alive: boolean[]): void;
  /** How far she is from the camera, so fine work can be dropped when nobody could see it. */
  detail?(distance: number): void;
  /** How much of the fog she takes, 0..1. */
  fog?(k: number): void;
  /** How much of her is left as she leaves the chart, 1 whole .. 0 gone. */
  fade?(k: number): void;
  setShadows(on: boolean): void;
  dispose(): void;
}
