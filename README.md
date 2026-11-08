# Black Flag

The bar's game. A guest who orders a **Black Flag** cocktail taps the bartender's card,
types a name and sails onto one shared sea with everyone else in the bar, topped up with
bots. Sink five ships in a row without being sunk and you win a free shot. The game is run
by Glitch Bars.

Every decision behind this version is in `PLANS/MVP.md`. The full game before it was cut
down (waves, Nassau, boarding, rounds) is tagged `v2-full`.

**Where it runs.** This version is on branch `v3-mvp`, previewed at
<https://black-flag-git-v3-mvp-axelgars-projects.vercel.app> against the sea server on
Render. The production site, <https://black-flag-two.vercel.app>, still serves
the early solo game until the switch-over (`PLANS/SWITCHOVER.md`). Hold a phone in
landscape.

## Run

```
npm install
npm run dev          # the game at http://localhost:5173, the bar's TV at /watch
npm run sea:dev      # the sea server on this machine, ws://localhost:8787
npm test             # the self-check (vitest)
npm run typecheck    # the game, the scripts and the sea server
npm run build        # typecheck + production bundle in dist/
npm run odds         # how long a win takes with the tuning as it stands
npm run captain      # a scripted guest: ticket, five in a row, free shot written down
npm run qr           # the ticket card: the NFC tag's link and the QR for its back
npm run icons        # redraw the home-screen icons into public/
npm run ships:pack   # make a ship's model file ready for the sea (props:pack for land)
```

Vite, TypeScript and Three.js on the phone, one Node server on Render holding every sea,
and Supabase (Postgres and sign-in) behind both.

## How it plays

- **A ticket.** The bartender holds out a card with an NFC tag (and a QR code on the back)
  to whoever orders a Black Flag. It gives that phone tonight's ticket, one a phone a night
  (6:00 to 6:00, Madrid time). A ticket lasts until it wins.
- **Five in a row.** Sink five ships without being sunk. Bots count, the last hit takes
  the sink, and being sunk puts the streak back to 0. At four a ship is **WANTED** on
  every screen. A win on a ticket is a free shot; without one it is practice, on the same
  sea: "Order a Black Flag and this would have been a free shot."
- **Leaving.** Out of a fight for 10 s, your ship docks and the streak waits for you. Leave
  mid-fight and she stays on the water for 10 s, and can still be sunk.
