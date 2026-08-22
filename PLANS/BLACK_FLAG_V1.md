# Black Flag — v1 plan

A browser game. You are the Jackdaw, alone at the bottom of the screen, sailing north
into a Spanish fleet that never stops coming down. Same skeleton as `oddish`: vanilla ES
modules, no build step, a fixed 390×844 stage, stacked canvases, a pure model that
`node test.mjs` can import.

---

## 1. The loop, in one paragraph

The sea scrolls down. You steer left and right along the bottom third. Your bow chasers
fire on their own, so one finger is enough. Spanish ships descend in formations — some
ram, some shoot, some fire broadsides across a whole lane. Touching one hurts. **Except**
when you have shot it below a quarter of its hull: then it strikes its colours, a white
flag runs up, and for about four seconds it is not an obstacle but a prize — ram it to
board it, and take double plunder plus a hull repair. Ignore it and it drifts off the
bottom. Sink it instead of boarding it and you get the base coin but your notoriety
climbs, and notoriety is what decides how hard the next ninety seconds are.

That is the whole game: dodge, shoot, and then decide every few seconds whether the thing
you have been avoiding is now worth chasing.

---

## 2. Why boarding is the centre

The brief was "ships come down, you dodge them, maybe you shoot them." That is a complete
game but a thin one — every object on screen means the same thing (avoid) and every
decision is the same decision (left or right).

Boarding inverts one object's meaning mid-flight. A surrendered ship is the only thing on
screen you *want* to collide with, it is on a timer, and chasing it drags you out of
position while the rest of the wave is still descending. It is also, mechanically, what
the age is actually about — a pirate's whole economy is boarding rather than sinking.
One mechanic, and it carries the theme and the risk/reward at the same time.

Everything else in this plan hangs off it: notoriety is the cost of *not* boarding,
upgrades are bought with plunder, and the hunters are the sea's answer to a captain who
sinks everything.

---

## 3. Ships

Spanish navy, drawn top-down as vector hulls — no sprites, no assets.

| Class | Hull | Speed | Behaviour | Reales |
|---|---|---|---|---|
| **Lancha** (gunboat) | 1 | fast, weaves | rams, no guns | 25 |
| **Schooner** | 2 | fast | slides sideways, single aimed shot | 50 |
| **Brig** | 4 | medium | two-shot spread, holds its lane | 120 |
| **Frigate** | 8 | slow | turns broadside and fires a five-shot wall | 300 |
| **Man-o-war** | 16 | very slow | mortar volleys with telegraphed splash rings, plus broadsides | 800 |
| **Brulote** (fire ship) | 1 | accelerates toward you | explodes in a radius on contact or death | 0 |

The brulote is the exception that keeps the rule honest: it is the one ship you must
never let reach you, and it never surrenders.

**Legendary ships** every fifth wave — *El Impoluto*, *La Dama Negra*, *HMS Prince*,
*La Fortuna*. Screen-wide, two or three phases, gun ports as weak points, and they do not
strike their colours. They also do not stay dead: each one you beat is logged in the
captain's log and returns in the endless run.

## 4. Damage — two layers

- **Hull** — a bar. Every hit takes from it. Repaired by boarding, by rum barrels, and at
  port between waves.
- **Lives** — three hearts. Hull reaching zero costs a life; the Jackdaw is refit at full
  hull with two seconds of invulnerability, the screen goes white and the swell resets.

Both, rather than one, because the bar makes the moment-to-moment legible and the hearts
make the run legible.

## 5. Notoriety — the difficulty dial the player holds

Five flags. Rises when you sink a ship that had already surrendered, and slowly with time
in a wave. Falls when you board, and at port when you bribe the harbourmaster (costs
plunder).

- **3 flags** — hunter frigates enter from the sides and pursue rather than descend.
- **5 flags** — a legendary ship comes for you early, out of schedule.

The player sets their own difficulty by how greedy and how brutal they are, and never
through a menu.

## 6. Weapons and drops

**Round shot** — always firing, forward. Rate and damage upgrade at port.
**Mortar** — Space, or the button bottom-right. Arcs to the top third, lands in a
telegraphed ring, area damage. Limited shells.
**Board** — ram a surrendered ship.

Crates and barrels float down from wrecks:

| Drop | Effect |
|---|---|
| Rum barrel | +hull |
| Powder keg | fire rate ↑, 12s |
| Heavy shot | shots pierce, ×2 damage, 12s |
| Chain shot | wide slow shots that shred masts — crowd clear, 12s |
| Shells | +3 mortar |
| Swivel crew | two angled auto-cannons for the rest of the wave |

## 7. The sea itself

- **Reefs** — static rock scrolling down. Damages on contact, and blocks shot from both
  sides, so it is cover as well as hazard.
- **Storm** every fourth wave — rain, lightning, and a swell that pushes your ship
  sideways on a slow sine you have to steer against.
- **Fog bank** — enemies fade in late and close.
- **Waterspout** in late waves — a slow pull toward its centre.

