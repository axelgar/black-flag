// The paint. Three stacked 2D canvases and nothing else:
//
//   sea (world + weather)  →  fleet (hulls, shot, cargo)  →  fx (everything ephemeral)
//
// No WebGL, deliberately — a top-down naval battle is flat painting, which is what
// oddish's own world and overlay layers already were. d3 does the parts that are not
// drawing: interpolateLab ramps for sea depth and sail shading, and the easings.
//
// Everything here reads a world snapshot and never writes to it. The simulation does
// not know this file exists.

import { interpolateLab, quantize, easeCubicOut } from 'd3';
import { W, H, rng, clamp, session } from './state.js';
import { HORIZON, SHIP_Y, SCROLL, isPrize } from './world.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const TAU = Math.PI * 2;
const MQ_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
/** OS preference OR the in-app toggle — the toggle has to actually do it. */
export const reduced = () => MQ_REDUCED.matches || session.reduceMotion;

/* ------------------------------------------------------------- palette --- */

const WEATHER = {
  clear: { sky: ['#7FB0C0', '#BDD2CB', '#E4D9B4'], haze: '#9FBFC2', deep: '#0D3547', near: '#1E6E7C', crest: 'rgba(226,244,240,.30)', foam: '#D6ECE6' },
  storm: { sky: ['#20303B', '#33414B', '#4C5760'], haze: '#3E525C', deep: '#08202C', near: '#12414C', crest: 'rgba(190,214,214,.24)', foam: '#A9C4C6' },
  fog:   { sky: ['#A8B7B6', '#C3C9BE', '#D4D0BC'], haze: '#B4C2BE', deep: '#1B4450', near: '#2F6A6E', crest: 'rgba(240,248,244,.26)', foam: '#E2ECE6' },
  port:  { sky: ['#1B2A3E', '#3A3350', '#7A4A44'], haze: '#4A3E50', deep: '#0B1E2C', near: '#183C46', crest: 'rgba(230,200,150,.20)', foam: '#C8B48E' },
};

// Spanish navy: oak, tar and a lot of cream canvas. The Jackdaw is darker than any
// of them on purpose — at a glance you should never be looking for yourself.
const SPANISH = { hull: '#4B3624', deck: '#B08C5A', rail: '#2C2015', sail: '#E7DDC5', trim: '#8E2B24' };
const JACKDAW = { hull: '#2F2C28', deck: '#A8834B', rail: '#15130F', sail: '#CFC3A2', trim: '#8E2B24' };
const LEGENDCOL = {
  impoluto: { hull: '#5A4830', deck: '#C7A470', rail: '#33260F', sail: '#F2EAD4', trim: '#C9A227' },
  dama:     { hull: '#1C1A20', deck: '#4C4552', rail: '#0B0A0D', sail: '#2A2732', trim: '#7B2B3A' },
  prince:   { hull: '#4A2C22', deck: '#C39A63', rail: '#241009', sail: '#F0E7D2', trim: '#1E3E7A' },
  fortuna:  { hull: '#5C4126', deck: '#D3AE6B', rail: '#2C1C0C', sail: '#F6EFDA', trim: '#D9A441' },
};

// Depth ramps, in Lab. A canvas gradient interpolates in sRGB and puts a grey bruise
// halfway between two saturated blues; quantizing through interpolateLab first is the
// whole reason the water reads as water at the middle distance.
const rampCache = new Map();
function ramp(a, b, n = 6) {
  const k = `${a}${b}${n}`;
  if (!rampCache.has(k)) rampCache.set(k, quantize(interpolateLab(a, b), n));
  return rampCache.get(k);
}

/* --------------------------------------------------------------- state --- */

export const scene = {
  mode: 'none',        // none | sea | port | play
  world: null,
  weather: 'clear',
  hidden: false,
};

let sctx, fctx, xctx, seaCv, fleetCv, fxCv, flashEl;
let BX = 0;                       // how far past the 390 column the sea is painted
let crestTile = null, crestKey = '';
let fx = [];
let shakeT = 0, shakeAmp = 0, flash = 0, flashCol = '#fff', lightning = 0;
let islands = null;

function layer(canvas) {
  canvas.width = W * DPR; canvas.height = H * DPR;
  const c = canvas.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  return c;
}

/** The sea layer is wider than the column so the water reaches the screen edges on a
 *  phone. The context is translated to match, so every call below still works in
 *  stage coordinates and nothing downstream has to know it happened. */
function sizeSea() {
  seaCv.width = (W + 2 * BX) * DPR;
  seaCv.height = H * DPR;
  seaCv.style.left = `${-BX}px`;
  seaCv.style.right = `${-BX}px`;
  seaCv.style.width = 'auto';
  sctx = seaCv.getContext('2d');
  sctx.setTransform(DPR, 0, 0, DPR, BX * DPR, 0);
  crestKey = '';
}

/** Called by the fitter, which is the only thing that knows the viewport. */
export function setBleed(px) {
  const v = Math.max(0, Math.min(300, Math.ceil(px)));
  if (v === BX || !seaCv) return;
  BX = v;
  sizeSea();
  document.documentElement.style.setProperty('--bx', `${BX}px`);
}

export function mount(sea, fleet, fxc) {
  seaCv = sea; fleetCv = fleet; fxCv = fxc;
  sizeSea();
  fctx = layer(fleet);
  xctx = layer(fxc);
  flashEl = document.getElementById('flash');
  islands = makeIslands();
}

/* ----------------------------------------------------------------- sea --- */

// Distant land. Fixed shapes from a fixed seed — the sea moves, the islands do not,
// which is the only thing that says you are making way rather than treading water.
function makeIslands() {
  const r = rng('nassau');
  return Array.from({ length: 5 }, () => {
    const w = 40 + r() * 90;
    return { x: r() * 460 - 40, w, h: 8 + r() * 16, k: r() };
  });
}

