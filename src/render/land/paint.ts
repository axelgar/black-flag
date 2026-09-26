// The land's textures, painted once at start-up like the ships':
//
//   ground    four tileable greys: R sand (speckle and wind ripples), G grass (clumps and
//             blades), B rock (fractured, with strata), A dirt (pebbles). The terrain
//             shader blends them by what each patch of ground is made of.
//   masonry   for Nassau: R lime plaster, G terracotta barrel tiles, B ashlar stone,
//             A palm thatch.
//   foliage   a canvas atlas: on the left a palm frond cut into leaflets, on the right a
//             mat of leaves for the jungle's crowns and the bushes.

import * as THREE from 'three';
import { rng } from '../../core/rng';
import { coarse, finish, lattice } from '../ships/paint';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v: number) => Math.round(clamp01(v) * 255);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* --------------------------------------------------------------- ground --- */

export function groundTexture(N: number, anisotropy: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const k = N / 512;
  const c2 = Math.max(1, Math.round(2 * k)), c4 = Math.max(2, Math.round(4 * k));
  const a = lattice(71, 8), b = lattice(72, 24), c = lattice(73, 64), d = lattice(74, 150);
  const blades = lattice(75, 180, 40), cracks = lattice(76, 18), cracks2 = lattice(77, 40);
  const LO = coarse(N, c4, (u, v) => a(u, v) * 0.6 + b(u, v) * 0.4);
  const MID = coarse(N, c2, (u, v) => b(u, v) * 0.5 + c(u, v) * 0.5);
  const BLADE = coarse(N, c2, blades);
  const CRACK = coarse(N, c2, (u, v) => Math.abs(cracks(u, v) - 0.5) * 0.6 + Math.abs(cracks2(u, v) - 0.5) * 0.4);
  const r = rng(78);
  const pebbles = Array.from({ length: Math.round(260 * k * k) }, () => ({ x: r() * N, y: r() * N, r: (1.5 + r() * 3.5) * k, v: r() < 0.5 ? 0.55 : 1.12 }));
  const grid = new Map<number, typeof pebbles>();
  const cell = 16 * k;
  for (const p of pebbles) {
    const key = Math.floor(p.x / cell) * 1000 + Math.floor(p.y / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(p);
  }
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const o = (y * N + x) * 4;
      const lo = LO(x, y), mid = MID(x, y), fine = d(u, v);
      // sand: fine grains and a few wind ripples
      const ripple = Math.sin((v * 22 + lo * 1.6 + mid * 0.5) * Math.PI * 2) * 0.5 + 0.5;
      data[o] = byte(0.84 + 0.1 * (fine - 0.5) * 2 * 0.6 + 0.06 * ripple * smooth(0.35, 0.7, lo) + 0.05 * (mid - 0.5));
      // grass: clumps of light and dark, and blades
      const blade = BLADE(x, y);
      data[o + 1] = byte(0.66 + 0.26 * lo + 0.14 * (blade - 0.5) + 0.08 * (fine - 0.5));
      // rock: fractured and weathered, banded like the strata it is cut from
      const crack = CRACK(x, y);
      const strata = Math.sin((v * 9 + lo * 0.8) * Math.PI * 2) * 0.5 + 0.5;
      let rock = 0.7 + 0.22 * mid + 0.08 * strata + 0.06 * (fine - 0.5);
      if (crack < 0.035) rock *= 0.55 + crack * 8;
      data[o + 2] = byte(rock);
      // dirt, trodden and stony
      let dirt = 0.78 + 0.16 * lo + 0.07 * (fine - 0.5);
      const cellHits = grid.get(Math.floor(x / cell) * 1000 + Math.floor(y / cell));
      if (cellHits) for (const p of cellHits) { const dd = Math.hypot(x - p.x, y - p.y); if (dd < p.r) dirt *= dd < p.r * 0.7 ? p.v : (p.v + 1) / 2; }
      data[o + 3] = byte(dirt);
    }
  }
  return finish(data, N, anisotropy);
}

/* -------------------------------------------------------------- masonry --- */

