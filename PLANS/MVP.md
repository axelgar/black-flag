# Black Flag — the bar's game

Planned 1 November 2026, from a grilling session with the owner. A guest who orders a
Black Flag gets a ticket. With it, sinking five ships in a row without being sunk wins a
free shot. The game is only captains against captains on one shared sea, with bots
topping it up, in a cartoon look like Brawl Stars. It replaces the live site.

## Why

- The game does too much for a bar. The shared sea still runs the Spanish waves, the
  bosses, the hunters, waterspouts and loot (`src/sim/world.ts:156`), and the score is
  plunder, which only comes from the Spanish (`src/net/sea.ts:197`).
- Fights are slow. A Jackdaw needs about 8 broadsides, all hitting, to sink another
  (about 18 s). At the measured ~30% hit rate that is about a minute per fight.
- The sea is big: 1,800 m across. Captains can sail a long while without meeting anyone.
- The drawing is costly for a phone. The sea is drawn out to about 3 km with 30–60k
  triangles and a heavy pixel shader, under a 4 km sky dome with cloud noise, with fog
  from 380 m to 1,500 m.
- The realistic look is being dropped for a cartoon one.

## The rules

**Tickets.**
- The bartender keeps a card with an NFC tag (and a QR code on the back for phones
  without NFC). They hold it out to whoever orders a Black Flag. The tag is a plain
  link; secure tags (NTAG 424 DNA, one per coaster) can come later without changing
  the game.
- One ticket per phone per night, from 6:00 to 6:00. Tapping again while a ticket is
  open does nothing.
- A ticket lasts until its holder wins. It never expires and works anywhere. It lives on
  the phone (the anonymous account), so clearing the browser loses it.

**Winning.**
- Sink five ships in a row without being sunk. Bots count.
- The last hit takes the sink.
- Being sunk puts the streak back to 0.
- **Leaving:** if you have not been in a fight for 10 s (no hit given or taken), your
  ship docks and your streak waits for you. If you leave mid-fight, your ship stays on
  the sea for 10 s and can still be sunk. Locking the phone counts as leaving.
- The sea server counts the streak and records the win itself. A phone cannot claim one.

**Without a ticket** (before tapping, or after a win): practice on the same sea, against
the same captains and bots. The streak counts, but a fifth sink wins nothing: "Order a
Black Flag and this would have been a free shot."

**The prize.**
- A free shot, claimed with an email: email, then a 6-digit code (Supabase email OTP),
  which links the email to the anonymous account the player already has. Without an
  email there is no shot, and the screen says so plainly.
- One free shot per email per night.
- Valid tonight or on any visit within 30 days.
- Redeemed in front of the bartender: "Only press this in front of the bartender", then
  a big animated "REDEEMED · 22:41" screen with a live clock, in the bar's colours. It
  can't be undone, and a screenshot gives itself away.

## The sea