/** The swell, baked once and blitted. Redrawing 30 sine paths a frame was the only
 *  thing on this layer that showed up in a profile. */
function bakeCrests(pal) {
  const key = `${pal.crest}:${BX}`;
  if (crestKey === key) return;
  crestKey = key;
  const w = W + 2 * BX, h = H + 260;
  crestTile = document.createElement('canvas');
  crestTile.width = w * DPR; crestTile.height = h * DPR;
  const c = crestTile.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.lineCap = 'round';
  // 26px bands, phase cycling every ten of them — so the tile repeats seamlessly at 260.
  for (let i = 0; i * 26 < h; i++) {
    const y = i * 26;
    const ph = (i % 10) * 0.63;
    const amp = 3 + (i % 3);
    c.strokeStyle = pal.crest;
    c.globalAlpha = 0.5 + (i % 3) * 0.16;
    c.lineWidth = 0.9 + (i % 4) * 0.3;
    c.beginPath();
    for (let x = -8; x <= w + 8; x += 9) {
      const yy = y + Math.sin(x * 0.031 + ph) * amp + Math.sin(x * 0.0087 + ph * 2) * amp * 0.7;
      x === -8 ? c.moveTo(x, yy) : c.lineTo(x, yy);
    }
    c.stroke();
    // Broken foam on the crest of every third band. Uneven lengths and offsets on
    // purpose — evenly spaced dashes read as a dashed line, not as water.
    if (i % 3 === 0) {
      c.globalAlpha = 0.55;
      c.lineWidth = 1.9;
      let x = ((i * 53) % 90) - 90;
      while (x < w + 60) {
        const len = 8 + ((i * 7 + x) % 17);
        const yy = y + Math.sin(x * 0.031 + ph) * amp - 1.5;
        c.beginPath(); c.moveTo(x, yy); c.lineTo(x + len, yy + Math.sin((x + len) * 0.031 + ph) * amp - Math.sin(x * 0.031 + ph) * amp); c.stroke();
        x += len + 26 + ((i * 11 + x) % 46);
      }
    }
    c.globalAlpha = 1;
  }
}

function drawSea(T, dt) {
  const pal = WEATHER[scene.mode === 'port' ? 'port' : scene.weather] || WEATHER.clear;
  const c = sctx;
  const x0 = -BX, ww = W + 2 * BX;

  // sky
  const sky = c.createLinearGradient(0, 0, 0, HORIZON + 14);
  sky.addColorStop(0, pal.sky[0]); sky.addColorStop(0.62, pal.sky[1]); sky.addColorStop(1, pal.sky[2]);
  c.fillStyle = sky; c.fillRect(x0, 0, ww, HORIZON + 14);

  // islands, with a whisper of parallax so they read as far rather than painted on
  const px = (scene.world ? scene.world.scroll : T * SCROLL) * 0.012;
  c.save();
  c.beginPath(); c.rect(x0, 0, ww, HORIZON); c.clip();
  for (const is of islands) {
    const x = ((is.x - px) % 520 + 520) % 520 - 65;
    c.fillStyle = `rgba(30,52,54,${0.2 + is.k * 0.24})`;
    c.beginPath();
    c.moveTo(x, HORIZON);
    c.quadraticCurveTo(x + is.w * 0.3, HORIZON - is.h * (1 + is.k), x + is.w * 0.55, HORIZON - is.h * 0.6);
    c.quadraticCurveTo(x + is.w * 0.8, HORIZON - is.h * 1.4, x + is.w, HORIZON);
    c.closePath(); c.fill();
  }
  c.restore();

  // haze band where the water meets the sky
  const hz = c.createLinearGradient(0, HORIZON - 16, 0, HORIZON + 22);
  hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.5, pal.haze); hz.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = hz; c.fillRect(x0, HORIZON - 16, ww, 38);

  // the water: far and dark at the horizon, near and lit at your own stern
  const sea = c.createLinearGradient(0, HORIZON, 0, H);
  const up = ramp(pal.deep, pal.near, 6), down = ramp(pal.near, pal.deep, 5);
  up.forEach((col, i) => sea.addColorStop((i / (up.length - 1)) * 0.55, col));
  down.forEach((col, i) => sea.addColorStop(0.55 + (i / (down.length - 1)) * 0.45, col));
  c.fillStyle = sea; c.fillRect(x0, HORIZON, ww, H - HORIZON);

  // swell
  bakeCrests(pal);
  const scroll = scene.world ? scene.world.scroll : T * SCROLL * 0.35;
  c.save();
  c.beginPath(); c.rect(x0, HORIZON, ww, H - HORIZON); c.clip();
  c.globalAlpha = 0.85;
  c.drawImage(crestTile, x0, (scroll % 260) - 260, ww, H + 260);
  c.globalAlpha = 1;
  c.restore();

  if (scene.mode === 'port') drawShore(c, T, x0, ww);
  if (scene.weather === 'storm' && scene.mode === 'play') drawRain(c, T, x0, ww);
  if (scene.weather === 'fog') {
    const f = c.createLinearGradient(0, HORIZON, 0, H * 0.62);
    f.addColorStop(0, 'rgba(206,214,206,.72)'); f.addColorStop(1, 'rgba(206,214,206,0)');
    c.fillStyle = f; c.fillRect(x0, HORIZON, ww, H * 0.62);
  }
}

function drawRain(c, T, x0, ww) {
  if (reduced()) return;
  c.strokeStyle = 'rgba(200,224,228,.34)';
  c.lineWidth = 1;
  c.beginPath();
  const off = (T * 900) % 60;
  for (let i = 0; i < 90; i++) {
    const x = ((i * 71) % (ww + 60)) + x0 - 30 - off * 0.4;
    const y = ((i * 137 + off * 9) % (H + 60)) - 30;
    c.moveTo(x, y); c.lineTo(x + 5, y + 22);
  }
  c.stroke();
}

