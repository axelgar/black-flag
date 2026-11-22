# Switching the bar over

What it takes to put this version (`v3-mvp`) on the bar's site, in order, and how to go back.
Steps marked **(you)** need your accounts or secrets; the rest Claude can run on your
go-ahead.

## Where things stand (22 Nov 2026)

- **The site.** <https://black-flag-two.vercel.app> is Vercel project `axelgars-projects/black-flag`,
  production from branch `main`. It is the early solo game (deployed 5 Sep,
  `dpl_4xZcX6SsiPMyaf6ku5Wfd8amBcSY`), which uses no server and no Supabase. `main` is an
  ancestor of `v3-mvp` (55 commits behind it, none ahead), so the merge is a fast-forward.
  `main` is not a protected branch.
- **Vercel settings.** `VITE_SEA_URL` is set for the `v3-mvp` and `v2-open-sea` previews only.
  Production has none.
- **The sea servers.** This version's server is the Render service `black-flag-sea`
  (`render.yaml`), from branch `v3-mvp`, on the free plan while it is tested. On Cloudflare,
  the worker `black-flag-sea` still runs the v2 sea for the `v2-open-sea` preview, and
  `black-flag-sea-mvp` is the previous test server. Neither is deployed from here any more.
- **Supabase.** All 92 accounts are from development and play-tests: 90 anonymous, and 2
  saved with an email in the save tests. No guest has used it, since production never
  talked to it. The live database has the two migrations in `supabase/migrations/` and
  nothing else.
- **Checked on 22 Nov, at `efa2df6`.** `npm run typecheck`, `npm test` (100 pass),
  `npm run build` and `npm audit --omit=dev` (nothing found). A scripted captain on the
  Render server took a ticket, won five in a row in 70 s and had the free shot written
  down, so the server's `SUPABASE_SECRET` is set and right. The `v3-mvp` preview is built
  from the same commit, against the same server.

## Before the day

1. **The email sender (you).** Resend and the code templates are set up, but the sender
   is still Resend's test address, `onboarding@resend.dev`, which only delivers to the
   Resend account's own email. Verify a domain in Resend (a subdomain such as
   `mail.glitchbars.com` keeps the main one's mail apart), then change the sender in
   Supabase → Authentication → SMTP. Check the emails-an-hour limit under Rate Limits.
2. **Saving a free shot end to end:** done on 2 Nov from a phone on the preview (win, save
   with an email, type the code, the voucher, pour). Once the sender changes, save one
   more with an address outside the Resend account.
3. **The privacy notice (you).** Read `#/privacy` on the preview. It names Glitch Bars,
   info@glitchbars.com, and the database in the EU (Ireland).
4. **The sea server's plan (you).** Move the Render service from Free to Starter, and
   `plan: starter` in `render.yaml`. The free plan sleeps after 15 idle minutes and takes
   about a minute to wake, so the night's first guest would be told the sea can't be reached.
5. **The keys (you).** Under Environment on the Render service, check `WATCH_KEY` (what
   the TV says to look on). `SUPABASE_SECRET` (the project's secret key) is there and
   right: the scripted captain's win was written down on 22 Nov.
6. **The cards.** `npm run qr` prints the tag's link,
   `https://black-flag-two.vercel.app/u/BLACKFLAG?src=nfc`, and writes the QR code for
   the back to `qr/ticket.png`. Write the tags, but don't hand them out until the switch:
   until then, the link opens the old game.
7. **The TV.** A laptop with Chrome, plugged into the TV, with the key at hand.
8. **Match days.** Check <https://hayahora.futbol> for the night. The sea server is on
   Render's own addresses to get round the blocks, which a match night still has to prove.
   Supabase is still behind Cloudflare, so a phone on a Spanish network (the bar's wifi
   too, if its provider blocks) may still fail to sign in while they are on.

## On the day

1. **Check the sea server.** `npm run captain -- --sea wss://black-flag-sea.onrender.com`
   must end with `✓ Tester 1: won a free shot`. It takes a few minutes.
2. **Point production at it.** From the main checkout:
   `vercel env add VITE_SEA_URL production`, with `wss://black-flag-sea.onrender.com`.
   Do this before the merge: the value is built into the page.
3. **Merge and push.** From the worktree:
   - Give the old game a name, so it can be found again:
     `git tag v1-solo origin/main && git push origin v1-solo`.
   - In one commit: `branch: main` (and `plan: starter`, once the service is on it) in
     `render.yaml`, and the README's "Where it runs".
   - `git push origin v3-mvp v3-mvp:main`. This is a fast-forward, and Vercel builds
     production from it. Push both at once, and not `v3-mvp` alone before: a `render.yaml`
     that says `main` while `main` is still the old game sends the sea server to build
     from a branch with no server in it.
4. **Point the Render service at `main`** (Settings → Build & Deploy), if it hasn't picked
   the branch up from `render.yaml`.
5. **Check the site** on a phone:
   - the name screen shows "Practice";
   - tapping a card gives "🎟 Ticket!";
   - Set Sail gets you aboard among the bots.

   Then open `/watch` on the TV laptop and say the key.
6. **Clear the test data,** after the checks and before the first guest (SQL below).
7. **Hand out the cards.**

## Clearing test data

Run these in the Supabase SQL editor, or ask Claude to run them. Leave `unlock_codes`
alone: it's the register of tag codes.

**A clean slate, once, just before opening.** Every account so far is a test. This deletes
every player, and with them their tickets, free shots and handovers:

```sql
select count(*) from auth.users;   -- what goes: 92 on 22 Nov
delete from public.events;
delete from auth.users;            -- players, tickets, prizes and handovers follow (on delete cascade)
```

Phones that played before get a new anonymous account on their next visit, on their own.

**After launch, only the scripted captains** (`npm run captain` marks every player it makes):

```sql
delete from public.events where player_id in (select id from auth.users where raw_user_meta_data->>'test' = 'captain');
delete from auth.users where raw_user_meta_data->>'test' = 'captain';
```

## Going back

- **The site:** in Vercel → Deployments, promote the 5 Sep production deployment again.
  Or, from the main checkout: `vercel rollback dpl_4xZcX6SsiPMyaf6ku5Wfd8amBcSY`. Stop
  handing out cards: the old game doesn't know the ticket code.
- **The sea server:** on the Render service, Events → Rollback goes back to a previous
  deploy. The old solo game doesn't need it either way.
- **The database:** nothing to undo. Every migration only added to it.
