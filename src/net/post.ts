// What the sea sends one phone, and when. A snapshot is sent to every phone as it comes,
// but to one whose line has fallen behind: one that says, in the hands it sends, that the
// newest snapshot it has heard is more than BACKED_UP seconds old. Sending it more would
// only queue on its line, and every snapshot after would come later still, until the sea
// on its screen was seconds behind. So it is sent nothing until it catches up, and then the
// newest snapshot with everything it missed: the balls fired and the balls ended, and what
// happened. A ship is only ever where she is now, so the rest is the newest's. While it is
// behind it is still sent one now and then, so a phone that went quiet (a screen locked a
// moment, a tab put away) hears something new to say it has heard, and is sent all again.
//
// A phone that never says what it has heard (one from before it could) is sent everything.

import type { Snap } from './protocol';

/** Seconds old the newest snapshot a phone has heard may be before it is sent no more. */
export const BACKED_UP = 1.5;

export class Post {
  /** The sea's clock at the newest snapshot the phone says it has heard; -1 until it says. */
  private heard = -1;
  /** What the phone was not sent, to go with the next it is. */
  private owed: Pick<Snap, 's' | 'sx' | 'e'> | null = null;
  /** The sea's clock at the last snapshot sent. */
  private sent = -Infinity;

  constructor(private send: (s: string) => void) {}

  /** The phone's word on what it has heard: `k` from its hands. */
  hear(k: unknown) {
    if (typeof k === 'number' && Number.isFinite(k) && k > this.heard) this.heard = k;
  }

  /**
   * A snapshot for this phone, and what it alone is sent with it (see mine()). `head` is the
   * snapshot as written for everyone, less its closing brace: written once, it is finished
   * phone by phone.
   */
  snap(m: Snap, me: number[] | null, head: string) {
    if (this.heard >= 0 && m.ck - this.heard > BACKED_UP && m.ck - this.sent < BACKED_UP) {
      const o = (this.owed ??= { s: [], sx: [], e: [] });
      o.s.push(...m.s); o.sx.push(...m.sx); o.e.push(...m.e);
      return;
    }
    this.sent = m.ck;
    const tail = `,"me":${JSON.stringify(me)}}`;
    if (!this.owed) { this.send(head + tail); return; }
    const o = this.owed;
    this.owed = null;
    const all = JSON.stringify({ ...m, s: [...o.s, ...m.s], sx: [...o.sx, ...m.sx], e: [...o.e, ...m.e] });
    this.send(all.slice(0, -1) + tail);
  }
}
