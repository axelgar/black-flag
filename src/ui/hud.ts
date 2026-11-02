// What sits on the glass over the fight: your streak at the top, a tag over every ship
// (name, hull, skulls), your hull and shots over your own, arrows at the edges to the
// nearest ships off screen, the feed of who sank whom, the sticks, a button for each
// power, and the cards for being sunk and for winning.
//
// Written every frame by hudTick(), which only touches what changed: a tag is moved with
// a transform, never laid out again.

import { markOf } from '../data/colors';
import { TUNING as T } from '../data/tuning';
import type { View } from '../render/view';
import type { Seat } from '../net/protocol';
import { POWERS, type GameEvent, type Power, type Ship, type World } from '../sim/types';
import { buzz } from './haptics';
import { attachSticks, press, touchUi, used } from './input';

const $ = <E extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as E | null;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

export const SKULL = '☠';
const ARROWS = 3;
const POWER_UI: Record<Power, { icon: string; name: string }> = {
  broadside: { icon: '💥', name: 'Broadside' },
  smoke: { icon: '💨', name: 'Smoke' },
  song: { icon: '🧜‍♀️', name: 'Song' },
  shield: { icon: '🛡️', name: 'Shield' },
};

/** A ship in smoke is not drawn, tagged or pointed at, but on her own phone. */
export const hidden = (w: World, s: Ship) => s.smoke > 0 && s.id !== w.focus;

export function hudHtml(practice: boolean) {
  const touch = touchUi();
  const slots = Array.from({ length: T.win }, (_, i) => `<i data-n="${i + 1}">${SKULL}</i>`).join('');
  return `
  <div class="hud${touch ? ' touch' : ''}">
    <div class="tags" id="tags"></div>
    <div class="arrows" id="arrows">${Array.from({ length: ARROWS }, () => '<div class="arrow"><b></b><span></span></div>').join('')}</div>
    <button class="leave" data-act="leave" aria-label="Leave the sea">⚓ <span>Leave</span></button>
    <div class="streak" id="streak" aria-live="polite">
      <div class="skulls">${slots}</div>
      <div class="label" id="streak-label">Sink 5 in a row</div>
    </div>
    <div class="practice" id="practice"${practice ? '' : ' hidden'}>Practice · order a <b>Black Flag</b> to play for a free shot</div>
    <div class="feed" id="feed"></div>
    <div class="toast" id="toast"></div>
    <div class="powers" id="powers">${POWERS.map((p, i) => `<button class="power" data-power="${i}" aria-label="${POWER_UI[p].name}"><b>${POWER_UI[p].icon}</b><span>${touch ? POWER_UI[p].name : `${i + 1} ${POWER_UI[p].name}`}</span></button>`).join('')}</div>
    ${touch ? `
    <div class="joy left" id="joy-l"><div class="base"></div><div class="knob"></div></div>
    <div class="joy right" id="joy-r"><div class="base"></div><div class="knob"></div></div>
    <div class="hint" id="hints"></div>` : `
    <div class="keys">WASD sail · hold the mouse to aim, let go to fire · Space fires at the nearest · 1–4 powers</div>`}
    <div class="card sunk" id="sunk" hidden>
      <div class="big">Sunk</div>
      <div class="by" id="sunk-by"></div>
      <div class="lost" id="sunk-lost"></div>
      <div class="count" id="sunk-count"></div>
    </div>
    <div class="card won" id="won" hidden>
      <div class="burst"></div>
      <div class="big" id="won-big">Five in a row!</div>
      <div class="sub" id="won-sub"></div>
      <button class="cta" data-act="prize" id="won-save">Save my free shot</button>
      <button class="cta" data-act="won-ok" id="won-ok">Keep sailing</button>
    </div>
    <div class="card state" id="state" hidden>
      <div class="big" id="state-big"></div>
      <div class="sub" id="state-sub"></div>
      <button class="cta" data-act="again" hidden>Try again</button>
    </div>
  </div>`;
}

interface Tag { el: HTMLElement; name: HTMLElement; bar: HTMLElement; skulls: HTMLElement; ammo: HTMLElement | null; key: string }

