// The one way everything solid is lit: three flat bands of light, sunlit, shade and deep
// shade, the way a cartoon is painted. Every material that takes light is made here, so
// the bands are the same on a ship, an island and a puff of smoke.

import * as THREE from 'three';

let bands: THREE.DataTexture | null = null;

function ramp(): THREE.DataTexture {
  if (bands) return bands;
  const steps = [150, 205, 255];
  bands = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  bands.minFilter = bands.magFilter = THREE.NearestFilter;
  bands.generateMipmaps = false;
  bands.needsUpdate = true;
  return bands;
}

export function toon(p: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: ramp(), ...p });
}
