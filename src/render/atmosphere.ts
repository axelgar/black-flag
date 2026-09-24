// Light and air, per weather. Every colour the sky, sea, fog and sun take comes out of
// one of these presets, so a storm is one switch and not forty.

import * as THREE from 'three';

export type Look = 'clear' | 'storm' | 'fog' | 'dusk';

export interface Atmos {
  zenith: string; horizon: string; ground: string;
  sunColor: string; sunIntensity: number; sunElev: number; sunAz: number;
  hemiSky: string; hemiGround: string; hemi: number;
  deep: string; shallow: string; foam: string;
  fogNear: number; fogFar: number;
  swell: number;            // multiplies the wave amplitudes
  exposure: number;
  cloud: number;            // cloud cover in the sky dome, 0..1
}

export const LOOKS: Record<Look, Atmos> = {
  clear: {
    zenith: '#3F7FB0', horizon: '#CFE0DF', ground: '#1B4E5E',
    sunColor: '#FFF1D6', sunIntensity: 2.6, sunElev: 0.72, sunAz: -0.6,
    hemiSky: '#BFDCEB', hemiGround: '#28505A', hemi: 0.9,
    deep: '#0B3A52', shallow: '#2FB3B0', foam: '#F2FBF8',
    fogNear: 380, fogFar: 1500, swell: 1, exposure: 1.0, cloud: 0.35,
  },
  storm: {
    zenith: '#1E2A33', horizon: '#56636B', ground: '#101C22',
    sunColor: '#AFC0C8', sunIntensity: 0.9, sunElev: 0.9, sunAz: 0.4,
    hemiSky: '#7C8C95', hemiGround: '#141E22', hemi: 0.9,
    deep: '#0A2230', shallow: '#2A6E6E', foam: '#D5E2E0',
    fogNear: 120, fogFar: 720, swell: 2.1, exposure: 0.95, cloud: 0.95,
  },
  fog: {
    zenith: '#9FB2B5', horizon: '#C9D1CB', ground: '#56706F',
    sunColor: '#F2EEDF', sunIntensity: 1.3, sunElev: 0.8, sunAz: -0.2,
    hemiSky: '#D8E0DA', hemiGround: '#40585A', hemi: 1.1,
    deep: '#1B4450', shallow: '#4C9A96', foam: '#EFF5F0',
    fogNear: 30, fogFar: 330, swell: 0.75, exposure: 1.0, cloud: 0.8,
  },
  dusk: {
    zenith: '#243A5C', horizon: '#F0A56A', ground: '#1A2C3A',
    sunColor: '#FFB27A', sunIntensity: 2.2, sunElev: 0.12, sunAz: 2.5,
    hemiSky: '#E8A983', hemiGround: '#1E3440', hemi: 0.75,
    deep: '#0D2B40', shallow: '#2C8C95', foam: '#FFE9D2',
    fogNear: 450, fogFar: 2200, swell: 0.8, exposure: 1.05, cloud: 0.45,
  },
};

export const sunDir = (a: Atmos) =>
  new THREE.Vector3(Math.cos(a.sunAz) * Math.cos(a.sunElev), Math.sin(a.sunElev), Math.sin(a.sunAz) * Math.cos(a.sunElev)).normalize();

/** The live, blended atmosphere the shaders read. Weather changes ease into each other. */
export class Air {
  zenith = new THREE.Color(); horizon = new THREE.Color(); ground = new THREE.Color();
  sunColor = new THREE.Color(); hemiSky = new THREE.Color(); hemiGround = new THREE.Color();
  deep = new THREE.Color(); shallow = new THREE.Color(); foam = new THREE.Color();
  sun = new THREE.Vector3();
  sunIntensity = 1; hemi = 1; fogNear = 300; fogFar = 1500; swell = 1; exposure = 1; cloud = 0.3;
  target: Atmos = LOOKS.clear;
  look: Look = 'clear';

  constructor() { this.snap('clear'); }

  set(look: Look) { this.look = look; this.target = LOOKS[look]; }

  snap(look: Look) {
    this.set(look);
    this.blend(1);
  }

  /** Ease toward the target. k is the fraction of the way to go this frame. */
  blend(k: number) {
    const t = this.target;
    const c = new THREE.Color();
    const mix = (dst: THREE.Color, hex: string) => dst.lerp(c.set(hex), k);
    mix(this.zenith, t.zenith); mix(this.horizon, t.horizon); mix(this.ground, t.ground);
    mix(this.sunColor, t.sunColor); mix(this.hemiSky, t.hemiSky); mix(this.hemiGround, t.hemiGround);
    mix(this.deep, t.deep); mix(this.shallow, t.shallow); mix(this.foam, t.foam);
    this.sun.lerp(sunDir(t), k).normalize();
    const n = (a: number, b: number) => a + (b - a) * k;
    this.sunIntensity = n(this.sunIntensity, t.sunIntensity);
    this.hemi = n(this.hemi, t.hemi);
    this.fogNear = n(this.fogNear, t.fogNear);
    this.fogFar = n(this.fogFar, t.fogFar);
    this.swell = n(this.swell, t.swell);
    this.exposure = n(this.exposure, t.exposure);
    this.cloud = n(this.cloud, t.cloud);
  }
}
