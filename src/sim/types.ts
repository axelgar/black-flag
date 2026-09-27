// The shape of a world. Plain objects all the way down, so a snapshot is just the thing
// itself: the renderer reads it, the tests poke at it, and digest() prints it.

import type { Rng } from '../core/rng';
import type { FoeClass, LegendDef } from '../data/types';
import type { DropId } from '../data/drops';
import type { ShipStats } from '../data/upgrades';
import type { WavePlan, Weather } from '../data/waves';
import type { GameMap } from './map';

export type Phase = 'fight' | 'clear' | 'docked' | 'lost';

/** What a hull does on the water, whoever is sailing her. */
export interface Vessel {
  id: number;
  x: number; y: number;
  h: number;               // heading, radians; forward is (cos h, sin h)
  v: number;               // way on, m/s along the heading
  rot: number;             // how fast she is turning, rad/s — the renderer heels her by it
  sail: number;            // how much canvas is set, 0..1, eased
  len: number; beam: number;
  maxSpeed: number; accel: number; turnRate: number;
  hull: number; hullMax: number;
  hit: number;             // flashes when struck by shot, decays
  dead: boolean;
}

export type Side = 0 | 1;  // 0 = port (left), 1 = starboard (right)

export interface Buffs { powder: number; heavy: number; chain: number; swivel: number }

export interface Player extends Vessel {
  cool: [number, number];  // reload left on each side
  volley: { side: Side; next: number; fired: number; t: number } | null;
  bowCool: number;
  shells: number; shellsMax: number;
  invuln: number;
  ramT: number;            // cooldown after a collision, so one touch is one wound
  groundT: number;         // cooldown after touching bottom
  buffs: Buffs;
  board: { id: number; t: number } | null;
  aim: { x: number; y: number; lock: number } | null;   // where the mortar would land now
  rim: boolean;            // the rim current has her head, and the helm is not hers until she points back in
  want: [boolean, boolean]; // a broadside called for while the other side's guns were still rippling
}

export type FoeState = 'patrol' | 'engage' | 'struck' | 'spent';

export interface Port { fwd: number; side: -1 | 1; hull: number; dead: boolean }

export interface Foe extends Vessel {
  cls: string;                 // a class id, or 'legend'
  C: FoeClass | null;          // null for a legendary
  L: LegendDef | null;
  reales: number;
  ram: number;
  strikes: boolean;
  state: FoeState;
  alert: boolean;
  squad: number;
  wp: { x: number; y: number };
  wpT: number;
  seeT: number;
  orbit: 1 | -1;               // which way she circles you
  cool: number;                // main battery
  coolAlt: number;             // mortar deck, or the other side
  broad: number;               // frigate telegraph: >0 while her ports are open
  broadSide: -1 | 1;
  strikeT: number;
  struckOnce: boolean;
  spentT: number;
  hunter: boolean;
  chase: number;               // brulote gathering way
  slow: number;                // chain shot in her rigging
  ph: number;
  ports: Port[] | null;        // a legendary's weak points
  phase: number;               // a legendary's phase, 0..2
  flash: number;               // gun flash, decays
  detour: -1 | 0 | 1;          // which way she is working round the land in her way, 0 when clear
  seen: boolean;               // host flag: the captain's log has her. Never read by the sim.
}

export interface Shot {
  x: number; y: number; vx: number; vy: number;
  r: number; dmg: number; foe: boolean; kind: 'ball' | 'chain';
  pierce: number; age: number; life: number; dead: boolean;
  from: number;                // who fired it — a ship does not hit herself
}

export interface Mark { x: number; y: number; r: number; t: number; max: number; own: boolean; dmg: number; done: boolean }
export interface Drop { id: number; x: number; y: number; kind: DropId; dur: number; age: number; dead: boolean }
export interface Spout { id: number; x: number; y: number; r: number; vx: number; vy: number; age: number; life: number }
export interface Squad { x: number; y: number }

export interface GameEvent { k: string; [key: string]: unknown }

export interface Input {
  heading: number | null;      // a bearing to steer for (joystick), or null
  rudder: number;              // -1..1 when steering by keys
  sail: number;                // canvas to set, 0..1
  fireL: boolean;              // edge-triggered by the caller
  fireR: boolean;
  mortar: boolean;
}

export interface World {
  seed: string;
  wave: number;
  shipId: string;
  map: GameMap;
  plan: WavePlan;
  stats: ShipStats;
  reduce: boolean;
  r: Rng;
  weather: Weather;
  t: number;
  gi: number;
  quiet: number;
  nextId: number;
  phase: Phase;
  heat: number;
  plunder: number;
  lives: number;
  boarded: number;
  sunk: number;
  speedMul: number;
  reloadMul: number;
  drift: { x: number; y: number };
  shake: number;
  ship: Player;
  foes: Foe[];
  shots: Shot[];
  drops: Drop[];
  marks: Mark[];
  spouts: Spout[];
  squads: Squad[];
  boss: Foe | null;
  hunterT: number;
  earlyLegend: boolean;
  events: GameEvent[];
}

export const ev = (w: World, k: string, o: Record<string, unknown> = {}) => {
  if (w.events.length < 96) w.events.push({ k, ...o });
};
