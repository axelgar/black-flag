// The server's rules, checked without a server. Every migration in supabase/migrations
// runs against an in-process Postgres (PGlite), with the few pieces of Supabase it leans
// on stubbed: the anon and authenticated roles, the grants Supabase gives them, and
// auth.uid(). What a guest's phone can and cannot do to the tables is tested as that
// guest, through the same functions the game calls.

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHIPS } from '../src/data/ships';
import { normCode } from '../src/data/unlocks';
import { itemOf } from '../src/net/items';

const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

const ANNE = '00000000-0000-4000-8000-00000000a111';
const BART = '00000000-0000-4000-8000-00000000b222';

let db: PGlite;

/** Run a query as a signed-in guest (or, with null, as nobody at all). */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}

const me = async (uid: string) => (await as<{ me: { id: string; captain: string; items: string[] } }>(uid, 'select public.me()'))[0].me;
const redeem = async (uid: string, code: string, via = 'nfc', at: string | null = null) =>
  (await as<{ redeem: { item: string | null; news: boolean } }>(uid, 'select public.redeem($1, $2, $3)', [code, via, at]))[0].redeem;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  const dir = 'supabase/migrations';
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2)', [ANNE, BART]);
}, 60_000);

describe('a player', () => {
  it('is made the first time the game asks, with a name to sail under', async () => {
    const first = await me(ANNE);
    expect(first.id).toBe(ANNE);
    expect(first.captain).toMatch(/^\S+ \S+$/);
    expect(first.items).toEqual([]);
    expect((await me(ANNE)).captain).toBe(first.captain);
  });

  it('can change their name, tidied, and not to nothing', async () => {
    const [{ rename_captain: name }] = await as<{ rename_captain: string }>(ANNE, 'select public.rename_captain($1)', ['  Anne \n  Bonny  the Very Long-Named Terror  ']);
    expect(name).toBe('Anne Bonny the Very Long');
    expect((await me(ANNE)).captain).toBe(name);
    await expect(as(ANNE, 'select public.rename_captain($1)', ['   '])).rejects.toThrow(/needs a name/);
  });

  it('nobody signed in can do nothing at all', async () => {
    await expect(as(null, 'select public.me()')).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.redeem('KSTRL7Q')`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.rename_captain('x')`)).rejects.toThrow(/permission denied/);
  });
});

describe('a tap', () => {
  it('unlocks the ship on its tag once, and counts every tap after', async () => {
    expect(await redeem(BART, 'KSTRL-7Q')).toEqual({ item: 'hull:kestrel', news: true });
    expect(await redeem(BART, 'kstrl7q', 'link')).toEqual({ item: 'hull:kestrel', news: false });
    expect((await me(BART)).items).toEqual(['hull:kestrel']);
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from public.taps where player_id = $1`, [BART]).then((r) => r.rows);
    expect(n).toBe(2);
  });

  it('on a code that is not on the register unlocks nothing, and is still counted', async () => {
    expect(await redeem(BART, 'NOT-A-SHIP')).toEqual({ item: null, news: false });
    const rows = (await db.query<{ item: string | null }>(`select item from public.taps where code = 'NOTASHIP'`)).rows;
    expect(rows).toEqual([{ item: null }]);
  });

  it('made offline keeps the time it happened, but not a time in the future', async () => {
    const then = new Date(Date.now() - 3 * 86400e3).toISOString();
    await redeem(ANNE, 'RVNT-4K', 'sync', then);
    await redeem(ANNE, 'RVNT-4K', 'nfc', '2099-01-01T00:00:00Z');
    const rows = (await db.query<{ via: string; at: Date }>(`select via, at from public.taps where player_id = $1 and code = 'RVNT4K' order by id`, [ANNE])).rows;
    expect(Math.abs(rows[0].at.getTime() - Date.parse(then))).toBeLessThan(1000);
    expect(rows[1].at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(rows.map((r) => r.via)).toEqual(['sync', 'nfc']);
  });

  it('a code switched off unlocks nothing', async () => {
    await db.exec(`update public.unlock_codes set active = false where code = 'MAREE9X'`);
    expect(await redeem(ANNE, 'MAREE-9X')).toEqual({ item: null, news: false });
    await db.exec(`update public.unlock_codes set active = true where code = 'MAREE9X'`);
  });
});

describe('what a phone can touch', () => {
  it('reads only its own player and inventory', async () => {
    expect(await as(ANNE, 'select id from public.players')).toEqual([{ id: ANNE }]);
    const items = await as<{ player_id: string }>(ANNE, 'select player_id from public.inventory');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((r) => r.player_id === ANNE)).toBe(true);
  });

  it('cannot read the register or the taps', async () => {
    expect(await as(ANNE, 'select * from public.unlock_codes')).toEqual([]);
    expect(await as(ANNE, 'select * from public.taps')).toEqual([]);
  });

  it('cannot write a table, only call the functions', async () => {
    await expect(as(ANNE, `insert into public.inventory (player_id, item, source) values ($1, 'hull:maree', 'me')`, [ANNE])).rejects.toThrow(/permission denied/);
    await expect(as(ANNE, `update public.players set captain = 'Blackbeard' where id = $1`, [ANNE])).rejects.toThrow(/permission denied/);
    await expect(as(ANNE, `insert into public.unlock_codes (code, item) values ('FREE', 'hull:maree')`)).rejects.toThrow(/permission denied/);
    await expect(as(ANNE, `select public.ensure_player($1)`, [BART])).rejects.toThrow(/permission denied/);
  });
});

describe('the register', () => {
  it('matches the game: every code a ship carries unlocks that ship on the server', async () => {
    const rows = (await db.query<{ code: string; item: string }>('select code, item from public.unlock_codes')).rows;
    const server = new Map(rows.map((r) => [r.code, r.item]));
    for (const s of SHIPS) {
      if (s.unlock === 'starter') continue;
      expect(server.get(normCode(s.unlock.code)), s.id).toBe(itemOf(s.id));
    }
  });
});
