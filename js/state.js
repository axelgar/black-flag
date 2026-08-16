// Ship classes, the wave curve, notoriety, upgrades, persistence.
// Pure: no DOM, no d3 — so `node test.mjs` can import it. The simulation that
// consumes all of this lives in js/world.js, which is pure for the same reason.

export const W = 390, H = 844;

/* ---------------------------------------------------------------- rng ---- */

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 — same seed, same fleet, forever. */
export function rng(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------- fleet ----- */

// `str` is whether she strikes her colours. The brulote is the one that never does,
// which is the whole reason she is in the table.
// `hull` is hits-to-sink at base broadside, so the numbers read as the brief did.
export const CLASSES = {
  lancha: {
    id: 'lancha', name: 'Lancha', rank: 'Gunboat', hull: 3, speed: 128, reales: 25,
    w: 19, l: 33, guns: null, masts: 1, str: true, ram: 5,
    note: 'An open launch with a swivel gun and eleven angry men. She cannot shoot you, so she aims to hit you.',
  },
  schooner: {
    id: 'schooner', name: 'Schooner', rank: 'Raider', hull: 5, speed: 106, reales: 50,
    w: 25, l: 46, guns: 'aimed', reload: 2.2, masts: 2, str: true, ram: 6,
    note: 'Fore-and-aft rigged and quick on the helm. She slides across the swell to keep you in her sights.',
  },
  brig: {
    id: 'brig', name: 'Brig', rank: 'Escort', hull: 9, speed: 74, reales: 120,
    w: 33, l: 60, guns: 'spread', reload: 2.0, masts: 2, str: true, ram: 8,
    note: 'Square-rigged, stubborn, holds her lane and throws a two-shot spread down it.',
  },
  frigate: {
    id: 'frigate', name: 'Frigate', rank: 'Ship of the line', hull: 17, speed: 50, reales: 300,
    w: 43, l: 78, guns: 'broadside', reload: 3.4, masts: 3, str: true, ram: 11,
    note: 'Turns her side to you and fires a wall of five. The turn is the tell — cross her bow, never her beam.',
  },
  manowar: {
    id: 'manowar', name: 'Man-o-war', rank: 'Flagship', hull: 32, speed: 32, reales: 800,
    w: 57, l: 102, guns: 'mortar', reload: 3.8, masts: 3, str: true, ram: 15,
    note: 'A hundred guns and a mortar deck. The rings on the water are where the shells are already falling.',
  },
  brulote: {
    id: 'brulote', name: 'Brulote', rank: 'Fire ship', hull: 3, speed: 84, reales: 0,
    w: 21, l: 37, guns: null, masts: 1, str: false, ram: 0, fuse: 70,
    note: 'Pitch, tar and powder, crewed by men who mean to leave by boat. She does not surrender. She arrives.',
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

// Legendaries. They do not strike their colours, they have gun ports worth aiming at,
// and beating one only means it goes in the log — the endless run brings it back.
export const LEGENDS = [
  {
    id: 'impoluto', name: 'El Impoluto', hull: 120, w: 132, l: 150, speed: 26, reales: 2600,
    pattern: 'sweep', ports: 6,
    note: 'A hundred and forty guns and never once holed. She sweeps her broadside across the whole width of the sea.',
  },
  {
    id: 'dama', name: 'La Dama Negra', hull: 140, w: 118, l: 158, speed: 30, reales: 3000,
    pattern: 'shroud', ports: 4,
    note: 'Black hull, black canvas, a fog of her own making. She sends the launches in first and fires through them.',
  },
  {
    id: 'prince', name: 'HMS Prince', hull: 165, w: 140, l: 166, speed: 22, reales: 3400,
    pattern: 'rain', ports: 8,
    note: 'English, and a long way from home. Her mortar deck writes rings on the water faster than you can read them.',
  },
  {
    id: 'fortuna', name: 'La Fortuna', hull: 185, w: 124, l: 152, speed: 40, reales: 4000,
    pattern: 'spiral', ports: 6,
    note: 'The treasure ship. Fast for her weight, and she would rather run you down than out-shoot you.',
  },
];

export const legendById = (id) => LEGENDS.find((l) => l.id === id) || LEGENDS[0];
/** Boss waves come round every fifth. Wave 5 is the first, then they cycle. */
export const legendFor = (wave) => LEGENDS[(Math.floor(wave / 5) - 1 + LEGENDS.length * 4) % LEGENDS.length];

/* -------------------------------------------------------------- waves ---- */

const UNLOCK = { lancha: 1, schooner: 2, brig: 3, brulote: 5, frigate: 6, manowar: 9 };
const COST   = { lancha: 1, schooner: 2, brig: 4, brulote: 3, frigate: 8, manowar: 14 };
const PATTERNS = ['line', 'vee', 'stagger', 'column', 'sides'];

export const isBossWave = (n) => n % 5 === 0;

/** Strictly increasing, by construction. test.mjs holds it to that. */
export const waveBudget = (n) => Math.round(6 + n * 3.4 + n * n * 0.22);

/** Storms every fourth wave; a fog bank on a slower cycle so the two rarely collide. */
export function waveWeather(n) {
  if (n % 4 === 0) return 'storm';
  if (n >= 6 && n % 3 === 2) return 'fog';
  return 'clear';
}

/**
 * The spawn script for a wave. Deterministic in (n, r) and nothing else — no clock,
 * no Math.random — so a seed replays the same fleet in the same order every time.
 */
export function wavePlan(n, r) {
  const boss = isBossWave(n);
  const groups = [];
  let last = 0;

  if (boss) {
    groups.push({ at: 1.6, cls: 'legend', n: 1, pat: 'solo', x: 0.5, legend: legendFor(n).id });
    // Escorts trickle in behind her so the fight is never just the boss.
    const waves = Math.min(5, 1 + Math.floor(n / 5));
    for (let i = 0; i < waves; i++) {
      groups.push({ at: 9 + i * 11, cls: n >= 10 ? 'schooner' : 'lancha', n: 3, pat: 'line', x: r() });
    }
    last = 9 + (waves - 1) * 11;
  } else {
    let budget = waveBudget(n), at = 1.4, guard = 0;
    const pool = CLASS_IDS.filter((k) => n >= UNLOCK[k]);
    while (budget > 0 && guard++ < 48) {
      const afford = pool.filter((k) => COST[k] <= budget);
      if (!afford.length) break;
      const cls = afford[Math.floor(r() * afford.length)];
      const most = cls === 'lancha' ? 4 : cls === 'schooner' ? 3 : cls === 'brig' ? 2 : 1;
      const count = Math.min(Math.max(1, Math.floor(budget / COST[cls])), 1 + Math.floor(r() * most));
      budget -= COST[cls] * count;
      groups.push({ at, cls, n: count, pat: PATTERNS[Math.floor(r() * PATTERNS.length)], x: r() });
      at += Math.max(1.7, 4.6 - n * 0.11) + r() * 1.7;
    }
    last = at;
    // Reefs from wave 4 — cover as much as hazard, so they are scattered through, not stacked.
    if (n >= 4) {
      const rocks = 2 + Math.floor(r() * (2 + n / 4));
      for (let i = 0; i < rocks; i++) groups.push({ at: 3 + r() * Math.max(1, at - 4), cls: 'reef', n: 1, pat: 'solo', x: r() });
    }
    if (n >= 12) groups.push({ at: at * 0.5, cls: 'spout', n: 1, pat: 'solo', x: r() });
  }

  groups.sort((a, b) => a.at - b.at);   // stable since ES2019, so ties keep their draw order
  return { wave: n, boss, weather: waveWeather(n), groups, last };
}

/* --------------------------------------------------------- notoriety ----- */

export const HEAT_MAX = 5;
export const HEAT = { perSecond: 0.012, bribe: -2 };

// Notoriety is a question about witnesses, which is why all three numbers scale with
// the size of the crew: a launch and a man-o-war are not the same news in Havana.
/** You mortared a ship that had already struck. Nobody survives that, but everyone hears it. */
export const heatSunk   = (hullMax) => 0.06 + hullMax * 0.012;
/** She struck, you never came for her, and she limped home to describe you. */
export const heatEscaped = (hullMax) => (0.06 + hullMax * 0.012) * 0.5;
/** Boarded. No survivors, no report, and a hold full of someone else's cargo. */
export const heatBoarded = (hullMax) => -(0.25 + hullMax * 0.014);
export const HUNTER_AT = 3;    // hunter frigates enter from the sides
export const EARLY_LEGEND_AT = 5;
export const heatFlags = (h) => clamp(Math.floor(h), 0, HEAT_MAX);

/* ---------------------------------------------------------- upgrades ----- */

export const UPGRADES = [
  { id: 'plating',   name: 'Hull plating',   note: '+8 hull',                max: 4, cost: (l) => Math.round(200 * Math.pow(1.55, l)) },
  { id: 'broadside', name: 'Broadside',      note: 'harder, faster round shot', max: 4, cost: (l) => Math.round(240 * Math.pow(1.55, l)) },
  { id: 'racks',     name: 'Mortar racks',   note: '+2 shells a wave',       max: 3, cost: (l) => Math.round(180 * Math.pow(1.6, l)) },
  { id: 'ram',       name: 'Reinforced ram', note: 'boarding mends more',    max: 3, cost: (l) => Math.round(210 * Math.pow(1.6, l)) },
  { id: 'life',      name: 'Spare crew',     note: '+1 life',                max: 2, cost: (l) => [700, 1250][l] ?? 9999 },
];
export const bribeCost = (times) => Math.round(160 * Math.pow(1.75, times));

/** Everything the Jackdaw's numbers derive from. One place, so the port screen and
 *  the simulation can never disagree about what a level actually bought. */
export function shipStats(up = {}) {
  const p = up.plating | 0, b = up.broadside | 0, r = up.racks | 0, m = up.ram | 0;
  return {
    hullMax: 20 + p * 8,
    dmg: 1 + b * 0.5,
    fireInterval: 0.30 * Math.pow(0.87, b),
    shellsMax: 3 + r * 2,
    boardRepair: 6 + m * 3,
    ramDmg: 2 + m * 2,
    lives: 3 + (up.life | 0),
  };
}

/* ------------------------------------------------------------- drops ----- */

// dur -1 means "the rest of this wave".
export const DROPS = [
  { id: 'rum',    label: 'Rum barrel',  short: 'RUM',    odds: 26, dur: 0 },
  { id: 'shells', label: 'Shells',      short: 'SHELLS', odds: 20, dur: 0 },
  { id: 'powder', label: 'Powder keg',  short: 'POWDER', odds: 16, dur: 12 },
  { id: 'heavy',  label: 'Heavy shot',  short: 'HEAVY',  odds: 14, dur: 12 },
  { id: 'chain',  label: 'Chain shot',  short: 'CHAIN',  odds: 12, dur: 12 },
  { id: 'swivel', label: 'Swivel crew', short: 'SWIVEL', odds: 8,  dur: -1 },
];
const DROP_TOTAL = DROPS.reduce((a, d) => a + d.odds, 0);

/** Boarding pays better in cargo as well as coin — that is most of why you board. */
export function rollDrop(r, boarded) {
  if (r() > (boarded ? 0.62 : 0.28)) return null;
  let p = r() * DROP_TOTAL;
  for (const d of DROPS) { p -= d.odds; if (p <= 0) return d; }
  return DROPS[0];
}

/* ------------------------------------------------------------ session ---- */

const KEY = 'blackflag.log';

const blank = () => ({
  sound: true, haptics: true, reduceMotion: false,
  records: { bestWave: 0, bestPlunder: 0, bestTime: 0, runs: 0, boarded: 0, sunk: 0, legends: 0 },
  seen: {},        // class id → times met
  beaten: {},      // legend id → times beaten
  run: null,       // the live run, so a reload at port does not scuttle it
  lastRun: null,   // the summary #/dead reads, kept so a reload there still shows it
});

export const session = load();

// The path the router last left. Screens reachable from more than one place read it
// so their ✕ goes back where the guest came from. Deliberately not persisted.
export const nav = { from: null };

function load() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch { return blank(); }
}

export function save() {
  // ponytail: localStorage only. A leaderboard needs a backend and an identity;
  // until then the record book is honest about being this device's record book.
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
}

/* ---------------------------------------------------------------- run ---- */

export function newRun(seed) {
  session.run = {
    seed, wave: 1, plunder: 0, lives: 3, hull: null, shells: null,
    upgrades: {}, heat: 0, boarded: 0, sunk: 0, time: 0, bribes: 0, legends: 0,
  };
  save();
  return session.run;
}

/** Called when a wave is survived — the run's carry-over into the next one. */
export function bankWave(run, w) {
  run.wave = w.wave + 1;
  run.plunder = w.plunder;
  run.lives = w.lives;
  run.heat = w.heat;
  run.boarded = w.boarded;
  run.sunk = w.sunk;
  run.legends = (run.legends || 0) + (w.plan.boss ? 1 : 0);
  run.time += w.t;
  // Careening IS the repair — that is what the beach is for. Hull and shells both come
  // back full, so hull is the thing you spend inside a wave and lives are the thing you
  // spend across a run. Leaving her at five hull made the port a shop, not a refit.
  run.hull = null;
  run.shells = null;
  save();
  return run;
}

export function meet(clsId) {
  session.seen[clsId] = (session.seen[clsId] || 0) + 1;
  // not saved here — the sim meets a hundred ships a wave. app.js saves at wave end.
}

export function beat(legendId) {
  session.beaten[legendId] = (session.beaten[legendId] || 0) + 1;
  session.records.legends = Object.values(session.beaten).reduce((a, b) => a + b, 0);
  save();
}

/** Fold a finished run into the record book and clear it. */
export function endRun(run, w) {
  const rec = session.records;
  const wave = w ? w.wave : run.wave;
  const time = run.time + (w ? w.t : 0);
  rec.runs++;
  rec.bestWave = Math.max(rec.bestWave, wave);
  rec.bestPlunder = Math.max(rec.bestPlunder, w ? w.plunder : run.plunder);
  rec.bestTime = Math.max(rec.bestTime, time);
  // The world's tallies are cumulative for the whole run — bankWave carries them from
  // wave to wave — so the run's totals go in whole. Adding only the last wave's delta
  // is how the record book came to say nought boarded after a run that boarded twelve.
  const boarded = w ? w.boarded : run.boarded;
  const sunk = w ? w.sunk : run.sunk;
  rec.boarded += boarded;
  rec.sunk += sunk;
  const out = { wave, time, plunder: w ? w.plunder : run.plunder, boarded, sunk };
  session.run = null;
  save();
  return out;
}

export const reales = (n) => Math.round(n).toLocaleString('en-GB');
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
