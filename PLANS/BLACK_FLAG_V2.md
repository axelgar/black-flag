# Black Flag — v2 plan: open-sea 3D rewrite

> As built, two differences from this plan: the screens live in one file (`src/ui/screens.ts`,
> v1's idiom) rather than `screens/*.ts`, and the GLTF `ShipModel` is not written yet. The
> `ModelSpec` type has the variant, but no ship uses it. The strike window shipped at 6s; the README says why.

## Context

Black Flag v1 (`js/*.js`, ~4k lines, vanilla ES modules, three 2D canvases) is a portrait,
top-down, vertically scrolling shooter: the Jackdaw is pinned to one latitude, fleets
descend in waves, bow chasers auto-fire. It was a test. The goal now is a real game that can grow:

- **Open map, any direction.** A bounded archipelago you sail freely; enemies arrive in waves,
  patrol, and **hunt you once they see you**.
- **3D, much better graphics.** Three.js, animated ocean, islands, lit low-poly ships.
- **Unlockable ships** with distinct stats and visuals, unlocked by **scanning a QR code**
  (plain shared links). This is a data-driven roster, so adding ships later is just adding content.

Decisions already made with the user:
- Vite + TypeScript + Three.js. Landscape, phone and desktop. High 3/4 chase camera.
- **Manual broadsides.** The player fires port or starboard, and each side reloads on its own.
- Carry over: surrender + boarding, notoriety + hunters, the four legendaries, weather/hazards/drops.
- One bounded archipelago per run. Waves spawn patrols. Between waves you sail into Nassau harbour to refit.
- Procedural low-poly ships behind a `ShipModel` interface, so a GLTF can replace any ship later.
- QR = a simple shared URL per ship. The phone camera opens the link. No backend, no in-game scanner.

What survives from v1 **in design, ported to TS**: the pure/deterministic sim split (`world.js` has
no DOM/clock, fixed 1/120s step, seeded mulberry32, `digest()` replay test), the strike-window rule,
the notoriety formulas (`heatSunk/heatEscaped/heatBoarded`), the upgrades and bribe (`UPGRADES`,
`shipStats`, `bribeCost`), `DROPS`/`rollDrop`, `LEGENDS`, enemy class table `CLASSES`, run banking
(`newRun/bankWave/endRun` and the rule that nothing mid-wave writes to the run), the router pattern,
the synthesised audio (`js/audio.js`), the analytics shim (`js/analytics.js`), and the screen set and copy
from `js/screens.js`. Everything from `js/render.js` is replaced.

---

## Architecture

```
index.html            GTM snippet kept, fonts, #app canvas + #ui overlay, "turn sideways" card
vite.config.ts  tsconfig.json  package.json (three, vite, typescript, vitest, qrcode[dev])
vercel.json           rewrite /u/(.*) → /index.html ; framework: vite
scripts/qr.ts         prints/writes one SVG+PNG QR per unlock code → qr/ (npm run qr)
src/
  main.ts             boot, router, fixed-step loop (port of js/app.js), input wiring
  core/               rng.ts (mulberry32/hashStr), vec.ts (2D helpers), types.ts
  data/               PURE content, no three/DOM
    ships.ts          PLAYER roster: ShipDef[]  ← the expansion point
    enemies.ts        CLASSES ported + AI params (sightRange, preferredRange, gunsPerSide…)
    legends.ts        LEGENDS ported + 3D weak-point layout
    upgrades.ts drops.ts notoriety.ts waves.ts unlocks.ts
  sim/                PURE, deterministic, 2D on the XZ plane. No three, no DOM, no clock.
    world.ts          create(opts) / step(w, dt, input) / digest(w)
    map.ts            seeded archipelago: bounds, islands (noisy polygons + SDF), reefs, Nassau harbour zone
    sailing.ts        heading/rudder/sail-level physics, island & ship collision, map-edge pushback
    ai.ts             per-foe state machine (below)
    combat.ts         broadsides, bow guns, mortar, projectiles, damage, strike, boarding, ramming
    spawn.ts          wave plan → patrol groups at edges/islands; hunters; early legendary
    weather.ts        clear/storm/fog → sight range, drift, wave height
  render/             three.js; reads a world snapshot, never writes it
    stage.ts          WebGLRenderer, ACES tone mapping, quality tiers, resize, render loop hook
    camera.ts         3/4 chase rig (~50° pitch, damped yaw follow, zoom-out with speed/combat)
    ocean.ts          Gerstner-wave shader (4 waves), fresnel, sun glint, crest foam, shallow tint from island SDF texture, fog
    sky.ts            three/addons Sky + sun; per-weather presets and transitions
    islands.ts        heightfield meshes from map polygons, vertex colours (sand/grass/rock), instanced palms/rocks, Nassau town/dock
    ships/ShipModel.ts   interface { object3D, update(state, t), setDamage(f), setStruck(b), flashGuns(side) }
    ships/procedural.ts  lofted hull from recipe, gun ports, masts, animated cloth sails, flags, lanterns
    ships/gltf.ts        GLTF-backed ShipModel stub (same interface)
    buoyancy.ts       CPU copy of the Gerstner fn → pitch/roll/heave for ships (render-only, sim stays flat)
    fx.ts             instanced particles: muzzle smoke, splashes, fire, debris, wake ribbons, rain, lightning
    projectiles.ts    instanced cannonballs with visual arc height
    markers.ts        prize rings + timers, mortar rings, broadside arc fans, off-screen indicators
  ui/                 DOM (port of js/screens.js + css/app.css tokens)
    screens/*.ts      title, shipyard, unlock, play(HUD), port, dead, records, log, menu, pause
    hud.ts            hull, lives, plunder, flags, wave, boss bar, reload rings, toasts, minimap (2D canvas)
    touch.ts          virtual joystick (left) + PORT / STARBOARD / MORTAR buttons (right)
  audio/audio.ts      port of js/audio.js + spatial pan/gain by distance
  state/session.ts    persistence v2 (+ migration from `blackflag.log`), records, log, unlockedShips, selectedShip
  state/run.ts        newRun / bankWave / endRun (ported, now carries shipId)
  analytics.ts        port of js/analytics.js (+ ship_unlock, ship_select events)
tests/*.test.ts       vitest; port every assertion in test.mjs + new ones
```

Old `js/`, `css/`, `test.mjs` are deleted once v2 reaches parity. `PLANS/BLACK_FLAG_V2.md` records
this design. The README is rewritten.

### The ship system (the expansion point)

```ts
interface ShipDef {
  id; name; rank; blurb;
  stats: { hull; maxSpeed; accel; turnRate; gunsPerSide; broadsideReload; shotDmg; shotRange;
           bowGun?: {reload; dmg}; shellsMax; boardRepair; ramDmg; lives };
  model: { kind: 'procedural'; recipe: HullRecipe } | { kind: 'gltf'; url; scale };
  ability?: AbilityId;            // hook for later (e.g. 'chainVolley'), none required now
  unlock: 'starter' | { code: string };
}
```
`shipStats(def, upgrades)` replaces v1 `shipStats(up)`. Per-run Nassau upgrades apply on top of the
chosen hull's base stats, so one derivation still serves both the sim and the port screen.
`HullRecipe` holds length, beam, freeboard, sheer, stern style, mast count, sail rig
(square/lateen/fore-and-aft), gun decks, and the palette. Enemy classes and legendaries use the same recipe
type, so one procedural builder draws every ship in the game.

Launch roster: four ships, so the system is exercised. The names and numbers are placeholders to tune:
- **Jackdaw** (brig, starter, balanced, 5 guns/side)
- **Kestrel** (sloop, fast and tight turning, 3 guns/side, fragile, bow chaser)
- **Revenant** (galleon, slow and huge hull, 9 guns/side, long reload)
- **Marée Noire** (schooner, longest range, 4 guns/side, weak ram)

### QR unlocks
- `data/unlocks.ts`: `{ 'KSTRL-7Q': 'kestrel', … }`. The codes are opaque strings, not ship names.
- The QR encodes `https://<prod>/u/<CODE>`. `vercel.json` rewrites `/u/*` to the app, and `main.ts`
  turns it into `#/unlock/<CODE>` → the unlock screen: a 3D reveal of the ship turning on the water,
  then "Take her out" / "Later". The unlock is saved to the session. An unknown code gets a friendly
  "No such ship on the register".
- `npm run qr` generates `qr/<ship>.svg|png` for every code, ready to print.
- The shipyard screen (`#/shipyard`, reachable from the title) shows unlocked ships in 3D with a stat
  comparison. Locked ships show as dark silhouettes marked "Scan her code to unlock".

---

## Gameplay model

**Sailing.** The joystick (or WASD) sets the desired heading and sail level. The ship turns toward
that heading at `turnRate`, and her speed eases toward `maxSpeed × sail`. Momentum is kept. Islands
and reefs are solid: hitting one hurts and pushes you off. Past the map edge a current pushes you back.

**Broadsides.** Q/E, the right and left mouse buttons, or the touch PORT/STARBOARD buttons fire
`gunsPerSide` balls perpendicular to the hull with a slight ripple delay and spread. The ship's
velocity is added to each ball. Each side reloads on its own, shown as rings on the buttons.
When a side's arc covers an enemy within `shotRange`, a faint fan shows on the water: that is the
aiming aid. A ship with a bow gun fires it automatically at weak damage, so small ships are never
defenceless. Mortar: Space or its button. It lands where the reticle ahead of the bow points.

**Enemy AI** (`sim/ai.ts`), one state machine per foe:
`patrol` (waypoints around islands) → `alert` when the player is inside `sightRange × weather` **and** an
island does not block line of sight (segment vs island polygons) → alerts squadmates within
radius → `engage` → `struck` / `fleeing` / `spent`.
Engage behaviour is per class:
- lancha: rams, weaving
- schooner: keeps her distance and fires aimed bow shots
- brig: holds range and fires 2-gun beam shots
- frigate: turns her beam to you (the telegraph is the gun ports glowing) → a 5-ball broadside
- man-o-war: mortar rings on the water + broadsides
- brulote: accelerates straight at you and explodes

Brulotes and hunters spawn already alerted.

**Surrender and boarding (kept).** At ≤25% hull a foe strikes (except brulotes and legendaries): the
white flag goes up and a `STRIKE_WINDOW = 4s` timer starts. The hulk slows to drift. **Boarding**
means coming alongside, within ~1.5 hull-lengths at a low relative speed, for 0.8s. A ring fills,
then: double plunder, a hull repair, a notoriety drop, and a better drop roll.
**One departure from v1:** a struck ship can now be shot. v1 needed its check-fire rule only because
fire was automatic. With manual broadsides, sinking a prize is a deliberate choice, and that choice
is what `heatSunk` charges for. A prize you let escape still costs `heatEscaped`.

**Notoriety (kept).** Five flags. At 3 flags, hunter squadrons spawn from the map edge already
alerted. At 5 flags, a legendary appears out of schedule. The formulas port unchanged.

**Waves.** The `wavePlan` budget curve ports unchanged (`waveBudget` stays strictly increasing).
Groups turn into **patrol squadrons** placed at edge points or islands away from the player, and later
groups are released on the same timer as v1 or when earlier squadrons die. A wave ends when every
hostile is sunk, boarded or spent. Then a marker points to Nassau, and sailing into the harbour zone
banks the wave and opens the port screen. Every 5th wave is a legendary at a named spot on the map.
Legendaries keep their gun-port weak points (×3 damage) and their 3-phase patterns, adapted to 360° play.

**Weather/hazards/drops (kept).** A storm changes wave height, rain, lightning, lateral drift and sight
range. Fog shortens sight range and draws enemies late through the fog. Reefs are shallow rock
patches marked by breaking foam. Waterspouts from wave 12 pull you in. Drops float in the water
where ships sink, and you sail through a drop to pick it up.

---

## Rendering and performance

- Quality tiers: auto, picked from device and GPU, with a toggle in Articles. **Low** (phones):
  DPR ≤1.5, no shadow maps, 2 Gerstner waves, no bloom. **High**: DPR ≤2, one shadow-casting sun with
  a tight frustum that follows the ship, 4 waves, light bloom via `EffectComposer`.
- Draw calls stay low. Particles, cannonballs, palms and rocks are instanced. Each ship's geometry is
  built once per recipe and cached, then shared by every ship of that class.
- The ocean is one camera-following grid plane, with the displacement in the vertex shader. Ship
  buoyancy samples the same wave function on the CPU (`buoyancy.ts`). This is render-only, so the sim
  stays deterministic and cheap.
- The paint rate is capped at 60fps and at 30fps behind menus, keeping v1's idea from `app.js` `maybePaint`.
- Reduced motion (OS setting or the in-app toggle) cuts camera shake, lightning, particle counts and
  storm drift.

## Controls and screens
- Touch: a floating virtual joystick on the left half of the screen, and PORT / STARBOARD / MORTAR
  buttons on the right, each with a reload ring. In portrait, a "turn her sideways" card appears and
  the game heaves to (the inverse of v1's rule).
- Desktop: WASD/arrows to sail, Q/E or the mouse buttons for broadsides, Space for the mortar, Esc to pause.
- Hash routes as in v1, plus `#/shipyard` and `#/unlock/:code`. The v1 copy and tone is kept throughout.

---

## Build order (each stage playable)

1. **Scaffold and sea.** Vite+TS+three project and Vercel config. Ocean, sky, a seeded archipelago,
   and a procedural Jackdaw. Sailing and the chase camera. Stop here and check that steering feels good
   on a phone.
2. **Combat.** Broadsides, projectiles, enemy classes, AI with sight and line of sight, damage, hull and
   lives, the wave loop, win/lose, the HUD, touch controls.
3. **The Black Flag layer.** Surrender, boarding, plunder, notoriety, hunters. The Nassau harbour
   return and the port screen.
4. **Depth.** Mortar, drops, reefs, weather, waterspouts, the four legendaries.
5. **Ships and unlocks.** `ShipDef` roster and stat derivation, the shipyard, `/u/:code` → the unlock
   reveal, `npm run qr`, session v2 plus the migration.
6. **Shell and polish.** The remaining screens, the audio port with spatial panning, minimap and
   off-screen indicators, quality tiers, reduced motion, analytics events, tests, README, delete v1 files.

## Verification

- `npm test` (vitest). Every assertion from `test.mjs` is ported: the wave curve is monotonic, the
  unlock gates hold, the strike window is exactly 4s ±1 tick, hull is never negative, a lethal hit costs
  one life, 4 seed/wave digest replays match, and a wave never writes back to its run.
  New tests:
  - An enemy does not alert through an island, and does once it has line of sight.
  - Boarding needs to be close and slow; a prize escapes after the window.
  - Every unlock code resolves to a real ShipDef, and every non-starter ship has a code.
  - `shipStats(def, upgrades)` is monotonic in each upgrade.
  - Headless bot runs of waves 1–20 finish with no dead end.
- `npm run build && npm run preview`, then drive it in Chrome (claude-in-chrome) at a landscape phone
  size (844×390) and on desktop:
  - Sail, fire both sides, board a prize, clear a wave, dock at Nassau, buy an upgrade.
  - Die and check the summary.
  - Open `/u/<code>` and check that the reveal and shipyard unlock it.
  - Check the console for errors, and read `renderer.info` for draw calls and triangles.
  - Take screenshots per stage.
- Performance: check the FPS counter (dev overlay) at wave 10 with the Low tier under mobile
  emulation. Real-handset FPS stays unmeasured until someone runs it on a phone, as the v1 README
  says honestly.