/* ---------------------------------------------------------------- hulls -- */

function hullPath(c, w, l) {
  const hw = w / 2, hl = l / 2;
  c.beginPath();
  c.moveTo(0, -hl);
  c.bezierCurveTo(hw * 0.78, -hl * 0.7, hw, -hl * 0.12, hw * 0.9, hl * 0.38);
  c.lineTo(hw * 0.6, hl);
  c.lineTo(-hw * 0.6, hl);
  c.lineTo(-hw * 0.9, hl * 0.38);
  c.bezierCurveTo(-hw, -hl * 0.12, -hw * 0.78, -hl * 0.7, 0, -hl);
  c.closePath();
}

/**
 * One ship, in local space, bow at -y. Everything a ship can say about itself is a
 * parameter: how hurt she is, whether her colours are down, whether she just fired.
 */
function drawHull(c, o) {
  const { w, l, col, masts = 2, T = 0, ph = 0, flash: fl = 0, hit = 0, struck = false,
    scorch = 0, mastGone = 0, furl = 0, gun = true } = o;
  const hw = w / 2, hl = l / 2;

  // contact shadow on the water
  c.save();
  c.globalAlpha = 0.28; c.fillStyle = '#04161C';
  c.translate(2.5, 4); hullPath(c, w * 1.02, l * 1.02); c.fill();
  c.restore();

  hullPath(c, w, l);
  c.fillStyle = col.hull; c.fill();
  c.strokeStyle = col.rail; c.lineWidth = Math.max(1, w * 0.055); c.stroke();

  // deck
  c.save();
  hullPath(c, w * 0.62, l * 0.82);
  c.fillStyle = col.deck; c.fill();
  c.restore();

  // a stripe of her owner's colours down the gunwale
  c.save();
  c.globalAlpha = 0.9; c.strokeStyle = col.trim; c.lineWidth = Math.max(1, w * 0.04);
  c.beginPath(); c.moveTo(-hw * 0.86, -hl * 0.1); c.lineTo(-hw * 0.62, hl * 0.72);
  c.moveTo(hw * 0.86, -hl * 0.1); c.lineTo(hw * 0.62, hl * 0.72);
  c.stroke(); c.restore();

  // gun ports, and the flare when they speak
  if (gun && w > 20) {
    const n = Math.max(2, Math.round(l / 15));
    for (let i = 0; i < n; i++) {
      const y = -hl * 0.5 + (i / (n - 1 || 1)) * hl * 1.1;
      for (const s of [-1, 1]) {
        c.fillStyle = col.rail;
        c.fillRect(s * hw * 0.82 - 1.6, y - 1.6, 3.2, 3.2);
        if (fl > 0.2) {
          c.globalAlpha = fl; c.fillStyle = '#FFD98A';
          c.beginPath(); c.arc(s * hw * 0.96, y, 3 + fl * 3, 0, TAU); c.fill();
          c.globalAlpha = 1;
        }
      }
    }
  }

  // Masts and canvas. Seen from above, a square sail is a spar across the beam with the
  // cloth bellying aft of it — not a disc. Drawing it as an ellipse made every ship in
  // the fleet read as a snowman, which is how this ended up being a yard and a lens.
  const lost = mastGone > 0 ? 1 : 0;
  if (masts > 1) {
    c.strokeStyle = col.rail; c.lineWidth = Math.max(1, w * 0.045);
    c.beginPath(); c.moveTo(0, -hl); c.lineTo(0, -hl - l * 0.15); c.stroke();   // bowsprit
  }
  for (let m = 0; m < masts; m++) {
    const my = masts === 1 ? -hl * 0.05 : -hl * 0.5 + (m / (masts - 1)) * hl * 1.1;
    if (m < lost) {
      // shot away: a stump, and the spar in the water alongside
      c.strokeStyle = col.rail; c.lineWidth = Math.max(1, w * 0.06);
      c.beginPath(); c.moveTo(-hw * 0.2, my - 1); c.lineTo(hw * 1.5, my + hl * 0.42); c.stroke();
      c.fillStyle = col.rail;
      c.beginPath(); c.arc(0, my, Math.max(1.3, w * 0.055), 0, TAU); c.fill();
      continue;
    }
    const taper = masts === 1 ? 1 : m === 0 ? 0.8 : m === masts - 1 ? 0.7 : 1;
    const span = hw * 1.9 * taper * (1 - furl * 0.55);
    const billow = struck ? 0.12 : 0.72 + Math.sin(T * 2.1 + ph + m) * 0.16;
    const bulge = l * 0.16 * billow * (1 - furl * 0.7);

    c.save();
    c.globalAlpha = struck ? 0.45 : 0.95;
    c.fillStyle = col.sail;
    c.beginPath();
    c.moveTo(-span * 0.94, my);
    c.quadraticCurveTo(0, my + bulge * 1.7, span * 0.94, my);
    c.quadraticCurveTo(0, my + bulge * 0.4, -span * 0.94, my);
    c.closePath(); c.fill();
    // a shade along the foot, so the canvas has a windward side
    c.globalAlpha = 0.17; c.fillStyle = '#382E1E';
    c.beginPath();
    c.moveTo(-span * 0.94, my);
    c.quadraticCurveTo(0, my + bulge * 1.7, span * 0.94, my);
    c.quadraticCurveTo(0, my + bulge * 1.2, -span * 0.94, my);
    c.closePath(); c.fill();
    c.restore();

    c.strokeStyle = col.rail; c.lineWidth = Math.max(1, w * 0.05);
    c.beginPath(); c.moveTo(-span, my); c.lineTo(span, my); c.stroke();
    c.fillStyle = col.rail;
    c.beginPath(); c.arc(0, my, Math.max(1.3, w * 0.055), 0, TAU); c.fill();
  }

  // scorch, once she has been worked over
  if (scorch > 0.02) {
    c.save(); c.globalAlpha = Math.min(0.6, scorch);
    c.fillStyle = '#140E08';
    c.beginPath(); c.arc(hw * 0.3, hl * 0.1, w * 0.22, 0, TAU); c.fill();
    c.beginPath(); c.arc(-hw * 0.35, -hl * 0.25, w * 0.16, 0, TAU); c.fill();
    c.restore();
  }

  // the white flag: the only thing on this screen you want to touch
  if (struck) {
    c.save();
    c.strokeStyle = '#EFEFE6'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(0, hl * 0.62); c.lineTo(0, hl * 1.16); c.stroke();
    const wob = Math.sin(T * 7 + ph) * 1.6;
    c.fillStyle = '#FBFBF4';
    c.beginPath();
    c.moveTo(0, hl * 1.14); c.lineTo(12, hl * 1.06 + wob); c.lineTo(12, hl * 0.86 + wob); c.lineTo(0, hl * 0.8);
    c.closePath(); c.fill();
    c.restore();
  }

  if (hit > 0.02) {
    c.save(); c.globalAlpha = hit * 0.55; c.fillStyle = '#FFF3D0';
    hullPath(c, w, l); c.fill(); c.restore();
  }
}

