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
```

Vite, TypeScript and Three.js. Everything is procedural: no models, textures or sound files.

## Controls

| | Touch | Keyboard / mouse |
|---|---|---|
| Sail | floating stick, left half of the screen. Push the way you want to go (relative to the camera); how far you push sets the canvas. Let go and she holds course. | A/D or ←/→ helm · W/S or ↑/↓ set and take in sail |
| Broadsides | PORT and STBD buttons (the ring is the reload) | Q / E, or left / right mouse button |
| Mortar | MORTAR button | Space |
| Heave to | ❙❙ | Esc |

The fans painted on the water are each side's arc and range. They turn gold when a side
is loaded and bears on something. The gold dashed ring ahead of the bow is where the
mortar will land. It locks onto the nearest ship forward.

## The loop

- **Sight.** A Spanish captain sees you inside her class's sight range (shortened by storm
  and fog), and only if no island is in the way. Once she sees you she calls her squadron.
  Unalerted squadrons sweep toward where you were last heard of. Lose them in fog or
  behind a headland and they go back to searching.
- **Broadsides.** Each side reloads on its own. Balls ripple bow to stern, carry your own
  way, and are stopped by rock. Some hulls add bow chasers that fire themselves.
- **Surrender and boarding.** At a quarter hull she strikes. Come within about a hull's
  length at under three-quarter speed and hold it for 0.8s to board: double plunder, a
  hull repair, and your notoriety drops. Let her go and it rises. Sink her anyway and it
  rises more.
- **Notoriety.** Five flags. At three, hunter frigates come in off the rim already
  looking for you. At five, a legendary comes out of schedule.
- **Waves.** The v1 wave curve, turned into squadrons. The next one puts to sea on a timer,
  or sooner if the sea goes quiet. Every fifth wave is a legendary: El Impoluto, La Dama
  Negra, HMS Prince or La Fortuna. Each has glowing gun ports as weak points and three
  phases.
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
  gun decks, flag, palette), or a GLTF with a recipe fallback
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

**Unlocking.** A QR code encodes `https://<site>/u/<CODE>`. `vercel.json` rewrites `/u/*`
to the app, the app turns it into `#/unlock/<CODE>` and plays the reveal, and the ship is
saved to this device. The codes are plain shared links, as decided: anyone with the link
gets the ship. To make them one-time or tied to an account, move `shipForCode()` behind an
API. The URL format can stay the same.

`npm run qr -- https://your.site` writes a printable SVG and PNG per code.

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
    ocean.ts     Gerstner swell, shore-distance shallows and surf, glint, foam
    sky.ts  atmosphere.ts  islands.ts  wakes.ts  fx.ts  markers.ts  waves.ts
    ships/       procedural.ts (lofted hulls, rigs, billowing sails, flags), ShipModel.ts
  ui/          screens, HUD (minimap, pointers, reload rings), input, silhouettes, css
  audio/       synthesised, stereo-placed cannons, sea and shanty
  state/       session (localStorage v2, migrates the v1 record book), run banking
tests/         vitest + a headless bot captain
scripts/qr.ts  QR printer
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

## Not built, or not yet measured

- **Balance needs a real player.** The numbers above are a bot that knows where every ship is and never dodges; treat them as relative, not absolute.
- **Frame rate on a real phone is unmeasured.** Desktop Chrome: about 40 draw calls and
  ~5ms CPU a frame at wave 9. Low tier (the default on touch devices): DPR 1.5, 3 swell
  waves, no shadows, no bloom. Picture quality can be forced in Articles.
- **No GLTF ships ship yet.** `ModelSpec` has the `gltf` variant and `ShipModel` is the
  seam. The loader is not written.
- **Records are this device's.** localStorage only, like v1.
- **Fonts load from Google.**
