// The home-screen icons, drawn here rather than in an image editor: a Jolly Roger on a
// short gold staff over deep water. Written to public/ as PNGs (iOS will only take a PNG
// for its home screen, and Android wants 192 and 512 to install the game).
//
//   npm run icons
//
// Shapes are signed distances in a unit square, supersampled 4×4 a pixel for clean
// edges; the PNG is written by hand with zlib, so nothing needs installing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const DEEP = hex('#07141B'), SEA = hex('#15404C'), FLAG = hex('#0D0E11'), EDGE = hex('#2A2C30');
const BONE = hex('#F2E7CE'), GOLD = hex('#D9A441'), GOLD_DK = hex('#8A5F1B');

/* ------------------------------------------------------------ geometry --- */

const circle = (x: number, y: number, cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) - r;
function box(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r = 0) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
function segment(x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number) {
  const px = x - ax, py = y - ay, ux = bx - ax, uy = by - ay;
  const t = Math.max(0, Math.min(1, (px * ux + py * uy) / (ux * ux + uy * uy)));
  return Math.hypot(px - ux * t, py - uy * t) - r;
}

// The flag streams to the right off the staff and waves: everything on it moves with it.
const wave = (x: number) => 0.022 * Math.sin((x - 0.24) * 10.5) * Math.min(1, (x - 0.24) * 5);

function flag(x: number, y0: number) {
  const y = y0 - wave(x);
  const cloth = box(x, y, 0.24, 0.23, 0.86, 0.67, 0.012);
  // skull: cranium, jaw, eyes, nose; crossbones behind the jaw
  const cx = 0.55, cy = 0.405;
  const cranium = circle(x, y, cx, cy, 0.092);
  const jaw = box(x, y, cx - 0.052, cy + 0.035, cx + 0.052, cy + 0.108, 0.018);
  const eyes = Math.min(circle(x, y, cx - 0.036, cy + 0.008, 0.026), circle(x, y, cx + 0.036, cy + 0.008, 0.026));
  const nose = circle(x, y, cx, cy + 0.052, 0.012);
  const teeth = Math.min(...[-0.026, 0, 0.026].map((o) => box(x, y, cx + o - 0.004, cy + 0.084, cx + o + 0.004, cy + 0.108)));
  const skull = Math.max(Math.min(cranium, jaw), -Math.min(eyes, nose, teeth));
  const bone = (ax: number, ay: number, bx: number, by: number) => Math.min(
    segment(x, y, ax, ay, bx, by, 0.017),
    circle(x, y, ax - 0.012, ay - 0.004, 0.02), circle(x, y, ax + 0.004, ay + 0.014, 0.02),
    circle(x, y, bx + 0.012, by + 0.004, 0.02), circle(x, y, bx - 0.004, by - 0.014, 0.02));
  const bones = Math.min(bone(cx - 0.15, cy + 0.07, cx + 0.15, cy + 0.2), bone(cx + 0.15, cy + 0.07, cx - 0.15, cy + 0.2));
  return { cloth, skull, bones };
}

/** One sample: the colour at a point of the unit square. */
function shade(x: number, y: number): RGB {
  // deep water, lighter toward the middle
  const g = Math.min(1, Math.hypot(x - 0.5, y - 0.46) / 0.72);
  let c: RGB = [0, 1, 2].map((i) => SEA[i] + (DEEP[i] - SEA[i]) * g) as RGB;
  const put = (d: number, col: RGB) => { if (d < 0) c = col; };

  // the staff, and its gold truck
  put(box(x, y, 0.2, 0.17, 0.235, 0.87, 0.012), x < 0.215 ? GOLD : GOLD_DK);
  put(circle(x, y, 0.2175, 0.16, 0.03), GOLD);

  const f = flag(x, y);
  if (f.cloth < 0) {
    // a little light along the folds
    const fold = 0.5 + 0.5 * Math.cos((x - 0.24) * 10.5);
    c = [0, 1, 2].map((i) => FLAG[i] + (EDGE[i] - FLAG[i]) * fold * 0.5) as RGB;
    // the skull's hollows are cut out of it, so they show the flag again
    put(Math.min(f.bones, f.skull), BONE);
  }
  return c;
}

/* ----------------------------------------------------------------- png --- */

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf: Uint8Array) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(size: number, px: Uint8Array) {
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) raw.set(px.subarray(y * size * 3, (y + 1) * size * 3), y * (size * 3 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A zoom under 1 draws the whole picture smaller, inside the circle a maskable icon may
 *  be cut to. */
function render(size: number, zoom = 1) {
  const px = new Uint8Array(size * size * 3);
  const SS = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0];
      for (let b = 0; b < SS; b++) for (let a = 0; a < SS; a++) {
        const u = (i + (a + 0.5) / SS) / size, v = (j + (b + 0.5) / SS) / size;
        const c = shade((u - 0.5) / zoom + 0.5, (v - 0.5) / zoom + 0.5);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = (j * size + i) * 3;
      px[o] = acc[0] / (SS * SS); px[o + 1] = acc[1] / (SS * SS); px[o + 2] = acc[2] / (SS * SS);
    }
  }
  return png(size, px);
}

mkdirSync('public', { recursive: true });
for (const [name, size, zoom] of [['icon-512.png', 512, 1], ['icon-192.png', 192, 1], ['icon-maskable-512.png', 512, 0.8], ['apple-touch-icon.png', 180, 1], ['favicon.png', 48, 1]] as const) {
  writeFileSync(`public/${name}`, render(size, zoom));
  console.log(`public/${name}`);
}
