// A shared sea with no server: the room a Cloudflare Durable Object will host, sailed
// here by hand. Captains come aboard and go ashore, rounds turn over, ships go down and
// come back, and the wire carries the world to a phone's mirror and back into a World
// the renderer could draw.

import { describe, expect, it } from 'vitest';
import { wound } from '../src/sim/combat';
import * as Wo from '../src/sim/world';
import { Mirror, type Helm, type Roster, type Round, type Snap } from '../src/net/protocol';
import { BREATHER, CAP, GRACE, LOBBY, RESPAWN, RESULTS, Sea, TOLL, type Out } from '../src/net/sea';
import { shoreDist } from '../src/sim/map';
import { hullGap } from '../src/sim/sailing';
import { bot } from './bot';

const BEAT = 1 / 30;
const anne = { seat: 'anne', captain: 'Salt Anne', ship: 'jackdaw' };
const bart = { seat: 'bart', captain: 'Grim Bart', ship: 'kestrel' };
const helm = (o: Partial<Helm> = {}): Helm => ({ t: 'in', h: null, r: 0, s: 1, fl: 0, fr: 0, mo: 0, ...o });

/** Step the sea for `sec` seconds of heartbeats; everything it said, in order. With a
 *  seat, each snapshot carries that phone's own ship as the host sends it. */