let root: HTMLElement | null = null;
let tags: Tag[] = [];
let arrows: HTMLElement[] = [];
let powerEls: HTMLElement[] = [];
let lastStreak = -1;
let feed: { el: HTMLElement; t: number }[] = [];
let toastT = 0;
let wonOpen = false;
let sunkBy = '';

/** Put the HUD up. `act` hears its buttons. Returns the teardown. */
export function mountHud(el: HTMLElement, act: (what: string) => void): () => void {
  root = el;
  tags = []; feed = []; lastStreak = -1; wonOpen = false;
  arrows = [...el.querySelectorAll<HTMLElement>('.arrow')];
  powerEls = [...el.querySelectorAll<HTMLElement>('[data-power]')];
  // a power goes off as the thumb lands, not when it lifts
  const onPower = (e: PointerEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-power]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    press(Number(b.dataset.power));
    buzz(10);
  };
  el.addEventListener('pointerdown', onPower);
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.act === 'won-ok') { wonOpen = false; $('#won', root!)!.hidden = true; }
    act(b.dataset.act!);
  };
  el.addEventListener('click', onClick);
  const l = $('#joy-l', el), r = $('#joy-r', el);
  const off = l && r ? attachSticks(l, r) : null;
  return () => { el.removeEventListener('click', onClick); el.removeEventListener('pointerdown', onPower); off?.(); root = null; };
}

/** A big word in the middle of the screen, for a moment. */
export function toast(big: string, small = '') {
  const t = root && $('#toast', root);
  if (!t) return;
  t.innerHTML = `<div class="big">${esc(big)}</div>${small ? `<div class="small">${esc(small)}</div>` : ''}`;
  t.classList.remove('on');
  void t.offsetWidth;
  t.classList.add('on');
  toastT = 2.2;
}

function say(html: string) {
  const f = root && $('#feed', root);
  if (!f) return;
  const el = document.createElement('div');
  el.className = 'line';
  el.innerHTML = html;
  f.prepend(el);
  feed.unshift({ el, t: 5 });
  while (feed.length > 4) feed.pop()!.el.remove();
}

const dot = (seats: Seat[], id: number) => {
  const s = seats.find((x) => x.id === id);
  const c = s && s.c >= 0 ? markOf(s.c).color : '#fff';
  return `<b style="color:${c}">${esc(s?.name || '?')}</b>`;
};

/** What happened, as the HUD tells it. */
export function hudEvents(events: GameEvent[], w: World, seats: Seat[]) {
  const me = w.focus;
  for (const e of events) {
    switch (e.k) {
      case 'sunk': {
        const by = typeof e.by === 'number' ? e.by : -1;
        say(by >= 0 ? `${dot(seats, by)} <i>${SKULL}</i> ${dot(seats, e.p as number)}` : `${dot(seats, e.p as number)} went down`);
        if (e.p === me) {
          sunkBy = by >= 0 ? seats.find((s) => s.id === by)?.name ?? '' : '';
          const lost = (e.lost as number) || 0;
          const c = root && $('#sunk', root);
          if (c) {
            $('#sunk-by', c)!.textContent = sunkBy ? `by ${sunkBy}` : '';
            $('#sunk-lost', c)!.textContent = lost ? `Your streak of ${lost} is gone` : '';
            c.hidden = false;
          }
        }
        break;
      }
      case 'streak':
        if (e.p === me) {
          const n = e.n as number;
          if (n < T.win) toast(n === T.wanted ? 'Wanted!' : `${n} in a row`, n === T.wanted ? 'Everyone can see you now' : `${T.win - n} more to win`);
        } else if ((e.n as number) === T.wanted) say(`${dot(seats, e.p as number)} is <span class="wanted">WANTED</span>`);
        break;
      case 'won':
        if (e.p === me) {
          wonOpen = true;
          const c = root && $('#won', root);
          if (c) {
            // on a ticket, a free shot to save; without one, what it would have been
            $('#won-big', c)!.textContent = e.prize ? 'Free shot!' : 'Five in a row!';
            $('#won-sub', c)!.textContent = e.prize ? 'Five in a row on your ticket. Save it with your email to claim it.' : 'Order a Black Flag and this would have been a free shot.';
            $('#won-save', c)!.hidden = !e.prize;
            $('#won-ok', c)!.textContent = e.prize ? 'Later' : 'Keep sailing';
            $('#won-ok', c)!.classList.toggle('quiet', !!e.prize);
            $('#practice', root!)!.hidden = false;
            c.hidden = false;
          }
        } else say(e.prize ? `${dot(seats, e.p as number)} won a free shot!` : `${dot(seats, e.p as number)} sank five in a row!`);
        break;
      case 'take':
        if (e.p === me) toast(e.kind === 'repair' ? 'Repaired' : e.kind === 'speed' ? 'Full speed!' : 'Heavy shot', e.kind === 'heavy' ? 'Your next volley hits twice as hard' : '');
        break;
      default: break;
    }
  }
}

