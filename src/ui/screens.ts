// Every screen, in flow order. Each returns { html, mount?, covered? }: mount optionally
// returns a teardown, and `covered` says the sea is entirely hidden behind it, so the
// loop can stop painting a picture nobody can see. Navigation is delegated: put
// data-go="#/path" on anything.

import { CLASSES, CLASS_IDS } from '../data/enemies';
import { LEGENDS } from '../data/legends';
import { heatFlags } from '../data/notoriety';
import { SHIPS, shipById } from '../data/ships';
import { shipForCode } from '../data/unlocks';
import { UPGRADES, bribeCost, recipeOf, shipStats } from '../data/upgrades';
import { HEAT } from '../data/notoriety';
import { clock, reales } from '../state/run';
import { nav, save, sea, session, unlockShip, wipe, type Quality } from '../state/session';
import type { View } from '../render/view';
import { mapFor } from '../sim/world';
import * as A from '../audio/audio';
import { track } from '../analytics';
import { buzz } from './haptics';
import { hudHtml, mountHud } from './hud';
import { touchUi } from './input';
import { silhouette } from './silhouette';

export interface Screen { html: string; mount?: (root: HTMLElement) => (() => void) | void; covered?: boolean }

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
/** Where a screen's back button goes: one step back along the trail the router keeps, and
 *  never back into an unlock reveal. */
const backTo = (fallback: string) => {
  const t = nav.trail, prev = t.length >= 2 ? t[t.length - 2] : null;
  return prev && !prev.startsWith('/unlock') ? `#${prev}` : fallback;
};

/** Draw this screen again after a change, keeping where the list was scrolled to and
 *  without the fade a screen arrives with: a purchase is not a new screen, and a list that
 *  jumped back to the top under the thumb had the next tap buy the wrong thing. */
function redraw() {
  const keep = document.querySelector<HTMLElement>('#ui .mid')?.scrollTop ?? 0;
  window.dispatchEvent(new Event('hashchange'));
  const fresh = document.querySelector<HTMLElement>('#ui .screen');
  if (fresh) fresh.style.animation = 'none';
  const mid = document.querySelector<HTMLElement>('#ui .mid');
  if (mid) mid.scrollTop = keep;
}

/** A button that does something that cannot be undone asks twice — and the second tap
 *  only counts once the question has been on screen long enough to be read, so a double
 *  tap is not an answer. Returns true when the second, deliberate tap comes. */
function sure(b: HTMLElement, ask: string): boolean {
  const armed = Number(b.dataset.armed || 0);
  if (armed && performance.now() - armed > 600) return true;
  if (!armed) {
    b.dataset.armed = String(performance.now());
    b.dataset.was = b.innerHTML;
    b.innerHTML = ask;
    setTimeout(() => { if (b.isConnected && b.dataset.armed) { b.innerHTML = b.dataset.was!; delete b.dataset.armed; } }, 4000);
  }
  return false;
}
const isTouch = touchUi;

const topbar = (label: string, back: string, menu = true) => `
  <div class="top">
    <button class="chip icon" data-go="${back}" aria-label="Back">${back === '#/' ? '✕' : '←'}</button>
    <span class="mono" style="font-size:11px;letter-spacing:.22em;opacity:.8">${label}</span>
    ${menu ? '<button class="chip icon burger" data-go="#/menu" aria-label="Articles"></button>' : '<span style="width:40px"></span>'}
  </div>`;

/** The scenery behind the shell: the run's own chart if there is one; with none, the
 *  chart already on screen (raising an archipelago is not free on a phone, and a summary
 *  screen should not stop to do it); and at a cold start, the chart the next run will
 *  sail, so weighing anchor finds it already built. */
function harbourScene(v: View, look: 'dusk' | 'clear' = 'dusk') {
  v.setMap(mapFor(session.run?.seed ?? v.chart ?? sea.next));
  v.setLook(look);
}

/* ================================================================ title == */