/** The Jackdaw. Her wake is the reason the sea reads as moving at all. */
function drawJackdaw(c, w, T) {
  const s = w.ship;
  const heel = clamp(s.vx / 520, -0.2, 0.2);

  // Wake — two foam edges spreading astern, fading out. Drawn as strokes rather than a
  // filled wedge: a translucent fill over dark water just reads as a grey searchlight.
  const foam = WEATHER[scene.weather]?.foam || '#D6ECE6';
  c.save();
  const g = c.createLinearGradient(0, s.y + 10, 0, s.y + 175);
  g.addColorStop(0, foam); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.strokeStyle = g; c.lineWidth = 2.6; c.globalAlpha = 0.42; c.lineCap = 'round';
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(s.x + side * 5, s.y + 12);
    c.quadraticCurveTo(s.x + side * 13 - heel * 60, s.y + 92, s.x + side * 24 - heel * 120, s.y + 172);
    c.stroke();
  }
  // churn straight astern, so the V has something inside it
  c.globalAlpha = 0.16; c.strokeStyle = g; c.lineWidth = 9;
  c.beginPath();
  c.moveTo(s.x, s.y + 16);
  c.quadraticCurveTo(s.x - heel * 60, s.y + 90, s.x - heel * 120, s.y + 160);
  c.stroke();
  c.restore();

  c.save();
  c.translate(s.x, s.y);
  c.rotate(heel);
  if (s.invuln > 0 && Math.floor(T * 14) % 2 === 0) c.globalAlpha = 0.42;
  drawHull(c, {
    w: 30, l: 56, col: JACKDAW, masts: 3, T, ph: 0,
    flash: s.cool > w.stats.fireInterval * 0.68 ? 1 : 0,
    hit: s.ram > 0 ? 1 : 0,
    scorch: 1 - s.hull / s.hullMax,
  });
  // the black flag, at her stern, where the guest can see whose ship this is
  c.strokeStyle = '#0E0D0B'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(0, 26); c.lineTo(0, 40); c.stroke();
  c.fillStyle = '#100F0D';
  const wob = Math.sin(T * 5) * 1.4;
  c.beginPath(); c.moveTo(0, 39); c.lineTo(-13, 34 + wob); c.lineTo(-13, 25 + wob); c.lineTo(0, 27); c.closePath(); c.fill();
  c.restore();
}

/** Class sprite for the captain's log — the same hull code, in a box. */
export function sprite(canvas, kind) {
  const c = canvas.getContext('2d');
  const S = 64;
  canvas.width = S * DPR; canvas.height = S * DPR;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, S, S);
  c.save();
  c.translate(S / 2, S / 2);
  // A ship is as wide as her yards, which is nearly twice her beam. Fitting to the hull
  // cropped the canvas off every card in the bestiary.
  const fit = (w, l) => Math.min(S * 0.92 / (w * 2), S * 0.86 / (l * 1.16));
  if (kind.legend) {
    c.scale(fit(kind.w, kind.l), fit(kind.w, kind.l));
    drawHull(c, { w: kind.w, l: kind.l, col: LEGENDCOL[kind.id] || SPANISH, masts: 3, T: 0.4, ph: 0.5, gun: false });
  } else if (kind.self) {
    c.scale(fit(30, 56), fit(30, 56));
    drawHull(c, { w: 30, l: 56, col: JACKDAW, masts: 3, T: 0.4, ph: 0 });
  } else {
    c.scale(fit(kind.w, kind.l), fit(kind.w, kind.l));
    drawHull(c, { w: kind.w, l: kind.l, col: SPANISH, masts: kind.masts, T: 0.4, ph: 0.5 });
  }
  c.restore();
}

/* --------------------------------------------------------------- fleet --- */

/** Ships above the horizon are painted small and pale against it, so a wave forms as
 *  sail on the skyline before it is a problem. */
function proj(e) {
  if (e.y >= HORIZON) return { y: e.y, s: 1, a: 1 };
  // Compressed onto the last 18px above the waterline rather than spread up the sky —
  // a ship painted at y=64 with the horizon at 96 reads as a ship flying.
  const t = clamp(e.y / HORIZON, 0, 1);
  return { y: HORIZON - 18 + t * 18, s: 0.3 + t * 0.7, a: 0.32 + t * 0.68 };
}

