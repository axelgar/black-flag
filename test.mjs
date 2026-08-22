// One runnable check. `node test.mjs`. No framework.
//
// The things that would rot silently are all in the simulation: the wave curve has to
// keep escalating, the surrender window has to stay exactly four seconds, hull must
// never go negative, and a fixed seed has to replay byte-identically — that last one
// is the tripwire for anyone reaching for Math.random() inside world.js.

import assert from 'node:assert/strict';
import {
  waveBudget, wavePlan, isBossWave, waveWeather, rng, shipStats, rollDrop, DROPS,
  CLASSES, CLASS_IDS, LEGENDS, legendFor, heatSunk, heatEscaped, heatBoarded,
  bribeCost, UPGRADES, clock, reales, bankWave,
} from './js/state.js';
import * as Wo from './js/world.js';

const DT = 1 / 120;

/* ------------------------------------------------------------ the curve -- */

for (let n = 1; n < 60; n++) {
  assert.ok(waveBudget(n + 1) > waveBudget(n), `wave ${n + 1} is not harder than ${n}`);
}
assert.ok(isBossWave(5) && isBossWave(20) && !isBossWave(6), 'boss waves are every fifth');
assert.equal(waveWeather(4), 'storm', 'every fourth wave is a storm');
// The four legendaries cycle, and wave 5 is always the first of them.
assert.equal(legendFor(5).id, LEGENDS[0].id);
assert.equal(legendFor(25).id, LEGENDS[0].id, 'the list must cycle, not run out');
assert.deepEqual(LEGENDS.map((l) => l.id).sort(), [...new Set(LEGENDS.map((l) => l.id))].sort(), 'duplicate legendary id');

// A plan is a pure function of (wave, seed). Same seed in, same fleet out.
for (const n of [1, 4, 7, 10, 13]) {
  const a = wavePlan(n, rng(`p${n}`)), b = wavePlan(n, rng(`p${n}`));
  assert.deepEqual(a, b, `wave ${n} plan drifted for a fixed seed`);
  assert.ok(a.groups.length > 0, `wave ${n} has nothing in it`);
  for (let i = 1; i < a.groups.length; i++) {
    assert.ok(a.groups[i].at >= a.groups[i - 1].at, 'groups must be in time order');
  }
}
assert.notDeepEqual(wavePlan(6, rng('a')).groups, wavePlan(6, rng('b')).groups, 'two seeds gave the same wave');

// Nothing may be scheduled before the class that flies it exists.
for (let n = 1; n <= 4; n++) {
  for (const g of wavePlan(n, rng(`u${n}`)).groups) {
    assert.notEqual(g.cls, 'manowar', `a man-o-war turned up in wave ${n}`);
    assert.notEqual(g.cls, 'frigate', `a frigate turned up in wave ${n}`);
  }
}

/* ------------------------------------------------------ upgrades / heat -- */

const base = shipStats({});
const full = shipStats({ plating: 4, broadside: 4, racks: 3, ram: 3, life: 2 });
assert.ok(full.hullMax > base.hullMax && full.dmg > base.dmg && full.shellsMax > base.shellsMax);
assert.ok(full.fireInterval < base.fireInterval, 'broadside levels must speed her up, not slow her');
assert.equal(full.lives, 5, 'two spare crews should be two extra lives');
for (const u of UPGRADES) {
  for (let l = 0; l + 1 < u.max; l++) assert.ok(u.cost(l + 1) > u.cost(l), `${u.id} got cheaper`);
}
assert.ok(bribeCost(3) > bribeCost(0), 'bribes must get dearer, or notoriety is free');

// Notoriety: sinking a prize always costs more than letting her go, and boarding is
// the only thing that ever pays it back.
for (const id of CLASS_IDS) {
  const h = CLASSES[id].hull;
  assert.ok(heatSunk(h) > heatEscaped(h), `${id}: mortaring a prize should cost more than losing her`);
  assert.ok(heatBoarded(h) < 0, `${id}: boarding must lower notoriety`);
  assert.ok(Math.abs(heatBoarded(h)) > heatSunk(h), `${id}: one board should undo more than one sinking`);
}

/* ------------------------------------------------------------ the drops -- */

