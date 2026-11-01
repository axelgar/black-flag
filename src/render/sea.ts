// The sea, cartoon: one flat quad and one fragment shader, so it costs what the screen it
// covers costs and nothing more. Bright open water, shallows round the islands with a line
// of surf on every coast, a slow shimmer of light across the top, and the edge of the
// sea, where the current turns ships back, drawn as a dashed line with the closed water
// beyond it darker.
//
// The coasts come from a distance field baked once per chart into a small texture: each
// texel says how far it is to the nearest coast. The shader reads the shallows, the surf
// and the foam off it.

import * as THREE from 'three';
import { MAP_R, islandSd, type GameMap } from '../sim/map';

/** The texture covers the chart at its biggest, plus this much round it. */
const PAD = 120;
const SIZE = 512;
/** Distances stored: from this far inside a coast to this far out. */
const LO = -20, HI = 60;

export const SEA = {
  deep: '#1A86D6',
  open: '#25A3E6',
  shallow: '#5FE0DD',
  closed: '#13508F',
  edge: '#FFF4C9',
};

export class Sea {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private land: THREE.DataTexture;

  constructor() {
    const span = (MAP_R + PAD) * 2;
    this.land = new THREE.DataTexture(new Uint8Array(SIZE * SIZE).fill(255), SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.land.magFilter = this.land.minFilter = THREE.LinearFilter;
    this.land.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: 0 },
        uR: { value: 240 },
        uSpan: { value: span },
        uLand: { value: this.land },
        uDeep: { value: new THREE.Color(SEA.deep) },
        uOpen: { value: new THREE.Color(SEA.open) },
        uShallow: { value: new THREE.Color(SEA.shallow) },
        uClosed: { value: new THREE.Color(SEA.closed) },
        uEdge: { value: new THREE.Color(SEA.edge) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vP = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uR, uSpan;
        uniform sampler2D uLand;
        uniform vec3 uDeep, uOpen, uShallow, uClosed, uEdge;
        varying vec2 vP;

        vec2 hash2(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453);
        }
        // how near the edge of a cell this point is: thin bright lines where cells meet
        float cells(vec2 p, float t) {
          vec2 i = floor(p), f = fract(p);
          float f1 = 8.0, f2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = hash2(i + g);
            o = 0.5 + 0.38 * sin(t + 6.2831 * o);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
          return sqrt(f2) - sqrt(f1);
        }

        void main() {
          float d = texture2D(uLand, vP / uSpan + 0.5).r * ${(HI - LO).toFixed(1)} + ${LO.toFixed(1)};
          // open water darkens a little away from the middle, so the middle reads as the place to be
          float r = length(vP);
          vec3 c = mix(uOpen, uDeep, smoothstep(0.0, uR, r) * 0.6);
          // the shallows round every island
          float sh = 1.0 - smoothstep(0.0, 26.0, d);
          c = mix(c, uShallow, sh * sh);
          // light on the water
          float e = cells(vP * 0.05 + vec2(uT * 0.04, uT * 0.025), uT * 0.7);
          c += vec3(0.11, 0.14, 0.14) * (1.0 - smoothstep(0.0, 0.05, e)) * (0.6 + 0.4 * sh);
          // surf: a line on the coast that breathes, and rings that run out from it
          float wob = sin(uT * 1.7 + vP.x * 0.13 + vP.y * 0.11) * 0.7;
          float surf = 1.0 - smoothstep(1.4, 2.2, d + wob);
          float k = fract(uT * 0.3);
          float run = (1.0 - smoothstep(0.0, 0.5, abs(d - 3.0 - 9.0 * k))) * (1.0 - k);
          c = mix(c, vec3(1.0), max(surf, run * 0.55) * step(-1.0, d));
          // the edge, and the closed water past it
          float past = smoothstep(uR - 1.5, uR + 1.5, r);
          c = mix(c, uClosed, past * 0.85);
          float a = atan(vP.y, vP.x);
          float dash = step(0.45, fract(a * uR / 6.2831 / 9.0 - uT * 0.3));
          float band = 1.0 - smoothstep(0.9, 1.9, abs(r - uR));
          c = mix(c, uEdge, band * dash * 0.9);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const g = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = -1;
  }

  /** Bake the coasts of a chart into the distance field. */
  setMap(m: GameMap) {
    const span = (MAP_R + PAD) * 2, px = span / SIZE;
    const data = this.land.image.data as Uint8Array;
    data.fill(255);
    const put = (i: number, d: number) => {
      const v = Math.round(((Math.min(HI, Math.max(LO, d)) - LO) / (HI - LO)) * 255);
      if (v < data[i]) data[i] = v;
    };
    for (const is of m.islands) {
      const reach = Math.max(...is.radii) + HI;
      const x0 = Math.max(0, Math.floor((is.x - reach) / px + SIZE / 2)), x1 = Math.min(SIZE - 1, Math.ceil((is.x + reach) / px + SIZE / 2));
      const y0 = Math.max(0, Math.floor((is.y - reach) / px + SIZE / 2)), y1 = Math.min(SIZE - 1, Math.ceil((is.y + reach) / px + SIZE / 2));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const x = (tx + 0.5 - SIZE / 2) * px, y = (ty + 0.5 - SIZE / 2) * px;
          put(ty * SIZE + tx, islandSd(is, x, y));
        }
      }
    }
    this.land.needsUpdate = true;
  }

  frame(t: number, R: number) {
    this.mat.uniforms.uT.value = t;
    this.mat.uniforms.uR.value = R;
  }
}
