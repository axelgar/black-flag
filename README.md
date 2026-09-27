# Black Flag

A pirate game on an open sea. You sail a ship of your choosing out of Nassau into a seeded
archipelago. Spanish squadrons put to sea in waves and hunt you once they see you. You
turn your beam to them and fire broadsides by hand. A ship beaten below a quarter hull
strikes her colours, and for six seconds she is a prize to come alongside and board
instead of an enemy. When the sea is clear, you sail home to careen.

v2 is a rewrite of the v1 test game (a portrait, top-down scrolling shooter; see git
history and `PLANS/BLACK_FLAG_V1.md`). The design for this version is in
`PLANS/BLACK_FLAG_V2.md`.

**Live:** <https://black-flag-two.vercel.app>. Hold a phone in landscape.

## Run

```
npm install
npm run dev          # http://localhost:5173
npm test             # the self-check (vitest)
npm run build        # typecheck + production bundle in dist/
npm run qr           # print a QR code per unlockable ship into qr/
npm run icons        # redraw the home-screen icons into public/
npx supabase db push # apply supabase/migrations to the linked project
```

Vite, TypeScript and Three.js. Everything is procedural: no models, textures or sound files.
The server is Supabase (Postgres and sign-in); see **The server** below.

## Controls

| | Touch | Keyboard / mouse |
|---|---|---|
| Sail | floating stick, left half of the screen. Push the way you want to go on the screen: the camera holds still while your thumb is down, and swings round behind her when you let go. How far you push sets the canvas (three-quarters of the way out is all plain sail). Let go and she holds her course and her canvas; beside a prize, letting go eases her to half sail so a crew can go across. She puts to sea under all plain sail. | A/D or ←/→ helm · W/S or ↑/↓ set and take in sail |
| Broadsides | the two cannon buttons, port on the left and starboard on the right. Each gun points the way its broadside will fire on screen; the ring is the reload. Tap the other side while one is firing and it follows. | Q / E, or left / right mouse button |
| Mortar | MORTAR button | Space |
| Heave to | ❙❙, or the system back gesture | Esc |
| Camera | | mouse wheel: in to your ship, out to the horizon |

On Android the game takes the whole screen and locks to landscape when you put to sea
(switch it off in Articles); installed from the browser menu it opens that way. On an
iPhone, Add to Home Screen does the same. A ship's unlock code can be typed in the
shipyard as well as scanned.

The fans painted on the water are each side's arc and range. They turn gold when a side
is loaded and bears on something. The gold dashed ring ahead of the bow is where the
mortar will land. It locks onto the nearest ship forward.

## The loop

- **Sight.** A Spanish captain sees you inside her class's sight range (shortened by storm
  and fog), and only if no island is in the way. Once she sees you she calls her squadron.
  Unalerted squadrons sweep toward where you were last heard of. Lose them in fog or
  behind a headland and they go back to searching.
- **Pace.** Every ship's speed and every ball in flight is its table number times `PACE`
  (`src/data/pace.ts`, 1.25): one number sets how fast the game plays without changing who
  out-sails whom or how far a ball leads its mark.
- **Broadsides.** Each side reloads on its own. Balls ripple bow to stern, carry your own
  way, and are stopped by rock. Some hulls add bow chasers that fire themselves.
- **Surrender and boarding.** At a quarter hull she strikes. Come within about a hull's
  length at under nine-tenths of your best speed and hold it for 0.8s to board: double
  plunder, a hull repair, and your notoriety drops. Let her go and it rises, and she makes
  sail and is gone into the haze in a few seconds. Sink her anyway and it rises more.
- **Notoriety.** Five flags. At three, hunter frigates come in off the rim already
  looking for you. At five, a legendary comes out of schedule.
- **Waves.** The v1 wave curve, turned into squadrons. The next one puts to sea on a timer,
  or sooner if the sea goes quiet. Every fifth wave is a legendary: El Impoluto, La Dama
  Negra, HMS Prince or La Fortuna. Each has glowing gun ports as weak points and three
  phases.
- **The edge of the chart.** A band of streaked current, and sea mist beyond it. Sail into
  it and the current swings her bow round and sends her back in.
- **Home.** A clear sea lights a beacon over Nassau. Sail into the harbour mouth, or take
  the ⚓ shortcut. Careening refits hull and shells. Upgrades and the bribe are bought there
  and last for the run.
