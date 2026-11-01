# Black Flag: art brief, ships and land

The copy to send to artists and sellers is the doc
[Black Flag art brief](https://claude.ai/artifact/AWrrzkfdKmhNtmuFtfM8dv); this one
also says how a file gets into the game.

For anyone making or selling us models. Black Flag is a pirate game that guests at a bar
play on their phones, in a web browser, while they have a drink. The game is written; we
need its ships, and then the land they sail past (Nassau's buildings, and the palms, trees
and rocks every island is planted with), to look as good as the rest of it.

## The look

Stylized, but richly detailed: the mood of the Black Pearl and the Flying Dutchman.
Weathered planking, heavy rigging, ornate stern galleries with lit windows, worn canvas.
Every ship should come from one artist or one pack, so the fleet looks like one world.

The land is the Bahamas in 1715: Nassau's plastered houses in pale colours under terracotta
roofs, a stone fort and a whitewashed church above the harbour, white sand, leaning palms
and jungle over the hills. Ships and land should come from the same artist or pack.

The ships are seen two ways:

- **In play**, from a chase camera about 135 m behind and above. The ship is a fifth of a
  phone screen, so her silhouette and colours matter more than fine texture.
- **Close up**, in the shipyard and on the title screen, where she is the whole picture.
  This is where the detail is seen.

The land is seen from the sea, from about 100 m to a kilometre off, so its outline and
colour carry it. Nassau is also seen closer, from the harbour, behind the title and port
screens.

## The first ship: the Jackdaw

The player's starting ship, so every guest sails her. A brig:

| | |
|---|---|
| Length of hull | 30 m (a bowsprit beyond that is fine) |
| Beam | 8 m |
| Rail above the water, amidships | 2.5 m |
| Masts | 2, square-rigged, three sails stacked on each, plus jibs; mainmast about 29 m above the water |
| Guns | 5 a side on one deck, and bow chasers on the foredeck |
| Stern | a raised castle with a stern gallery |
| Colours | near-black hull, a red band along the gun ports, red inside the bulwarks, tarred bottom; weathered off-white canvas with a skull and crossbones on the main course |

The other three player ships come after her, in the same style:

| Ship | Type | Hull length | Masts and rig | Guns a side | Character |
|---|---|---|---|---|---|
| Kestrel | sloop | 22 m | 1, fore-and-aft | 3 | fast and light; cream hull, navy trim, new white canvas |
| Marée Noire | schooner | 28 m | 2, fore-and-aft, square topsail on the fore | 4 | black hull, slate-grey canvas, long and low |
| Revenant | galleon | 46 m | 3, square-rigged | 9, on two decks | a Spanish galleon taken as a prize; dark oak, gilded stern, dark and weathered sails, which the game tears badly |

The Spanish navy (6 ships, 12–52 m) and four legendary ships (56–64 m) may follow.

## What a ship's file must be

**Format.** One GLB (binary glTF 2.0) per ship, plus the source file (.blend preferred).
No animations or skeleton are needed: the game moves the parts itself.

**Scale and direction.** Metres. Y is up. The bow points along +Z, glTF's forward. In
Blender, that means the bow points along −Y, so the Front view looks at her bow. The
origin should be on the waterline, amidships, on the centreline.

**Separate, named parts.** The game finds parts by the first word of an object's name.
Name them like this, with underscores (Blender's `.001` endings are fine):

| Name | What it is | Why it must be separate |
|---|---|---|
| `sail_…` | each sail | sails ripple and flog in the wind, and tear as she's shot |
| `rope_…` or `rigging_…` | the rigging | hidden when she's far away |
| `flag_…` | a plain flag where each of her colours flies | the game replaces it with its own flag, so she can surrender (strike) |
| `lid_L_1`, `lid_R_1`, … | each gun-port lid, its origin on its hinge along the top of the port | lids swing open as she clears for action. L is her left side looking forward, R her right |
| `gun_L_1`, `gun_R_1`, … | each cannon | guns run out through the ports and recoil when fired |
| `muzzle_L_1`, `muzzle_R_1`, … | an empty at each gun's mouth | where her shot and smoke leave from |
| anything else | the hull, decks and fittings | |

**Sails.** Model them whole and opaque. The game tears holes in them as she takes damage,
so don't model holes in. Wear, stains and patches in the texture are welcome.

**Lanterns and stern windows.** Make them emissive. The game turns them down by day and up
at dusk.

**Budget**, per ship:

| | Player ship | Navy ship |
|---|---|---|
| Triangles, all in | 15,000–25,000 | 8,000–20,000 |
| Of that, rigging | up to 4,000 | up to 3,000 |
| Materials | 3 at most: timber, canvas, metal and gilt | same |
| Textures | 2048 × 2048 at most, metal/roughness PBR: base colour, normal, and occlusion/roughness/metal packed in one | same |

Up to 30 ships can be on screen at once on a phone, so draw calls and texture memory
matter more than polygon count. Share texture atlases between parts, and don't use more
than three materials.

**Licence.** We need the right to use the model commercially in a web game and to modify
it. For a commission, we'd like the source files and full rights, and one quote for the
Jackdaw on her own and one for the rest of the fleet and the land together.

## The land: Nassau's buildings

Nassau is the pirates' harbour town, built up a hillside over the bay. The game lays it out
lot by lot for each new sea (`nassauSites` in `src/render/land/nassau.ts`), so it needs a
few variants of the common buildings rather than one fixed town.

| Building | Footprint, front × depth (m) | Height | Variants | Character |
|---|---|---|---|---|
| House | 4.5–7 × 4.5–6 | walls 3.5–4 m, or 6.3 m on two storeys | 4–6 | plastered walls in pale colours (cream, ochre, peach, pale blue, sage), painted shutters, hipped or gabled terracotta roofs; some with a veranda or a chimney |
| Shack | 3.6–4.8 × 3.4–4.2 | walls 2.6 m | 2 | weathered planks under a thatched or plank roof |
| Warehouse | 9–12 × 6.5 | walls 5.4 m | 2 | stone, on the quay: a cart door, a loft door with a hoist beam |
| Tavern | 8.5 × 5 | two storeys, 6.3 m | 1 | a hanging sign, and lanterns by the door |
| Church | 7.5 × 15 | walls 7.5 m; bell tower 14 m, plus its spire | 1 | whitewashed; the gable end is the front, the tower at a front corner |
| Governor's house | 13 × 9 | two storeys, 7 m | 1 | a two-storey gallery across the front, and a flagstaff in the yard |
| Fort | about 36 × 36 | curtain walls 5 m | 1 | square, a bastion at each corner, guns on the seaward faces, sentry boxes, barracks inside, a flagstaff |
| Lighthouse | within 11 × 11 | 20 m to the top of the lantern | 1 | a white tower with a red band, an iron gallery and a glass lantern; the keeper's cottage beside it |

The front is the street or harbour side. Each building is used at the size it's made,
scaled by at most a quarter to fit its lot. The quays, tents, market stalls, street
lanterns, cargo and boats stay drawn by the game for now, and could be a later batch.

## Trees and rocks

Every island is planted from these: palms along the beaches, jungle over the hills, scrub,
and rocks in the surf. A jungle island holds 150 or more canopy crowns, so they must be
light.

| Item | Size in the game | Variants | Character |
|---|---|---|---|
| Palm | 6–10 m tall | 3–4 | trunks that lean and curve, fronds that droop as they age; some with coconuts |
| Hardwood tree | 8–10 m tall | 2–3 | a crooked trunk and a broad crown |
| Jungle canopy | 5–14 m across | 3 | a crown of leaves with no trunk; packed together, they are the jungle seen from the sea |
| Bush | 2–4 m across | 2 | low scrub |
| Rock | 0.5 m to a 10 m crag | 4 | weathered limestone |

The game sets the size and turn of each tree and rock, so the size they're made at doesn't
matter. Palms, trees and leaves sway in the wind; the game does that, so no animation is
needed.

## What the land's file must be

**Format.** One GLB for the whole set of buildings, trees and rocks, plus the source file
(.blend preferred). In one file every prop shares the same textures, which a phone then
downloads and holds once.

- **Units:** metres, at real size. Y is up.
- **Props:** each prop is its own top-level object, or an empty with its parts under it.
  Lay them out side by side, anywhere in the scene.
- **Direction:** a building's front faces +Z (in Blender, −Y, so the Front view looks at
  its door). A palm leans toward +Z.
- **Origin:** a building's is on its ground floor, in the middle of its footprint. Carry its
  foundations about 1.5 m below that, so it can stand on a slope. A palm's or tree's is at
  the foot of its trunk. Rocks and bushes can have it anywhere.
- **Leaves:** cut-out (alpha clip) is fine; nothing needs alpha blending.
- **Lit windows and lanterns:** emissive, as on the ships.

**Names.** The game knows each prop by the first word of its name; the rest of the name
tells variants apart. Use underscores.

| Name | What it is |
|---|---|
| `house_a`, `house_b`, … | each house. The same goes for `shack_…`, `warehouse_…`, `tavern`, `church`, `governor`, `fort` and `lighthouse` |
| `palm_1`, `tree_1`, `canopy_1`, `bush_1`, `rock_1`, … | each plant and rock |
| `flag_…` | inside a building: an empty at the top of each flagstaff. The game flies its own flag there |
| `light` | inside the lighthouse: an empty at the middle of its lamp, where the beam turns |
| `leaf_…` or `frond_…` | the leaves of a palm or tree, if they're separate objects. They flutter in the wind; without them, the top of the tree flutters |

**Budget**, per prop:

| | Triangles |
|---|---|
| House, shack | 1,000–3,000 |
| Warehouse, tavern | 2,000–5,000 |
| Church, governor's house, lighthouse | 4,000–8,000 |
| Fort | 10,000–20,000 |
| Palm, hardwood tree | 400–1,000 |
| Jungle canopy, bush, rock | 100–300 |

Put the whole set on at most three shared texture atlases (buildings, plants, rock), each
up to 2048 × 2048, PBR as for the ships. One material per prop is best: every material a
prop uses is another draw on every island.

## Buying a pack instead

Before buying, check the listing (or ask the seller):

1. Are the sails separate objects? Without them, sails can't move or tear.
2. Are gun-port lids and guns separate? Without them, she can't clear for action. That's
   acceptable, but worth knowing.
3. Is the triangle count within the budget above, or close enough to reduce?
4. Does the licence cover a commercial web game?
5. Does the pack, or the artist, have enough ships for the whole fleet in one style?
6. Is it available as glTF, FBX or .blend?
7. For the land: are the buildings Caribbean colonial (plaster, terracotta, timber), not
   medieval European?
8. Are the trees and rocks separate objects, with leaves cut out rather than blended?
9. Do the props share a few texture atlases, rather than a texture set each?

## How it gets into the game

`npm run ships:pack -- ship.glb jackdaw` packs the textures into the file, caps them at
1024 px for phones, and compresses the textures and geometry into
`public/ships/jackdaw.glb`. The ship's entry in `src/data/ships.ts` then points at it. A
file whose parts are named some other way (a bought one) gets `--names map.json`, which
renames and drops nodes before packing; `scripts/ships/stylized-pirate-ship.json` is one.
Until the file has downloaded, or if it ever fails, the game draws the code-built ship
instead.

The land is the same: `npm run props:pack -- nassau.glb nassau` writes
`public/props/nassau.glb`, and its entry in `src/data/props.ts` (a `PropSet`) dresses the
islands from it. A pack sold as a file per prop is given whole, every file at once, and put
into one: `scripts/props/kenney-land.json` renames Kenney's palms, rocks and beach hut that
way. Any kind with no model in the set (a church, say, or the jungle canopy) is still built
or grown by code, and so is all of it until the set arrives.

The menu's Models setting draws everything from code instead, to compare the two.

The rules above are tested in `tests/models.test.ts` and `tests/props.test.ts`, and read by
`src/render/ships/gltf.ts` and `src/render/land/props.ts`.