export function title(v: View): Screen {
  harbourScene(v);
  v.setMode('title');
  v.setShowcase(session.run?.ship ?? session.ship);
  A.setSea('clear');
  const rec = session.records;
  const run = session.run;
  const ship = shipById(run?.ship ?? session.ship);
  return {
    html: `
    <div class="screen">
      <div class="side">
        <div class="mid">
          <div class="eyebrow">${esc(ship.name)} · West Indies · 1715</div>
          <div class="disp titlemark">BLACK <br>FLAG</div>
          <div class="sub tsub">Open water, a Spanish fleet that hunts on sight, and a white flag that turns every enemy into a prize.</div>
        </div>
        ${run ? `
          <button class="cta gold" data-go="#/play">
            <div><b>Back to sea</b><span>${esc(shipById(run.ship).name)} · WAVE ${run.wave} · ${reales(run.plunder)} REALES</span></div><i>→</i></button>
          <button class="cta ghost" data-new>
            <div><b>New run</b><span>SCUTTLES THE ONE IN PROGRESS</span></div><i>⚓</i></button>
        ` : `
          <button class="cta gold" data-new>
            <div><b>Weigh anchor</b><span>${rec.runs ? `BEST · WAVE ${rec.bestWave}` : isTouch() ? 'LEFT THUMB SAILS · RIGHT THUMB FIRES' : 'WASD SAILS · Q/E FIRE BROADSIDES'}</span></div><i>→</i></button>
        `}
        <div class="chips">
          <button class="chip gold" data-go="#/shipyard">Shipyard · ${session.unlocked.length}/${SHIPS.length}</button>
          <button class="chip" data-go="#/records">Records</button>
          <button class="chip" data-go="#/log">Captain's log</button>
          <button class="chip icon burger" data-go="#/menu" aria-label="Articles"></button>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-new]', root)?.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLElement;
        // Scuttling a run in progress is a second tap; starting the first one is not.
        if (run && !sure(b, '<div><b>Tap again to scuttle</b><span>WAVE ' + run.wave + ' · ' + reales(run.plunder) + ' REALES GO DOWN WITH HER</span></div><i>⚓</i>')) return;
        buzz(10); emit('bf:new-run');
      });
    },
  };
}

/* ============================================================= shipyard == */

let yardPick: string | null = null;

function statBars(id: string) {
  const s = shipStats(shipById(id));
  const all = SHIPS.map((d) => shipStats(d));
  const max = (f: (x: typeof s) => number) => Math.max(...all.map(f));
  const rows: [string, number][] = [
    ['Hull', s.hullMax / max((x) => x.hullMax)],
    ['Speed', s.maxSpeed / max((x) => x.maxSpeed)],
    ['Helm', s.turnRate / max((x) => x.turnRate)],
    ['Guns', s.gunsPerSide / max((x) => x.gunsPerSide)],
    ['Reach', s.range / max((x) => x.range)],
    ['Weight', (s.gunsPerSide * s.dmg / s.reload) / max((x) => x.gunsPerSide * x.dmg / x.reload)],
  ];
  return `<div class="bars">${rows.map(([k, f]) => `<span class="k">${k}</span><span class="b"><i style="width:${Math.round(f * 100)}%"></i></span>`).join('')}</div>`;
}

export function shipyard(v: View): Screen {
  harbourScene(v, 'clear');
  v.setMode('shipyard');
  const pick = yardPick && SHIPS.some((s) => s.id === yardPick) ? yardPick : session.ship;
  yardPick = pick;
  v.setShowcase(pick);
  const def = shipById(pick);
  const own = session.unlocked.includes(pick);
  const chosen = session.ship === pick;
  const b = def.base;

  const cards = SHIPS.map((s) => {
    const has = session.unlocked.includes(s.id);
    return `
      <button class="hullcard ${s.id === pick ? 'on' : ''} ${has ? '' : 'locked'}" data-pick="${s.id}">
        ${silhouette(recipeOf(s), 74, 42)}
        <div class="t"><b>${has ? esc(s.name) : '— — —'}</b><span>${esc(s.rank)}</span></div>
        ${session.ship === s.id ? '<span class="tag gold">SAILING</span>' : has ? '' : '<span class="tag">LOCKED</span>'}
      </button>`;
  }).join('');

  return {
    html: `
    <div class="screen">
      <div class="side" style="width:min(460px,56vw)">
        ${topbar('SHIPYARD', backTo('#/'))}
        <div class="mid">
          <div class="yard">${cards}</div>
          <div class="rule" style="margin:6px 0"></div>
          <div>
            <div class="eyebrow">${esc(def.rank)} · ${b.gunsPerSide} guns a side${b.bowGun ? ' · bow chasers' : ''}</div>
            <div class="disp yardname">${own ? esc(def.name) : 'Not yet yours'}</div>
            <div class="sub" style="font-size:13.5px">${own ? esc(def.blurb) : 'Every ship on the register has her own code. Scan hers with your phone\'s camera and she is yours.'}</div>
          </div>
          ${statBars(pick)}
        </div>
        ${own ? `
          <button class="cta ${chosen ? 'ghost' : 'gold'}" data-choose ${chosen ? 'disabled' : ''}>
            <div><b>${chosen ? 'Your ship' : 'Sail her'}</b><span>${chosen ? 'SHE IS WHAT YOU PUT TO SEA IN' : session.run ? 'FROM YOUR NEXT RUN' : 'SHE IS WHAT YOU PUT TO SEA IN'}</span></div><i>${chosen ? '✓' : '→'}</i></button>
        ` : `
          <form class="codeform" data-code>
            <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="Scan her QR code, or type it" aria-label="Unlock code">
            <button class="chip gold" type="submit">Unlock</button>
          </form>
        `}
      </div>
    </div>`,
    mount(root) {
      $$('[data-pick]', root).forEach((el) => el.addEventListener('click', () => {
        buzz(6); yardPick = el.dataset.pick!; A.click();
        redraw();
      }));
      $('[data-choose]', root)?.addEventListener('click', () => {
        session.ship = pick; save(); buzz(14); A.pickup();
        track('ship_select', { ship: pick });
        redraw();
      });
      // A code typed in, for whoever cannot scan: a phone playing from its home screen
      // keeps its own storage, apart from the browser the camera opens a QR code in.
      $<HTMLFormElement>('[data-code]', root)?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = ($<HTMLInputElement>('input', e.currentTarget as HTMLElement)?.value || '').trim();
        if (code) location.hash = `#/unlock/${encodeURIComponent(code)}`;
      });
      return spinner(root, v);
    },
  };
}

