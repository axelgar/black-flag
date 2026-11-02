// The free shot, from the win to the glass: saving it with an email and the code Supabase
// sends (#/prize), signing in on another phone to bring one over (#/prize/signin),
// pouring it in front of the bartender (#/redeem/<id>), and what the game keeps about
// whom (#/privacy). Also the line on the name screen that says how a guest stands:
// ticket or practice, and any free shot waiting.

import { me, pour, savePrizes, sendCode, verifyCode, type Prize, type Route } from '../net/cloud';
import * as A from '../audio/audio';
import { session } from '../state/session';
import { buzz } from './haptics';
import type { Screen } from './screens';

const $ = <E extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as E | null;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

export const OPERATOR = 'Glitch Bars';
export const CONTACT = 'info@glitchbars.com';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const clock = (d: Date, seconds = false) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

/** Won, not yet saved with an email. */
const unsaved = () => me?.prizes.find((p) => !p.saved && !p.redeemed_at) ?? null;
/** Saved and waiting to be poured. */
const waiting = () => me?.prizes.find((p) => p.saved && !p.redeemed_at) ?? null;

/** Said once on the name screen, after a tap on the tag. */
let notice = '';
export function tell(what: string) { notice = what; window.dispatchEvent(new Event('bf:me')); }

/** How this guest stands, for the name screen: redrawn on `bf:me`. */
export function standing(): string {
  if (!me) return '';
  const said = notice ? `<div class="notice">${esc(notice)}</div>` : '';
  notice = '';
  const won = unsaved(), ready = waiting();
  const shot = won
    ? `<a class="shot" href="#/prize">🥃 You won a free shot! <b>Save it</b></a>`
    : ready ? `<a class="shot" href="#/redeem/${ready.id}">🥃 Free shot · until ${day(ready.valid_until)} <b>Pour it</b></a>` : '';
  const ticket = me.ticket
    ? `<div class="ticket">🎟 <b>Ticket!</b> Sink 5 in a row for a free shot</div>`
    : `<div class="ticket off">Practice · order a <b>Black Flag</b> to play for a free shot</div>`;
  return `${said}${shot}${ticket}`;
}

/** The small print under the name screen. */
export const footer = () => `<div class="fine"><a href="#/prize/signin">Saved a free shot? Sign in</a><a href="#/privacy">Privacy</a></div>`;

/* ----------------------------------------------------------------- saving -- */

const SAY: Record<string, string> = {
  email_address_invalid: 'That email doesn\'t look right',
  validation_failed: 'That email doesn\'t look right',
  otp_expired: 'That code is wrong or has run out. Try again, or send a new one',
  otp_disabled: 'There\'s no free shot saved with that email',
  over_email_send_rate_limit: 'Too many emails just now. Try again in a minute',
  over_request_rate_limit: 'Too many tries just now. Try again in a minute',
  offline: 'Can\'t reach the server. Check the wifi and try again',
};
const why = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return SAY[e?.code ?? ''] ?? SAY[e?.message ?? ''] ?? 'Something went wrong. Try again';
};

/** Save a free shot with an email, or (`signin`) sign in with one to bring a saved one
 *  to this phone. Email, then the code, then done. */
