// The land's model files: the palms and rocks the islands are dressed with, and the
// crate afloat on the sea. Until a set loads, or if it never does, the islands go bare and
// a crate is a plain box.

import type { PropSet } from './types';

export const PROP_SETS: PropSet[] = [
  // stand-ins: Kenney's Pirate Kit (CC0), its palms, rocks and a crate, until the
  // islands' own are bought or made. Its palms lean along -X
  { url: '/props/kenney-land.glb', turn: 1 },
];
