-- The bar's game (PLANS/MVP.md): a ticket for each Black Flag ordered, a free shot for
-- five in a row sailed on one, and the bar's own count of how its nights go.
--
-- The tag at the bar opens /u/BLACKFLAG, and the tap is a redeem() as before: on the
-- ticket code it gives this phone tonight's ticket. Only the sea server turns a ticket
-- into a win (record_win, called with the server's secret key), so no phone can claim
-- one. The guest saves the free shot with an email, proved by a code Supabase sends, and
-- shows it to the bartender to redeem it.
--
-- Everything here is new beside what the live game (v2) uses: its tables and the
-- answers of me() and redeem() keep every field they had.
--
-- The bar's nights run from 6:00 to 6:00, Madrid time.

/* ------------------------------------------------------------------ tables -- */

-- One ticket a phone a night, and only one open at a time: tapping again while one is
-- open does nothing. A ticket lasts until it wins.
create table public.tickets (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  code text not null,
  via text not null check (via in ('nfc', 'link', 'typed', 'sync')),
  night date not null,
  issued_at timestamptz not null default now(),
  won_at timestamptz
);
create unique index tickets_one_a_night on public.tickets (player_id, night);
create unique index tickets_one_open on public.tickets (player_id) where won_at is null;

-- A free shot: won on a ticket, saved with an email, redeemed at the bar. One a night
-- for each email, however many phones it was won on.
create table public.prizes (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  -- the ticket it was won on stays with the phone that won it, and may go before the prize
  ticket_id bigint unique references public.tickets (id) on delete set null,
  night date not null,
  won_at timestamptz not null default now(),
  valid_until timestamptz not null,
  email text check (email = lower(email)),
  saved_at timestamptz,
  redeemed_at timestamptz
);
create index prizes_player_idx on public.prizes (player_id);
create unique index prizes_one_an_email_a_night on public.prizes (email, night) where email is not null;

-- A free shot being carried from one account to another: a phone whose email already
-- belongs to an account signs in to it, and brings what it won with it (take_over).
create table public.handovers (
  token text primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  made_at timestamptz not null default now()
);

-- The bar's numbers: no cookies and no tracker, just these rows.
--   ticket        a tap gave a ticket            win           five in a row on a ticket
--   sail          aboard a sea                   practice_win  five in a row without one
--   turned_away   a sea said no                  email         a free shot saved with an email
--   first_sink    the first ship sunk on a visit redeem        a free shot poured
create table public.events (
  id bigint generated always as identity primary key,
  player_id uuid references public.players (id) on delete set null,
  kind text not null check (kind in ('ticket', 'sail', 'turned_away', 'first_sink', 'win', 'practice_win', 'email', 'redeem')),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2000),
  at timestamptz not null default now()
);
create index events_at_idx on public.events (at);

-- Whether they would like news from the bar: never ticked for them.
alter table public.players
  add column marketing boolean not null default false,
  add column marketing_at timestamptz;

alter table public.tickets enable row level security;
alter table public.prizes enable row level security;
alter table public.handovers enable row level security;
alter table public.events enable row level security;

create policy "a player reads their own tickets" on public.tickets
  for select to authenticated using (player_id = (select auth.uid()));
create policy "a player reads their own free shots" on public.prizes
  for select to authenticated using (player_id = (select auth.uid()));
-- handovers and events have no policies: no client reads or writes them.

revoke insert, update, delete, truncate on public.tickets, public.prizes, public.handovers, public.events
  from anon, authenticated;

/* --------------------------------------------------------------- functions -- */

/** The bar's night a moment falls in: 6:00 to 6:00, Madrid time. */
create function public.night(t timestamptz) returns date
language sql stable set search_path = '' as $$
  select ((t at time zone 'Europe/Madrid') - interval '6 hours')::date;
$$;

