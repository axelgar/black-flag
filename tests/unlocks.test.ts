import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIPS, STARTER } from '../src/data/ships';
import { CODES, normCode, shipForCode } from '../src/data/unlocks';
import { clock, reales } from '../src/state/run';

describe('QR unlocks', () => {
  it('every ship that is not a starter has a code, and every code is a ship', () => {
    for (const s of SHIPS) {
      if (s.id === STARTER) { expect(s.unlock).toBe('starter'); continue; }
      expect(s.unlock).not.toBe('starter');
    }
    for (const { ship, code } of CODES) expect(shipForCode(code)).toBe(ship);
    expect(new Set(CODES.map((c) => normCode(c.code))).size).toBe(CODES.length);
  });

  it('forgives what a camera or a keyboard does to a code', () => {
    const { ship, code } = CODES[0];
    expect(shipForCode(code.toLowerCase())).toBe(ship);
    expect(shipForCode(code.replace('-', ''))).toBe(ship);
    expect(shipForCode(` ${encodeURIComponent(code)} `)).toBe(ship);
  });

  it('a code that is not on the register is nothing', () => {
    expect(shipForCode('')).toBeNull();
    expect(shipForCode('JACKDAW')).toBeNull();
    expect(shipForCode('kestrel')).toBeNull();
  });
});

describe('the log from v1', () => {
  beforeEach(() => { vi.resetModules(); });

  it('carries the record book across and drops the old run', async () => {
    const mem: Record<string, string> = {
      'blackflag.log': JSON.stringify({
        sound: false, records: { bestWave: 9, runs: 4, boarded: 12 }, seen: { brig: 3 }, beaten: { dama: 1 },
        run: { seed: 'old', wave: 6 },
      }),
    };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => { mem[k] = v; },
      removeItem: (k: string) => { delete mem[k]; },
    });
    const { session, unlockShip } = await import('../src/state/session');
    expect(session.records.bestWave).toBe(9);
    expect(session.seen.brig).toBe(3);
    expect(session.sound).toBe(false);
    expect(session.run).toBeNull();
    expect(session.unlocked).toEqual([STARTER]);
    expect(unlockShip('kestrel')).toBe(true);
    expect(unlockShip('kestrel')).toBe(false);
    expect(JSON.parse(mem['blackflag.v2']).unlocked).toContain('kestrel');
    vi.unstubAllGlobals();
  });
});

describe('the small', () => {
  it('prints time and money', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(61)).toBe('1:01');
    expect(clock(-5)).toBe('0:00');
    expect(reales(1234)).toBe('1,234');
  });
});
