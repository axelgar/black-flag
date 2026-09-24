// QR unlocks. Each printed code is a plain link — https://<site>/u/<CODE> — and this is
// the whole of what turns one into a ship. Shared codes, no backend, by decision: anyone
// who has the link has the ship. The code lives on the ShipDef so a ship and her code can
// never drift apart; this file only answers questions about them.

import { SHIPS } from './ships';

/** Normalise what came off a camera or out of a URL: case, dashes, stray spaces. */
export const normCode = (c: string) => decodeURIComponent(c).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export function shipForCode(code: string): string | null {
  const n = normCode(code);
  if (!n) return null;
  for (const s of SHIPS) if (s.unlock !== 'starter' && normCode(s.unlock.code) === n) return s.id;
  return null;
}

/** Every code on the register, for the QR printer and the tests. */
export const CODES = SHIPS.flatMap((s) => (s.unlock === 'starter' ? [] : [{ ship: s.id, code: s.unlock.code }]));

export const unlockPath = (code: string) => `/u/${code}`;
