// The bar's sea as a chart for the TV: flat and bright, and read from across the room. The
// sea is a disc in the game's blues, closing in and opening out with the ships on it; the
// islands are cartoon shapes; every ship is an outlined icon in her captain's colour with
// her name and skulls over her, and a WANTED ship pulses red. Shots are short streaks and
// a sinking is a splash. A shield is a bubble over her; a song, a pink ring as wide as its
// reach with rings closing in on her.
//
// A 2D canvas, so the TV needs no WebGL and none of the 3D game. Ships, names and splashes
// are drawn bigger than life where the sea is big: a 24 m ship on a 1 km sea would be a
// speck across a bar.

import { markOf } from '../data/colors';
import { TUNING as T } from '../data/tuning';
import { rng } from '../core/rng';
import type { Seat } from '../net/protocol';
import { coastAt, type GameMap, type Island } from '../sim/map';
import type { CrateKind, GameEvent, Ship, World } from '../sim/types';

const C = {
  closed: '#13508F', deep: '#1A86D6', open: '#25A3E6', shallow: '#5FE0DD', edge: '#FFF4C9',
  sand: '#F6DD94', sand2: '#E6C677', grass: '#79C850', grass2: '#5DB043', leaf: '#3E9A3A',
  rock: '#A6A3B4', rock2: '#8C899C', trunk: '#8A5A33',
  ink: '#10233F', wood: '#9A5B2E', deck: '#C98A4B', sail: '#FFF6E0', red: '#FF4D3D', sun: '#FFD43B',
  foam: '#E9FBFF', heavy: '#FF6A1F', shield: '#7FE3FF', song: '#FF7AD9',
};
const CRATE: Record<CrateKind, string> = { repair: '#3FD46A', speed: '#FFD23F', heavy: '#FF5A3C' };

const TAU = Math.PI * 2;
const MARGIN = 14;            // metres of sea kept round the edge of the frame
const WAVES = 160;            // wave marks scattered on the water

interface Fx { k: string; x: number; y: number; t: number; dur: number; p?: number; c?: string; a?: number; big?: boolean; bits?: number[][] }

interface Placed { x: number; y: number; w: number; h: number }

export class Chart {
  /** Pixels on the right kept clear for the side panel: the sea is framed in the rest. */
  room = 0;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private k = 0;                         // pixels per metre, eased toward the frame wanted
  private fx: Fx[] = [];
  private seed = '';
  private isles: { is: Island; foam: Path2D; shoal: Path2D; coast: Path2D; top: Path2D; deco: (ctx: CanvasRenderingContext2D, px: number) => void }[] = [];
  private waves: [number, number, number][] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const r = rng('waves');
    for (let i = 0; i < WAVES; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 620;
      this.waves.push([Math.cos(a) * d, Math.sin(a) * d, r() * TAU]);
    }
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  /** What happened, as the chart shows it: splashes, bursts, pops. */
  hear(evs: GameEvent[], w: World, seats: Seat[]) {
    const now = performance.now() / 1000;
    const colour = (id: unknown) => { const s = seats.find((x) => x.id === id); return s && s.c >= 0 ? markOf(s.c).color : C.foam; };
    for (const e of evs) {
      const x = e.x as number, y = e.y as number;
      switch (e.k) {
        case 'splash': this.fx.push({ k: 'splash', x, y, t: now, dur: 0.6 }); break;
        case 'hit': this.fx.push({ k: 'hit', x, y, t: now, dur: 0.4 }); break;
        case 'thud':
          if (e.rock) this.fx.push({ k: 'dust', x, y, t: now, dur: 0.5 });
          else if (e.shield) this.fx.push({ k: 'pop', x, y, t: now, dur: 0.35, c: C.shield });
          break;
        case 'volley': {
          const big = typeof e.n === 'number';
          this.fx.push({ k: 'smoke', x, y, t: now, dur: big ? 1.1 : 0.7, a: e.a as number, big });
          if (big) this.fx.push({ k: 'pop', x, y, t: now, dur: 0.5, c: C.heavy });
          break;
        }
        case 'power':
          if (e.kind === 'shield') this.fx.push({ k: 'pop', x: 0, y: 0, p: e.p as number, t: now, dur: 0.5, c: C.shield });
          break;
        case 'sunk': {
          const r = rng(`${x}:${y}`);
          const bits = Array.from({ length: 14 }, (_, i) => [r() * TAU, 0.4 + r() * 0.6, r() * TAU, i < 6 ? 1 : 0]);
          this.fx.push({ k: 'sunk', x, y, t: now, dur: 2.6, bits });
          break;
        }
        case 'back': { const s = w.ships[e.p as number]; if (s) this.fx.push({ k: 'pop', x: 0, y: 0, p: s.id, t: now, dur: 0.7, c: colour(s.id) }); break; }
        case 'take': this.fx.push({ k: 'pop', x, y, t: now, dur: 0.5, c: CRATE[e.kind as CrateKind] }); break;
        case 'won': {
          const r = rng(`won:${now}`);
          const bits = Array.from({ length: 28 }, () => [r() * TAU, 0.5 + r() * 0.8, r() * TAU, Math.floor(r() * 4)]);
          this.fx.push({ k: 'won', x: 0, y: 0, p: e.p as number, t: now, dur: 3.2, c: colour(e.p), bits });
          break;
        }
        default: break;
      }
    }
    if (this.fx.length > 300) this.fx.splice(0, this.fx.length - 300);
  }

