// The paint. Owns the WebGL renderer and everything on the water, reads a world snapshot
// every frame and never writes to it. The simulation does not know this file exists.
//
// Modes are camera and scenery, not screens: 'title' and 'shipyard' orbit a ship at
// anchor off Nassau, 'port' looks at the town from the harbour, 'play' is the chase, and
// 'watch' is the bar's screen: the whole chart from high in the south, every captain
// ringed in her own mark.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { angleTo, clamp } from '../core/vec';
import { CLASSES } from '../data/enemies';
import { LEGENDS } from '../data/legends';
import { SHIPS, shipById } from '../data/ships';
import { recipeOf } from '../data/upgrades';
import type { HullRecipe } from '../data/types';
import { MAP_R, type GameMap } from '../sim/map';
import { markOf } from '../data/colors';
import { sideVec } from '../sim/combat';
import { theirs, you, type Foe, type GameEvent, type Player, type World } from '../sim/types';
import { Air, type Look } from './atmosphere';
import { Flotsam } from './flotsam';
import { Fx } from './fx';
import { Islands } from './islands';
import { Markers } from './markers';
import { Ocean } from './ocean';
import { Sky } from './sky';
import { Wakes } from './wakes';
import { heightAt, ride } from './waves';
import { ProceduralShip, fadeWarmers, prewarmShips, setShipLights, setShipTime, setShipView, shipQuality } from './ships/procedural';
import type { ShipModel } from './ships/ShipModel';
import { STRIKE_WINDOW, BOARD_TIME, ESCAPE_TIME } from '../sim/combat';

export type Mode = 'title' | 'shipyard' | 'port' | 'play' | 'watch' | 'none';
export type Tier = 'low' | 'high';

export function detectTier(): Tier {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse || cores <= 4 || mem <= 4) return 'low';
  return 'high';
}

function modelFor(R: HullRecipe, weak?: { fwd: number; side: -1 | 1 }[]): ShipModel {
  return new ProceduralShip(R, weak);
}

interface Hulk { m: ShipModel; t: number; x: number; z: number; h: number; boarded: boolean }

