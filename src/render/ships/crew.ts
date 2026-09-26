// Her people. A few dozen triangles each — legs, a shirt, arms, a head and a hat — enough
// that a deck has a helmsman, men in the waist and a lookout in the top, and a ship at
// anchor looks lived in rather than launched from the yard this morning.

import type { HullRecipe } from '../../data/types';
import { rng, type Rng } from '../../core/rng';
import { FIN, Mesh, at } from './mesh';

export interface Outfit { shirt: string; legs: string; skin: string; hat: string | null; hatKind: 'cap' | 'tricorn' | 'band' }

const SKIN = ['#E0B48C', '#C98E62', '#9C6644', '#6B4430', '#F0C8A4'];

/** The Spanish turn out in their King's colours; pirates in whatever they took. */
export function outfitter(R: HullRecipe): (r: Rng, officer?: boolean) => Outfit {
  const navy = R.flag === 'spain' || R.flag === 'england' || R.flag === 'gold';
  return (r, officer = false) => {
    const skin = SKIN[Math.floor(r() * SKIN.length)];
    if (officer) {
      return navy
        ? { shirt: R.flag === 'england' ? '#1E2A4A' : '#23305A', legs: '#E8E0CC', skin, hat: '#15130F', hatKind: 'tricorn' }
        : { shirt: '#3A1B16', legs: '#24201C', skin, hat: '#15130F', hatKind: 'tricorn' };
    }
    if (navy) {
      const shirt = ['#E8E2D2', '#2A3A66', '#E8E2D2', '#8E2B24'][Math.floor(r() * 4)];
      return { shirt, legs: ['#E3DAC4', '#3B3C44'][Math.floor(r() * 2)], skin, hat: r() < 0.6 ? '#2A2A30' : null, hatKind: 'cap' };
    }
    const shirt = ['#E4DCC8', '#8E2B24', '#2F4A6A', '#B98A3E', '#E4DCC8', skin][Math.floor(r() * 6)];
    const band = r() < 0.5;
    return {
      shirt, legs: ['#4A3B2A', '#2C2A28', '#6A5A44', '#3A4A5A'][Math.floor(r() * 4)], skin,
      hat: band ? ['#8E2B24', '#1C1A18', '#2F4A6A'][Math.floor(r() * 3)] : r() < 0.5 ? '#2A2420' : null,
      hatKind: band ? 'band' : 'cap',
    };
  };
}

/** A sailor standing at (x, y, z), turned to `face` (radians about the vertical) and
 *  leaning forward by `lean`. */
export function sailor(m: Mesh, x: number, y: number, z: number, o: Outfit, face = 0, lean = 0, reach = 0) {
  m.push(at(x, y, z, face, -lean));
  m.paint(o.legs, FIN.paint);
  m.push(at(0, 0.42, -0.08)).box(0.13, 0.84, 0.13).pop();
  m.push(at(0, 0.42, 0.08)).box(0.13, 0.84, 0.13).pop();
  m.paint(o.shirt, FIN.paint);
  m.push(at(0, 1.13, 0)).box(0.24, 0.62, 0.4).pop();
  // arms: down at the sides, or one reaching out and up for a line
  m.push(at(0.02, 1.12, -0.25, 0, 0, reach)).box(0.1, 0.58, 0.1).pop();
  m.push(at(0.02 + reach * 0.2, 1.12 + reach * 0.15, 0.25, 0, reach * 1.6)).box(0.1, 0.58, 0.1).pop();
  m.paint(o.skin, FIN.paint);
  m.push(at(0, 1.57, 0)).lathe([[0.02, -0.12], [0.12, -0.03], [0.11, 0.08], [0.02, 0.14]], 5, false).pop();
  if (o.hat) {
    m.paint(o.hat, FIN.paint);
    if (o.hatKind === 'tricorn') m.push(at(0, 1.68, 0)).lathe([[0.24, 0], [0.2, 0.04], [0.1, 0.1], [0.02, 0.14]], 3, false).pop();
    else if (o.hatKind === 'band') m.push(at(0, 1.64, 0)).lathe([[0.125, -0.02], [0.13, 0.05], [0.02, 0.1]], 5, false).pop();
    else m.push(at(0, 1.66, 0)).lathe([[0.13, -0.02], [0.12, 0.05], [0.03, 0.1]], 5, false).pop();
  }
  m.pop();
}

export const crewRng = (R: HullRecipe) => rng(`crew:${R.length}:${R.beam}:${R.flag}:${R.palette.hull}`);
