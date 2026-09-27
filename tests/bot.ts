// A captain made of arithmetic. She knows where every ship on the chart is (the real
// player does not), runs at the nearest, circles her at gun range, fires whichever side
// bears, boards anything that strikes, and sails home when the sea is clear. Good enough
// to prove a wave can be finished and to make two replays take the same decisions.

import { wrap } from '../src/core/vec';
import { hostile, isPrize } from '../src/sim/world';
import { avoid } from '../src/sim/ai';
import type { Foe, Input, Player, World } from '../src/sim/types';

/** One captain's helm for this tick: the first captain's, unless told whose. */
export function bot(w: World, i: number, opts: { board?: boolean; mortar?: boolean } = {}, s: Player = w.players[0]): Input {
  const out = think(w, s, i, opts);
  if (out.heading != null) out.heading = avoid(w, s, out.heading);
  return out;
}

function think(w: World, s: Player, i: number, opts: { board?: boolean; mortar?: boolean }): Input {
  const board = opts.board ?? true;
  const input: Input = { heading: null, rudder: 0, sail: 1, fireL: false, fireR: false, mortar: false };

  const near = (ok: (e: Foe) => boolean) => {
    let best: Foe | null = null, bd = 1e9;
    for (const e of w.foes) if (ok(e)) { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < bd) { bd = d; best = e; } }
    return best as Foe | null;
  };

  const prize = board ? near(isPrize) : null;
  if (prize && Math.hypot(prize.x - s.x, prize.y - s.y) < 260) {
    const d = Math.hypot(prize.x - s.x, prize.y - s.y);
    input.heading = Math.atan2(prize.y - s.y, prize.x - s.x);
    input.sail = d < 50 ? 0.25 : 1;
    return input;
  }

  const t = near(hostile);
  if (t) {
    const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy);
    const b = Math.atan2(dy, dx);
    if (d > 150) input.heading = b;
    else {
      const off = wrap(b - s.h);
      const orbit = off > 0 ? 1 : -1;          // keep her on whichever side she is already on
      const corr = Math.max(-0.3, Math.min(0.9, (d - 95) / 60));
      input.heading = b - orbit * (Math.PI / 2) * (1 - corr);
    }
    const off = wrap(b - s.h);
    if (d < s.stats.range * 0.95 && Math.abs(Math.sin(off)) > 0.88) {
      if (off > 0) input.fireR = true; else input.fireL = true;
    }
    if (opts.mortar && i % 600 === 0 && s.aim?.lock) input.mortar = true;
    return input;
  }

  const h = w.map.harbour;
  input.heading = Math.atan2(h.y - s.y, h.x - s.x);
  return input;
}
