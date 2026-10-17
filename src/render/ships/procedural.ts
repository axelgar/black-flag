// Ships from recipes. Every ship in the game — the Jackdaw, the Spanish line, the
// legendaries — is lofted from her HullRecipe by the same shipwright:
//
//   form.ts   her lines: the hull as a function of how far along and how high
//   hull.ts   planking, paint, decks, castles, gun ports, stern, head, deck furniture
//   rig.ts    masts, yards, canvas and rigging
//   paint.ts  the timber and canvas textures, painted once at start-up
//   materials.ts  the four shaders she is drawn with
//
// Geometry is built once per recipe and shared by every ship of that recipe; each ship
// on the water owns only her materials, so she can open her ports, burn, rag her canvas
// and strike her colours on her own. She is five draws: timber, canvas, rope, colours,
// pennants.

import * as THREE from 'three';
import type { FlagKind, HullRecipe } from '../../data/types';
import { flagTexture } from './flags';
import { Form } from './form';
import { buildHull, dress, portLayout, type Gun } from './hull';
import { buntingMaterial, canvasMaterial, lampGlow, ropeMaterial, ropePixel, ropeShade, shipTime, timberMaterial } from './materials';
import { LOD, Mesh } from './mesh';
import { canvas as paintCanvas, timber as paintTimber } from './paint';
import { Canvas, Ropes, buildRig } from './rig';
import type { ShipModel, ShipPose } from './ShipModel';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------ settings ---- */

let quality = { high: true, aniso: 4 };
let timberTex: THREE.Texture | null = null;
let canvasTex: THREE.Texture | null = null;

/** Set before the first ship is built: map sizes, bump and soft canvas edges depend on it. */
export function shipQuality(high: boolean, aniso: number) {
  quality = { high, aniso: Math.min(aniso, high ? 8 : 2) };
  LOD.lo = !high;
}

/** Build every hull the sea might need, one per idle moment, so the first sight of a
 *  man-o-war is not also a dropped frame. */
export function prewarmShips(recipes: HullRecipe[]) {
  const queue = [...recipes];
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 40));
  const next = () => {
    const R = queue.shift();
    if (!R) return;
    kit(R);
    idle(next);
  };
  setTimeout(() => idle(next), 600);
}

/** The shipwright's timber and canvas, painted on first use and shared with the land. */
export function textures() {
  timberTex ??= paintTimber(quality.high ? 1024 : 512, quality.aniso);
  canvasTex ??= paintCanvas(quality.high ? 1024 : 512, quality.aniso);
  return { timber: timberTex, canvas: canvasTex };
}

/** Every flag, sail and ripple reads one clock. */
export const setShipTime = (t: number) => { shipTime.value = t; };
/** The rope shader keeps a line a pixel wide; it needs to know how big a pixel is. */
export function setShipView(fovDeg: number, heightPx: number) {
  ropePixel.value = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}
/** How lit the lanterns are, and the light the rigging is seen in. */
export function setShipLights(lamp: number, shade: THREE.Color) {
  lampGlow.value = lamp;
  ropeShade.value.copy(shade);
}

/* ----------------------------------------------------------------- kit ---- */

interface Kit {
  solid: THREE.BufferGeometry;
  sails: THREE.BufferGeometry | null;
  ropes: THREE.BufferGeometry;
  flags: THREE.BufferGeometry;
  pennants: THREE.BufferGeometry | null;
  guns: Gun[];
  height: number;
  form: Form;
}

const kits = new Map<string, Kit>();

export interface Flag { at: THREE.Vector3; w: number; h: number; ph: number }

