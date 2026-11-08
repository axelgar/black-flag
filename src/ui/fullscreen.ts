// The whole screen for the sea.
//
// Android (and an iPad) let a page ask for it: it is asked from the tap that sets sail,
// and asked again by the next tap at sea if it was lost (the phone slept, a swipe from
// the edge put the bars back).
//
// An iPhone lets no page have it. What Safari does do, sideways, is fold its bars away when
// the page is scrolled. So on an iPhone the page is made a little taller than the screen,
// and a ship just come into the sea with the bars up gets a card: swipe up for the whole
// screen. The swipe scrolls the page, Safari folds its bars, and the card goes. It only
// comes up as a life begins, never in the middle of one; Not now puts it away until she
// next sets sail. Added to the Home Screen, an iPhone has the whole screen already.

import * as Input from './input';

type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Ask for the whole screen, sideways. Only from a tap: a browser refuses it otherwise. */
export function takeScreen() {
  if (!Input.touchUi() || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as Lockable).lock?.('landscape'))
    .catch(() => { /* refused, or no lock on this browser: the page still plays */ });
}

export function leaveScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** At sea, a finger lifting takes the screen back if it was lost. Not off a button: Leave
 *  gives the screen up, and asking for it on the same tap would keep it. */
export function keepScreen(atSea: () => boolean) {
  addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !atSea() || (e.target as Element | null)?.closest?.('button')) return;
    takeScreen();
  }, { capture: true });
}

/* ------------------------------------------------------ an iPhone's swipe -- */

const home = () => (navigator as Navigator & { standalone?: boolean }).standalone === true
  || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
/** Bars that only a scroll folds: an iPhone, in its browser rather than on the Home Screen. */
const folds = !document.fullscreenEnabled && /iPhone|iPod/.test(navigator.userAgent) && !home();
/** `?swipe` on the address puts the card up on any screen, to look at it. */
const forced = new URLSearchParams(location.search).has('swipe');
/** Seconds into a life, sideways, that the card may still come up. */
const OPENING = 3;

/** The browser's bars are up: the page is shorter than the screen by more than a sliver. */
const barsUp = () => innerHeight < Math.min(screen.width, screen.height) - 24;

const INK = '#10233F';
const HAND = `
<svg viewBox="0 0 64 100" aria-hidden="true">
  <g class="chev" fill="none" stroke="#FFD43B" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 22 L32 10 L44 22" opacity=".55"/><path d="M20 34 L32 22 L44 34"/>
  </g>
  <g class="hand" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M27 77 V38 C27 32.5 35 32.5 35 38 V61 C35 57 42 57 42 62.5 C42 59 49 59 49 64.5 C49 61 56 61 56 67 V84 C56 93 50 98 42 98 H37 C30 98 26 95 23 90 L13.5 77 C10.5 72.5 15.5 68 19.5 71.5 Z" fill="#FFFFFF"/>
    <path d="M42 63 V70 M49 65 V71" fill="none" stroke-width="2.4"/>
    <path d="M30 40 V58" fill="none" stroke="#D6E6F5" stroke-width="2.6"/>
  </g>
</svg>`;

let card: HTMLElement | null = null;
let shown = false, declined = false, life = 0;

function make(): HTMLElement {
  if (folds) document.documentElement.classList.add('folds');
  const el = document.createElement('div');
  el.className = 'swipe';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Full screen');
  el.innerHTML = `<div class="pane">${HAND}<div class="words"><div class="big">Swipe up</div><div class="sub">for the whole screen</div><button class="later" type="button">Not now</button></div></div>`;
  el.querySelector('button')!.addEventListener('click', () => { declined = true; show(false); });
  document.body.appendChild(el);
  return el;
}

function show(on: boolean) {
  if (on === shown || !card) return;
  shown = on;
  card.hidden = !on;
  // room to swipe: from the top, however far an earlier swipe left the page
  if (on && folds) scrollTo(0, 0);
}

/** Each frame: whether the card is up. `sailing`: her ship is on the water, not sunk. */
export function swipeTick(dt: number, atSea: boolean, sideways: boolean, sailing: boolean) {
  if (!folds && !forced) return;
  card ??= make();
  if (!atSea) { declined = false; life = 0; show(false); return; }
  if (!sailing) life = 0;
  else if (sideways) life += dt;
  show(sideways && sailing && !declined && (forced || barsUp()) && (shown || life < OPENING));
}
