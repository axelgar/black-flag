// The HUD. DOM rather than canvas on purpose — it is text, bars and buttons, it has to be
// readable at a phone's smallest size, and it must never cost the sea a frame. Built once
// on mount, then written to only when a number actually changes.

import { heatFlags, HUNTER_AT } from '../data/notoriety';
import { reales } from '../state/run';
import { BOARD_SPEED, STRIKE_WINDOW, hostile, isPrize } from '../sim/combat';
import { EDGE, MAP_R } from '../sim/map';
import type { World } from '../sim/types';
import type { View } from '../render/view';
import * as A from '../audio/audio';
import { attachStick, fire, sailLevel, steering, usedTouch } from './input';
import { buzz } from './haptics';

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

interface Hud {
  root: HTMLElement;
  bar: HTMLElement; fill: HTMLElement; lives: HTMLElement; coin: HTMLElement; wave: HTMLElement;
  flags: HTMLElement[]; flagbox: HTMLElement; buffs: HTMLElement;
  boss: HTMLElement; bossName: HTMLElement; bossFill: HTMLElement;
  toast: HTMLElement; dock: HTMLElement;
  gunL: HTMLButtonElement; gunR: HTMLButtonElement; mortar: HTMLButtonElement; shells: HTMLElement;
  sail: HTMLElement[]; sailTxt: HTMLElement;
  map: HTMLCanvasElement; mapBase: HTMLCanvasElement | null; mapSeed: string;
  ptrs: HTMLElement; ptrPool: HTMLElement[]; labels: HTMLElement[];
  last: Record<string, unknown>;
  mapT: number;
}

let hud: Hud | null = null;

export function hudHtml(touch: boolean) {
  return `
  <div class="hud" id="hud">
    <div class="pointers" id="h-ptrs"></div>
    <div class="hudtl">
      <div class="hullbar" id="h-bar"><i style="width:100%"></i></div>
      <div class="hudline">
        <span class="hearts" id="h-lives"></span>
        <span class="coin" id="h-coin">0 R</span>
        <span style="opacity:.65" id="h-wave">WAVE 1</span>
        <span class="flags" id="h-flags">${'<i></i>'.repeat(5)}</span>
      </div>
      <div class="buffs" id="h-buffs"></div>
    </div>
    <div class="bossbar" id="h-boss"><div class="n" id="h-bossname"></div><div class="b"><i style="width:100%"></i></div></div>
    <button class="chip gold dock-cta" id="h-dock">⚓ Make for Nassau</button>
    <div class="hudtr">
      <canvas class="minimap" id="h-map" width="224" height="224"></canvas>
      <button class="chip icon" data-go="#/pause" aria-label="Heave to">❙❙</button>
    </div>
    <div class="toast" id="h-toast"></div>
    ${touch ? `<div class="joy${usedTouch() ? ' used' : ''}" id="h-joy"><div class="base"></div><div class="knob"></div><div class="hint">DRAG TO SAIL · PUSH HARD FOR FULL SAIL</div></div>` : ''}
    <div class="sailgauge" id="h-sail">
      <i style="height:8px"></i><i style="height:13px"></i><i style="height:18px"></i><span id="h-sailtxt">HALF SAIL</span>
    </div>
    <div class="guns">
      <button class="gun mortar" id="h-mortar" aria-label="Mortar"><div><b id="h-shells">3</b>MORTAR</div></button>
      <button class="gun" id="h-gunL" aria-label="Fire to port"><div><b>◀</b>PORT</div></button>
      <button class="gun" id="h-gunR" aria-label="Fire to starboard"><div><b>▶</b>STBD</div></button>
    </div>
    ${touch ? '' : '<div class="keys">W/S SAIL · A/D HELM · Q/E OR MOUSE BROADSIDES · SPACE MORTAR · ESC HEAVE TO</div>'}
  </div>`;
}

export function mountHud(root: HTMLElement, onDock: () => void): () => void {
  hud = {
    root,
    bar: $('#h-bar', root), fill: $('#h-bar i', root), lives: $('#h-lives', root), coin: $('#h-coin', root), wave: $('#h-wave', root),
    flags: [...root.querySelectorAll<HTMLElement>('#h-flags i')], flagbox: $('#h-flags', root), buffs: $('#h-buffs', root),
    boss: $('#h-boss', root), bossName: $('#h-bossname', root), bossFill: $('#h-boss .b i', root),
    toast: $('#h-toast', root), dock: $('#h-dock', root),
    gunL: $('#h-gunL', root), gunR: $('#h-gunR', root), mortar: $('#h-mortar', root), shells: $('#h-shells', root),
    sail: [...root.querySelectorAll<HTMLElement>('#h-sail i')], sailTxt: $('#h-sailtxt', root),
    map: $('#h-map', root) as HTMLCanvasElement, mapBase: null, mapSeed: '',
    ptrs: $('#h-ptrs', root), ptrPool: [], labels: [],
    last: {}, mapT: 0,
  };
  const press = (el: HTMLElement, side: 'L' | 'R' | 'M') => el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); A.unlock(); buzz(side === 'M' ? 14 : 10); fire(side);
  });
  press(hud.gunL, 'L'); press(hud.gunR, 'R'); press(hud.mortar, 'M');
  hud.dock.addEventListener('click', () => { buzz(10); onDock(); });
  const joy = root.querySelector<HTMLElement>('#h-joy');
  const off = joy ? attachStick(joy) : () => {};
  return () => { off(); hud = null; };
}

