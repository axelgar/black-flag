// The shapes model files are described in. Pure data: the renderer reads them.

/** A ship modelled by hand and exported as a GLB. What the file must hold is set out in
 *  PLANS/ART_BRIEF.md and read by src/render/ships.ts. */
export interface ModelFile {
  url: string;
  /** Quarter turns that bring her bow round to the file's +Z, glTF's forward: 1 if it
   *  points along -X, 2 along -Z, 3 along +X. */
  turn?: number;
  /** Metres she is raised by once scaled: how far below the file's origin her waterline is. */
  lift?: number;
}

/** A set of models in one GLB: islands, palms, rocks, crates, each a top-level node named
 *  by what it is (`palm_2`, `crate_speed`). */
export interface PropSet {
  url: string;
  /** Quarter turns that bring the file's fronts (a palm's lean) round to its +Z: 1 if they
   *  face along -X, 2 along -Z, 3 along +X. */
  turn?: number;
}
