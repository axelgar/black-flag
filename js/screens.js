// Every screen, in flow order. Each returns { html, mount? }, where mount optionally
// returns a teardown. Navigation is delegated: put data-go="#/path" on anything.
//
// The HUD is DOM rather than canvas on purpose — it is text and bars, it has to be
// readable at a phone's smallest size, and it must never cost the fleet layer a frame.

import * as R from './render.js';
import * as S from './state.js';
import * as A from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ponytail: iOS has no Vibration API, and flipping a <input type="checkbox" switch>
// through its label is the only thing WebKit answers with a real haptic.
let hapLabel = null;
const iosTap = () => {
  if (!hapLabel) {
    hapLabel = Object.assign(document.createElement('label'), { htmlFor: 'ios-haptic' });
    hapLabel.style.cssText = 'position:fixed;width:1px;height:1px;clip-path:inset(50%);pointer-events:none';
    hapLabel.innerHTML = '<input type="checkbox" switch id="ios-haptic" tabindex="-1" aria-hidden="true">';
    document.body.append(hapLabel);
  }
  hapLabel.click();
};
export const buzz = (ms = 8) => S.session.haptics && (navigator.vibrate?.(ms) ?? iosTap());

const backTo = (fallback) => (S.nav.from ? `#${S.nav.from}` : fallback);

// `back` of null draws no way out — Nassau is left by sailing, not by a chevron.
const topbar = (label, back = '#/') => `
  <div class="top">
    ${back == null ? '<span style="width:38px"></span>'
      : `<button class="chip icon" data-go="${back}" aria-label="${back === '#/' ? 'Close' : 'Back'}">${back === '#/' ? '\u2715' : '\u2190'}</button>`}
    <span class="mono" style="font-size:11px;letter-spacing:.22em;opacity:.8">${label}</span>
    <button class="chip icon burger" data-go="#/menu" aria-label="Menu"></button>
  </div>`;

/* ================================================================ title == */

