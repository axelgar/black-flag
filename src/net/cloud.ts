// The one door to the server. The game never waits on it: what a player owns is kept on
// this device first and sent when the server can be reached, so a tap on bad bar wifi
// still reveals the ship at once and is counted later.
//
// supabase-js is fetched after the sea is up, in its own chunk; the first paint does not
// pay for it. With no key configured, nothing here runs and the game is as it was.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normCode } from '../data/unlocks';
import { AUTH_KEY, save, session, type Via } from '../state/session';
import { reconcile } from './items';

const URL = import.meta.env.VITE_SUPABASE_URL || 'https://vspueoyeaorfmbmefhiv.supabase.co';
// Publishable: it is meant to ship in the page. What a phone may do is decided by the
// database's own rules (supabase/migrations), not by keeping this secret.
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mbZmUcrjjPBgNHqvdgu2_g_D_Xvyamy';

export type Status = 'off' | 'connecting' | 'online' | 'offline';
export const cloud = { status: 'off' as Status };

let client: SupabaseClient | null = null;
let nobody = false;
let joining: Promise<boolean> | null = null;
let flushing: Promise<void> | null = null;

/** Screens that show the captain redraw on this. */
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

/** Sign in (anonymously, the first time), bring both lists together, and send what is
 *  waiting. Safe to call as often as you like; calls while one is running share it. */
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
    const { gain, send } = reconcile(session.unlocked, me.items, session.outbox, new Date().toISOString());
    session.unlocked.push(...gain);
    session.outbox.push(...send);
    session.captain = me.captain;
    save();
    cloud.status = 'online';
    told();
    await flush();
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
async function whoAmI(sb: SupabaseClient): Promise<{ captain: string; items: string[] } | null> {
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
  return data as { captain: string; items: string[] };
}

/** Send every waiting tap, oldest first. Stops at the first that cannot get through, to
 *  try again later; one the server turns down is dropped, or it would be sent for ever. */
function flush(): Promise<void> {
  if (!client || cloud.status !== 'online') return Promise.resolve();
  return (flushing ??= drain(client).finally(() => { flushing = null; }));
}

async function drain(sb: SupabaseClient) {
  while (session.outbox.length) {
    const t = session.outbox[0];
    const { error, status } = await sb.rpc('redeem', { p_code: t.code, p_via: t.via, p_tapped: t.at });
    if (error && (status === 0 || status === 401 || status >= 500)) return;
    if (error) console.warn('[cloud] the server turned down a tap', t, error.message);
    session.outbox.shift();
    save();
  }
}

/** This page is the bar's screen, which is nobody: it never signs in, so it makes no
 *  player of its own. */
export function asNobody() { nobody = true; }

/** A tag tapped, a QR scanned, a code typed: written down here, then sent. */
export function tap(code: string, via: Via) {
  const c = normCode(code);
  if (!c) return;
  session.outbox.push({ code: c, via, at: new Date().toISOString() });
  save();
  // Not yet started (a tap opened the page): the boot's own connect sends it.
  if (cloud.status === 'online') void flush();
  else if (cloud.status === 'offline') void connect();
}

/** Who this device is signed in as, and the token that proves it: what a shared sea asks
 *  for at the gangway. Null when the server cannot be reached. */
export async function credentials(): Promise<{ token: string; seat: string } | null> {
  if (cloud.status !== 'online' && !(await connect())) return null;
  const { data } = await client!.auth.getSession();
  const s = data.session;
  return s ? { token: s.access_token, seat: s.user.id } : null;
}

/** Sail under another name. Resolves to the name as the server stored it. */
export async function rename(name: string): Promise<string> {
  if (cloud.status !== 'online' && !(await connect())) throw new Error('offline');
  const { data, error } = await client!.rpc('rename_captain', { p_captain: name });
  if (error) throw error;
  session.captain = data as string;
  save();
  told();
  return session.captain;
}

// Wifi back: whatever was waiting goes.
if (typeof addEventListener === 'function') addEventListener('online', () => { void connect(); });
