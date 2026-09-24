// Nassau's per-run upgrades, and the one derivation every number the player's ship
// carries comes out of. The port screen and the simulation both call shipStats(), so
// they can never disagree about what a level actually bought.

import type { BowGun, ShipDef } from './types';

export interface Upgrade { id: string; name: string; note: string; max: number; cost: (lvl: number) => number }

export const UPGRADES: Upgrade[] = [
  { id: 'plating',   name: 'Hull plating',   note: '+30% hull',                 max: 4, cost: (l) => Math.round(200 * Math.pow(1.55, l)) },
  { id: 'broadside', name: 'Broadside',      note: 'harder shot, faster crews', max: 4, cost: (l) => Math.round(240 * Math.pow(1.55, l)) },
  { id: 'racks',     name: 'Mortar racks',   note: '+2 shells a wave',          max: 3, cost: (l) => Math.round(180 * Math.pow(1.6, l)) },
  { id: 'ram',       name: 'Reinforced ram', note: 'boarding mends more',       max: 3, cost: (l) => Math.round(210 * Math.pow(1.6, l)) },
  { id: 'life',      name: 'Spare crew',     note: '+1 life',                   max: 2, cost: (l) => [700, 1250][l] ?? 9999 },
];

export const bribeCost = (times: number) => Math.round(160 * Math.pow(1.75, times));

export type Upgrades = Partial<Record<string, number>>;

export interface ShipStats {
  hullMax: number;
  maxSpeed: number;
  accel: number;
  turnRate: number;
  gunsPerSide: number;
  reload: number;
  dmg: number;
  shotSpeed: number;
  range: number;
  bowGun: BowGun | null;
  shellsMax: number;
  boardRepair: number;
  ramDmg: number;
  lives: number;
  len: number;
  beam: number;
}

export function recipeOf(def: ShipDef) {
  return def.model.kind === 'procedural' ? def.model.recipe : def.model.fallback;
}

export function shipStats(def: ShipDef, up: Upgrades = {}): ShipStats {
  const b = def.base;
  const p = up.plating ?? 0, g = up.broadside ?? 0, r = up.racks ?? 0, m = up.ram ?? 0;
  const rec = recipeOf(def);
  return {
    hullMax: Math.round(b.hull * (1 + p * 0.3)),
    maxSpeed: b.maxSpeed,
    accel: b.accel,
    turnRate: b.turnRate,
    gunsPerSide: b.gunsPerSide,
    reload: b.broadsideReload * Math.pow(0.88, g),
    dmg: b.shotDmg * (1 + g * 0.4),
    shotSpeed: b.shotSpeed,
    range: b.shotRange,
    bowGun: b.bowGun ? { ...b.bowGun, dmg: b.bowGun.dmg * (1 + g * 0.4) } : null,
    shellsMax: b.shellsMax + r * 2,
    boardRepair: b.boardRepair + m * 5,
    ramDmg: b.ramDmg + m * 2,
    lives: b.lives + (up.life ?? 0),
    len: rec.length,
    beam: rec.beam,
  };
}
