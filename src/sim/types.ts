// The shape of a world. Plain objects all the way down, so a snapshot is just the thing
// itself: the renderer reads it, the tests poke at it, and digest() prints it.

import type { Rng } from '../core/rng';
import type { GameMap } from './map';

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

/** What a bot is thinking. Only the sea that steps the world has one. */
export interface Brain {
  target: number;          // the ship it is after, or -1
  think: number;           // seconds until it looks round again
  orbit: 1 | -1;           // which way it circles
  wait: number;            // seconds until it may fire again
  flee: boolean;           // backing off to mend
  power: number;           // seconds until it next thinks of a power
}

/**
 * A ship on the sea, a captain's or a bot's. Her `id` is her place in `World.ships`, which
 * a ship that sinks keeps: she is back afloat in it a few seconds later.
 */
export interface Ship extends Vessel {
  seat: string;            // who is sailing her: the server's player id; '' for a bot
  bot: boolean;
  look: string;            // which ship she looks like (data/ships.ts). They all sail alike
  trim: number;            // the canvas her captain last asked for, held while the stick is let go
  streak: number;          // ships sunk in a row since she was last sunk
  sank: number;            // ships sunk since she came aboard
  ammo: number;            // shots ready
  reloadT: number;         // seconds until the next shot is back
  gapT: number;            // seconds until she may fire again
  heavy: boolean;          // her next volley is heavy shot
  boost: number;           // seconds of a speed crate left
  calm: number;            // seconds since she last hit or was hit
  mendT: number;           // seconds since she was last hit: past mendAfter she mends
  invuln: number;          // seconds she can't be hurt
  down: number;            // seconds since she sank, while out
  out: boolean;            // sunk, or gone: not drawn, hit or steered
  left: boolean;           // gone for good: the seat is free for the next to join
  retire: boolean;         // a bot that leaves the next time she sinks, for a captain who came aboard
  rim: boolean;            // the edge of the sea has her head, until she points back in
  spent: boolean[];        // each power (POWERS order) she has used this life
  song: number;            // seconds of song left: ships near her are pulled in
  shield: number;          // seconds of shield left: balls stop at it
  brain: Brain | null;
}

export interface Shot {
  x: number; y: number; vx: number; vy: number;
  r: number; dmg: number; heavy: boolean;
  age: number; life: number; dead: boolean;
  by: number;              // the ship that fired it
}

export type CrateKind = 'repair' | 'speed' | 'heavy';
export const CRATES: CrateKind[] = ['repair', 'speed', 'heavy'];

/** Powers, each on a button of its own. A press names one by its place here. */
export type Power = 'broadside' | 'song' | 'shield';
export const POWERS: Power[] = ['broadside', 'song', 'shield'];

export interface Crate { id: number; x: number; y: number; kind: CrateKind; age: number; dead: boolean }

export interface GameEvent { k: string; [key: string]: unknown }

/**
 * A captain's hands on the phone, in the world's terms. North is up the screen and -y on
 * the chart, so the stick is already a direction on the chart.
 */
export interface Input {
  /** The left stick: a direction on the chart, its length how far it is pushed (0..1).
   *  Null when let go: she holds her course and canvas. */
  move: { x: number; y: number } | null;
  /** A volley toward this bearing, this tick (a drag let go). */
  fire: number | null;
  /** A quick tap: a volley at the nearest ship, this tick. */
  auto: boolean;
  /** A power, by its place in POWERS, this tick. */
  power?: number | null;
}

export interface World {
  seed: string;
  map: GameMap;
  r: Rng;
  t: number;
  /** The sea's radius now: it grows as ships join and closes in as they leave. */
  R: number;
  ships: Ship[];
  /** Host flag: whose eyes the view, the HUD and the sound are behind. Never read by the sim. */
  focus: number;
  shots: Shot[];
  crates: Crate[];
  /** When the next crates are due, by the world's clock. */
  due: number[];
  nextId: number;
  events: GameEvent[];
}

export const ev = (w: World, k: string, o: Record<string, unknown> = {}) => {
  if (w.events.length < 96) w.events.push({ k, ...o });
};

/** The ship the host is looking through. */
export const you = (w: World): Ship | undefined => w.ships[w.focus];

/** Is this event about one ship in particular, and is it not the one on screen? Toasts,
 *  haptics and the hurt sound are for your own ship; smoke and splashes are for everyone. */
export const theirs = (w: World, e: GameEvent) => typeof e.p === 'number' && e.p !== w.focus;

/** Every ship on the water. */
export const afloat = (w: World) => w.ships.filter((s) => !s.out);

/** Ships in the sea, sunk or not: everyone the sea is sized for. */
export const aboard = (w: World) => w.ships.filter((s) => !s.left);