- **Weather and hazards.** Storms (bigger swell, rain, lightning, a set that pushes you),
  fog, reefs, and waterspouts from wave 12. Wrecks drop rum, shells, powder, heavy shot,
  chain shot and swivel crews.

## Ships and QR unlocks

The roster is `src/data/ships.ts`. A ship is a `ShipDef`:

- `base`: her numbers (hull, speed, helm, guns a side, reload, reach, bow chasers, shells, lives)
- `model`: a procedural `HullRecipe` (length, beam, freeboard, sheer, stern, rig, masts,
  gun decks, flag, palette), or a GLTF with a recipe fallback. The recipe also carries her
  looks: `tatter` (how ragged her canvas is at full hull), `emblem` and `ink` (a skull or the
  Cross of Burgundy painted on her main canvas), `gilt` (carved and gilded stern and head),
  `chasers` (bow guns on deck), `squareTops` (square topsails over a fore-and-aft rig), and
  `palette.inside` (the inboard face of her bulwarks)
- `ability`: a hook for signature moves; none ship yet
- `unlock`: `'starter'` or `{ code }`

Adding a ship means adding an entry. The shipyard, Nassau's upgrade maths (`shipStats()`),
the simulation and the renderer all read this one list.

| Ship | Rig | Role | Unlock |
|---|---|---|---|
| Jackdaw | brig | balanced, bow chasers | starter |
| Kestrel | sloop | fast, tight helm, fragile | `KSTRL-7Q` |
| Revenant | galleon | nine guns a side, slow | `RVNT-4K` |
| Marée Noire | schooner | longest reach, hates contact | `MAREE-9X` |

**Unlocking.** Each ship has one NFC tag at the bar, and a QR code as a fallback. Both
open `https://<site>/u/<CODE>`, and the tag's URL adds `?src=nfc`. `vercel.json` rewrites
`/u/*` to the app, the app turns it into `#/unlock/<CODE>` and plays the reveal, and the ship
is saved to this device straight away. The tap is also written to an outbox and sent to
the server when there is a connection (see **The server**). The codes are plain shared
links, as decided: anyone with the link gets the ship.

`npm run qr -- https://your.site` writes a printable SVG and PNG per code. Write the same
URL, plus `?src=nfc`, to each ship's tag.

## The server

Supabase: Postgres, and sign-in for guests who never sign up. `src/net/cloud.ts` is the
only file that talks to it, and the game never waits on it.

- **Players.** On first open the game signs the guest in anonymously and the server makes
  a player with a pirate name (`Salt Nell`). They can rename themselves in Articles.
  Later they can link Google or another provider to the same account and keep everything.
  The sign-in lives in localStorage under `blackflag.auth`. Burning the log clears it and
  starts a new player. So does a player deleted on the server (old anonymous players get
  cleared out): the device signs in again as someone new and sends its ships up as `sync`.
- **What they own.** `inventory` holds namespaced items: `hull:kestrel` now, `part:…` for
  the parts a ship will be dressed in. On connect, the device and the server swap what
  the other is missing (`reconcile()` in `src/net/items.ts`). Ships unlocked before the
  server existed are sent as their codes, marked `sync`.
- **Taps.** Every tap, scan or typed code goes into `session.outbox` first and is sent to
  `redeem()` when the server can be reached, with the time it happened. The server logs
  each one in `taps` (`nfc`, `link`, `typed`, `sync`), including codes that unlock nothing.
- **The register.** `unlock_codes` maps a code to an item, with the venue and cocktail it
  belongs to. The game still resolves codes itself so a reveal works offline; a test
  fails if the two registers disagree.
- **Rules.** Phones read their own player and inventory, and nothing else. Every write
  goes through a function (`me`, `redeem`, `rename_captain`). It's all in
  `supabase/migrations/`, and `tests/db.test.ts` runs it in an in-process Postgres
  (PGlite) as a signed-in guest and as nobody.

Configure it with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the defaults
in `src/net/cloud.ts` point at the live project. The publishable key is meant to be
public. With no key, the game runs as it did before the server existed.