- **The sea.** One open sea, no rounds. Fifteen bots are always on it (`bots` in the tuning),
  and at most thirty captains; a full sea sends the next phone to the next (the bar's seas 1–9). The
  sea grows at once as ships join and closes in over about 30 s as they leave. Islands
  stop shots. Crates: repair, a burst of speed, heavy shot.
- **The ships.** Three looks (Kenney models, `public/ships/`), all with the same numbers.
- **The whole screen.** Android goes full screen, sideways, on Set sail, and a tap at sea
  takes it back if it was lost. An iPhone can't give a page full screen: as a ship comes
  into the sea with Safari's bars up, a card asks for a swipe up, which folds them away
  (`src/ui/fullscreen.ts`; `?swipe` shows the card on any screen). Added to the Home
  Screen, an iPhone opens it with no bars at all.

| | Touch | Keyboard / mouse |
|---|---|---|
| Sail | left thumb: push the way to go (north is always up), as far as you want to go fast; let go and she holds her course | WASD or the arrows |
| Fire | right thumb: drag to aim, let go to fire; a quick tap fires at the nearest ship | hold the left button to aim at the pointer, let go to fire; Space or the right button fires at the nearest ship |
| Powers, every 20 s | three buttons, bottom right: broadside, song, shield | 1 to 3 |
| Leave | ⚓ Leave | Esc |

Three powers, each recharging 20 s after you use it, and all three back when you come back
from sinking. Bots use them too:
- **Broadside:** 8 balls at the nearest ship, without using a shot.
- **Mermaid song:** pulls every ship within 90 m toward you for 4 s.
- **Shield:** stops balls for 3 s.

Three shots, which reload. Every number the fight is tuned by is in `src/data/tuning.ts`,
explained in plain words; the sea server and the phones both read it. After changing it,
`npm run odds` says how long a win takes now (see **Test tools**).

## Tickets and the free shot

1. The tag opens `/u/BLACKFLAG?src=nfc` (the QR on the back, `/u/BLACKFLAG`). `vercel.json`
   rewrites it to the game, which signs the phone in anonymously and calls `redeem()`.
2. A win on a ticket is written down by the **sea server**, never a phone: it calls
   `record_win()` with the project's secret key. The free shot is good for 30 days.
3. **Save it:** an email, then a 6-digit code Supabase sends, which links the email to the
   phone's anonymous account. One free shot an email a night. An email that already has an
   account signs this phone in to it and brings the free shot along (`hand_over`,
   `take_over`). A marketing opt-in, unticked.
4. **Pour it:** `#/redeem/<id>`, pressed in front of the bartender, shows a big
   "REDEEMED" card with a live clock. It cannot be undone.

The privacy notice is `#/privacy`. There are no cookies: the bar's numbers are rows in
`events` (ticket, sail, turned away, first sink, win, practice win, email, redeem).

## The sea server

`server/`: one Node process holding every sea, at `/sea/bar/<n>`. It checks each phone's
Supabase token against the project's public signing keys, asks `me()` whether
it holds a ticket, and steps the sea (`src/net/sea.ts`) thirty times a second while anyone
is aboard, sending a snapshot fifteen times a second.

- **The phone** draws a moment behind the sea and slides every ship between snapshots
  (`Mirror`, `src/net/protocol.ts`), except its own, which it steps itself at once from the
  stick and corrects as the sea's word comes back (`src/net/lead.ts`).
- **Coming aboard** gives up after 10 s and says why: the server, a sea out of reach, or a
  sea that never answered, with Try again (`src/net/link.ts`).
- **Secrets**, set on the service under Environment in Render's dashboard, or in
  `server/.dev.vars` (not committed) for `npm run sea:dev`:
  - `SUPABASE_SECRET`, the project's secret key. Without it the sea plays, but wins go
    unrecorded.
  - `WATCH_KEY`, what the bar's TV says to look on. Without it, nobody can watch.
- **The service.** `wss://black-flag-sea.onrender.com`, in Frankfurt, described by
  `render.yaml`. It must stay one instance, because the seas are in its memory. A push to its branch that touches the
  sea's code redeploys it, and a redeploy drops everyone aboard, so make those outside
  opening hours. A push that only changes the page leaves it alone. The free plan sleeps
  after 15 idle minutes and takes about a minute to wake, longer than a phone waits: open
  the service's address in a browser first. Guests need Starter.
- A page finds its sea through `VITE_SEA_URL`; in development it is `npm run sea:dev` on
  the machine serving the page, so a phone on the same wifi works.

## The bar's screen

`/watch` puts the bar's sea up on a TV as a flat chart (`watch.html`, `src/watch/`): the sea
as a disc that opens out and closes in with the ships on it, the islands, every ship in
her captain's colour with her name and skulls over her, a WANTED ship pulsing red, shots as
short streaks and a sinking as a splash. Down the right: the rule, the captains on a
streak, what just happened, and "Order a Black Flag" with a QR code to the game (practice:
a scan of the TV is not a ticket). A free shot won is said across the top of the chart.
Nothing in the game links to it, and it loads none of the 3D game: a 2D canvas, about
25 kB.

- **The watch key.** The page asks for it once and keeps it in that browser; it goes up
  the socket as the first message, never in a URL. Make it a passphrase: there is no
  lockout, only a second's wait after each wrong key. Put a new secret to change it, and
  every screen asks again.
- **A screen takes no seat.** It is sent what every phone aboard is, but nobody's own guns,
  does not count toward the thirty, and does not wake an empty sea. Four to a sea.
- **Captains, not bots.** The streaks and the feed are about the people in the room: a
  bot's five in a row, and bots sinking each other, are left out (`src/watch/board.ts`).
- **The rest of the night.** A sea with no captains on it shows a large QR code and how it
  works. On a busy night with a second sea open, the screen turns between them every
  minute; it only looks at the next sea while this one is full.
- **Left alone.** It keeps the screen awake, hides the pointer, tries a dropped line again
  for ever, reloads itself after a deploy (at most once in ten minutes) and once at 6am,
  and never signs in, so the TV makes no player.
- **Keys.** F full screen (or click), 1–9 hold the screen on that sea, 0 lets it turn again.

A laptop running Chrome into the TV is what it is built for. To try it on this machine, put
a `WATCH_KEY` in `server/.dev.vars`, run `npm run sea:dev` and `npm run dev`, open `/watch`
and say the key, then sail from a phone, a second browser or `npm run captain`.

## Supabase

`src/net/cloud.ts` is the only file in the game that talks to it. The project is
`src/net/project.ts` (override with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`);
the publishable key is meant to be public. The live game (v2) shares the project, so a
migration only ever adds.

- **Rules.** Phones read their own rows and nothing else, and every write goes through a
  function: `me`, `redeem`, `save_prizes`, `redeem_prize`, `hand_over`, `take_over`,
  `log_event`. `record_win` is for the sea server's secret key only. It is all in
  `supabase/migrations/`, and `tests/db.test.ts` runs it in an in-process Postgres
  (PGlite) as a guest, as nobody and as the server.
- **In the dashboard** (these mirror `supabase/config.toml`):
  - Authentication → Sign In / Providers: allow anonymous sign-ins, and manual linking.
  - Authentication → Rate Limits: raise anonymous sign-ins well above 30 an hour per IP. A
    whole bar shares one wifi address.
  - Authentication → SMTP: a custom sender (Resend). Its address must be on a domain
    verified in Resend: Resend's test sender, `onboarding@resend.dev`, only delivers to
    the Resend account's own email.
  - Authentication → Emails: the "Change email address" and "Magic link" templates, from
    `supabase/templates/`, with the subject `{{ .Token }} is your Black Flag code`. They
    show the code. Without them nobody can save a free shot.
  - Authentication → Rate Limits: emails an hour (30 to start with a custom sender). Each
    save and each sign-in sends one.

## Test tools

- **`npm run odds`** sails the sea server's own `Sea` flat out, no network, with one
  scripted captain against the bots over 30 seas, sailing well and sailing casually, and
  prints how long a win takes: typical, slow, within 5 and 15 minutes, never sunk.
  `-- --try botSkill=0.75,hull=200` adds a row with settings changed. A script never
  misreads the screen, so read the times as about the quickest guests will manage.
- **`npm run captain`** is a scripted guest against a real sea: she signs in, taps the
  ticket, sails until five in a row and checks the server wrote the free shot down. Run it
  after every deploy: `-- --sea wss://<server>`. `--ships 8 --practice --stay --for 300`
  fills the TV for a demo or a load test. Options are at the top of `scripts/captain.ts`.
  Every captain is a real anonymous player in the live database, marked as a test; the
  SQL that clears them is in `PLANS/SWITCHOVER.md`.

How a scripted captain steers and fires is `scripts/brain.ts`.

## Files

```
src/
  main.ts        boot, the screens, the line to the sea, the frame clock
  core/          rng (seeded), 2D vectors
  data/          tuning.ts (every number), ships.ts (the looks), names.ts (names and the
                 blocklist), colors.ts (captains' colours), props.ts (land models)
  sim/           the fight, pure and deterministic: world.ts (the tick), sailing.ts,
                 combat.ts (guns, damage, streaks), bots.ts, map.ts (the chart), types.ts
  net/           cloud.ts (Supabase), project.ts (which project), protocol.ts (the wire
                 and the Mirror), sea.ts (a shared sea), link.ts (the phone's line to it),
                 lead.ts (your own ship, at once)
  render/        three.js, cartoon: view.ts (camera and effects), sea.ts, land.ts,
                 ships.ts, crates.ts, fx.ts, toon.ts (banded light), ink.ts (outlines),
                 files.ts (the model loader)
  ui/            screens.ts (name and ship, the sea), prize.ts (save, pour, privacy),
                 hud.ts, input.ts (twin stick), haptics.ts, app.css
  watch/         the bar's TV: main.ts, chart.ts (the 2D chart), board.ts (streaks,
                 feed), line.ts (its line to a sea), watch.css
  audio/         synthesised cannons, sea and shanty
  state/         session.ts: what the phone remembers (name, ship, switches)
server/          the sea server, on Render (render.yaml)
supabase/        config.toml and migrations/: tables, rules and functions
scripts/         captain.ts, odds.ts, brain.ts (test tools), qr.ts, icons.ts,
                 pack-models.ts
tests/           vitest
public/          ship and land models, the manifest and its icons
watch.html       the TV's page; index.html the game's
```

## The self-check

`npm test` holds:

- **The fight** (`sim.test.ts`): ships sink in as many volleys as the tuning says, hulls
  mend after a while, the streak, WANTED and the win, crates, the sea growing and closing
  in, bots, and a seeded sea replaying the same.
- **A shared sea** (`sea.test.ts`): captains come aboard, sail, leave and come back; the
  wire carries the world into a mirror that matches it; a full sea; a ticket's win goes to
  the server and practice's does not.
- **Your own ship at once** (`lead.test.ts`): stepped ahead of a late, jittery sea, she
  stays close to where the sea puts her.
- **A bad line** (`link.test.ts`): the phone is told within ten seconds whether the sign-in,
  the sea or its answer failed, and can try again.
- **The server's rules** (`db.test.ts`): tickets, wins, saving and pouring a free shot,
  handing it over, and that a phone reads only its own rows.
- **The TV** (`watch.test.ts`), and **model files and outlines** (`models.test.ts`).

## Not done yet

- **Spanish match days.** On LaLiga match days the big Spanish carriers block shared
  Cloudflare addresses. The sea server moved to Render's own addresses to get round that,
  which a match night still has to prove. Supabase is still behind Cloudflare, and sending
  it through the site is on hold.
- **The email sender** is Resend's test address, which only delivers to the Resend
  account's own email. Saving a free shot worked end to end with it from a phone (2 Nov).
  Guests need a sender on a verified domain (see **Supabase**).
- **Tuning wants a real night.** `npm run odds` measures a script, not a guest.
- **Frame time on a real phone** is unmeasured. `?fps` shows a meter, and `?fps&plain`
  turns the outlines off to see what they cost.