export function prize(signin: boolean): Screen {
  const known = !signin && me?.email ? me.email : '';
  return {
    html: `
    <div class="screen sheet-wrap">
      <form class="sheet" id="sheet" autocomplete="on" novalidate>
        <h2 class="big">${signin ? 'Sign in' : '🥃 Save your free shot'}</h2>
        <div class="step" data-step="email">
          <p>${signin ? 'Saved a free shot on another phone? Type the email you saved it with, and we\'ll send you a code.'
            : known ? `It goes with <b>${esc(known)}</b>, the email you saved one with before.`
              : 'Type your email and we\'ll send you a code. Your free shot is saved to it, and you can pour it on any phone signed in with it.'}</p>
          ${known ? '' : `<label class="field"><span>Email</span>
            <input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="send" placeholder="you@example.com"></label>`}
          ${signin ? '' : `<label class="tick"><input type="checkbox" id="news"${me?.marketing ? ' checked' : ''}> Send me news and offers from ${OPERATOR}</label>`}
          <button class="cta" type="submit" id="send">${known ? 'Save it' : 'Send me a code'}</button>
        </div>
        <div class="step" data-step="code" hidden>
          <p>We sent a code to <b id="to"></b>. It may take a minute, and it may be in spam.</p>
          <label class="field"><span>Code</span>
            <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" enterkeyhint="done" placeholder="123456"></label>
          <button class="cta" type="submit" id="check" disabled>${signin ? 'Sign in' : 'Save it'}</button>
          <div class="row"><button class="chip" type="button" id="again" disabled>Send it again</button><button class="chip" type="button" id="other">Another email</button></div>
        </div>
        <div class="step" data-step="done" hidden>
          <p id="done"></p>
          <a class="cta" href="#/">Done</a>
        </div>
        <div class="why" id="why" aria-live="polite"></div>
        <p class="small">${signin ? '' : `Only for guests 18 and over. `}<a href="#/privacy">What we keep, and why</a> · <a href="#/">Not now</a></p>
      </form>
    </div>`,
    mount(root) {
      const form = $<HTMLFormElement>('#sheet', root)!, say = $('#why', root)!;
      const email = $<HTMLInputElement>('#email', root), code = $<HTMLInputElement>('#code', root)!;
      const news = $<HTMLInputElement>('#news', root);
      let step: 'email' | 'code' | 'done' = 'email', route: Route = 'change', to = known, busy = false, resend = 0;
      const show = (s: typeof step) => {
        step = s;
        root.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => { el.hidden = el.dataset.step !== s; });
        say.textContent = '';
        if (s === 'code') { $('#to', root)!.textContent = to; code.value = ''; code.focus(); }
      };
      const timer = setInterval(() => {
        const left = Math.ceil((resend - Date.now()) / 1000);
        const b = $<HTMLButtonElement>('#again', root)!;
        b.disabled = left > 0 || busy;
        b.textContent = left > 0 ? `Send it again (${left})` : 'Send it again';
      }, 500);
      const finish = async () => {
        if (signin) {
          const w = waiting() ?? unsaved();
          $('#done', root)!.innerHTML = w ? `Signed in. Your free shot is here${w.saved ? `, until ${day(w.valid_until)}` : ''}.` : 'Signed in. There\'s no free shot waiting on this email right now.';
        } else {
          const r = await savePrizes(!!news?.checked);
          const w = waiting();
          $('#done', root)!.innerHTML = r.saved
            ? `Saved! Show it at the bar any night until <b>${w ? day(w.valid_until) : 'within 30 days'}</b>: it's on the first screen, under your name.`
            : r.taken ? 'This email already has a free shot from tonight. It\'s one a night for each email.' : 'There\'s no free shot to save right now.';
        }
        buzz(30); A.click();
        show('done');
      };
      const send = async () => {
        to = known || (email?.value ?? '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { say.textContent = SAY.email_address_invalid; email?.focus(); return; }
        route = known ? 'known' : await sendCode(to, signin);
        if (route === 'known') return finish();
        resend = Date.now() + 60_000;
        show('code');
      };
      const check = async () => {
        const c = code.value.replace(/\D/g, '');
        if (c.length < 6) return;
        await verifyCode(to, c, route);
        await finish();
      };
      const run = async (job: () => Promise<void>) => {
        if (busy) return;
        busy = true; say.textContent = '';
        form.classList.add('busy');
        try { await job(); } catch (err) { console.warn('[prize]', err); say.textContent = why(err); } finally { busy = false; form.classList.remove('busy'); }
      };
      code.addEventListener('input', () => {
        code.value = code.value.replace(/\D/g, '');
        $<HTMLButtonElement>('#check', root)!.disabled = code.value.length < 6;
        if (code.value.length === 6) void run(check);
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); void run(step === 'email' ? send : check); });
      $('#again', root)!.addEventListener('click', () => void run(send));
      $('#other', root)!.addEventListener('click', () => { show('email'); email?.focus(); });
      if (!signin && me && !unsaved()) {
        $('#done', root)!.textContent = waiting() ? 'Your free shot is already saved: it\'s on the first screen.' : 'There\'s no free shot to save right now.';
        show('done');
      } else if (email && matchMedia('(pointer: fine)').matches) email.focus();
      return () => clearInterval(timer);
    },
  };
}

/* ----------------------------------------------------------------- pouring -- */