export function title() {
  R.scene.mode = 'sea'; R.scene.hidden = false; R.scene.world = null;
  A.setSea('clear');
  const rec = S.session.records;
  const resume = S.session.run;
  return { html: `
    <div class="screen">
      <div class="hd" style="top:132px">
        <div class="mark" style="opacity:.72">ASSASSIN'S CREED IV</div>
        <div class="disp" style="font-size:54px;line-height:.94;letter-spacing:.06em;margin-top:20px;
          text-shadow:0 6px 24px rgba(4,16,22,.75)">BLACK<br>FLAG</div>
        <div class="rule"></div>
        <div class="mono" style="font-size:10.5px;opacity:.72">THE JACKDAW · WEST INDIES · 1715</div>
      </div>
      <div class="dock">
        ${resume ? `
          <button class="cta gold" style="margin-bottom:10px" data-go="#/play">
            <div><b>Back to sea</b><span>WAVE ${resume.wave} · ${S.reales(resume.plunder)} REALES</span></div><i>→</i></button>
          <button class="cta ghost" style="margin-bottom:10px" data-new>
            <div><b>New run</b><span>SCUTTLES THE ONE IN PROGRESS</span></div><i>⚓</i></button>
        ` : `
          <button class="cta gold" style="margin-bottom:10px" data-new>
            <div><b>Weigh anchor</b><span>${rec.runs ? `BEST · WAVE ${rec.bestWave}` : 'DRAG TO STEER · SHE FIRES HERSELF'}</span></div><i>→</i></button>
        `}
        <div style="display:flex;gap:9px">
          <button class="chip" style="flex:1;justify-content:center" data-go="#/records">Records</button>
          <button class="chip" style="flex:1;justify-content:center" data-go="#/log">Captain's log</button>
          <button class="chip icon burger" data-go="#/menu" aria-label="Menu"></button>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-new]', root)?.addEventListener('click', () => {
        buzz(10);
        window.dispatchEvent(new Event('bf:new-run'));
      });
    },
  };
}

/* ================================================================= play == */

// The HUD is rebuilt on mount and then only written to when a number actually changes.
// A phone repainting five text nodes sixty times a second is a frame it did not spend
// on the sea.
let hud = null;

export function play() {
  R.scene.mode = 'play'; R.scene.hidden = false;
  return { html: `
    <div class="screen">
      <div class="hud" id="hud">
        <div class="hudtop">
          <div class="col">
            <div class="hullbar" id="h-bar"><i style="width:100%"></i></div>
            <div class="hudline">
              <span class="hearts" id="h-lives">♥♥♥</span>
              <span class="coin" id="h-coin">0</span>
              <span style="opacity:.6" id="h-wave">WAVE 1</span>
              <span style="flex:1"></span>
              <span class="flags" id="h-flags">${'<i></i>'.repeat(5)}</span>
            </div>
          </div>
          <button class="chip icon" data-go="#/pause" aria-label="Pause" style="flex:none">❙❙</button>
        </div>
        <div class="bossbar" id="h-boss"><div class="n" id="h-bossname"></div><div class="b"><i style="width:100%"></i></div></div>
        <div class="buffs" id="h-buffs"></div>
        <div class="toast" id="h-toast"></div>
        <button class="mortar" id="h-mortar" aria-label="Fire the mortar"><b id="h-shells">3</b>MORTAR</button>
      </div>
    </div>`,
    mount(root) {
      hud = {
        bar: $('#h-bar', root), fill: $('#h-bar i', root), lives: $('#h-lives', root),
        coin: $('#h-coin', root), wave: $('#h-wave', root), flags: $$('#h-flags i', root),
        flagbox: $('#h-flags', root), boss: $('#h-boss', root), bossName: $('#h-bossname', root),
        bossFill: $('#h-boss .b i', root), buffs: $('#h-buffs', root), toast: $('#h-toast', root),
        mortar: $('#h-mortar', root), shells: $('#h-shells', root),
        last: {},
      };
      const btn = hud.mortar;
      const fire = (e) => { e.preventDefault(); buzz(12); window.dispatchEvent(new Event('bf:mortar')); };
      btn.addEventListener('pointerdown', fire);
      return () => { hud = null; };
    },
  };
}

const HEARTS = (n) => '♥'.repeat(Math.max(0, n)) + '<span style="opacity:.25">♡</span>'.repeat(Math.max(0, 3 - n));

/** Called every frame by app.js. No-ops when the HUD is not on screen. */
export function hudTick(w) {
  if (!hud || !w) return;
  const L = hud.last;
  const hp = Math.max(0, w.ship.hull / w.ship.hullMax);
  if (Math.abs((L.hp ?? -1) - hp) > 0.004) {
    hud.fill.style.width = `${(hp * 100).toFixed(1)}%`;
    hud.bar.classList.toggle('low', hp < 0.34);
    L.hp = hp;
  }
  if (L.lives !== w.lives) { hud.lives.innerHTML = HEARTS(w.lives); L.lives = w.lives; }
  if (L.coin !== w.plunder) { hud.coin.textContent = `${S.reales(w.plunder)} R`; L.coin = w.plunder; }
  if (L.wave !== w.wave) { hud.wave.textContent = `WAVE ${w.wave}`; L.wave = w.wave; }
  if (L.shells !== w.ship.shells) {
    hud.shells.textContent = w.ship.shells;
    hud.mortar.disabled = w.ship.shells <= 0;
    L.shells = w.ship.shells;
  }
  const flags = S.heatFlags(w.heat);
  if (L.flags !== flags) {
    hud.flags.forEach((f, i) => f.classList.toggle('on', i < flags));
    hud.flagbox.classList.toggle('hot', flags >= S.HUNTER_AT);
    L.flags = flags;
    A.setHeat(w.heat);
  }
  const boss = w.boss;
  if (!!boss !== !!L.boss) { hud.boss.classList.toggle('on', !!boss); L.boss = boss; }
  if (boss) {
    hud.bossName.textContent = boss.legend.name;
    hud.bossFill.style.width = `${Math.max(0, (boss.hull / boss.hullMax) * 100).toFixed(1)}%`;
  }
  const b = w.ship.buffs;
  const on = Object.keys(b).filter((k) => b[k] !== 0).join(',');
  if (L.buffs !== on) {
    hud.buffs.innerHTML = Object.keys(b).filter((k) => b[k] !== 0)
      .map((k) => `<span class="buff">${k}${b[k] > 0 ? ` ${Math.ceil(b[k])}` : ''}</span>`).join('');
    L.buffs = on;
  }
}

/** The shout in the middle of the screen. One at a time, and it never queues. */
export function toast(big, small = '') {
  if (!hud) return;
  hud.toast.innerHTML = `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ''}`;
  hud.toast.classList.remove('go');
  void hud.toast.offsetWidth;                 // restart the animation, not queue it
  hud.toast.classList.add('go');
}

/* ================================================================= port == */

export function port() {
  R.scene.mode = 'port'; R.scene.hidden = false; R.scene.world = null;
  A.setSea('port');
  const run = S.session.run;
  if (!run) return title();
  const up = run.upgrades;

  const row = (u) => {
    const lvl = up[u.id] | 0;
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : u.cost(lvl);
    const can = !maxed && run.plunder >= cost;
    return `
      <button class="up" data-buy="${u.id}" ${can ? '' : 'disabled'}>
        <div class="t">
          <b>${u.name}</b><span>${u.note}</span>
          <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="p ${can ? '' : 'no'}">${maxed ? 'FULL' : S.reales(cost)}</div>
      </button>`;
  };

  const bribe = S.bribeCost(run.bribes || 0);
  const canBribe = run.plunder >= bribe && run.heat > 0;

  // The careening beach is painted on the canvas above the sheet, so the sheet starts
  // low enough to leave it visible and is translucent enough to keep it there.
  return { html: `
    <div class="screen">
      <button class="chip icon burger" data-go="#/menu" aria-label="Menu"
        style="position:absolute;top:18px;right:var(--gutter);z-index:8"></button>
      <div class="hd" style="top:26px">
        <div class="mono eyebrow" style="margin-bottom:8px">NASSAU · HOVE DOWN</div>
      </div>
      <div class="portsheet">
        <div style="text-align:center;margin-bottom:6px">
          <div class="disp" style="font-size:30px">Careened at Nassau</div>
          <div class="mono" style="font-size:10.5px;margin-top:9px;color:var(--gold)">
            ${S.reales(run.plunder)} REALES IN THE HOLD
          </div>
        </div>
        <div class="rule"></div>
        ${S.UPGRADES.map(row).join('')}
        <button class="up" data-bribe ${canBribe ? '' : 'disabled'}>
          <div class="t">
            <b>Bribe the harbourmaster</b><span>notoriety −2 · ${S.heatFlags(run.heat)} flags flying</span>
            <div class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < S.heatFlags(run.heat) ? 'on' : ''}"></i>`).join('')}</div>
          </div>
          <div class="p ${canBribe ? '' : 'no'}">${S.reales(bribe)}</div>
        </button>
        <div style="height:120px"></div>
      </div>
      <div class="dock">
        <button class="cta gold" data-go="#/play">
          <div><b>Set sail</b><span>WAVE ${run.wave}${run.wave % 5 === 0 ? ' · SOMETHING LARGE IS WAITING' : ''}</span></div><i>→</i></button>
      </div>
    </div>`,
    mount(root) {
      $$('[data-buy]', root).forEach((b) => b.addEventListener('click', () => {
        const u = S.UPGRADES.find((x) => x.id === b.dataset.buy);
        const lvl = up[u.id] | 0;
        if (lvl >= u.max || run.plunder < u.cost(lvl)) return;
        run.plunder -= u.cost(lvl);
        up[u.id] = lvl + 1;
        if (u.id === 'life') run.lives++;
        S.save(); buzz(14); A.pickup();
        window.dispatchEvent(new Event('hashchange'));
      }));
      $('[data-bribe]', root)?.addEventListener('click', () => {
        const c = S.bribeCost(run.bribes || 0);
        if (run.plunder < c || run.heat <= 0) return;
        run.plunder -= c;
        run.heat = Math.max(0, run.heat + S.HEAT.bribe);
        run.bribes = (run.bribes || 0) + 1;
        S.save(); buzz(14); A.pickup();
        window.dispatchEvent(new Event('hashchange'));
      });
    },
  };
}

/* ================================================================= dead == */

export function dead() {
  R.scene.mode = 'sea'; R.scene.hidden = false; R.scene.world = null;
  A.setSea('clear');
  const s = S.session.lastRun;
  if (!s) return title();
  const rec = S.session.records;
  const best = s.wave >= rec.bestWave;
  return { html: `
    <div class="screen">
      <div class="paper" style="padding-top:120px">
        <div style="text-align:center">
          <div class="mono eyebrow" style="color:#C4574C;opacity:1">THE JACKDAW IS LOST</div>
          <div class="disp" style="font-size:38px">Wave ${s.wave}</div>
          ${best ? '<div class="mono" style="font-size:10.5px;margin-top:12px;color:var(--gold)">DEEPEST YOU HAVE BEEN</div>' : ''}
        </div>
        <div class="rule"></div>
        <div class="stat"><span class="k">Plunder</span><span class="v gold">${S.reales(s.plunder)}</span></div>
        <div class="stat"><span class="k">Boarded</span><span class="v">${s.boarded}</span></div>
        <div class="stat"><span class="k">Sent down</span><span class="v">${s.sunk}</span></div>
        <div class="stat"><span class="k">Time at sea</span><span class="v">${S.clock(s.time)}</span></div>
        <div style="height:150px"></div>
      </div>
      <div class="dock">
        <button class="cta gold" style="margin-bottom:10px" data-new>
          <div><b>Fit out another</b><span>NEW RUN</span></div><i>⚓</i></button>
        <div style="display:flex;gap:9px">
          <button class="chip" style="flex:1;justify-content:center" data-go="#/records">Records</button>
          <button class="chip" style="flex:1;justify-content:center" data-go="#/log">Captain's log</button>
          <button class="chip" style="flex:1;justify-content:center" data-go="#/">Title</button>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-new]', root)?.addEventListener('click', () => { buzz(10); window.dispatchEvent(new Event('bf:new-run')); });
    },
  };
}

