# Black Flag — building the base: the top 5

Ranked 27 September 2026. The bar uses Black Flag to make one of its cocktails into an
experience. A guest taps the NFC tag at the bar (or scans the QR), a ship unlocks, and they
play at the table. Later: a server, a login, rankings, a shared sea where players fight each
other, and ships customized with parts they unlock. This is the order to build the base in.

## Decided

- **Unlocks come from an NFC tag at the bar.** It holds a fixed URL in the format the QR
  codes already use (`/u/<CODE>`). Everyone uses the same link for now.
- **Maybe later: a link that can't be shared.** A daily code was floated. See #1 for a way
  to do it without changing the tag.
- **A login wall comes later,** with Google and other OAuth providers, so the bar learns who
  its guests are.

## Open

- None. The backend is Supabase (Postgres, plus anonymous players now and Google and
  others later), decided 27 September 2026.

## 1. Players on a server

> **Built 27 September 2026**, and live on the Supabase project `black-flag`. Players,
> inventory, the code register and the tap log are in `supabase/migrations/`; the game side
> is `src/net/`. Tested end to end in a browser: an NFC link made a player, logged the tap
> as `nfc` and put the Kestrel in their inventory. Not built yet: the login wall, and
> per-tag venue and cocktail (the columns exist; nothing fills them).

**Now.** Unlocks and records live in one browser's localStorage (`src/state/session.ts`).
Clearing Safari loses them. An iPhone home-screen install has its own storage, so it can't
see a ship unlocked in Safari; that is why the shipyard has a box to type the code. There
is no player, so there is nothing to rank, own or log in to. The analytics events
(`src/analytics.ts`) don't say which venue or night a game came from.

**Build.**
- A player created on first open, with no sign-up, and a captain name.
- Server tables for players, inventory (the hulls and parts each player owns), and unlocks
  (who unlocked what, when, and from which tag).
- `/u/<CODE>` is checked by the server and adds to the player's inventory. The URL doesn't
  change, so printed QR codes and written NFC tags keep working. `shipForCode()` in
  `src/data/unlocks.ts` moves behind the API, as the README already planned.
- The phone keeps a copy of the inventory, so the game still plays on bad wifi.
- Tag each NFC tag and QR code with its venue and cocktail, so you can count taps, games
  and return visits.

**Why first.** Rankings, customization, multiplayer and the login wall all depend on having a
player and knowing what they own.

**Watch.** An anonymous player lives in one browser. On an iPhone, the NFC tap opens Safari,
and Safari and the home-screen app count as two browsers. They stay two players until the
guest logs in. Logging in joins them, which is a reason to bring the login in soon.

**Later: a link that can't be shared.** A fixed tag can't change its URL, so a daily code
means showing guests something extra at the bar each day. NTAG 424 DNA tags avoid that:
the tag adds a fresh signature to the URL on every tap, and the server rejects a link it has
already seen. Guests tap exactly as before.

## 2. Tonight's Sea: one fixed-length round with a single score

**Now.** Three local records (furthest wave, plunder, time) that can't be compared with each
other. Plunder is also what you spend at Nassau, so buying upgrades lowers your score
(`src/state/run.ts`). A run only ends when you lose your last life. The bot captain took
1.5 to 4.5 minutes per wave, and people will be slower because the bot knows where every
ship is. So a run outlasts a drink.

**Build.**
- A mode that lasts about one drink, say 3 waves or 10 minutes.
- Everyone plays the same seed that night, so they get the same islands and the same fleet.
- Score what players earn (plunder taken, ships boarded, legendaries sunk), not what's left
  after spending.
- Send the seed and the player's inputs to the server. The simulation is pure TypeScript,
  so the server can rerun the game to check the score.
- Show the night's leaderboard on a screen in the bar.

**Why.** It gives you rankings before multiplayer exists, and a social hook at the bar now.

**Test this first.** JavaScript doesn't promise that math functions like `Math.sin` or
`Math.atan2` give identical results in Safari and in Node, and the simulation calls them in
about 100 places. If an iPhone run drifts when the server replays it, check scores with some
tolerance, or have the server run those games itself.