export function masonryTexture(N: number, anisotropy: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const k = N / 512;
  const c2 = Math.max(1, Math.round(2 * k)), c4 = Math.max(2, Math.round(4 * k));
  const a = lattice(81, 6), b = lattice(82, 20), c = lattice(83, 60), d = lattice(84, 160);
  const streak = lattice(85, 90, 8), crack = lattice(86, 14);
  const LO = coarse(N, c4, (u, v) => a(u, v) * 0.6 + b(u, v) * 0.4);
  const MID = coarse(N, c2, (u, v) => c(u, v));
  const STREAK = coarse(N, c2, streak);
  const CRACK = coarse(N, c2, crack);
  const r = rng(87);
  // roof tiles: 16 courses, 20 tiles a course; stone: 10 courses of blocks
  const TROWS = 16, TCOLS = 20;
  const tileTone = Array.from({ length: TROWS * TCOLS }, () => 0.82 + r() * 0.24 - (r() < 0.05 ? 0.25 : 0));
  const SROWS = 10;
  const joints = Array.from({ length: SROWS }, () => { const j: number[] = [0]; let x = 0; while (x < 1) { x += 0.12 + r() * 0.16; if (x < 0.97) j.push(x); } return j; });
  const stoneTone = Array.from({ length: SROWS * 12 }, () => 0.8 + r() * 0.22);
  const TH_ROWS = 7;
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const o = (y * N + x) * 4;
      const lo = LO(x, y), mid = MID(x, y), fine = d(u, v);
      // lime plaster: mottled, stained, with hairline cracks
      let plaster = 0.9 + 0.08 * (lo - 0.5) * 2 * 0.6 + 0.04 * (fine - 0.5);
      if (Math.abs(CRACK(x, y) - 0.5) < 0.006 && lo > 0.55) plaster *= 0.72;
      data[o] = byte(plaster);
      // terracotta barrel tiles: rolls and pans, each course lapping the one below
      {
        const fr = v * TROWS, row = Math.floor(fr), fy = fr - row;
        const fc = u * TCOLS + (row % 2) * 0.5, col = Math.floor(fc), fx = fc - col;
        const roll = col % 2 === 0;
        const shape = roll ? 0.72 + 0.34 * Math.pow(Math.sin(Math.PI * fx), 0.5) : 0.6 + 0.18 * Math.pow(Math.sin(Math.PI * fx), 2);
        const lap = fy > 0.86 ? 0.55 : fy > 0.8 ? 0.8 : 1;
        data[o + 1] = byte(shape * lap * tileTone[(row % TROWS) * TCOLS + (col % TCOLS)] * (0.9 + 0.12 * lo) + 0.03 * (fine - 0.5));
      }
      // ashlar: coursed blocks in running bond, pointed with mortar
      {
        const fr = v * SROWS, row = Math.floor(fr), fy = fr - row;
        const js = joints[row % SROWS];
        const uu = (u + (row % 2) * 0.37) % 1;
        let j = 0; while (j + 1 < js.length && js[j + 1] <= uu) j++;
        const left = js[j], right = j + 1 < js.length ? js[j + 1] : 1;
        const ex = Math.min(uu - left, right - uu) * N, ey = Math.min(fy, 1 - fy) * (N / SROWS);
        let stone = stoneTone[(row % SROWS) * 12 + (j % 12)] * (0.9 + 0.1 * mid) + 0.05 * (fine - 0.5);
        if (ex < 1.6 * k || ey < 1.6 * k) stone = 0.5 + 0.08 * fine;
        else if (ex < 3.5 * k || ey < 3.5 * k) stone *= 0.88;
        data[o + 2] = byte(stone);
      }
      // palm thatch: long fibres in overlapping bundles
      {
        const fr = v * TH_ROWS, fy = fr - Math.floor(fr);
        const fibre = STREAK(x, y);
        data[o + 3] = byte((0.62 + 0.4 * fibre) * (0.7 + 0.3 * fy) * (0.9 + 0.1 * lo));
      }
    }
  }
  return finish(data, N, anisotropy);
}

/* -------------------------------------------------------------- foliage --- */

export function foliageTexture(N: number, anisotropy: number): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!;
  const r = rng(91);
  const W = N / 2, H = N;
  c.clearRect(0, 0, N, N);
  // a clean white corner, for bark, nuts and anything else that wants only its own colour
  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, Math.ceil(N * 0.03), Math.ceil(N * 0.03));
  // A palm frond, base at the top of the canvas and tip at the bottom: a rib, and leaflets
  // either side of it swept toward the tip, longest a third of the way out.
  const greens = ['#3B7A2A', '#43862F', '#357026', '#4C8F34', '#2F6522'];
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    const y = 6 + t * (H - 14);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.04)), 0.55);
    const len = env * (W / 2) * 0.96;
    for (const s of [1, -1]) {
      const ang = 0.62 + (r() - 0.5) * 0.12;
      const ex = W / 2 + s * Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      const w0 = (H / 150) * (0.6 + env * 0.6);
      c.fillStyle = r() < 0.06 ? '#8C7A3A' : greens[Math.floor(r() * greens.length)];
      c.beginPath();
      c.moveTo(W / 2, y - w0);
      c.quadraticCurveTo((W / 2 + ex) / 2 + s * w0, (y + ey) / 2 - w0 * 1.5, ex, ey);
      c.quadraticCurveTo((W / 2 + ex) / 2, (y + ey) / 2 + w0, W / 2, y + w0);
      c.fill();
    }
  }
  c.strokeStyle = '#8E9448'; c.lineCap = 'round';
  for (let i = 0; i < 20; i++) {
    const t0 = i / 20, t1 = (i + 1) / 20;
    c.lineWidth = (H / 55) * (1 - t0 * 0.85);
    c.beginPath(); c.moveTo(W / 2, t0 * H); c.lineTo(W / 2, t1 * H); c.stroke();
  }
  // The canopy: a mat of overlapping leaves, lit from above.
  c.fillStyle = '#2D5A20';
  c.fillRect(W, 0, W, H);
  for (let i = 0; i < 2600 * (N / 1024) ** 2; i++) {
    const x = W + r() * W, y = r() * H, s = (N / 1024) * (6 + r() * 12);
    const tone = r();
    c.fillStyle = tone < 0.15 ? '#1E4216' : tone < 0.55 ? '#356B26' : tone < 0.85 ? '#45802F' : '#5E9A3A';
    c.save(); c.translate(x, y); c.rotate(r() * Math.PI);
    c.beginPath(); c.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Where each part of the foliage atlas is, as [u0, v0, u1, v1]. */
export const FOLIAGE = { frond: [0.02, 0.0, 0.48, 1.0], leaves: [0.52, 0.02, 0.98, 0.98] } as const;