function drawFleet(w, T) {
  const c = fctx;

  for (const k of w.rocks) drawRock(c, k, T);
  for (const p of w.spouts) drawSpout(c, p, T);

  // Hull down. Everything on the water is clipped at the waterline, so a ship arriving
  // rises out of the horizon a strake at a time instead of hanging in the sky above it.
  c.save();
  c.beginPath(); c.rect(-40, HORIZON - 3, W + 80, H); c.clip();

  for (const e of w.foes) {
    const p = proj(e);
    let a = p.a;
    // a fog bank does exactly one thing: it holds the reveal until they are close
    if (w.weather === 'fog' && e.y < 340) a *= clamp(0.06 + (e.y / 340) * 0.94, 0.06, 1);
    c.save();
    c.globalAlpha = a;
    c.translate(e.x, p.y);
    c.scale(p.s, p.s);
    c.rotate(Math.PI + (e.list || 0) * (e.id % 2 ? 1 : -1));
    if (e.cls === 'legend') drawLegend(c, e, T);
    else drawHull(c, {
      w: e.C.w, l: e.C.l, col: SPANISH, masts: e.C.masts, T, ph: e.ph,
      flash: e.flash, hit: e.hit, struck: e.struck && !e.spent,
      scorch: e.spent ? 0.6 : (1 - e.hull / e.hullMax) * 0.7,
      mastGone: e.mastGone, furl: e.struck ? 0.6 : 0,
      gun: !!e.C.guns,
    });
    c.restore();

    // the brulote wears her intent: a lit fuse and a glow at the waterline
    if (e.cls === 'brulote' && e.y > HORIZON && !reduced()) {
      c.save();
      c.globalAlpha = a * (0.5 + Math.sin(T * 16 + e.ph) * 0.3);
      const g = c.createRadialGradient(e.x, p.y, 2, e.x, p.y, 26);
      g.addColorStop(0, 'rgba(255,164,60,.9)'); g.addColorStop(1, 'rgba(255,110,20,0)');
      c.fillStyle = g; c.beginPath(); c.arc(e.x, p.y, 26, 0, TAU); c.fill();
      c.restore();
    }
    // a prize is worth a marker — it is on a timer and you need to see the timer
    if (isPrize(e)) drawPrizeRing(c, e.x, p.y, e, T);
  }

  for (const d of w.drops) drawDrop(c, d, T);
  for (const s of w.shots) drawShot(c, s);
  for (const m of w.marks) drawMark(c, m);

  drawJackdaw(c, w, T);
  c.restore();
}

function drawPrizeRing(c, x, y, e, T) {
  const k = clamp(e.strikeT / 4, 0, 1);
  c.save();
  c.translate(x, y);
  c.strokeStyle = `rgba(250,248,236,${0.35 + k * 0.5})`;
  c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
  c.globalAlpha = 0.25 + Math.sin(T * 6) * 0.12;
  c.strokeStyle = '#FBFBF4'; c.lineWidth = 6;
  c.beginPath(); c.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
  c.restore();
}

function drawLegend(c, e, T) {
  const L = e.legend;
  const col = LEGENDCOL[L.id] || SPANISH;
  drawHull(c, {
    w: L.w, l: L.l, col, masts: 3, T, ph: 0.3,
    flash: e.flash, hit: e.hit, scorch: (1 - e.hull / e.hullMax) * 0.9, gun: false,
  });
  // gun ports are the weak point, so they are the only thing on her that glows
  for (const p of e.ports) {
    c.save();
    c.translate(p.dx, p.dy);
    if (p.dead) {
      c.fillStyle = '#120C06';
      c.beginPath(); c.arc(0, 0, 7, 0, TAU); c.fill();
      c.strokeStyle = '#3A2A18'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(-5, -5); c.lineTo(5, 5); c.moveTo(5, -5); c.lineTo(-5, 5); c.stroke();
    } else {
      const g = c.createRadialGradient(0, 0, 1, 0, 0, 11);
      g.addColorStop(0, 'rgba(255,196,90,.95)'); g.addColorStop(1, 'rgba(255,140,30,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 11, 0, TAU); c.fill();
      c.fillStyle = '#2A1B0A'; c.beginPath(); c.arc(0, 0, 4.5, 0, TAU); c.fill();
    }
    c.restore();
  }
}

function drawShot(c, s) {
  if (s.foe) {
    c.fillStyle = '#1A120C';
    c.beginPath(); c.arc(s.x, s.y, s.r, 0, TAU); c.fill();
    c.fillStyle = 'rgba(224,96,58,.85)';
    c.beginPath(); c.arc(s.x, s.y, s.r * 0.5, 0, TAU); c.fill();
    return;
  }
  if (s.kind === 'chain') {
    c.strokeStyle = '#CBB88C'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(s.x - 11, s.y); c.lineTo(s.x + 11, s.y); c.stroke();
    c.fillStyle = '#E8DCBC';
    c.beginPath(); c.arc(s.x - 11, s.y, 4, 0, TAU); c.fill();
    c.beginPath(); c.arc(s.x + 11, s.y, 4, 0, TAU); c.fill();
    return;
  }
  c.strokeStyle = 'rgba(255,206,120,.42)'; c.lineWidth = s.r * 0.7;
  c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y + 9); c.stroke();
  c.fillStyle = '#FFDF9C';
  c.beginPath(); c.arc(s.x, s.y, s.r * 0.8, 0, TAU); c.fill();
}

function drawMark(c, m) {
  const k = clamp(1 - m.t / m.max, 0, 1);
  const r = m.r * (1.7 - k * 0.7);
  c.save();
  c.strokeStyle = m.own ? `rgba(217,164,65,${0.3 + k * 0.55})` : `rgba(226,86,60,${0.3 + k * 0.6})`;
  c.lineWidth = 2 + k * 2;
  c.beginPath(); c.arc(m.x, m.y, r, 0, TAU); c.stroke();
  c.globalAlpha = 0.1 + k * 0.16;
  c.fillStyle = m.own ? '#D9A441' : '#E2563C';
  c.beginPath(); c.arc(m.x, m.y, r, 0, TAU); c.fill();
  c.restore();
}

