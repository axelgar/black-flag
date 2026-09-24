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
}

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
}

/** A ship model is either built from a recipe or loaded. Every ShipModel honours both. */
export type ModelSpec =
  | { kind: 'procedural'; recipe: HullRecipe }
  | { kind: 'gltf'; url: string; scale: number; fallback: HullRecipe };

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
