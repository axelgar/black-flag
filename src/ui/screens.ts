// The screens, in the order a guest meets them: the name and the ship, then the sea. Each
// returns { html, mount? }; mount may return a teardown.

import { NAME_MAX, checkName } from '../data/names';
import { LOOKS } from '../data/ships';
import type { View } from '../render/view';
import { save, session } from '../state/session';
import * as A from '../audio/audio';
import { buzz } from './haptics';
import { hudHtml, mountHud } from './hud';

export interface Screen { html: string; mount?: (root: HTMLElement) => (() => void) | void }

const $ = <E extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as E | null;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

const WHY: Record<string, string> = {
  short: 'At least 3 letters',
  long: `At most ${NAME_MAX} letters`,
  chars: 'Letters, numbers and spaces only',
  rude: 'Pick another name: this one goes up on the bar\'s TV',
};

/** The first screen: a name, a ship, and away. Works held upright too. */
export function name(v: View): Screen {
  v.setMode('show');
  const looks = LOOKS.map((l) => `<button type="button" class="look${l.id === session.look ? ' on' : ''}" data-look="${l.id}" aria-pressed="${l.id === session.look}">${esc(l.name)}</button>`).join('');
  return {
    html: `
    <div class="screen name">
      <form class="form" id="form" autocomplete="off">
        <h1 class="logo">Black <span>Flag</span></h1>
        <p class="pitch">Sink <b>5 ships in a row</b> without going down.</p>
        <label class="field">
          <span>Your captain's name</span>
          <input id="name" name="name" maxlength="${NAME_MAX}" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go" value="${esc(session.name)}" placeholder="Captain…">
        </label>
        <div class="why" id="why" aria-live="polite"></div>
        <div class="looks" role="group" aria-label="Your ship">${looks}</div>
        <button class="cta" id="go" type="submit">Set sail</button>
        <button class="chip" type="button" id="sound" aria-pressed="${session.sound}">${session.sound ? '🔊 Sound on' : '🔈 Sound off'}</button>
      </form>
    </div>`,
    mount(root) {
      const input = $<HTMLInputElement>('#name', root)!, why = $('#why', root)!, go = $<HTMLButtonElement>('#go', root)!;
      const shift = () => v.showcase(session.look, -1, innerWidth > innerHeight ? 0.2 : -0.22);
      shift();
      addEventListener('resize', shift);
      const check = (loud: boolean) => {
        const r = checkName(input.value);
        const bad = 'why' in r ? r.why : null;
        why.textContent = bad && (loud || bad !== 'short') ? WHY[bad] : '';
        go.disabled = !!bad;
        return 'name' in r ? r.name : null;
      };
      check(false);
      input.addEventListener('input', () => check(false));
      root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-look]');
        if (!b) return;
        buzz(6); A.click();
        session.look = b.dataset.look!;
        save();
        root.querySelectorAll<HTMLElement>('[data-look]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        shift();
      });
      $('#sound', root)!.addEventListener('click', (e) => {
        session.sound = !session.sound;
        save();
        A.prefs();
        const b = e.currentTarget as HTMLElement;
        b.textContent = session.sound ? '🔊 Sound on' : '🔈 Sound off';
        b.setAttribute('aria-pressed', String(session.sound));
      });
      $('#form', root)!.addEventListener('submit', (e) => {
        e.preventDefault();
        const n = check(true);
        if (!n) { input.focus(); return; }
        input.blur();
        session.name = n;
        save();
        buzz(10); A.click();
        emit('bf:sail');
      });
      if (!session.name && matchMedia('(pointer: fine)').matches) input.focus();
      return () => removeEventListener('resize', shift);
    },
  };
}

/** At sea: the HUD over the fight. */
export function sea(v: View, act: (what: string) => void): Screen {
  v.setMode('sea');
  return { html: hudHtml(false), mount: (root) => mountHud(root, act) };
}