/* ============================================================== records == */

export function records() {
  R.scene.hidden = true; R.scene.mode = 'none';
  const r = S.session.records;
  return { html: `
    <div class="screen">
      <div class="paper">
        ${topbar('RECORD BOOK', backTo('#/'))}
        <div class="disp" style="font-size:32px;margin-bottom:6px">The book</div>
        <div class="sub" style="margin-bottom:6px">Kept on this device, and nowhere else.</div>
        <div class="rule"></div>
        <div class="stat"><span class="k">Deepest wave</span><span class="v gold">${r.bestWave || '—'}</span></div>
        <div class="stat"><span class="k">Most plunder</span><span class="v gold">${r.bestPlunder ? S.reales(r.bestPlunder) : '—'}</span></div>
        <div class="stat"><span class="k">Longest at sea</span><span class="v">${r.bestTime ? S.clock(r.bestTime) : '—'}</span></div>
        <div class="stat"><span class="k">Ships boarded</span><span class="v">${r.boarded}</span></div>
        <div class="stat"><span class="k">Ships sent down</span><span class="v">${r.sunk}</span></div>
        <div class="stat"><span class="k">Legendaries beaten</span><span class="v">${r.legends || 0}</span></div>
        <div class="stat"><span class="k">Runs</span><span class="v">${r.runs}</span></div>
        <div style="height:60px"></div>
      </div>
    </div>` };
}