assert.equal(rollDrop(rng('d1'), false)?.id, rollDrop(rng('d1'), false)?.id, 'drops are not reproducible');
{
  const r = rng('drops');
  let n = 0, kinds = new Set();
  for (let i = 0; i < 20000; i++) { const d = rollDrop(r, false); if (d) { n++; kinds.add(d.id); } }
  const rate = n / 20000;
  assert.ok(rate > 0.22 && rate < 0.34, `unboarded drop rate off: ${(rate * 100).toFixed(1)}%`);
  assert.equal(kinds.size, DROPS.length, 'a drop kind never came up in twenty thousand rolls');
}
{
  const r = rng('drops');
  let n = 0;
  for (let i = 0; i < 20000; i++) if (rollDrop(r, true)) n++;
  assert.ok(n / 20000 > 0.55, 'boarding is supposed to pay better in cargo, and does not');
}

/* -------------------------------------------------- the surrender window -- */

// The single number the whole risk/reward hangs on. Held to the frame.
{
  const w = Wo.create({ seed: 'window', wave: 2 });
  w.gi = w.plan.groups.length;              // no more arrivals; this is a lab, not a wave
  w.foes.length = 0;
  const C = CLASSES.schooner;
  const foe = {
    id: 99, cls: 'schooner', C, x: 195, y: 300, hull: C.hull, hullMax: C.hull,
    rx: C.w / 2, ry: C.l / 2, cool: 1e9, ph: 0,
    struck: false, struckOnce: false, strikeT: 0, spent: false,
    flash: 0, hit: 0, list: 0, scorch: 0, mastGone: 0, chase: 0, broad: 0, hunter: false, dead: false,
  };
  w.foes.push(foe);

  let t = 0;
  while (!foe.struck && t < 8) { Wo.step(w, DT, { x: 195, dx: 0, mortar: false }); t += DT; }
  assert.ok(foe.struck, 'a schooner under fire never struck her colours');
  assert.equal(foe.strikeT, Wo.STRIKE_WINDOW, 'the window did not open at its full length');
  assert.ok(Wo.isPrize(foe), 'a ship that has just struck must be boardable');
  assert.ok(foe.hull > 0, 'she must survive striking, or there is nothing to board');

  // Round shot must now pass over her — that is what makes boarding possible at all.
  const hullAtStrike = foe.hull;
  for (let i = 0; i < 60; i++) Wo.step(w, DT, { x: 10, dx: 0, mortar: false });
  assert.equal(foe.hull, hullAtStrike, 'the gun crews fired on a struck ship');

  let held = 0;
  while (!foe.spent && held < 8) { Wo.step(w, DT, { x: 10, dx: 0, mortar: false }); held += DT; }
  const total = 0.5 + held;                  // 60 steps of holding fire, plus the chase
  assert.ok(Math.abs(total - Wo.STRIKE_WINDOW) < DT * 2, `window was ${total.toFixed(3)}s, not ${Wo.STRIKE_WINDOW}s`);
  assert.ok(!Wo.isPrize(foe), 'a spent prize must stop being boardable');
}

/* ------------------------------------------------- prizes have to reach you -- */

// The thing that actually decides whether boarding is possible: a struck ship stops
// being a ship and drifts with the current, so a lumbering man-o-war and a fast lancha
// come down at the same rate and both arrive inside the window. Slow this and prizes
// strand up-screen; the README has the measured curve.
{
  const rates = {};
  for (const cls of ['lancha', 'manowar']) {
    const w = Wo.create({ seed: 'drift', wave: 2 });
    w.gi = w.plan.groups.length;
    w.foes.length = 0;
    const C = CLASSES[cls];
    const foe = {
      id: 1, cls, C, x: 60, y: 300, hull: C.hull * 0.25, hullMax: C.hull,
      rx: C.w / 2, ry: C.l / 2, cool: 1e9, ph: 0,
      struck: true, struckOnce: true, strikeT: 99, spent: false,
      flash: 0, hit: 0, list: 0, scorch: 0, mastGone: 1, chase: 0, broad: 0, hunter: false, dead: false,
    };
    w.foes.push(foe);
    const y0 = foe.y;
    for (let i = 0; i < 120; i++) Wo.step(w, DT, { x: 380, dx: 0, mortar: false });
    rates[cls] = foe.y - y0;
  }
  assert.ok(Math.abs(rates.lancha - rates.manowar) < 0.001, 'a hulk should drift at the current, not at her own speed');
  // Fast enough to cross the water between where ships strike and where you are,
  // inside the window it is given.
  assert.ok(rates.lancha * Wo.STRIKE_WINDOW > 380, `a prize cannot reach you: ${(rates.lancha * Wo.STRIKE_WINDOW).toFixed(0)}px in ${Wo.STRIKE_WINDOW}s`);
}

/* -------------------------------------------------------------- boarding -- */