const HEARTS = (n: number, of: number) => '♥'.repeat(Math.max(0, n)) + '<span style="opacity:.25">♡</span>'.repeat(Math.max(0, of - n));
const SAILS = ['HOVE TO', 'TOPSAILS', 'HALF SAIL', 'ALL PLAIN SAIL'];

export function hudTick(w: World | null, view: View, dt: number) {
  if (!hud || !w) return;
  const L = hud.last, s = w.ship;
  const hp = Math.max(0, s.hull / s.hullMax);
  if (Math.abs(((L.hp as number) ?? -1) - hp) > 0.004) {
    hud.fill.style.width = `${(hp * 100).toFixed(1)}%`;
    hud.bar.classList.toggle('low', hp < 0.34);
    L.hp = hp;
  }
  const lives = `${w.lives}/${w.stats.lives}`;
  if (L.lives !== lives) { hud.lives.innerHTML = HEARTS(w.lives, Math.max(w.lives, w.stats.lives)); L.lives = lives; }
  if (L.coin !== w.plunder) { hud.coin.textContent = `${reales(w.plunder)} R`; L.coin = w.plunder; }
  if (L.wave !== w.wave) { hud.wave.textContent = `WAVE ${w.wave}`; L.wave = w.wave; }
  if (L.shells !== s.shells) {
    hud.shells.textContent = String(s.shells);
    hud.mortar.disabled = s.shells <= 0;
    L.shells = s.shells;
  }
  const flags = heatFlags(w.heat);
  if (L.flags !== flags) {
    hud.flags.forEach((f, i) => f.classList.toggle('on', i < flags));
    hud.flagbox.classList.toggle('hot', flags >= HUNTER_AT);
    L.flags = flags;
  }
  A.setHeat(w.heat);

  const boss = w.boss;
  if (!!boss !== !!L.boss) { hud.boss.classList.toggle('on', !!boss); L.boss = !!boss; }
  if (boss) {
    hud.bossName.textContent = boss.L!.name;
    hud.bossFill.style.width = `${Math.max(0, (boss.hull / boss.hullMax) * 100).toFixed(1)}%`;
  }
  const b = s.buffs;
  const on = (Object.keys(b) as (keyof typeof b)[]).filter((k) => b[k] !== 0);
  const bs = on.map((k) => `${k}${b[k] > 0 ? Math.ceil(b[k]) : ''}`).join(',');
  if (L.buffs !== bs) {
    hud.buffs.innerHTML = on.map((k) => `<span class="buff">${k}${b[k] > 0 ? ` ${Math.ceil(b[k])}` : ''}</span>`).join('');
    L.buffs = bs;
  }
  const clear = w.phase === 'clear';
  if (L.clear !== clear) { hud.dock.classList.toggle('on', clear); L.clear = clear; }

  // guns: reload rings, and a glow on a side that bears on something
  const bears = [false, false];
  for (const e of w.foes) {
    if (!hostile(e) && !isPrize(e)) continue;
    const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
    if (d > w.stats.range + e.len * 0.4) continue;
    const side = -Math.sin(s.h) * dx + Math.cos(s.h) * dy;       // + starboard
    if (Math.abs(side) / d > 0.93) bears[side > 0 ? 1 : 0] = true;
  }
  [hud.gunL, hud.gunR].forEach((g, i) => {
    const load = 1 - s.cool[i] / (w.stats.reload || 1);
    g.style.setProperty('--load', load.toFixed(3));
    g.classList.toggle('ready', load >= 1);
    g.classList.toggle('bears', bears[i] && load >= 1);
  });

  {
    const lvl = Math.round(sailLevel() * 3);
    if (L.sail !== lvl) {
      hud.sail.forEach((el, i) => el.classList.toggle('on', i < lvl));
      hud.sailTxt.textContent = SAILS[lvl];
      L.sail = lvl;
    }
  }

  pointers(w, view);
  hud.mapT -= dt;
  if (hud.mapT <= 0) { hud.mapT = 0.1; minimap(w, view.yaw); }
}

