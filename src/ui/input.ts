// Hands on the ship. Three ways to sail her, one Input out:
//
//   touch     a floating stick on the left half of the screen — push the way you want
//             to go, relative to the screen; how far you push is how much canvas she
//             sets. Let go and she holds her course, easing to half sail if she was
//             carrying more. Gun buttons on the right.
//   keyboard  A/D (or ←/→) put the helm over, W/S (or ↑/↓) set and take in sail a step
//             at a time. Q/E fire port and starboard, Space the mortar.
//   mouse     left button fires to port, right button to starboard.

import type { Input } from '../sim/types';

const LEVELS = [0, 0.34, 0.67, 1];

const keys = new Set<string>();
const state = {
  level: 2,
  sail: LEVELS[2],
  stick: null as { dx: number; dy: number; m: number } | null,
  fireL: false, fireR: false, mortar: false,
  touched: false,
};

/** Is this a touch screen? A coarse main pointer says so, and so does the first finger
 *  on the glass — a tablet with a keyboard case or a touch-screen laptop reports a fine
 *  pointer, and without this would get a HUD with no stick to sail by. */
let fingers = false;
export const touchUi = () => fingers || matchMedia('(pointer: coarse)').matches;
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || fingers) return;
  const was = touchUi();
  fingers = true;
  if (!was) dispatchEvent(new Event('bf:touch'));
}, { capture: true });

export const sailLevel = () => state.sail;
export const usedTouch = () => state.touched;
/** Is a thumb on the stick? While it is, the chase camera holds its bearing: the stick is
 *  read against the screen, and a screen that turned under the thumb would have a stick
 *  held off to one side chase the ship round in circles for ever. */
export const steering = () => state.stick != null;

export function resetHelm() {
  state.level = 2; state.sail = LEVELS[2]; state.stick = null;
  state.fireL = state.fireR = state.mortar = false;
  keys.clear();
}

export function fire(side: 'L' | 'R' | 'M') {
  if (side === 'L') state.fireL = true;
  else if (side === 'R') state.fireR = true;
  else state.mortar = true;
}

/** One Input for the simulation. Edge triggers are handed over once, on the first tick
 *  of a frame, and then cleared. */
export function read(camYaw: number, first: boolean): Input {
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  const rudder = (right ? 1 : 0) - (left ? 1 : 0);
  let heading: number | null = null;
  if (state.stick && state.stick.m > 0.18) heading = camYaw + Math.atan2(state.stick.dx, -state.stick.dy);
  const out: Input = {
    heading: rudder ? null : heading, rudder, sail: state.sail,
    fireL: first && state.fireL, fireR: first && state.fireR, mortar: first && state.mortar,
  };
  if (first) state.fireL = state.fireR = state.mortar = false;
  return out;
}

export function attachKeys(onPause: () => void, onAny: () => void) {
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.repeat) { keys.add(k); return; }
    if (k === 'escape') { e.preventDefault(); onPause(); return; }
    if (k === ' ' || k === 'spacebar') { e.preventDefault(); state.mortar = true; }
    if (k === 'q') state.fireL = true;
    if (k === 'e') state.fireR = true;
    if (k === 'w' || k === 'arrowup') { state.level = Math.min(3, state.level + 1); state.sail = LEVELS[state.level]; e.preventDefault(); }
    if (k === 's' || k === 'arrowdown') { state.level = Math.max(0, state.level - 1); state.sail = LEVELS[state.level]; e.preventDefault(); }
    keys.add(k);
    onAny();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
}

/** Mouse buttons fire the broadsides, anywhere on the sea that is not a button. */
export function attachMouse(el: HTMLElement, active: () => boolean) {
  el.addEventListener('contextmenu', (e) => { if (active()) e.preventDefault(); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !active()) return;
    if ((e.target as HTMLElement).closest('button,a,.joy')) return;
    if (e.button === 0) state.fireL = true;
    else if (e.button === 2) state.fireR = true;
  });
}

/** The floating stick. Appears where the thumb lands, anywhere on the left half. */
export function attachStick(zone: HTMLElement): () => void {
  const base = zone.querySelector('.base') as HTMLElement;
  const knob = zone.querySelector('.knob') as HTMLElement;
  const R = 56;
  let id: number | null = null, ox = 0, oy = 0;

  const down = (e: PointerEvent) => {
    if (id != null) return;
    id = e.pointerId;
    state.touched = true;
    // Capture can refuse a pointer the browser has already let go of; the stick must not.
    try { zone.setPointerCapture(e.pointerId); } catch { /* keep steering without it */ }
    const b = zone.getBoundingClientRect();
    ox = e.clientX - b.left; oy = e.clientY - b.top;
    base.style.left = `${ox}px`; base.style.top = `${oy}px`;
    knob.style.left = `${ox}px`; knob.style.top = `${oy}px`;
    zone.classList.add('on', 'used');
    state.stick = { dx: 0, dy: 0, m: 0 };
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const b = zone.getBoundingClientRect();
    let dx = e.clientX - b.left - ox, dy = e.clientY - b.top - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.left = `${ox + dx}px`; knob.style.top = `${oy + dy}px`;
    const m = Math.min(1, d / R);
    state.stick = { dx, dy, m };
    // How far you push is how much canvas she carries; a nudge still keeps her moving.
    if (m > 0.18) {
      state.sail = Math.max(0.34, Math.min(1, (m - 0.18) / 0.72));
      state.level = state.sail > 0.84 ? 3 : state.sail > 0.5 ? 2 : 1;
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    state.stick = null;
    // A thumb that lets go near a prize wants her alongside, not tearing past; full sail
    // is for a thumb that is pushing for it. There is no other way to shorten sail on glass.
    if (state.level > 2) { state.level = 2; state.sail = LEVELS[2]; }
    zone.classList.remove('on');
  };
  zone.addEventListener('pointerdown', down);
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  // Torn down with a thumb still on it (paused, backgrounded): the same as letting go.
  return () => { if (state.stick && state.level > 2) { state.level = 2; state.sail = LEVELS[2]; } state.stick = null; };
}