/** Hailing, turned away, or line lost: said in the middle of the screen. Null clears it. */
export function hudState(big: string | null, sub = '', again = false) {
  const c = root && $('#state', root);
  if (!c) return;
  c.hidden = !big;
  if (!big) return;
  $('#state-big', c)!.textContent = big;
  $('#state-sub', c)!.textContent = sub;
  $('[data-act="again"]', c)!.hidden = !again;
}

/** Every frame. */
export function hudTick(w: World | null, seats: Seat[], view: View, dt: number, height: (look: string) => number) {
  if (!root) return;
  toastT -= dt;
  if (toastT <= 0) $('#toast', root)?.classList.remove('on');
  for (const f of feed) { f.t -= dt; if (f.t < 1) f.el.style.opacity = String(Math.max(0, f.t)); }
  while (feed.length && feed[feed.length - 1].t <= 0) feed.pop()!.el.remove();
  if (!w) return;
  const me = w.ships[w.focus];

  // your streak
  const n = me ? me.streak : 0;
  if (n !== lastStreak) {
    lastStreak = n;
    const box = $('#streak', root)!;
    box.querySelectorAll('i').forEach((i) => i.classList.toggle('on', Number(i.dataset.n) <= n));
    box.classList.toggle('wanted', n >= T.wanted);
    $('#streak-label', root)!.textContent = n >= T.wanted ? `WANTED · one more!` : n ? `${n} in a row · ${T.win - n} to go` : `Sink ${T.win} in a row`;
  }

  // the sunk card counts down, and goes when she is back
  const sunk = $('#sunk', root)!;
  if (me && me.out && !me.left) {
    const left = Math.max(0, T.respawn - me.down);
    $('#sunk-count', sunk)!.textContent = left > 0.05 ? `Back in ${Math.ceil(left)}` : '';
  } else if (!sunk.hidden) sunk.hidden = true;

  tagsTick(w, seats, view, height);
  arrowsTick(w, view);
  powersTick(me);
  hintsTick(me);
}

/** Each power's button: lit while it is on, dark once used, until she is back from sinking. */
function powersTick(me: Ship | undefined) {
  const up = !!me && !me.out;
  for (let i = 0; i < powerEls.length; i++) {
    const b = powerEls[i], kind = POWERS[i];
    const on = up && ((kind === 'smoke' && me!.smoke > 0) || (kind === 'song' && me!.song > 0) || (kind === 'shield' && me!.shield > 0));
    const used = !up || !!me!.spent[i];
    const key = `${on}|${used}`;
    if (b.dataset.key === key) continue;
    b.dataset.key = key;
    b.classList.toggle('used', used && !on);
    b.classList.toggle('on', on);
  }
}

function tagFor(i: number): Tag {
  while (tags.length <= i) {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = '<div class="name"></div><div class="bar"><i></i></div><div class="ammo"></div><div class="sk"></div>';
    $('#tags', root!)!.append(el);
    tags.push({ el, name: $('.name', el)!, bar: $('.bar i', el)!, skulls: $('.sk', el)!, ammo: $('.ammo', el), key: '' });
  }
  return tags[i];
}