function sail(sea: Sea, sec: number, as?: string): Out[] {
  const out: Out[] = [];
  for (let i = 0; i < Math.round(sec / BEAT); i++) {
    for (const o of sea.step(BEAT)) out.push(o.t === 's' && as ? { ...o, me: sea.own(as) } : o);
  }
  return out;
}
const snapsOf = (out: Out[]) => out.filter((o): o is Snap => o.t === 's');
const near = (got: number, want: number, by: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(by);
const last = <T extends Out['t']>(out: Out[], t: T) => out.filter((o) => o.t === t).pop() as Extract<Out, { t: T }> | undefined;

function aboard(mode: 'rivals' | 'crew' = 'rivals', round = 120) {
  const sea = new Sea('TEST', mode, { seed: () => 'fixed', round });
  sea.join(anne); sea.join(bart);
  sail(sea, LOBBY + 0.1);
  return sea;
}

describe('a shared sea', () => {
  it('opens with the first aboard, waits in the lobby, then sails', () => {
    const sea = new Sea('TEST', 'rivals', { seed: () => 'fixed' });
    expect(sea.join(anne)).toBeNull();
    const first = sail(sea, 1);
    const roster = last(first, 'roster')!;
    expect(roster.seats.map((s) => [s.id, s.seat, s.ship])).toEqual([[0, 'anne', 'jackdaw']]);
    expect(roster.pvp).toBe(true);
    expect(last(first, 'round')!.stage).toBe('lobby');
    const t0 = sea.world!.t;
    sail(sea, 2);
    expect(sea.world!.t).toBe(t0);                     // the lobby is a chart to look at, not a fight
    sea.join(bart);
    const out = sail(sea, LOBBY);
    expect(last(out, 'round')!.stage).toBe('sailing');
    expect(sea.world!.players.map((p) => p.seat)).toEqual(['anne', 'bart']);
    expect(sea.world!.t).toBeGreaterThan(0.5);
  });

  it('carries the world down the wire into a mirror a renderer can draw', () => {
    const sea = aboard();
    sea.world!.players[0].plunder = 150;
    sea.world!.players[1].plunder = 90;
    const out = sail(sea, 3, 'bart');
    // stop on a heartbeat that sent one, so the last snapshot is the world as it stands
    for (;;) { const o = sail(sea, BEAT, 'bart'); out.push(...o); if (o.some((x) => x.t === 's')) break; }
    const roster = last(out, 'roster') ?? sea.roster();
    const snaps = snapsOf(out);
    expect(snaps.length).toBeGreaterThan(40);                        // fifteen a second
    expect(JSON.stringify(snaps.at(-1)).length).toBeLessThan(4_000);

    const m = new Mirror();
    m.roster(roster as Roster, 'bart');
    for (const s of snaps) m.push(s, s.ck);                          // as if they arrived the moment they were sent
    const s = snaps.at(-1)!;
    m.frame(s.ck + m.delay);                                         // the moment the phone draws that last one
    const w = m.world!, real = sea.world!;
    expect(w.t).toBeCloseTo(real.t, 2);
    expect(w.focus).toBe(1);                                         // bart's phone looks through bart's eyes
    expect(Wo.you(w).shipId).toBe('kestrel');
    // to the ten centimetres the wire carries them in
    for (const p of real.players) {
      near(w.players[p.id].x, p.x, 0.06);
      near(w.players[p.id].y, p.y, 0.06);
      near(w.players[p.id].hull, p.hull, 0.06);
    }
    // his own guns, shells and takings are on his phone; anne's takings are not
    expect(Wo.you(w).plunder).toBe(90);
    expect(Wo.you(w).shells).toBe(real.players[1].shells);
    expect(Wo.you(w).cool).toEqual(real.players[1].cool);
    expect(w.players[0].plunder).toBe(0);
    expect(snaps.every((x) => x.me && x.me[3] === 90)).toBe(true);
    expect(real.foes.length).toBeGreaterThan(0);
    expect(w.foes.map((f) => f.id)).toEqual(real.foes.map((f) => f.id));
    for (const f of real.foes) {
      const g = w.foes.find((x) => x.id === f.id)!;
      expect(g).toBeDefined();
      near(g.x, f.x, 0.06);
      expect(g.state).toBe(f.state);
      expect(g.C?.id ?? g.L?.id).toBe(f.C?.id ?? f.L?.id);
    }
    expect(w.map.seed).toBe(real.map.seed);                          // the chart is rebuilt from its seed, not sent
  });

  it('sends a ball once; the phone flies it, and ends it where the sea did', () => {
    const sea = aboard('rivals');
    const w = sea.world!;
    const [a, b] = w.players;
    // anne hove to forty metres off bart's starboard beam, both out of their grace
    for (const p of [a, b]) { p.v = 0; p.invuln = 0; }
    const [sx, sy] = Wo.sideVec(b.h, 1);
    a.x = b.x + sx * 40; a.y = b.y + sy * 40; a.h = b.h;
    sea.helm('anne', helm({ s: 0 }));
    sea.helm('bart', helm({ s: 0, fr: 1 }));
    const m = new Mirror();
    m.roster(sea.roster(), 'bart');
    const snaps: Snap[] = [];
    let compared = 0;
    for (let i = 0; i < 75; i++) {
      const got = snapsOf(sail(sea, BEAT, 'bart'));
      if (!got.length) continue;
      for (const s of got) { snaps.push(s); m.push(s, s.ck); }
      // the phone drawing the moment the sea is at now: every ball where the sea has it
      const s = got.at(-1)!;
      m.frame(s.ck + m.delay);
      const phone = m.world!.shots, sea_ = w.shots;
      const flying = (sh: { age: number; life: number }) => sh.age < sh.life - 0.02;
      for (const sh of sea_.filter(flying)) expect(phone.some((p) => Math.hypot(p.x - sh.x, p.y - sh.y) < 0.3)).toBe(true);
      for (const p of phone.filter(flying)) expect(sea_.some((sh) => Math.hypot(p.x - sh.x, p.y - sh.y) < 0.3)).toBe(true);
      compared += sea_.length;
    }
    expect(compared).toBeGreaterThanOrEqual(6);                       // three balls, over a few snapshots each
    const fired = snaps.flatMap((s) => s.s.map((r) => r[0]));
    expect(fired.length).toBe(b.stats.gunsPerSide);                  // one broadside...
    expect(new Set(fired).size).toBe(fired.length);                  // ...each ball sent once
    expect(snaps.flatMap((s) => s.sx).length).toBeGreaterThan(0);    // and some ended in anne's side
    expect(a.hull).toBeLessThan(a.hullMax);
  });

  it('draws a moment behind the sea and never backwards, on wifi that comes and goes', () => {
    for (const line of ['quiet', 'crowded'] as const) {
      // a seeded wifi, in order as TCP is: most snapshots a few milliseconds behind, and on
      // the crowded one, one in twenty up to a quarter of a second late
      let r = 99;
      const rand = () => (r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const late = () => 0.004 + -Math.log(1 - rand()) * (line === 'quiet' ? 0.002 : 0.008)
        + (line === 'crowded' && rand() < 0.05 ? 0.06 + rand() * 0.19 : 0);
      // a round of twenty seconds, its scoreboard, and the next round on a new chart
      const sea = aboard('crew', 20);
      const m = new Mirror();
      m.roster(sea.roster(), 'anne');
      const wire: { at: number; o: Out }[] = [];
      const truth: { real: number; t: number; sailing: boolean }[] = [];
      let real = 0, prev = 0;
      for (let i = 0; i < 50 / BEAT; i++) {
        real += BEAT;
        for (const o of sea.step(BEAT)) { prev = Math.max(prev + 0.0001, real + late()); wire.push({ at: prev, o }); }
        truth.push({ real, t: sea.world!.t, sailing: sea.stage === 'sailing' });
      }
      const frames: { real: number; w: object; t: number; behind: number; sailing: boolean }[] = [];
      let k = 0;
      for (let f = 0.5; f < 50; f += 1 / 60) {
        while (k < wire.length && wire[k].at <= f) {
          const { at, o } = wire[k++];
          if (o.t === 'roster') m.roster(o, 'anne');
          else if (o.t === 's') m.push(o, at);
        }
        m.frame(f);
        const now = truth[Math.min(truth.length - 1, Math.floor(f / BEAT) - 1)];
        frames.push({ real: f, w: m.world!, t: m.world!.t, behind: now.t - m.world!.t, sailing: now.sailing });
      }
      let back = 0, stuck = 0, judged = 0;
      const behind: number[] = [];
      for (let i = 1; i < frames.length; i++) {
        const [p, q] = [frames[i - 1], frames[i]];
        if (q.w !== p.w) continue;                                   // a new chart starts its own clock
        if (q.t < p.t - 1e-9) back++;
        // judge only the sailing, from a second after a chart's first snapshot
        if (!q.sailing || !p.sailing || q.t < 1) continue;
        judged++;
        if (q.t - p.t < 0.25 / 60) stuck++;
        behind.push(q.behind);
      }
      const mean = behind.reduce((x, y) => x + y, 0) / behind.length;
      expect(judged).toBeGreaterThan(1000);
      expect(back).toBe(0);                                          // the picture never steps back
      expect(stuck / judged).toBeLessThan(0.02);                     // and hardly ever stands still
      if (line === 'quiet') expect(mean).toBeLessThan(0.1);          // a tenth of a second behind, at most
      else expect(mean).toBeLessThan(0.25);                          // stretched, for a crowded line
    }
  });

  it('a press on the guns fires once, however often the helm is sent', () => {
    const sea = aboard();
    const p = sea.world!.players[1];
    sea.helm('bart', helm({ fr: 1 }));
    sail(sea, 0.1);
    expect(p.cool[1]).toBeGreaterThan(0);
    const reload = p.stats.reload;
    sail(sea, reload + 0.5);                                         // the same message, again and again
    sea.helm('bart', helm({ fr: 1 }));
    sail(sea, 0.2);
    expect(p.cool[1]).toBe(0);
    sea.helm('bart', helm({ fr: 2 }));
    sail(sea, 0.1);
    expect(p.cool[1]).toBeGreaterThan(0);
  });

  it('holds thirty ships, and the thirty-first finds it full', () => {
    const sea = new Sea('TEST', 'crew');
    for (let i = 0; i < CAP; i++) expect(sea.join({ seat: `s${i}`, captain: `C${i}`, ship: 'jackdaw' })).toBeNull();
    expect(CAP).toBe(30);
    expect(sea.join({ seat: 'late', captain: 'Late', ship: 'jackdaw' })).toBe('full');
    expect(sea.join({ seat: 's3', captain: 'C3', ship: 'jackdaw' })).toBeNull();   // but a captain coming back is welcome
  });

  it('puts a full sea to sea in lines off the harbour mouth, every hull clear of the next', () => {
    const ships = ['jackdaw', 'kestrel', 'revenant', 'maree'];
    const sea = new Sea('TEST', 'rivals', { seed: () => 'fixed' });
    for (let i = 0; i < CAP; i++) sea.join({ seat: `s${i}`, captain: `C${i}`, ship: ships[i % 4] });
    sail(sea, LOBBY + 0.1);
    const w = sea.world!, st = w.map.start;
    expect(w.players).toHaveLength(CAP);
    for (const p of w.players) {
      expect(Math.hypot(p.x - st.x, p.y - st.y)).toBeLessThan(300);   // a fleet, not a line across the chart
      expect(shoreDist(w.map, p.x, p.y)).toBeGreaterThan(p.beam / 2);
    }
    for (let i = 0; i < CAP; i++) for (let j = i + 1; j < CAP; j++) expect(hullGap(w.players[i], w.players[j])).toBeGreaterThan(0);
  });

  it('keeps a full sea of captains with two thumbs each small on the wire', () => {
    const ships = ['jackdaw', 'kestrel', 'revenant', 'maree'];
    const sea = new Sea('TEST', 'rivals', { seed: () => 'fixed', round: 600 });
    for (let i = 0; i < CAP; i++) sea.join({ seat: `s${i}`, captain: `C${i}`, ship: ships[i % 4] });
    sail(sea, LOBBY + 0.1);
    const presses = Array.from({ length: CAP }, () => ({ fl: 0, fr: 0, mo: 0 }));
    const sizes: number[] = [];
    let fired = 0;
    for (let b = 0, tick = 0; b < 60 / BEAT; b++, tick += 4) {
      const w = sea.world!;
      w.players.forEach((p, i) => {
        if (p.out) return;
        const input = bot(w, tick, { mortar: true }, p);
        const pr = presses[i];
        // every gun the moment it is loaded, as a guest does
        if (p.cool[0] <= 0) pr.fl++;
        if (p.cool[1] <= 0) pr.fr++;
        if (input.mortar) pr.mo++;
        sea.helm(`s${i}`, helm({ h: input.heading, r: input.rudder, s: input.sail, ...pr }));
      });
      for (const o of sea.step(BEAT)) {
        if (o.t !== 's') continue;
        sizes.push(JSON.stringify({ ...o, me: sea.own('s0') }).length);
        fired += o.s.length;
      }
    }
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(fired).toBeGreaterThan(1000);                              // it was a fight
    // what one phone is sent, before the wire's own compression takes about four fifths off
    expect(mean).toBeLessThan(4_500);
    expect(Math.max(...sizes)).toBeLessThan(12_000);
  });

  it('keeps a dropped phone\'s seat through a wifi blink, and frees it after', () => {
    const sea = aboard();
    sea.leave('bart');
    sail(sea, GRACE / 2);
    expect(sea.join(bart)).toBeNull();
    expect(sea.world!.players[1].left).toBe(false);                   // back in the same ship
    sea.leave('bart');
    const out = sail(sea, GRACE + 1);
    expect(sea.world!.players[1].left).toBe(true);
    expect(last(out, 'roster')!.seats[1].left).toBe(true);
    const cara = { seat: 'cara', captain: 'Iron Cara', ship: 'maree' };
    sea.join(cara);
    expect(sea.world!.players[1].seat).toBe('cara');                 // the free seat is taken again
  });

  it('among rivals, a ship sent down pays a quarter of her plunder to whoever sank her, and comes back', () => {
    const sea = aboard('rivals');
    const w = sea.world!;
    const [a, b] = w.players;
    a.plunder = 400; a.invuln = 0;
    wound(w, a, 9999, 'shot', a.x, a.y, b);
    const out = sail(sea, 0.1);
    expect(a.out).toBe(true);
    expect(a.plunder).toBe(400 * (1 - TOLL));
    expect(b.plunder).toBe(400 * TOLL);
    expect(sea.scores().find((s) => s.id === b.id)!.sank).toBe(1);
    const tolls = out.filter((o): o is Snap => o.t === 's').flatMap((s) => s.e).filter((e) => e.k === 'toll');
    expect(tolls).toEqual([expect.objectContaining({ p: 0, by: 1, reales: 100 })]);
    sail(sea, RESPAWN + 0.2);
    expect(a.out).toBe(false);
    expect(a.hull).toBe(a.hullMax);
  });

  it('among crew, the toll is simply lost', () => {
    const sea = aboard('crew');
    const w = sea.world!;
    const [a, b] = w.players;
    a.plunder = 400; a.invuln = 0;
    wound(w, a, 9999, 'shot');
    sail(sea, 0.1);
    expect(a.plunder).toBe(300);
    expect(b.plunder).toBe(0);
    expect(w.pvp).toBe(false);
  });

  it('a clear sea brings the next wave after a breather, on the same chart', () => {
    const sea = aboard();
    const w = sea.world!;
    w.gi = w.plan.groups.length; w.foes.length = 0;
    sail(sea, 0.2);
    expect(w.phase).toBe('clear');
    sail(sea, BREATHER);
    expect(w.phase).toBe('fight');
    expect(w.wave).toBe(2);
    expect(sea.world).toBe(w);
  });

  it('a round ends in a scoreboard, most plunder first, and the next sails a new chart', () => {
    const sea = aboard('rivals', 5);
    sea.world!.players[1].plunder = 250;
    const out = sail(sea, 5);
    const results = out.filter((o): o is Round => o.t === 'round' && o.stage === 'results')[0];
    expect(results.scores.map((s) => s.captain)).toEqual(['Grim Bart', 'Salt Anne']);
    const seed = sea.world!.seed;
    const next = sail(sea, RESULTS + 0.1);
    expect(last(next, 'round')!.stage).toBe('sailing');
    expect(sea.n).toBe(2);
    expect(sea.world!.seed).not.toBe(seed);
    expect(last(next, 'roster')!.seed).toBe(sea.world!.seed);
    expect(sea.world!.players.every((p) => p.plunder === 0)).toBe(true);
  });

  it('an empty sea goes back to waiting', () => {
    const sea = aboard();
    sea.leave('anne'); sea.leave('bart');
    sail(sea, GRACE + 1);
    expect(sea.aboard).toBe(0);
    expect(sea.world).toBeNull();
    expect(sea.stage).toBe('lobby');
  });
});
