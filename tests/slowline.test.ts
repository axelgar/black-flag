// A night at the bar on each kind of line a guest's phone might be on (tests/slowline.ts),
// and what she would see: the other ships near the present, never stopping dead and seldom
// hitching, and her own ship seldom put right. Before the sea's word was deflated and the
// mirror sailed ships on through a late snapshot, a weak 4G line hitched every ship about
// forty times a minute, and a 2G one fell further behind the sea every second.

import { describe, expect, it } from 'vitest';
import { LINES, night, rig } from './slowline';

rig();
const { Link } = await import('../src/net/link');

const SECONDS = 40;

describe('a night on a slow line', () => {
  it('on bar wifi: near the present, smooth, and her own ship where it should be', async () => {
    const r = await night(Link, { line: LINES.wifi, seconds: SECONDS });
    expect(r.lag.mean).toBeLessThan(0.2);
    expect(r.hitches).toBeLessThan(15);
    expect(r.frozen).toBeLessThan(0.01);
    expect(r.corrections.mean).toBeLessThan(0.1);
  });

  it('on weak 4G: as smooth as on wifi, a little further behind', async () => {
    const r = await night(Link, { line: LINES.weak4g, seconds: SECONDS });
    expect(r.lag.mean).toBeLessThan(0.3);
    expect(r.hitches).toBeLessThan(15);
    expect(r.frozen).toBeLessThan(0.01);
    expect(r.corrections.mean).toBeLessThan(0.4);
  });

  it('on bad 3G, with a second of no signal now and then: ships never stop dead', async () => {
    const r = await night(Link, { line: LINES.bad3g, seconds: SECONDS });
    expect(r.lag.mean).toBeLessThan(0.6);
    expect(r.hitches).toBeLessThan(25);
    expect(r.frozen).toBeLessThan(0.01);
  });

  it('on 2G: the sea, deflated, fits the line, and keeps up', async () => {
    const r = await night(Link, { line: LINES.edge, seconds: SECONDS });
    expect(r.kbps).toBeLessThan(LINES.edge.down / 2);
    expect(r.lag.mean).toBeLessThan(0.8);
    expect(r.hitches).toBeLessThan(40);
    expect(r.frozen).toBeLessThan(0.02);
  });

  it('on a line slower than the sea\'s word: behind, but never further and further', async () => {
    const r = await night(Link, { line: { ...LINES.edge, down: 32 }, seconds: SECONDS });
    expect(r.lag.mean).toBeLessThan(2);
    expect(r.lag.p95).toBeLessThan(2.5);
  });
});
