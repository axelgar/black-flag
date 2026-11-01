// The server's rules, checked without a server. Every migration in supabase/migrations
// runs against an in-process Postgres (PGlite), with the few pieces of Supabase it leans
// on stubbed: the anon and authenticated roles, the grants Supabase gives them, and
// auth.uid(). What a guest's phone can and cannot do to the tables is tested as that
// guest, through the same functions the game calls.

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

const ANNE = '00000000-0000-4000-8000-00000000a111';
const BART = '00000000-0000-4000-8000-00000000b222';
const CARA = '00000000-0000-4000-8000-00000000c333';
const DAVE = '00000000-0000-4000-8000-00000000d444';
const ERIN = '00000000-0000-4000-8000-00000000e555';
const FRAN = '00000000-0000-4000-8000-00000000f666';

let db: PGlite;

/** Run a query as a signed-in guest (or, with null, as nobody at all). */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = [], role = uid ? 'authenticated' : 'anon') {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}

/** The sea server, with its secret key: nobody in particular. */
const server = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as<T>(null, sql, params, 'service_role');

interface Prize { id: number; saved: boolean; redeemed_at: string | null; valid_until: string }
interface Me { id: string; captain: string; items: string[]; ticket: boolean; email: string | null; marketing: boolean; prizes: Prize[] }
const me = async (uid: string) => (await as<{ me: Me }>(uid, 'select public.me()'))[0].me;
const redeem = async (uid: string, code: string, via = 'nfc', at: string | null = null) =>
  (await as<{ redeem: { item: string | null; news: boolean; ticket?: string } }>(uid, 'select public.redeem($1, $2, $3)', [code, via, at]))[0].redeem;
const win = async (uid: string) => (await server<{ record_win: { prize: number | null } }>('select public.record_win($1, $2)', [uid, 'BAR1']))[0].record_win.prize;
/** They type the code Supabase sent them: the email is theirs. */
const proves = (uid: string, email: string) => db.query('update auth.users set email = $2, email_confirmed_at = now() where id = $1', [uid, email]);
const save = async (uid: string, marketing = false) => (await as<{ save_prizes: { saved: number; taken: number } }>(uid, 'select public.save_prizes($1)', [marketing]))[0].save_prizes;
const events = async (uid: string) => (await db.query<{ kind: string }>('select kind from public.events where player_id = $1 order by id', [uid])).rows.map((r) => r.kind);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  const dir = 'supabase/migrations';
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5), ($6)', [ANNE, BART, CARA, DAVE, ERIN, FRAN]);
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

describe('a night at the bar', () => {
  it('runs from six in the morning to six the next, Madrid time', async () => {
    const night = async (t: string) => (await db.query<{ n: string }>('select public.night($1)::text as n', [t])).rows[0].n;
    expect(await night('2026-11-02T04:59:00Z')).toBe('2026-11-01');   // 05:59 in Madrid
    expect(await night('2026-11-02T05:00:00Z')).toBe('2026-11-02');
    expect(await night('2026-07-02T03:59:00Z')).toBe('2026-07-01');   // summer time: 05:59
  });
});

describe('a ticket', () => {
  it('is given by a tap on the Black Flag tag, once: tapping again while it is open does nothing', async () => {
    expect(await redeem(CARA, 'BLACKFLAG', 'nfc')).toEqual({ item: 'ticket:black-flag', news: true, ticket: 'new' });
    expect(await redeem(CARA, 'BLACKFLAG', 'link')).toEqual({ item: 'ticket:black-flag', news: false, ticket: 'open' });
    expect((await me(CARA)).ticket).toBe(true);
    expect((await me(CARA)).items).toEqual([]);
    expect(await events(CARA)).toEqual(['ticket']);
  });

  it('wins a free shot on five in a row, said by the sea server, and then is spent for the night', async () => {
    const prize = await win(CARA);
    expect(prize).toBeTypeOf('number');
    const m = await me(CARA);
    expect(m.ticket).toBe(false);
    expect(m.prizes).toEqual([expect.objectContaining({ id: prize, saved: false, redeemed_at: null })]);
    expect(Date.parse(m.prizes[0].valid_until) - Date.now()).toBeGreaterThan(29 * 86400e3);
    expect(await redeem(CARA, 'BLACKFLAG')).toEqual({ item: 'ticket:black-flag', news: false, ticket: 'spent' });
    expect((await me(CARA)).ticket).toBe(false);
  });

  it('without one, five in a row is practice: counted, and nothing won', async () => {
    expect(await win(CARA)).toBeNull();
    expect(await win(BART)).toBeNull();
    expect((await me(BART)).prizes).toEqual([]);
    expect(await events(CARA)).toEqual(['ticket', 'win', 'practice_win']);
  });

  it('cannot be won by a phone itself', async () => {
    await redeem(DAVE, 'BLACKFLAG');
    await expect(as(DAVE, 'select public.record_win($1)', [DAVE])).rejects.toThrow(/permission denied/);
    expect((await me(DAVE)).ticket).toBe(true);
  });
});