const DROPCOL = {
  rum: ['#8B4E22', '#D08C42'], shells: ['#3B4450', '#8FA0B0'], powder: ['#2B2B2B', '#6E6E6E'],
  heavy: ['#43372A', '#9B8060'], chain: ['#4A4A46', '#A8A69A'], swivel: ['#4B3A1E', '#C9A227'],
};
const DROPMARK = { rum: 'R', shells: 'S', powder: 'P', heavy: 'H', chain: 'C', swivel: 'W' };

function drawDrop(c, d, T) {
  const [dark, light] = DROPCOL[d.kind] || DROPCOL.rum;
  c.save();
  c.translate(d.x, d.y + Math.sin(T * 3 + d.x) * 2);
  c.rotate(Math.sin(d.spin) * 0.22);
  c.fillStyle = 'rgba(4,22,28,.3)';
  c.fillRect(-10, -8, 22, 20);
  c.fillStyle = dark; c.fillRect(-11, -10, 22, 20);
  c.fillStyle = light; c.fillRect(-11, -4, 22, 8);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.2; c.strokeRect(-11, -10, 22, 20);
  c.fillStyle = '#1A1208';
  c.font = '700 11px "JetBrains Mono",monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(DROPMARK[d.kind] || '?', 0, 0);
  c.restore();
}

function drawRock(c, k, T) {
  c.save();
  c.translate(k.x, k.y);
  // foam collar, so a reef reads as a reef and not as a floating stone
  c.globalAlpha = 0.5 + Math.sin(T * 2 + k.sd) * 0.14;
  c.fillStyle = WEATHER[scene.weather]?.foam || '#D6ECE6';
  c.beginPath(); c.ellipse(0, 2, k.r * 1.5, k.r * 0.85, 0, 0, TAU); c.fill();
  c.globalAlpha = 1;
  c.fillStyle = '#3E4A46';
  c.beginPath();
  for (let i = 0; i <= 9; i++) {
    const a = (i / 9) * TAU;
    const rr = k.r * (0.72 + ((Math.sin(i * 2.3 + k.sd) + 1) / 2) * 0.5);
    i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
  }
  c.closePath(); c.fill();
  c.fillStyle = '#5C6A63';
  c.beginPath(); c.ellipse(-k.r * 0.2, -k.r * 0.24, k.r * 0.42, k.r * 0.28, 0.4, 0, TAU); c.fill();
  c.restore();
}

function drawSpout(c, p, T) {
  c.save();
  c.translate(p.x, p.y);
  for (let i = 0; i < 4; i++) {
    const a = T * 1.9 + i * (TAU / 4);
    const rr = p.r * (0.4 + i * 0.22);
    c.globalAlpha = 0.32 - i * 0.05;
    c.strokeStyle = '#DCEDE8'; c.lineWidth = 3 + i;
    c.beginPath(); c.arc(0, 0, rr, a, a + 2.3); c.stroke();
  }
  c.restore();
}

/* ------------------------------------------------------------------ fx --- */

/** Everything that exists for less than a second. Kept out of the simulation so a
 *  headless run costs nothing to draw. */
export function burst(kind, x, y, n = 8, o = {}) {
  const cut = reduced() ? 0.35 : 1;
  n = Math.max(1, Math.round(n * cut));
  for (let i = 0; i < n; i++) {
    const a = (o.dir ?? Math.random() * TAU) + (Math.random() - 0.5) * (o.spread ?? TAU);
    const sp = (o.speed ?? 90) * (0.4 + Math.random() * 0.9);
    fx.push({
      kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0, max: (o.life ?? 0.7) * (0.7 + Math.random() * 0.6),
      r: (o.r ?? 4) * (0.6 + Math.random() * 0.8), c: o.c,
    });
  }
}

export function ring(x, y, r, c = '#FFE0A0', life = 0.5) { fx.push({ kind: 'ring', x, y, r, life: 0, max: life, c }); }
export function popup(x, y, text, c = '#D9A441') { fx.push({ kind: 'text', x, y, text, life: 0, max: 1.2, c, vy: -46, vx: 0 }); }
export function shake(amp) { if (reduced()) return; shakeAmp = Math.max(shakeAmp, amp); shakeT = Math.max(shakeT, 0.32); }
export function whiteout(v, col = '#fff') { flash = Math.max(flash, v); flashCol = col; }
export function bolt() { if (!reduced()) lightning = 1; }
export function clearFx() { fx = []; flash = 0; lightning = 0; shakeAmp = 0; }

function stepFx(dt) {
  for (const p of fx) {
    p.life += dt;
    if (p.kind === 'ring') continue;
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
    if (p.kind === 'smoke') { p.vx *= 0.94; p.vy *= 0.94; }
    else if (p.kind === 'splinter' || p.kind === 'debris') { p.vy += 60 * dt; p.vx *= 0.98; }
    else if (p.kind === 'text') p.vy *= 0.95;
    else { p.vx *= 0.97; p.vy *= 0.97; }
  }
  fx = fx.filter((p) => p.life < p.max);
}

