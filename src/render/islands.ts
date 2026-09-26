// Land. Each island is a heightfield on a polar grid that follows her coastline from the
// chart, running down under the water so the shallows have something to be shallow over.
// Colour by height and kind: wet sand, dry sand, jungle, bare rock. Palms, rocks and
// Nassau's town are instanced on top.

import * as THREE from 'three';
import { rng } from '../core/rng';
import { coastAt, type GameMap, type Island } from '../sim/map';
import { Builder, type V3 } from './builder';

const PAL = {
  wet: '#B7A07A', sand: '#E3CF9E', grass: '#4F8A3C', jungle: '#2F6B34', rock: '#7D776C', dark: '#5B564E',
  cliff: '#8C8374', roof: '#A5462F', wall: '#E6DCC4', wood: '#6B4E32', stone: '#9C9486',
};

function islandHeight(is: Island, f: number, a: number, r: () => number, bumps: number[]): number {
  // f is fraction of the way from centre to coast. 1 is the waterline.
  if (f >= 1) return -Math.min(7, (f - 1) * 22);
  const k = is.kind;
  const bump = bumps[Math.floor(((a / (Math.PI * 2)) * bumps.length + bumps.length) % bumps.length)];
  if (k === 'sand') return 0.6 + (1 - f) * is.peak * (0.8 + bump * 0.3);
  const beach = k === 'rock' ? 0.94 : 0.8;
  if (f > beach) return ((1 - f) / (1 - beach)) * 1.1;
  const t = (beach - f) / beach;
  const shape = k === 'rock' ? Math.pow(t, 0.55) : Math.pow(t, 1.25);
  void r;
  return 1.1 + shape * is.peak * (0.75 + bump * 0.45);
}

function colourFor(is: Island, y: number, slope: number): string {
  if (y < 0.15) return PAL.wet;
  if (y < 1.2 && is.kind !== 'rock') return PAL.sand;
  if (is.kind === 'sand') return PAL.sand;
  if (is.kind === 'rock') return slope > 0.9 ? PAL.dark : y < 1.4 ? PAL.cliff : PAL.rock;
  if (slope > 1.2) return PAL.cliff;
  return y > is.peak * 0.8 ? PAL.grass : PAL.jungle;
}

function buildIsland(b: Builder, is: Island, palms: THREE.Matrix4[], rocks: THREE.Matrix4[]) {
  const r = rng(is.seed);
  const SP = 48, RINGS = 9;
  const fr = [0, 0.18, 0.36, 0.52, 0.66, 0.78, 0.88, 0.96, 1.04, 1.3];
  const bumps = Array.from({ length: 12 }, () => r());
  const P: V3[][] = [];
  for (let j = 0; j <= RINGS; j++) {
    const row: V3[] = [];
    for (let i = 0; i < SP; i++) {
      const a = (i / SP) * Math.PI * 2;
      const c = coastAt(is, a);
      const f = fr[j];
      const jitter = j > 0 && j < RINGS ? (r() - 0.5) * 0.04 : 0;
      const rad = c * (f + jitter);
      const y = islandHeight(is, f + jitter, a, r, bumps) + (j > 0 && j < 7 ? (r() - 0.5) * is.peak * 0.08 : 0);
      row.push([is.x + Math.cos(a) * rad, y, is.y + Math.sin(a) * rad]);
    }
    P.push(row);
  }
  const face = (a: V3, bb: V3, c: V3) => {
    const y = (a[1] + bb[1] + c[1]) / 3;
    const dy = Math.max(a[1], bb[1], c[1]) - Math.min(a[1], bb[1], c[1]);
    const dx = Math.max(Math.hypot(a[0] - bb[0], a[2] - bb[2]), Math.hypot(a[0] - c[0], a[2] - c[2]));
    b.tri(a, bb, c, colourFor(is, y, dy / (dx || 1)));
  };
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SP; i++) {
      const i1 = (i + 1) % SP;
      face(P[j][i], P[j + 1][i1], P[j + 1][i]);
      face(P[j][i], P[j][i1], P[j + 1][i1]);
    }
  }

  // Palms on the green, rocks on the grey, a few boulders on every beach.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const count = is.kind === 'jungle' ? Math.round(is.r * 0.9) : is.kind === 'sand' ? Math.round(2 + r() * 3) : is.kind === 'nassau' ? 26 : 0;
  for (let k = 0; k < count; k++) {
    const a = r() * Math.PI * 2;
    const f = is.kind === 'sand' ? 0.1 + r() * 0.5 : 0.25 + r() * 0.62;
    const rad = coastAt(is, a) * f;
    const y = islandHeight(is, f, a, r, bumps);
    if (y < 0.8) continue;
    p.set(is.x + Math.cos(a) * rad, y - 0.3, is.y + Math.sin(a) * rad);
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.35));
    const sc = 0.8 + r() * 0.6;
    s.set(sc, sc * (0.9 + r() * 0.4), sc);
    palms.push(m.compose(p, q, s).clone());
  }
  const rc = is.kind === 'rock' ? Math.round(is.r * 0.4) : Math.round(is.r * 0.12);
  for (let k = 0; k < rc; k++) {
    const a = r() * Math.PI * 2;
    const f = 0.85 + r() * 0.3;
    const rad = coastAt(is, a) * f;
    p.set(is.x + Math.cos(a) * rad, (1 - f) * 3, is.y + Math.sin(a) * rad);
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const sc = 1 + r() * (is.kind === 'rock' ? 3.5 : 1.8);
    s.set(sc, sc * 0.7, sc * (0.8 + r() * 0.5));
    rocks.push(m.compose(p, q, s).clone());
  }
}