/* ================================================================== log == */

export function log() {
  R.scene.hidden = true; R.scene.mode = 'none';
  const seen = S.session.seen, beaten = S.session.beaten;

  const card = (o, met, meta) => `
    <div class="logcard${met ? '' : ' unmet'}">
      <canvas data-sprite='${esc(JSON.stringify(o.sprite))}'></canvas>
      <div class="t">
        <b>${met ? esc(o.name) : '— — —'}</b>
        <p>${met ? esc(o.note) : 'Not yet met.'}</p>
        ${met ? `<span class="m">${meta}</span>` : ''}
      </div>
    </div>`;

  const classes = S.CLASS_IDS.map((id) => {
    const C = S.CLASSES[id];
    const n = seen[id] || 0;
    return card(
      { name: `${C.name} · ${C.rank}`, note: C.note, sprite: { w: C.w, l: C.l, masts: C.masts } },
      n > 0, `MET ${n} TIME${n === 1 ? '' : 'S'} · ${C.reales ? `${C.reales} REALES` : 'NO CARGO'}`,
    );
  }).join('');

  const legends = S.LEGENDS.map((L) => {
    const n = beaten[L.id] || 0;
    return card(
      { name: L.name, note: L.note, sprite: { w: L.w, l: L.l, legend: true, id: L.id } },
      n > 0, `BEATEN ${n}× · ${S.reales(L.reales)} REALES`,
    );
  }).join('');

  return { html: `
    <div class="screen">
      <div class="paper">
        ${topbar("CAPTAIN'S LOG", backTo('#/'))}
        <div class="disp" style="font-size:32px;margin-bottom:6px">What we have met</div>
        <div class="sub">Every hull that has crossed the Jackdaw's bow, and what it cost.</div>
        <div class="rule"></div>
        <div class="logcard">
          <canvas data-sprite='{"self":true}'></canvas>
          <div class="t"><b>The Jackdaw</b><p>Yours. Bow chasers that fire themselves, a mortar deck when you can find the shells, and a ram.</p></div>
        </div>
        <div class="mono" style="font-size:10px;opacity:.55;margin:22px 0 8px">SPANISH NAVY</div>
        ${classes}
        <div class="mono" style="font-size:10px;opacity:.55;margin:22px 0 8px">LEGENDARY</div>
        ${legends}
        <div style="height:60px"></div>
      </div>
    </div>`,
    mount(root) {
      $$('[data-sprite]', root).forEach((cv) => {
        try { R.sprite(cv, JSON.parse(cv.dataset.sprite)); } catch { /* a card without a hull is still a card */ }
      });
    },
  };
}

