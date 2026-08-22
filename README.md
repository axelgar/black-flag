# Black Flag

Mobile web game. You are the Jackdaw at the bottom of a fixed 390×844 stage, sailing
north into a Spanish fleet that keeps coming down. Dodge, shoot, and then decide every
few seconds whether the thing you have been avoiding is now worth chasing.
Implementation of `PLANS/BLACK_FLAG_V1.md` — all five stages of its build order.

Same skeleton as `../oddish`: vanilla ES modules, no build step, stacked canvases, a
pure model `node test.mjs` can import.

**Live:** <https://black-flag-two.vercel.app> — Vercel took `black-flag` for someone
else's project, so the alias is `-two`. Open it on a phone, in portrait.

## Run

```
python3 -m http.server 8000     # any static server; ES modules need http, not file://
open http://localhost:8000
node test.mjs                   # wave curve / surrender window / boarding / replay
```

No build step, no package.json, no dependencies to install. d3 loads from a CDN via
the import map in `index.html`.

## The loop

Your bow chasers fire on their own, so one finger is enough. Shoot a ship below a
quarter hull and she strikes her colours: a white flag runs up and for **four seconds**
she is not an obstacle but a prize. Ram her to board her — double plunder, a hull
repair, and your notoriety drops. Let her drift off and she sails home and describes
you, so it climbs. Drop a mortar shell on her instead and you get the base coin and it
climbs faster.

Notoriety is five flags. Three puts hunter frigates on your flanks; five brings a
legendary out of schedule. Nothing in a menu sets the difficulty — how greedy and how
brutal you are does.

## Three departures from the plan, and why

**Round shot does not fire on a ship that has struck.** This is the big one, and it is
load-bearing. The plan kept auto-fire and let you sink a prize by simply not stopping.
A headless battery said no: your bow chasers point exactly where a prize is, and
wanting to board her means steering *into* your own firing line, so every ship that
struck died about a third of a second later. Across sixty simulated waves, boarding
happened **zero** times. Now the gun crews hold fire and round shot passes over her, so
the choice the whole design rests on is actually available.

That answers open question 1 in the plan's own words — auto-fire is right, but only
with a check-fire rule attached.

**A prize that gets away raises notoriety.** With guns holding fire, the plan's only
source of notoriety was mortaring prizes, which nobody would spend a scarce shell on, so
the dial never moved. Letting an escape cost half of what a sinking costs makes ignoring
prizes the lazy path rather than the free one, and it is the right story: she has a crew,
and they get home and talk. There are now three real answers to a white flag — board
(best), mortar (coin now, notoriety), ignore (nothing, and a little notoriety) — where
the plan had two.

**Careening is the repair.** The plan says hull is repaired at port between waves; the
first end-to-end run put you into wave 2 on five hull, which made Nassau a shop rather
than a refit. Hull and mortar shells both come back full at the beach. Hull is what you
spend inside a wave, lives are what you spend across a run.

The plan's own two calls — **no WebGL** and **`world.js` split out of `state.js`** — are
both in, unchanged.

## On a phone

Driven with real touch events under device emulation on four handsets — iPhone SE
(375×667), iPhone 14 (390×844, the design target), Pixel 7 (412×915) and iPhone Pro Max
(430×932). On all four: `pointer: coarse` is detected, drag-to-steer moves the ship,
`touch-action: none` stops the browser stealing the drag, the mortar button is a 62–86px
thumb target and firing it spends a shell, and the sea reaches both screen edges. The
page cannot be dragged sideways on any of them.

**Portrait only, and it says so.** Turned sideways a phone would clamp the stage to about
0.46 and leave a 180px postage stamp, so it gets a "turn her upright" card instead and
heaves to — the same rule as backgrounding the tab, and for the same reason: taking fire
you cannot see is unfair either way. Bounded to `(pointer: coarse) and (max-height: 560px)`,
so a tablet on its side and a short laptop window both keep the stage.

**Frame rate on real phone hardware is unmeasured.** The simulation is not the question —
it costs about 1µs per fixed step at wave 20 with sixty entities on the water, which is
0.01% of a 60fps frame. All the cost is paint: two full-screen canvas operations per frame
plus forty-odd small vector draws, GPU-composited on a real device but software-rasterised
in headless, so the numbers this build can measure are not the numbers a phone would give.
`DPR` is capped at 2. Put it on a handset before believing anything about it.

## Files

| | |
|---|---|
| `index.html` | Stage, three canvases, import map |
| `css/app.css` | Tokens, the HUD, the Nassau sheet, grain, vignette |
| `js/state.js` | Ship classes, the wave curve, notoriety, upgrades, persistence. No d3, no DOM |
| `js/world.js` | The simulation: `create()`, `step(w, dt, input)`, `digest()`. No canvas, no DOM, no clock |
| `js/render.js` | The paint: sea, fleet, fx, the careening beach, the log sprites |
| `js/audio.js` | Synthesised cannons, sea, and a shanty that speeds up with notoriety |
| `js/screens.js` | Title, play + HUD, Nassau, run summary, records, captain's log, articles, pause |
| `js/app.js` | Router, boot, input, the fixed-timestep clock, desktop clamp |
| `test.mjs` | The self-check |

## What the plan asked for and got

- Six Spanish classes with the plan's stats table, and the brulote as the one that never
  strikes her colours
- Four legendaries every fifth wave, with gun ports as weak points (×3 damage there,
  ×0.35 anywhere else), three phases, and a place in the log when you beat one