/** Nassau: a fort on the headland, a town down to the water, a pier and a light. */
function buildNassau(b: Builder, is: Island, lights: Builder, harbour: { x: number; y: number }) {
  const r = rng('nassau-town');
  const land = (a: number, f: number) => {
    const c = coastAt(is, a) * f;
    return [is.x + Math.cos(a) * c, is.y + Math.sin(a) * c] as const;
  };
  // Houses in a crescent above the harbour.
  for (let k = 0; k < 34; k++) {
    const a = Math.PI / 2 + (r() - 0.5) * 2.2;
    const f = 0.35 + r() * 0.45;
    const [x, z] = land(a, f);
    const y = 1.1 + (1 - f) * is.peak * 0.55;
    const w = 3 + r() * 3, d = 3 + r() * 2.5, h = 2.6 + r() * 2.4, rot = a + (r() - 0.5) * 0.4;
    b.box(x, y + h / 2 - 0.4, z, w, h, d, r() < 0.2 ? '#D9C7A4' : PAL.wall, rot);
    // pitched roof
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (px: number, py: number, pz: number): V3 => [x + px * c + pz * s, y + py, z - px * s + pz * c];
    const top = h - 0.4 + 1.6, eave = h - 0.4;
    b.quad(pt(-w / 2 - 0.2, eave, -d / 2 - 0.2), pt(-w / 2 - 0.2, eave, d / 2 + 0.2), pt(0, top, d / 2 + 0.2), pt(0, top, -d / 2 - 0.2), PAL.roof);
    b.quad(pt(w / 2 + 0.2, eave, d / 2 + 0.2), pt(w / 2 + 0.2, eave, -d / 2 - 0.2), pt(0, top, -d / 2 - 0.2), pt(0, top, d / 2 + 0.2), PAL.roof);
    if (r() < 0.45) lights.box(x + Math.cos(a) * (d / 2 + 0.05), y + 1.2, z + Math.sin(a) * (d / 2 + 0.05), 0.7, 0.9, 0.7, '#FFD28A');
  }
  // The fort: four walls and a tower on the western headland.
  {
    const [x, z] = land(Math.PI * 0.95, 0.55);
    const y = 1.1 + is.peak * 0.4;
    const S = 16;
    b.box(x, y + 2, z - S / 2, S, 5, 1.6, PAL.stone);
    b.box(x, y + 2, z + S / 2, S, 5, 1.6, PAL.stone);
    b.box(x - S / 2, y + 2, z, 1.6, 5, S, PAL.stone);
    b.box(x + S / 2, y + 2, z, 1.6, 5, S, PAL.stone);
    b.cyl([x - S / 2, y - 1, z - S / 2], [x - S / 2, y + 9, z - S / 2], 2.6, 2.3, 8, PAL.stone, true);
    b.cyl([x - S / 2, y + 9, z - S / 2], [x - S / 2, y + 16, z - S / 2], 0.12, 0.12, 4, PAL.wood);
    lights.box(x - S / 2, y + 7, z - S / 2 + 2.4, 0.6, 0.8, 0.3, '#FFD28A');
  }
  // The light on the eastern point.
  {
    const [x, z] = land(Math.PI * 0.2, 0.92);
    b.cyl([x, 0, z], [x, 16, z], 2.2, 1.5, 10, '#EDE6D4', true);
    b.cyl([x, 16, z], [x, 18, z], 1.7, 1.7, 10, '#A5462F', true);
    lights.box(x, 17, z, 2.2, 1.2, 2.2, '#FFE2A0');
  }
  // A pier running out into the harbour mouth.
  {
    const [cx, cz] = land(Math.PI / 2, 0.98);
    const dx = harbour.x - cx, dz = harbour.y - cz, d = Math.hypot(dx, dz);
    const ux = dx / d, uz = dz / d;
    const len = Math.min(34, d * 0.7);
    for (let t = 0; t < len; t += 4) {
      const x = cx + ux * t, z = cz + uz * t;
      b.box(x, 1.2, z, 4.2, 0.35, 5, PAL.wood, Math.atan2(-uz, ux));
      for (const s of [-1, 1]) b.cyl([x - uz * 2.2 * s, -3, z + ux * 2.2 * s], [x - uz * 2.2 * s, 1.6, z + ux * 2.2 * s], 0.25, 0.25, 4, PAL.wood);
    }
  }
}

function palmGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  b.cyl([0, 0, 0], [0.8, 6.5, 0], 0.32, 0.2, 5, '#7A5B3A');
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const tip: V3 = [0.8 + Math.cos(a) * 3.6, 5.2, Math.sin(a) * 3.6];
    const side: V3 = [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9];
    b.tri([0.8, 6.6, 0], [tip[0] + side[0], tip[1], tip[2] + side[2]], tip, k % 2 ? '#3E7A33' : '#4F8F3A');
    b.tri([0.8, 6.6, 0], tip, [tip[0] - side[0], tip[1], tip[2] - side[2]], k % 2 ? '#356A2C' : '#447E34');
  }
  return b.geometry();
}

export class Islands {
  group = new THREE.Group();
  private key = '';
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
  // Fronds are single sheets, seen from above and below; drawn front-face-only, the camera
  // (looking down) only ever saw their undersides culled away, and the trees were bare poles.
  private palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  private lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFC878').multiplyScalar(2) });

  build(m: GameMap, shadows: boolean) {
    if (this.key === m.seed) return;
    this.key = m.seed;
    this.clear();
    const b = new Builder();
    const lights = new Builder();
    const palms: THREE.Matrix4[] = [], rocks: THREE.Matrix4[] = [];
    for (const is of m.islands) buildIsland(b, is, palms, rocks);
    buildNassau(b, m.nassau, lights, m.harbour);
    // Reefs: a scatter of black rock just breaking the surface.
    const rr = rng(`${m.seed}:reefs`);
    for (const k of m.reefs) {
      const n = 3 + Math.floor(k.r / 3);
      for (let i = 0; i < n; i++) {
        const a = rr() * Math.PI * 2, d = rr() * k.r * 0.8;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr() * 3, rr() * 3, rr() * 3));
        const s = 1.2 + rr() * 2.2;
        rocks.push(new THREE.Matrix4().compose(new THREE.Vector3(k.x + Math.cos(a) * d, -0.4 + rr() * 0.6, k.y + Math.sin(a) * d), q, new THREE.Vector3(s, s * 0.6, s)));
      }
    }

    const land = new THREE.Mesh(b.geometry(), this.mat);
    land.receiveShadow = shadows;
    land.castShadow = shadows;
    this.group.add(land);
    if (lights.pos.length) this.group.add(new THREE.Mesh(lights.geometry(), this.lightMat));

    const palmMesh = new THREE.InstancedMesh(palmGeometry(), this.palmMat, palms.length);
    palms.forEach((mm, i) => palmMesh.setMatrixAt(i, mm));
    palmMesh.castShadow = shadows;
    this.group.add(palmMesh);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#4A4640', flatShading: true, roughness: 0.9 });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rocks.forEach((mm, i) => rockMesh.setMatrixAt(i, mm));
    this.group.add(rockMesh);
  }

  private clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
  }
}