In the Supabase dashboard (these mirror `supabase/config.toml`):
- Authentication → Sign In / Providers: allow anonymous sign-ins, and allow manual linking.
- Authentication → Rate Limits: raise anonymous sign-ins well above 30 an hour per IP. A
  whole bar shares one wifi address.

### How a ship is drawn

Every hull afloat, the player's and the Spanish line alike, is lofted from its recipe
by one procedural shipwright in `src/render/ships/`. No models or image files are loaded:

- **Lines** (`form.ts`). The hull is a function of how far along her and how high: a bluff
  bow that flares, a round bilge going to a V at the ends, the run narrowing under a raked
  transom, tumblehome, sheer, and stepped quarterdeck, poop and forecastle.
- **Hull** (`hull.ts`). Planked sides painted in strakes that follow the sheer, with wales
  standing proud. Then:
  - decks, bulwarks, rails and balustrades;
  - gun ports whose red-lined lids swing up while the guns run out, and recoil when a side fires;
  - lit stern windows, stern walks, quarter galleries, gilded crests and lanterns;
  - the stem, head and figurehead, catheads and anchors;
  - on deck: capstan, wheel, boat, casks and a crew (`crew.ts`).
- **Rig** (`rig.ts`). Masts in sections with tops and crosstrees, yards up to royals, gaffs,
  spankers, jibs and a spritsail. Shrouds carry ratlines; stays, backstays, lifts, braces
  and footropes are drawn as rope ribbons.
- **Paint** (`paint.ts`). Two textures painted pixel by pixel at start-up:
  - timber: hull and deck planking, spar grain, glazing;
  - a sail atlas: cloths, reef bands, patches, stains, emblems, and a tear map. The
    canvas rags from the foot up and rips along its cloths as she takes damage.
- **Shaders** (`materials.ts`). Four, each three.js's standard or basic material with a few
  lines spliced in:
  - timber: the whole solid ship in one draw; swings the lids, runs out the guns, chars with damage;
  - canvas: fills, luffs and flaps, and glows with the sun behind it;
  - rope: keeps a line at least a pixel wide and fades it by coverage instead of letting it crawl;
  - bunting: flags and pennants.

### How the world is drawn

The land and sea are procedural too, and built once per chart.

- **Islands** (`render/land/ground.ts`). Each island is a heightfield shaped to the chart's
  coastline, so what you see is what you run aground on:
  - jungle hills round an off-centre summit, with ridges and gullies;
  - rock islands cut in ledged cliffs up to a craggy top;
  - sand cays of dunes.

  The ground shader paints sand, grass, rock and dirt from one texture in world space.
  Strata stand up on cliff faces, and the ground is wet at the water's edge.
- **Plants and rocks** (`land/flora.ts`). Palms with curved trunks and leaflet fronds, a
  jungle canopy, scrub and hardwoods, and boulders grown from 3D noise. Each island's
  plants are one mesh that sways in the wind.
- **Nassau** (`land/nassau.ts`). A town laid out on the island's own slope:
  - terraced rows of plastered houses following the bay;
  - warehouses and a tavern on the quay, a church, the governor's house;
  - a pirate camp on the beach;
  - a bastioned fort with its guns, and a lighthouse whose beam sweeps at dusk;
  - piers with boats, and a market square.
- **Sea** (`ocean.ts`).
  - Gerstner swell, and caustics in the shallows.
  - Surf that breaks in lengths, and a foam collar and bow wave on every hull.
  - Everything painted on the water rides the same swell through shared uniforms (`waves.ts`).
- **Sky** (`sky.ts`). Cumulus lit by stepping toward the sun, with cirrus above.
- **Flotsam** (`flotsam.ts`). Floating cargo in gold rings, and waterspouts.

For the console, `bf.view.eye([x, y, z], [lx, ly, lz])` puts the camera anywhere in world
coordinates.

A ship is five draws. Geometry is built once per recipe and shared, and every recipe is
prebuilt in idle time at start-up. The phone tier builds lighter hulls: fewer stations and
cylinder sides, sparser ratlines, half the crew. In the console,
`bf.inspect('foe', 'manowar', 1.5)` puts any hull at anchor in the shipyard (kinds `ship`,
`foe`, `legend`; the last argument is zoom). `bf.view.peek([x, y, z])` places the camera
in her frame, and `bf.view.showDamage = 0.7` shows her shot up.

## Files