/** Arrows round the edge for what matters and is off screen; labels over prizes. */
function pointers(w: World, view: View) {
  const h = hud!;
  const W = h.root.clientWidth, H = h.root.clientHeight;
  const cx = W / 2, cy = H / 2;
  let n = 0, nl = 0;
  const arrow = (x: number, y: number, kind: string) => {
    const p = view.project(x, 4, y);
    if (p && p.on) return p;
    // Off screen: point along the bearing, as the camera sees it — forward is up.
    const rel = Math.atan2(y - w.ship.y, x - w.ship.x) - view.yaw;
    const a = Math.atan2(-Math.cos(rel), Math.sin(rel));
    // Clear of the key hints and gun buttons at the bottom, the HUD at the top.
    const m = 34, mv = Math.sin(a) > 0 ? 64 : 46;
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-3), (H / 2 - mv) / Math.abs(Math.sin(a) || 1e-3));
    let el = h.ptrPool[n];
    if (!el) { el = document.createElement('div'); h.ptrs.appendChild(el); h.ptrPool.push(el); }
    el.className = `ptr ${kind}`;
    el.style.display = '';
    el.style.left = `${cx + Math.cos(a) * k}px`;
    el.style.top = `${cy + Math.sin(a) * k}px`;
    el.style.setProperty('--a', `${a + Math.PI / 2}rad`);
    n++;
    return null;
  };
  const label = (x: number, y: number, z: number, text: string, cls: string) => {
    const p = view.project(x, y, z);
    if (!p || !p.on) return;
    let el = h.labels[nl];
    if (!el) { el = document.createElement('div'); h.ptrs.appendChild(el); h.labels.push(el); }
    el.className = `label ${cls}`;
    el.style.display = '';
    el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    el.innerHTML = esc(text);
    nl++;
  };

  for (const e of w.foes) {
    if (n >= 12) break;
    if (isPrize(e)) {
      const on = arrow(e.x, e.y, 'prize');
      if (on) {
        const s = w.ship;
        const boarding = s.board && s.board.id === e.id;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        const reach = (e.len + s.len) * 0.5 * 0.85 + 12;
        const secs = `${Math.ceil(e.strikeT)}s`;
        // The one rule about boarding nobody can see: you have to be alongside, not tearing past.
        const text = boarding ? 'BOARDING…'
          : d < reach && s.v > s.maxSpeed * BOARD_SPEED ? `${steering() ? 'LET GO' : 'EASE OFF'} TO BOARD · ${secs}`
          : d < reach * 3 ? `COME ALONGSIDE · ${secs}` : `PRIZE · ${secs}`;
        label(e.x, e.len * 0.6 + 8, e.y, text, 'prize');
      }
      continue;
    }
    if (e.state !== 'engage') continue;
    arrow(e.x, e.y, e.L ? 'boss' : 'foe');
    if (e.L) label(e.x, e.len * 0.7 + 10, e.y, e.L.name, 'prize');
  }
  // Nobody has found you yet: the lookout calls the nearest sail, so the start of a wave is
  // a heading and not a minute of empty sea.
  if (w.phase === 'fight' && !w.foes.some((e) => e.state === 'engage')) {
    const s = w.ship;
    let best = null as World['foes'][number] | null, bd = 1e9;
    for (const e of w.foes) {
      if (e.state !== 'patrol') continue;
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      if (arrow(best.x, best.y, 'sail')) label(best.x, best.len + 10, best.y, 'SAIL HO', 'sail');
    }
  }
  if (w.phase === 'clear') {
    const hb = w.map.harbour;
    const on = arrow(hb.x, hb.y, 'home');
    if (on) label(hb.x, 30, hb.y, 'NASSAU', 'prize');
  }
  for (let i = n; i < h.ptrPool.length; i++) h.ptrPool[i].style.display = 'none';
  for (let i = nl; i < h.labels.length; i++) h.labels[i].style.display = 'none';
  void STRIKE_WINDOW;
}