/** Who am I, what do I own, and what have I won? Makes the player on the first call. */
create or replace function public.me() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_player(uid);
  return jsonb_build_object(
    'id', uid,
    'captain', (select p.captain from public.players p where p.id = uid),
    'items', coalesce((select jsonb_agg(i.item order by i.acquired_at) from public.inventory i where i.player_id = uid), '[]'::jsonb),
    'ticket', exists (select 1 from public.tickets t where t.player_id = uid and t.won_at is null),
    'email', (select u.email from auth.users u where u.id = uid and u.email_confirmed_at is not null),
    'marketing', (select p.marketing from public.players p where p.id = uid),
    -- the free shots still to pour, and any poured in the last twelve hours, to show again
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', z.id, 'won_at', z.won_at, 'valid_until', z.valid_until,
          'saved', z.saved_at is not null, 'redeemed_at', z.redeemed_at) order by z.won_at)
        from public.prizes z
       where z.player_id = uid
         and ((z.redeemed_at is null and z.valid_until > now()) or z.redeemed_at > now() - interval '12 hours')
    ), '[]'::jsonb)
  );
end $$;

/** A tap on a tag, a scanned QR, or a typed code. Returns what it unlocked and whether it
 *  was news; on the ticket code, also how the ticket stands: 'new', 'open' (one is
 *  already waiting) or 'spent' (tonight's has been won). An unknown code is still logged,
 *  and unlocks nothing. */
create or replace function public.redeem(p_code text, p_via text default 'link', p_tapped timestamptz default null)
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
  ticket text := null;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if norm = '' then return jsonb_build_object('item', null, 'news', false); end if;
  perform public.ensure_player(uid);
  select * into hit from public.unlock_codes c where c.code = norm and c.active;
  if hit.item like 'ticket:%' then
    -- a ticket is for tonight, whenever the tap is sent
    insert into public.tickets (player_id, code, via, night)
      select uid, norm, via, public.night(now())
       where not exists (select 1 from public.tickets t
                          where t.player_id = uid and (t.won_at is null or t.night = public.night(now())))
      on conflict do nothing;
    fresh := found;
    ticket := case when fresh then 'new'
                   when exists (select 1 from public.tickets t where t.player_id = uid and t.won_at is null) then 'open'
                   else 'spent' end;
    if fresh then insert into public.events (player_id, kind, data) values (uid, 'ticket', jsonb_build_object('via', via)); end if;
  elsif hit.item is not null then
    insert into public.inventory (player_id, item, source) values (uid, hit.item, 'code:' || norm)
      on conflict (player_id, item) do nothing;
    fresh := found;
  end if;
  insert into public.taps (player_id, code, item, via, news, at) values (uid, norm, hit.item, via, fresh, tapped);
  return jsonb_build_object('item', hit.item, 'news', fresh) || case when ticket is null then '{}'::jsonb else jsonb_build_object('ticket', ticket) end;
end $$;

/** Five in a row, said by the sea server. On an open ticket it is a free shot, valid for
 *  thirty days; without one it is counted as practice. The server's key only. */
