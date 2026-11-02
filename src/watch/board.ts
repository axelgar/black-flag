// What the bar's screen says down its side: who is on a streak, and what just happened.
// Captains only: the bots make up the numbers on the water, but the room is watching the
// people in it.

import { markOf } from '../data/colors';
import { TUNING as T } from '../data/tuning';
import type { Seat } from '../net/protocol';
import type { GameEvent, World } from '../sim/types';

export interface Standing { id: number; name: string; c: number; streak: number; wanted: boolean }

/** The captains aboard on a streak, longest first, then by name. */
export function standings(w: World | null, seats: Seat[], most = 5): Standing[] {
  if (!w) return [];
  return seats
    .filter((s) => !s.left && !s.bot && (w.ships[s.id]?.streak ?? 0) > 0)
    .map((s) => { const n = w.ships[s.id].streak; return { id: s.id, name: s.name, c: s.c, streak: n, wanted: n >= T.wanted }; })
    .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name))
    .slice(0, most);
}

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

/** A name, after a dot in her colour: white reads best across a room. */
export const named = (seats: Seat[], id: number) => {
  const s = seats.find((x) => x.id === id && !x.left);
  const m = markOf(s && s.c >= 0 ? s.c : 0);
  return `<i class="dot${m.dashed ? ' dashed' : ''}" style="--c:${m.color}"></i><b>${esc(s?.name || '?')}</b>`;
};

export interface Said {
  html: string;
  /** Said across the chart too, big: a free shot won. Plain text. */
  big?: string;
}

/** What the room hears of an event, or null. A sinking only when a captain is in it; a
 *  bot's five in a row not at all. */
export function feedLine(e: GameEvent, seats: Seat[]): Said | null {
  const seat = (id: unknown) => seats.find((s) => s.id === id && !s.left);
  const captain = (id: unknown) => { const s = seat(id); return !!s && !s.bot; };
  switch (e.k) {
    case 'sunk': {
      if (typeof e.by !== 'number' || !(captain(e.by) || captain(e.p))) return null;
      return { html: `${named(seats, e.by)} sank ${named(seats, e.p as number)}` };
    }
    case 'streak':
      if (e.n !== T.wanted || !captain(e.p)) return null;
      return { html: `${named(seats, e.p as number)} is <span class="wanted">WANTED</span>: one more wins` };
    case 'won': {
      if (!captain(e.p)) return null;
      const name = seat(e.p)!.name;
      return e.prize
        ? { html: `${named(seats, e.p as number)} won a free shot! 🥃`, big: `${name} won a free shot!` }
        : { html: `${named(seats, e.p as number)} sank five in a row!`, big: `${name} sank five in a row!` };
    }
    case 'joined':
      if (e.bot || !captain(e.p)) return null;
      return { html: `${named(seats, e.p as number)} set sail` };
    default:
      return null;
  }
}