const WHITE = new THREE.Color(1, 1, 1);
const ORIGIN = new THREE.Vector3();
const FOV = 42;
// The bar's screen: a long lens from far off, so the far side of the chart is not squashed
// small behind the near, looking down steeply enough to see between the islands.
const WATCH_FOV = 30;
const WATCH_PITCH = 1.08;          // radians below the horizon, about 62°
const RING = 0.021;                // a captain's ring, at the least: this share of the screen's height
// past the chart's rim, seen from the bar's screen: the night round a lit table
const NIGHT = new THREE.Color('#061219');

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  air = new Air();
  tier: Tier;
  reduced = false;

  private ocean: Ocean;
  private sky: Sky;
  private islands = new Islands();
  private fx = new Fx();
  private flotsam: Flotsam;
  private wakes = new Wakes();
  private marks = new Markers();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envLook: Look | null = null;
  private balls: THREE.InstancedMesh;
  private shells: THREE.InstancedMesh;

  private map: GameMap | null = null;
  world: World | null = null;
  mode: Mode = 'none';

  private player: ShipModel | null = null;
  private playerShip = '';
  private foes = new Map<number, ShipModel>();
  /** Every other captain's ship on a shared sea, by her id, and which ship each was built as. */
  private crew = new Map<number, ShipModel>();
  private crewShip = new Map<number, string>();
  private hulks: Hulk[] = [];
  private showcase: ShipModel | null = null;
  private showcaseId = '';

  private camPos = new THREE.Vector3(0, 60, 200);
  private camLook = new THREE.Vector3();
  private camYaw = Math.PI / 2;
  private shakeAmp = 0;
  private flashEl: HTMLElement | null;
  private flash = 0;
  private lightning = 0;
  private orbit = 2.3;
  private shade = new THREE.Color();
  private seaT = 0;
  private dragYaw = 0;

  constructor(canvas: HTMLCanvasElement, tier: Tier) {
    this.tier = tier;
    const high = tier === 'high';
    // No multisampling on the canvas itself: on 'high' everything is drawn into the
    // composer's own multisampled target (below) and the canvas only takes the finished
    // picture, and on 'low' it is fill rate a phone does not have.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    // Checking every shader's log as it links makes each compile block until it is done.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    canvas.addEventListener('webglcontextrestored', () => { this.envLook = null; });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    shipQuality(high, this.renderer.capabilities.getMaxAnisotropy());
    prewarmShips([...SHIPS.map(recipeOf), ...Object.values(CLASSES).map((c) => c.recipe), ...LEGENDS.map((l) => l.recipe)]);
    this.scene.fog = new THREE.Fog('#CFE0DF', 380, 1500);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 5000);

    this.sun = new THREE.DirectionalLight('#fff', 2);
    this.sun.castShadow = high;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    this.hemi = new THREE.HemisphereLight('#bde', '#245', 1);
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.ocean = new Ocean(high);
    this.sky = new Sky(high);
    this.flotsam = new Flotsam(high);
    this.scene.add(this.sky.mesh, this.ocean.mesh, this.islands.group, this.wakes.mesh, this.marks.group, this.fx.group, this.flotsam.group);
    this.fx.scale = high ? 1 : 0.6;

    const ballGeo = new THREE.SphereGeometry(0.55, 8, 6);
    this.balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#1B1916', roughness: 0.4, metalness: 0.6 }), 600);
    this.balls.count = 0; this.balls.frustumCulled = false;
    this.shells = new THREE.InstancedMesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#15130F', roughness: 0.5, metalness: 0.5 }), 64);
    this.shells.count = 0; this.shells.frustumCulled = false;
    this.scene.add(this.balls, this.shells);

    if (high) {
      // Its own target, multisampled: the composer's default has none, which left 'high'
      // with no antialiasing at all and alpha-to-coverage (the palm fronds, the sails'
      // ragged edges) with nothing to cover.
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.9);
      // A NaN anywhere in the picture is one bad pixel — until bloom blurs it down its mips
      // into black squares the size of a town. The bright-pass drops them at the door.
      const hp = bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('gl_FragColor = mix( outputColor, texel, alpha );',
        'gl_FragColor = mix( outputColor, texel, alpha );\n\t\t\tif ( any( isnan( gl_FragColor ) ) || any( isinf( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );');
      hp.needsUpdate = true;
      this.composer.addPass(bloom);
      this.composer.addPass(new OutputPass());
    }
    this.flashEl = typeof document !== 'undefined' ? document.getElementById('flash') : null;
    this.resize();
    this.refreshEnv(0);
    this.prewarm();
  }

  /**
   * Compile every program the sea will need before it is needed. Rings, the reticle, the
   * cargo, the spouts, the shells and the rest are only put on screen when something
   * happens, and a shader compiled on the frame a squadron first sees you is a hitch at
   * the worst possible moment on a phone. Everything is shown for the one call that
   * gathers the programs — they compile off the main thread where the browser can — and
   * hidden again straight after.
   */
  private prewarm() {
    const M = this.marks, shown: THREE.Object3D[] = [];
    for (const pool of [M.foeRings, M.ownRings, M.prizeRings, M.captainRings]) { pool.begin(); pool.get(); }
    M.warm();
    this.warmers ??= fadeWarmers();
    this.scene.add(this.warmers);
    this.scene.traverse((o) => { if (!o.visible) { o.visible = true; shown.push(o); } });
    this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
    for (const o of shown) o.visible = false;
    this.scene.remove(this.warmers!);
    for (const pool of [M.foeRings, M.ownRings, M.prizeRings, M.captainRings]) { pool.begin(); pool.end(); }
  }
  /** Things that exist only to have their programs compiled early, and are never drawn. */
  private warmers: THREE.Object3D | null = null;

  /* ------------------------------------------------------------ plumbing -- */

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.cssW = w; this.cssH = h;
    this.dprCap = Math.min(window.devicePixelRatio || 1, this.tier === 'high' ? 2 : 1.5);
    const dpr = this.dprCap * this.dprScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setViewport(h * dpr, this.camera.fov);
    setShipView(this.camera.fov, h * dpr);
  }

  /* --------------------------------------------------------- resolution -- */

  // A phone that cannot hold its frame rate gets fewer pixels rather than fewer frames:
  // nearly all the cost here is per pixel (the sea above all), and 1.5 → 1.1 halves it.
  // Measured only while a fight is being sailed — behind the menus it idles at 30 on
  // purpose — stepped down quickly, and back up only after a long run of good frames.
  private cssW = 1; private cssH = 1;
  private dprCap = 1;
  private dprScale = 1;
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
    const floor = (this.tier === 'high' ? 1 : 0.75) / this.dprCap;
    if (med > 1 / 50 && this.dprScale > floor + 0.01) {
      this.dprScale = Math.max(floor, this.dprScale * 0.85);
      this.govGood = 0;
      this.resize();
    } else if (med < 1 / 57) {
      this.govGood += 1.5;
      if (this.govGood >= 8 && this.dprScale < 1) {
        this.dprScale = Math.min(1, this.dprScale * 1.12);
        this.govGood = 0;
        this.govT = -2;               // let it settle before judging the new size
        this.resize();
      }
    } else {
      this.govGood = 0;
    }
  }
  /** How many pixels the sea is drawn with, per CSS pixel. For the console. */
  get pixelRatio() { return this.renderer.getPixelRatio(); }

  setReduced(on: boolean) {
    this.reduced = on;
    this.fx.scale = (this.tier === 'high' ? 1 : 0.6) * (on ? 0.5 : 1);
  }

  setLook(look: Look, snap = false) {
    if (snap) this.air.snap(look); else this.air.set(look);
    // rain is drawn round the camera's mark: from as high as the bar's screen, a smudge
    this.fx.rain.on = look === 'storm' && !this.reduced && this.mode !== 'watch';
  }

  /** The seed of the chart the islands are built from, if any yet. */
  get chart(): string | null { return this.map?.seed ?? null; }

  /** The chart the islands and shallows are built from. */
  setMap(m: GameMap) {
    if (this.map === m) return;
    this.map = m;
    this.islands.build(m, this.tier === 'high', Math.min(this.tier === 'high' ? 8 : 2, this.renderer.capabilities.getMaxAnisotropy()));
    this.ocean.bakeShore(m);
    const h = m.harbour;
    this.marks.beacon.position.set(h.x, 0.3, h.y);
    const ring = this.marks.beacon.getObjectByName('ring')!;
    ring.scale.setScalar(h.r);
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (mode !== 'play') this.marks.beacon.visible = false;
    if ((mode === 'watch') !== (was === 'watch')) this.lens(mode === 'watch');
    if (was === 'none' || mode === 'watch' || was === 'watch') this.snapCamera();
  }

  /* ---------------------------------------------------- the bar's screen -- */

  /** On the bar's screen, the share of the width on the right kept clear for the standings. */
  watchRoom = 0.3;
  /** How long a captain who goes down is out, seconds: her ring counts her back. */
  refloatIn = 5;
  private watchMarks = new Map<number, number>();
  private downAt = new Map<number, number>();
  private watchFit = { key: '', d: 3000, ahead: 0 };

  /** Each captain's mark (data/colors.ts), by her place in the world. */
  setMarks(marks: Map<number, number>) { this.watchMarks = marks; }

  /** The bar's screen looks through a long lens from high up, everything else through the
   *  chase's; the shadows stretch over whatever each one sees. */
  private lens(watch: boolean) {
    const c = this.camera;
    c.fov = watch ? WATCH_FOV : FOV;
    if (!watch) { c.near = 0.5; c.far = 5000; c.filmOffset = 0; }
    this.watchFit.key = '';
    const sc = this.sun.shadow.camera, half = watch ? MAP_R + 80 : 110;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.far = watch ? 6000 : 600;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = watch ? 1.5 : 0.4;
    this.fx.rain.on = !watch && this.air.look === 'storm' && !this.reduced;
    this.resize();
  }

  /**
   * Where the bar's screen looks from: as close as the whole chart allows, with the chart
   * centred top to bottom in the frame and, across it, in the part the standings leave
   * free. A circle looks the same from any bearing, so the sway round it keeps the fit.
   */
  private fitWatch() {
    const c = this.camera, room = clamp(this.watchRoom, 0, 0.5), f = this.watchFit;
    const key = `${c.aspect.toFixed(4)}:${room.toFixed(3)}`;
    if (f.key === key) return f;
    const cam = new THREE.PerspectiveCamera(WATCH_FOV, c.aspect, 1, 50000), v = new THREE.Vector3();
    const R = MAP_R + 25, P = WATCH_PITCH;
    const span = (d: number, ahead: number) => {
      cam.position.set(0, Math.sin(P) * d, ahead + Math.cos(P) * d);
      cam.lookAt(0, 0, ahead);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        v.set(Math.cos(a) * R, 0, Math.sin(a) * R).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 };
    };
    // the mark the camera looks at slides north or south until the chart sits centred
    const centre = (d: number) => {
      let lo = -R, hi = R;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (span(d, m).cy > 0) hi = m; else lo = m; }
      return (lo + hi) / 2;
    };
    const wide = 2 * (1 - room) - 0.06, tall = 2 - 0.08;
    let lo = 200, hi = 40000;
    for (let i = 0; i < 28; i++) {
      const d = (lo + hi) / 2, s = span(d, centre(d));
      if (s.w <= wide && s.h <= tall) hi = d; else lo = d;
    }
    f.d = hi; f.ahead = centre(hi); f.key = key;
    // the nearest water is a long way off: a near plane out there keeps the rings, a hand's
    // breadth above the swell, from sinking into it
    c.near = hi * 0.35; c.far = hi * 2.2;
    c.filmOffset = room * c.aspect * Math.tan(THREE.MathUtils.degToRad(WATCH_FOV / 2)) * c.getFilmWidth();
    c.updateProjectionMatrix();
    return f;
  }

  /** How many metres of sea a CSS pixel covers where the camera is looking. */
  metresPerPixel() {
    return (2 * this.camera.position.distanceTo(this.camLook) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.cssH;
  }

  /** A captain's ring on the bar's screen, metres: round her hull, and never too small to see. */
  ringOf(o: Player) { return Math.max(o.len * 0.75, this.metresPerPixel() * this.cssH * RING); }

  setWorld(w: World | null) {
    if (w === this.world) return;
    this.world = w;
    for (const m of this.foes.values()) this.drop(m);
    this.foes.clear();
    for (const m of this.crew.values()) this.drop(m);
    this.crew.clear();
    this.crewShip.clear();
    for (const h of this.hulks) this.drop(h.m);
    this.hulks = [];
    this.fx.clear();
    this.wakes.clear();
    this.marks.clear();
    this.flotsam.clear();
    this.becalm();
    this.downAt.clear();
    this.govT = -3;
    if (w) {
      this.setMap(w.map);
      this.setLook(w.weather, true);
      this.setPlayerShip(you(w).shipId);
      this.camYaw = you(w).h;
      this.snapCamera();
    }
  }

  setPlayerShip(id: string) {
    if (this.playerShip === id && this.player) return;
    if (this.player) this.drop(this.player);
    this.playerShip = id;
    this.player = modelFor(recipeOf(shipById(id)));
    this.player.setShadows(this.tier === 'high');
    this.player.fog?.(0.35);
    this.scene.add(this.player.root);
  }

  /** The ship shown at anchor on the title, in the shipyard, and in an unlock reveal. */
  setShowcase(id: string | null) {
    if (id === this.showcaseId) return;
    if (this.showcase) this.drop(this.showcase);
    this.showcase = null;
    this.showcaseId = id || '';
    if (!id) return;
    this.showcase = modelFor(recipeOf(shipById(id)));
    this.showcase.setShadows(this.tier === 'high');
    this.scene.add(this.showcase.root);
  }

  /** Spin the showcase camera by a drag. */
  nudgeOrbit(d: number) { this.dragYaw += d; }

  /** For the console: put any recipe at anchor where the showcase ship rides, and look
   *  at her from `zoom` times closer. `bf.inspect('foe', 'frigate')`. */
  inspect(R: HullRecipe | null, zoom = 1) {
    if (this.showcase) this.drop(this.showcase);
    this.showcase = null;
    this.showcaseId = R ? `inspect:${JSON.stringify(R).length}` : '';
    this.zoom = zoom;
    if (!R) return;
    this.showcase = modelFor(R);
    this.showcase.setShadows(this.tier === 'high');
    this.scene.add(this.showcase.root);
  }
  zoom = 1;
  /** For the console: how shot up the showcase ship is, 0..1. */
  showDamage = 0;
  /** For the console: a camera at `pos` looking at `look`, both relative to the showcase
   *  ship's anchorage and in her frame (x forward, y up, z starboard). null to let go. */
  peek(pos: [number, number, number] | null, look: [number, number, number] = [0, 3, 0]) {
    this.peekAt = pos ? { pos, look } : null;
  }
  private peekAt: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  /** For the console: a camera anywhere, in world coordinates. null to let go. */
  eye(pos: [number, number, number] | null, look: [number, number, number] = [0, 0, 0]) {
    this.eyeAt = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) } : null;
  }
  private eyeAt: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** For the console: hold the showcase orbit still, at an angle. */
  orbitAt(a: number) { this.orbit = a; this.dragYaw = 0; this.spin = false; }
  private spin = true;

  private drop(m: ShipModel) {
    this.scene.remove(m.root);
    m.dispose();
  }

  whiteout(v: number, color = '#ffffff') {
    this.flash = Math.max(this.flash, v);
    if (this.flashEl) this.flashEl.style.setProperty('--flash-c', color);
  }

  shake(a: number) { if (!this.reduced) this.shakeAmp = Math.max(this.shakeAmp, a); }

  /* ------------------------------------------------------------- events -- */

  consume(events: GameEvent[], w: World) {
    const t = this.seaT;
    const Y = 2.2;
    for (const e of events) {
      const x = e.x as number, z = e.y as number;
      // Smoke and splashes are for everyone's ship; the shake and the flashes only for yours.
      // On the bar's screen, no ship is the screen's own.
      const other = this.mode === 'watch' || theirs(w, e);
      switch (e.k) {
        case 'cannon': {
          this.fx.muzzle(x, Y + 0.6, z, e.dx as number, e.dy as number);
          if (e.i === 0) {
            if (!other) this.shake(0.12);
            // which side fired: the shot's direction against her starboard beam
            const by = w.players[e.p as number] ?? you(w);
            const h = by.h, side = (e.dx as number) * -Math.sin(h) + (e.dy as number) * Math.cos(h) > 0 ? 1 : -1;
            (other ? this.crew.get(by.id) : this.player)?.fired?.(side);
          }
          break;
        }
        case 'bow': this.fx.muzzle(x, Y, z, Math.cos(e.h as number), Math.sin(e.h as number), 0.6); break;
        case 'foe-fire': this.foeFire(w, e); break;
        case 'thud': if (e.rock) this.fx.splash(x, z, t); else this.fx.thud(x, Y + 1, z); break;
        case 'splash': this.fx.splash(x, z, t); break;
        case 'boom': if (e.splash) this.fx.explode(x, heightAt(x, z, t), z, !!e.big, t); else this.fx.explode(x, 2, z, !!e.big, t);
          this.shake(e.big ? 0.9 : 0.35); break;
        case 'sunk': this.sink(e.id as number, !!e.boarded); break;
        case 'board': this.fx.sparkle(x, 4, z, 40); break;
        case 'take': this.fx.sparkle(x, 1, z, 16); break;
        case 'hit': this.fx.thud(x, Y + 1, z); if (!other) this.shake(0.4); break;
        case 'ram': this.fx.thud(x, Y, z); this.fx.wood.spawn(x, 2, z, 8, 6); if (!other) this.shake(0.6); break;
        case 'ground': this.fx.splash(x, z, t, true); if (!other) this.shake(0.5); break;
        case 'mortar': this.fx.muzzle(e.fromX as number, 4, e.fromY as number, 0, 0, 1.4); break;
        case 'mortar-in': this.fx.muzzle(x, 5, z, 0, 0, 1.4); break;
        case 'fireship': this.fx.explode(x, 2, z, true, t); this.shake(0.8); break;
        case 'port-down': this.fx.explode(x, 4, z, false, t); break;
        case 'refit': if (!other) this.whiteout(0.8); break;
        case 'dead': if (!other) this.whiteout(0.5, '#8E2B24'); if (typeof e.p === 'number') this.downAt.set(e.p, this.seaT); break;
        case 'refloat': if (typeof e.p === 'number') this.downAt.delete(e.p); break;
        case 'alert': { const m = this.foes.get(e.id as number); if (m) this.marks.alert(e.id as number, x, m.height + 6, z); break; }
        case 'legend-down': this.shake(1.4); this.whiteout(0.35, '#FFD36A'); break;
        default: break;
      }
    }
  }

  private foeFire(w: World, e: GameEvent) {
    const foe = w.foes.find((f) => f.id === e.id);
    const m = this.foes.get(e.id as number);
    if (!foe || !m) { this.fx.muzzle(e.x as number, 3, e.y as number, 0, 0); return; }
    const side = e.side as -1 | 1 | undefined;
    if (side) {
      m.fired?.(side);
      const ports = m.gunPorts(side);
      const [dx, dz] = sideVec(foe.h, side === 1 ? 1 : 0);
      const n = Math.min(ports.length, (e.n as number) || ports.length);
      for (let i = 0; i < n; i++) {
        const p = m.root.localToWorld(ports[Math.floor((i / n) * ports.length)].clone());
        this.fx.muzzle(p.x, p.y, p.z, dx, dz, e.big ? 1.3 : 1);
      }
    } else {
      const p = m.root.localToWorld(new THREE.Vector3(m.len * 0.4, 3, 0));
      this.fx.muzzle(p.x, p.y, p.z, Math.cos(foe.h), Math.sin(foe.h), 0.8);
    }
  }

  private sink(id: number, boarded: boolean) {
    const m = this.foes.get(id);
    if (!m) return;
    this.foes.delete(id);
    const r = m.root;
    this.hulks.push({ m, t: 0, x: r.position.x, z: r.position.z, h: -r.rotation.y, boarded });
  }

  /* -------------------------------------------------------------- frame --- */

  frame(dt: number, live = false) {
    if (live && this.mode === 'play') this.govern(dt);
    this.seaT += dt;
    const t = this.seaT;
    this.air.blend(1 - Math.exp(-dt * 0.8));
    setShipTime(t);

    // lightning in a storm
    if (this.air.look === 'storm' && !this.reduced && Math.random() < dt * 0.08) { this.lightning = 1; this.whiteout(0.25, '#DDE8FF'); }
    this.lightning = Math.max(0, this.lightning - dt * 3);

    const w = this.world;
    this.wakes.begin();
    this.ocean.beginHulls();
    if ((this.mode === 'play' || this.mode === 'watch') && w) this.syncWorld(w, dt, t);
    else { if (this.player) this.player.root.visible = false; this.flotsam.clear(); this.becalm(); }
    this.syncShowcase(dt, t);
    this.hulksStep(dt, t);
    this.wakes.end(t, this.air.foam);
    this.moveCamera(dt, t);
    this.marks.follow(dt, (id) => this.foes.get(id)?.root.position.clone().add(new THREE.Vector3(0, this.foes.get(id)!.height + 6, 0)) ?? null);

    // light and air
    const a = this.air;
    this.renderer.toneMappingExposure = a.exposure * (1 + this.lightning * 0.6);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(a.horizon); fog.near = a.fogNear; fog.far = a.fogFar;
    const watch = this.mode === 'watch';
    if (watch) {
      // From this high the whole chart is near. The haze starts past its far rim, or across
      // it when the weather is the haze: thick in fog, less in a storm, none on a clear day.
      const d = this.camera.position.distanceTo(this.camLook), haze = clamp(1 - a.fogFar / 1500, 0, 0.8);
      fog.near = d - MAP_R + (1 - haze) * 2.4 * MAP_R;
      fog.far = fog.near + 2600 * (1 - haze * 0.55);
    }
    // Lanterns and stern windows: a glow by day, bright at dusk and in weather.
    const low = Math.max(0, 1 - a.sun.y * 1.6), dim = Math.max(0, 1 - a.sunIntensity / 2.6);
    this.shade.copy(a.hemiSky).lerp(WHITE, 0.55).multiplyScalar(clamp(0.35 + a.sunIntensity * 0.25, 0.4, 1));
    setShipLights(0.25 + low * 1.4 + dim, this.shade);
    this.sun.color.copy(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.hemi.color.copy(a.hemiSky);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = a.hemi * (1 + this.lightning * 2);
    const focus = this.camLook;
    this.sun.position.copy(focus).addScaledVector(a.sun, watch ? 3000 : 300);
    this.sun.target.position.copy(focus);
    // the sea's grid is densest under the camera, or, from high above, under what it looks at
    const grid = watch ? this.camLook : this.camera.position;
    this.ocean.endHulls(grid.x, grid.z);
    this.ocean.update(t, a, grid.x, grid.z, fog, watch ? NIGHT : null);
    this.sky.update(t, a, this.camera.position);
    this.fx.update(dt, t, this.camLook);
    this.islands.update(t);
    this.refreshEnv(dt);

    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.flashEl?.style.setProperty('--flash', this.flash.toFixed(3));

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Image-based light from the current sky, re-baked once the weather has settled. The
   *  sky it is baked from is kept, so its program is compiled once and not once a bake,
   *  and each bake's render target is freed when the next replaces it. */
  private envWait = 0;
  private envSky: Sky | null = null;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private refreshEnv(dt: number) {
    if (this.envLook === this.air.look) return;
    this.envWait += dt;
    if (this.envLook !== null && this.envWait < 4) return;
    this.envWait = 0;
    this.envLook = this.air.look;
    if (!this.envSky) { this.envSky = new Sky(this.tier === 'high'); this.envScene.add(this.envSky.mesh); }
    this.envSky.update(0, this.air, ORIGIN);
    const rt = this.pmrem.fromScene(this.envScene, 0.04);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
  }

  /** Nothing of a fight left on the water: no shot hanging in the air, no rings, no fans. */
  private becalm() {
    this.balls.count = 0;
    this.shells.count = 0;
    const M = this.marks;
    for (const pool of [M.foeRings, M.ownRings, M.prizeRings, M.captainRings]) { pool.begin(); pool.end(); }
    for (const f of M.fans) f.visible = false;
    M.reticle.visible = false;
    M.beacon.visible = false;
  }

  private syncWorld(w: World, dt: number, t: number) {
    // On the bar's screen no ship is the screen's own: every captain is drawn as another's.
    const watch = this.mode === 'watch';
    const s = you(w);
    if (watch) { if (this.player) this.player.root.visible = false; } else this.syncOwn(w, s, dt, t);

    // the other captains. A seat whose captain has gone ashore is open water (it was drawn
    // as a wreck burning where she was last seen), and a seat taken again may be taken in
    // another ship.
    for (const o of w.players) {
      if (o === s && !watch) continue;
      let m = this.crew.get(o.id);
      if (m && (o.left || this.crewShip.get(o.id) !== o.shipId)) { this.drop(m); this.crew.delete(o.id); m = undefined; }
      if (o.left) continue;
      if (!m) {
        m = modelFor(recipeOf(shipById(o.shipId)));
        m.setShadows(this.tier === 'high');
        this.scene.add(m.root);
        this.crew.set(o.id, m);
        this.crewShip.set(o.id, o.shipId);
      }
      this.poseCaptain(o, m, dt, t);
    }

    // foes
    const live = new Set<number>();
    for (const e of w.foes) {
      live.add(e.id);
      let m = this.foes.get(e.id);
      if (!m) {
        const R = e.L ? e.L.recipe : CLASSES[e.cls].recipe;
        m = modelFor(R, e.ports ?? undefined);
        m.setShadows(this.tier === 'high' && e.len > 20);
        this.scene.add(m.root);
        this.foes.set(e.id, m);
      }
      this.poseFoe(e, m, dt, t);
    }
    for (const [id, m] of this.foes) if (!live.has(id)) { this.drop(m); this.foes.delete(id); }

    this.syncShots(w, t);
    this.syncMarks(w, t);
    this.flotsam.sync(w, t, this.fx, this.scene.fog as THREE.Fog);
  }

  /** Your own ship, under the chase camera. */
  private syncOwn(w: World, s: Player, dt: number, t: number) {
    const p = this.player!;
    p.root.visible = true;
    const r = ride(s.x, s.y, s.h, s.len, s.beam, t);
    const heel = clamp(-s.rot * s.v * 0.035, -0.2, 0.2);
    const lost = w.phase === 'lost';
    p.pose({
      x: s.x, z: s.y, h: s.h, heave: r.heave - (lost ? 3 : 0), pitch: r.pitch, roll: r.roll + heel + (lost ? 0.4 : 0),
      fill: clamp(s.sail * (s.v / s.maxSpeed + 0.4), 0.15, 1), struck: false, damage: 1 - s.hull / s.hullMax, t,
    });
    // blink while she has grace
    p.root.visible = !(s.invuln > 0 && Math.floor(t * 12) % 2 === 0 && w.phase !== 'lost');
    p.ready?.(w.phase !== 'lost');
    const fx = Math.cos(s.h), fz = Math.sin(s.h);
    this.wakes.track(s.id, s.x - fx * s.len * 0.45, s.y - fz * s.len * 0.45, s.beam, s.v, dt, t);
    if (!lost) this.ocean.hull(s.x, s.y, s.h, s.len, s.beam, s.v / s.maxSpeed);
    this.fx.bowSpray(s.x + fx * s.len * 0.5, r.heave + 0.5, s.y + fz * s.len * 0.5, s.v);
    const dmg = 1 - s.hull / s.hullMax;
    if (dmg > 0.35) this.fx.burn(s.x, r.heave + 3, s.y, dmg, dt);
  }

  /** Another captain's ship, sailing as yours does; down by the head once she is out. */
  private poseCaptain(o: Player, m: ShipModel, dt: number, t: number) {
    const r = ride(o.x, o.y, o.h, o.len, o.beam, t);
    const heel = clamp(-o.rot * o.v * 0.035, -0.2, 0.2);
    m.pose({
      x: o.x, z: o.y, h: o.h, heave: r.heave - (o.out ? 3 : 0), pitch: r.pitch, roll: r.roll + heel + (o.out ? 0.4 : 0),
      fill: clamp(o.sail * (o.v / o.maxSpeed + 0.4), 0.15, 1), struck: false, damage: 1 - o.hull / o.hullMax, t,
    });
    m.root.visible = !(o.invuln > 0 && Math.floor(t * 12) % 2 === 0 && !o.out);
    m.ready?.(!o.out);
    m.detail?.(this.camera.position.distanceTo(m.root.position));
    const fx = Math.cos(o.h), fz = Math.sin(o.h);
    this.wakes.track(o.id, o.x - fx * o.len * 0.45, o.y - fz * o.len * 0.45, o.beam, o.out ? 0 : o.v, dt, t);
    if (!o.out) this.ocean.hull(o.x, o.y, o.h, o.len, o.beam, o.v / o.maxSpeed);
    const dmg = 1 - o.hull / o.hullMax;
    if (dmg > 0.35 || o.out) this.fx.burn(o.x, r.heave + 3, o.y, o.out ? 0.9 : dmg, dt);
  }

  private poseFoe(e: Foe, m: ShipModel, dt: number, t: number) {
    const r = ride(e.x, e.y, e.h, e.len, e.beam, t);
    const struck = e.state === 'struck';
    // A prize that got away makes sail and fades into the haze on her way out.
    const left = e.state === 'spent' ? clamp(1 - e.spentT / ESCAPE_TIME, 0, 1) : 1;
    const heel = clamp(-e.rot * e.v * 0.03, -0.15, 0.15);
    const list = struck ? 0.12 : left < 1 ? 0.06 : 0;
    m.pose({
      x: e.x, z: e.y, h: e.h, heave: r.heave - (struck ? 0.4 : left < 1 ? 0.2 : 0), pitch: r.pitch, roll: r.roll + heel + list,
      fill: struck ? 0.05 : clamp(e.sail * (e.v / Math.max(1, e.maxSpeed) + 0.5), 0.2, 1),
      struck: struck || left < 1, damage: 1 - e.hull / e.hullMax, t,
    });
    m.ready?.(e.state === 'engage');
    m.portsOpen(e.broadSide, e.broad > 0);
    m.portsOpen(e.broadSide === 1 ? -1 : 1, false);
    m.detail?.(this.camera.position.distanceTo(m.root.position));
    if (e.ports && m.weakPoints) m.weakPoints(e.ports.map((p) => !p.dead));
    m.fade?.(left);
    const fx = Math.cos(e.h), fz = Math.sin(e.h);
    this.wakes.track(e.id, e.x - fx * e.len * 0.45, e.y - fz * e.len * 0.45, e.beam, e.v * left, dt, t);
    if (left > 0.4) this.ocean.hull(e.x, e.y, e.h, e.len, e.beam, e.v / Math.max(1, e.maxSpeed));
    const dmg = (1 - e.hull / e.hullMax) * left;
    if (dmg > 0.4) this.fx.burn(e.x, r.heave + 2 + e.len * 0.05, e.y, dmg, dt);
    if (e.cls === 'brulote' && e.state === 'engage') this.fx.burn(e.x, r.heave + 2, e.y, 0.9, dt);
  }

  private syncShots(w: World, t: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    const odd = Math.floor(t * 60) % 2;
    for (const sh of w.shots) {
      if (n >= 600) break;
      const k = sh.age / sh.life;
      const apex = Math.min(9, sh.life * 5);
      const y = 2.4 + Math.sin(Math.PI * k) * apex - k * 1.8;
      p.set(sh.x, y, sh.y);
      s.setScalar(sh.kind === 'chain' ? 2 : 1);
      this.balls.setMatrixAt(n++, m.compose(p, q, s));
      if (sh.foe && (n % 2 === odd)) this.fx.ember(sh.x, y, sh.y);
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
  }

  private syncMarks(w: World, t: number) {
    const M = this.marks;
    M.foeRings.begin(); M.ownRings.begin(); M.prizeRings.begin();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (const mk of w.marks) {
      const ring = (mk.own ? M.ownRings : M.foeRings).get();
      ring.position.set(mk.x, heightAt(mk.x, mk.y, t) + 0.35, mk.y);
      ring.scale.setScalar(mk.r);
      const u = (ring.material as THREE.ShaderMaterial).uniforms;
      u.uProg.value = 1; u.uFill.value = 1 - mk.t / mk.max; u.uAlpha.value = 0.9; u.uTime.value = t;
      // the shell itself, dropping into its ring
      if (mk.max > 0.5 && n < 64) {
        const k = mk.t / mk.max;
        p.set(mk.x, 2 + k * k * 110, mk.y);
        s.setScalar(1.6);
        this.shells.setMatrixAt(n++, m4.compose(p, q, s));
        if (Math.random() < 0.5) this.fx.trail(p.x, p.y + 2, p.z);
      }
    }
    this.shells.count = n;
    this.shells.instanceMatrix.needsUpdate = true;

    // prizes: a ring counting down her window, filling as you board her
    const watch = this.mode === 'watch';
    const sh = you(w);
    for (const e of w.foes) {
      if (e.state !== 'struck' || e.strikeT <= 0) continue;
      const ring = M.prizeRings.get();
      ring.position.set(e.x, heightAt(e.x, e.y, t) + 0.4, e.y);
      ring.scale.setScalar(e.len * 0.5 + sh.len * 0.5 * 0.85 + 12);
      const u = (ring.material as THREE.ShaderMaterial).uniforms;
      u.uProg.value = e.strikeT / STRIKE_WINDOW;
      u.uFill.value = !watch && sh.board && sh.board.id === e.id ? sh.board.t / BOARD_TIME : 0;
      u.uAlpha.value = 0.75 + Math.sin(t * 6) * 0.2;
      u.uDash.value = 0;
    }
    M.foeRings.end(); M.ownRings.end(); M.prizeRings.end();

    if (watch) {
      // the bar's screen has no guns of its own to aim: every captain's mark instead
      this.captainMarks(w, t);
      for (const f of M.fans) f.visible = false;
      M.reticle.visible = false;
      M.beacon.visible = false;
      return;
    }
    M.captainRings.begin(); M.captainRings.end();

    // broadside fans: brighter when loaded, brighter still when something is in the arc
    const range = sh.stats.range;
    for (let i = 0; i < 2; i++) {
      const side = (i === 0 ? -1 : 1) as -1 | 1;
      const fan = M.fans[i];
      fan.visible = w.phase !== 'lost';
      fan.position.set(sh.x, heightAt(sh.x, sh.y, t) + 0.5, sh.y);
      fan.rotation.set(0, -sh.h + (side === -1 ? Math.PI : 0), 0);
      fan.scale.setScalar(range);
      const [vx, vy] = sideVec(sh.h, side === 1 ? 1 : 0);
      let bears = false;
      for (const e of w.foes) {
        if (e.dead || e.state === 'spent') continue;
        const dx = e.x - sh.x, dy = e.y - sh.y, d = Math.hypot(dx, dy);
        if (d > range + e.len * 0.4) continue;
        if ((dx * vx + dy * vy) / d > Math.cos(0.36)) { bears = true; break; }
      }
      const u = (fan.material as THREE.ShaderMaterial).uniforms;
      const load = 1 - sh.cool[i] / (sh.stats.reload || 1);
      u.uLoad.value = load;
      u.uAlpha.value = bears ? (load >= 1 ? 0.55 : 0.25) : 0.06;
      u.uColor.value.set(bears && load >= 1 ? '#FFD36A' : '#F6E7C0');
    }

    // the mortar's reticle
    const aim = sh.aim;
    // Only when there is something to throw a shell at: a ring on empty water is clutter.
    const target = !!aim && (aim.lock !== 0 || w.foes.some((e) => e.state === 'engage' && Math.hypot(e.x - sh.x, e.y - sh.y) < 260));
    M.reticle.visible = target && sh.shells > 0 && w.phase !== 'lost';
    if (aim) {
      M.reticle.position.set(aim.x, heightAt(aim.x, aim.y, t) + 0.5, aim.y);
      M.reticle.scale.setScalar(26);
      const u = (M.reticle.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t; u.uAlpha.value = aim.lock ? 0.9 : 0.4;
    }

    M.beacon.visible = w.phase === 'clear' && !w.shared;
    if (M.beacon.visible) {
      const ring = M.beacon.getObjectByName('ring') as THREE.Mesh;
      (ring.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
  }

  /** On the bar's screen, a ring on the water round every captain in her own mark, never too
   *  small to see; dim while she is down, its arc counting her back afloat. */
  private captainMarks(w: World, t: number) {
    const pool = this.marks.captainRings;
    pool.begin();
    for (const o of w.players) {
      if (o.left) continue;
      const { color, dashed } = markOf(this.watchMarks.get(o.id) ?? 0);
      const ring = pool.get();
      ring.position.set(o.x, 0, o.y);
      ring.scale.setScalar(this.ringOf(o));
      const u = (ring.material as THREE.ShaderMaterial).uniforms;
      u.uColor.value.set(color);
      u.uDash.value = dashed ? 9 : 0;
      const down = this.downAt.get(o.id);
      u.uProg.value = !o.out ? 1 : down == null ? 0 : clamp((this.seaT - down) / this.refloatIn, 0, 1);
      u.uAlpha.value = o.out ? 0.7 : 1;
      u.uTime.value = t;
    }
    pool.end();
  }

  private hulksStep(dt: number, t: number) {
    this.hulks = this.hulks.filter((h) => {
      h.t += dt;
      const r = ride(h.x, h.z, h.h, h.m.len, h.m.beam, t);
      const k = Math.min(1, h.t / (h.boarded ? 7 : 5));
      if (k < 0.6) this.ocean.hull(h.x, h.z, h.h, h.m.len, h.m.beam, 0);
      h.m.pose({
        x: h.x, z: h.z, h: h.h, heave: r.heave - k * k * h.m.height * 0.9, pitch: r.pitch + k * 0.35, roll: r.roll + k * 0.5,
        fill: 0, struck: h.boarded, damage: 1, t,
      });
      if (!h.boarded) this.fx.burn(h.x, r.heave + 2 - k * 6, h.z, 1 - k, dt);
      if (h.t > (h.boarded ? 7 : 5)) { this.drop(h.m); return false; }
      return true;
    });
  }

  private syncShowcase(dt: number, t: number) {
    const m = this.showcase;
    if (!m || !this.map) { if (m) m.root.visible = false; return; }
    m.root.visible = this.mode === 'title' || this.mode === 'shipyard' || this.mode === 'port';
    const at = this.anchorage();
    const r = ride(at.x, at.z, at.h, m.len, m.beam, t);
    if (m.root.visible) this.ocean.hull(at.x, at.z, at.h, m.len, m.beam, 0);
    m.pose({ x: at.x, z: at.z, h: at.h, heave: r.heave, pitch: r.pitch, roll: r.roll, fill: this.mode === 'port' ? 0.15 : 0.7, struck: false, damage: this.showDamage, t });
    m.ready?.(this.mode !== 'port');
    void dt;
  }

  /** Where a ship rides at anchor: in the harbour mouth, bow to the sea. */
  private anchorage() {
    const h = this.map!.harbour;
    if (this.mode === 'port') return { x: h.x + 14, z: h.y - 4, h: 0.15 };
    return { x: h.x, z: h.y + 50, h: 0.35 };
  }

  /* ------------------------------------------------------------- camera --- */

  private target(): { pos: THREE.Vector3; look: THREE.Vector3; rate: number } {
    if (this.eyeAt) return { pos: this.eyeAt.pos.clone(), look: this.eyeAt.look.clone(), rate: 30 };
    const w = this.world;
    const aspect = this.camera.aspect;
    if (this.mode === 'watch' && this.map) {
      const f = this.fitWatch();
      // a sway of a few degrees either way, over minutes: the picture lives, and a TV left on
      // all night keeps no ghost of the islands
      const yaw = this.reduced ? 0 : Math.sin((this.seaT * Math.PI * 2) / 240) * 0.07;
      const bx = Math.sin(yaw), bz = Math.cos(yaw);
      const look = new THREE.Vector3(bx * f.ahead, 0, bz * f.ahead);
      const pos = look.clone().add(new THREE.Vector3(bx * Math.cos(WATCH_PITCH) * f.d, Math.sin(WATCH_PITCH) * f.d, bz * Math.cos(WATCH_PITCH) * f.d));
      this.camYaw = Math.atan2(-bz, -bx);
      return { pos, look, rate: 1.5 };
    }
    if (this.mode === 'play' && w) {
      const s = you(w);
      // Swing round behind her — but hold the bearing while a thumb is on the stick (see
      // holdYaw), and pick the swing up again gently once it lets go.
      this.yawFollow = this.holdYaw ? 0 : Math.min(1, this.yawFollow + this.dtLast / 0.8);
      this.camYaw += angleTo(this.camYaw, s.h) * Math.min(1, this.dtLast * 1.1 * this.yawFollow * this.yawFollow);
      let fight = false;
      for (const e of w.foes) if (e.state === 'engage' && Math.hypot(e.x - s.x, e.y - s.y) < 240) { fight = true; break; }
      const base = (aspect >= 1 ? this.chase.dist : (this.chase.dist * 1.23) / Math.sqrt(aspect));
      const dist = (base * (fight ? 1.18 : 1) + s.len * 0.8) * this.chaseZoom;
      const pitch = this.chase.pitch;
      const ahead = (16 + s.v * 1.6) * this.chaseZoom;
      const look = new THREE.Vector3(s.x + Math.cos(s.h) * ahead, 0, s.y + Math.sin(s.h) * ahead);
      const back = new THREE.Vector3(-Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const pos = look.clone().addScaledVector(back, Math.cos(pitch) * dist).add(new THREE.Vector3(0, Math.sin(pitch) * dist, 0));
      return { pos, look, rate: 3 };
    }
    if (!this.map) return { pos: new THREE.Vector3(0, 40, 160), look: new THREE.Vector3(), rate: 2 };
    const at = this.anchorage();
    const len = this.showcase?.len ?? 30;
    if (this.mode === 'port') {
      // in the harbour, looking up at the town over your own ship's quarter, drifting a
      // little from side to side as if the boat you are sitting in swings to her anchor
      const h = this.map.harbour, n = this.map.nassau;
      const sway = Math.sin(this.seaT * 0.07) * 14;
      // (the port's ledger is on the right: the town sits in the open two-thirds of the frame)
      const look = new THREE.Vector3(n.x + 30, 8, n.y + n.r * 0.3);
      const pos = new THREE.Vector3(h.x + 52 + sway, 20, h.y + 60);
      return { pos, look, rate: 1.6 };
    }
    if (this.peekAt) {
      const c = Math.cos(at.h), sn = Math.sin(at.h);
      const w = ([x, y, z]: [number, number, number]) => new THREE.Vector3(at.x + x * c - z * sn, y, at.z + x * sn + z * c);
      return { pos: w(this.peekAt.pos), look: w(this.peekAt.look), rate: 30 };
    }
    // title and shipyard: a slow orbit round the ship at anchor
    const shipyard = this.mode === 'shipyard';
    const d = ((shipyard ? 1.65 : 1.95) * len + 21) / this.zoom;
    const ang = this.orbit + this.dragYaw;
    const look = new THREE.Vector3(at.x, 0.3 * len, at.z);
    // Push the ship to the right of frame so the left-hand column has open sea behind it.
    if (aspect > 1) { const k = len * (shipyard ? 0.45 : 0.6); look.x -= Math.sin(ang) * k; look.z += Math.cos(ang) * k; }
    const pos = new THREE.Vector3(at.x + Math.cos(ang) * d, 4 + (len * 0.22) / Math.sqrt(this.zoom), at.z + Math.sin(ang) * d);
    return { pos, look, rate: 1.8 };
  }

  private dtLast = 1 / 60;
  /** Set while the touch stick is held: the chase camera stops swinging round behind the
   *  ship, so the screen the stick is read against holds still under the thumb. */
  holdYaw = false;
  private yawFollow = 1;
  /** The chase camera: how far back (landscape), and how steeply it looks down. */
  chase = { dist: 135, pitch: 0.72 };
  /** The player's own pull on the chase camera, from the mouse wheel: under 1 is closer. */
  chaseZoom = 1;
  private moveCamera(dt: number, t: number) {
    this.dtLast = dt;
    if ((this.mode === 'title' || this.mode === 'shipyard') && this.spin) this.orbit += dt * (this.mode === 'shipyard' ? 0.12 : 0.05);
    const { pos, look, rate } = this.target();
    const k = 1 - Math.exp(-dt * rate);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.4);
    const sh = this.shakeAmp * this.shakeAmp * 2.2;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(Math.sin(t * 61) * sh, Math.sin(t * 47) * sh, Math.cos(t * 53) * sh));
    // keep the camera out of the water, whatever the swell is doing
    this.camera.position.y = Math.max(this.camera.position.y, heightAt(this.camera.position.x, this.camera.position.z, t) + 2);
    this.camera.lookAt(this.camLook);
  }

  private snapCamera() {
    const { pos, look } = this.target();
    this.camPos.copy(pos);
    this.camLook.copy(look);
  }

  /** Stage coordinates, in CSS pixels, of a point in the world; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number; on: boolean } | null {
    const v = this.projV.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    // the canvas's size as of the last resize: reading it here, between the HUD's writes,
    // forced a layout per pointer per frame
    const W = this.cssW, H = this.cssH;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  private projV = new THREE.Vector3();

  /** Where the camera is looking from, as a heading — the joystick is relative to it. */
  get yaw() { return this.camYaw; }

  info() { return this.renderer.info; }
}