```
src/
  core/        rng (mulberry32), 2D vector helpers
  data/        pure content: ships, enemy classes, legendaries, waves, upgrades, drops,
               notoriety, unlock codes
  sim/         the pure, deterministic simulation — create / step / digest
    map.ts       the seeded archipelago, coastlines, line of sight
    sailing.ts   helm, grounding, the rim current, hull collision
    ai.ts        patrol → sight → engage → struck → spent; legendary patterns
    combat.ts    broadsides, shot, damage, striking, boarding, the mortar
    spawn.ts     squadrons, hunters, early legendaries
    world.ts     the tick
  render/      three.js; reads a world, never writes one
    view.ts      renderer, camera modes, sync, event → effect
    ocean.ts     Gerstner swell, shallows and caustics, surf, glint, foam, hull wash
    islands.ts   builds every island from the chart
    land/        ground.ts (heightfields, ground shader), flora.ts (palms, canopy, rocks),
                 nassau.ts (the town, fort, light and quays), paint.ts (land textures)
    flotsam.ts   floating cargo and waterspouts
    sky.ts  atmosphere.ts  noise.ts  builder.ts  wakes.ts  fx.ts  markers.ts  waves.ts
    ships/       the shipwright: procedural.ts (a ship on the water), form.ts (her lines),
                 hull.ts, rig.ts, crew.ts, paint.ts (timber and canvas textures),
                 materials.ts (her shaders), mesh.ts, flags.ts, ShipModel.ts
  ui/          screens, HUD (minimap, pointers, reload rings), input, silhouettes, css
  audio/       synthesised, stereo-placed cannons, sea and shanty
  state/       session (localStorage v2, migrates the v1 record book), run banking
  net/         cloud.ts (the one door to the server), items.ts (inventory ids, reconcile)
supabase/      config.toml and migrations/: the server's tables, rules and functions
tests/         vitest, a headless bot captain, and the server's rules in PGlite
scripts/       qr.ts (QR printer), icons.ts (the home-screen icons)
public/        manifest.webmanifest and the icons it names
```

## The self-check

`npm test` runs the simulation headless at a fixed 1/120s and holds:

- every v1 invariant: the wave curve escalates, unlock order holds, the strike window is
  exact to a tick, hull never goes negative, a lethal hit costs one life, notoriety stays
  on its dial, and a wave never writes back to the run it was built from
- a seeded replay is byte-identical across four seed/wave pairs, and two seeds differ
- an island blocks sight, open water does not, and a squadron hears its own open fire
- boarding needs close and slow; tearing past is not boarding; the mortar still finishes a prize
- waves 1–20 each end, won or lost, never stalled (driven by a bot captain in `tests/bot.ts`)
- every unlock code resolves to a ship, codes survive case and dash mangling, and a v1
  save migrates
- the server's rules (`tests/db.test.ts`): a player is made on first ask; a tap unlocks
  once and counts every time; unknown and switched-off codes unlock nothing; a phone
  reads only its own rows and cannot write any table; the server's register matches the
  game's; and this device and the server swap what each is missing

## Departures from v1, and why

- **The strike window is 6s, not 4.** In v1 a prize drifted down the screen to meet you.
  On an open sea you have to come about for her, and at 4s a bot that chased every prize
  was losing most of them.
- **A struck ship can be shot.** v1 held fire on prizes because firing was automatic and
  boarding never happened otherwise. With broadsides in your hands, sinking a prize is a
  choice, and `heatSunk` charges for it.
- **Boarding is coming alongside, not ramming.** Ramming still hurts both hulls.
- **Passive notoriety is a third of v1's rate** (`0.004/s`). Open-sea waves run minutes,
  not one, and at the old rate a wave on its own was worth three flags.

## First play-test, and what changed

One run by hand (sunk on wave 4), then waves 1–10 headless, 4 seeds each, with the
bot captain. What it found and what was done:

| Found | Changed |
|---|---|
| 52s of empty sea before anyone found you, from behind | the first squadron of a wave puts to sea 360–560m out, squadrons search faster, and a **SAIL HO** arrow points at the nearest one until someone sees you |
| Spanish balls hit 50–70% of the time, the player's ~30% | every volley is laid with an error and each ball scatters (`FOE_LAY`, `FOE_SCATTER` in `sim/combat.ts`): ~35–45% now. Your 30m hull beam-on is still the bigger target, so turning bow-on to a broadside is the counter |
| lanchas out-ran the Jackdaw and did most of the early damage by ramming | lanchas 17.5 → 14 m/s, ram 5 → 4; bow chasers hit harder |
| a prize touching your bow sailed away because you were at full sail, with no hint why | the speed limit is 90% (was 75%), and the prize label says **EASE OFF TO BOARD** / **COME ALONGSIDE** |
| steering at the beacon runs you aground on Nassau's north shore, and a grounded ship barely turned | anywhere close under Nassau counts as home; a ship with no way on keeps half her helm; land shoves her off |
| every squadron converged at once in later waves | a timed squadron waits while `crowd(wave)` hostiles are already on the water |
| La Dama Negra answered every boarded launch with two more: wave 10 was lost 4/4 | she puts a fixed screen of launches in the water per phase; her fan is aimed, not led |
| legendaries were two- to three-minute sponges unless you found the ports | 30% less hull, hull hits count for half (was a third), Dama and Fortuna fire a little slower |

Bot, waves 1–10 with the upgrades a player would have by then — before → after:
damage taken per wave 30–103 → 19–94 for waves 1–9, and wave 10 went from **0/4 won, all
three lives lost** to **4/4 won, half a life**.

## Second review, phones first

The whole game read through again with a phone in landscape as the main way it is played:
three audits (simulation, phone UI and flow, renderer), each finding checked before it was
fixed. The ones that mattered:

| Found | Changed |
|---|---|
| "The direction is broken: she won't move, or goes diagonal" — the rim current was invisible and only shoved, so near the edge (where squadrons put to sea) she stopped dead or slid sideways | the current takes her head and swings her about, the sea shows it (streaked current, mist beyond), the minimap draws it, a toast names it |
| on a phone, holding the stick to one side circled for ever: the stick is read against the screen, and the camera turned the screen | the camera holds its bearing while a thumb is on the stick |
| "destroyed ships keep sailing": a prize whose window lapsed ran for the rim for up to 40s, burning, un-hittable, a red dot on the minimap | she makes sail and dissolves into the haze in 4s |
| a thumb pushed hard could never board, and nothing on screen said how to slow down | letting go eases her to half sail, the sail gauge shows on phones, the label says **LET GO TO BOARD** |
| a waterspout out-pulled the Jackdaw and the galleon and held them at its core until the run ended | its pull stays below the ship's own speed |
| pausing (or locking the phone) in the second before the curtain undid a death | a wave's result is written the moment it happens |
| the back gesture could reach the port shop mid-wave, where upgrades were free | routes a live wave may not be left for lead to the pause screen |
| back buttons bounced between two screens for ever | they walk a trail back to where you came from |
| the paint cap at 60fps skipped a frame every few on a 60Hz iPhone | frames count as due a little early and the remainder carries |
| the sky's clouds were worked out for every pixel and then painted over by the sea | the sky is drawn last among the opaque, so the depth test discards it |
| shaders compiled mid-fight (first alert, first ring, first shell) and every island was rebuilt twice a run | everything compiles at start-up; the chart is built once per run |
| the key screens' one action fell below the fold on a short landscape phone | actions stay on screen, the middle scrolls |

## Not built, or not yet measured

- **Balance needs a real player.** The numbers above are a bot that knows where every ship is and never dodges; treat them as relative, not absolute.
- **Frame rate on a real phone is unmeasured.** Desktop Chrome with thirteen ships on
  screen at wave 14: about 80 draw calls, 275k triangles, and half a millisecond of CPU a
  frame for the view. Low tier, the default on touch devices:
  - DPR 1.5, 3 swell waves, no shadows, no bloom, a cheaper sea (one ripple layer, no
    caustics);
  - lighter hulls and 512px ship textures;
  - and a resolution governor: a phone that cannot hold its frame rate drops toward DPR
    0.75 rather than dropping frames, and climbs back after a run of good ones.

  Picture quality can be forced in Articles.
- **No GLTF ships ship yet.** `ModelSpec` has the `gltf` variant and `ShipModel` is the
  seam. The loader is not written.
- **Records are this device's.** Players, unlocks and taps are on the server; the record
  book is still localStorage only.
- **Fonts load from Google.**