/** Drag the empty sea to walk round the ship. */
function spinner(root: HTMLElement, v: View) {
  let x: number | null = null;
  const down = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.side,button')) return; x = e.clientX; };
  const move = (e: PointerEvent) => { if (x == null) return; v.nudgeOrbit((e.clientX - x) * -0.006); x = e.clientX; };
  const up = () => { x = null; };
  root.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
}

/* =============================================================== unlock == */

export function unlock(v: View, code: string): Screen {
  harbourScene(v, 'clear');
  v.setMode('shipyard');
  const id = shipForCode(code);
  if (!id) {
    v.setShowcase(session.ship);
    return {
      html: `
      <div class="screen"><div class="scrim"></div>
        <div class="center">
          <div class="eyebrow" style="color:#E0533F">NO SUCH SHIP ON THE REGISTER</div>
          <div class="disp" style="font-size:30px">That code sails nothing</div>
          <div class="sub" style="max-width:420px">Check the code, or scan it again. They look like <span class="mono" style="font-size:12px">ABCDE-1F</span>.</div>
          <div class="stack" style="margin-top:10px">
            <button class="cta gold" data-go="#/shipyard"><div><b>To the shipyard</b><span>SEE WHAT IS YOURS</span></div><i>→</i></button>
            <button class="cta ghost" data-go="#/"><div><b>Title</b><span>BACK TO NASSAU</span></div><i>⚓</i></button>
          </div>
        </div>
      </div>`,
    };
  }
  const def = shipById(id);
  const news = unlockShip(id);
  v.setShowcase(id);
  if (news) track('ship_unlock', { ship: id });
  return {
    html: `
    <div class="screen">
      <div class="reveal">
        <div class="who rays">
          <div class="eyebrow">${news ? 'A NEW SHIP ON THE REGISTER' : 'ALREADY ON YOUR REGISTER'}</div>
          <div class="disp" style="font-size:clamp(34px,6vw,54px);margin:8px 0">${esc(def.name)}</div>
          <div class="mono" style="font-size:10.5px;opacity:.7;margin-bottom:10px">${esc(def.rank)} · ${def.base.gunsPerSide} GUNS A SIDE</div>
          <div class="sub">${esc(def.blurb)}</div>
        </div>
        <div class="acts rays">
          <button class="cta gold" data-take><div><b>Take her out</b><span>${session.run ? 'FROM YOUR NEXT RUN' : 'SAIL HER NEXT'}</span></div><i>→</i></button>
          <button class="cta ghost" data-go="#/shipyard"><div><b>Shipyard</b><span>${session.unlocked.length} OF ${SHIPS.length} ON THE REGISTER</span></div><i>⚓</i></button>
        </div>
      </div>
    </div>`,
    mount(root) {
      if (news) {
        v.whiteout(0.5, '#FFE7B0');
        // A QR code opens the page before anyone has touched it, and a browser will not
        // play a note until they have: the fanfare waits for the first tap.
        A.unlock();
        if (A.running()) A.fanfare();
        else addEventListener('pointerup', () => { A.unlock(); A.onceRunning(A.fanfare); }, { once: true });
      }
      $('[data-take]', root)?.addEventListener('click', () => {
        session.ship = id; save(); buzz(14);
        track('ship_select', { ship: id });
        yardPick = id;
        location.hash = session.run ? '#/shipyard' : '#/';
      });
      return spinner(root, v);
    },
  };
}