/** North-up chart of the sea round you: islands, Nassau, anyone who has seen you. */
function minimap(w: World, yaw: number) {
  const h = hud!;
  const cv = h.map, c = cv.getContext('2d')!;
  const S = cv.width, R = S / 2;
  const scale = R / MAP_R;
  if (!h.mapBase || h.mapSeed !== w.map.seed) {
    const b = document.createElement('canvas');
    b.width = b.height = S;
    const bc = b.getContext('2d')!;
    bc.fillStyle = 'rgba(18,58,74,.9)';
    bc.beginPath(); bc.arc(R, R, R - 2, 0, Math.PI * 2); bc.fill();
    // the rim current: a darker band round the edge, and a dashed line where it takes you
    bc.fillStyle = 'rgba(4,16,22,.55)';
    bc.beginPath(); bc.arc(R, R, R - 2, 0, Math.PI * 2); bc.arc(R, R, (MAP_R - EDGE) * scale, 0, Math.PI * 2, true); bc.fill();
    bc.strokeStyle = 'rgba(242,231,206,.3)'; bc.lineWidth = 1.5; bc.setLineDash([4, 5]);
    bc.beginPath(); bc.arc(R, R, (MAP_R - EDGE) * scale, 0, Math.PI * 2); bc.stroke();
    bc.setLineDash([]);
    const coast = (is: (typeof w.map.islands)[number], grow: number) => {
      bc.beginPath();
      is.radii.forEach((r, i) => {
        const a = (i / is.radii.length) * Math.PI * 2;
        const x = R + (is.x + Math.cos(a) * (r + grow)) * scale, y = R + (is.y + Math.sin(a) * (r + grow)) * scale;
        if (i) bc.lineTo(x, y); else bc.moveTo(x, y);
      });
      bc.closePath();
    };
    // the shallows first, pale round every coast, then the land on them
    bc.fillStyle = 'rgba(96,196,196,.28)';
    for (const is of w.map.islands) { coast(is, 26); bc.fill(); }
    for (const is of w.map.islands) {
      bc.fillStyle = is.kind === 'nassau' ? '#E3CF9E' : is.kind === 'rock' ? '#8C8374' : is.kind === 'sand' ? '#D9C58E' : '#6E9D55';
      coast(is, 0); bc.fill();
    }
    bc.fillStyle = 'rgba(242,231,206,.55)';
    bc.font = '600 13px ui-monospace, monospace'; bc.textAlign = 'center'; bc.textBaseline = 'top';
    bc.fillText('N', R, 5);
    bc.fillStyle = 'rgba(220,240,240,.4)';
    for (const k of w.map.reefs) { bc.beginPath(); bc.arc(R + k.x * scale, R + k.y * scale, 1.6, 0, Math.PI * 2); bc.fill(); }
    h.mapBase = b; h.mapSeed = w.map.seed;
  }
  c.clearRect(0, 0, S, S);
  c.drawImage(h.mapBase, 0, 0);
  const P = (x: number, y: number) => [R + x * scale, R + y * scale] as const;
  // harbour
  const [hx, hy] = P(w.map.harbour.x, w.map.harbour.y);
  c.strokeStyle = w.phase === 'clear' ? '#FFD36A' : 'rgba(217,164,65,.6)'; c.lineWidth = 2;
  c.beginPath(); c.arc(hx, hy, 5, 0, Math.PI * 2); c.stroke();
  for (const e of w.foes) {
    if (e.state === 'spent') continue;
    if (e.state === 'patrol' && Math.hypot(e.x - w.ship.x, e.y - w.ship.y) > 260) continue;
    const [x, y] = P(e.x, e.y);
    c.fillStyle = isPrize(e) ? '#F6F1E1' : e.L ? '#FF7A3C' : e.state === 'engage' ? '#E0533F' : 'rgba(224,83,63,.5)';
    c.beginPath(); c.arc(x, y, e.L ? 4.5 : 3, 0, Math.PI * 2); c.fill();
  }
  // cargo afloat, and spouts
  c.fillStyle = '#FFD36A';
  for (const d of w.drops) { if (d.dead) continue; const [x, y] = P(d.x, d.y); c.beginPath(); c.arc(x, y, 2.2, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(235,245,245,.85)'; c.lineWidth = 1.5;
  for (const p of w.spouts) { const [x, y] = P(p.x, p.y); c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 1.6); c.stroke(); }
  // you, and the way the camera looks
  const [sx, sy] = P(w.ship.x, w.ship.y);
  c.save();
  c.translate(sx, sy);
  c.fillStyle = 'rgba(242,231,206,.12)';
  c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 34, yaw - 0.55, yaw + 0.55); c.closePath(); c.fill();
  c.rotate(w.ship.h);
  c.fillStyle = '#F2E7CE';
  c.beginPath(); c.moveTo(7, 0); c.lineTo(-5, 4); c.lineTo(-3, 0); c.lineTo(-5, -4); c.closePath(); c.fill();
  c.restore();
}

/** The shout in the middle of the screen. One at a time, and it never queues. */
export function toast(big: string, small = '') {
  if (!hud) return;
  hud.toast.innerHTML = `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ''}`;
  hud.toast.classList.remove('go');
  void hud.toast.offsetWidth;
  hud.toast.classList.add('go');
}

export const hudMounted = () => !!hud;
