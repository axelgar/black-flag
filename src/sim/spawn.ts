// Putting ships on the water. A wave plan's groups become squadrons that put to sea from
// the rim or from behind an island, well away from you, and start their search.

import { TAU, clamp } from '../core/vec';
import { CLASSES, HUNTER_CLASS } from '../data/enemies';
import { LEGENDS, legendById } from '../data/legends';
import { EARLY_LEGEND_AT, HUNTER_AT } from '../data/notoriety';
import type { Group } from '../data/waves';
import type { LegendDef } from '../data/types';
import { MAP_R, EDGE, openWater } from './map';
import { hostile } from './combat';
import { ev, type Foe, type World } from './types';

const FAR = 430;   // a squadron never puts to sea closer to you than this

export function addFoe(w: World, cls: string, x: number, y: number, h: number, squad: number): Foe {
  const C = CLASSES[cls];
  const R = C.recipe;
  const e: Foe = {
    id: w.nextId++, cls, C, L: null, x, y, h, v: C.speed * 0.4, rot: 0, sail: 0.5,
    len: R.length, beam: R.beam, maxSpeed: C.speed, accel: C.speed * 0.25, turnRate: C.turn,
    hull: C.hull, hullMax: C.hull, hit: 0, dead: false,
    reales: C.reales, ram: C.ram, strikes: C.strikes,
    state: 'patrol', alert: false, squad,
    wp: { x, y }, wpT: 0, seeT: w.r() * 0.3, orbit: w.r() < 0.5 ? 1 : -1,
    cool: 1 + w.r() * 1.5, coolAlt: 2 + w.r() * 2, broad: 0, broadSide: 1,
    strikeT: 0, struckOnce: false, spentT: 0, hunter: false, chase: 0, slow: 0,
    ph: w.r() * TAU, ports: null, phase: 0, flash: 0, seen: false,
  };
  if (cls === 'brulote') { e.state = 'engage'; e.alert = true; }
  w.foes.push(e);
  return e;
}

export function addLegend(w: World, L: LegendDef, x: number, y: number): Foe {
  const R = L.recipe;
  const h = Math.atan2(w.ship.y - y, w.ship.x - x);
  const e: Foe = {
    id: w.nextId++, cls: 'legend', C: null, L, x, y, h, v: L.speed * 0.5, rot: 0, sail: 1,
    len: R.length, beam: R.beam, maxSpeed: L.speed, accel: L.speed * 0.2, turnRate: L.turn,
    hull: L.hull, hullMax: L.hull, hit: 0, dead: false,
    reales: L.reales, ram: 22, strikes: false,
    state: 'engage', alert: true, squad: newSquad(w, x, y),
    wp: { x, y }, wpT: 0, seeT: 0, orbit: 1,
    cool: 4, coolAlt: 4, broad: 0, broadSide: 1,
    strikeT: 0, struckOnce: false, spentT: 0, hunter: false, chase: 0, slow: 0, ph: 0,
    // Her weak points: ports split between both sides, spread along her length.
    ports: Array.from({ length: L.ports }, (_, i) => {
      const per = Math.ceil(L.ports / 2);
      const k = Math.floor(i / 2) / Math.max(1, per - 1) - 0.5;
      return { fwd: k * R.length * 0.55, side: (i % 2 ? 1 : -1) as -1 | 1, hull: 8, dead: false };
    }),
    phase: 0, flash: 0, seen: false,
  };
  w.foes.push(e);
  w.boss = e;
  ev(w, 'legend', { id: e.id, name: L.name });
  return e;
}

function newSquad(w: World, x: number, y: number): number {
  w.squads.push({ x, y });
  return w.squads.length - 1;
}

/** Somewhere to put to sea from: a point on the rim or in the lee of an island, far from you. */
function anchor(w: World): { x: number; y: number } {
  const s = w.ship, m = w.map;
  const far = (p: { x: number; y: number }) => Math.hypot(p.x - s.x, p.y - s.y) > FAR;
  const options: { x: number; y: number }[] = m.spawns.filter(far);
  for (const is of m.islands) {
    if (is.kind === 'nassau') continue;
    // The far side of an island, as seen from you — a squadron that starts hidden.
    const a = Math.atan2(is.y - s.y, is.x - s.x);
    const p = { x: is.x + Math.cos(a) * (is.r * 1.6 + 30), y: is.y + Math.sin(a) * (is.r * 1.6 + 30) };
    if (far(p) && openWater(m, p.x, p.y, 25)) options.push(p);
  }
  const near = options.filter((p) => Math.hypot(p.x - s.x, p.y - s.y) < 780);
  if (near.length) return near[Math.floor(w.r() * near.length)];
  if (!options.length) {
    const a = Math.atan2(-s.y, -s.x);
    return { x: Math.cos(a) * (MAP_R - EDGE - 60), y: Math.sin(a) * (MAP_R - EDGE - 60) };
  }
  return options[Math.floor(w.r() * options.length)];
}

