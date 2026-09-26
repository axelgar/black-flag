// Timber and canvas, painted once at start-up, pixel by pixel. Two textures serve every
// ship afloat:
//
//   timber  four tileable greys in one: R hull planking, G deck planking, B the grain of
//           a spar, A panes of glass. A ship's colours are her palette; this is only the
//           light and dark in the wood, and the seams the light catches.
//   canvas  a 2×2 atlas of sails: R the cloth (seams, reef bands, patches, dirt), G a
//           painted emblem, B stains, and A how easily it tears. The sail shader cuts a
//           hole wherever A is under the ship's tatter, so shot canvas rags from the foot
//           up and opens where the cloth was weakest.
//
// Both are DataTextures rather than canvases: a canvas stores premultiplied alpha, and
// the tear channel has to survive being next to a colour.

import * as THREE from 'three';
import { rng } from '../../core/rng';
import type { Emblem } from '../../data/types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const byte = (v: number) => Math.round(clamp01(v) * 255);

/** Tileable value noise: `px` × `py` lattice cells across the texture, wrapping at the edges. */
function lattice(seed: number, px: number, py = px) {
  const r = rng(seed);
  const v = new Float32Array(px * py);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (u: number, w: number) => {            // u, w across the texture, 0..1
    const x = u * px, y = w * py;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1, y1 = y0 + 1 === py ? 0 : y0 + 1;
    const a = v[y0 * px + x0], b = v[y0 * px + x1], c = v[y1 * px + x0], d = v[y1 * px + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** A smooth field sampled on a coarse grid and read back bilinearly per pixel: noise this
 *  soft looks the same either way, at a sixteenth of the cost. */
function coarse(H: number, step: number, fn: (s: number, t: number) => number) {
  const n = Math.ceil(H / step) + 2;
  const g = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = fn((i * step + 0.5) / H, (j * step + 0.5) / H);
  return (x: number, y: number) => {
    const fx = x / step, fy = y / step;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, v = fy - j, o = j * n + i;
    const a = g[o], b = g[o + 1], c = g[o + n], d = g[o + n + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Distance between two points on a loop of length 1. */
const loop = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

function finish(data: Uint8Array, N: number, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/* --------------------------------------------------------------- timber --- */

export function timber(N: number, anisotropy: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const r = rng(1715);
  const k = N / 1024;                                   // pixel sizes below are for a 1024 map
  const streak = lattice(3, 5, 150), streak2 = lattice(4, 10, 300);
  const cloud = lattice(5, 7), cloud2 = lattice(6, 22);
  const GRAIN = coarse(N, Math.max(1, Math.round(N / 512)), (u, w) => streak(u, w) * 0.65 + streak2(u, w) * 0.35);
  const CLOUD = coarse(N, Math.max(2, Math.round(N / 128)), (u, w) => cloud(u, w) * 0.6 + cloud2(u, w) * 0.4);
  // Hull: sixteen strakes to a tile, each butted twice — four-metre planks.
  const HS = 16;
  const hullButt = Array.from({ length: HS }, () => r());
  const hullTone = Array.from({ length: HS * 2 }, () => 0.8 + r() * 0.2);
  // Deck: twenty-four planks, butted three times and staggered so no two butts line up.
  const DS = 24;
  const deckButt = Array.from({ length: DS }, (_, i) => ((i * 3) % 8) / 8 + r() * 0.04);
  const deckTone = Array.from({ length: DS * 3 }, () => 0.78 + r() * 0.22);
  // Glass: sixteen panes a side, each a slightly different green of old crown glass.
  const PANES = 16;
  const paneTone = Array.from({ length: PANES * PANES }, () => 0.7 + r() * 0.3);

  for (let y = 0; y < N; y++) {
    const w = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const o = (y * N + x) * 4;
      const grain = GRAIN(x, y);
      const cl = CLOUD(x, y);

      // R: hull planking — strakes, butts, trenails, tar in the seams.
      {
        const f = w * HS, s = Math.floor(f), fy = f - s;
        const b0 = hullButt[s];
        const seg = ((u - b0 + 1) % 1) < 0.5 ? 0 : 1;
        const butt = Math.min(loop(u, b0), loop(u, b0 + 0.5)) * N;
        let v = hullTone[s * 2 + seg] * (0.86 + 0.18 * grain) * (0.9 + 0.14 * cl);
        v *= 0.88 + 0.12 * Math.pow(Math.sin(Math.PI * fy), 0.35);   // edges rounded off
        const seam = Math.min(fy, 1 - fy) * (N / HS);
        if (seam < 1.6 * k) v *= 0.36; else if (seam < 3.2 * k) v *= 0.8;
        if (butt < 1.4 * k) v *= 0.42;
        else if (butt > 5 * k && butt < 9 * k && (Math.abs(fy - 0.3) < 0.07 || Math.abs(fy - 0.7) < 0.07)) v *= 0.62;
        data[o] = byte(v);
      }
      // G: deck planking — narrower, paler, and black pitch in the seams.
      {
        const f = w * DS, s = Math.floor(f), fy = f - s;
        const along = (u - deckButt[s] + 1) % 1;
        const seg = Math.floor(along * 3);
        const butt = Math.min(along % (1 / 3), 1 / 3 - (along % (1 / 3))) * N;
        let v = deckTone[s * 3 + seg] * (0.84 + 0.2 * grain) * (0.86 + 0.2 * cl);
        const seam = Math.min(fy, 1 - fy) * (N / DS);
        if (seam < 1.8 * k) v *= 0.22; else if (seam < 3 * k) v *= 0.84;
        if (butt < 1.3 * k) v *= 0.4;
        else if (butt > 4 * k && butt < 7 * k && Math.abs(fy - 0.5) > 0.2 && Math.abs(fy - 0.5) < 0.32) v *= 0.58;
        data[o + 1] = byte(v);
      }
      // B: a spar's grain, long and quiet.
      data[o + 2] = byte(0.78 + 0.2 * grain + 0.06 * (cl - 0.5));
      // A: glazing — mullions dark, panes lit and uneven.
      {
        const fu = u * PANES, fw = w * PANES;
        const cu = Math.floor(fu), cw = Math.floor(fw);
        const eu = Math.min(fu - cu, 1 - (fu - cu)), ew = Math.min(fw - cw, 1 - (fw - cw));
        const bar = Math.min(eu, ew) * (N / PANES);
        const glow = 1 - 0.35 * Math.hypot(fu - cu - 0.5, fw - cw - 0.5);
        data[o + 3] = bar < 4.5 * k ? 10 : byte(paneTone[cw * PANES + cu] * glow);
      }
    }
  }
  return finish(data, N, anisotropy);
}

/* --------------------------------------------------------------- canvas --- */

/** Which quarter of the sail atlas each look lives in. */
export const CANVAS_REGION: Record<Emblem | 'plain2', number> = { none: 0, plain2: 1, cross: 2, skull: 3 };

/** An emblem, drawn white on black with the 2D canvas and read back as a mask. */
function emblemMask(kind: 'cross' | 'skull', S: number): Float32Array {
  const out = new Float32Array(S * S);
  if (typeof document === 'undefined') return out;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
  c.fillStyle = c.strokeStyle = '#fff';
  if (kind === 'cross') {
    // The Cross of Burgundy: two ragged staves saltire-wise, with the stubs of lopped branches.
    const m = S * 0.1, lw = S * 0.08;
    c.lineWidth = lw; c.lineCap = 'butt';
    const staves: [number, number, number, number][] = [[m, m, S - m, S - m], [S - m, m, m, S - m]];
    for (const [x0, y0, x1, y1] of staves) {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
      for (let i = 1; i < 7; i++) {
        const t = i / 7, side = i % 2 ? 1 : -1;
        const px = x0 + dx * t + nx * side * lw * 0.55, py = y0 + dy * t + ny * side * lw * 0.55;
        c.save(); c.translate(px, py); c.rotate(Math.atan2(dy, dx) + side * 0.6);
        c.fillRect(-lw * 0.28, -lw * 0.22, lw * 0.56, lw * 0.44);
        c.restore();
      }
    }
  } else {
    // Skull and crossbones, narrowed so a sail's width stretches it back to round.
    c.save();
    c.translate(S / 2, 0); c.scale(0.62, 1); c.translate(-S / 2, 0);
    c.lineCap = 'round'; c.lineWidth = S * 0.07;
    const bone = (x0: number, y0: number, x1: number, y1: number) => {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = (-dy / l) * S * 0.035, ny = (dx / l) * S * 0.035;
      for (const [x, y] of [[x0, y0], [x1, y1]]) {
        c.beginPath(); c.arc(x + nx, y + ny, S * 0.045, 0, Math.PI * 2); c.arc(x - nx, y - ny, S * 0.045, 0, Math.PI * 2); c.fill();
      }
    };
    bone(S * 0.2, S * 0.64, S * 0.8, S * 0.9);
    bone(S * 0.8, S * 0.64, S * 0.2, S * 0.9);
    c.beginPath(); c.ellipse(S / 2, S * 0.4, S * 0.2, S * 0.19, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.roundRect(S * 0.37, S * 0.46, S * 0.26, S * 0.2, S * 0.04); c.fill();
    c.fillStyle = '#000';
    c.beginPath(); c.ellipse(S * 0.43, S * 0.41, S * 0.055, S * 0.06, 0.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(S * 0.57, S * 0.41, S * 0.055, S * 0.06, -0.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(S * 0.5, S * 0.47); c.lineTo(S * 0.47, S * 0.53); c.lineTo(S * 0.53, S * 0.53); c.fill();
    for (let i = 0; i < 5; i++) c.fillRect(S * (0.405 + i * 0.045), S * 0.58, S * 0.012, S * 0.07);
    c.restore();
  }
  const img = c.getImageData(0, 0, S, S).data;
  for (let i = 0; i < S * S; i++) out[i] = img[i * 4] / 255;
  return out;
}

export function canvas(N: number, anisotropy: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const H = N / 2;                                     // one sail's worth of the atlas
  const k = H / 512;
  const marks: (Float32Array | null)[] = [null, null, emblemMask('cross', H), emblemMask('skull', H)];

  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * H, oy = Math.floor(q / 2) * H;
    const R = rng(4100 + q * 17);
    const n1 = lattice(500 + q, 5), n2 = lattice(510 + q, 11), n3 = lattice(520 + q, 23), n4 = lattice(530 + q, 47), n5 = lattice(540 + q, 97);
    const rag = lattice(550 + q, 64, 10), rag2 = lattice(560 + q, 10, 64);   // streaks: down the foot, along the leech
    const rip = lattice(570 + q, 14, 4), rip2 = lattice(580 + q, 30, 9);    // tears run with the cloths, up and down
    const c4 = Math.max(1, Math.round(4 * k)), c2 = Math.max(1, Math.round(2 * k));
    const SOFT = coarse(H, c4, (s, t) => n1(s, t) * 0.5 + n2(s, t) * 0.3 + n3(s, t) * 0.2);
    const FINE = coarse(H, c2, (s, t) => n4(s, t) * 0.6 + n5(s, t) * 0.4);
    const STAIN = coarse(H, c4, (s, t) => n2(s + 0.37, t + 0.61));
    const WEAK = coarse(H, c2, (s, t) => rip(s, t) * 0.5 + rip2(s + 0.3, t) * 0.3 + n4(s, t + 0.5) * 0.2);
    const RAG = coarse(H, c2, rag), RAG2 = coarse(H, c2, rag2);
    const CLOTHS = 13;
    const tone = Array.from({ length: CLOTHS }, () => 0.93 + R() * 0.08);
    const patches = Array.from({ length: 3 + Math.floor(R() * 4) }, () => ({
      x: 0.12 + R() * 0.7, y: 0.18 + R() * 0.6, w: 0.05 + R() * 0.1, h: 0.04 + R() * 0.09, tone: 0.84 + R() * 0.2,
    }));
    const mark = marks[q];

    const pitch = Math.round(22 * k);
    for (let y = 0; y < H; y++) {
      const t = (y + 0.5) / H;                          // 0 at the head, 1 at the foot
      // reef bands across the head of the sail, and the reef points hanging under each
      let band = 1, points = false;
      for (const b of [0.11, 0.2, 0.29]) {
        if (Math.abs(t - b) * H < 2.2 * k) band *= 0.86;
        if (t > b && (t - b) * H < 12 * k) points = true;
      }
      for (let x = 0; x < H; x++) {
        const s = (x + 0.5) / H;                        // 0..1 across the sail
        const o = ((oy + y) * N + ox + x) * 4;
        const soft = SOFT(x, y);
        const fine = FINE(x, y);

        // The cloth: vertical cloths, double-stitched seams, reef bands, tabling round the edges.
        const cs = s * CLOTHS, ci = Math.floor(cs), cf = cs - ci;
        let lum = tone[ci % CLOTHS];
        const seam = Math.min(cf, 1 - cf) * (H / CLOTHS);
        if (seam < 1.2 * k) lum *= 0.68; else if (seam < 2.8 * k) lum *= 0.91;
        lum *= band;
        if (points && x % pitch < 1.6 * k) lum *= 0.62;
        const edge = Math.min(s, 1 - s, t, 1 - t) * H;
        if (edge < 2.5 * k) lum *= 0.62; else if (edge < 7 * k) lum *= 0.88;
        for (const p of patches) {
          const dx = Math.abs(s - p.x) - p.w / 2, dy = Math.abs(t - p.y) - p.h / 2;
          if (dx < 0 && dy < 0) {
            lum *= p.tone;
            const rim = -Math.max(dx, dy) * H;
            if (rim < 3 * k && ((x + y) % Math.round(5 * k + 1)) < 2) lum *= 0.72;   // stitches
          }
        }
        lum *= 0.92 + 0.1 * soft + 0.04 * (fine - 0.5);

        // Stains and weather: a few tide marks, and grime toward the foot where the spray reaches.
        const stain = clamp01(smooth(0.7, 0.86, STAIN(x, y)) * 0.4 + t * t * t * 0.32 * soft);

        // Tear: a few weak places where the fbm runs low, which shot opens into rips; the foot
        // frays into fingers first, then the leeches; the head, bent to its yard, never goes.
        let tear = 0.04 + 0.96 * smooth(0.2, 0.52, WEAK(x, y));
        const foot = clamp01((t - 0.8) / 0.2);
        if (foot > 0) tear = Math.min(tear, 1 - Math.pow(foot, 0.8) * (0.52 + 0.62 * RAG(x, y)));
        const leech = clamp01((0.07 - Math.min(s, 1 - s)) / 0.07);
        if (leech > 0) tear = Math.min(tear, 1 - Math.pow(leech, 0.9) * (0.3 + 0.55 * RAG2(x, y)));
        if (t < 0.05) tear = 1;

        data[o] = byte(lum);
        data[o + 1] = mark ? byte(mark[y * H + x] * (0.86 + 0.14 * fine) * (fine > 0.26 ? 1 : 0.55)) : 0;
        data[o + 2] = byte(stain);
        data[o + 3] = byte(Math.max(0.03, tear));
      }
    }
  }
  return finish(data, N, anisotropy);
}