/** Flags, streaming aft from their hoists. UVs put the hoist at the canvas's left edge. */
export function bunting(list: Flag[]): THREE.BufferGeometry {
  const P: number[] = [], U: number[] = [], F: number[] = [], I: number[] = [];
  const NX = 12, NY = 4;
  for (const fl of list) {
    const base = P.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const u = i / NX, v = j / NY;
        P.push(fl.at.x - u * fl.w, fl.at.y - (1 - v) * fl.h, fl.at.z);
        U.push(u, v);
        F.push(u * fl.w, fl.ph);
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i;
        I.push(a, a + 1, a + NX + 2, a, a + NX + 2, a + NX + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aFly', new THREE.Float32BufferAttribute(F, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Long tapering masthead pennants in her own colour. */
function pennants(list: { at: THREE.Vector3; len: number; w: number; ph: number }[], color: string): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [], F: number[] = [], I: number[] = [];
  const c = new THREE.Color(color), NX = 16;
  for (const pn of list) {
    const base = P.length / 3;
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, w = pn.w * (1 - 0.9 * u);
      const x = pn.at.x - u * pn.len;
      P.push(x, pn.at.y, pn.at.z, x, pn.at.y - w, pn.at.z);
      C.push(c.r, c.g, c.b, c.r, c.g, c.b);
      F.push(u * pn.len, pn.ph, u * pn.len, pn.ph);
    }
    for (let i = 0; i < NX; i++) {
      const a = base + i * 2;
      I.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aFly', new THREE.Float32BufferAttribute(F, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

function kit(R: HullRecipe): Kit {
  const key = JSON.stringify(R);
  const hit = kits.get(key);
  if (hit) return hit;

  const f = new Form(R), d = dress(R);
  const m = new Mesh(), cv = new Canvas(), rp = new Ropes();
  const hull = buildHull(m, f, d);
  const emblem = R.emblem ?? (R.flag === 'spain' ? 'cross' : 'none');
  const rig = buildRig(m, cv, rp, f, d, emblem);

  // Her colours at the main truck and on the ensign staff; pennants on the other heads.
  const fs = Math.max(1.6, R.length * 0.1);
  const main = rig.trucks[rig.main];
  const flags: Flag[] = [{ at: main.clone().add(new THREE.Vector3(-0.15, -0.3, 0)), w: fs * 1.5, h: fs, ph: 0 }];
  if (hull.ensign) flags.push({ at: hull.ensign.clone().add(new THREE.Vector3(-0.05, -0.1, 0)), w: fs * 1.15, h: fs * 0.77, ph: 1.7 });
  const pn = rig.trucks.filter((_, i) => i !== rig.main).map((p, i) => ({
    at: p.clone().add(new THREE.Vector3(-0.1, -0.2, 0)), len: R.length * 0.2, w: 0.35 + R.length * 0.006, ph: 2.3 + i * 1.9,
  }));

  const k: Kit = {
    solid: m.geometry(),
    sails: cv.count ? cv.geometry() : null,
    ropes: rp.geometry(),
    flags: bunting(flags),
    pennants: pn.length ? pennants(pn, R.palette.trim) : null,
    guns: hull.guns,
    height: rig.height,
    form: f,
  };
  kits.set(key, k);
  return k;
}

/** A hull material already in her going-away variant, never drawn: the view compiles its
 *  program at start-up, so the first prize to escape does not stall a frame to build it. */
export function fadeWarmers(): THREE.Object3D {
  const m = timberMaterial(textures().timber, quality.high);
  m.defines = { ...m.defines, BF_FADE: '' };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
  mesh.frustumCulled = false;
  return mesh;
}

/** Triangles and vertices a recipe costs, for the console. */
export function kitStats(R: HullRecipe) {
  const k = kit(R);
  const tris = (g: THREE.BufferGeometry | null) => (!g ? 0 : g.index ? g.index.count / 3 : g.attributes.position.count / 3);
  return { solid: tris(k.solid), sails: tris(k.sails), ropes: tris(k.ropes), flags: tris(k.flags) + tris(k.pennants) };
}

/* ---------------------------------------------------------------- ship ---- */

export class ProceduralShip implements ShipModel {
  root = new THREE.Group();
  len: number; beam: number; height: number;
  private kit: Kit;
  private timber: ReturnType<typeof timberMaterial>;
  private canvas: ReturnType<typeof canvasMaterial> | null = null;
  private solid: THREE.Mesh;
  private sails: THREE.Mesh | null = null;
  private ropes: THREE.Mesh;
  private flag: THREE.Mesh;
  private pennant: THREE.Mesh | null = null;
  private flagKind: FlagKind;
  private weak: THREE.Mesh[] = [];
  private tatter: number;
  private lastT = -1;
  private lids = 0;
  private lidsWant = 0;
  private run: [number, number] = [0, 0];
  private glow: [number, number] = [0, 0];
  private glowWant: [number, number] = [0, 0];

  constructor(R: HullRecipe, weakPoints?: { fwd: number; side: -1 | 1 }[]) {
    const K = this.kit = kit(R);
    const tex = textures();
    this.len = R.length; this.beam = R.beam; this.height = K.height;
    this.flagKind = R.flag;
    this.tatter = R.tatter ?? 0;
    this.root.rotation.order = 'YZX';

    this.timber = timberMaterial(tex.timber, quality.high);
    this.solid = new THREE.Mesh(K.solid, this.timber);
    this.root.add(this.solid);

    if (K.sails) {
      const emblem = R.emblem ?? (R.flag === 'spain' ? 'cross' : 'none');
      const ink = R.ink ?? (emblem === 'cross' ? '#A5282B' : '#17130F');
      this.canvas = canvasMaterial(tex.canvas, R.palette.sail, ink, quality.high);
      this.sails = new THREE.Mesh(K.sails, this.canvas.mat);
      this.sails.customDepthMaterial = this.canvas.depth;
      this.root.add(this.sails);
    }

    this.ropes = new THREE.Mesh(K.ropes, ropeMaterial());
    this.ropes.renderOrder = 1;
    this.root.add(this.ropes);

    this.flag = new THREE.Mesh(K.flags, buntingMaterial(this.flagKind, flagTexture(this.flagKind)));
    this.root.add(this.flag);
    if (K.pennants) {
      this.pennant = new THREE.Mesh(K.pennants, buntingMaterial('pennant', null));
      this.root.add(this.pennant);
    }

    if (weakPoints) {
      const f = K.form, P = portLayout(f);
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF5A36').multiplyScalar(2.5) });
      for (const p of weakPoints) {
        const t = clamp(p.fwd / R.length + 0.5, 0.05, 0.95);
        const y = f.band(t, P.decks.length ? P.decks[P.decks.length - 1] : f.F * 0.55);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.4, 0.3), wm);
        mesh.position.set(p.fwd, y, p.side * (f.hb(t, y) + 0.3));
        this.root.add(mesh);
        this.weak.push(mesh);
      }
    }
  }

  gunPorts(side: -1 | 1) {
    return this.kit.guns.filter((g) => g.side === side).map((g) => g.muzzle);
  }

  pose(p: ShipPose) {
    const dt = this.lastT < 0 ? 0 : clamp(p.t - this.lastT, 0, 0.1);
    this.lastT = p.t;
    this.root.position.set(p.x, p.heave, p.z);
    this.root.rotation.set(p.roll, -p.h, p.pitch);

    if (this.canvas) {
      const u = this.canvas.u;
      u.uFill.value += (p.fill - u.uFill.value) * Math.min(1, dt * 5);
      // shot rags her canvas, a little at first and then all at once
      u.uTatter.value = Math.min(0.7, this.tatter + Math.pow(p.damage, 1.3) * 0.5);
    }
    const want: FlagKind = p.struck ? 'white' : this.flagKind;
    const fm = buntingMaterial(want, flagTexture(want));
    if (this.flag.material !== fm) this.flag.material = fm;
    this.timber.userData.u.uScorch.value = clamp(p.damage * 1.05, 0, 1);

    // ports open and guns run out, slowly — they are heavy — and snap back when she fires
    this.lids += clamp(this.lidsWant - this.lids, -dt * 1.4, dt * 1.4);
    for (let i = 0; i < 2; i++) {
      const out = this.lids > 0.85 ? 1 : 0;
      this.run[i] = Math.min(this.lids, this.run[i] + (out - this.run[i] > 0 ? dt * 0.7 : -dt * 2));
      this.glow[i] += (this.glowWant[i] - this.glow[i]) * Math.min(1, dt * 6);
    }
    const ease = (v: number) => v * v * (3 - 2 * v);
    this.timber.userData.u.uPorts.value.set(ease(this.lids), ease(this.lids), ease(this.run[0]), ease(this.run[1]));
    this.timber.userData.u.uGlow.value.set(this.glow[0], this.glow[1]);
  }

  /** Clear for action: lids up and guns run out. */
  ready(on: boolean) { this.lidsWant = on ? 1 : 0; }

  /** A side has fired: its guns recoil in and are run out again. */
  fired(side: -1 | 1) { this.run[side === -1 ? 0 : 1] = 0; }

  /** Open (or close) a side's lit ports — the frigate's tell. */
  portsOpen(side: -1 | 1, open: boolean) {
    this.glowWant[side === -1 ? 0 : 1] = open ? 1 : 0;
    if (open) this.lidsWant = 1;
  }

  weakPoints(alive: boolean[]) {
    this.weak.forEach((m, i) => { m.visible = alive[i] ?? false; });
  }

  /** Far off, her rigging is below a pixel's worth of anything; on a phone it fades to a
   *  fifth of a pixel by 260m, and her pennants to a streak by 420m. Each is a draw, and a
   *  full shared sea puts thirty ships in front of the eye at once. */
  detail(distance: number) {
    const lo = !quality.high;
    this.ropes.visible = distance < (lo ? 260 : 520) && this.faded > 0.55;
    if (this.pennant) this.pennant.visible = this.faded > 0.35 && (!lo || distance < 420);
  }

  /** Going, 1..0: she dissolves into the haze. Her lines and colours go first — they are
   *  too fine to dither — and a ship that is half there casts no shadow. The hull only
   *  takes the dissolving variant of its shader once she starts to go: a discard in every
   *  hull's shader would cost every ship afloat the GPU's early depth rejection. */
  private faded = 1;
  fade(k: number) {
    if (k === this.faded) return;
    if (k < 1 && this.faded >= 1) { this.timber.defines = { ...this.timber.defines, BF_FADE: '' }; this.timber.needsUpdate = true; }
    this.faded = k;
    this.timber.userData.u.uFade.value = k;
    if (this.canvas) this.canvas.u.uFade.value = k;
    if (k <= 0.55) this.ropes.visible = false;
    this.flag.visible = k > 0.35;
    if (this.pennant) this.pennant.visible = k > 0.35;
    for (const m of this.weak) if (k < 1) m.visible = false;
    if (k < 1 && this.solid.castShadow) this.setShadows(false);
  }

  /** How much the fog takes of her: the player's own ship stays readable in it. */
  fog(k: number) {
    this.timber.userData.u.uFogK.value = k;
    if (this.canvas) this.canvas.u.uFogK.value = k;
  }

  setShadows(on: boolean) {
    this.solid.castShadow = this.solid.receiveShadow = on;
    if (this.sails) this.sails.castShadow = this.sails.receiveShadow = on;
  }

  dispose() {
    // Geometry is shared through the kit cache; only this ship's own materials go.
    this.timber.dispose();
    this.canvas?.mat.dispose();
    this.canvas?.depth.dispose();
    for (const m of this.weak) m.geometry.dispose();
    if (this.weak.length) (this.weak[0].material as THREE.Material).dispose();
  }
}