function tagsTick(w: World, seats: Seat[], view: View, height: (look: string) => number) {
  let n = 0;
  for (const s of w.ships) {
    if (s.out || hidden(w, s)) continue;
    const p = view.project(s.x, height(s.look) + 3, s.y);
    if (!p || !p.on) continue;
    const t = tagFor(n++);
    const seat = seats.find((x) => x.id === s.id);
    const mine = s.id === w.focus;
    const key = `${seat?.name}|${seat?.c}|${s.streak}|${mine}|${seat?.bot}`;
    if (key !== t.key) {
      t.key = key;
      t.el.className = `tag${mine ? ' me' : ''}${s.streak >= T.wanted ? ' wanted' : ''}`;
      const c = seat && seat.c >= 0 ? markOf(seat.c).color : '#fff';
      t.el.style.setProperty('--c', c);
      t.name.innerHTML = mine ? '' : `${esc(seat?.name ?? '')}${seat?.bot ? ' <small>bot</small>' : ''}`;
      t.skulls.textContent = s.streak >= T.wanted ? `WANTED ${SKULL.repeat(s.streak)}` : SKULL.repeat(s.streak);
    }
    t.bar.style.transform = `scaleX(${Math.max(0, s.hull / s.hullMax)})`;
    t.bar.style.background = s.hull / s.hullMax > 0.5 ? '' : s.hull / s.hullMax > 0.25 ? '#FFC53D' : '#FF4D3D';
    if (mine && t.ammo) ammoTick(t.ammo, s);
    t.el.style.transform = `translate(${p.x}px,${p.y}px)`;
    t.el.style.display = '';
  }
  for (let i = n; i < tags.length; i++) if (tags[i].el.style.display !== 'none') tags[i].el.style.display = 'none';
}

function ammoTick(el: HTMLElement, s: Ship) {
  if (el.childElementCount !== T.ammo) el.innerHTML = '<i><b></b></i>'.repeat(T.ammo);
  const pips = el.children;
  for (let i = 0; i < T.ammo; i++) {
    const b = pips[i].firstElementChild as HTMLElement;
    const fill = i < s.ammo ? 1 : i === s.ammo ? 1 - s.reloadT / T.reload : 0;
    b.style.transform = `scaleX(${Math.max(0, Math.min(1, fill))})`;
    pips[i].classList.toggle('full', i < s.ammo);
  }
  el.classList.toggle('heavy', s.heavy);
}

/** Arrows round the edge to the nearest ships you can't see. */
function arrowsTick(w: World, view: View) {
  const me = w.ships[w.focus];
  const W = innerWidth, H = innerHeight;
  const off: { s: Ship; d: number; x: number; y: number }[] = [];
  if (me && !me.out) {
    for (const s of w.ships) {
      if (s.out || s.id === me.id || hidden(w, s)) continue;
      const p = view.project(s.x, 0, s.y);
      if (!p || p.on) continue;
      off.push({ s, d: Math.hypot(s.x - me.x, s.y - me.y), x: p.x, y: p.y });
    }
    off.sort((a, b) => a.d - b.d);
  }
  const cx = W / 2, cy = H / 2, pad = 34;
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i], o = off[i];
    if (!o) { if (a.style.display !== 'none') a.style.display = 'none'; continue; }
    const dx = o.x - cx, dy = o.y - cy;
    const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
    a.style.display = '';
    a.style.transform = `translate(${cx + dx * k}px,${cy + dy * k}px)`;
    (a.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    a.lastElementChild!.textContent = `${Math.round(o.d)}m${o.s.streak ? ` ${SKULL}${o.s.streak}` : ''}`;
    a.classList.toggle('wanted', o.s.streak >= T.wanted);
  }
}

/** The first time at sea: what each thumb does, until each has been done. */
let hintShown = '';
function hintsTick(me: Ship | undefined) {
  const h = root && $('#hints', root);
  if (!h) return;
  const want = !me || me.out ? '' : !used.move ? 'left' : !used.aim && !used.tap ? 'right' : '';
  if (want === hintShown) return;
  hintShown = want;
  h.className = `hint ${want}`;
  h.innerHTML = want === 'left' ? '<b>Left thumb</b> · sail where you push'
    : want === 'right' ? '<b>Right thumb</b> · drag to aim, let go to fire<br>or tap to fire at the nearest ship' : '';
}

/** The win card is up: the host keeps it there until it is dismissed. */
export const winning = () => wonOpen;