/** In front of the bartender: press, and the screen says so with a clock that runs, so a
 *  screenshot gives itself away. */
export function redeem(id: number): Screen {
  const p: Prize | undefined = me?.prizes.find((x) => x.id === id);
  const done = (at: Date) => `
    <div class="poured">
      <div class="burst"></div>
      <div class="glass">🥃</div>
      <div class="big">Redeemed · ${clock(at)}</div>
      <div class="who">${esc(session.name || me?.captain || '')}</div>
      <div class="now" id="now">${clock(new Date(), true)}</div>
      <div class="what">One free shot · Black Flag · 18+</div>
      <a class="chip" href="#/">Done</a>
    </div>`;
  if (p?.redeemed_at) return { html: `<div class="screen pour">${done(new Date(p.redeemed_at))}</div>`, mount: tick };
  return {
    html: `
    <div class="screen pour">
      <div class="sheet" id="ask">
        ${p ? `
        <h2 class="big">🥃 Free shot</h2>
        <p>Valid until <b>${day(p.valid_until)}</b>. Only for guests 18 and over.</p>
        <p class="warn">Only press this in front of the bartender. It can't be undone.</p>
        <button class="cta" type="button" id="pour">Redeem now</button>
        <div class="why" id="why" aria-live="polite"></div>
        <p class="small"><a href="#/">Not now</a></p>`
        : `<h2 class="big">No free shot here</h2><p>${me ? 'This free shot isn\'t on this phone, or it has been poured already.' : 'Still signing in…'}</p><a class="cta" href="#/">Back</a>`}
      </div>
    </div>`,
    mount(root) {
      const b = $<HTMLButtonElement>('#pour', root);
      b?.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const at = await pour(id);
          buzz(80); A.click();
          // root is the screen itself (main.ts mounts on it)
          root.innerHTML = done(at);
          tick(root);
        } catch (err) {
          console.warn('[pour]', err);
          $('#why', root)!.textContent = (err as Error)?.message === 'offline' ? SAY.offline : 'It can\'t be poured: it may have been already, or run out.';
          b.disabled = false;
        }
      });
      return () => stop?.();
    },
  };
}

let stop: (() => void) | null = null;
function tick(root: HTMLElement) {
  stop?.();
  const t = setInterval(() => { const el = $('#now', root); if (el) el.textContent = clock(new Date(), true); }, 250);
  stop = () => { clearInterval(t); stop = null; };
  return stop;
}

/* ----------------------------------------------------------------- privacy -- */

/** What the game keeps, in plain words. A draft for the owner to check before the switch-over. */
export function privacy(): Screen {
  return {
    html: `
    <div class="screen sheet-wrap">
      <article class="sheet prose">
        <h2 class="big">Privacy</h2>
        <p><b>Who runs this game.</b> ${OPERATOR}. Questions, or to have your data deleted: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
        <p><b>What we keep.</b></p>
        <ul>
          <li>An anonymous account for this phone, made when you open the game. It holds no name or email of yours until you give one.</li>
          <li>The captain's name you type. Other players see it on the sea, and it shows on the bar's TV.</li>
          <li>Your tickets, wins and free shots, and when each happened.</li>
          <li>Your email, if you save a free shot with it, and whether you asked for our news.</li>
          <li>A few moments of the game, to count how the nights go: getting a ticket, sailing, your first sink, a win, saving and pouring a free shot.</li>
        </ul>
        <p><b>Why.</b> To run the game and give you the free shot you won. We send you news only if you tick the box, and you can ask us to stop at any time.</p>
        <p><b>No cookies, no ads, no trackers.</b> Your phone remembers your sign-in, your name and your settings in its own storage, and nothing else.</p>
        <p><b>Who helps us.</b> Supabase keeps our database, in the EU (Ireland), and sends the code emails. Cloudflare runs the sea. Vercel serves this page.</p>
        <p><b>How long.</b> For as long as the game runs at the bar, or until you ask us to delete it. A free shot runs out 30 days after it is won.</p>
        <p><b>Your rights.</b> You can ask to see, correct or delete your data, or object to how we use it, by writing to <a href="mailto:${CONTACT}">${CONTACT}</a>. You can also complain to the Spanish data protection authority (AEPD, aepd.es).</p>
        <a class="cta" href="#/">Back</a>
      </article>
    </div>`,
  };
}