create function public.record_win(p_player uuid, p_sea text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tickets;
  prize bigint;
begin
  select * into t from public.tickets where player_id = p_player and won_at is null for update;
  if t.id is null then
    insert into public.events (player_id, kind, data)
      select p_player, 'practice_win', jsonb_build_object('sea', p_sea)
       where exists (select 1 from public.players p where p.id = p_player);
    return jsonb_build_object('prize', null);
  end if;
  update public.tickets set won_at = now() where id = t.id;
  insert into public.prizes (player_id, ticket_id, night, valid_until)
    values (p_player, t.id, public.night(now()), now() + interval '30 days')
    returning id into prize;
  insert into public.events (player_id, kind, data) values (p_player, 'win', jsonb_build_object('sea', p_sea, 'prize', prize));
  return jsonb_build_object('prize', prize);
end $$;

/** The free shots this player has won but not yet saved, saved to the email they have
 *  just proved, and whether they would like the bar's news. A free shot from a night this
 *  email already has one for stays unsaved. Returns how many were saved and how many
 *  were not. */
create function public.save_prizes(p_marketing boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mail text;
  z public.prizes;
  saved int := 0;
  taken int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select lower(u.email) into mail from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if mail is null then raise exception 'no email proved yet' using errcode = '28000'; end if;
  perform public.ensure_player(uid);
  for z in select * from public.prizes where player_id = uid and email is null order by won_at for update loop
    if exists (select 1 from public.prizes q where q.email = mail and q.night = z.night) then
      taken := taken + 1;
    else
      update public.prizes set email = mail, saved_at = now() where id = z.id;
      saved := saved + 1;
    end if;
  end loop;
  update public.players
     set marketing = coalesce(p_marketing, false),
         marketing_at = case when coalesce(p_marketing, false) then now() end
   where id = uid;
  if saved > 0 then
    insert into public.events (player_id, kind, data) values (uid, 'email', jsonb_build_object('marketing', coalesce(p_marketing, false)));
  end if;
  return jsonb_build_object('saved', saved, 'taken', taken);
end $$;

/** Pour it: in front of the bartender, once, and only a saved free shot still valid.
 *  Returns when it was redeemed. */
create function public.redeem_prize(p_id bigint) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  poured timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.prizes set redeemed_at = now()
   where id = p_id and player_id = uid and saved_at is not null and redeemed_at is null and valid_until > now()
   returning redeemed_at into poured;
  if poured is null then raise exception 'this free shot cannot be poured' using errcode = '22023'; end if;
  insert into public.events (player_id, kind, data) values (uid, 'redeem', jsonb_build_object('prize', p_id));
  return poured;
end $$;

/** Before signing in to another account: a token that lets that account take this one's
 *  free shots and open ticket (take_over). Good for an hour. */
create function public.hand_over() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_player(uid);
  delete from public.handovers where made_at < now() - interval '1 hour';
  insert into public.handovers (token, player_id) values (gen_random_uuid()::text, uid) returning token into tok;
  return tok;
end $$;

/** Signed in to another account: take what the phone had won from the one it left, and
 *  its open ticket, unless this account has a ticket open or had one tonight. */
create function public.take_over(p_token text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  was uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.handovers where token = p_token and made_at > now() - interval '1 hour' returning player_id into was;
  if was is null or was = uid then return; end if;
  perform public.ensure_player(uid);
  update public.prizes set player_id = uid where player_id = was;
  update public.tickets t set player_id = uid
   where t.player_id = was and t.won_at is null
     and not exists (select 1 from public.tickets o where o.player_id = uid and (o.won_at is null or o.night = t.night));
end $$;

/** What a phone may say happened: aboard a sea, turned away from one, a first sink. */
create function public.log_event(p_kind text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind not in ('sail', 'turned_away', 'first_sink') then raise exception 'not a phone''s to say' using errcode = '22023'; end if;
  perform public.ensure_player(uid);
  insert into public.events (player_id, kind, data) values (uid, p_kind, coalesce(p_data, '{}'::jsonb));
end $$;

revoke execute on function public.night(timestamptz), public.record_win(uuid, text) from public, anon, authenticated;
grant execute on function public.record_win(uuid, text) to service_role;
revoke execute on function public.save_prizes(boolean), public.redeem_prize(bigint), public.hand_over(),
  public.take_over(text), public.log_event(text, jsonb) from public, anon;
grant execute on function public.save_prizes(boolean), public.redeem_prize(bigint), public.hand_over(),
  public.take_over(text), public.log_event(text, jsonb) to authenticated;

/* ---------------------------------------------------------------- the seed -- */

-- The tag the bartender holds out with every Black Flag, and the QR on its back.
insert into public.unlock_codes (code, item, venue, cocktail, label) values
  ('BLACKFLAG', 'ticket:black-flag', 'main', 'Black Flag', 'Black Flag ticket card');
