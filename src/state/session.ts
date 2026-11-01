// What this device remembers: the captain's name and ship, and the switches. localStorage,
// one key.

import { LOOKS, STARTER } from '../data/ships';

export interface Session {
  v: 3;
  /** The name typed on the first screen, kept for next time. Empty until then. */
  name: string;
  look: string;
  sound: boolean;
  haptics: boolean;
  /** The first-time hints have been seen through. */
  hinted: boolean;
}

const KEY = 'blackflag.v3';
/** Where the server sign-in keeps itself (src/net/cloud.ts). */
export const AUTH_KEY = 'blackflag.auth';

const blank = (): Session => ({
  v: 3, name: '', look: LOOKS[Math.floor(Math.random() * LOOKS.length)]?.id ?? STARTER,
  sound: true, haptics: true, hinted: false,
});

const store = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

function load(): Session {
  try {
    const raw = store()?.getItem(KEY);
    if (raw) {
      const s = { ...blank(), ...JSON.parse(raw) } as Session;
      if (!LOOKS.some((l) => l.id === s.look)) s.look = STARTER;
      if (typeof s.name !== 'string') s.name = '';
      return s;
    }
  } catch { /* a corrupt save is a blank one */ }
  return blank();
}

export const session: Session = load();

export function save() {
  try { store()?.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
}