- Two damage layers: a hull bar and three hearts, with a two-second refit
- Notoriety as five flags, hunters at three, an out-of-schedule legendary at five
- Mortar, six drops, reefs that block shot from both sides, storms every fourth wave,
  fog banks, waterspouts from wave 12
- Nassau: five upgrades and a bribe, all per-run; the record book and the captain's log
  persist across runs
- Hove to mid-wave, two ways out of it: come about and sail the wave again from the top,
  or run for Nassau and leave it for later. Both un-sail the wave — plunder, lives, hull
  and notoriety all go back to what they were when she left the beach, so a retreat is a
  retreat and not a way to farm the first two ships of a rich wave
- All eight hash routes, `oddish`'s router verbatim
- Three flat 2D canvases, everything procedural, zero assets
- Touch drag / keyboard / mouse, and `prefers-reduced-motion` cutting shake, lightning,
  particles and storm drift
- Desktop clamps to 390px and scales; on a phone the sea bleeds past the column to the
  screen edges. Never a reflow.

## The self-check

`node test.mjs` runs headless battles at a fixed 1/120s timestep and holds the five
things that would rot silently:

- `waveBudget(n)` strictly increases for sixty waves, and no class appears before it unlocks
- a schooner under fire strikes her colours, survives it, and stays boardable for
  **exactly** `STRIKE_WINDOW` — asserted to within one timestep
- hull never goes negative, a lethal hit costs exactly one life, and the refit comes back
  at full hull with grace on it
- a fixed seed replays byte-identically over four seed/wave pairs. That is the tripwire:
  the moment anything in `world.js` reaches for `Math.random()` or a clock, the digests
  stop matching.
- a wave in progress never writes back to the run it was created from. `bankWave()` at the
  beach is the only thing allowed to, and that is the whole of why coming about and
  retreating rewind anything at all.

Waves 1–20 are also each run to completion, so the authored run has no dead end.

## The frame budget

A phone that gets hot is a phone painting more than anyone asked it to. Four things
were doing that, and none of them was the simulation — `cull()` has always thrown away
every ship, shot, drop, reef, spout and blast mark the moment it leaves the screen.

- **The paint is gated to 60fps, and to 30 on an idle screen.** `d3.timer` is
  `requestAnimationFrame`, so on a 120Hz phone the whole three-canvas stack was being
  repainted 120 times a second — twice as often as anyone can see it. The simulation
  keeps its own fixed 1/120s accumulator and is untouched by this; the paint now has a
  second accumulator of its own, and is handed the whole elapsed dt so particles and
  the flash decay at exactly the speed they always did.
- **The title, Nassau, the pause and the run summary all idle at 30fps.** Every one of
  them keeps a live sea behind it, and every one of them was painting it at the full
  refresh rate for as long as it was left open. Shopping for upgrades cost the same as
  being shot at.
- **Sky, haze and water are baked and blitted**, the way the swell already was. All
  three are the same gradients for the whole of a given weather, and all three were
  being rebuilt and refilled full-width on every frame.
- **The two overlays that sit over the wave itself lost their `backdrop-filter`.** A
  blur has to re-read and re-blur its backdrop every frame it is composited, and behind
  the mortar button is a canvas that is different every frame for the length of a run.
  Every other blur in the build sits over a sea that has settled.

The sea layer is also declared `alpha: false` — it is the widest of the three canvases
and the sky and water cover every pixel of it, so it has nothing to blend with what is
under it. `cull()` compacts in place rather than allocating six arrays a tick.

Still on the table, both of which cost something to look at, so neither was taken
unilaterally: `.grain`'s `mix-blend-mode: soft-light` is a full-screen blend the
compositor has to recompute against changing water every frame, and the pause scrim's
blur sits over a sea that is still moving under it.

## Not built

Marked in the source with `ponytail:` comments.

- **The record book is this device's record book.** localStorage only, under one key.
  A leaderboard needs a backend and an identity; until there is one, `#/records` says so.
- **Audio is synthesised**, not sampled — a noise burst through a bandpass over a pitched
  thump for a cannon, filtered brown noise for the sea, a D-minor arpeggio for the shanty.
  Replace with recorded stems if they ever exist.
- **Fonts load from Google.** Self-host before anywhere with bad wifi.
- **Endless mode is the authored generator with no ceiling.** `wavePlan()` keeps working
  past wave 20 and the legendaries cycle, but nothing new is introduced after wave 12.

## Open questions from the plan

**Is auto-fire right?** Answered, with a caveat — see the departures above. Auto-fire
plus a check-fire rule on struck ships.

**Does the four-second surrender window survive a real player?** Open, but it turns out
not to be the number that matters. Sweeping the window against a headless bot that
chases every prize and ignores everything else, the capture rate barely moved: one prize
in six at three seconds, one in six at eight. The binding constraint was that a struck
ship *slowed down*, so she could never reach your latitude before the window shut.

The number that actually sets the difficulty of boarding is how fast a hulk drifts, and
that curve is steep — measured over thirty simulated waves: ×1.0 of the current takes
44% of prizes, ×1.15 takes 55%, ×1.3 takes 74%, ×1.7 takes 100%. It is set to **1.15**,
where a perfect chaser gets about half of them, finishes waves at 72% hull, and still
dies about once in five runs. A real player under fire will land under that.

So the plan's four seconds stayed, and the tuning moved one line down. Both constants are
at the top of `js/world.js`, and `test.mjs` asserts whatever the window is set to.

**Endless or authored?** Unresolved, and deliberately: waves 1–20 are authored only in
the sense that the generator is seeded per wave. If twenty is more than the game needs,
nothing has to be deleted — the curve is two lines in `state.js`.
