// The player's roster: the one place a new ship gets added.
//
// A ship is her numbers (`base`), her looks (`model`) and how she is unlocked. Adding a
// fifth is adding a fifth entry here and, if she is not a starter, a code in unlocks.ts —
// the simulation, the shipyard, Nassau and the renderer all read from this list and
// nothing else. Numbers are first-pass and meant to be tuned against real play.

import type { ShipDef } from './types';

export const SHIPS: ShipDef[] = [
  {
    id: 'jackdaw', name: 'Jackdaw', rank: 'Brig',
    blurb: 'Yours from the start. Five guns a side, bow chasers that look after themselves, and a helm that forgives.',
    base: {
      hull: 40, maxSpeed: 15, accel: 3.2, turnRate: 0.72,
      gunsPerSide: 5, broadsideReload: 2.6, shotDmg: 1, shotSpeed: 105, shotRange: 150,
      bowGun: { reload: 1.0, dmg: 0.8, range: 140 },
      shellsMax: 3, boardRepair: 10, ramDmg: 2, lives: 3,
    },
    model: {
      kind: 'procedural',
      recipe: {
        length: 30, beam: 8, freeboard: 2.5, draft: 2.5, sheer: 0.9, stern: 'castle',
        forecastle: false, bowsprit: true, masts: 2, rig: 'square', mastHeight: 0.98, tiers: 3,
        gunsPerSide: 5, gunDecks: 1, flag: 'black', chasers: true,
        tatter: 0.1, emblem: 'skull', ink: '#1A1512',
        palette: { hull: '#2F2C28', wale: '#8E2B24', bottom: '#15130F', deck: '#A8834B', rail: '#15130F', sail: '#D8CCAA', trim: '#8E2B24', inside: '#5A2219' },
      },
    },
    ability: 'none',
    unlock: 'starter',
  },
  {
    id: 'kestrel', name: 'Kestrel', rank: 'Sloop',
    blurb: 'A hawk with three guns a side. Turns inside anything afloat and outruns the rest — just never let a frigate see her beam.',
    base: {
      hull: 28, maxSpeed: 19, accel: 4.4, turnRate: 1.08,
      gunsPerSide: 3, broadsideReload: 2.0, shotDmg: 1, shotSpeed: 110, shotRange: 140,
      bowGun: { reload: 0.8, dmg: 0.7, range: 140 },
      shellsMax: 2, boardRepair: 8, ramDmg: 2, lives: 3,
    },
    model: {
      kind: 'procedural',
      recipe: {
        length: 22, beam: 6, freeboard: 1.9, draft: 1.9, sheer: 0.6, stern: 'transom',
        forecastle: false, bowsprit: true, masts: 1, rig: 'fore-aft', mastHeight: 1.25, tiers: 1,
        gunsPerSide: 3, gunDecks: 1, flag: 'black', chasers: true,
        tatter: 0.03,
        palette: { hull: '#E4DCC6', wale: '#1E3E5A', bottom: '#243038', deck: '#B89868', rail: '#1B2429', sail: '#F3EEDF', trim: '#1E3E5A', inside: '#2E4A5E' },
      },
    },
    ability: 'none',
    unlock: { code: 'KSTRL-7Q' },
  },
  {
    id: 'revenant', name: 'Revenant', rank: 'Galleon',
    blurb: 'Taken from the Spanish and never given back. Nine guns a side and oak like a castle wall, with the turning circle of one.',
    base: {
      hull: 72, maxSpeed: 11.5, accel: 2.2, turnRate: 0.5,
      gunsPerSide: 9, broadsideReload: 4.0, shotDmg: 1, shotSpeed: 100, shotRange: 160,
      bowGun: null,
      shellsMax: 5, boardRepair: 16, ramDmg: 6, lives: 3,
    },
    model: {
      kind: 'procedural',
      recipe: {
        length: 46, beam: 13, freeboard: 4.6, draft: 4, sheer: 1.6, stern: 'galleon',
        forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.9, tiers: 3,
        gunsPerSide: 9, gunDecks: 2, flag: 'black', gilt: true,
        tatter: 0.26, emblem: 'skull', ink: '#D8CFB8',
        palette: { hull: '#2E211B', wale: '#6A4A2A', bottom: '#4A3020', deck: '#8C6C44', rail: '#140E0A', sail: '#4B433A', trim: '#B8892E', inside: '#4A1E17' },
      },
    },
    ability: 'none',
    unlock: { code: 'RVNT-4K' },
  },
  {
    id: 'maree', name: 'Marée Noire', rank: 'Schooner',
    blurb: 'Long guns and a long reach. She hits from further off than anything the Spanish float, and would rather not be touched at all.',
    base: {
      hull: 34, maxSpeed: 16.5, accel: 3.6, turnRate: 0.84,
      gunsPerSide: 4, broadsideReload: 2.8, shotDmg: 1.25, shotSpeed: 132, shotRange: 210,
      bowGun: null,
      shellsMax: 3, boardRepair: 9, ramDmg: 1, lives: 3,
    },
    model: {
      kind: 'procedural',
      recipe: {
        length: 28, beam: 6.8, freeboard: 2.1, draft: 2.2, sheer: 0.7, stern: 'transom',
        forecastle: false, bowsprit: true, masts: 2, rig: 'fore-aft', mastHeight: 1.12, tiers: 1,
        gunsPerSide: 4, gunDecks: 1, flag: 'black', squareTops: true,
        tatter: 0.16, emblem: 'skull', ink: '#D9D2BE',
        palette: { hull: '#16181C', wale: '#5E7C82', bottom: '#0B0C0E', deck: '#6E6556', rail: '#0B0C0E', sail: '#3A3D44', trim: '#5E7C82', inside: '#23282D' },
      },
    },
    ability: 'none',
    unlock: { code: 'MAREE-9X' },
  },
];

export const STARTER = 'jackdaw';
export const shipById = (id: string | null | undefined): ShipDef =>
  SHIPS.find((s) => s.id === id) || SHIPS.find((s) => s.id === STARTER)!;
