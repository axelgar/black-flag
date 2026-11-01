// The shapes every piece of content is written in. Pure data — the simulation reads the
// numbers, the renderer reads the recipes, and neither needs to know the other exists.

export interface Palette {
  hull: string;     // topsides
  wale: string;     // the stripe along the gunports
  bottom: string;   // below the waterline — tar, or copper on a rich ship
  deck: string;
  rail: string;     // gunwale, masts, spars
  sail: string;
  trim: string;     // port lids, stern gallery, her owner's colour
  inside?: string;  // the inboard face of her bulwarks — warships painted them red
}

export type Emblem = 'none' | 'cross' | 'skull';

export type Rig = 'square' | 'fore-aft' | 'lateen' | 'none';
export type Stern = 'transom' | 'castle' | 'galleon' | 'pointed';
export type FlagKind = 'black' | 'spain' | 'england' | 'white' | 'crimson' | 'gold';

/** Everything the procedural builder needs to draw a hull. Lengths in metres. */
export interface HullRecipe {
  length: number;
  beam: number;
  freeboard: number;     // waterline to rail, amidships
  draft: number;
  sheer: number;         // how far bow and stern rise above amidships
  stern: Stern;
  forecastle: boolean;
  bowsprit: boolean;
  masts: number;
  rig: Rig;
  mastHeight: number;    // tallest mast, as a multiple of length
  tiers: number;         // square sails stacked per mast
  gunsPerSide: number;   // ports drawn per side, per deck
  gunDecks: number;
  oars?: boolean;
  flag: FlagKind;
  palette: Palette;
  /** How weathered her canvas is at full hull: 0 new from the loft, 0.3 a ghost. Shot adds to it. */
  tatter?: number;
  /** Painted on her main canvas, in `ink`. */
  emblem?: Emblem;
  ink?: string;
  /** Carved and gilded stern and head. Galleons have it whether it is asked for or not. */
  gilt?: boolean;
  /** Bow chasers on her foredeck, where they can be seen. */
  chasers?: boolean;
  /** A square topsail over a fore-and-aft foremast: a topsail schooner. */
  squareTops?: boolean;
}

/** A ship modelled by hand and exported as a GLB, drawn in place of her recipe. What the
 *  file must hold is set out at the top of src/render/ships/gltf.ts. */
export interface ModelFile {
  url: string;
  /** Quarter turns that bring her bow round to the file's +Z, glTF's forward: 1 if it
   *  points along -X, 2 along -Z, 3 along +X. */
  turn?: number;
  /** She is scaled so her overall length is her recipe's. This replaces that with a plain
   *  factor on the file's own units. */
  scale?: number;
  /** Metres she is raised by once scaled: how far below the file's origin her waterline is. */
  lift?: number;
}

/** A set of land models in one GLB: buildings, trees, rocks, each a top-level node named by
 *  what it is (`house_a`, `palm_2`). What a set must hold is set out at the top of
 *  src/render/land/props.ts. */
export interface PropSet {
  url: string;
  /** Quarter turns that bring the file's fronts (a door, a palm's lean) round to its +Z:
   *  1 if they face along -X, 2 along -Z, 3 along +X. */
  turn?: number;
  /** A plain factor on the file's own units, for a set not made in metres. Trees and rocks
   *  are sized by the game whatever their units; this is for buildings. */
  scale?: number;
}

/** A ship model is either built from a recipe or loaded. Every ShipModel honours both. A
 *  loaded one is drawn from her recipe until her file arrives, or if it never does: the
 *  recipe also sets her length and beam, which the simulation sails by. */
export type ModelSpec =
  | { kind: 'procedural'; recipe: HullRecipe }
  | { kind: 'gltf'; file: ModelFile; fallback: HullRecipe };

export interface BowGun { reload: number; dmg: number; range: number }

/** The player's base numbers, before Nassau's per-run upgrades. */
export interface ShipBase {
  hull: number;
  maxSpeed: number;        // m/s at full sail
  accel: number;           // m/s²
  turnRate: number;        // rad/s at full way
  gunsPerSide: number;
  broadsideReload: number; // seconds, per side
  shotDmg: number;
  shotSpeed: number;       // m/s
  shotRange: number;       // m
  bowGun: BowGun | null;
  shellsMax: number;
  boardRepair: number;
  ramDmg: number;
  lives: number;
}

export type AbilityId = 'none';

export interface ShipDef {
  id: string;
  name: string;
  rank: string;
  blurb: string;
  base: ShipBase;
  model: ModelSpec;
  /** Hook for later — a signature move per hull. None ship yet. */
  ability: AbilityId;
  unlock: 'starter' | { code: string };
}

export type GunKind = 'none' | 'aimed' | 'beam' | 'broadside' | 'mortar';

export interface FoeClass {
  id: string;
  name: string;
  rank: string;
  note: string;
  hull: number;
  speed: number;         // m/s
  turn: number;          // rad/s
  reales: number;
  ram: number;           // what touching her costs you
  strikes: boolean;      // whether she strikes her colours
  guns: GunKind;
  gunsPerSide: number;
  reload: number;
  range: number;
  shotDmg: number;
  prefRange: number;     // where she likes to fight from
  sight: number;         // how far she sees you on a clear day
  recipe: HullRecipe;
  /** Drawn from this file once it has loaded; from her recipe until then. */
  model?: ModelFile;
}

export type LegendPattern = 'sweep' | 'shroud' | 'rain' | 'spiral';

export interface LegendDef {
  id: string;
  name: string;
  note: string;
  hull: number;
  speed: number;
  turn: number;
  reales: number;
  pattern: LegendPattern;
  ports: number;         // weak points, split between the two sides
  recipe: HullRecipe;
}
