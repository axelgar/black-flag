# Black Flag: art brief

The copy to send to artists and sellers is the doc
[Black Flag art brief](https://claude.ai/artifact/AWrrzkfdKmhNtmuFtfM8dv); this one
also says how a file gets into the game.

For anyone making or selling us models. Black Flag is a pirate game that guests at a bar
play on their phones, in a web browser, while they have a drink. Captains fight each other
on a small sea, and a fight is over in seconds. We need three ships, a set of islands, and
three floating crates, in a bright cartoon style like Brawl Stars.

## The look

Brawl Stars at sea: chunky shapes, exaggerated proportions, bold silhouettes and saturated
colours. Nothing realistic: no weathered planking, no fine rigging, no rust or grime.

- **Shapes:** big and simple. A ship reads at a glance by its outline and its colours.
  Rigging is a few thick ropes at most, or none.
- **Colour:** flat colours, or simple hand-painted gradients. Don't bake light and shadow
  into the textures. The game shades the models itself with hard cartoon steps, and draws
  dark outlines round them.
- **One world:** all three ships, the islands and the crates come from one artist, or one
  pack, so they look like they belong together.

## How it's seen

One camera only: fixed, high, looking down at about three-quarters from the south, as in
Brawl Stars. North is always up and the camera never turns.

- **At sea:** a ship is about a tenth of the screen's width on a phone held sideways. The
  deck, the sails seen from above and the outline seen from above matter most. The hull's
  sides are seen at a slant.
- **Close up:** on the screen where a player picks a ship, the three ships are shown side
  by side, large. That's where detail is seen.

Up to 30 ships share a sea and 10 or so are on screen at once, on phones as old as an
iPhone 11. Keep models light (see the budget below).

## The ships

There are three ships. They play exactly the same, so they must be the same size: about
24 m long and 8 m wide at the widest, bowsprit not counted. A hit then counts the same on
each. Only their look differs. The game gives each player a colour, so their sails and
flag are tinted to it.

| Ship | Character |
|---|---|
| The Jackdaw | the classic pirate ship: black hull, red trim, two masts, a skull on the mainsail |
| Second ship | your pitch, as different from the Jackdaw as possible at the same size: for example a gaudy captured Spanish treasure ship in red and gold |
| Third ship | your pitch again: for example a patched-up raider, or a ghost ship |

What each ship needs:
- **Sails:** each sail its own object, plain white or cream. The game draws them as plain
  cloth in the player's colour, so any texture painted on a sail is not seen. A skull or
  emblem goes in a separate decal object.
- **Flag:** a plain flag on its own, at the top of the mainmast. The game flies its own
  flag in its place.
- **Cannons:** a row along each side is welcome. The guns on the side facing the aim fire,
  so cannon ports should show on both sides.
- **No animation.** The game rocks the ship, fills the sails, recoils and sinks her.

## The islands

Islands are cover: they stop cannonballs and break line of sight. The game treats each one
as a circle when stopping shots, so it should be roughly round seen from above.

| Size | Across | How many |
|---|---|---|
| Small | 20–30 m | 3 |
| Medium | 40–60 m | 3 |
| Large | 70–100 m | 2 |

- **Character:** bright sand, a ring of shallow water drawn by the game round it, palms,
  rocks, a little jungle. Some sandy, some rocky. One could hold a pirate landmark: a
  wreck, a skull rock, a hut.
- **Keep them low.** The camera looks down from the south, so anything tall hides the
  ships just north of it. Hills up to about 6 m and palms up to about 8 m.
- **Loose props:** 2–3 palms and 3 rocks as separate objects, so the game can scatter
  more.

## The crates

Three kinds of floating barrel or crate that ships sail into to pick up. Each is about 3 m
across and must be told apart from above at a glance, by colour and by an icon on top.

| Crate | Colour | Icon on top |
|---|---|---|
| Repair | green | a hammer, or planks and a cross |
| Speed | yellow (blue is lost on the sea) | a lightning bolt, or a full sail |
| Heavy shot | red | a big cannonball, or a skull |

The game makes them bob and spin.

## The water

The game draws the sea itself, as flat cartoon water with crisp foam. Give us the colours
for it in a palette sheet:
- deep water, open water, and the shallows round an island;
- foam;
- sand.

Each player is shown in one of about seven colours, on their sails and flag. They must
stay clear on that water and apart from each other, to colour-blind eyes too. We'll pick
them together with your palette.

## What a file must be

**Format.** One GLB (binary glTF 2.0) per ship, one for the islands, crates and props
together, and the source files (.blend preferred).

**Scale and direction.** Metres. Y is up. A ship's bow points along +Z, glTF's forward. In
Blender, that means the bow points along −Y, so the Front view looks at her bow. A ship's
origin is on the waterline, amidships, on the centreline. An island's origin is at the
middle of its footprint, at sea level.

**Textures.** Everything shares one small palette texture: 256 × 256 or 512 × 512, colour
swatches with the faces mapped onto them, as low-poly packs do. Add a second texture only
for the emblems, at 512 × 512 at most. One material for everything is best. Every extra
material is another draw for every ship on screen.

**Names.** The game finds parts and props by the first word of an object's name. Use
underscores (Blender's `.001` endings are fine):

| Name | What it is |
|---|---|
| `sail_…` | each sail, white or cream: the game draws it in the player's colour |
| `flag_…` | a plain flag where the colours fly: the game replaces it |
| `muzzle_L_1`, `muzzle_R_1`, … | optional: an empty at each gun's mouth, where shots leave from. L is her left side looking forward, R her right |
| `island_s1`, `island_m1`, `island_l1`, … | each island, by size (small, medium, large) |
| `crate_repair`, `crate_speed`, `crate_heavy` | the crates |
| `palm_1`, `rock_1`, … | loose props |

**Closed meshes.** The outline the game draws is a copy of the model pushed out a little
along its normals. Single-sided planes (except sails and flags) and gaps between parts show
through it. Keep hulls, islands and crates closed.

**Budget:**

| | Triangles |
|---|---|
| Ship | 2,000–6,000 |
| Small island | up to 2,000 |
| Medium island | up to 4,000 |
| Large island | up to 6,000 |
| Crate | 200–600 |
| Palm | 200–500 |
| Rock | 50–200 |

**Licence.** We need the right to use the models commercially in a web game and to modify
them. For a commission, we'd like the source files and full rights, and one quote for the
whole set: three ships, the islands and props, the crates and the palette sheet.

## Buying a pack instead

Check the listing, or ask the seller:

1. Is it cartoon or low-poly, bright and chunky, not realistic?
2. Are there at least three different ships at about the same size?
3. Are the sails separate objects, so they can take a player's colour?
4. Do the models share one palette texture, or a few small atlases?
5. Is the triangle count within the budget above?
6. Does the licence cover a commercial web game?
7. Is it available as glTF, FBX or .blend?

The game uses Kenney's free Pirate Kit as stand-ins until the real models arrive. It is a
good example of the format: one shared palette texture, clean low-poly shapes. Ours should
go further in character and detail.

## How it gets into the game

`npm run ships:pack -- ship.glb jackdaw` packs the textures into the file, caps them at
1024 px for phones, and compresses the textures and geometry into
`public/ships/jackdaw.glb`. The ship's entry in `src/data/ships.ts` then points at it. A
file whose parts are named some other way (a bought one) gets `--names map.json`, which
renames and drops nodes before packing; `scripts/props/kenney-land.json` is one.

The islands, crates and props are the same: `npm run props:pack -- set.glb sea` writes
`public/props/sea.glb`, and its entry in `src/data/props.ts` (a `PropSet`) dresses the sea
from it. A pack sold as a file per prop is given whole, every file at once, and put into
one.

Ships are only drawn from model files: the game waits for the ship's file before it sails.
How the game reads a file is tested in `tests/models.test.ts` and `tests/props.test.ts`,
and lives in `src/render/ships/gltf.ts` and `src/render/land/props.ts`. Both are reworked
for this brief in the MVP (`PLANS/MVP.md`).
