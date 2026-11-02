// Coming aboard on a bad line: the phone is never left on "Finding the sea…". Whatever
// hangs (the sign-in, a line that never opens, a sea that never answers), the guest is
// told which within ten seconds, and can try again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A WebSocket the test opens, answers and drops by hand. */
class Line {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static made: Line[] = [];
  readyState = Line.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(readonly url: string) { Line.made.push(this); }
  send(s: string) { this.sent.push(s); }
  close() {
    if (this.readyState === Line.CLOSED) return;
    this.readyState = Line.CLOSED;
    setTimeout(() => this.onclose?.(), 0);
  }
  open() { this.readyState = Line.OPEN; this.onopen?.(); }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

vi.stubEnv('VITE_SEA_URL', 'ws://sea.test');
vi.stubGlobal('WebSocket', Line);
const { Link } = await import('../src/net/link');
const { WIRE } = await import('../src/net/protocol');

type Creds = Promise<{ token: string; seat: string } | null>;
const signedIn: Creds = Promise.resolve({ token: 't', seat: 'a' });
const never: Creds = new Promise(() => {});
const welcome = { t: 'welcome', v: WIRE, code: 'BAR1', cap: 30 };

function link(creds: Creds = signedIn) {
  const seen: string[] = [];
  const L = new Link(creds, 'Marta', 'jackdaw', () => seen.push(`${L.state}${L.why ? `:${L.why}` : ''}`));
  return { L, seen };
}

beforeEach(() => { vi.useFakeTimers(); Line.made = []; });
afterEach(() => { vi.useRealTimers(); });

describe('coming aboard on a bad line', () => {
  it('gives up on a sign-in that never comes back, and says it was the sign-in', async () => {
    const { L } = link(never);
    await vi.advanceTimersByTimeAsync(9_900);
    expect(L.state).toBe('hailing');
    await vi.advanceTimersByTimeAsync(200);
    expect([L.state, L.why]).toEqual(['refused', 'token']);
    expect(Line.made).toHaveLength(0);
  });

  it('drops a line that hangs opening and tries again, then says the sea was out of reach', async () => {
    const { L } = link();
    await vi.advanceTimersByTimeAsync(0);
    expect(Line.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(Line.made[0].readyState).toBe(Line.CLOSED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(Line.made.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect([L.state, L.why]).toEqual(['refused', 'reach']);
    // and no more tries after giving up
    const tried = Line.made.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Line.made).toHaveLength(tried);
  });

  it('says the sea did not answer when the line opened but no welcome came', async () => {
    const { L } = link();
    await vi.advanceTimersByTimeAsync(0);
    Line.made[0].open();
    await vi.advanceTimersByTimeAsync(10_100);
    expect([L.state, L.why]).toEqual(['refused', 'server']);
  });

  it('stays aboard when the welcome comes in time', async () => {
    const { L } = link();
    await vi.advanceTimersByTimeAsync(0);
    Line.made[0].open();
    await vi.advanceTimersByTimeAsync(3_000);
    Line.made[0].say(welcome);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(L.state).toBe('aboard');
  });

  it('tries again from a sea out of reach, with ten more seconds', async () => {
    const { L } = link();
    await vi.advanceTimersByTimeAsync(10_100);
    expect(L.why).toBe('reach');
    L.again();
    expect(L.state).toBe('hailing');
    await vi.advanceTimersByTimeAsync(0);
    const line = Line.made[Line.made.length - 1];
    line.open(); line.say(welcome);
    expect(L.state).toBe('aboard');
  });

  it('lets go of everything when the guest leaves', async () => {
    const { L, seen } = link(never);
    L.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen).toEqual([]);
  });
});
