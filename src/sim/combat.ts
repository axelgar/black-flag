// Guns, shot and damage: who is hurt, who sinks, and whose streak it adds to.

import { angleTo } from '../core/vec';
import { TUNING as T } from '../data/tuning';
import { lineOfSight, onLand } from './map';
import { inHull } from './sailing';
import { ev, type Ship, type Side, type Vessel, type World } from './types';

/** Which way a side's guns point. Port is to the left of her heading, starboard right. */
export function sideVec(h: number, side: Side): [number, number] {
  const s = side === 1 ? 1 : -1;
  return [-Math.sin(h) * s, Math.cos(h) * s];
}

/** The side of her that faces a bearing. */
export const sideFacing = (h: number, bearing: number): Side => (angleTo(h, bearing) >= 0 ? 1 : 0);

/** Where to aim so a ball fired now meets her: one step of lead is plenty at these ranges. */
export function lead(x: number, y: number, t: Vessel, speed: number, k = 1): [number, number] {
  const d = Math.hypot(t.x - x, t.y - y);
  const tt = (d / speed) * k;
  return [t.x + Math.cos(t.h) * t.v * tt, t.y + Math.sin(t.h) * t.v * tt];
}

/** Can she go after that ship? Every other ship on the water, unless it is in smoke. */
export const foe = (s: Ship, o: Ship) => o !== s && !o.out && !(o.smoke > 0);

/** The nearest ship she can see within reach, or null. */
export function nearestFoe(w: World, s: Ship, reach: number): Ship | null {
  let best: Ship | null = null, bd = reach;
  for (const o of w.ships) {
    if (!foe(s, o)) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d >= bd || !lineOfSight(w.map, s.x, s.y, o.x, o.y)) continue;
    best = o; bd = d;
  }
  return best;
}

/** The bearing a quick tap fires on: at the nearest ship in reach, led; with none, ahead. */
export function autoBearing(w: World, s: Ship): number {
  const o = nearestFoe(w, s, T.autoRange);
  if (!o) return s.h;
  const [ax, ay] = lead(s.x, s.y, o, T.ballSpeed);
  return Math.atan2(ay - s.y, ax - s.x);
}

/** Shots back, one at a time, and the gap since the last volley. */
export function reload(s: Ship, dt: number) {
  s.gapT = Math.max(0, s.gapT - dt);
  if (s.ammo >= T.ammo) { s.reloadT = T.reload; return; }
  s.reloadT -= dt;
  if (s.reloadT <= 0) { s.ammo++; s.reloadT += T.reload; }
}

/**
 * A volley toward a bearing. The guns on the side facing it fire, and the balls fly along
 * it, a little fanned: aimed where the thumb aimed, as in Brawl Stars, not square off her
 * side. Returns whether she fired.
 */
export function fire(w: World, s: Ship, bearing: number): boolean {
  if (s.out || s.ammo <= 0 || s.gapT > 0) return false;
  s.ammo--;
  s.gapT = T.gap;
  if (s.ammo === T.ammo - 1) s.reloadT = T.reload;
  const heavy = s.heavy;
  s.heavy = false;
  volley(w, s, bearing, T.balls, T.spread, heavy);
  return true;
}

/** `n` balls off the side facing a bearing, `spread` radians apart: a volley, or a
 *  broadside (powers.ts). */
export function volley(w: World, s: Ship, bearing: number, n: number, spread: number, heavy: boolean) {
  s.invuln = 0;                      // firing ends a newcomer's grace
  s.smoke = 0;                       // and gives her away in smoke
  const side = sideFacing(s.h, bearing);
  const [sx, sy] = sideVec(s.h, side);
  const fx = Math.cos(s.h), fy = Math.sin(s.h);
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5;           // -0.5 stern .. 0.5 bow
    const along = k * s.len * 0.5;
    const px = s.x + fx * along + sx * s.beam * 0.5;
    const py = s.y + fy * along + sy * s.beam * 0.5;
    const a = bearing + (i - (n - 1) / 2) * spread;
    w.shots.push({
      x: px, y: py, vx: Math.cos(a) * T.ballSpeed, vy: Math.sin(a) * T.ballSpeed,
      r: heavy ? 1.6 : 1, dmg: T.damage * (heavy ? T.heavy : 1), heavy,
      age: 0, life: T.range / T.ballSpeed, dead: false, by: s.id,
    });
  }
  ev(w, 'volley', { p: s.id, side, a: bearing, heavy, x: s.x, y: s.y });
}

/* ------------------------------------------------------------ shot in air -- */

export function flyShots(w: World, dt: number) {
  for (const sh of w.shots) {
    if (sh.dead) continue;
    sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.age += dt;
    if (sh.age >= sh.life) {
      sh.dead = true;
      ev(w, 'splash', { x: sh.x, y: sh.y });
      continue;
    }
    const by = w.ships[sh.by];
    for (const o of w.ships) {
      if (o.out || o.id === sh.by) continue;
      if (Math.abs(o.x - sh.x) > o.len || Math.abs(o.y - sh.y) > o.len) continue;
      if (!inHull(o, sh.x, sh.y, sh.r)) continue;
      // a newcomer's grace: the ball goes through her and on
      if (o.invuln > 0) continue;
      sh.dead = true;
      // a shield: the ball stops at it
      if (o.shield > 0) { ev(w, 'thud', { x: sh.x, y: sh.y, p: o.id, by: sh.by, shield: true }); break; }
      ev(w, 'thud', { x: sh.x, y: sh.y, p: o.id, by: sh.by });
      wound(w, o, sh.dmg, by ?? null, sh.x, sh.y);
      break;
    }
    // islands are cover: shot does not pass through rock or sand
    if (!sh.dead && onLand(w.map, sh.x, sh.y)) {
      sh.dead = true;
      ev(w, 'thud', { x: sh.x, y: sh.y, rock: true });
    }
  }
}

/* ------------------------------------------------------------- damage -- */

/** A ship hurt by another. The last hit sinks her, and the sink is whoever fired it. */
export function wound(w: World, s: Ship, dmg: number, by: Ship | null, x = s.x, y = s.y) {
  if (s.out || s.invuln > 0 || s.shield > 0) return;
  s.hull -= dmg;
  s.hit = 1;
  s.calm = 0; s.mendT = 0;
  if (by) by.calm = 0;
  ev(w, 'hit', { x, y, dmg, p: s.id, by: by?.id });
  if (s.hull > 0) return;
  sink(w, s, by);
}

/** She goes down: her streak is gone, and whoever sank her adds one to theirs. Five in a
 *  row and they have won. */
export function sink(w: World, s: Ship, by: Ship | null) {
  s.hull = 0;
  s.out = true;
  s.down = 0;
  s.v = 0;
  const lost = s.streak;
  s.streak = 0;
  ev(w, 'sunk', { p: s.id, by: by?.id, x: s.x, y: s.y, lost });
  if (!by || by === s) return;
  by.streak++;
  by.sank++;
  ev(w, 'streak', { p: by.id, n: by.streak });
  if (by.streak >= T.win) {
    ev(w, 'won', { p: by.id, n: by.streak });
    by.streak = 0;
  }
}