/* ================================================================= play == */

export function play(v: View, onDock: () => void): Screen {
  v.setMode('play');
  return {
    html: `<div class="screen">${hudHtml(isTouch())}</div>`,
    mount(root) { return mountHud(root, onDock); },
  };
}

/* ================================================================= port == */

let lastBuy = 0;

export function port(v: View): Screen {
  const run = session.run;
  if (!run) return title(v);
  harbourScene(v, 'dusk');
  v.setMode('port');
  v.setShowcase(run.ship);
  A.setSea('port');
  const up = run.upgrades;
  const def = shipById(run.ship);
  const now = shipStats(def, up);

  const row = (u: typeof UPGRADES[number]) => {
    const lvl = up[u.id] ?? 0;
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : u.cost(lvl);
    const can = !maxed && run.plunder >= cost;
    return `
      <button class="up" data-buy="${u.id}" ${can ? '' : 'disabled'}>
        <div class="t">
          <b>${u.name}</b><span>${u.note}</span>
          <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="p ${can ? '' : 'no'}">${maxed ? 'FULL' : reales(cost)}</div>
      </button>`;
  };
  const bribe = bribeCost(run.bribes || 0);
  const canBribe = run.plunder >= bribe && run.heat > 0;

  return {
    html: `
    <div class="screen">
      <div class="portsheet">
        <div class="porthead">
          <div>
            <div class="eyebrow">Nassau · hove down</div>
            <div class="disp porttitle">Careened at Nassau</div>
          </div>
          <div class="chips">
            <button class="chip" data-go="#/">Title</button>
            <button class="chip icon burger" data-go="#/menu" aria-label="Articles"></button>
          </div>
        </div>
        <div class="mono" style="font-size:10.5px;color:var(--gold)">${reales(run.plunder)} REALES IN THE HOLD</div>
        <div class="mono" style="font-size:9.5px;opacity:.6;margin-top:6px">${esc(def.name)} · ${now.hullMax} HULL · ${now.gunsPerSide} GUNS A SIDE · ${run.lives < 0 ? now.lives : run.lives} LIVES</div>
        <div class="rule"></div>
        <div class="mid">
          ${UPGRADES.map(row).join('')}
          <button class="up" data-bribe ${canBribe ? '' : 'disabled'}>
            <div class="t">
              <b>Bribe the harbourmaster</b><span>notoriety ${HEAT.bribe} · ${heatFlags(run.heat)} flags flying</span>
              <div class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < heatFlags(run.heat) ? 'on' : ''}"></i>`).join('')}</div>
            </div>
            <div class="p ${canBribe ? '' : 'no'}">${reales(bribe)}</div>
          </button>
        </div>
        <button class="cta gold" data-go="#/play">
          <div><b>Set sail</b><span>WAVE ${run.wave}${run.wave % 5 === 0 ? ' · SOMETHING LARGE IS WAITING' : ''}</span></div><i>→</i></button>
      </div>
    </div>`,
    mount(root) {
      $$('[data-buy]', root).forEach((b) => b.addEventListener('click', () => {
        if (performance.now() - lastBuy < 400) return;
        lastBuy = performance.now();
        const u = UPGRADES.find((x) => x.id === b.dataset.buy)!;
        const lvl = up[u.id] ?? 0;
        if (lvl >= u.max || run.plunder < u.cost(lvl)) return;
        run.plunder -= u.cost(lvl);
        up[u.id] = lvl + 1;
        if (u.id === 'life') run.lives = (run.lives < 0 ? shipStats(def).lives : run.lives) + 1;
        save(); buzz(14); A.pickup();
        redraw();
      }));
      $('[data-bribe]', root)?.addEventListener('click', () => {
        const c = bribeCost(run.bribes || 0);
        if (run.plunder < c || run.heat <= 0) return;
        run.plunder -= c;
        run.heat = Math.max(0, run.heat + HEAT.bribe);
        run.bribes = (run.bribes || 0) + 1;
        save(); buzz(14); A.pickup();
        redraw();
      });
    },
  };
}

/* ================================================================= dead == */

export function dead(v: View): Screen {
  const s = session.lastRun;
  if (!s) return title(v);
  harbourScene(v, 'dusk');
  v.setMode('title');
  v.setShowcase(s.ship);
  A.setSea('clear');
  const best = s.wave >= session.records.bestWave;
  return {
    html: `
    <div class="screen">
      <div class="side">
        <div class="mid">
          <div class="eyebrow" style="color:#E0533F">The ${esc(shipById(s.ship).name)} is lost</div>
          <div class="disp deadwave">Wave ${s.wave}</div>
          ${best ? '<div class="mono" style="font-size:10.5px;color:var(--gold)">DEEPEST YOU HAVE BEEN</div>' : ''}
          <div class="rule" style="margin:6px 0"></div>
          <div class="stats">
            <div class="stat"><span class="k">Plunder</span><span class="v gold">${reales(s.plunder)}</span></div>
            <div class="stat"><span class="k">Boarded</span><span class="v">${s.boarded}</span></div>
            <div class="stat"><span class="k">Sent down</span><span class="v">${s.sunk}</span></div>
            <div class="stat"><span class="k">Time at sea</span><span class="v">${clock(s.time)}</span></div>
          </div>
        </div>
        <button class="cta gold" data-new><div><b>Fit out another</b><span>NEW RUN</span></div><i>⚓</i></button>
        <div class="chips">
          <button class="chip" data-go="#/shipyard">Shipyard</button>
          <button class="chip" data-go="#/records">Records</button>
          <button class="chip" data-go="#/log">Captain's log</button>
          <button class="chip" data-go="#/">Title</button>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-new]', root)?.addEventListener('click', () => { buzz(10); emit('bf:new-run'); });
    },
  };
}

