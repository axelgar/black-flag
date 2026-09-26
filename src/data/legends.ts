// The four legendaries. They do not strike their colours, their gun ports are the way
// in, and beating one only puts her in the log — the endless run brings her back.

import type { LegendDef } from './types';

export const LEGENDS: LegendDef[] = [
  {
    id: 'impoluto', name: 'El Impoluto', hull: 90, speed: 6.5, turn: 0.32, reales: 2600,
    pattern: 'sweep', ports: 6,
    note: 'A hundred and forty guns and never once holed. She sweeps her broadside across the whole of the sea.',
    recipe: {
      length: 64, beam: 17, freeboard: 6.4, draft: 5, sheer: 2.2, stern: 'galleon',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.85, tiers: 3,
      gunsPerSide: 11, gunDecks: 3, flag: 'spain', gilt: true,
      palette: { hull: '#7A5A36', wale: '#1E1812', bottom: '#DCD3BC', deck: '#C7A470', rail: '#1E1812', sail: '#F6F0DE', trim: '#D9B23C', inside: '#8A2E24' },
    },
  },
  {
    id: 'dama', name: 'La Dama Negra', hull: 100, speed: 7.5, turn: 0.36, reales: 3000,
    pattern: 'shroud', ports: 4,
    note: 'Black hull, black canvas. She sends the launches in first and fires through them.',
    recipe: {
      length: 58, beam: 15, freeboard: 5.6, draft: 4.6, sheer: 1.9, stern: 'galleon',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.9, tiers: 3,
      gunsPerSide: 9, gunDecks: 2, flag: 'crimson', gilt: true, tatter: 0.14, emblem: 'none',
      palette: { hull: '#1C1A20', wale: '#7B2B3A', bottom: '#0B0A0D', deck: '#4C4552', rail: '#0B0A0D', sail: '#2A2732', trim: '#7B2B3A', inside: '#3A1219' },
    },
  },
  {
    id: 'prince', name: 'HMS Prince', hull: 115, speed: 6, turn: 0.3, reales: 3400,
    pattern: 'rain', ports: 8,
    note: 'English, and a long way from home. Her mortar deck writes rings on the water faster than you can read them.',
    recipe: {
      length: 62, beam: 16.5, freeboard: 6.2, draft: 5, sheer: 2, stern: 'galleon',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.9, tiers: 3,
      gunsPerSide: 10, gunDecks: 3, flag: 'england', gilt: true, emblem: 'none',
      palette: { hull: '#3A2A20', wale: '#D8B040', bottom: '#B87A48', deck: '#C39A63', rail: '#16100B', sail: '#F0E7D2', trim: '#1E3E7A', inside: '#8A2E24' },
    },
  },
  {
    id: 'fortuna', name: 'La Fortuna', hull: 130, speed: 10, turn: 0.45, reales: 4000,
    pattern: 'spiral', ports: 6,
    note: 'The treasure ship. Fast for her weight, and she would rather run you down than out-shoot you.',
    recipe: {
      length: 56, beam: 15.5, freeboard: 5.8, draft: 4.8, sheer: 2.1, stern: 'galleon',
      forecastle: true, bowsprit: true, masts: 3, rig: 'square', mastHeight: 0.88, tiers: 3,
      gunsPerSide: 9, gunDecks: 2, flag: 'gold', gilt: true, emblem: 'cross',
      palette: { hull: '#6C4A26', wale: '#D9A441', bottom: '#B87A48', deck: '#D3AE6B', rail: '#2C1C0C', sail: '#F6EFDA', trim: '#D9A441', inside: '#8A2E24' },
    },
  },
];

export const legendById = (id: string) => LEGENDS.find((l) => l.id === id) || LEGENDS[0];
/** Boss waves come round every fifth. Wave 5 is the first, then they cycle. */
export const legendFor = (wave: number) =>
  LEGENDS[(Math.floor(wave / 5) - 1 + LEGENDS.length * 4) % LEGENDS.length];
