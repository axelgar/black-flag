// The paint. Owns the WebGL renderer and everything on the water, reads a world snapshot
// every frame and never writes to it. The simulation does not know this file exists.
//
// Modes are camera and scenery, not screens: 'title' and 'shipyard' orbit a ship at
// anchor off Nassau, 'port' looks at the town from the harbour, 'play' is the chase.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { angleTo, clamp } from '../core/vec';
import { CLASSES } from '../data/enemies';
import { shipById } from '../data/ships';
import { recipeOf } from '../data/upgrades';
import type { HullRecipe } from '../data/types';
import type { GameMap } from '../sim/map';
import { sideVec } from '../sim/combat';
import type { Foe, GameEvent, World } from '../sim/types';
import { Air, type Look } from './atmosphere';
import { Fx } from './fx';
import { Islands } from './islands';
import { Markers } from './markers';
import { Ocean } from './ocean';
import { Sky } from './sky';
import { Wakes } from './wakes';
import { heightAt, ride } from './waves';
import { ProceduralShip, setShipTime } from './ships/procedural';
import type { ShipModel } from './ships/ShipModel';
import { STRIKE_WINDOW, BOARD_TIME } from '../sim/combat';

export type Mode = 'title' | 'shipyard' | 'port' | 'play' | 'none';
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

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  air = new Air();
  tier: Tier;
  reduced = false;

  private ocean: Ocean;
  private sky = new Sky();
  private islands = new Islands();
  private fx = new Fx();
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
  private seaT = 0;
  private dragYaw = 0;

  constructor(canvas: HTMLCanvasElement, tier: Tier) {
    this.tier = tier;
    const high = tier === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);

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
    this.scene.add(this.sky.mesh, this.ocean.mesh, this.islands.group, this.wakes.mesh, this.marks.group, this.fx.group);
    this.fx.scale = high ? 1 : 0.6;

    const ballGeo = new THREE.SphereGeometry(0.55, 8, 6);
    this.balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#1B1916', roughness: 0.4, metalness: 0.6 }), 600);
    this.balls.count = 0; this.balls.frustumCulled = false;
    this.shells = new THREE.InstancedMesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#15130F', roughness: 0.5, metalness: 0.5 }), 64);
    this.shells.count = 0; this.shells.frustumCulled = false;
    this.scene.add(this.balls, this.shells);

    if (high) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.9));
      this.composer.addPass(new OutputPass());
    }
    this.flashEl = typeof document !== 'undefined' ? document.getElementById('flash') : null;
    this.resize();
  }

  /* ------------------------------------------------------------ plumbing -- */

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier === 'high' ? 2 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setViewport(h * dpr, this.camera.fov);
  }

  setReduced(on: boolean) {
    this.reduced = on;
    this.fx.scale = (this.tier === 'high' ? 1 : 0.6) * (on ? 0.5 : 1);
  }

  setLook(look: Look, snap = false) {
    if (snap) this.air.snap(look); else this.air.set(look);
    this.fx.rain.on = look === 'storm' && !this.reduced;
  }

  /** The chart the islands and shallows are built from. */
  setMap(m: GameMap) {
    if (this.map === m) return;
    this.map = m;
    this.islands.build(m, this.tier === 'high');
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
    if (was === 'none') this.snapCamera();
  }

  setWorld(w: World | null) {
    if (w === this.world) return;
    this.world = w;
    for (const m of this.foes.values()) this.drop(m);
    this.foes.clear();
    for (const h of this.hulks) this.drop(h.m);
    this.hulks = [];
    this.fx.clear();
    this.wakes.clear();
    this.marks.clear();
    if (w) {
      this.setMap(w.map);
      this.setLook(w.weather, true);
      this.setPlayerShip(w.shipId);
      this.camYaw = w.ship.h;
      this.snapCamera();
    }
  }

  setPlayerShip(id: string) {
    if (this.playerShip === id && this.player) return;
    if (this.player) this.drop(this.player);
    this.playerShip = id;
    this.player = modelFor(recipeOf(shipById(id)));
    this.player.setShadows(this.tier === 'high');
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
      switch (e.k) {
        case 'cannon': this.fx.muzzle(x, Y + 0.6, z, e.dx as number, e.dy as number); if (e.i === 0) this.shake(0.12); break;
        case 'bow': this.fx.muzzle(x, Y, z, Math.cos(e.h as number), Math.sin(e.h as number), 0.6); break;
        case 'foe-fire': this.foeFire(w, e); break;
        case 'thud': if (e.rock) this.fx.splash(x, z, t); else this.fx.thud(x, Y + 1, z); break;
        case 'splash': this.fx.splash(x, z, t); break;
        case 'boom': if (e.splash) this.fx.explode(x, heightAt(x, z, t), z, !!e.big, t); else this.fx.explode(x, 2, z, !!e.big, t);
          this.shake(e.big ? 0.9 : 0.35); break;
        case 'sunk': this.sink(e.id as number, !!e.boarded); break;
        case 'board': this.fx.sparkle(x, 4, z, 40); break;
        case 'take': this.fx.sparkle(x, 1, z, 16); break;
        case 'hit': this.fx.thud(x, Y + 1, z); this.shake(0.4); break;
        case 'ram': this.fx.thud(x, Y, z); this.fx.wood.spawn(x, 2, z, 8, 6); this.shake(0.6); break;
        case 'ground': this.fx.splash(w.ship.x, w.ship.y, t, true); this.shake(0.5); break;
        case 'mortar': this.fx.muzzle(e.fromX as number, 4, e.fromY as number, 0, 0, 1.4); break;
        case 'mortar-in': this.fx.muzzle(x, 5, z, 0, 0, 1.4); break;
        case 'fireship': this.fx.explode(x, 2, z, true, t); this.shake(0.8); break;
        case 'port-down': this.fx.explode(x, 4, z, false, t); break;
        case 'refit': this.whiteout(0.8); break;
        case 'dead': this.whiteout(0.5, '#8E2B24'); break;
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

  frame(dt: number) {
    this.seaT += dt;
    const t = this.seaT;
    this.air.blend(1 - Math.exp(-dt * 0.8));
    setShipTime(t);

    // lightning in a storm
    if (this.air.look === 'storm' && !this.reduced && Math.random() < dt * 0.08) { this.lightning = 1; this.whiteout(0.25, '#DDE8FF'); }
    this.lightning = Math.max(0, this.lightning - dt * 3);

    const w = this.world;
    this.wakes.begin();
    if (this.mode === 'play' && w) this.syncWorld(w, dt, t);
    else if (this.player) this.player.root.visible = false;
    this.syncShowcase(dt, t);
    this.hulksStep(dt, t);
    this.wakes.end(t, this.air.foam);
    this.moveCamera(dt, t);
    this.marks.follow(dt, (id) => this.foes.get(id)?.root.position.clone().add(new THREE.Vector3(0, this.foes.get(id)!.height + 6, 0)) ?? null);

    // light and air
    const a = this.air;
    this.renderer.toneMappingExposure = a.exposure * (1 + this.lightning * 0.6);
    this.sun.color.copy(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.hemi.color.copy(a.hemiSky);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = a.hemi * (1 + this.lightning * 2);
    const focus = this.camLook;
    this.sun.position.copy(focus).addScaledVector(a.sun, 300);
    this.sun.target.position.copy(focus);
    this.ocean.update(t, a, this.camera.position.x, this.camera.position.z);
    this.sky.update(t, a, this.camera.position);
    this.fx.update(dt, t, this.camLook);
    this.refreshEnv(dt);

    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.flashEl?.style.setProperty('--flash', this.flash.toFixed(3));

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Image-based light from the current sky, re-baked once the weather has settled. */
  private envWait = 0;
  private refreshEnv(dt: number) {
    if (this.envLook === this.air.look) return;
    this.envWait += dt;
    if (this.envLook !== null && this.envWait < 4) return;
    this.envWait = 0;
    this.envLook = this.air.look;
    const s = new THREE.Scene();
    const sky = new Sky();
    sky.update(0, this.air, new THREE.Vector3());
    s.add(sky.mesh);
    const rt = this.pmrem.fromScene(s, 0.04);
    this.scene.environment?.dispose();
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    sky.mat.dispose(); sky.mesh.geometry.dispose();
  }

  private syncWorld(w: World, dt: number, t: number) {
    const s = w.ship;
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
    const fx = Math.cos(s.h), fz = Math.sin(s.h);
    this.wakes.track(0, s.x - fx * s.len * 0.45, s.y - fz * s.len * 0.45, s.beam, s.v, dt, t);
    this.fx.bowSpray(s.x + fx * s.len * 0.5, r.heave + 0.5, s.y + fz * s.len * 0.5, s.v);
    const dmg = 1 - s.hull / s.hullMax;
    if (dmg > 0.35) this.fx.burn(s.x, r.heave + 3, s.y, dmg, dt);

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
  }

  private poseFoe(e: Foe, m: ShipModel, dt: number, t: number) {
    const r = ride(e.x, e.y, e.h, e.len, e.beam, t);
    const struck = e.state === 'struck' || e.state === 'spent';
    const heel = clamp(-e.rot * e.v * 0.03, -0.15, 0.15);
    const list = struck ? 0.12 : 0;
    m.pose({
      x: e.x, z: e.y, h: e.h, heave: r.heave - (struck ? 0.4 : 0), pitch: r.pitch, roll: r.roll + heel + list,
      fill: struck ? 0.05 : clamp(e.sail * (e.v / Math.max(1, e.maxSpeed) + 0.5), 0.2, 1),
      struck, damage: 1 - e.hull / e.hullMax, t,
    });
    m.portsOpen(e.broadSide, e.broad > 0);
    m.portsOpen(e.broadSide === 1 ? -1 : 1, false);
    if (e.ports && m.weakPoints) m.weakPoints(e.ports.map((p) => !p.dead));
    const fx = Math.cos(e.h), fz = Math.sin(e.h);
    this.wakes.track(e.id, e.x - fx * e.len * 0.45, e.y - fz * e.len * 0.45, e.beam, e.v, dt, t);
    const dmg = 1 - e.hull / e.hullMax;
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
    const sh = w.ship;
    for (const e of w.foes) {
      if (e.state !== 'struck' || e.strikeT <= 0) continue;
      const ring = M.prizeRings.get();
      ring.position.set(e.x, heightAt(e.x, e.y, t) + 0.4, e.y);
      ring.scale.setScalar(e.len * 0.5 + sh.len * 0.5 * 0.85 + 12);
      const u = (ring.material as THREE.ShaderMaterial).uniforms;
      u.uProg.value = e.strikeT / STRIKE_WINDOW;
      u.uFill.value = sh.board && sh.board.id === e.id ? sh.board.t / BOARD_TIME : 0;
      u.uAlpha.value = 0.75 + Math.sin(t * 6) * 0.2;
      u.uDash.value = 0;
    }
    M.foeRings.end(); M.ownRings.end(); M.prizeRings.end();

    // broadside fans: brighter when loaded, brighter still when something is in the arc
    const range = w.stats.range;
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
      const load = 1 - sh.cool[i] / (w.stats.reload || 1);
      u.uLoad.value = load;
      u.uAlpha.value = bears ? (load >= 1 ? 0.7 : 0.35) : 0.08;
      u.uColor.value.set(bears && load >= 1 ? '#FFD36A' : '#F6E7C0');
    }

    // the mortar's reticle
    const aim = sh.aim;
    M.reticle.visible = !!aim && sh.shells > 0 && w.phase !== 'lost';
    if (aim) {
      M.reticle.position.set(aim.x, heightAt(aim.x, aim.y, t) + 0.5, aim.y);
      M.reticle.scale.setScalar(26);
      const u = (M.reticle.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t; u.uAlpha.value = aim.lock ? 0.9 : 0.4;
    }

    M.beacon.visible = w.phase === 'clear';
    if (M.beacon.visible) {
      const ring = M.beacon.getObjectByName('ring') as THREE.Mesh;
      (ring.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
  }

  private hulksStep(dt: number, t: number) {
    this.hulks = this.hulks.filter((h) => {
      h.t += dt;
      const r = ride(h.x, h.z, h.h, h.m.len, h.m.beam, t);
      const k = Math.min(1, h.t / (h.boarded ? 7 : 5));
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
    m.pose({ x: at.x, z: at.z, h: at.h, heave: r.heave, pitch: r.pitch, roll: r.roll, fill: this.mode === 'port' ? 0.15 : 0.55, struck: false, damage: 0, t });
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
    const w = this.world;
    const aspect = this.camera.aspect;
    if (this.mode === 'play' && w) {
      const s = w.ship;
      this.camYaw += angleTo(this.camYaw, s.h) * Math.min(1, this.dtLast * 1.1);
      let fight = false;
      for (const e of w.foes) if (e.state === 'engage' && Math.hypot(e.x - s.x, e.y - s.y) < 240) { fight = true; break; }
      const base = aspect >= 1 ? 150 : 185 / Math.sqrt(aspect);
      const dist = base * (fight ? 1.18 : 1) + s.len * 0.8;
      const pitch = 0.78;
      const ahead = 16 + s.v * 1.6;
      const look = new THREE.Vector3(s.x + Math.cos(s.h) * ahead, 0, s.y + Math.sin(s.h) * ahead);
      const back = new THREE.Vector3(-Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const pos = look.clone().addScaledVector(back, Math.cos(pitch) * dist).add(new THREE.Vector3(0, Math.sin(pitch) * dist, 0));
      return { pos, look, rate: 3 };
    }
    if (!this.map) return { pos: new THREE.Vector3(0, 40, 160), look: new THREE.Vector3(), rate: 2 };
    const at = this.anchorage();
    const len = this.showcase?.len ?? 30;
    if (this.mode === 'port') {
      const h = this.map.harbour, n = this.map.nassau;
      const look = new THREE.Vector3((h.x + n.x) / 2 + 8, 6, (h.y + n.y) / 2 + 20);
      const pos = new THREE.Vector3(h.x + 70, 26, h.y + 110);
      return { pos, look, rate: 1.6 };
    }
    // title and shipyard: a slow orbit round the ship at anchor
    const shipyard = this.mode === 'shipyard';
    const d = (shipyard ? 1.9 : 2.3) * len + 24;
    const ang = this.orbit + this.dragYaw;
    const look = new THREE.Vector3(at.x, 0.3 * len, at.z);
    // Push the ship to the right of frame so the left-hand column has open sea behind it.
    if (aspect > 1) { const k = len * (shipyard ? 0.45 : 0.6); look.x -= Math.sin(ang) * k; look.z += Math.cos(ang) * k; }
    const pos = new THREE.Vector3(at.x + Math.cos(ang) * d, 4 + len * 0.22, at.z + Math.sin(ang) * d);
    return { pos, look, rate: 1.8 };
  }

  private dtLast = 1 / 60;
  private moveCamera(dt: number, t: number) {
    this.dtLast = dt;
    if (this.mode === 'title' || this.mode === 'shipyard') this.orbit += dt * (this.mode === 'shipyard' ? 0.12 : 0.05);
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
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const c = this.renderer.domElement;
    const W = c.clientWidth, H = c.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  /** Where the camera is looking from, as a heading — the joystick is relative to it. */
  get yaw() { return this.camYaw; }

  info() { return this.renderer.info; }
}
