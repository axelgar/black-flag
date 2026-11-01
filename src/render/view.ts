// The picture. A camera high in the south looking north, north always up the screen, over
// a cartoon sea: the islands, every ship, the balls in the air, the crates, and whatever
// just went bang. It reads a World and draws it; it never changes it.
//
// Two ways to look:
//   show   the name screen: one ship, yours, turning slowly at anchor
//   sea    the fight: the camera follows your ship

import * as THREE from 'three';
import { markOf } from '../data/colors';
import { LOOKS } from '../data/ships';
import { TUNING } from '../data/tuning';
import type { GameEvent, World } from '../sim/types';
import type { GameMap } from '../sim/map';
import { Fleet, type ShipDraw } from './ships';
import { CRATE_COLOR, Crates } from './crates';
import { Fx } from './fx';
import { inkWidth } from './ink';
import { Land, propsFrom } from './land';
import { SEA, Sea } from './sea';
import { PROP_SETS } from '../data/props';

export type Mode = 'show' | 'sea';

const FOV = 36;
/** How far down the camera looks, radians below the horizon (about 56°). */
const PITCH = 0.98;
/** Sea a landscape phone shows: this much from the middle to the top edge, and to each side. */
const SEE_UP = 82, SEE_SIDE = 130;
/** Outlines, CSS pixels wide: at sea, and on the name screen, where the ship is close. */
const INK_SEA = 1.6, INK_SHOW = 2.4;
const SINK = 1.8;   // seconds a sinking ship is drawn going down
const POP = 0.35;   // seconds a ship coming in takes to swell to her size

/** What the view remembers of each ship between frames. */
interface Seen { out: boolean; sinkT: number; popT: number; hit: number; foam: number; x: number; y: number; h: number; heel: number }