  /** One picture. `map` is drawn without a world (a sea not yet made); `quiet` hides the
   *  ships, as a sea with nobody aboard is asleep. */
  draw(w: World | null, map: GameMap, seats: Seat[], dt: number, quiet: boolean) {
    const { ctx, W, H, dpr } = this;
    const t = performance.now() / 1000;
    const R = w?.R ?? T.speed * T.across / 2;
    const cw = Math.max(200, W - this.room), ox = cw / 2, oy = H / 2;
    const want = Math.min(cw * 0.95, H * 0.95) / (2 * (R + MARGIN));
    this.k = this.k ? this.k + (want - this.k) * Math.min(1, dt * 1.5) : want;
    const k = this.k;
    if (map.seed !== this.seed) this.build(map);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.closed;
    ctx.fillRect(0, 0, W, H);

    // the sea: brighter at the middle, with wave marks drifting on it
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * k);
    g.addColorStop(0, C.open); g.addColorStop(1, C.deep);
    ctx.save();
    ctx.beginPath(); ctx.arc(ox, oy, R * k, 0, TAU);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, k * 0.9); ctx.lineCap = 'round';
    const wl = Math.max(9, k * 7);
    ctx.beginPath();
    for (const [x, y, ph] of this.waves) {
      const sx = ox + x * k + Math.sin(t * 0.4 + ph) * wl * 0.25, sy = oy + y * k;
      ctx.moveTo(sx - wl, sy);
      ctx.quadraticCurveTo(sx - wl / 2, sy - wl * 0.45, sx, sy);
      ctx.quadraticCurveTo(sx + wl / 2, sy + wl * 0.45, sx + wl, sy);
    }
    ctx.stroke();
    ctx.restore();

    // the islands, in metres
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    const px = 1 / k;
    for (const i of this.isles) {
      ctx.fillStyle = 'rgba(233,251,255,0.45)'; ctx.fill(i.foam);
      ctx.fillStyle = C.shallow; ctx.fill(i.shoal);
      ctx.fillStyle = C.sand; ctx.fill(i.coast);
      ctx.lineWidth = 3 * px; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke(i.coast);
      i.deco(ctx, px);
    }

    // closed water past the edge, dimmed; the edge itself a bright line
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(ox, oy, R * k, 0, TAU, true);
    ctx.fillStyle = 'rgba(19,80,143,0.62)';
    ctx.fill('evenodd');
    ctx.beginPath(); ctx.arc(ox, oy, R * k, 0, TAU);
    ctx.strokeStyle = 'rgba(255,244,201,0.28)'; ctx.lineWidth = 12; ctx.stroke();
    ctx.setLineDash([18, 12]); ctx.lineDashOffset = -t * 8;
    ctx.strokeStyle = C.edge; ctx.lineWidth = 3; ctx.stroke();
    ctx.setLineDash([]);

    const at = (x: number, y: number) => [ox + x * k, oy + y * k] as const;
    const L = Math.max(T.length * k * 1.15, H * 0.062);           // a ship's length on screen

    if (w && !quiet) {
      for (const c of w.crates) this.crate(...at(c.x, c.y), c.kind, c.age, c.id, t);
      this.shots(w, at, k);
      const afloat = w.ships.filter((s) => !s.out && !s.left);
      for (const s of afloat) if (s.song > 0) this.song(...at(s.x, s.y), L, k, t);
      for (const s of afloat) this.under(s, ...at(s.x, s.y), L, seats, t);
      for (const s of afloat) this.ship(s, ...at(s.x, s.y), L, seats, t);
    }
    this.effects(w, at, k, L, t);
    if (w && !quiet) this.labels(w, seats, at, L, t);
  }

  /* -------------------------------------------------------------- islands -- */

  private build(map: GameMap) {
    this.seed = map.seed;
    this.isles = map.islands.map((is) => {
      const r = rng(is.seed);
      const shape = (pad: number, scale = 1, dx = 0, dy = 0) => {
        const p = new Path2D(), n = 48;
        const pts = Array.from({ length: n }, (_, i) => {
          const a = (i / n) * TAU, rr = (coastAt(is, a) + pad) * scale;
          return [is.x + dx + Math.cos(a) * rr, is.y + dy + Math.sin(a) * rr];
        });
        // smooth: through the midpoints, each point a control
        const mid = (i: number) => { const a = pts[i % n], b = pts[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
        const m0 = mid(n - 1);
        p.moveTo(m0[0], m0[1]);
        for (let i = 0; i < n; i++) { const m = mid(i); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
        p.closePath();
        return p;
      };
      const foam = shape(5), shoal = shape(2.4), coast = shape(0);
      const lift = -is.r * 0.08;                         // the high ground sits a little north-west
      const top = shape(0, is.kind === 'sand' ? 0.55 : 0.72, lift, lift);
      const blobs = Array.from({ length: is.kind === 'jungle' ? Math.max(3, Math.round(is.r / 6)) : 3 }, () => {
        const a = r() * TAU, d = Math.sqrt(r()) * is.r * 0.45;
        return [is.x + lift + Math.cos(a) * d, is.y + lift + Math.sin(a) * d, is.r * (0.13 + r() * 0.1)];
      });
      const deco = (ctx: CanvasRenderingContext2D, px: number) => {
        ctx.lineWidth = 2.5 * px; ctx.strokeStyle = C.ink;
        if (is.kind === 'jungle') {
          ctx.fillStyle = C.grass; ctx.fill(top); ctx.stroke(top);
          for (const [x, y, rr] of blobs) {
            ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
            ctx.fillStyle = C.leaf; ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.45, 0, TAU);
            ctx.fillStyle = C.grass2; ctx.fill();
          }
        } else if (is.kind === 'rock') {
          ctx.fillStyle = C.rock2; ctx.fill(top); ctx.stroke(top);
          ctx.save(); ctx.clip(top);
          ctx.translate(-is.r * 0.1, -is.r * 0.1);
          ctx.fillStyle = C.rock; ctx.fill(top);
          ctx.restore();
          ctx.beginPath();
          for (const [x, y, rr] of blobs) { ctx.moveTo(x - rr, y); ctx.lineTo(x, y + rr * 0.4); ctx.lineTo(x + rr * 0.8, y - rr * 0.2); }
          ctx.lineWidth = 1.8 * px; ctx.stroke();
        } else {
          ctx.fillStyle = C.sand2; ctx.fill(top);
          const [x, y] = blobs[0], h = Math.max(4, is.r * 0.5);
          palm(ctx, x, y, h, px);
        }
      };
      return { is, foam, shoal, coast, top, deco };
    });
  }

  /* --------------------------------------------------------------- ships -- */

  /** Her colour on the water: a disc and a ring, the dashed marks turning. WANTED, a red ring
   *  that pulses out. */
  private under(s: Ship, x: number, y: number, L: number, seats: Seat[], t: number) {
    const { ctx } = this;
    const m = mark(seats, s.id), r = L * 0.62;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = hexA(m.color, 0.2); ctx.fill();
    ctx.lineWidth = Math.max(3, L * 0.07); ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.lineWidth = Math.max(2, L * 0.045); ctx.strokeStyle = m.color;
    if (m.dashed) { ctx.setLineDash([L * 0.2, L * 0.13]); ctx.lineDashOffset = -t * L * 0.6; }
    ctx.stroke(); ctx.setLineDash([]);
    if (s.shield > 0) {
      // a bubble over her, its edge bright
      ctx.beginPath(); ctx.arc(x, y, L * 0.82, 0, TAU);
      ctx.fillStyle = hexA(C.shield, 0.28 + 0.06 * Math.sin(t * 9)); ctx.fill();
      ctx.lineWidth = Math.max(4, L * 0.08); ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.lineWidth = Math.max(2.5, L * 0.05); ctx.strokeStyle = C.shield; ctx.stroke();
    }
    if (s.streak >= T.wanted) {
      const f = (t * 1.2) % 1;
      ctx.beginPath(); ctx.arc(x, y, r + 6 + f * L * 0.5, 0, TAU);
      ctx.strokeStyle = hexA(C.red, 1 - f); ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU);
      ctx.strokeStyle = C.red; ctx.lineWidth = 4; ctx.stroke();
    }
  }

  /** A song: a pink ring as wide as its reach, and rings closing in on her from it, which is
   *  the way everything inside is being pulled. Never drawn smaller than her own ring. */
  private song(x: number, y: number, L: number, k: number, t: number) {
    const { ctx } = this;
    const R = Math.max(T.songRange * k, L * 1.6), r = L * 0.62;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU);
    ctx.fillStyle = hexA(C.song, 0.08); ctx.fill();
    ctx.setLineDash([L * 0.25, L * 0.15]); ctx.lineDashOffset = t * L * 0.5;
    ctx.lineWidth = Math.max(3, L * 0.06); ctx.strokeStyle = C.song; ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 2; i++) {
      const f = (t * 1.1 + i * 0.5) % 1;
      ctx.beginPath(); ctx.arc(x, y, R - (R - r) * f, 0, TAU);
      ctx.strokeStyle = hexA(C.song, 0.9 * (1 - f)); ctx.lineWidth = 4; ctx.stroke();
    }
  }

  /** The ship, from above: a hull with her deck, two sails across her with a band of her
   *  colour, a wake behind as she makes way. */
  private ship(s: Ship, x: number, y: number, L: number, seats: Seat[], t: number) {
    const { ctx } = this;
    const m = mark(seats, s.id), B = L * 0.42, ink = Math.max(2, L * 0.055);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(s.h);
    if (s.invuln > 0) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 14);

    const way = Math.max(0, Math.min(1, s.v / T.speed));
    if (way > 0.05) {
      ctx.strokeStyle = `rgba(233,251,255,${0.65 * way})`;
      ctx.lineWidth = Math.max(3, L * 0.08); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-L * 0.45, B * 0.32); ctx.lineTo(-L * (0.5 + way * 0.7), B * (0.6 + way * 0.5));
      ctx.moveTo(-L * 0.45, -B * 0.32); ctx.lineTo(-L * (0.5 + way * 0.7), -B * (0.6 + way * 0.5));
      ctx.stroke();
    }
    const hull = new Path2D();
    hull.moveTo(L / 2, 0);
    hull.bezierCurveTo(L * 0.32, B * 0.58, -L * 0.22, B * 0.58, -L / 2, B * 0.38);
    hull.lineTo(-L / 2, -B * 0.38);
    hull.bezierCurveTo(-L * 0.22, -B * 0.58, L * 0.32, -B * 0.58, L / 2, 0);
    hull.closePath();
    // a shadow on the water, the bowsprit, the hull and her deck
    ctx.save(); ctx.translate(L * 0.03, L * 0.06); ctx.fillStyle = 'rgba(16,35,63,0.3)'; ctx.fill(hull); ctx.restore();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(L * 0.4, 0); ctx.lineTo(L * 0.66, 0);
    ctx.strokeStyle = C.ink; ctx.lineWidth = ink * 1.9; ctx.stroke();
    ctx.strokeStyle = C.wood; ctx.lineWidth = ink * 0.8; ctx.stroke();
    ctx.fillStyle = C.wood; ctx.fill(hull);
    ctx.save(); ctx.scale(0.82, 0.7); ctx.translate(-L * 0.03, 0); ctx.fillStyle = C.deck; ctx.fill(hull); ctx.restore();
    ctx.strokeStyle = 'rgba(16,35,63,0.2)'; ctx.lineWidth = Math.max(1, L * 0.018);
    ctx.beginPath();
    for (const d of [-0.15, 0, 0.15]) { ctx.moveTo(-L * 0.36, B * d); ctx.lineTo(L * 0.3, B * d); }
    ctx.stroke();
    // the stern cabin
    ctx.fillStyle = C.wood; roundRect(ctx, -L * 0.47, -B * 0.27, L * 0.17, B * 0.54, L * 0.04); ctx.fill();
    ctx.lineWidth = ink * 0.7; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.lineWidth = ink; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke(hull);
    if (s.hit > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, s.hit)})`; ctx.fill(hull); }

    // the black flag off the stern, flying aft
    const fly = Math.sin(t * 7 + s.id) * B * 0.1;
    ctx.beginPath();
    ctx.moveTo(-L * 0.47, -B * 0.05); ctx.lineTo(-L * 0.72, -B * 0.12 + fly);
    ctx.lineTo(-L * 0.74, B * 0.2 + fly); ctx.lineTo(-L * 0.47, B * 0.25); ctx.closePath();
    ctx.fillStyle = '#17171C'; ctx.fill(); ctx.lineWidth = ink * 0.6; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath(); ctx.arc(-L * 0.6, B * 0.06 + fly * 0.5, B * 0.07, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();

    // two square sails, wider than she is and bellied forward, a band of her colour across each
    for (const [mx, span] of [[L * 0.17, B * 1.85], [-L * 0.13, B * 2.1]]) {
      const back = mx - L * 0.05, belly = L * (0.08 + 0.07 * Math.max(0.2, s.sail));
      const sail = new Path2D();
      sail.moveTo(back, -span / 2);
      sail.bezierCurveTo(back + belly * 1.3, -span * 0.42, back + belly * 1.3, span * 0.42, back, span / 2);
      sail.closePath();
      ctx.fillStyle = C.sail; ctx.fill(sail);
      ctx.save(); ctx.clip(sail);
      ctx.fillStyle = m.color; ctx.fillRect(back - L * 0.02, -span * 0.17, belly * 1.4, span * 0.34);
      ctx.fillStyle = 'rgba(16,35,63,0.12)'; ctx.fillRect(back - L * 0.02, -span / 2, L * 0.035, span);
      ctx.restore();
      ctx.lineWidth = ink * 0.85; ctx.strokeStyle = C.ink; ctx.stroke(sail);
      // the yard it hangs from, a little longer than the sail
      ctx.beginPath(); ctx.moveTo(back, -span * 0.56); ctx.lineTo(back, span * 0.56);
      ctx.lineWidth = ink * 1.1; ctx.strokeStyle = C.ink; ctx.stroke();
    }
    ctx.restore();

    // her hull, when it is hurt
    if (s.hull < s.hullMax) {
      const bw = L * 0.8, bh = Math.max(5, L * 0.1), bx = x - bw / 2, by = y + L * 0.62 + 8;
      const f = Math.max(0, s.hull / s.hullMax);
      ctx.fillStyle = C.ink; roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, (bh + 4) / 2); ctx.fill();
      ctx.fillStyle = f > 0.5 ? '#4BD35A' : f > 0.25 ? C.sun : C.red;
      if (f > 0) { roundRect(ctx, bx, by, bw * f, bh, bh / 2); ctx.fill(); }
    }
  }

  /** Every afloat ship's name in her colour, skulls under it for her streak, WANTED over a
   *  ship one sink from winning. Captains are placed first; a label that would cover
   *  another goes under its ship instead. */
  private labels(w: World, seats: Seat[], at: (x: number, y: number) => readonly [number, number], L: number, t: number) {
    const { ctx } = this;
    const fs = Math.round(Math.min(38, Math.max(15, this.H * 0.027)));
    const placed: Placed[] = [];
    const afloat = w.ships.filter((s) => !s.out && !s.left)
      .map((s) => ({ s, seat: seats.find((x) => x.id === s.id && !x.left) }))
      .sort((a, b) => Number(!!a.seat?.bot) - Number(!!b.seat?.bot) || b.s.streak - a.s.streak);
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const { s, seat } of afloat) {
      const [x, y] = at(s.x, s.y);
      const bot = !!seat?.bot, f = bot ? Math.round(fs * 0.78) : fs;
      const name = seat?.name ?? '';
      ctx.font = `${f}px 'Lilita One', system-ui, sans-serif`;
      const nw = ctx.measureText(name).width;
      const tag = bot ? 'BOT' : '';
      ctx.font = `${Math.round(f * 0.6)}px 'Lilita One', system-ui, sans-serif`;
      const tw = tag ? ctx.measureText(tag).width + f * 0.5 : 0;
      const dot = f * 0.42;
      const lw = dot * 2 + f * 0.3 + nw + tw;
      const skulls = Math.min(T.win - 1, s.streak), sk = f * 0.9;
      const wanted = s.streak >= T.wanted;
      const lh = f * 1.15 + (skulls ? sk * 1.05 : 0) + (wanted ? f * 1.05 : 0);
      const ring = L * 0.62 + (s.hull < s.hullMax ? L * 0.1 + 12 : 0);
      const spots: Placed[] = [
        { x: x - lw / 2, y: y - L * 0.62 - 8 - lh, w: lw, h: lh },
        { x: x - lw / 2, y: y + ring + 8, w: lw, h: lh },
      ];
      const free = (p: Placed) => placed.every((q) => p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y);
      const spot = spots.find(free) ?? spots[0];
      placed.push(spot);
      let cy = spot.y;
      if (wanted) {
        const pulse = 1 + 0.06 * Math.sin(t * 8);
        ctx.font = `${Math.round(f * 0.78 * pulse)}px 'Lilita One', system-ui, sans-serif`;
        const ww = ctx.measureText('WANTED').width + f * 0.8, wh = f * 0.95;
        ctx.fillStyle = C.red; roundRect(ctx, x - ww / 2, cy, ww, wh, wh * 0.3); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('WANTED', x, cy + wh / 2 + 1);
        cy += f * 1.05;
      }
      // the name: her colour's dot, then the name outlined in ink
      const nx = spot.x, ny = cy + f * 0.58;
      const m = mark(seats, s.id);
      ctx.beginPath(); ctx.arc(nx + dot, ny, dot, 0, TAU);
      ctx.fillStyle = m.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.font = `${f}px 'Lilita One', system-ui, sans-serif`; ctx.textAlign = 'left';
      ctx.lineWidth = Math.max(3, f * 0.26); ctx.strokeStyle = C.ink;
      ctx.strokeText(name, nx + dot * 2 + f * 0.3, ny);
      ctx.fillStyle = bot ? '#DDE8F4' : '#fff'; ctx.fillText(name, nx + dot * 2 + f * 0.3, ny);
      if (tag) {
        const tx = nx + dot * 2 + f * 0.3 + nw + f * 0.25, th = f * 0.7;
        ctx.font = `${Math.round(f * 0.6)}px 'Lilita One', system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(16,35,63,0.75)'; roundRect(ctx, tx, ny - th / 2, tw - f * 0.25, th, th / 2); ctx.fill();
        ctx.fillStyle = '#BFD3EA'; ctx.textAlign = 'center'; ctx.fillText(tag, tx + (tw - f * 0.25) / 2, ny + 1);
      }
      cy += f * 1.15;
      for (let i = 0; i < skulls; i++) skull(ctx, x + (i - (skulls - 1) / 2) * sk * 1.1, cy + sk / 2, sk, wanted ? C.red : '#fff');
    }
  }

  /* -------------------------------------------------------- shots, crates -- */

  private shots(w: World, at: (x: number, y: number) => readonly [number, number], k: number) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const s of w.shots) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      const tail = Math.max(14, Math.min(s.age, 0.07) * sp * k);
      const [x, y] = at(s.x, s.y), dx = (s.vx / sp) * tail, dy = (s.vy / sp) * tail;
      const r = s.heavy ? 4.5 : 3.2;
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(16,35,63,0.55)'; ctx.lineWidth = r * 2 + 2; ctx.stroke();
      ctx.strokeStyle = s.heavy ? C.heavy : '#fff'; ctx.lineWidth = r * 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = '#2E2A33'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = s.heavy ? C.heavy : '#fff'; ctx.stroke();
    }
  }

  private crate(x: number, y: number, kind: CrateKind, age: number, id: number, t: number) {
    const { ctx } = this;
    const grow = Math.min(1, age / 0.35);
    const s = Math.max(22, this.H * 0.03) * (grow < 1 ? 1.3 * grow - 0.3 * grow * grow : 1) * (1 + 0.06 * Math.sin(t * 3 + id));
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.3 + id) * 0.12);
    ctx.fillStyle = 'rgba(233,251,255,0.5)'; ctx.beginPath(); ctx.arc(0, s * 0.1, s * 0.85, 0, TAU); ctx.fill();
    roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.22);
    ctx.fillStyle = CRATE[kind]; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    if (kind === 'repair') {
      const a = s * 0.13, b = s * 0.32;
      ctx.beginPath();
      ctx.moveTo(-a, -b); ctx.lineTo(a, -b); ctx.lineTo(a, -a); ctx.lineTo(b, -a); ctx.lineTo(b, a); ctx.lineTo(a, a);
      ctx.lineTo(a, b); ctx.lineTo(-a, b); ctx.lineTo(-a, a); ctx.lineTo(-b, a); ctx.lineTo(-b, -a); ctx.lineTo(-a, -a); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (kind === 'speed') {
      ctx.beginPath();
      ctx.moveTo(s * 0.08, -s * 0.36); ctx.lineTo(-s * 0.2, s * 0.05); ctx.lineTo(0, s * 0.05);
      ctx.lineTo(-s * 0.08, s * 0.36); ctx.lineTo(s * 0.22, -s * 0.06); ctx.lineTo(s * 0.02, -s * 0.06); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, s * 0.02, s * 0.25, 0, TAU);
      ctx.fillStyle = '#2E2A33'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * 0.08, -s * 0.06, s * 0.07, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- effects -- */

  private effects(w: World | null, at: (x: number, y: number) => readonly [number, number], k: number, L: number, t: number) {
    const { ctx } = this;
    this.fx = this.fx.filter((f) => t - f.t < f.dur);
    for (const f of this.fx) {
      const u = (t - f.t) / f.dur;
      let x: number, y: number;
      if (f.p != null) { const s = w?.ships[f.p]; if (!s) continue; [x, y] = at(s.x, s.y); } else [x, y] = at(f.x, f.y);
      switch (f.k) {
        case 'splash': {
          const r = Math.max(5, k * 2) + u * Math.max(10, k * 5);
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
          ctx.strokeStyle = `rgba(233,251,255,${1 - u})`; ctx.lineWidth = 3; ctx.stroke();
          break;
        }
        case 'dust': {
          ctx.fillStyle = `rgba(185,180,166,${0.8 * (1 - u)})`;
          for (let i = 0; i < 4; i++) { const a = i * 1.7; ctx.beginPath(); ctx.arc(x + Math.cos(a) * u * 14, y + Math.sin(a) * u * 14, 5 + u * 6, 0, TAU); ctx.fill(); }
          break;
        }
        case 'hit': {
          const r = L * (0.15 + u * 0.35);
          ctx.save(); ctx.translate(x, y); ctx.rotate(f.t * 7);
          ctx.beginPath();
          for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath();
          ctx.fillStyle = `rgba(255,180,58,${1 - u})`; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = `rgba(16,35,63,${1 - u})`; ctx.stroke();
          ctx.restore();
          break;
        }
        case 'smoke': {
          // a broadside's smoke fans out wider and further
          const a = f.a ?? 0, n = f.big ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const d = L * (0.35 + i * 0.18 + u * 0.2), off = f.big ? (i / (n - 1) - 0.5) * 0.5 : 0;
            ctx.beginPath(); ctx.arc(x + Math.cos(a + off) * d, y + Math.sin(a + off) * d, L * ((f.big ? 0.12 : 0.08) + u * 0.1), 0, TAU);
            ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - u)})`; ctx.fill();
          }
          break;
        }
        case 'pop': {
          const r = L * (0.3 + u * 0.7);
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
          ctx.strokeStyle = hexA(f.c ?? '#fff', 1 - u); ctx.lineWidth = 5 * (1 - u) + 1; ctx.stroke();
          break;
        }
        case 'sunk': {
          // rings out, spray up and falling, and wreckage drifting off
          for (let i = 0; i < 3; i++) {
            const v = Math.max(0, Math.min(1, (u * f.dur - i * 0.18) / 1.3));
            if (v <= 0 || v >= 1) continue;
            ctx.beginPath(); ctx.arc(x, y, L * (0.3 + v * 1.1), 0, TAU);
            ctx.strokeStyle = `rgba(233,251,255,${(1 - v) * 0.95})`; ctx.lineWidth = 6 * (1 - v) + 1.5; ctx.stroke();
          }
          if (u < 0.35) {
            const v = u / 0.35;
            ctx.beginPath(); ctx.arc(x, y, L * (0.35 + v * 0.25), 0, TAU);
            ctx.fillStyle = `rgba(233,251,255,${0.9 * (1 - v)})`; ctx.fill();
          }
          for (const [a, sp, spin, wood] of f.bits!) {
            const d = L * sp * (wood ? 0.5 + u * 0.5 : 0.9 * Math.sqrt(u) + 0.2);
            const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d - (wood ? 0 : L * 0.5 * Math.sin(Math.min(1, u * 2.2) * Math.PI));
            if (wood) {
              ctx.save(); ctx.translate(bx, by); ctx.rotate(spin + u * 2);
              ctx.globalAlpha = 1 - Math.max(0, u - 0.6) / 0.4;
              ctx.fillStyle = C.wood; ctx.fillRect(-L * 0.09, -L * 0.03, L * 0.18, L * 0.06);
              ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.strokeRect(-L * 0.09, -L * 0.03, L * 0.18, L * 0.06);
              ctx.restore();
            } else if (u < 0.45) {
              ctx.beginPath(); ctx.arc(bx, by, L * 0.05 * (1 - u), 0, TAU);
              ctx.fillStyle = C.foam; ctx.fill();
            }
          }
          break;
        }
        case 'won': {
          // gold rings and confetti in the winner's colour and the bar's
          for (let i = 0; i < 2; i++) {
            const v = (u * 2.2 + i * 0.5) % 1;
            ctx.beginPath(); ctx.arc(x, y, L * (0.6 + v * 1.6), 0, TAU);
            ctx.strokeStyle = hexA(C.sun, (1 - v) * (1 - u)); ctx.lineWidth = 7 * (1 - v) + 2; ctx.stroke();
          }
          const cols = [C.sun, f.c ?? '#fff', '#fff', C.red];
          for (const [a, sp, spin, ci] of f.bits!) {
            const d = L * (0.5 + sp * 2.2 * Math.sqrt(u));
            ctx.save(); ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d + u * u * L * 0.8); ctx.rotate(spin + u * 9);
            ctx.globalAlpha = 1 - Math.max(0, u - 0.7) / 0.3;
            ctx.fillStyle = cols[ci]; ctx.fillRect(-L * 0.06, -L * 0.03, L * 0.12, L * 0.06);
            ctx.restore();
          }
          break;
        }
        default: break;
      }
    }
  }
}

/* ------------------------------------------------------------------ bits -- */

const mark = (seats: Seat[], id: number) => { const s = seats.find((x) => x.id === id && !x.left); return markOf(s && s.c >= 0 ? s.c : 0); };

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** A cartoon skull, `s` across. */
function skull(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, -s * 0.08, s * 0.4, Math.PI * 0.82, Math.PI * 2.18);
  ctx.lineTo(s * 0.24, s * 0.38); ctx.lineTo(-s * 0.24, s * 0.38); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.12); ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = C.ink;
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * s * 0.15, -s * 0.06, s * 0.1, s * 0.12, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(0, s * 0.08); ctx.lineTo(-s * 0.05, s * 0.18); ctx.lineTo(s * 0.05, s * 0.18); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** A palm on a sandbar, `h` metres tall from above: a curved trunk and five fronds. */
function palm(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, px: number) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - h * 0.2, y + h * 0.35); ctx.quadraticCurveTo(x - h * 0.25, y, x, y - h * 0.1);
  ctx.strokeStyle = C.ink; ctx.lineWidth = h * 0.16 + 2.5 * px; ctx.stroke();
  ctx.strokeStyle = C.trunk; ctx.lineWidth = h * 0.16; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const fr = new Path2D();
    fr.moveTo(x, y - h * 0.1);
    fr.quadraticCurveTo(x + Math.cos(a - 0.4) * h * 0.4, y - h * 0.1 + Math.sin(a - 0.4) * h * 0.4, x + Math.cos(a) * h * 0.55, y - h * 0.1 + Math.sin(a) * h * 0.55);
    fr.quadraticCurveTo(x + Math.cos(a + 0.4) * h * 0.25, y - h * 0.1 + Math.sin(a + 0.4) * h * 0.25, x, y - h * 0.1);
    ctx.fillStyle = C.leaf; ctx.fill(fr); ctx.lineWidth = 2 * px; ctx.strokeStyle = C.ink; ctx.stroke(fr);
  }
}
