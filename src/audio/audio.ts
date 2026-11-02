// Everything you hear, synthesised. Zero assets: a cannon is a noise burst through a
// filter over a pitched thump. Every sound has a place. It is quieter the further off it
// is, and panned to where it is across the screen, so a volley off to your left sounds
// like one.
//
// The shanty is a D-minor arpeggio that picks up tempo as your streak climbs, so the
// music tells you how close you are.

import { session } from '../state/session';
import type { GameEvent } from '../sim/types';

let ac: AudioContext | null = null;
let master: GainNode, seaGain: GainNode, musGain: GainNode;
let noiseBuf: AudioBuffer;
let heat = 0, playing = false, timer = 0, nextNote = 0, step = 0;

/** Where the ears are: your ship. North is always up the screen, so east is to the right. */
const ear = { x: 0, y: 0 };
export function listen(x: number, y: number) { ear.x = x; ear.y = y; }

const now = () => ac!.currentTime;
const ready = () => !!ac && session.sound && ac.state === 'running';
/** Is sound actually coming out? False until the first gesture has started it. */
export const running = ready;
/** Do something as soon as sound is coming out — after a resume that is still settling. */
export function onceRunning(fn: () => void) {
  if (ready()) { fn(); return; }
  if (!ac || !session.sound) return;
  ac.resume().then(() => { if (ready()) fn(); }).catch(() => {});
}

function brownNoise(seconds = 2) {
  const n = Math.floor(ac!.sampleRate * seconds);
  const b = ac!.createBuffer(1, n, ac!.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.2;
  }
  return b;
}

/** Must be called from a gesture — browsers will not start a context otherwise. */
export function unlock() {
  if (ac) { if (session.sound && ac.state !== 'running') ac.resume().catch(() => {}); return; }
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  ac = new Ctx();
  master = ac.createGain();
  master.gain.value = session.sound ? 0.9 : 0;
  master.connect(ac.destination);
  noiseBuf = brownNoise();

  // the sea: filtered brown noise with a slow sweep, always there, never in the way
  const src = ac.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 0.6;
  seaGain = ac.createGain(); seaGain.gain.value = 0.09;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.08;
  const lg = ac.createGain(); lg.gain.value = 180;
  lfo.connect(lg).connect(lp.frequency); lfo.start();
  src.connect(lp).connect(seaGain).connect(master);
  src.start();

  musGain = ac.createGain(); musGain.gain.value = 0.11;
  musGain.connect(master);
}

export function prefs() {
  if (!ac) { if (session.sound) unlock(); return; }
  master.gain.setTargetAtTime(session.sound ? 0.9 : 0, now(), 0.05);
  if (session.sound) ac.resume().catch(() => {});
}

/** The screen went off or the page to the background: the sea goes quiet with it, rather
 *  than roaring on in a pocket. It comes back with the page (or the next tap, on iOS). */
export function hush(on: boolean) {
  if (!ac) return;
  if (on) ac.suspend().catch(() => {});
  else if (session.sound) ac.resume().catch(() => {});
}

/* ----------------------------------------------------------------- place -- */

interface At { gain: number; pan: number }
const HERE: At = { gain: 1, pan: 0 };

function place(x?: number, y?: number): At {
  if (x == null || y == null) return HERE;
  const dx = x - ear.x, dy = y - ear.y, d = Math.hypot(dx, dy);
  return { gain: 1 / (1 + d / 90), pan: d < 1 ? 0 : Math.max(-1, Math.min(1, (dx / d) * 0.85)) };
}

