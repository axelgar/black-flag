// The Spanish navy. The v1 table, carried over: the same six classes in the same order,
// with the same reales and the same idea of who strikes and who does not. What is new is
// everything an open sea needs: how far she sees, where she likes to fight from, and the
// recipe her hull is built from.
//
// `hull` is still hits-to-sink at the Jackdaw's base broadside, so a brig is about two
// good broadsides to her colours and a man-o-war is a campaign.

import type { FoeClass, Palette } from './types';

const SPANISH: Palette = {
  hull: '#5A4029', wale: '#1F1A15', bottom: '#2A2019', deck: '#B08C5A',
  rail: '#2C2015', sail: '#E9E0C8', trim: '#9A2E26',
};
const TARRED: Palette = {
  hull: '#2B2420', wale: '#150F0B', bottom: '#120E0B', deck: '#6B5438',
  rail: '#120D09', sail: '#8C7D66', trim: '#C4501E',
};

export const CLASSES: Record<string, FoeClass> = {
  lancha: {
    id: 'lancha', name: 'Lancha', rank: 'Gunboat', hull: 3, speed: 17.5, turn: 1.5, reales: 25,
    ram: 5, strikes: true, guns: 'none', gunsPerSide: 0, reload: 0, range: 0, shotDmg: 0,
    prefRange: 0, sight: 300,
    note: 'An open launch with a swivel gun and eleven angry men. She cannot shoot you, so she aims to hit you.',
    recipe: {
      length: 12, beam: 3.6, freeboard: 1.0, draft: 0.8, sheer: 0.35, stern: 'transom',
      forecastle: false, bowsprit: false, masts: 1, rig: 'lateen', mastHeight: 0.7, tiers: 1,
      gunsPerSide: 0, gunDecks: 0, oars: true, flag: 'spain', palette: SPANISH,
    },
  },
  schooner: {
    id: 'schooner', name: 'Schooner', rank: 'Raider', hull: 5, speed: 13.5, turn: 1.1, reales: 50,
    ram: 6, strikes: true, guns: 'aimed', gunsPerSide: 1, reload: 2.2, range: 150, shotDmg: 2,
    prefRange: 100, sight: 340,
    note: 'Fore-and-aft rigged and quick on the helm. She stands off and keeps a swivel gun on you.',
    recipe: {
      length: 22, beam: 5.6, freeboard: 1.7, draft: 1.8, sheer: 0.6, stern: 'transom',
      forecastle: false, bowsprit: true, masts: 2, rig: 'fore-aft', mastHeight: 1.0, tiers: 1,
      gunsPerSide: 3, gunDecks: 1, flag: 'spain', palette: SPANISH,
    },
  },
  brig: {
    id: 'brig', name: 'Brig', rank: 'Escort', hull: 9, speed: 11, turn: 0.8, reales: 120,
    ram: 8, strikes: true, guns: 'beam', gunsPerSide: 2, reload: 2.6, range: 140, shotDmg: 2,
    prefRange: 95, sight: 340,
    note: 'Square-rigged and stubborn. She brings her beam round and throws two shot down it.',
    recipe: {
      length: 28, beam: 7.6, freeboard: 2.3, draft: 2.4, sheer: 0.8, stern: 'castle',
      forecastle: false, bowsprit: true, masts: 2, rig: 'square', mastHeight: 0.95, tiers: 3,
      gunsPerSide: 5, gunDecks: 1, flag: 'spain', palette: SPANISH,
    },
  },
  frigate: {
    id: 'frigate', name: 'Frigate', rank: 'Ship of the line', hull: 17, speed: 9.5, turn: 0.6, reales: 300,
    ram: 11, strikes: true, guns: 'broadside', gunsPerSide: 5, reload: 3.6, range: 160, shotDmg: 2,
    prefRange: 115, sight: 380,
    note: 'Turns her side to you and opens her ports. When the lids come up, the wall of five is a second away. Cross her bow, never her beam.',
    recipe: {
      length: 38, beam: 10, freeboard: 3.2, draft: 3.2, sheer: 1.1, stern: 'castle',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.95, tiers: 3,
      gunsPerSide: 7, gunDecks: 1, flag: 'spain', palette: SPANISH,
    },
  },
  manowar: {
    id: 'manowar', name: 'Man-o-war', rank: 'Flagship', hull: 32, speed: 7.5, turn: 0.42, reales: 800,
    ram: 15, strikes: true, guns: 'mortar', gunsPerSide: 7, reload: 4.2, range: 170, shotDmg: 2,
    prefRange: 135, sight: 400,
    note: 'A hundred guns and a mortar deck. The rings on the water are where the shells are already falling.',
    recipe: {
      length: 52, beam: 14, freeboard: 5.2, draft: 4.4, sheer: 1.6, stern: 'galleon',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.9, tiers: 3,
      gunsPerSide: 9, gunDecks: 2, flag: 'spain', palette: SPANISH,
    },
  },
  brulote: {
    id: 'brulote', name: 'Brulote', rank: 'Fire ship', hull: 3, speed: 12, turn: 1.0, reales: 0,
    ram: 0, strikes: false, guns: 'none', gunsPerSide: 0, reload: 0, range: 0, shotDmg: 0,
    prefRange: 0, sight: 9999,
    note: 'Pitch, tar and powder, crewed by men who mean to leave by boat. She does not surrender. She arrives.',
    recipe: {
      length: 15, beam: 4.4, freeboard: 1.3, draft: 1.1, sheer: 0.4, stern: 'transom',
      forecastle: false, bowsprit: false, masts: 1, rig: 'square', mastHeight: 0.8, tiers: 1,
      gunsPerSide: 0, gunDecks: 0, flag: 'crimson', palette: TARRED,
    },
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

/** A hunter is a frigate that has stopped waiting for you. Same hull, different orders. */
export const HUNTER_CLASS = 'frigate';
