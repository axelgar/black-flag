# Black Flag — the bar's screen

Planned 18 October 2026. A page for the TV or projector at the bar that shows the whole of
the bar's sea from high above, live: every ship, every broadside, and each captain with a
colored ring on the water round her and her name over it. Beside it are the standings and
the round clock. Only someone holding the watch key can open it.

## Now

- The sea only sends to a socket that has come aboard with a Supabase token and a ship
  (`server/src/index.ts`, `hear()`). There is no way to look on without taking one of the
  thirty seats.
- Everything the screen needs already goes down the wire to every phone: the roster has
  each captain's name, the round has the standings, and the snapshot has every ship.
  A look-on socket gets the same messages with no `me` on the end.
- The view has one camera at sea, the chase, and everything it draws at sea assumes a
  ship of your own (`you(w)` in `src/render/view.ts`). Fog closes in at 1500m on a clear
  day and 330m in fog, and the shadows cover 220m. The chart is 1800m across.

## How

**The key.** A secret on the sea's server, `WATCH_KEY`: `npx wrangler secret put
WATCH_KEY` for the live seas, `server/.dev.vars` on this machine (added to `.gitignore`).
With no key set, nobody can watch.
- The page asks for it once. It goes up as the first message on the socket, never in a
  URL, so it stays out of Cloudflare's request logs and the browser's history. When the
  key is right, the TV keeps it in localStorage and comes straight back to the sea after
  a reload or a power cut.
- The server compares the key in constant time (`crypto.subtle.timingSafeEqual`, both
  sides hashed to the same length first). A wrong key gets `nope` with `why: 'key'` after
  a second's pause, and the socket closes.
- There is no lockout, so the key's length is the defence: make it a passphrase of 16
  characters or more. To change it, put a new secret. Every screen is asked again the
  next time it connects.
- The page's code ships in the public bundle, and that's fine: the sea itself refuses to
  stream to a socket without the key.

**The wire.** Everything is added, nothing changes, so `WIRE` stays at 2 and phones
already at the bar are unaffected.
- phone → sea: `{ t: 'watch', v, key }`.
- `Welcome` gets `watch: true`, and `Nope['why']` gets `'key'`.
- Each roster seat gets `c`, the captain's color (see below).

**The sea's server (`server/src/index.ts`).**
- Watchers are kept in their own set, apart from the seats. A watcher takes no seat,
  doesn't count toward the thirty, doesn't open a sea and doesn't keep the beat going. An
  empty sea stays asleep while a TV looks at it. At most four watchers to a sea.
- On a watcher's hello: check the version and the key, then send welcome, and the
  roster and round if the sea has a world.
- `beat()` sends watchers the roster, the round and every snapshot. A watcher's copy is
  the shared string as it is, with no `me`.
- When the last captain goes ashore, the sea sends one round with nobody in it, so the
  screen knows to show an empty sea. That goes in `Sea.step()`, which can be tested.

**Colors (`src/net/sea.ts`, `src/data/colors.ts`).** Built with seven colors, not twelve.
Searched for in OKLab and checked every pair against every other, seven is as many as stay
clearly apart on the water, to normal and colour-blind eyes, once the Spanish red, the shell
and cargo gold, the prize cream and the shallows are kept clear. Past seven, pairs start to
look the same. Each comes as a solid ring and a turning dashed one, so there are fourteen
marks. The sea hands them out, so a captain keeps hers all night and her phone can know it
too:
- If the mark she had earlier tonight is free, she gets it back. Otherwise she gets the
  lowest one nobody aboard is using. Past fourteen aboard, marks repeat, least-used first,
  and her name tells her apart.
- It lasts as long as the sea's object stays up, which is a night. A restart deals them
  again.

**The page.** `/watch` (a `vercel.json` rewrite like `/u/:code`, turned into `#/watch`
at boot), with no button to it anywhere in the game.
- On this route the page never signs in. `connect()` would make an anonymous player for
  the TV.