function out(at: At): AudioNode {
  const g = ac!.createGain();
  g.gain.value = at.gain;
  if (at.pan && "createStereoPanner" in ac!) {
    const p = ac!.createStereoPanner();
    p.pan.value = at.pan;
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

function noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass', at = HERE, delay = 0) {
  const t0 = now() + delay;
  const src = ac!.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;
  const f = ac!.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac!.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out(at));
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', at = HERE, delay = 0) {
  const t0 = now() + delay;
  const o = ac!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ac!.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out(at));
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// A muzzle is a crack over a thump. Two sources, always, or it sounds like a hi-hat.
const cannon = (at: At, d = 0) => { noise(0.2, 1300, 1.1, 0.12, 'bandpass', at, d); tone(140, 40, 0.18, 0.12, 'triangle', at, d); };
const boom = (big: boolean, at: At) => { noise(big ? 1.1 : 0.55, big ? 320 : 600, 0.7, big ? 0.3 : 0.17, 'lowpass', at); tone(big ? 85 : 125, 24, big ? 0.9 : 0.45, big ? 0.26 : 0.15, 'sine', at); };
const splash = (at: At) => noise(0.34, 2600, 0.8, 0.06, 'highpass', at);
const thud = (at: At) => noise(0.1, 900, 2.0, 0.07, 'bandpass', at);
const hurt = () => { noise(0.3, 420, 0.9, 0.18); tone(220, 60, 0.3, 0.09, 'sawtooth'); };
export const pickup = () => { if (ready()) tone(660, 990, 0.13, 0.08, 'triangle'); };
export const click = () => { if (ready()) tone(900, 700, 0.05, 0.04, 'triangle'); };

export function fanfare() {
  if (!ready()) return;
  [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f * 1.001, 0.4, 0.08, 'triangle', HERE, i * 0.11));
  noise(1.2, 900, 0.5, 0.05, 'bandpass', HERE, 0.5);
}

/* -------------------------------------------------------------- shanty --- */

// D minor, because every shanty anyone can hum is in D minor.
const ROOT = [146.83, 174.61, 220.0, 261.63, 293.66, 349.23, 440.0];
const FIGURE = [0, 2, 4, 2, 3, 2, 0, -3, 0, 2, 4, 6, 4, 2, 0, 2];

/** Your streak, 0 to 5: the shanty quickens with it. */
export function setHeat(h: number) { heat = h; }

export function startShanty() {
  if (!ac) unlock();
  if (!ac || playing) return;
  playing = true;
  nextNote = now() + 0.1;
  step = 0;
  // A lookahead scheduler, not setInterval-per-note: the main thread stutters during a
  // wave and WebAudio's clock does not.
  timer = window.setInterval(pump, 90);
}

export function stopShanty() {
  playing = false;
  clearInterval(timer);
}

function pump() {
  if (!ac || !playing) return;
  const bpm = 100 + heat * 16;
  const beat = 60 / bpm / 2;
  while (nextNote < now() + 0.32) {
    if (session.sound) note(nextNote, step);
    nextNote += beat;
    step++;
  }
}

function note(at: number, i: number) {
  const deg = FIGURE[i % FIGURE.length];
  const f = deg >= 0 ? ROOT[deg % ROOT.length] * (deg >= 7 ? 2 : 1) : ROOT[(deg + 7) % 7] / 2;
  const o = ac!.createOscillator();
  o.type = i % 4 === 0 ? 'triangle' : 'sine';
  o.frequency.value = f;
  const g = ac!.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(i % 4 === 0 ? 0.5 : 0.3, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  o.connect(g).connect(musGain);
  o.start(at); o.stop(at + 0.4);
  // a drum on the downbeat, so the tempo change is felt rather than noticed
  if (i % 8 === 0) {
    const d = ac!.createOscillator();
    d.frequency.setValueAtTime(96, at);
    d.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const dg = ac!.createGain();
    dg.gain.setValueAtTime(0.7, at);
    dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    d.connect(dg).connect(musGain);
    d.start(at); d.stop(at + 0.25);
  }
}

/** The world's events, turned into things you can hear. `mine` says which are your own
 *  ship's: being hit is felt only on your own. */
export function consume(events: GameEvent[], mine: (e: GameEvent) => boolean) {
  if (!ready()) return;
  let guns = 0;
  for (const e of events) {
    const at = place(e.x as number | undefined, e.y as number | undefined);
    switch (e.k) {
      case 'volley': if (guns++ < 3) { cannon(at); if (e.heavy) cannon(at, 0.04); } break;
      case 'thud': thud(at); break;
      case 'splash': if (at.gain > 0.35) splash(at); break;
      case 'hit': if (mine(e)) hurt(); break;
      case 'sunk': boom(true, at); break;
      case 'take': if (mine(e)) pickup(); break;
      case 'power': if (mine(e)) pickup(); break;
      case 'won': if (mine(e)) fanfare(); break;
      default: break;
    }
  }
}
