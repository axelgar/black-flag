// The land's model files: sets of buildings, trees and rocks the islands are dressed from,
// in place of what code builds and grows (src/render/land/props.ts says what a set holds).
// A kind no set has a model of is drawn from code, and so is all of it while the sets are
// still loading, if one never comes, or with the menu's Models setting off.

import type { PropSet } from './types';

export const PROP_SETS: PropSet[] = [
  // stand-ins, to prove the loader: Kenney's Pirate Kit (CC0), its palms, rocks and a beach
  // hut for Nassau's shacks, until the islands' own are bought or made. Its palms lean
  // along -X
  { url: '/props/kenney-land.glb', turn: 1 },
];
