# Black Flag — your own ship, at once

Planned 17 October 2026. On a shared sea the phone moves your ship the moment you steer,
instead of waiting for the server to say she moved. Everything else on the sea is drawn
as it is now.

## Now

The phone never steps a shared sea (`src/net/protocol.ts`, the Mirror). A turn of the
stick only shows once it has made the round trip:

| step | time |
|---|---|
| the helm waits for its next send (`HELM_EVERY`) | 0–50ms |
| the phone to the sea | half the round trip |
| the sea's next beat reads it | 0–33ms |
| the next snapshot | 0–67ms |
| the sea back to the phone | half the round trip |
| the phone draws a moment behind (`Mirror.delay`) | 70–170ms |

That's about 150ms on quiet wifi and 250ms or more on a busy one. Players feel it as a
heavy, slow helm, and with thirty rivals aiming at each other it's the delay they'll
blame.

## Why it can be done here

The ship's motion is nearly all known to the phone already:

- `helm()` in `src/sim/sailing.ts` is the same arithmetic for every ship. On a shared sea
  every ship sails her own numbers, with no Nassau upgrades, and the phone has them from
  her ship id.
- The land, reefs and rim are the chart's, rebuilt from its seed on the phone. A
  grounding comes out the same on both.
- The storm's set is a function of the world's clock. The waterspouts are in every
  snapshot.
- The things the phone can't know exactly are bumps with other ships (it sees them a
  moment late) and anything the server does to her: a ram, going down, being put back
  afloat. Those are corrected, smoothly, when the server's word arrives.

## How

Client-side prediction with server reconciliation, fitted to how the sea reads the helm
(the newest helm it has heard, every tick until the next one).

**The wire (WIRE 3).**
- Each helm message gets a number, `n`, counting up.
- The phone's own row (`me`, already per-phone) adds which helm the sea is sailing her by
  (`n`), how many ticks it has sailed by it, and her own state finely: x, y, heading,
  way, canvas, the rim flag, and the ground and ram cooldowns. That's about 60 bytes, to
  one phone only.

**The sea (`src/net/sea.ts`).** Records `n` and the ticks it has applied per hand.
Optionally it reads a helm from the tick it arrived in, not the next beat, which takes
the beat's 0–33ms of jitter out.

**The sim (`src/sim/world.ts`).** `sail()` gets a quiet mode that moves the ship exactly
as it does now but skips the wounds and events, and is exported. The same goes for the
hull-to-hull part of `hulls()`, for one ship. The eight recorded battles must still
replay byte for byte.

**The phone (new `src/net/lead.ts`, used by the Link).**
- It keeps its own copy of your ship and steps it at the sim's own 1/120s, with the helm
  it last *sent*, the same helm the sea will sail her by. It records every step: which
  helm, and her state after it.
- On each snapshot, it starts from the sea's state of her and skips the ticks of helm `n`
  the sea has already sailed. Then it sails on through every step the phone has taken
  since, with the same helms, up to now. That is about 20–40 ticks of one ship, 15 times
  a second, which is cheap.
- If the replay lands somewhere other than where she is drawn, the difference is kept as
  an offset and eased away over about a fifth of a second. She jumps straight to her
  place only when she has been put back afloat, a new chart starts, or she is more than
  about 15m off.
- Other ships, for bumping into, are slid forward to now along their heading. When the
  guess is wrong, the correction eases it.
- Not predicted: anything while she's out or the sea is in a lobby or at the results.
  The sea's word is drawn as it is now.
- After `mirror.frame()`, the Link writes the predicted ship over the mirror's copy, so
  the view, camera, HUD, minimap and sound all read her there without changes.

**Your guns (same change, smaller).**
- Your own balls are drawn in your own ship's time, not the sea's past, or they'd seem to
  leave from behind her. A ball's row gets who fired it, and the phone draws your own
  ones the prediction's lead further on.
- A press on a loaded side plays its smoke and sound at once, from the predicted ship.
  The sea's own broadside event for that press is then not played a second time.
  "Loaded" comes from `me.cool`, which the phone already has. A wrong guess is rare: a
  press on the same frame as going down.

## Steps

1. The sim's quiet `sail()`, plus a one-ship `hulls()`. The replay tests pass unchanged.
   About 2h.
2. Wire 3: helm numbers, and the own row's new fields. Sea and server. About 2h.
3. `lead.ts`: steps, records, replays, smoothing, and when to jump instead. Tests first
   (below). About 4h.
4. Into the Link and `main.ts`: step it every frame, and send the helm it steps by. About
   2h.
5. Your own balls in your own time, and guns that answer at once. About 3h.
6. Measure: the jitter simulation, `sea:load` with prediction, a browser, then phones.
   README. About 3h.

That's about two days of work.

## How we'll know it works

- **Tests.** A helm change moves the predicted ship on the very next tick. With the
  helm sent instantly, the prediction equals the sea's ship exactly. With 40±20ms each
  way and 15 snapshots a second, a zig-zag on open water is corrected by less than 0.3m
  on average and less than 1m at the 99th percentile. A grounding is predicted where the
  sea has it. Being put back afloat jumps her to her berth. The eight recorded battles
  replay byte for byte.
- **`npm run sea:load -- 30`** reports how far each bot's prediction was corrected
  (mean, p99, max) on a real local server.
- **On phones.** The ship answers the stick with no delay you can feel. No visible
  rubber-banding, except a soft one when you bump another captain.

## Open

- **Hits on ships drawn in the past.** Your ship and your balls are now. Every other
  ship is still drawn about 0.1–0.2s in the past, so a ball that hits one may look like
  it hit just behind her. Games like this usually accept that. If it reads wrong at the
  table, the fix is to draw the target ships nearer to now too, at the cost of more
  correction on them.