- One open sea that you join at any time. There are no rounds, lobby or scoreboard.
- At least 5 ships, counting you: alone, you sail with 4 bots. At most 30; a full sea
  sends the next phone to the next one (the bar's seas 1–9, as now).
- When a human joins, a bot stays until it is next sunk, then doesn't come back.
- The sea grows and shrinks with its ships: about 20 s to sail across at 5 ships, about
  50 s at 30, so you meet someone every 5–10 s. It grows at once. It shrinks over about
  30 s, with a visible edge closing in and a current pushing ships inward. The islands
  are laid out for the full size, so only the edge moves.
- Islands are cover: they stop shots and block sight.
- Ships come in (and back, 3 s after sinking) at a quiet edge, not at a harbour.
- **Crates**, coloured barrels by kind, about one per three ships, appearing in open water
  away from ships, 15 s after one is taken. Bots take them too.
  - Repair: restores 50% of the hull.
  - Speed: +40% for 5 s.
  - Heavy shot: the next volley does double damage.

## The fight

- **Controls** (landscape only):
  - The left thumb steers. North is always up, so pushing the stick up means up the
    screen.
  - On the right, drag to aim and let go to fire, or tap quickly to fire at the nearest
    ship. The guns on the side facing the aim fire, so it still looks like a broadside.
  - 3 shots that reload, like Brawl Stars' ammo bar.
- **Starting numbers:**
  - 3 good volleys sink an equal ship (3–4 s of hitting). Changed 2026-11-02 to 5 volleys
    (hull 160) with bot skill 0.9, after a simulation showed a win took under a minute.
    Changed back the same day to 3 volleys (hull 100), with bot skill 0.2, after the first
    try-out on a phone couldn't get five in a row: easy until real guests say otherwise.
  - The hull mends slowly after 3 s without being hit.
  - Respawn takes 3 s.
  - A clean run of 5 takes 3–5 minutes, and most players win within 15–30 minutes of
    trying.
- **The ships:** every ship has the same stats. There are three looks (the Kenney
  Jackdaw and two other ships from the same kit), scaled to one length with one hit area.
- **Streaks:** 0–4 skulls over every ship. At 4, the ship is marked **WANTED** on every
  screen and on the TV.
- **Tuning:** every number above goes in one file (`src/data/tuning.ts`), each explained
  in plain words. Change it, deploy, play. A live tuning panel comes later if it's
  needed.

## Bots

Seats run by the sea server itself (none exist today), built from the Spanish AI's
steering, aiming and island-avoidance (`src/sim/ai.ts`, `lead()` in `src/sim/combat.ts`).
- **Behaviour:**
  - Picks a target, usually the nearest but not always.
  - Circles at cannon range and fires with a deliberate aim error.
  - Backs off to mend when low, and takes nearby crates.
- **Limits:**
  - At most 2 bots on the same target.
  - No extra interest in a WANTED ship.
  - One skill setting in the tuning file, set below an average human's hit rate.
- **Names:** famous pirates (Calico Jack, Anne Bonny, Mary Read, Blackbeard, Black
  Bart…), each with a small "bot" tag.

## From the tap to the sea

1. The tag opens the game, upright or sideways. The name screen works upright.
2. **Name and ship**, the first time only; later it just says "Welcome back, Marta".
   - A name is 3–12 letters, numbers and spaces.
   - Two people can share a name; the sea adds a tag when two meet.
   - A blocklist keeps rude words off the TV.
   - The phone remembers the name.
   - The ship is picked with one tap, with a random one already chosen.
   - A banner shows either "🎟 Ticket! Sink 5 in a row for a free shot" or "Practice:
     order a Black Flag to play for a free shot".
3. **Set sail:** asks for the phone sideways and goes full screen.
4. **First sail only:** "left thumb: steer" and "right thumb: drag to aim, tap to fire",
   gone after the first shot.
5. **At sea:**
   - The streak (0–5 skulls) at the top.
   - The hull bar and ammo pips.
   - Arrows at the screen's edge to the nearest ships.
   - **⚓ Leave** in place of pause; there is no pausing on a shared sea.
   - Each ship gets its own sail and flag colour.
6. **Sunk:** "Sunk by Calico Jack · streak back to 0", a 3 s count, then back at sea.
7. **The fifth sink:**
   - A celebration on the phone, "Marta won a free shot!" to the whole sea, and the
     same in the TV's feed.
   - Then "Save your free shot": email and code, with a marketing opt-in box, unticked.
   - The voucher ("🥃 Free shot · valid until 1 Dec") sits on the name screen from then
     on, and on any phone signed in with that email.
   - After a win, the player sails on in practice.

The menu keeps sound on or off and changing your name. Quality and Models go.

## The look

- **Brawl Stars:** saturated colours, chunky shapes, cartoon (toon) shading with hard
  steps, and dark outlines on ships, islands and crates.
- **The camera:** fixed and high, looking down at three-quarters. North is up, and it
  never turns. It shows about 1.5 times cannon range around your ship.
- **Drawing:**
  - The sky dome and its cloud shader go: the sky is never on screen, so a plain
    background colour does.
  - The sea is drawn only as far as the screen shows, as flat cartoon water: 2–3 colour
    bands, crisp white foam rings round islands and ships, and gentle waves. No caustics,
    glints or mist.
  - No fog. A soft tint marks the sea's edge.
  - No bloom and no extra post-processing pass. A soft dark blob under each ship and
    palm in place of shadows.
  - One look for every phone. The resolution drops if the frame rate falls (the governor
    in `src/render/view.ts` already does this).
  - One bright, sunny day: no weather and no dusk.
- **Performance target:** 60 fps on a 2020 phone (iPhone 11, Galaxy A52), 30 fps at
  worst on older ones, and loaded and sailing within 10 s on the bar's wifi. Frame time
  is measured on a real phone before and after.
- **Ships:** drawn only from model files. The code-drawn ships (`src/render/ships/`, about
  3,100 lines) and the Sketchfab Revenant (about 106 MB of textures on a phone, and a
  credit to show) go.
- **Sound:** keep cannon, hit, sink, crate and win; the rest goes. Cartoon sounds come
  later, with the hired art. Quick vibrations when hit and on a win (Android only).
- **The art brief** (`PLANS/ART_BRIEF.md` and the shared doc) is rewritten for this look:
  - three ships at one size;
  - islands as cover;
  - three crates;
  - water and foam colours;
  - no town.

## The TV

A flat 2D chart of the bar's sea. The 3D game view is not used here.
- **The chart:** islands as coloured shapes. Ships as coloured ship icons, each with a
  name and 0–4 skulls. WANTED ships pulse. Shots are short streaks and a sinking is a
  splash.
- **Down the side:** the live feed ("Marta just won a free shot!"), the top streaks right
  now, and "Order a Black Flag to play" with a QR code. The QR code gives practice, not a
  ticket.
- **Kept from today:** the watch key, staying up all night, turning between the bar's
  seas, and the 6am reload (`src/ui/watch.ts`).

## Accounts, privacy and numbers

The bar is in the EU.
- **Accounts:** the anonymous Supabase account every phone gets at boot stays. The email
  is linked to it when a prize is claimed, and the player's name becomes theirs. Signing
  in with the same email on another phone brings the voucher.
- **Email:** the only email sent is Supabase's code email, worded to say the free shot is
  saved. Voucher and reminder emails come later and would need a mail service.
- **Privacy notice:** a short notice covering who runs the game, what is kept, for how
  long and how to have it deleted. I draft it. The game is run by **Glitch Bars**, and
  the contact is **info@glitchbars.com**. Deletion is by email request to that address
  for now.
- **Analytics:** Google Tag Manager goes. In the EU its cookies would need a consent
  banner. In its place, our own events go into Supabase: tag tapped, first sink, win,
  email given, redeemed (plus joining and being turned away from a sea). There are no
  cookies, so no banner. The bar owns its numbers.

## What goes

- **Play:**
  - solo runs;
  - the Spanish (six classes), waves and the four legendaries;
  - surrender and boarding;
  - notoriety and hunters;
  - waterspouts, reefs and storm drift;
  - the mortar and the automatic bow guns;
  - today's loot and buffs (the three crates replace them).
- **Economy:** reales, plunder, upgrades, the bribe, and the 8-minute rounds with their
  lobby and scoreboard.
- **Places and screens:**
  - Nassau town and its harbour;
  - ship unlocks and their codes (KSTRL-7Q, RVNT-4K, MAREE-9X);
  - the shipyard;
  - the records book and the captain's log;
  - private Rivals and Crew seas with join codes;
  - weather and dusk.
- **Ships and options:** the code-drawn ships, the Quality and Models options, and the
  Revenant.
- **Tests:** the tests for all of the above (most of `tests/sim.test.ts`, the PvE parts of
  `tests/sea.test.ts`, `tests/unlocks.test.ts`).

The code is deleted, not hidden. The current game is tagged in git first. Today's players
lose their records and unlocked ships when the site is replaced. The unlock tables stay
in the database, unused.

## What stays

- The sea server: one Cloudflare Durable Object per sea, authoritative.
- Cannonballs, and islands stopping them.
- The Spanish AI's steering, aiming and avoiding, which become the bots.
- Anonymous sign-in.
- The `/u/` link, which now issues tickets.
- Vercel hosting.
- The TV, as a chart.
- The model loaders for ships and land (`src/render/ships/gltf.ts`,
  `src/render/land/props.ts`).

## Order of work

Each step goes to a Vercel preview of a new branch, `v3-mvp`, made from `v2-open-sea` and
`v2-ship-models` merged together. It runs against a separate test sea server,
`black-flag-sea-mvp` on Cloudflare, so today's server is untouched until the switch.

0. **The art brief**, rewritten for the cartoon look.
1. **The cut and the new fight:**
   - PvP with bots;
   - twin-stick controls and the top-down camera;
   - streaks and WANTED;
   - crates and islands;
   - the sea growing and shrinking;
   - the Kenney ships;
   - the tuning file;
   - your own ship moving the moment you steer: client prediction as planned in
     `PLANS/PREDICTION.md`, built on the new controls. Today a turn of the stick shows
     only after the round trip to the sea, 150–300 ms on bar wifi.

   Playable on the owner's phone, to tune the numbers. Prediction comes before tuning,
   so the numbers aren't set to make up for lag.
2. **The look:**
   - cartoon shading and outlines;
   - the cartoon sea;
   - the sky and fog go;
   - frame time measured on a phone.
3. **Tickets and the prize:**
   - the tag and its limits;
   - win, email code, voucher and redeem;
   - the privacy notice;
   - our own events.
4. **The TV chart.** Then switch the live site and server over.

## Open

- Later, not in the MVP:
  - secure tags per coaster;
  - voucher and reminder emails;
  - cartoon sounds;
  - the artist's models;
  - a live tuning panel;
  - a delete-my-account button.