/* ============================================================== records == */

export function records(): Screen {
  const r = session.records;
  return {
    covered: true,
    html: `
    <div class="screen"><div class="paper"><div class="col">
      ${topbar('RECORD BOOK', backTo('#/'))}
      <div class="disp" style="font-size:32px;margin-bottom:6px">The book</div>
      <div class="sub">Kept on this device, and nowhere else.</div>
      <div class="rule"></div>
      <div class="stat"><span class="k">Deepest wave</span><span class="v gold">${r.bestWave || '—'}</span></div>
      <div class="stat"><span class="k">Most plunder</span><span class="v gold">${r.bestPlunder ? reales(r.bestPlunder) : '—'}</span></div>
      <div class="stat"><span class="k">Longest at sea</span><span class="v">${r.bestTime ? clock(r.bestTime) : '—'}</span></div>
      <div class="stat"><span class="k">Ships boarded</span><span class="v">${r.boarded}</span></div>
      <div class="stat"><span class="k">Ships sent down</span><span class="v">${r.sunk}</span></div>
      <div class="stat"><span class="k">Legendaries beaten</span><span class="v">${r.legends || 0}</span></div>
      <div class="stat"><span class="k">Runs</span><span class="v">${r.runs}</span></div>
      <div class="stat"><span class="k">Ships on the register</span><span class="v">${session.unlocked.length} / ${SHIPS.length}</span></div>
    </div></div></div>`,
  };
}