const easeBack = (k: number) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();
  private sea = new Sea();
  private land = new Land();
  readonly fleet = new Fleet();
  readonly fx = new Fx();
  private crates = new Crates(PITCH);
  private aimMesh: THREE.Mesh;
  private mode: Mode = 'show';
  private world: World | null = null;
  private map: GameMap | null = null;
  private seen = new Map<number, Seen>();
  private colors: THREE.Color[] = [];
  private t = 0;
  private camAt = new THREE.Vector3();
  private camLead = new THREE.Vector3();
  private shake = 0;
  /** The bearing being aimed along, or null: drawn as a wedge from your ship. */
  aim: number | null = null;
  /** Aiming with no shot ready: the wedge goes red. */
  aimDry = false;
  /** The name screen's ship. */
  private show = { look: LOOKS[0].id, color: new THREE.Color(markOf(0).color), x: 0, y: 0, shift: 0 };
  private reduced = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(SEA.closed);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 5, 2000);

    // Lit so a sunlit face shows its own colour, just about, and the toon bands
    // (toon.ts) step down from there: a material's colour is what you see, not washed
    // out above it. Lambert divides by π; these add up to a little over π.
    const sun = new THREE.DirectionalLight('#FFF6E0', 2.3);
    sun.position.set(-50, 140, 70);
    const sky = new THREE.HemisphereLight('#FFFFFF', '#9CC6E6', 1.0);
    this.scene.add(sun, sky);

    this.aimMesh = new THREE.Mesh(wedge(), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    this.aimMesh.visible = false;
    this.aimMesh.renderOrder = 3;

    this.scene.add(this.sea.mesh, this.land.group, this.fleet.group, this.fx.group, this.crates.group, this.aimMesh);
    this.resize();
  }

  /* ------------------------------------------------------------ plumbing -- */

  private cssW = 1; private cssH = 1;
  private dprCap = 1;
  private dprScale = 1;

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.cssW = w; this.cssH = h;
    this.dprCap = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dprCap * this.dprScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.shiftView();
    inkWidth(this.mode === 'show' ? INK_SHOW : INK_SEA, h);
  }

  /** On the name screen the ship sits off to one side of the form. */
  private shiftView() {
    const { cssW: w, cssH: h } = this;
    const s = this.mode === 'show' ? this.show.shift : 0;
    if (s) {
      if (w > h) this.camera.setViewOffset(w, h, -w * s, 0, w, h);
      else this.camera.setViewOffset(w, h, 0, h * s, w, h);
    } else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // A phone that cannot hold its frame rate gets fewer pixels rather than fewer frames:
  // nearly all the cost here is per pixel (the sea above all). Measured only while a fight
  // is on screen, stepped down quickly, and back up only after a long run of good frames.
  private govLog: number[] = [];
  private govT = -3;
  private govGood = 0;
  private govern(dt: number) {
    this.govLog.push(dt);
    this.govT += dt;
    if (this.govT < 1.5) { if (this.govT < 0) this.govLog.length = 0; return; }
    const log = this.govLog.sort((a, b) => a - b);
    const med = log[log.length >> 1];
    this.govLog.length = 0;
    this.govT = 0;
    const floor = 0.75 / this.dprCap;
    if (med > 1 / 50 && this.dprScale > floor + 0.01) {
      this.dprScale = Math.max(floor, this.dprScale * 0.85);
      this.govGood = 0;
      this.resize();
    } else if (med < 1 / 57) {
      this.govGood += 1.5;
      if (this.govGood >= 8 && this.dprScale < 1) {
        this.dprScale = Math.min(1, this.dprScale * 1.12);
        this.govGood = 0;
        this.govT = -2;
        this.resize();
      }
    } else this.govGood = 0;
  }
  /** How many pixels the sea is drawn with, per CSS pixel. For the console. */
  get pixelRatio() { return this.renderer.getPixelRatio(); }

  setReduced(on: boolean) {
    this.reduced = on;
    this.fx.scale = on ? 0.5 : 1;
  }

  /* -------------------------------------------------------------- content -- */

  /** Load the ships' and the land's model files. Drawn without them until they come. */
  async loadModels() {
    const { loaderFor } = await import('./files');
    const loader = loaderFor(this.renderer);
    await Promise.all([
      this.fleet.load(loader),
      ...PROP_SETS.map(async (set) => {
        try {
          const gltf = await loader.loadAsync(set.url);
          const kit = propsFrom(gltf.scene, set.turn ?? 0);
          this.land.setProps(kit);
          if (kit.crate?.length) this.crates.setModel(kit.crate[0]);
        } catch (err) { console.warn('[land] could not load', set.url, err); }
      }),
    ]);
  }

  setMap(m: GameMap) {
    if (this.map === m) return;
    this.map = m;
    this.sea.setMap(m);
    this.land.setMap(m);
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.shiftView();
    inkWidth(mode === 'show' ? INK_SHOW : INK_SEA, this.cssH);
    this.snap = true;
  }
  private snap = true;

  /** The name screen's ship: her look, her colour (-1 plain canvas), and how far off
   *  centre she sits, as a share of the screen: across on a wide one, down on a tall one. */
  showcase(look: string, c: number, shift = 0.22) {
    this.show.look = look;
    this.show.color.set(c < 0 ? '#FFFFFF' : markOf(c).color);
    if (this.show.shift !== shift) { this.show.shift = shift; this.shiftView(); }
    if (this.map) {
      // in open water just off the middle island, so it is behind her
      const is = this.map.islands[0];
      const k = (is.r + 34) / Math.SQRT2;
      this.show.x = is.x + k; this.show.y = is.y + k;
    }
  }

  setWorld(w: World | null) {
    if (w === this.world) return;
    this.world = w;
    this.seen.clear();
    this.fx.clear();
    this.snap = true;
    if (w) this.setMap(w.map);
  }

  /** Each ship's colour, by id, from the roster. */
  setColors(cs: number[]) {
    this.colors = cs.map((c) => new THREE.Color(c < 0 ? '#FFFFFF' : markOf(c).color));
  }
  private colorOf(id: number) { return this.colors[id] ?? WHITE; }

  /** What just happened, as smoke and splashes. */
  consume(events: GameEvent[], w: World) {
    for (const e of events) {
      const p = typeof e.p === 'number' ? e.p : -1;
      const s = p >= 0 ? w.ships[p] : undefined;
      const mine = p === w.focus;
      switch (e.k) {
        case 'volley':
          if (s) this.fx.volley(e.x as number, e.y as number, s.h, e.side === 1 ? 1 : -1, e.a as number, !!e.heavy);
          if (mine) this.shake = Math.max(this.shake, 0.35);
          break;
        case 'splash': this.fx.splash(e.x as number, e.y as number); break;
        case 'thud':
          if (e.rock) this.fx.dust(e.x as number, e.y as number);
          else this.fx.hit(e.x as number, e.y as number);
          break;
        case 'hit': {
          const v = this.seen.get(p);
          if (v) v.hit = 1;
          if (mine) this.shake = Math.max(this.shake, 0.7);
          break;
        }
        case 'sunk':
          this.fx.sink(e.x as number, e.y as number);
          if (mine || e.by === w.focus) this.shake = Math.max(this.shake, 1);
          break;
        case 'take': this.fx.pop(e.x as number, e.y as number, CRATE_COLOR[e.kind as keyof typeof CRATE_COLOR] ?? WHITE, 10); break;
        default: break;
      }
    }
  }

  /* ---------------------------------------------------------------- frame -- */

  frame(dt: number, live: boolean) {
    this.t += dt;
    if (live && !this.reduced) this.govern(dt);
    const w = this.world;
    const ships: ShipDraw[] = [];
    if (this.mode === 'sea' && w) this.drawSea(w, dt, ships);
    else this.drawShow(ships);
    this.fleet.draw(ships, this.t);
    this.fx.frame(dt);
    this.sea.frame(this.t, this.mode === 'sea' && w ? w.R : 2000);
    this.moveCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private drawShow(out: ShipDraw[]) {
    const S = this.show;
    out.push({
      look: S.look, x: S.x, y: S.y, h: -0.6 + Math.sin(this.t * 0.25) * 0.5,
      heel: Math.sin(this.t * 0.9) * 0.05, pitch: Math.sin(this.t * 1.3) * 0.03, lift: Math.sin(this.t * 1.6) * 0.2,
      scale: 1, color: S.color, hit: 0, ring: 2, shine: false,
    });
    this.fx.balls([]);
    this.crates.hide();
    this.aimMesh.visible = false;
  }

  private drawSea(w: World, dt: number, out: ShipDraw[]) {
    const t = this.t;
    for (const s of w.ships) {
      let v = this.seen.get(s.id);
      if (!v) {
        v = { out: s.out, sinkT: SINK, popT: s.out ? 0 : POP, hit: 0, foam: 0, x: s.x, y: s.y, h: s.h, heel: 0 };
        this.seen.set(s.id, v);
      }
      const color = this.colorOf(s.id);
      if (s.out && !v.out) { v.sinkT = s.left ? SINK : 0; }
      if (!s.out && v.out) {
        v.popT = 0;
        this.fx.pop(s.x, s.y, color);
        // back in the sea: the camera cuts to her, rather than sweeping across it
        if (s.id === w.focus) this.snap = true;
      }
      v.out = s.out;
      v.hit = Math.max(0, v.hit - dt * 4);
      if (s.out) {
        v.sinkT += dt;
        if (v.sinkT >= SINK) continue;
        // going down where she was hit: settling by the head, rolling over
        const k = v.sinkT / SINK;
        out.push({ look: s.look, x: v.x, y: v.y, h: v.h, heel: v.heel + k * 0.8, pitch: -k * 0.35, lift: -k * k * 9, scale: 1, color, hit: 0, ring: 0, shine: false });
        continue;
      }
      v.popT = Math.min(POP, v.popT + dt);
      v.x = s.x; v.y = s.y; v.h = s.h;
      // she leans out of a turn, the way a cartoon ship would, and bobs on the swell
      v.heel += (Math.max(-0.32, Math.min(0.32, -s.rot * 0.13)) - v.heel) * Math.min(1, dt * 6);
      const scale = v.popT < POP ? Math.max(0.01, easeBack(v.popT / POP)) : 1;
      out.push({
        look: s.look, x: s.x, y: s.y, h: s.h,
        heel: v.heel + Math.sin(t * 1.8 + s.id * 1.3) * 0.03,
        pitch: Math.sin(t * 1.3 + s.id) * 0.03 - Math.max(0, s.v) * 0.002,
        lift: Math.sin(t * 1.6 + s.id * 2.1) * 0.18,
        scale, color, hit: v.hit,
        ring: s.id === w.focus ? 2 : 1,
        shine: s.invuln > 0 && Math.floor(t * 8) % 2 === 0,
      });
      // foam: a trail from her stern, and a little off her bow
      v.foam -= dt;
      if (s.v > 3 && v.foam <= 0) {
        v.foam = 0.08;
        const fx = Math.cos(s.h), fy = Math.sin(s.h), k = s.v / TUNING.speed;
        this.fx.wake(s.x - fx * s.len * 0.45, s.y - fy * s.len * 0.45, 1 + k * 1.3);
        this.fx.wake(s.x + fx * s.len * 0.36 - fy * 2.8, s.y + fy * s.len * 0.36 + fx * 2.8, 0.5 + k * 0.6);
        this.fx.wake(s.x + fx * s.len * 0.36 + fy * 2.8, s.y + fy * s.len * 0.36 - fx * 2.8, 0.5 + k * 0.6);
      }
    }
    this.fx.balls(w.shots);

    this.crates.draw(w.crates, t, easeBack);

    // the aim, from your own ship
    const me = w.ships[w.focus];
    if (this.aim != null && me && !me.out) {
      this.aimMesh.visible = true;
      this.aimMesh.position.set(me.x, 0.2, me.y);
      this.aimMesh.rotation.y = -this.aim;
      (this.aimMesh.material as THREE.MeshBasicMaterial).color.set(this.aimDry ? '#FF6B5A' : '#FFFFFF');
    } else this.aimMesh.visible = false;
  }

  /* --------------------------------------------------------------- camera -- */

  /** How far back the camera stands for this screen's shape, so a phone held sideways sees
   *  about the same sea whatever its size. */
  private distance() {
    const a = this.camera.aspect, tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    const up = SEE_UP / (tan * (1 / Math.sin(PITCH)));
    const side = SEE_SIDE / (tan * a);
    return Math.max(up, side);
  }

  private moveCamera(dt: number) {
    const w = this.world;
    let look: THREE.Vector3, pos: THREE.Vector3;
    if (this.mode === 'sea' && w) {
      const me = w.ships[w.focus];
      const target = new THREE.Vector3(this.camAt.x, 0, this.camAt.z);
      if (me && !me.out) {
        // a little ahead of her, so there is more sea where she is going
        this.camLead.lerp(new THREE.Vector3(Math.cos(me.h) * me.v * 0.7, 0, Math.sin(me.h) * me.v * 0.7), 1 - Math.exp(-dt * 2));
        target.set(me.x + this.camLead.x, 0, me.y + this.camLead.z);
      } else if (!me) target.set(0, 0, 0);
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 6);
      this.camAt.lerp(target, k);
      look = this.camAt.clone();
      const d = this.distance();
      pos = look.clone().add(new THREE.Vector3(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d));
    } else {
      const S = this.show;
      look = new THREE.Vector3(S.x, 4, S.y);
      this.camAt.copy(look);
      const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
      const d = Math.max(62, 26 / (tan * Math.min(1, this.camera.aspect)));
      pos = look.clone().add(new THREE.Vector3(d * 0.42, d * 0.5, d * 0.76));
    }
    this.snap = false;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 1.6;
    if (sh > 0.001 && !this.reduced) pos.add(new THREE.Vector3(Math.sin(this.t * 61) * sh, 0, Math.cos(this.t * 53) * sh));
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  /* -------------------------------------------------------------- readers -- */

  /** Screen coordinates, in CSS pixels, of a point in the world; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number; on: boolean } | null {
    const v = this.projV.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const W = this.cssW, H = this.cssH;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }
  private projV = new THREE.Vector3();

  /** Where on the sea a point on the screen is: for aiming with a mouse. */
  seaAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const v = new THREE.Vector3((clientX / this.cssW) * 2 - 1, -(clientY / this.cssH) * 2 + 1, 0.5).unproject(this.camera);
    const dir = v.sub(this.camera.position).normalize();
    if (dir.y >= -1e-3) return null;
    const k = -this.camera.position.y / dir.y;
    return { x: this.camera.position.x + dir.x * k, y: this.camera.position.z + dir.z * k };
  }

  /** How tall a look stands, for the name over her. */
  heightOf(look: string) { return this.fleet.height(look); }

  info() { return this.renderer.info; }
}

const WHITE = new THREE.Color(1, 1, 1);

/** The aim: a long wedge from her side out to where her balls drop, as wide as the volley spreads. */
function wedge(): THREE.BufferGeometry {
  const L = TUNING.range, w0 = 2.5, w1 = Math.tan(TUNING.spread) * L + 3, x0 = 6;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, 0, -w0, L, 0, -w1, L, 0, w1,
    x0, 0, -w0, L, 0, w1, x0, 0, w0,
  ], 3));
  g.computeVertexNormals();
  return g;
}