/* ================================================================= menu == */

export function menu() {
  R.scene.hidden = true; R.scene.mode = 'none';
  const s = S.session;
  const toggles = [['sound', 'Sound'], ['haptics', 'Haptics'], ['reduceMotion', 'Reduce motion']];
  return { html: `
    <div class="screen">
      <div class="paper">
        ${topbar('SHIP’S ARTICLES', backTo('#/'))}
        <div class="disp" style="font-size:32px;margin-bottom:18px">Articles</div>
        <div class="rowlist">
          ${toggles.map(([k, l]) => `<button data-t="${k}">${l} <span class="r ${s[k] ? 'gold' : ''}">${s[k] ? 'ON' : 'OFF'}</span></button>`).join('')}
          <button data-go="#/records">Record book <span class="r">WAVE ${s.records.bestWave || 0} BEST</span></button>
          <button data-go="#/log">Captain's log <span class="r">${Object.keys(s.seen).length} OF ${S.CLASS_IDS.length + S.LEGENDS.length}</span></button>
          <button data-wipe>Burn the log <span class="r">CLEARS EVERYTHING</span></button>
        </div>
        <div style="text-align:center;margin-top:40px">
          <div class="mark" style="opacity:.35">BLACK FLAG</div>
          <div class="mono" style="font-size:9.5px;opacity:.45;margin-top:9px">V1 · DRAG TO STEER · SPACE FOR THE MORTAR</div>
        </div>
      </div>
    </div>`,
    mount(root) {
      $$('[data-t]', root).forEach((b) => b.addEventListener('click', () => {
        s[b.dataset.t] = !s[b.dataset.t];
        S.save(); buzz(6);
        window.dispatchEvent(new Event('bf:prefs'));
        window.dispatchEvent(new Event('hashchange'));
      }));
      $('[data-wipe]', root)?.addEventListener('click', (e) => {
        const b = e.currentTarget;
        // Two taps, not a confirm() — a modal dialog on this stage blocks the frame loop.
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1';
          b.innerHTML = 'Burn the log <span class="r" style="color:var(--blood)">TAP AGAIN</span>';
          return;
        }
        try { localStorage.removeItem('blackflag.log'); } catch { /* private mode */ }
        location.reload();
      });
    },
  };
}

/* ================================================================ pause == */

export function pause() {
  // The scrim wants something behind it. Coming here from the articles or the log —
  // which black the canvas out — it would otherwise be a scrim over nothing.
  R.scene.hidden = false;
  R.scene.mode = R.scene.world ? 'play' : 'sea';
  return { html: `
    <div class="screen">
      <div class="scrim"></div>
      <div class="hd" style="top:300px;z-index:8">
        <div class="disp" style="font-size:36px">Hove to</div>
        <div class="mono" style="font-size:10.5px;margin-top:14px;opacity:.65">THE SEA IS STILL COMING</div>
      </div>
      <div class="dock" style="z-index:8">
        <button class="cta gold" style="margin-bottom:10px" data-go="#/play">
          <div><b>Make sail</b><span>RESUME</span></div><i>→</i></button>
        <div style="display:flex;gap:9px">
          <button class="chip" style="flex:1;justify-content:center" data-go="#/menu">Articles</button>
          <button class="chip" style="flex:1;justify-content:center" data-abandon>Scuttle her</button>
        </div>
      </div>
    </div>`,
    mount(root) {
      $('[data-abandon]', root)?.addEventListener('click', (e) => {
        const b = e.currentTarget;
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Certain?'; return; }
        buzz(20);
        window.dispatchEvent(new Event('bf:abandon'));
      });
    },
  };
}
