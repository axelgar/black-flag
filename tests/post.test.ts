// What the sea sends one phone: every snapshot while it keeps up, nothing but now and then
// once its line has fallen behind, and everything it missed when it has caught up.

import { describe, expect, it } from 'vitest';
import { BACKED_UP, Post } from '../src/net/post';
import type { Snap } from '../src/net/protocol';
import type { GameEvent } from '../src/sim/types';

const EVERY = 1 / 15;

/** The sea's snapshot number `i`: a ball fired in each, and something happened. */
const snap = (i: number): Snap => ({
  t: 's', at: i * EVERY, ck: i * EVERY, R: 300,
  p: [[0, i, 0, 0, 0, 0, 1, 100, 0, 0, 0, 0]],
  s: [[i, 0, 0, 1, 0, i * EVERY, 1, 0, 0]], sx: i % 3 ? [] : [[i - 1, i * EVERY]], c: [],
  e: [{ k: 'volley', p: 0, at: i * EVERY } as GameEvent],
});

/** A phone's post, and what it was sent, as the snapshots it reads. */
function phone() {
  const got: Snap[] = [];
  const post = new Post((s) => got.push(JSON.parse(s)));
  const send = (i: number) => { const m = snap(i), s = JSON.stringify(m); post.snap(m, [i], s.slice(0, -1)); };
  return { post, got, send };
}

describe('what the sea sends one phone', () => {
  it('sends every snapshot to a phone that keeps up, with its own row', () => {
    const { post, got, send } = phone();
    for (let i = 0; i < 60; i++) { send(i); if (i > 2) post.hear((i - 2) * EVERY); }
    expect(got).toHaveLength(60);
    expect(got[10].me).toEqual([10]);
  });

  it('sends everything to a phone that never says what it has heard', () => {
    const { got, send } = phone();
    for (let i = 0; i < 120; i++) send(i);
    expect(got).toHaveLength(120);
  });

  it('holds back a phone that has fallen behind, then sends it all it missed', () => {
    const { post, got, send } = phone();
    post.hear(0);
    // BACKED_UP seconds' worth go; then nothing, since nothing new is heard
    const kept = Math.floor(BACKED_UP / EVERY) + 1, n = kept + 10;
    for (let i = 0; i < n; i++) send(i);
    expect(got).toHaveLength(kept);
    post.hear(got[got.length - 1].ck);
    send(n);
    const last = got[got.length - 1];
    expect(last.ck).toBeCloseTo(n * EVERY);
    expect(last.p[0][1]).toBe(n);                  // ships as they are now
    expect(last.me).toEqual([n]);
    // every ball fired, every ball ended, and everything that happened, none twice
    const all = [...Array(n + 1).keys()];
    expect(got.flatMap((m) => m.s.map((b) => b[0]))).toEqual(all);
    expect(got.flatMap((m) => m.e)).toHaveLength(n + 1);
    expect(got.flatMap((m) => m.sx.map((b) => b[0]))).toEqual(all.filter((i) => i % 3 === 0).map((i) => i - 1));
  });

  it('sends a phone that has gone quiet one now and then, so it can say it is back', () => {
    const { post, got, send } = phone();
    post.hear(0);
    for (let i = 0; i < 15 * 10; i++) send(i);
    const quiet = got.filter((m) => m.ck > BACKED_UP);
    expect(quiet.length).toBeGreaterThan(4);
    expect(quiet.length).toBeLessThan(10);
    // and one heard, it is sent all again
    post.hear(got[got.length - 1].ck);
    const had = got.length;
    for (let i = 150; i < 160; i++) send(i);
    expect(got.length - had).toBe(10);
  });
});