describe('a free shot', () => {
  it('is saved with an email they have proved, with the bar\'s news only if they ask for it', async () => {
    await expect(save(CARA)).rejects.toThrow(/no email/);
    await proves(CARA, 'Cara@Example.com');
    expect(await save(CARA, true)).toEqual({ saved: 1, taken: 0 });
    const m = await me(CARA);
    expect(m.prizes[0].saved).toBe(true);
    expect(m.email).toBe('Cara@Example.com');
    expect(m.marketing).toBe(true);
    expect((await db.query('select email from public.prizes where player_id = $1', [CARA])).rows).toEqual([{ email: 'cara@example.com' }]);
  });

  it('is one a night for each email, whichever phone it was won on', async () => {
    await win(DAVE);
    await proves(DAVE, 'cara@example.com');
    expect(await save(DAVE)).toEqual({ saved: 0, taken: 1 });
    expect((await me(DAVE)).prizes[0].saved).toBe(false);
  });

  it('is poured once, in front of the bartender, and only once saved', async () => {
    const dave = (await me(DAVE)).prizes[0].id, cara = (await me(CARA)).prizes[0].id;
    await expect(as(DAVE, 'select public.redeem_prize($1)', [dave])).rejects.toThrow(/cannot be poured/);
    await expect(as(DAVE, 'select public.redeem_prize($1)', [cara])).rejects.toThrow(/cannot be poured/);
    const [{ redeem_prize: at }] = await as<{ redeem_prize: Date }>(CARA, 'select public.redeem_prize($1)', [cara]);
    expect(Math.abs(new Date(at).getTime() - Date.now())).toBeLessThan(5000);
    await expect(as(CARA, 'select public.redeem_prize($1)', [cara])).rejects.toThrow(/cannot be poured/);
    expect((await me(CARA)).prizes[0].redeemed_at).not.toBeNull();
    expect(await events(CARA)).toEqual(['ticket', 'win', 'practice_win', 'email', 'redeem']);
  });

  it('comes along when a phone signs in to the account its email already has', async () => {
    await proves(FRAN, 'fran@example.com');
    await redeem(ERIN, 'BLACKFLAG');
    const prize = await win(ERIN);
    const [{ hand_over: token }] = await as<{ hand_over: string }>(ERIN, 'select public.hand_over()');
    // the code is typed, and the phone is Fran now
    await as(FRAN, 'select public.take_over($1)', [token]);
    expect((await me(ERIN)).prizes).toEqual([]);
    expect((await me(FRAN)).prizes.map((p) => p.id)).toEqual([prize]);
    expect(await save(FRAN)).toEqual({ saved: 1, taken: 0 });
    // a token works once
    await redeem(ERIN, 'BLACKFLAG');
    await as(BART, 'select public.take_over($1)', [token]);
    expect((await me(BART)).prizes).toEqual([]);
  });
});

describe('the bar\'s numbers', () => {
  it('a phone can say it sailed, was turned away or sank its first ship, and nothing else', async () => {
    await as(BART, `select public.log_event('sail', '{"sea":"BAR1"}')`);
    await expect(as(BART, `select public.log_event('win')`)).rejects.toThrow(/not a phone's to say/);
    expect(await as(BART, 'select * from public.events')).toEqual([]);
    await expect(as(BART, `insert into public.events (player_id, kind) values ($1, 'win')`, [BART])).rejects.toThrow(/permission denied/);
    await expect(as(BART, `insert into public.prizes (player_id, night, valid_until) values ($1, current_date, now())`, [BART])).rejects.toThrow(/permission denied/);
  });
});