## 8. Between waves — Nassau

Docking after each wave opens the port screen: spend plunder on hull plating, broadside
power, mortar racks, ram strength, an extra life, or a bribe to drop notoriety. Upgrades
are **per run** — a run is a run. What persists across runs is the record book and the
captain's log of ships you have met.

## 9. Screens

Hash routes, `oddish`'s router verbatim.

| Route | |
|---|---|
| `#/` | Title — the Jackdaw at anchor, sails luffing |
| `#/play` | The game; HUD overlays the canvas |
| `#/port` | Careening at Nassau — upgrades |
| `#/dead` | Run summary — sunk, boarded, plunder, deepest wave |
| `#/records` | Best run, most plunder, longest survival |
| `#/log` | Captain's log — bestiary of every class and legendary met |
| `#/menu` | Sound, haptics, reduced motion |
| `#/pause` | Pause |

## 10. Presentation

Three stacked 2D canvases, everything procedural:

1. **`#sea`** — sky gradient per weather, a horizon with distant islands, layered sine
   swell bands with foam crests, your wake, rain.
2. **`#fleet`** — hulls as vector outlines with decks, masts, billowing sails on a small
   sine, gun ports that flash when they fire, flags. Damage shows: scorch, a snapped mast,
   a list to one side, and the white flag on surrender.
3. **`#fx`** — splashes, smoke, splinters, debris, the boarding flash, screen shake.

**One deliberate departure from oddish: no WebGL.** oddish went raw WebGL because a
creature is geometry. A top-down naval battle is flat painting, which is exactly what
oddish's own world and overlay layers already are. Same discipline, one fewer moving part,
and no "this device can't draw 3D" dead end.

d3 stays, from the same CDN import map, for the parts it is good at: `d3.timer` as the
frame clock, `quantize(interpolateLab(...))` ramps for sea depth and sail shading,
the easings.

**Audio** — synthesised, zero assets, like oddish's drone. Cannon is a noise burst through
a lowpass with a fast decay over a pitched thump; the sea is filtered brown noise; a
minor-key shanty arpeggio runs underneath and picks up tempo as notoriety climbs.

## 11. Controls

- **Touch** — drag anywhere to steer, the ship eases toward your finger's x. Mortar button
  bottom-right. Fire is automatic.
- **Keyboard** — ←/→ or A/D, Space for mortar, Esc to pause.
- **Mouse** — move to steer, click for mortar.
- **Reduced motion** — no shake, no lightning, particle count cut, storm drift halved.

## 12. Files

```
black-flag/
  index.html      stage, three canvases, import map
  css/app.css     tokens (parchment, ink, gold, sea), HUD, sheets, grain, vignette
  js/state.js     pure — RNG, ship classes, wave table, difficulty curve, notoriety
                  rules, upgrade costs, records persistence. No DOM, no d3.
  js/world.js     pure — spawn() and step(world, dt, input). Entities, collision,
                  damage, surrender, boarding, drops. No canvas anywhere.
  js/render.js    paints a world snapshot: sea, fleet, shot, fx, weather
  js/audio.js     synthesised cannons, sea, shanty
  js/screens.js   title, port, dead, records, log, menu, pause, and the HUD
  js/app.js       router, boot, input, frame loop, desktop clamp
  test.mjs        the self-check
  README.md       what it is, how to run, departures, what isn't built
```

**The one structural change from oddish.** oddish keeps its whole model in `state.js`.
Here the simulation is big enough to want its own file, and splitting it buys something
concrete: `world.js` has no canvas, no DOM and no clock of its own, so `test.mjs` can run
a headless sixty-second battle at a fixed timestep and assert real things — that the wave
curve escalates monotonically, that a surrendered ship stays boardable for exactly its
window and not a frame longer, that hull never goes negative, that a fixed seed produces a
byte-identical run.

## 13. Order of work

1. **Skeleton and sea** — stage, tokens, the loop, the scrolling ocean, a ship you can
   steer with a wake behind it. Nothing to shoot. Ship it when steering feels good.
2. **Combat** — round shot, the six classes, enemy fire, explosions, hull and lives, the
   wave table, game over.
3. **The Black Flag layer** — surrender, boarding, plunder, notoriety, hunters.
4. **Depth** — mortar, drops, reefs, weather, the four legendary ships.
5. **The shell** — title, port, records, captain's log, menu, audio, reduced motion,
   `test.mjs`, README.

Each stage is playable on its own, which is the point of the order.

## 14. Open questions

- **Is auto-fire right?** It makes one-finger play work and keeps the decision on
  movement, where the game is. A hold-to-fire variant is one line if it plays better.
- **Does the four-second surrender window survive contact with a real player?** It is the
  single number the whole risk/reward hangs on and it will need tuning against the wave
  density, not reasoning.
- **Endless or authored?** Waves 1–20 authored, then a seeded endless mode. Twenty
  authored waves may be more than the game needs.
