// Bots: ships the sea sails itself, so a quiet night still has five on the water. A bot
// sees what a captain sees and steers, aims and fires through the same Input a phone
// sends; it gets no turn, speed or shot a captain doesn't.
//
// It picks a ship, circles it at cannon range and fires with an aim that is off by more
// the less skilled it is. When it is low it backs off to mend, and it takes a crate near
// it. It uses its powers as a captain would, each once a life: the shield when it is
// losing a fight, the broadside to finish a ship close by, the song on one getting away;
// the less skilled, the slower it is to think of them. It never crowds a ship more than botCrowd bots deep, and a WANTED ship is no more
// interesting to it than any other: humans hunt the near-winners, bots don't gang up.

import { clamp } from '../core/vec';
import { TUNING as T } from '../data/tuning';
import { lead, foe, nearestFoe } from './combat';
import { lineOfSight, shoreDist } from './map';
import { can } from './powers';
import { POWERS, type Brain, type Input, type Ship, type World } from './types';

const NAMES = [
  'Calico Jack', 'Anne Bonny', 'Mary Read', 'Blackbeard', 'Black Bart', 'Stede Bonnet',
  'Henry Every', 'Ching Shih', 'Grace O’Malley', 'Charles Vane', 'Sam Bellamy', 'Ned Low',
];

/** A bot's name, by the order it came aboard. */
export const botName = (n: number) => NAMES[n % NAMES.length];

export const newBrain = (w: World): Brain => ({ target: -1, think: 0, orbit: w.r() < 0.5 ? 1 : -1, wait: 1 + w.r(), flee: false, power: 1 + w.r() });

/** What a bot does this tick. */
export function botInput(w: World, s: Ship, dt: number): Input {
  const b = (s.brain ??= newBrain(w));
  const skill = clamp(T.botSkill, 0, 1);
  b.think -= dt;
  b.wait -= dt;
  b.power -= dt;

  // low: back off and mend; mended enough: back in
  if (s.hull < s.hullMax * 0.35) b.flee = true;
  else if (s.hull > s.hullMax * 0.7) b.flee = false;

  let tgt = b.target >= 0 ? w.ships[b.target] : undefined;
  if (!tgt || !foe(s, tgt) || b.think <= 0) {
    tgt = pick(w, s);
    b.target = tgt ? tgt.id : -1;
    b.think = 3 + w.r() * 2;
  }

  let heading: number;
  let sail = 1;
  const crate = nearCrate(w, s);
  if (b.flee && tgt) {
    // away from whoever is after it, round toward open water
    heading = Math.atan2(s.y - tgt.y, s.x - tgt.x) + b.orbit * 0.4;
  } else if (crate && (!tgt || Math.hypot(crate.x - s.x, crate.y - s.y) < Math.hypot(tgt.x - s.x, tgt.y - s.y))) {
    heading = Math.atan2(crate.y - s.y, crate.x - s.x);
  } else if (tgt) {
    heading = circle(s, tgt, T.range * 0.75, b.orbit);
  } else {
    // nobody to fight: make for the middle, slowly
    heading = Math.atan2(-s.y, -s.x);
    sail = 0.6;
  }
  heading = steerClear(w, s, heading, b);
  // the sea's edge
  const R = w.R, d = Math.hypot(s.x, s.y);
  if (d > R - 60) heading = Math.atan2(-s.y, -s.x);

  let fire: number | null = null;
  if (tgt && b.wait <= 0 && s.ammo > 0 && s.gapT <= 0) {
    const dist = Math.hypot(tgt.x - s.x, tgt.y - s.y);
    if (dist < T.range * 0.95 && lineOfSight(w.map, s.x, s.y, tgt.x, tgt.y)) {
      // a good bot leads its shot; a poor one aims where the ship is, and wide
      const [ax, ay] = lead(s.x, s.y, tgt, T.ballSpeed, skill);
      const err = (0.04 + (1 - skill) * 0.3) * gauss(w);
      fire = Math.atan2(ay - s.y, ax - s.x) + err;
      b.wait = 0.4 + (1 - skill) * 1.4 + w.r() * 0.5;
    }
  }
  let power: number | null = null;
  if (b.power <= 0) {
    b.power = 0.4 + (1 - skill) * 1.2 + w.r() * 0.4;
    if (w.r() < 0.35 + 0.65 * skill) power = reach(w, s, tgt);
  }
  return { move: { x: Math.cos(heading) * sail, y: Math.sin(heading) * sail }, fire, auto: false, power };
}