function drawFx() {
  const c = xctx;
  for (const p of fx) {
    const k = p.life / p.max;
    const fade = 1 - easeCubicOut(k);
    c.save();
    if (p.kind === 'smoke') {
      c.globalAlpha = fade * 0.5;
      c.fillStyle = p.c || '#8C9295';
      c.beginPath(); c.arc(p.x, p.y, p.r * (1 + k * 2.4), 0, TAU); c.fill();
    } else if (p.kind === 'fire') {
      c.globalAlpha = fade;
      c.fillStyle = k < 0.4 ? '#FFE29A' : k < 0.7 ? '#FF9B3C' : '#D9491F';
      c.beginPath(); c.arc(p.x, p.y, p.r * (1.4 - k), 0, TAU); c.fill();
    } else if (p.kind === 'splinter' || p.kind === 'debris') {
      c.globalAlpha = fade;
      c.strokeStyle = p.c || '#6B5334'; c.lineWidth = p.kind === 'debris' ? 2.4 : 1.4;
      c.beginPath(); c.moveTo(p.x, p.y);
      c.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); c.stroke();
    } else if (p.kind === 'splash') {
      c.globalAlpha = fade * 0.85;
      c.fillStyle = p.c || '#DCEDE8';
      c.beginPath(); c.arc(p.x, p.y, p.r * (1 - k * 0.4), 0, TAU); c.fill();
    } else if (p.kind === 'ring') {
      c.globalAlpha = fade * 0.8;
      c.strokeStyle = p.c; c.lineWidth = 3 * fade + 0.6;
      c.beginPath(); c.arc(p.x, p.y, p.r * (0.25 + easeCubicOut(k) * 1.5), 0, TAU); c.stroke();
    } else if (p.kind === 'text') {
      c.globalAlpha = fade;
      c.fillStyle = p.c;
      c.font = '700 15px Cinzel,serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(6,18,24,.75)'; c.lineWidth = 3;
      c.strokeText(p.text, p.x, p.y); c.fillText(p.text, p.x, p.y);
    } else {
      c.globalAlpha = fade;
      c.fillStyle = p.c || '#FFE9AE';
      c.beginPath(); c.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, TAU); c.fill();
    }
    c.restore();
  }
}

/** The simulation's events, turned into things you can see. One place, so a new event
 *  kind is one case rather than a hunt through the screens. */
export function consume(events, w) {
  for (const e of events) {
    switch (e.k) {
      case 'cannon':
        burst('smoke', e.x - 7, e.y, 2, { speed: 40, life: 0.5, r: 3 });
        burst('smoke', e.x + 7, e.y, 2, { speed: 40, life: 0.5, r: 3 });
        break;
      case 'foe-fire':
        burst('smoke', e.x, e.y, e.big ? 7 : 3, { speed: 50, life: 0.6, r: 4 });
        break;
      case 'thud':
        burst('spark', e.x, e.y, e.rock ? 4 : 6, { speed: 120, life: 0.32, r: 2.2, c: e.rock ? '#C9D2CC' : '#FFD98A' });
        if (!e.rock) burst('splinter', e.x, e.y, 3, { speed: 150, life: 0.5 });
        break;
      case 'strike':
        ring(e.x, e.y, 26, '#FBFBF4', 0.7);
        popup(e.x, e.y - 26, 'STRUCK', '#FBFBF4');
        break;
      case 'lost-prize':
        popup(e.x, e.y - 20, 'GOT AWAY', '#B9C6C4');
        break;
      case 'board':
        ring(e.x, e.y, 30, '#FBEFC8', 0.6);
        burst('fire', e.x, e.y, 12, { speed: 150, life: 0.6, r: 4 });
        burst('spark', e.x, e.y, 18, { speed: 220, life: 0.7, r: 2.4, c: '#FFE9AE' });
        popup(e.x, e.y - 30, `+${e.reales}`, '#D9A441');
        whiteout(0.28, '#F6E7BE');
        shake(0.5);
        break;
      case 'boom': {
        const n = e.big ? 26 : 14;
        burst('fire', e.x, e.y, n, { speed: e.big ? 240 : 150, life: 0.65, r: e.big ? 6 : 4 });
        burst('smoke', e.x, e.y, n, { speed: e.big ? 150 : 90, life: 1.1, r: e.big ? 8 : 5 });
        burst('debris', e.x, e.y, e.big ? 16 : 8, { speed: 260, life: 0.9 });
        burst('splash', e.x, e.y, e.splash ? 12 : 6, { speed: 130, life: 0.6, r: 5 });
        ring(e.x, e.y, e.big ? 46 : 26, '#FFCB78', 0.5);
        if (e.reales) popup(e.x, e.y - 24, `+${e.reales}`, '#C9C2A8');
        shake(e.big ? 0.9 : 0.4);
        break;
      }
      case 'hit':
        burst('splinter', e.x, e.y - 14, 8, { speed: 190, life: 0.6 });
        burst('spark', e.x, e.y - 14, 6, { speed: 150, life: 0.4, r: 2.4, c: '#FF9B3C' });
        whiteout(0.18, '#C0332A');
        shake(0.45);
        break;
      case 'mortar':
        burst('smoke', e.x, SHIP_Y - 24, 5, { speed: 70, life: 0.7, r: 5 });
        break;
      case 'refit':
        clearFx();
        whiteout(0.85, '#FFFFFF');
        break;
      case 'take':
        ring(e.x, e.y, 16, '#D9A441', 0.45);
        break;
      case 'port-down':
        burst('fire', e.x, e.y, 10, { speed: 160, life: 0.5, r: 4 });
        ring(e.x, e.y, 18, '#FFCB78', 0.4);
        break;
      case 'legend-down':
        whiteout(0.7, '#FFE6AE');
        for (let i = 0; i < 5; i++) burst('fire', e.x + (i - 2) * 22, e.y + (i % 3) * 16, 14, { speed: 240, life: 0.9, r: 7 });
        shake(1.2);
        break;
      default: break;
    }
  }
}

/* ---------------------------------------------------------------- frame -- */

