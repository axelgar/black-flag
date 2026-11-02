// Every number the fight is tuned by, in one place. Change one, deploy, play.
//
// The sea server and the phones both read this file, so a change reaches both with the
// next deploy. Distances are metres, times seconds, speeds metres a second.

export const TUNING = {
  /* ------------------------------------------------------------------ ships -- */

  /** How much hull a ship has. Every ship has the same. With bots at 0.45 and a hull of
   *  100, a scripted captain won in under a minute; at 160 a win takes a few minutes. */
  hull: 160,
  /** Top speed under full sail. */
  speed: 24,
  /** How quickly a ship gathers way. */
  accel: 16,
  /** How fast a ship turns at full way, radians a second (about 120° a second). */
  turn: 2.1,
  /** Every ship's size on the water. The models are scaled to it, so a hit counts the
   *  same on each. */
  length: 24,
  beam: 8,

  /* ------------------------------------------------------------------- guns -- */

  /** Shots a ship carries, like Brawl Stars' ammo bar. */
  ammo: 3,
  /** Seconds to get one shot back. */
  reload: 1.2,
  /** Seconds between two volleys at the least, however fast the thumb. */
  gap: 0.35,
  /** Balls in a volley. */
  balls: 3,
  /** Radians between the balls of a volley: the volley covers a patch of sea. */
  spread: 0.06,
  /** Damage of one ball. Five volleys of three balls, all hitting, sink a ship. */
  damage: 12,
  /** How fast a ball flies. */
  ballSpeed: 130,
  /** How far a ball flies before it drops into the sea. */
  range: 100,
  /** A quick tap fires at the nearest ship within this. */
  autoRange: 110,

  /* ---------------------------------------------------------------- mending -- */

  /** Seconds without being hit before the hull starts to mend. */
  mendAfter: 3,
  /** Hull mended a second, once mending. */
  mend: 8,

  /* ------------------------------------------------------------ sunk, again -- */

  /** Seconds from sinking to being back at sea. */
  respawn: 3,
  /** Seconds a ship that has just come in can't be hurt. Firing ends it early. */
  grace: 2,

  /* ---------------------------------------------------------------- streaks -- */

  /** Sinks in a row, without being sunk, that win the free shot. */
  win: 5,
  /** At this streak a ship is marked WANTED on every screen. */
  wanted: 4,

  /* ---------------------------------------------------------------- leaving -- */

  /** Seconds without a hit, given or taken, after which a captain who leaves docks at once
   *  and keeps the streak. */
  calm: 10,
  /** Seconds a ship stays on the sea, and can still be sunk, when her captain leaves in a
   *  fight. */
  linger: 10,

  /* ---------------------------------------------------------------- the sea -- */

  /** Ships on a sea at the least: bots make up the rest. */
  minShips: 5,
  /** Captains on a sea at the most. The next phone goes to the next sea. */
  maxShips: 30,
  /** Seconds to sail across the sea at full speed with minShips on it. It grows with the
   *  square root of the ships, so the crowding stays the same: about 50 s at 30. */
  across: 20,
  /** How fast the edge closes in when ships leave. */
  edgeSpeed: 10,

  /* ----------------------------------------------------------------- crates -- */

  /** One crate on the sea for every this many ships. */
  shipsPerCrate: 3,
  /** Seconds before a crate that was taken is replaced. */
  crateEvery: 15,
  /** A repair crate mends this share of the hull. */
  repair: 0.5,
  /** A speed crate adds this share to top speed... */
  boost: 0.4,
  /** ...for this many seconds. */
  boostFor: 5,
  /** A heavy-shot crate multiplies the next volley's damage by this. */
  heavy: 2,

  /* ---------------------------------------------------------------- powers -- */
  // Four to try out, each on a button of its own, each once a life: she has all of them
  // again when she comes back from sinking. Captains only, for now.

  /** Full broadside: this many balls in one fan at the nearest ship, without using a shot. */
  broadsideBalls: 8,
  /** Radians between them. */
  broadsideSpread: 0.05,
  /** Smoke: seconds she can't be seen, aimed at or picked by a bot. Firing ends it. */
  smokeFor: 4,
  /** Mermaid song: seconds that every ship within songRange is pulled toward her... */
  songFor: 4,
  songRange: 90,
  /** ...at this many metres a second, whatever she is sailing. */
  songPull: 12,
  /** Shield: seconds she takes no damage. Balls stop at it. */
  shieldFor: 3,

  /* ------------------------------------------------------------------- bots -- */

  /** How good the bots are, 0 to 1. At 0 they mostly miss and fire slowly; at 1 they lead
   *  their shots well and fire as fast as they can. At 0.9 with a hull of 160 a scripted
   *  captain took 3–6 minutes to win, and about half won inside five: set for the first
   *  play-test at the bar, to be moved by what real guests do. */
  botSkill: 0.9,
  /** Bots on the same target at the most. */
  botCrowd: 2,
};

export type Tuning = typeof TUNING;

/** The sea's radius for this many ships on it. */
export function seaRadius(ships: number, t: Tuning = TUNING): number {
  const n = Math.max(t.minShips, Math.min(t.maxShips, ships));
  return ((t.speed * t.across) / 2) * Math.sqrt(n / t.minShips);
}