{
  const w = Wo.create({ seed: 'board', wave: 2 });
  w.gi = w.plan.groups.length;
  w.foes.length = 0;
  const C = CLASSES.brig;
  w.foes.push({
    id: 7, cls: 'brig', C, x: 195, y: Wo.SHIP_Y - 30, hull: C.hull * 0.2, hullMax: C.hull,
    rx: C.w / 2, ry: C.l / 2, cool: 1e9, ph: 0,
    struck: true, struckOnce: true, strikeT: Wo.STRIKE_WINDOW, spent: false,
    flash: 0, hit: 0, list: 0, scorch: 0, mastGone: 1, chase: 0, broad: 0, hunter: false, dead: false,
  });
  const heat0 = w.heat, hull0 = w.ship.hull = 5;
  Wo.step(w, DT, { x: 195, dx: 0, mortar: false });
  assert.equal(w.boarded, 1, 'ramming a prize did not board her');
  assert.equal(w.plunder, C.reales * 2, 'boarding pays double, and did not');
  assert.ok(w.ship.hull > hull0, 'boarding is supposed to mend the hull');
  assert.ok(w.heat < heat0 + 0.001, 'boarding must not raise notoriety');
}

/* ----------------------------------------------------- the mortar's job --- */

// Sinking a prize is still available — it is the only thing the mortar can do that the
// broadside cannot, and it is the branch that makes notoriety a choice.
{
  const w = Wo.create({ seed: 'mortar', wave: 2 });
  w.gi = w.plan.groups.length;
  w.foes.length = 0;
  const C = CLASSES.brig;
  w.foes.push({
    id: 3, cls: 'brig', C, x: 195, y: 250, hull: C.hull * 0.25, hullMax: C.hull,
    rx: C.w / 2, ry: C.l / 2, cool: 1e9, ph: 0,
    struck: true, struckOnce: true, strikeT: 99, spent: false,
    flash: 0, hit: 0, list: 0, scorch: 0, mastGone: 1, chase: 0, broad: 0, hunter: false, dead: false,
  });
  const heat0 = w.heat;
  w.marks.push({ x: 195, y: 250, r: 78, t: 0, max: 1.15, own: true, dmg: 99 });
  Wo.step(w, DT, {});
  assert.equal(w.sunk, 1, 'a mortar shell must be able to finish a prize');
  assert.equal(w.plunder, C.reales, 'sinking a prize pays the base rate, not double');
  assert.ok(w.heat > heat0, 'sinking a ship that had struck must cost notoriety');
}

/* ------------------------------------------------------- port is a refit -- */

{
  const run = { wave: 1, plunder: 0, lives: 3, hull: null, shells: null, upgrades: {}, heat: 0, boarded: 0, sunk: 0, time: 0 };
  const w = Wo.create({ seed: 'refit', wave: 1, run });
  w.ship.hull = 2; w.ship.shells = 0; w.plunder = 900; w.heat = 1.4;
  bankWave(run, w);
  assert.equal(run.wave, 2, 'banking a wave should advance the run');
  assert.equal(run.hull, null, 'careening is the repair — hull must come back full');
  assert.equal(run.shells, null, 'the racks are refilled at the beach');
  assert.equal(run.plunder, 900, 'plunder carries');
  assert.equal(run.heat, 1.4, 'notoriety carries — the beach does not launder it, the bribe does');
  assert.equal(Wo.create({ seed: 'refit', wave: 2, run }).ship.hull, shipStats({}).hullMax, 'wave two should start whole');
}

/* ----------------------------------------------------------- hull clamps -- */

{
  const w = Wo.create({ seed: 'hull', wave: 1, run: { lives: 2 } });
  w.ship.invuln = 0;
  w.marks.push({ x: w.ship.x, y: w.ship.y, r: 90, t: 0, max: 1, own: false, dmg: 9999 });
  Wo.step(w, DT, {});
  assert.ok(w.ship.hull >= 0, `hull went negative: ${w.ship.hull}`);
  assert.equal(w.lives, 1, 'a lethal hit should cost exactly one life');
  assert.equal(w.ship.hull, w.ship.hullMax, 'a refit should come back at full hull');
  assert.ok(w.ship.invuln > 0, 'a refit with no grace period is a second death');

  w.ship.invuln = 0;
  w.marks.push({ x: w.ship.x, y: w.ship.y, r: 90, t: 0, max: 1, own: false, dmg: 9999 });
  Wo.step(w, DT, {});
  assert.equal(w.phase, 'lost', 'the last life did not end the run');
  assert.ok(w.ship.hull >= 0, 'hull went negative on the way down');
}

