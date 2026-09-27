// Things painted on the water to tell you something: where a shell will land, how long a
// prize has left, which of your broadsides bears, where your mortar is pointed, and the
// way home. Flat, bright, and never lit — they are information, not scenery.

import * as THREE from 'three';
import { SEA_HEIGHT, seaUniforms } from './waves';

// Marks lie on the water whatever the swell is doing: each vertex is set on the sea's own
// surface, so a ring does not vanish into the face of a storm wave. A little higher the
// bigger the swell — the sea's mesh is coarser than the swell's arithmetic, and in a storm
// the difference cut the rings that matter most.
const ringVert = /* glsl */ `
${SEA_HEIGHT}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = seaHeight(wp.xz) + 0.25 + 0.35 * uAmp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// A ring with a progress arc and an optional fill. Used for mortar telegraphs, prize
// timers and the boarding count.
const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uProg, uFill, uAlpha, uTime, uDash;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float a = atan(c.x, -c.y) / 6.28318 + 0.5;
  float ring = smoothstep(0.84, 0.88, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float arc = step(a, uProg);
  float dash = uDash > 0.0 ? step(0.5, fract(a * uDash - uTime * 0.6)) : 1.0;
  float fill = (1.0 - smoothstep(uFill * 0.86, uFill * 0.86 + 0.02, r)) * 0.35;
  float alpha = (ring * mix(0.25, 1.0, arc) * dash + fill) * uAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A fan on the water, fading out with range: the arc a broadside covers.
const fanFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha, uLoad;
varying vec2 vUv;
void main() {
  float r = vUv.y;
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  float body = (1.0 - r) * 0.18 + smoothstep(0.93, 0.97, r) * (1.0 - smoothstep(0.98, 1.0, r)) * 0.8;
  float load = step(r, uLoad);
  float alpha = body * edge * uAlpha * mix(0.25, 1.0, load);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function ringMaterial(color: string) {
  return new THREE.ShaderMaterial({
    vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      ...seaUniforms,
      uColor: { value: new THREE.Color(color) }, uProg: { value: 1 }, uFill: { value: 0 },
      uAlpha: { value: 1 }, uDash: { value: 0 },
    },
  });
}

class RingPool {
  private items: THREE.Mesh[] = [];
  private used = 0;
  private geo = new THREE.PlaneGeometry(2, 2, 20, 20).rotateX(-Math.PI / 2);
  constructor(private parent: THREE.Object3D, private color: string) {}
  begin() { this.used = 0; }
  get(): THREE.Mesh {
    let m = this.items[this.used];
    if (!m) { m = new THREE.Mesh(this.geo, ringMaterial(this.color)); m.renderOrder = 4; this.parent.add(m); this.items.push(m); }
    this.used++;
    m.visible = true;
    return m;
  }
  end() { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; }
}

function fanGeometry(spread: number, segs = 16): THREE.BufferGeometry {
  // A sector from the origin out to radius 1, centred on +z (starboard), in the XZ plane.
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const rs = 6;
  for (let j = 0; j <= rs; j++) {
    const r = 0.08 + (j / rs) * 0.92;
    for (let i = 0; i <= segs; i++) {
      const a = -spread + (i / segs) * spread * 2;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(i / segs, r);
    }
  }
  for (let j = 0; j < rs; j++) {
    for (let i = 0; i < segs; i++) {
      const k = j * (segs + 1) + i;
      idx.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Markers {
  group = new THREE.Group();
  foeRings: RingPool; ownRings: RingPool; prizeRings: RingPool;
  fans: THREE.Mesh[];
  reticle: THREE.Mesh;
  beacon: THREE.Group;
  private alerts: { s: THREE.Sprite; t: number; id: number }[] = [];
  private alertTex: THREE.Texture | null = null;
  // Spent alert sprites wait here rather than being disposed: disposing the last one
  // freed the program, and the next squadron to see you compiled it again mid-fight.
  private spare: THREE.Sprite[] = [];

  constructor() {
    this.foeRings = new RingPool(this.group, '#FF5A3C');
    this.ownRings = new RingPool(this.group, '#FFD36A');
    this.prizeRings = new RingPool(this.group, '#F6F1E1');

    this.fans = [-1, 1].map((side) => {
      const m = new THREE.Mesh(fanGeometry(0.34), new THREE.ShaderMaterial({
        vertexShader: ringVert, fragmentShader: fanFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { ...seaUniforms, uColor: { value: new THREE.Color('#F6E7C0') }, uAlpha: { value: 0.3 }, uLoad: { value: 1 } },
      }));
      if (side === -1) m.rotation.y = Math.PI;
      m.renderOrder = 4;
      this.group.add(m);
      return m;
    });

    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 16, 16).rotateX(-Math.PI / 2), ringMaterial('#FFD36A'));
    (this.reticle.material as THREE.ShaderMaterial).uniforms.uDash.value = 12;
    this.reticle.renderOrder = 4;
    this.group.add(this.reticle);

    // The way home: a column of light over the harbour mouth.
    this.beacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 10, 160, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFD36A').multiplyScalar(1.3), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 80;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 40, 40).rotateX(-Math.PI / 2), ringMaterial('#FFD36A'));
    (ring.material as THREE.ShaderMaterial).uniforms.uDash.value = 20;
    ring.name = 'ring';
    this.beacon.add(beam, ring);
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  alert(id: number, x: number, y: number, z: number) {
    if (typeof document === 'undefined') return;
    const s = this.sprite();
    s.position.set(x, y, z);
    s.visible = true;
    this.alerts.push({ s, t: 1.6, id });
  }

  private sprite(): THREE.Sprite {
    const old = this.spare.pop();
    if (old) return old;
    if (!this.alertTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#C8372A'; c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFF4E0'; c.font = 'bold 44px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('!', 32, 35);
      this.alertTex = new THREE.CanvasTexture(cv);
      this.alertTex.colorSpace = THREE.SRGBColorSpace;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.alertTex, depthTest: false, transparent: true }));
    s.scale.setScalar(7);
    s.renderOrder = 10;
    s.visible = false;
    this.group.add(s);
    return s;
  }

  /** One of everything that is otherwise only made when it is first needed, hidden, so
   *  the view can compile its programs up front. */
  warm() {
    if (typeof document !== 'undefined' && !this.spare.length && !this.alerts.length) this.spare.push(this.sprite());
  }

  /** Sprites follow their ships while they last. */
  follow(dt: number, where: (id: number) => THREE.Vector3 | null) {
    this.alerts = this.alerts.filter((a) => {
      a.t -= dt;
      const p = where(a.id);
      if (p) a.s.position.copy(p);
      a.s.position.y += dt * 2;
      (a.s.material as THREE.SpriteMaterial).opacity = Math.min(1, a.t * 2);
      if (a.t > 0) return true;
      a.s.visible = false;
      this.spare.push(a.s);
      return false;
    });
  }

  clear() {
    for (const a of this.alerts) { a.s.visible = false; this.spare.push(a.s); }
    this.alerts = [];
  }
}