## 3. Customization where looks never change stats

**Now.** A ship's looks are already data. `HullRecipe` (`src/data/types.ts`) sets paint,
sail colour, emblem, flag, wear, gilding and square topsails, and the renderer can draw any
combination without art files. But each look is fixed to one `ShipDef`, and there are only
four ships.

**Build.**
- Split a ship into a hull (which carries the stats) plus cosmetic parts: paint, sails,
  emblem, flag, figurehead.
- Keep a catalog of parts, with rarities, in each player's server inventory.
- Because the NFC link is the same every time, the server hands out at most one part per
  player per day. A regular earns dozens of parts over time instead of three ships.

**Why now.** "Who has the best ship" has to mean the best captain, not the most drinks
bought. If a cocktail buys power, ranked play is dead on arrival. Hulls should stay trade-offs
rather than upgrades, as they are now: the Kestrel is fast but fragile, the Revenant slow but
tough. This rule is cheap to set now and very hard to change later.

## 4. Let the game hold more than one player

> **Built 27 September 2026.** `World.players`, one `Input` per captain, shot and shells
> with an owner and a team, the Spanish hunting the nearest captain, and a `pvp` switch.
> Checked against eight single-player battles recorded before the change: all eight
> replay byte for byte. The view draws other captains' ships; `bf.crew()` previews one.
> **The network, built 27 September 2026:** shared seas on Cloudflare Durable Objects
> (`server/`), the bar's sea and private codes, rivals and crew rounds, snapshots at 15 a
> second into a mirror the renderer draws. Tested with bots on a local server and in a
> browser, then made to hold thirty ships to a sea. **Deployed 17 October 2026** to
> `black-flag-sea.axel-garcia94.workers.dev`; a bot sailed the bar's sea there at 15
> snapshots a second. The `v2-open-sea` previews on Vercel point at it; production does
> not yet. Not built: round results written to Supabase, and a rankings screen.

**Now.** The world has exactly one player ship (`ship: Player` in `src/sim/types.ts`), and 26
places in the simulation assume it. Plunder, notoriety and lives are stored on the world,
not on a player. There is one `Input`. Cannonballs belong to one of two fixed sides
(`foe: boolean`), and the AI hunts `w.ship`.

**Build.**
- `players` keyed by ID, each with their own plunder, notoriety and lives.
- `step(w, dt, inputs)`, taking every player's controls in the same tick.
- Every cannonball has an owner and a team. `Shot.from` already records the shooter.
- Enemy ships hunt the nearest player they have seen.
- Single player becomes a world with one player in it.

**Why now.** The simulation is about 1,700 lines, and the replay digest and 30+ tests will
catch mistakes. Later, the same code runs on the server as the referee for a shared sea:
players send their controls, and the server sends back what happened. The renderer already
draws from a snapshot of the world. This is the biggest blocker for multiplayer, and it gets
more expensive to fix the longer it waits.

## 5. The guest's first 60 seconds

**Now.**
- 235 KB of compressed JavaScript, plus Google Fonts and Google Tag Manager, and nothing
  cached for offline use. That's slow on bar wifi.
- Two thumbs, held sideways, from someone holding a drink.
- Nothing in the game teaches the tricky controls: steering is relative to the screen, how
  far you push sets the sail, and you let go of the stick to board. They are explained only
  in a 14-section rulebook.
- After a tap, the guest presses "Take her out", lands on the title screen, then presses
  "Weigh anchor" (`src/ui/screens.ts`).
- Frame rate on real phones has never been measured.

**Build.**
- A guided first wave with three prompts: steer, fire a broadside, capture a surrendered
  ship.
- Make "Take her out" go straight to sea.
- Cache the game on the phone after the first visit, and serve the fonts from our own site.
- Test on 3 or 4 phones that guests actually carry.

**Why 5th.** It's the cheapest item, and it can be done alongside the others. It ranks lower
only because nothing else depends on it.

## Not now

Live online play, and new ships before the customization system from #3 exists.

## Not verified

Nobody has played on a phone for this review. The wave times come from the bot. Nobody has
tested whether Safari and Node replay a run the same way.