const SHIELD = POWERS.indexOf('shield'), BROADSIDE = POWERS.indexOf('broadside'), SONG = POWERS.indexOf('song');

/** The power it reaches for now, if any. */
function reach(w: World, s: Ship, tgt: Ship | undefined): number | null {
  // being hit, and losing
  if (can(s, SHIELD) && s.hull < s.hullMax * 0.45 && s.mendT < 0.5) return SHIELD;
  if (!tgt) return null;
  // a ship close by and hurt, or nothing to lose
  const near = nearestFoe(w, s, T.range * 0.6);
  if (can(s, BROADSIDE) && near && (near.hull < near.hullMax * 0.6 || s.hull < s.hullMax * 0.35)) return BROADSIDE;
  // hers getting away: under way, heading off from her, and still in the song's reach
  const dx = tgt.x - s.x, dy = tgt.y - s.y, d = Math.hypot(dx, dy);
  const off = (Math.cos(tgt.h) * dx + Math.sin(tgt.h) * dy) / Math.max(d, 1);
  if (can(s, SONG) && d > T.range * 0.55 && d < T.songRange && off > 0.5 && tgt.v > T.speed * 0.5) return SONG;
  return null;
}

/** Which ship to go after: usually the nearest, sometimes another in reach, never one that
 *  already has botCrowd bots on it. */
function pick(w: World, s: Ship): Ship | undefined {
  const crowd = new Map<number, number>();
  for (const o of w.ships) if (o.bot && o !== s && !o.out && o.brain && o.brain.target >= 0) crowd.set(o.brain.target, (crowd.get(o.brain.target) ?? 0) + 1);
  const options = w.ships
    .filter((o) => foe(s, o) && (crowd.get(o.id) ?? 0) < T.botCrowd)
    .map((o) => ({ o, d: Math.hypot(o.x - s.x, o.y - s.y) }))
    .sort((a, b) => a.d - b.d);
  if (!options.length) return undefined;
  if (options.length > 1 && w.r() < 0.2 && options[1].d < 300) return options[1].o;
  return options[0].o;
}

/** A crate worth turning for: near, and a repair one first when hurt. */
function nearCrate(w: World, s: Ship) {
  let best = null as World['crates'][number] | null, bd = 120;
  for (const c of w.crates) {
    if (c.dead) continue;
    const d = Math.hypot(c.x - s.x, c.y - s.y) * (c.kind === 'repair' && s.hull < s.hullMax * 0.6 ? 0.5 : 1);
    if (d < bd) { best = c; bd = d; }
  }
  return best;
}

/** The heading that circles a ship at a range: broadside to her, closing or opening the
 *  distance as needed. */
function circle(s: Ship, t: Ship, range: number, dir: 1 | -1): number {
  const to = Math.atan2(t.y - s.y, t.x - s.x);
  const d = Math.hypot(t.x - s.x, t.y - s.y);
  const off = clamp((d - range) / range, -1, 1);       // + too far, - too close
  return to - dir * (Math.PI / 2) * (1 - off * 0.8);
}

/** Look ahead along a heading; if land is there, turn the way it is clear. */
function steerClear(w: World, s: Ship, heading: number, b: Brain): number {
  const look = 40 + s.v * 1.5;
  const clear = (a: number) => shoreDist(w.map, s.x + Math.cos(a) * look, s.y + Math.sin(a) * look) > s.beam;
  if (clear(heading)) return heading;
  for (let k = 1; k <= 4; k++) {
    const a = heading + b.orbit * k * 0.45;
    if (clear(a)) return a;
    const c = heading - b.orbit * k * 0.45;
    if (clear(c)) { b.orbit = b.orbit === 1 ? -1 : 1; return c; }
  }
  return heading + Math.PI * 0.5 * b.orbit;
}

/** A roll from a bell curve, about -1..1 mostly. */
function gauss(w: World) {
  return (w.r() + w.r() + w.r() - 1.5) / 0.75;
}