/* ================================================================== log == */

export function log(): Screen {
  const seen = session.seen, beaten = session.beaten;
  const card = (name: string, note: string, svg: string, met: boolean, meta: string) => `
    <div class="logcard${met ? '' : ' unmet'}">
      ${svg}
      <div class="t">
        <b>${met ? esc(name) : '— — —'}</b>
        <p>${met ? esc(note) : 'Not yet met.'}</p>
        ${met ? `<span class="m">${meta}</span>` : ''}
      </div>
    </div>`;
  const classes = CLASS_IDS.map((id) => {
    const C = CLASSES[id], n = seen[id] || 0;
    return card(`${C.name} · ${C.rank}`, C.note, silhouette(C.recipe, 96, 56), n > 0,
      `MET ${n} TIME${n === 1 ? '' : 'S'} · ${C.reales ? `${C.reales} REALES` : 'NO CARGO'}`);
  }).join('');
  const legends = LEGENDS.map((L) => {
    const n = beaten[L.id] || 0, met = n > 0 || (seen[L.id] || 0) > 0;
    return card(L.name, L.note, silhouette(L.recipe, 96, 56), met, n ? `BEATEN ${n}× · ${reales(L.reales)} REALES` : 'MET, NOT BEATEN');
  }).join('');
  const mine = SHIPS.filter((s) => session.unlocked.includes(s.id)).map((s) =>
    card(`${s.name} · ${s.rank}`, s.blurb, silhouette(recipeOf(s), 96, 56), true, session.ship === s.id ? 'SAILING' : 'ON THE REGISTER')).join('');
  return {
    covered: true,
    html: `
    <div class="screen"><div class="paper"><div class="col">
      ${topbar("CAPTAIN'S LOG", backTo('#/'))}
      <div class="disp" style="font-size:32px;margin-bottom:6px">What we have met</div>
      <div class="sub">Every hull that has crossed your bow, and what it cost.</div>
      <div class="rule"></div>
      <div class="mono" style="font-size:10px;opacity:.55;margin:4px 0 4px">YOURS</div>
      ${mine}
      <div class="mono" style="font-size:10px;opacity:.55;margin:22px 0 4px">SPANISH NAVY</div>
      ${classes}
      <div class="mono" style="font-size:10px;opacity:.55;margin:22px 0 4px">LEGENDARY</div>
      ${legends}
    </div></div></div>`,
  };
}

/* ================================================================= menu == */

const QUALITY: Quality[] = ['auto', 'low', 'high'];

