// Your own ship, stepped ahead of the sea: a sea and a phone with wifi between them, made
// here with no sockets. The phone steps its ship by the hands it sends; the sea's word
// comes back late and jittery, and each time it does the phone's ship should already be
// nearly where the sea's word, sailed on, puts her.

import { describe, expect, it } from 'vitest';
import { rng } from '../src/core/rng';
import { FIXED, Lead } from '../src/net/lead';
import { Mirror, type Helm, type Roster, type Snap } from '../src/net/protocol';
import { Sea } from '../src/net/sea';
import { onLand } from '../src/sim/map';
import type { Input } from '../src/sim/types';

const BEAT = 1 / 30, FRAME = 1 / 60;

interface Wifi { ms: number; jitter: number }

/** A night's few seconds: the sea and one phone, `steer` saying where the thumb is. */
function sail(seconds: number, wifi: Wifi, steer: (t: number) => Input['move'], seed = 'lead') {
  const sea = new Sea('BAR1', { seed });
  sea.join({ seat: 'me', name: 'Me', look: 'jackdaw' });
  // put her in open water in the middle, with every other ship well away
  const s = sea.world.ships[0];
  const r = rng(seed);
  for (let i = 0; i < 200; i++) {
    const x = (r() - 0.5) * 200, y = (r() - 0.5) * 200;
    if ([-40, 0, 40].every((dx) => [-40, 0, 40].every((dy) => !onLand(sea.world.map, x + dx, y + dy)))) { Object.assign(s, { x, y }); break; }
  }
  for (const o of sea.world.ships) if (o !== s) Object.assign(o, { x: 5000, y: 5000, out: true, down: -1e9 });

  const mirror = new Mirror(), lead = new Lead();
  const net = rng(`${seed}:wifi`);
  const late = () => Math.max(0.002, (wifi.ms + (net() * 2 - 1) * wifi.jitter) / 1000);
  // what is on the wire, with when it lands; each way keeps its order, as a socket does
  const up: { at: number; m: Helm }[] = [], down: { at: number; m: Roster | Snap }[] = [];
  let lastUp = 0, lastDown = 0;
  let n = 0, sent = '', move: Input['move'] = null;
  let t = 0, nextBeat = 0;
  const firstTick: number[] = [];       // how many ticks after a change the drawn heading moved

  while (t < seconds) {
    t += FRAME;
    // the sea's beats that fall in this frame
    while (nextBeat <= t) {
      while (up.length && up[0].at <= nextBeat) sea.helm('me', up.shift()!.m);
      for (const m of sea.step(BEAT)) {
        lastDown = Math.max(lastDown, nextBeat + late());
        down.push({ at: lastDown, m: m.t === 's' ? { ...m, me: sea.own('me') } : m });
      }
      nextBeat += BEAT;
    }
    // what has come in
    while (down.length && down[0].at <= t) {
      const m = down.shift()!.m;
      if (m.t === 'roster') { mirror.roster(m, 'me'); continue; }
      mirror.push(m, t);
      const w = mirror.world!;
      if (m.me) lead.hear({ map: w.map, R: m.R, focus: w.focus }, m.me, false);
    }
    mirror.frame(t);      // each paint, as the phone does: it brings the sea's radius with it
    // the thumb, and what goes up
    const want = steer(t);
    const body = JSON.stringify(want ? [Math.round(want.x * 100) / 100, Math.round(want.y * 100) / 100] : null);
    if (body !== sent) {
      n++; sent = body;
      move = want ? { x: Math.round(want.x * 100) / 100, y: Math.round(want.y * 100) / 100 } : null;
      lastUp = Math.max(lastUp, t + late());
      up.push({ at: lastUp, m: { t: 'in', n, m: move ? [move.x, move.y] : null, f: 0, fa: 0, a: 0 } });
      if (lead.ship) {
        const h0 = lead.ship.h;
        const w = mirror.world!;
        lead.advance({ map: w.map, R: w.R }, FIXED, n, move);
        firstTick.push(Math.abs(lead.ship.h - h0));
        lead.advance({ map: w.map, R: w.R }, FRAME - FIXED, n, move);
        continue;
      }
    }
    const w = mirror.world;
    if (w) lead.advance({ map: w.map, R: w.R }, FRAME, n, move);
  }
  return { sea, lead, firstTick };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / (s.length || 1), p99: s[Math.floor((s.length - 1) * 0.99)] ?? 0, n: s.length };
};

/** A zig-zag: hard over one way, then the other, twice a second, at full sail. */
const zigzag = (t: number) => ({ x: Math.cos(Math.floor(t * 2) % 2 ? 0.9 : -0.9), y: Math.sin(Math.floor(t * 2) % 2 ? 0.9 : -0.9) });

describe('your own ship, at once', () => {
  it('answers a change of the stick on the very next tick', () => {
    const { firstTick } = sail(4, { ms: 40, jitter: 20 }, zigzag);
    expect(firstTick.length).toBeGreaterThan(4);
    for (const d of firstTick) expect(d).toBeGreaterThan(0);
  });

  it('on a steady course, is where the sea puts her, to the millimetre', () => {
    const { lead } = sail(4, { ms: 40, jitter: 20 }, () => ({ x: 0.7, y: -0.7 }));
    const c = stats(lead.corrections.slice(10));
    expect(c.n).toBeGreaterThan(40);
    expect(c.p99).toBeLessThan(0.01);
  });

  it('zig-zagging over bar wifi, is put right by less than 0.3 m on average and 1 m nearly always', () => {
    const { lead } = sail(12, { ms: 40, jitter: 20 }, zigzag);
    const c = stats(lead.corrections.slice(10));
    expect(c.n).toBeGreaterThan(150);
    expect(c.mean).toBeLessThan(0.3);
    expect(c.p99).toBeLessThan(1);
  });

  it('stays ahead of the sea by about the round trip', () => {
    const { lead } = sail(4, { ms: 60, jitter: 0 }, zigzag);
    // up 60ms, waiting for a beat, back 60ms: between 120ms and 190ms of ticks
    expect(lead.ahead * FIXED).toBeGreaterThan(0.1);
    expect(lead.ahead * FIXED).toBeLessThan(0.25);
  });

  it('jumps to her new place when she comes back into the sea, rather than gliding across it', () => {
    const l = new Lead();
    const sea = new Sea('BAR1', { seed: 'jump' });
    sea.join({ seat: 'me', name: 'Me', look: 'jackdaw' });
    const w = sea.world;
    const row = () => sea.own('me')!;
    l.hear({ map: w.map, R: w.R, focus: 0 }, row(), false);
    l.hear({ map: w.map, R: w.R, focus: 0 }, row(), true);
    expect(l.ship).toBeNull();
    Object.assign(w.ships[0], { x: w.ships[0].x + 300 });
    l.hear({ map: w.map, R: w.R, focus: 0 }, row(), false);
    expect(l.ship!.x).toBeCloseTo(w.ships[0].x, 2);
    const shown = { ...w.ships[0] };
    l.show({ ...w, ships: [shown] });
    expect(shown.x).toBeCloseTo(w.ships[0].x, 2);
  });
});
