// The reader for ships' model files, in a chunk of its own: GLTFLoader and its decoders are
// fetched after the title is up, not before it, and only if some ship has a file.

import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** A loader for this renderer. Compressed textures are transcoded to whatever its GPU reads,
 *  by a transcoder the build keeps beside the loader and fetches only for a file that has
 *  some; compressed geometry is unpacked as it loads. */
export function loaderFor(renderer: THREE.WebGLRenderer): GLTFLoader {
  const ktx2 = new KTX2Loader().detectSupport(renderer);
  return new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}
