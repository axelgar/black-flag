// The ships a captain can sail. They all sail and fight alike (data/tuning.ts): only their
// look differs, picked on the first screen. Each is drawn from a model file, scaled to the
// one length every ship has. Adding a look is adding an entry here and its file in
// public/ships (npm run ships:pack).
//
// Kenney's Pirate Kit (CC0) stands in for all three until the art brief's are made.

import type { ModelFile } from './types';

export interface Look {
  id: string;
  name: string;
  file: ModelFile;
}

export const LOOKS: Look[] = [
  { id: 'jackdaw', name: 'Jackdaw', file: { url: '/ships/kenney-ship-pirate-large.glb', lift: -2 } },
  { id: 'revenge', name: 'Revenge', file: { url: '/ships/kenney-ship-large.glb', lift: -2 } },
  { id: 'kestrel', name: 'Kestrel', file: { url: '/ships/kenney-ship-pirate-medium.glb', lift: -2 } },
];

export const STARTER = 'jackdaw';
export const lookById = (id: string | null | undefined): Look => LOOKS.find((s) => s.id === id) ?? LOOKS[0];
