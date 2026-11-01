// The one door to the server. The phone signs in anonymously the first time it opens the
// game, and that sign-in is the seat it sails in on a shared sea.
//
// supabase-js is fetched after the first screen is up, in its own chunk; the first paint
// does not pay for it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_KEY } from '../state/session';

const URL = import.meta.env.VITE_SUPABASE_URL || 'https://vspueoyeaorfmbmefhiv.supabase.co';
// Publishable: it is meant to ship in the page. What a phone may do is decided by the
// database's own rules (supabase/migrations), not by keeping this secret.
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mbZmUcrjjPBgNHqvdgu2_g_D_Xvyamy';

export type Status = 'off' | 'connecting' | 'online' | 'offline';
export const cloud = { status: 'off' as Status };

let client: SupabaseClient | null = null;
let nobody = false;
let joining: Promise<boolean> | null = null;

/** Screens that show whether the server is there redraw on this. */
const told = () => window.dispatchEvent(new Event('bf:cloud'));

async function open(): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(URL, KEY, {
    auth: {
      storageKey: AUTH_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // A login will come back as ?code=… (PKCE), not in the #fragment the router owns.
      flowType: 'pkce',
      detectSessionInUrl: true,
    },
  });
  return client;
}

/** Sign in (anonymously, the first time). Safe to call as often as you like; calls while
 *  one is running share it. */
export function connect(): Promise<boolean> {
  if (!KEY || nobody) return Promise.resolve(false);
  return (joining ??= join().finally(() => { joining = null; }));
}

async function join(): Promise<boolean> {
  cloud.status = 'connecting';
  try {
    const sb = await open();
    let me = await whoAmI(sb);
    if (!me) {
      // A sign-in the server no longer honours (the player was removed, the keys were
      // rotated) is let go, and the guest starts again as a new anonymous player.
      await sb.auth.signOut({ scope: 'local' });
      me = await whoAmI(sb);
      if (!me) throw new Error('the server would not sign this device in');
    }
    cloud.status = 'online';
    told();
    return true;
  } catch (err) {
    cloud.status = 'offline';
    console.warn('[cloud]', err);
    told();
    return false;
  }
}

/** The player this device is signed in as, making one if it is not. Null when the server
 *  refuses the sign-in it has; throws when it cannot be reached. */
async function whoAmI(sb: SupabaseClient): Promise<{ id: string } | null> {
  const { data: { session: auth } } = await sb.auth.getSession();
  if (!auth) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }
  const { data, error, status } = await sb.rpc('me');
  // 401: the token is refused. 23503: the token is still good, but the player behind it
  // has been deleted (old anonymous players get cleared out), so there is no one to be.
  if (status === 401 || error?.code === '23503') return null;
  if (error) throw error;
  return data as { id: string };
}

/** This page is the bar's screen, which is nobody: it never signs in, so it makes no
 *  player of its own. */
export function asNobody() { nobody = true; }

/** Who this device is signed in as, and the token that proves it: what a shared sea asks
 *  for at the gangway. Null when the server cannot be reached. */
export async function credentials(): Promise<{ token: string; seat: string } | null> {
  if (cloud.status !== 'online' && !(await connect())) return null;
  const { data } = await client!.auth.getSession();
  const s = data.session;
  return s ? { token: s.access_token, seat: s.user.id } : null;
}

// Wifi back: sign in, if it had not yet.
if (typeof addEventListener === 'function') addEventListener('online', () => { void connect(); });
