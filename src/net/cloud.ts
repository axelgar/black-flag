// The one door to the server. The phone signs in anonymously the first time it opens the
// game, and that sign-in is the seat it sails in on a shared sea. Through here too: the
// ticket a tag gives, the free shot a win gives (saved with an email and a code Supabase
// sends), pouring it, and the few things the bar counts (supabase/migrations).
//
// supabase-js is fetched after the first screen is up, in its own chunk; the first paint
// does not pay for it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_KEY } from '../state/session';
import { SUPABASE_KEY, SUPABASE_URL } from './project';

const URL = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_KEY;

export type Status = 'off' | 'connecting' | 'online' | 'offline';
export const cloud = { status: 'off' as Status };

/** A free shot: won, then saved with an email, then poured. */
export interface Prize { id: number; won_at: string; valid_until: string; saved: boolean; redeemed_at: string | null }
/** Who this phone is to the server: me() in the database. */
export interface Me { id: string; captain: string; ticket: boolean; email: string | null; marketing: boolean; prizes: Prize[] }
/** The newest word on who this phone is. Null until signed in. Screens redraw on `bf:me`. */
export let me: Me | null = null;

/** Seconds a request to the server may take before it counts as failed. One that can't
 *  get through (a wifi that blocks the server) would otherwise hang for minutes, and the
 *  guest with it, looking at "Finding the sea…". */
const PATIENCE = 8;

/** fetch, given up on after PATIENCE seconds. */
function patient(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('the server took too long', 'TimeoutError')), PATIENCE * 1000);
  const theirs = init.signal;
  if (theirs?.aborted) ctl.abort(theirs.reason);
  else theirs?.addEventListener('abort', () => ctl.abort(theirs.reason), { once: true });
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

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
    global: { fetch: patient },
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
async function whoAmI(sb: SupabaseClient): Promise<Me | null> {
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
  heard(data as Me);
  return data as Me;
}

function heard(m: Me) {
  me = { ...m, prizes: m.prizes ?? [] };
  window.dispatchEvent(new Event('bf:me'));
}

/** Ask again who this phone is: after a win, a save or a pour. */
export async function refresh(): Promise<Me | null> {
  if (cloud.status !== 'online' && !(await connect())) return null;
  const { data, error } = await client!.rpc('me');
  if (error) throw error;
  heard(data as Me);
  return me;
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

/* ------------------------------------------------------- tickets and shots -- */

export type Via = 'nfc' | 'link';
/** What a tap on the Black Flag tag did: 'new', a ticket for tonight; 'open', one was
 *  already waiting; 'spent', tonight's has won. Null for any other code. */
export type Ticket = 'new' | 'open' | 'spent' | null;

/** A tap on a tag, or a scan of its QR code. */
export async function tap(code: string, via: Via): Promise<Ticket> {
  if (!(await connect())) throw new Error('offline');
  const { data, error } = await client!.rpc('redeem', { p_code: code, p_via: via });
  if (error) throw error;
  await refresh();
  return (data as { ticket?: Ticket }).ticket ?? null;
}

/** How saving a free shot goes: 'change', the email is new and this account takes it;
 *  'signin', the email has an account already, and the phone signs in to it, bringing
 *  what it won; 'known', it is this account's own already, and no code is needed. Kept
 *  for the page's life, so a reload mid-way starts again. */
export type Route = 'change' | 'signin' | 'known';
let handover = '';

/** Send a code to this email. `signin` straight away when the guest says they have saved
 *  a free shot before. */
export async function sendCode(email: string, signin = false): Promise<Route> {
  if (!(await connect())) throw new Error('offline');
  const sb = client!;
  const { data: { user } } = await sb.auth.getUser();
  if (!signin && user?.is_anonymous) {
    const { error } = await sb.auth.updateUser({ email });
    if (!error) return 'change';
    if (error.code !== 'email_exists') throw error;
  }
  if (user?.email?.toLowerCase() === email.toLowerCase()) return 'known';
  const { data, error } = await sb.rpc('hand_over');
  if (error) throw error;
  handover = data as string;
  const sent = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (sent.error) throw sent.error;
  return 'signin';
}

/** The code they typed. On 'signin' the phone is the other account after this, with what
 *  it had won. */
export async function verifyCode(email: string, code: string, route: Route): Promise<void> {
  const sb = client!;
  const { error } = await sb.auth.verifyOtp({ email, token: code, type: route === 'change' ? 'email_change' : 'email' });
  if (error) throw error;
  if (route === 'signin' && handover) {
    const r = await sb.rpc('take_over', { p_token: handover });
    if (r.error) throw r.error;
    handover = '';
  }
  await refresh();
}

/** Save what is won to the email now proved. `taken`: free shots from a night this email
 *  already has one for, left unsaved. */
export async function savePrizes(marketing: boolean): Promise<{ saved: number; taken: number }> {
  if (!(await connect())) throw new Error('offline');
  const { data, error } = await client!.rpc('save_prizes', { p_marketing: marketing });
  if (error) throw error;
  await refresh();
  return data as { saved: number; taken: number };
}

/** Pour it. Returns when. */
export async function pour(id: number): Promise<Date> {
  if (!(await connect())) throw new Error('offline');
  const { data, error } = await client!.rpc('redeem_prize', { p_id: id });
  if (error) throw error;
  await refresh();
  return new Date(data as string);
}

/** One of the few things a phone counts for the bar. Never in the way of the game. */
export function count(kind: 'sail' | 'turned_away' | 'first_sink', data: Record<string, unknown> = {}) {
  if (cloud.status !== 'online' || !client) return;
  void client.rpc('log_event', { p_kind: kind, p_data: data }).then(({ error }) => { if (error) console.warn('[cloud] count', error); });
}

// Wifi back: sign in, if it had not yet.
if (typeof addEventListener === 'function') addEventListener('online', () => { void connect(); });