- New file `src/net/watch.ts`, a `Watch`: the Link without a helm. It keeps a `Mirror`
  (`roster(r, '')` is enough, since there's no `me`), and tries again for ever, waiting
  at most 10s between tries, because a TV has nobody to press retry. When the server says
  `version` (a deploy), it reloads the page.
- To run unattended, it holds a screen wake lock, goes full screen on the first click or
  F, hides the cursor when idle, and reloads itself once a night at 6am.
- Sound is off. S turns on a quiet sea with distant guns.

**The view: a `watch` mode (`src/render/view.ts`).**
- The camera looks down at about 65° from the south, so Nassau's harbour mouth faces the
  room. It uses a narrow lens from further back so the far side of the chart isn't
  squashed, and it fits the whole disc to the screen's height. On a 16:9 TV that leaves
  the right third for the standings. It drifts a few degrees over minutes, which keeps
  the picture alive and saves the TV from burn-in.
- Fog is pushed out past the chart. Fog weather becomes a haze, not a wall, and a storm
  keeps its dark and its rain. Shadows cover the chart or are switched off, whichever
  looks better in the screenshots.
- Every captain is drawn the way other captains are drawn now. Everything done for your
  own ship is off: the chase, the broadside fans, the mortar reticle, your rings and the
  beacon.
- It paints at 30fps. From that high nothing moves fast enough to need more, and it halves
  the load on whatever drives the TV.

**Rings and names.**
- A ring on the water round each captain, in her color, from the ring shader in
  `markers.ts`. It's sized to stay about the same on screen as the camera drifts, and
  never smaller than her hull. While she's down, the ring dims and its arc counts the five
  seconds until she's afloat again.
- Her name over her, in her color, in type you can read across a bar (about 1.8% of the
  screen's height). Placement is greedy, leader first: a name that would cover another
  moves to the side, and if there's still no room it becomes a colored dot with her
  initials. In the lobby, captains sit in lines 60m apart, which is too tight for names,
  so the names are in the side list then.
- The Spanish get no rings. A legend gets her name, as she does in the HUD.

**What's around the sea.** The overlay is built for 16:9, and checked at 1080p and 4K.
- Top left: `THE BAR'S SEA · RIVALS · ROUND 4 · 6:12`.
- Right: the standings, with rank, a color swatch, captain, ship and plunder. As many
  rows as fit, then "and 12 more".
- Bottom left: the last four sinkings, from the `toll` events, e.g. `RED JACK SANK SALT
  NELL · +120`.
- A corner: "Scan to join", a QR code to the game. `qrcode` is loaded only on this page,
  so the game itself doesn't grow.
- The lobby shows a big countdown and who's aboard. The results show the winner big, then
  the whole board. An empty sea shows the harbour from the title screen, slowly orbiting,
  with "The bar's sea is quiet" and the QR code large.

**More than one sea.** A busy night opens the bar's sea 2 when sea 1 is full.
- The page checks sea n+1 only while sea n is full, or if sea n+1 had captains the last
  time it looked. It checks once a minute with a watch socket that reads the round and
  closes. On a normal night it never checks.
- With two seas live, the screen switches between them every minute. Chips at the top,
  or the keys 1–9, hold it on one.

**On the phone (small).** In the lobby list, a dot in your color by your name, so a guest
knows which ring on the TV is theirs.

## Steps

1. The server: the key, watchers, the empty-sea round, colors in `Sea`. Tests for colors
   and the empty round. `sea:load -- --watch` checks a watcher gets snapshots with no
   `me`, that a wrong key is turned away, and that thirty bots and a watcher are all
   aboard. Deploy it before the page. About 3h.
2. The page's plumbing: the route, no sign-in, the key form, `Watch`, wake lock, full
   screen, nightly reload. About 2h.
3. The view's `watch` mode: camera, fog, shadows, every captain drawn as another's, 30fps.
   About 4h.
4. Rings and names, with the placement and the countdown while down. About 3h.
5. The overlay in every stage, the QR code, the second sea. About 4h.
6. The phone's color dot. About 1h.
7. Look and measure: tune the palette on the water, take screenshots in every weather and
   every stage with 30 bots aboard, check fps on the machine that will drive the TV, and
   update the README. About 3h.

That's about two and a half days.

## How we'll know it works

- **Tests.** Twelve captains aboard get twelve different colors. One who leaves and comes
  back keeps hers, if it's free. The thirteenth gets the least-used color. An empty sea
  says so once. The rounds and replays already tested pass unchanged.
- **`npm run sea:load -- 30 --watch`.** Thirty of thirty aboard, plus a watcher drawing
  as smoothly as a phone. A wrong key gets nothing.
- **On the TV.** From across the room you can read every name and pick out your ship by
  her color, and the picture holds a steady 30fps through a full sea's broadsides.

## Decided

- **Live plunder.** Phones hide the plunder until the results (`seaTick()`), which keeps
  the suspense. The screen shows it live: a race to watch is what a bar TV is for.
- **The machine behind the TV** is a laptop running Chrome over HDMI, so the screen uses
  the laptop's own quality tier.

## Open

- **A close-up.** A small picture of the leader, or of the biggest fight, would put
  ships at full size on the screen too. Later, if the whole sea reads too small.
- **Table seas.** Not planned. The server side would work for them unchanged; only the
  page's switcher is limited to the bar's seas.