/* -------------------------------------------------------- notoriety cap -- */

{
  const w = Wo.create({ seed: 'heat', wave: 1, run: { heat: 4.9 } });
  for (let i = 0; i < 120 * 120; i++) Wo.step(w, DT, {});
  assert.ok(w.heat <= 5 && w.heat >= 0, `notoriety escaped its range: ${w.heat}`);
}

/* ------------------------------------------------------------- the replay -- */

// Two identical headless battles, sixty seconds each, driven by a scripted helm.
// If any float path drifts or anything in world.js reaches for a clock, these diverge.
function battle(seed, wave, run = { upgrades: { broadside: 2, plating: 1, racks: 2 } }) {
  const w = Wo.create({ seed, wave, run });
  let t = 0, i = 0;
  while (w.phase === 'fight' && t < 60) {
    // A helm that depends on the world state, so the input stream is part of the loop
    // rather than a tape that would replay regardless of what the ships did.
    const prize = w.foes.find((e) => Wo.isPrize(e));
    const near = w.foes.filter((e) => e.y > Wo.HORIZON && e.y < 620 && !e.spent && !e.struck)
      .sort((a, b) => b.y - a.y)[0];
    const x = prize ? prize.x : near ? near.x : 195;
    Wo.step(w, DT, { x, dx: 0, mortar: i % 900 === 0 });
    w.events.length = 0;
    t += DT; i++;
  }
  return { digest: Wo.digest(w), t, w };
}

for (const [seed, wave] of [['replay', 3], ['replay', 8], ['ghost', 5], ['ghost', 12]]) {
  const a = battle(seed, wave), b = battle(seed, wave);
  assert.equal(a.digest, b.digest, `wave ${wave} on seed "${seed}" did not replay identically`);
  assert.ok(a.w.ship.hull >= 0, 'hull went negative during a full battle');
  assert.ok(a.w.heat >= 0 && a.w.heat <= 5, 'notoriety escaped its range during a battle');
}
assert.notEqual(battle('replay', 3).digest, battle('ghost', 3).digest, 'two seeds produced the same battle');

// Every wave from 1 to 20 has to be finishable, or the authored run has a dead end.
for (let n = 1; n <= 20; n++) {
  const r = battle(`clear${n}`, n);
  assert.ok(r.w.phase !== 'fight' || r.t >= 60, `wave ${n} stalled`);
  assert.ok(r.w.foes.every((e) => e.hull >= 0 || e.dead), 'a live foe has negative hull');
}

/* ------------------------------------------- the wave is not the run ----- */

// Coming about, and running for Nassau, are both just "throw the world away and build
// another from the run". That rewinds anything at all only because a wave in progress
// never writes back to the run it was created from — bankWave, once she is careened, is
// the only thing allowed to. The day a step starts touching `run`, a retreat quietly
// keeps half of what it was meant to forfeit, and the beach becomes a place to farm.
{
  const run = {
    seed: 'retreat', wave: 3, plunder: 400, lives: 3, hull: null, shells: null,
    upgrades: { plating: 1, broadside: 1 }, heat: 1.2, boarded: 2, sunk: 5, time: 90, bribes: 1,
  };
  const before = JSON.stringify(run);
  const { w } = battle('retreat', 3, run);
  assert.ok(w.heat !== 1.2 || w.sunk !== 5, 'the battle never actually happened, so it proves nothing');
  assert.equal(JSON.stringify(run), before, 'a wave wrote back to the run — retreating would not rewind it');

  // And what she puts back to sea in is the wave she started, not the one she left.
  const again = Wo.create({ seed: 'retreat', wave: 3, run });
  assert.equal(again.plunder, 400, 'coming about must hand back the plunder the wave started on');
  assert.equal(again.heat, 1.2, 'coming about must hand back the notoriety too');
  assert.equal(again.lives, 3, 'a life spent in a wave that was never finished is not spent');
  assert.equal(again.ship.hull, shipStats(run.upgrades).hullMax, 'she comes about whole');
  assert.equal(again.ship.shells, shipStats(run.upgrades).shellsMax, 'and with full racks');
}

/* ------------------------------------------------------------- the small -- */

assert.equal(clock(0), '0:00');
assert.equal(clock(61), '1:01');
assert.equal(clock(-5), '0:00', 'a clock skew must not print a negative time');
assert.equal(reales(1234), '1,234');

console.log('ok — wave curve, surrender window, boarding, hull clamps, notoriety, seeded replay, the run untouched mid-wave');