export function menu(v: View): Screen {
  const s = session;
  const toggles: [keyof typeof s, string][] = [['sound', 'Sound'], ['haptics', 'Haptics'], ['reduceMotion', 'Reduce motion']];
  // Only where a page can have the whole screen: Android and tablets, not iPhones.
  if (document.fullscreenEnabled && isTouch()) toggles.push(['fullscreen', 'Full screen']);
  return {
    covered: true,
    html: `
    <div class="screen"><div class="paper"><div class="col">
      ${topbar('SHIP’S ARTICLES', backTo('#/'), false)}
      <div class="disp" style="font-size:32px;margin-bottom:14px">Articles</div>
      <div class="rowlist">
        ${toggles.map(([k, l]) => `<button data-t="${k}">${l} <span class="r ${s[k] ? 'gold' : ''}">${s[k] ? 'ON' : 'OFF'}</span></button>`).join('')}
        <button data-q>Picture <span class="r gold">${s.quality.toUpperCase()}${s.quality === 'auto' ? ` · ${v.tier.toUpperCase()}` : ''}</span></button>
        <button data-go="#/shipyard">Shipyard <span class="r">${s.unlocked.length} OF ${SHIPS.length}</span></button>
        <button data-go="#/records">Record book <span class="r">WAVE ${s.records.bestWave || 0} BEST</span></button>
        <button data-go="#/log">Captain's log <span class="r">${Object.keys(s.seen).length} MET</span></button>
        <button data-wipe>Burn the log <span class="r">CLEARS EVERYTHING</span></button>
      </div>
      <div style="text-align:center;margin-top:36px">
        <div class="mark" style="opacity:.35">BLACK FLAG</div>
        <div class="mono" style="font-size:9.5px;opacity:.45;margin-top:9px">V2 · OPEN SEA</div>
      </div>
    </div></div></div>`,
    mount(root) {
      $$('[data-t]', root).forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.t as 'sound' | 'haptics' | 'reduceMotion' | 'fullscreen';
        s[k] = !s[k];
        save(); buzz(6);
        emit(k === 'fullscreen' ? 'bf:fullscreen' : 'bf:prefs');
        redraw();
      }));
      $('[data-q]', root)?.addEventListener('click', () => {
        s.quality = QUALITY[(QUALITY.indexOf(s.quality) + 1) % QUALITY.length];
        save();
        // The renderer is built for a tier; changing it is a reload, not a toggle.
        location.reload();
      });
      $('[data-wipe]', root)?.addEventListener('click', (e) => {
        // Two taps, not a confirm() — a modal dialog blocks the frame loop.
        if (!sure(e.currentTarget as HTMLElement, 'Burn the log <span class="r" style="color:#E0533F">TAP AGAIN · EVERYTHING GOES</span>')) return;
        wipe();
        location.reload();
      });
    },
  };
}

/* ================================================================ pause == */

export function pause(v: View, live: boolean): Screen {
  // Over the paused sea if there is one — even after a visit to the Articles or the yard.
  v.setMode(v.world ? 'play' : 'title');
  const wave = session.run?.wave;
  return {
    html: `
    <div class="screen">
      <div class="scrim"></div>
      <div class="center">
        <div class="disp" style="font-size:36px">Hove to</div>
        <div class="mono" style="font-size:10.5px;opacity:.65;margin-bottom:8px">THE SEA IS STILL COMING</div>
        <div class="stack">
          <button class="cta gold" data-go="#/play"><div><b>Make sail</b><span>RESUME</span></div><i>→</i></button>
          ${live ? `
            <button class="cta ghost" data-again><div><b>Come about</b><span>WAVE ${wave} AGAIN FROM THE TOP</span></div><i>↻</i></button>
            <button class="cta ghost" data-retreat><div><b>Run for Nassau</b><span>RETREAT · WAVE ${wave} STANDS UNSAILED</span></div><i>⚓</i></button>
          ` : ''}
          <div class="chips" style="justify-content:center">
            <button class="chip" data-go="#/menu">Articles</button>
            <button class="chip" data-abandon>Scuttle her</button>
          </div>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-again]', root)?.addEventListener('click', () => { buzz(12); emit('bf:restart-wave'); });
      $('[data-retreat]', root)?.addEventListener('click', () => { buzz(12); emit('bf:retreat'); });
      $('[data-abandon]', root)?.addEventListener('click', (e) => {
        if (!sure(e.currentTarget as HTMLElement, 'Certain? Tap again')) return;
        buzz(20);
        emit('bf:abandon');
      });
    },
  };
}