export function paint(dt, T) {
  if (!sctx) return;
  const w = scene.world;

  sctx.clearRect(-BX, 0, W + 2 * BX, H);
  fctx.clearRect(0, 0, W, H);
  xctx.clearRect(0, 0, W, H);

  if (scene.hidden) {
    sctx.fillStyle = '#0B1A21';
    sctx.fillRect(-BX, 0, W + 2 * BX, H);
    fx = [];
    if (flashEl) flashEl.style.setProperty('--flash', '0');
    return;
  }

  scene.weather = scene.mode === 'play' && w ? w.weather : 'clear';
  drawSea(T, dt);

  // shake lives on the two upper layers only — translating the sea would show its edge
  let sx = 0, sy = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    const k = clamp(shakeT / 0.32, 0, 1) * shakeAmp * 7;
    sx = Math.sin(T * 91) * k; sy = Math.cos(T * 77) * k;
    if (shakeT <= 0) shakeAmp = 0;
  }
  fctx.save(); xctx.save();
  fctx.translate(sx, sy); xctx.translate(sx, sy);

  if (scene.mode === 'play' && w) drawFleet(w, T);
  else if (scene.mode === 'port') drawCareen(fctx, T);   // shore is painted with the sea
  else if (scene.mode === 'sea') drawAtAnchor(fctx, T);

  stepFx(dt);
  drawFx();

  fctx.restore(); xctx.restore();

  // Storms flash. The lightning is one variable shared with the refit whiteout, so
  // they can never fight each other for the same overlay.
  if (scene.mode === 'play' && w && w.weather === 'storm' && !reduced()) {
    if (lightning <= 0 && Math.sin(T * 0.9) > 0.9992) bolt();
  }
  if (lightning > 0) { flash = Math.max(flash, lightning * 0.55); flashCol = '#DCE8F2'; lightning = Math.max(0, lightning - dt * 3.4); }
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 2.6);
    if (flashEl) { flashEl.style.setProperty('--flash', flash.toFixed(3)); flashEl.style.setProperty('--flash-c', flashCol); }
  } else if (flashEl) flashEl.style.setProperty('--flash', '0');
}

/* ----------------------------------------------------- idle backdrops ---- */

/** Title and run-summary: the Jackdaw hove to, sails luffing. */
function drawAtAnchor(c, T) {
  const y = 560 + Math.sin(T * 0.9) * 6;
  c.save();
  c.translate(W / 2, y);
  c.rotate(Math.sin(T * 0.7) * 0.05);
  c.scale(1.5, 1.5);
  drawHull(c, { w: 30, l: 56, col: JACKDAW, masts: 3, T: T * 0.4, ph: 0, furl: 0.45 });
  c.strokeStyle = '#0E0D0B'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(0, 26); c.lineTo(0, 42); c.stroke();
  c.fillStyle = '#100F0D';
  const wob = Math.sin(T * 2.2) * 2;
  c.beginPath(); c.moveTo(0, 41); c.lineTo(-14, 35 + wob); c.lineTo(-14, 25 + wob); c.lineTo(0, 27); c.closePath(); c.fill();
  c.restore();
}

/**
 * Nassau. She is careened — hove down on her beam ends on the sand, which is what a
 * careening beach is and the reason the upgrades live here.
 *
 * Land sits BETWEEN the horizon and the water, because the whole game is looking north
 * from your own deck: the island is the far thing, the sea you are floating in is the
 * near thing. Everything below y≈330 is under the upgrade sheet, so the scene is
 * composed for the strip above it and nothing worth seeing is painted into the dark.
 */
const SHORE = 296;

/** The island itself, on the sea layer so the sand reaches the screen edges. */
function drawShore(c, T, x0, ww) {
  const x1 = x0 + ww;
  c.save();
  c.beginPath();
  c.moveTo(x0, HORIZON - 8);
  c.lineTo(x1, HORIZON - 8);
  c.lineTo(x1, SHORE - 26);
  c.quadraticCurveTo(W * 0.62, SHORE + 16, W * 0.34, SHORE - 4);
  c.quadraticCurveTo(W * 0.14, SHORE - 20, x0, SHORE + 6);
  c.closePath();
  // dry sand up by the treeline, wet sand at the water's edge
  const sand = c.createLinearGradient(0, HORIZON - 8, 0, SHORE + 10);
  sand.addColorStop(0, '#8E7A54'); sand.addColorStop(0.45, '#C0A473'); sand.addColorStop(1, '#9C845C');
  c.fillStyle = sand; c.fill();
  c.restore();

  // the town: lanterns on the sand, because it is always dusk when you make port
  for (let i = 0; i < 7; i++) {
    const x = x0 + 18 + i * ((ww - 36) / 6), y = 138 + ((i * 5) % 3) * 36;
    const flick = 0.7 + Math.sin(T * (4.4 + i * 0.7) + i) * 0.26;
    const g = c.createRadialGradient(x, y, 1, x, y, 32);
    g.addColorStop(0, `rgba(255,192,104,${0.5 * flick})`); g.addColorStop(1, 'rgba(255,150,50,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 32, 0, TAU); c.fill();
    c.fillStyle = '#2A2018'; c.fillRect(x - 7, y - 1, 14, 10);          // the shack under it
    c.fillStyle = '#F0C070'; c.beginPath(); c.arc(x, y, 2.4, 0, TAU); c.fill();
  }

  // surf, breaking along the shoreline
  c.save();
  c.strokeStyle = '#EEF6EE'; c.lineWidth = 3; c.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    c.globalAlpha = 0.5 - k * 0.22;
    c.beginPath();
    for (let x = x0; x <= x1; x += 10) {
      const y = SHORE + 4 + k * 9 + Math.sin(x * 0.026 + T * 0.8 + k) * 5
        + Math.sin(x * 0.008 - T * 0.4) * 8 - (x > W * 0.34 ? (x - W * 0.34) * 0.09 : 0);
      x === x0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  }
  c.restore();
}

/** She is hove down on her beam ends with her bottom showing, which is what careening
 *  is and the reason the upgrades are bought here rather than at sea. */
function drawCareen(c, T) {
  const heel = -0.66 + Math.sin(T * 0.5) * 0.014;
  c.save();
  c.translate(W / 2 + 6, 236);
  c.rotate(heel);
  c.globalAlpha = 0.26; c.fillStyle = '#3A2C18';
  c.save(); c.scale(1.7, 1.7); c.translate(4, 9);
  hullPath(c, 30, 56); c.fill(); c.restore();
  c.globalAlpha = 1;
  c.scale(1.7, 1.7);
  drawHull(c, { w: 30, l: 56, col: JACKDAW, masts: 3, T: T * 0.3, ph: 0, furl: 0.88 });
  c.restore();
}
