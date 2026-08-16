// Everything you hear, synthesised. Zero assets, like oddish's drone — a cannon is a
// noise burst through a lowpass over a pitched thump, and it beats anything I would
// have licensed for a browser game with no build step.
//
// The shanty is the only thing here with an opinion: a minor-key arpeggio that picks
// up tempo as notoriety climbs, so the music tells you how much trouble you are in
// before the frigates do.

import { session } from './state.js';

let ac = null, master = null, seaGain = null, musGain = null;
let noiseBuf = null;
let heat = 0, playing = false, timer = 0, nextNote = 0, step = 0;

const now = () => ac.currentTime;

function brownNoise(seconds = 2) {
  const n = Math.floor(ac.sampleRate * seconds);
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.2;
  }
  return b;
}

/** Must be called from a gesture — browsers will not start a context otherwise. */
export function unlock() {
  if (ac) { if (session.sound) ac.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
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

  musGain = ac.createGain(); musGain.gain.value = 0.13;
  musGain.connect(master);
}

export function prefs() {
  if (!ac) { if (session.sound) unlock(); return; }
  master.gain.setTargetAtTime(session.sound ? 0.9 : 0, now(), 0.05);
  if (session.sound) ac.resume();
}

/** Storm weather thickens the sea bed; port quietens it. */
export function setSea(kind) {
  if (!seaGain) return;
  const v = kind === 'storm' ? 0.17 : kind === 'port' ? 0.04 : 0.09;
  seaGain.gain.setTargetAtTime(v, now(), 0.6);
}

/* ---------------------------------------------------------------- hits --- */

function noise(dur, freq, q, gain, type = 'lowpass') {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;
  const f = ac.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  src.connect(f).connect(g).connect(master);
  src.start(); src.stop(now() + dur + 0.05);
}

function tone(f0, f1, dur, gain, type = 'sine') {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, now());
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now() + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(g).connect(master);
  o.start(); o.stop(now() + dur + 0.05);
}

// A muzzle is a crack over a thump. Two sources, always, or it sounds like a hi-hat.
export const cannon = () => { if (ready()) { noise(0.16, 1500, 1.2, 0.10, 'bandpass'); tone(150, 44, 0.14, 0.10, 'triangle'); } };
export const foeGun = () => { if (ready()) { noise(0.2, 800, 1.0, 0.07, 'bandpass'); tone(110, 38, 0.18, 0.07, 'triangle'); } };
export const boom = (big) => { if (ready()) { noise(big ? 0.9 : 0.5, big ? 340 : 620, 0.7, big ? 0.28 : 0.16); tone(big ? 90 : 130, 26, big ? 0.7 : 0.4, big ? 0.24 : 0.14, 'sine'); } };
export const splash = () => { if (ready()) noise(0.34, 2600, 0.8, 0.07, 'highpass'); };
export const thud = () => { if (ready()) noise(0.09, 900, 2.0, 0.05, 'bandpass'); };
export const hurt = () => { if (ready()) { noise(0.3, 420, 0.9, 0.16); tone(220, 60, 0.3, 0.09, 'sawtooth'); } };
export const pickup = () => { if (ready()) { tone(660, 990, 0.13, 0.08, 'triangle'); } };

/** A ship striking her colours needs a sound you can hear over a fight, because it is
 *  the only cue that a target just turned into a prize. */
export function strike() {
  if (!ready()) return;
  tone(880, 1320, 0.1, 0.07, 'square');
  setTimeout(() => ready() && tone(1320, 1760, 0.12, 0.05, 'square'), 90);
}

export function board() {
  if (!ready()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    setTimeout(() => { if (ready()) tone(f, f, 0.18, 0.09, 'triangle'); }, i * 62);
  });
  noise(0.5, 1800, 0.7, 0.09, 'bandpass');
}

export function thunder() {
  if (!ready()) return;
  noise(1.6, 220, 0.5, 0.22);
  tone(60, 24, 1.4, 0.14, 'sine');
}

const ready = () => ac && session.sound && ac.state === 'running';

/* -------------------------------------------------------------- shanty --- */

// D minor, because every shanty anyone can hum is in D minor.
const ROOT = [146.83, 174.61, 220.00, 261.63, 293.66, 349.23, 440.00];
const FIGURE = [0, 2, 4, 2, 3, 2, 0, -3, 0, 2, 4, 6, 4, 2, 0, 2];

export function setHeat(h) { heat = h; }

export function startShanty() {
  if (!ac) unlock();
  if (!ac || playing) return;
  playing = true;
  nextNote = now() + 0.1;
  step = 0;
  // A lookahead scheduler, not setInterval-per-note: the main thread stutters during a
  // wave and WebAudio's clock does not.
  timer = setInterval(pump, 90);
}

export function stopShanty() {
  playing = false;
  clearInterval(timer);
}

function pump() {
  if (!ac || !playing) return;
  const bpm = 104 + heat * 17;
  const beat = 60 / bpm / 2;
  while (nextNote < now() + 0.32) {
    if (session.sound) note(nextNote, step);
    nextNote += beat;
    step++;
  }
}

function note(at, i) {
  const deg = FIGURE[i % FIGURE.length];
  const f = deg >= 0 ? ROOT[deg % ROOT.length] * (deg >= 7 ? 2 : 1) : ROOT[(deg + 7) % 7] / 2;
  const o = ac.createOscillator();
  o.type = i % 4 === 0 ? 'triangle' : 'sine';
  o.frequency.value = f;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(i % 4 === 0 ? 0.5 : 0.3, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  o.connect(g).connect(musGain);
  o.start(at); o.stop(at + 0.4);

  // a drum on the downbeat, so the tempo change is felt rather than noticed
  if (i % 8 === 0) {
    const d = ac.createOscillator();
    d.type = 'sine';
    d.frequency.setValueAtTime(96, at);
    d.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const dg = ac.createGain();
    dg.gain.setValueAtTime(0.7, at);
    dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    d.connect(dg).connect(musGain);
    d.start(at); d.stop(at + 0.25);
  }
}

/** The world's events, turned into things you can hear. Mirrors render.consume(). */
export function consume(events) {
  for (const e of events) {
    switch (e.k) {
      case 'cannon': cannon(); break;
      case 'foe-fire': foeGun(); break;
      case 'thud': thud(); break;
      case 'strike': strike(); break;
      case 'board': board(); break;
      case 'boom': boom(e.big); if (e.splash) splash(); break;
      case 'hit': hurt(); break;
      case 'mortar': foeGun(); break;
      case 'take': pickup(); break;
      case 'refit': boom(true); break;
      case 'legend-down': boom(true); board(); break;
      default: break;
    }
  }
}
