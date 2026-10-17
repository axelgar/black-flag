// What a player can own, as the server spells it, and how this device's list and the
// server's are brought together. Items are namespaced so hulls and, later, the parts a
// ship is dressed in can share one inventory: 'hull:kestrel', 'part:sail-crimson'.

import { SHIPS } from '../data/ships';
import { normCode } from '../data/unlocks';

/** A tap on a tag, a scanned QR or a typed code, waiting to reach the server. `sync` is a
 *  ship this device had before the server knew of it. */
export type Via = 'nfc' | 'link' | 'typed' | 'sync';
export interface Tap { code: string; via: Via; at: string }

export const itemOf = (shipId: string) => `hull:${shipId}`;

/** The ship an item is, or null for anything that is not a hull. */
export function shipOf(item: string): string | null {
  return item.startsWith('hull:') ? item.slice(5) : null;
}

/**
 * Both lists end up with every ship either has. `gain` is what the server says the player
 * owns and this device does not (a cleared phone, or another device once there is a
 * login). `send` is what this device has that the server never heard of, such as ships
 * unlocked before there was a server, sent as the code that unlocks them. A code
 * already waiting in the outbox is not sent twice.
 */
export function reconcile(local: readonly string[], owned: readonly string[], outbox: readonly Tap[], at: string) {
  const known = new Set(SHIPS.map((s) => s.id));
  const have = new Set(local);
  const theirs = new Set(owned.map(shipOf).filter((id): id is string => !!id && known.has(id)));
  const queued = new Set(outbox.map((t) => normCode(t.code)));
  const gain = [...theirs].filter((id) => !have.has(id));
  const send: Tap[] = [];
  for (const s of SHIPS) {
    if (s.unlock === 'starter' || !have.has(s.id) || theirs.has(s.id)) continue;
    if (queued.has(normCode(s.unlock.code))) continue;
    send.push({ code: normCode(s.unlock.code), via: 'sync', at });
  }
  return { gain, send };
}
