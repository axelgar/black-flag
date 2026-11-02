// Hands on the ship, twin-stick, the Brawl Stars way. North is up the screen, so a
// direction on the glass is a direction on the chart.
//
//   touch     the left half of the screen is a floating stick: push the way you want to
//             go, as far as you want to go fast. Let go and she holds her course and
//             canvas. The right half aims: drag to aim, let go to fire that way; drag
//             back to the middle to think better of it. A quick tap fires at the
//             nearest ship.
//   keyboard  WASD or the arrows sail her; Space fires at the nearest ship; 1 to 3 are
//             the powers.
//   buttons   one for each power, on the right (ui/hud.ts).
//   mouse     hold the left button to aim at the pointer and let go to fire; the right
//             button fires at the nearest ship.

import type { Input } from '../sim/types';

/** A drag shorter than this, in CSS pixels, is a tap. */
const TAP = 14;
const R = 56;       // the sticks' reach

const keys = new Set<string>();
const state = {
  stick: null as { x: number; y: number } | null,
  aim: null as number | null,
  fire: [] as number[],
  auto: 0,
  powers: [] as number[],
};

/** Is this a touch screen? A coarse main pointer says so, and so does the first finger on
 *  the glass: a tablet with a keyboard case reports a fine pointer. */
let fingers = false;
export const touchUi = () => fingers || matchMedia('(pointer: coarse)').matches;
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || fingers) return;
  const was = touchUi();
  fingers = true;
  if (!was) dispatchEvent(new Event('bf:touch'));
}, { capture: true });

/** The bearing being aimed along this moment, for the wedge on the water. */
export const aiming = () => state.aim;

/** Has each been used yet? For the hints. */
export const used = { move: false, aim: false, tap: false, power: false };

export function reset() {
  state.stick = null; state.aim = null; state.fire = []; state.auto = 0; state.powers = [];
  keys.clear();
}

/** Presses while she is sunk are not kept for when she is back. */
export function drop() { state.fire = []; state.auto = 0; state.powers = []; }

/** A press on power `i` (POWERS order), from its button or its key. */
export function press(i: number) { state.powers.push(i); used.power = true; }

/** The hands, for this tick. One press is handed over a call, so none is lost. */
export function read(): Input {
  let move = state.stick;
  const kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const ky = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (kx || ky) { const k = Math.hypot(kx, ky); move = { x: kx / k, y: ky / k }; }
  const fire = state.fire.length ? state.fire.shift()! : null;
  const auto = fire == null && state.auto > 0;
  if (auto) state.auto--;
  const power = state.powers.length ? state.powers.shift()! : null;
  return { move, fire, auto, power };
}

export function attachKeys(onLeave: () => void, onAny: () => void) {
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); onLeave(); return; }
    if ((k === ' ' || k === 'spacebar') && !e.repeat) { e.preventDefault(); state.auto++; }
    if (/^[1-3]$/.test(k) && !e.repeat) press(Number(k) - 1);
    if (k.startsWith('arrow')) e.preventDefault();
    keys.add(k);
    onAny();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
}

/** The mouse aims at the pointer: `bearing` turns a point on the screen into a bearing
 *  from your ship, or null when there is no ship to aim from. */
export function attachMouse(el: HTMLElement, active: () => boolean, bearing: (x: number, y: number) => number | null) {
  let held = false;
  el.addEventListener('contextmenu', (e) => { if (active()) e.preventDefault(); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !active()) return;
    if ((e.target as HTMLElement).closest('button,a,input')) return;
    if (e.button === 2) { state.auto++; return; }
    if (e.button !== 0) return;
    held = true;
    state.aim = bearing(e.clientX, e.clientY);
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !held) return;
    state.aim = bearing(e.clientX, e.clientY);
  });
  addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || !held || e.button !== 0) return;
    held = false;
    const b = bearing(e.clientX, e.clientY);
    if (b != null) state.fire.push(b);
    state.aim = null;
  });
}

/** One floating stick: it appears where the thumb lands in `zone`. */
function stick(zone: HTMLElement, on: { down?: () => void; move: (dx: number, dy: number, d: number) => void; up: (dx: number, dy: number, d: number) => void }): () => void {
  const base = zone.querySelector('.base') as HTMLElement;
  const knob = zone.querySelector('.knob') as HTMLElement;
  let id: number | null = null, ox = 0, oy = 0, dx = 0, dy = 0, d = 0;
  const down = (e: PointerEvent) => {
    if (id != null) return;
    id = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* keep going without it */ }
    const b = zone.getBoundingClientRect();
    ox = e.clientX - b.left; oy = e.clientY - b.top;
    dx = dy = d = 0;
    base.style.transform = `translate(${ox}px,${oy}px)`;
    knob.style.transform = `translate(${ox}px,${oy}px)`;
    zone.classList.add('on');
    on.down?.();
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const b = zone.getBoundingClientRect();
    dx = e.clientX - b.left - ox; dy = e.clientY - b.top - oy;
    d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    knob.style.transform = `translate(${ox + dx * k}px,${oy + dy * k}px)`;
    on.move(dx, dy, d);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    zone.classList.remove('on');
    on.up(dx, dy, d);
  };
  zone.addEventListener('pointerdown', down);
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  return () => { if (id != null) on.up(0, 0, 0); id = null; };
}

/** The two sticks of the touch HUD. Returns the teardown. */
export function attachSticks(left: HTMLElement, right: HTMLElement): () => void {
  const a = stick(left, {
    move: (dx, dy, d) => {
      const k = d > R ? 1 / d : 1 / R;
      state.stick = { x: dx * k, y: dy * k };
      if (d > TAP) used.move = true;
    },
    up: () => { state.stick = null; },
  });
  let dragged = false;
  const b = stick(right, {
    down: () => { dragged = false; },
    move: (dx, dy, d) => {
      if (d > TAP) dragged = true;
      state.aim = d > TAP ? Math.atan2(dy, dx) : null;
    },
    up: (dx, dy, d) => {
      // dragged and let go: fire that way. Never dragged: a tap, at the nearest ship.
      // Dragged and brought back to the middle: thought better of.
      if (dragged && d > TAP) { state.fire.push(Math.atan2(dy, dx)); used.aim = true; }
      else if (!dragged) { state.auto++; used.tap = true; }
      state.aim = null;
    },
  });
  return () => { a(); b(); state.stick = null; state.aim = null; };
}
