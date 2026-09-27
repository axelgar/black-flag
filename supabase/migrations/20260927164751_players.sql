-- Players, what they own, and every tap on a tag.
--
-- A guest is a player from their first tap: the game signs them in anonymously, and
-- later they can link Google or another provider to the same account and keep it all.
-- Clients never write a table directly. They read their own rows, and every write goes
-- through a function below, which is where the rules live.

/* ------------------------------------------------------------------ tables -- */

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  captain text not null
    check (char_length(captain) between 1 and 24 and captain = btrim(captain) and captain !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now()
);

-- Items are namespaced: 'hull:kestrel' now, 'part:…' when ships can be dressed.
create table public.inventory (
  player_id uuid not null references public.players (id) on delete cascade,
  item text not null check (item ~ '^[a-z]+:[a-z0-9-]+$'),
  source text not null,
  acquired_at timestamptz not null default now(),
  primary key (player_id, item)
);

-- The register: what each code unlocks, and where its tag or QR hangs. Codes are stored
-- the way normCode() in src/data/unlocks.ts writes them: capitals and digits only.
create table public.unlock_codes (
  code text primary key check (code ~ '^[A-Z0-9]{1,32}$'),
  item text not null check (item ~ '^[a-z]+:[a-z0-9-]+$'),
  venue text,
  cocktail text,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every tap, whether it unlocked anything or not: taps, players and return visits.
--   nfc   the tag at the bar (its URL carries ?src=nfc)
--   link  a QR code, or the link shared on
--   typed the shipyard's code box
--   sync  a ship this device already had before the server heard of it
create table public.taps (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  code text not null,
  item text,
  via text not null check (via in ('nfc', 'link', 'typed', 'sync')),
  news boolean not null,
  at timestamptz not null default now()
);
create index taps_player_idx on public.taps (player_id);
create index taps_at_idx on public.taps (at);

alter table public.players enable row level security;
alter table public.inventory enable row level security;
alter table public.unlock_codes enable row level security;
alter table public.taps enable row level security;

create policy "a player reads their own row" on public.players
  for select to authenticated using (id = (select auth.uid()));
create policy "a player reads what they own" on public.inventory
  for select to authenticated using (player_id = (select auth.uid()));
-- unlock_codes and taps have no policies: no client reads or writes them.

revoke insert, update, delete, truncate on public.players, public.inventory, public.unlock_codes, public.taps
  from anon, authenticated;

/* --------------------------------------------------------------- functions -- */

-- A name to sail under until they choose one.
create function public.captain_name() returns text
language sql volatile set search_path = '' as $$
  select (array['Black', 'Red', 'Grey', 'Mad', 'Iron', 'Salt', 'Grim', 'Lucky', 'Silver', 'Stormy',
                'Old', 'One-Eyed', 'Brass', 'Crooked', 'Quiet', 'Gentle', 'Barnacle', 'Long', 'Calico', 'Cutlass']
         )[1 + floor(random() * 20)::int]
      || ' ' ||
         (array['Anne', 'Jack', 'Mary', 'Ned', 'Tom', 'Kate', 'Will', 'Bess', 'Finn', 'Nell',
                'Sam', 'Jonas', 'Grace', 'Hal', 'Rose', 'Ben', 'Moll', 'Kit', 'Peg', 'Rafe']
         )[1 + floor(random() * 20)::int];
$$;

-- The player row is made the first time the game asks for it, not by a trigger on
-- auth.users: a failing trigger there fails the sign-in itself.
create function public.ensure_player(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.players (id, captain) values (p_id, public.captain_name()) on conflict (id) do nothing;
$$;

/** Who am I, and what do I own? Makes the player on the first call. */
create function public.me() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_player(uid);
  return jsonb_build_object(
    'id', uid,
    'captain', (select p.captain from public.players p where p.id = uid),
    'items', coalesce((select jsonb_agg(i.item order by i.acquired_at) from public.inventory i where i.player_id = uid), '[]'::jsonb)
  );
end $$;

/** A tap on a tag, a scanned QR, or a typed code. Returns what it unlocked and whether it
 *  was news. An unknown code is still logged, and unlocks nothing. */
create function public.redeem(p_code text, p_via text default 'link', p_tapped timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  norm text := left(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), 32);
  via text := case when p_via in ('nfc', 'link', 'typed', 'sync') then p_via else 'link' end;
  -- a tap made offline is sent later with the time it happened; trust it within a month
  tapped timestamptz := least(now(), greatest(coalesce(p_tapped, now()), now() - interval '30 days'));
  hit public.unlock_codes;
  fresh boolean := false;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if norm = '' then return jsonb_build_object('item', null, 'news', false); end if;
  perform public.ensure_player(uid);
  select * into hit from public.unlock_codes c where c.code = norm and c.active;
  if hit.item is not null then
    insert into public.inventory (player_id, item, source) values (uid, hit.item, 'code:' || norm)
      on conflict (player_id, item) do nothing;
    fresh := found;
  end if;
  insert into public.taps (player_id, code, item, via, news, at) values (uid, norm, hit.item, via, fresh, tapped);
  return jsonb_build_object('item', hit.item, 'news', fresh);
end $$;

/** Sail under another name. Returns the name as stored. */
create function public.rename_captain(p_captain text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  chosen text := left(btrim(regexp_replace(coalesce(p_captain, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 24);
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if chosen = '' then raise exception 'a captain needs a name' using errcode = '22023'; end if;
  perform public.ensure_player(uid);
  update public.players set captain = chosen where id = uid;
  return chosen;
end $$;

revoke execute on function public.captain_name(), public.ensure_player(uuid) from public, anon, authenticated;
revoke execute on function public.me(), public.redeem(text, text, timestamptz), public.rename_captain(text) from public, anon;
grant execute on function public.me(), public.redeem(text, text, timestamptz), public.rename_captain(text) to authenticated;

/* ---------------------------------------------------------------- the seed -- */

-- The three codes already printed and written to tags (src/data/ships.ts).
insert into public.unlock_codes (code, item, label) values
  ('KSTRL7Q', 'hull:kestrel', 'Kestrel'),
  ('RVNT4K', 'hull:revenant', 'Revenant'),
  ('MAREE9X', 'hull:maree', 'Marée Noire');