function place(w: World, x: number, y: number, pad: number): { x: number; y: number } {
  if (openWater(w.map, x, y, pad)) return { x, y };
  for (let i = 1; i < 12; i++) {
    const a = w.r() * TAU, d = i * 12;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    if (openWater(w.map, px, py, pad)) return { x: px, y: py };
  }
  return { x, y };
}

export function spawnGroup(w: World, g: Group) {
  const s = w.ship;
  if (g.cls === 'spout') {
    const a = w.r() * TAU, d = 160 + w.r() * 120;
    const p = place(w, clamp(s.x + Math.cos(a) * d, -600, 600), clamp(s.y + Math.sin(a) * d, -600, 600), 30);
    const b = w.r() * TAU;
    w.spouts.push({ id: w.nextId++, x: p.x, y: p.y, r: 16, vx: Math.cos(b) * 3, vy: Math.sin(b) * 3, age: 0, life: 45 });
    ev(w, 'spout', { x: p.x, y: p.y });
    return;
  }
  if (g.cls === 'legend') {
    const L = legendById(g.legend!);
    const far = w.map.spawns.reduce((a, b) =>
      Math.hypot(b.x - s.x, b.y - s.y) > Math.hypot(a.x - s.x, a.y - s.y) ? b : a);
    addLegend(w, L, far.x, far.y);
    return;
  }

  const A = anchor(w);
  const sq = newSquad(w, A.x, A.y);
  const h = Math.atan2(s.y - A.y, s.x - A.x);
  const C = CLASSES[g.cls];
  const fx = Math.cos(h), fy = Math.sin(h), px = -fy, py = fx;
  const gap = C.recipe.length * 1.4 + 12;
  for (let i = 0; i < g.n; i++) {
    const o = i - (g.n - 1) / 2;
    let a = 0, b = 0;                              // along, across
    if (g.form === 'line') b = o * gap;
    else if (g.form === 'vee') { b = o * gap; a = -Math.abs(o) * gap * 0.7; }
    else if (g.form === 'column') a = -i * gap;
    else { a = (w.r() - 0.5) * gap * 2; b = (w.r() - 0.5) * gap * 3; }
    const p = place(w, A.x + fx * a + px * b, A.y + fy * a + py * b, C.recipe.beam + 8);
    addFoe(w, g.cls, p.x, p.y, h, sq);
  }
  ev(w, 'squadron', { cls: g.cls, n: g.n, x: A.x, y: A.y });
}

/**
 * Release the next squadron when its time comes — or sooner, when the sea has gone quiet.
 * An open chart takes longer to cross than a screen did, and nobody should sail round an
 * empty sea waiting for a timer.
 */
export function release(w: World, dt: number) {
  const p = w.plan;
  let active = 0;
  for (const e of w.foes) if (hostile(e)) active++;
  w.quiet = active === 0 ? w.quiet + dt : 0;
  while (w.gi < p.groups.length && w.t >= p.groups[w.gi].at) spawnGroup(w, p.groups[w.gi++]);
  if (w.gi < p.groups.length && w.quiet > 3) { spawnGroup(w, p.groups[w.gi++]); w.quiet = 0; }
}

/** Notoriety's teeth. Three flags brings hunters in off the rim; five brings a legendary. */
export function hunt(w: World, dt: number) {
  let hunters = 0;
  for (const e of w.foes) if (e.hunter && hostile(e)) hunters++;
  const s = w.ship;

  // Hunters ride along with a wave; they do not outlast it. Once the last of the fleet
  // is off the water, nobody new comes, or a notorious captain could never get home.
  let fleet = w.gi < w.plan.groups.length;
  for (const e of w.foes) if (!e.hunter && hostile(e)) { fleet = true; break; }
  if (w.heat >= HUNTER_AT && fleet) {
    w.hunterT -= dt;
    if (w.hunterT <= 0 && hunters < 2) {
      // From the nearest point on the rim that is still out of sight.
      const opts = w.map.spawns.filter((p) => Math.hypot(p.x - s.x, p.y - s.y) > 380);
      const p = opts.length ? opts.reduce((a, b) =>
        Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a) : w.map.spawns[0];
      const e = addFoe(w, HUNTER_CLASS, p.x, p.y, Math.atan2(s.y - p.y, s.x - p.x), newSquad(w, p.x, p.y));
      e.hunter = true; e.state = 'engage'; e.alert = true;
      w.hunterT = 16;
      ev(w, 'hunter', { id: e.id });
    }
  }
  if (w.heat >= EARLY_LEGEND_AT && !w.earlyLegend && !w.plan.boss && !w.boss) {
    w.earlyLegend = true;
    const far = w.map.spawns.reduce((a, b) =>
      Math.hypot(b.x - s.x, b.y - s.y) > Math.hypot(a.x - s.x, a.y - s.y) ? b : a);
    addLegend(w, LEGENDS[Math.floor(w.r() * LEGENDS.length)], far.x, far.y);
  }
}
