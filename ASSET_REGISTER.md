# Asset Register

Scale: 1 unit = 1 m; pivots at the feet / ground. Collision is defined in `src/sim/world/layout.ts`, never derived from meshes.

## Source assets and tools

| Asset | Source / licence | Pipeline | Output |
|---|---|---|---|
| Human body (mesh, UVs, morph targets for sex, ethnicity, weight, muscle, height) | MakeHuman base mesh and targets, **CC0** (makehuman-assets) | `tools/build_human.py`: remaps the 163-bone MakeHuman skeleton onto the game's 17 bones, re-poses A-pose to arms-down with linear-blend skinning, stores morph deltas | `public/assets/human/body.json`, `body.bin`, `skin_masks.png` |
| Cars, delivery van | Original, modelled in Blender 5.2 by script | `tools/blender/vehicles.py`: lofted body from side/plan profiles, subdivision, boolean wheel arches with liners, glass assigned by window line, tyres, 5-spoke rims, lights, bumpers, mirrors, plates | `public/assets/models/car.glb` (15.8k tris), `van.glb` (15.2k tris) |
| Supermarket gondola bay, checkout counter | Original, modelled in Blender 5.2 by script | `tools/blender/fixtures.py`: slatwall back, slotted uprights, shelves with lips, ticket rails and brackets; checkout with belt, rails, scanner, screens, card terminal, cash drawer, bagging shelf | `gondola_bay.glb` (3.9k tris), `checkout.glb` (1.5k tris) |
| Home furniture (sofa, bed, wardrobe, tables, chairs, TV unit, kitchen units, cooker, fridge, armchair, desk, sideboard, bedside, bookcase, drawers, basin) | Original, modelled in Blender 5.2 by script | `tools/blender/furniture.py` | `public/assets/models/*.glb` |
| Chore equipment and utility-room items (cardboard baler, dumpster, litter bin, washing machine, bin bag, carton, storage shelving, ironing board, laundry basket, drying rack, bicycle, vacuum) | Original, modelled in Blender 5.2 by script | `tools/blender/chores.py` | `public/assets/models/*.glb` |
| Warehouse (pallet racking bay with loaded pallets, pallet load, euro pallet, forklift, roller door) | Original, modelled in Blender 5.2 by script | `tools/blender/warehouse.py` | `rack_bay.glb`, `pallet_load.glb`, `pallet.glb`, `forklift.glb`, `roller_door.glb` |

Material named `paint` in any GLB is recoloured per instance in the game (car colours, shop accent colour).
Tools: `tools/blender/preview.py` renders a Cycles turntable sheet of a GLB, `tools/blender/stats.py` prints triangle counts.
Blender runs as the `bpy` Python module (`pip install bpy`); no Blender UI is needed.

## Generated at runtime (code)

| Asset | Where | Notes |
|---|---|---|
| Clothing | `src/render/humanAsset.ts` | Garments cut from the real body along smoothed scalar fields (exact triangle clipping): crew/V necklines, sleeves, hems. Fabric bridges hollows (no buttock/crotch shrink-wrap), trouser legs hang straight, shirts overlap the waistband. Apron is a hanging panel with neck strap and bow; blazer and hi-vis vest are field cuts. Woven fabric textures per kind (knit, denim, twill, suit, shirt, polo, hi-vis). |
| Hair | humanAsset.ts | Scalp cut along a style-specific hairline; long hair adds a fall built from the skull outline; bun mesh. |
| Eyes, skin shading | humanAsset.ts | Eyeballs with iris texture; skin uses UV masks for brows, lips, nails and cheeks. |
| Buildings, furniture, street props | `src/render/world.ts` | Interiors with plaster, ceilings, lights; facades (brick, render, cladding), windows, doors (sliding, swing, shutters), roofs; furniture and props. Static meshes are batched per material. |
| Surface textures | `src/render/textures.ts` | Canvas textures with matching generated **normal maps** (mortar, grout, slab joints, plank gaps, grain, grit, roof steps, cladding ribs). |
| Products | `src/render/products.ts` | Vertex-coloured product models in 5×2 facings; shelf counts equal real stock. |
| Signs | textures.ts `signTexture` | Canvas text. |
| UI fonts | Google Fonts (Archivo Black, IBM Plex Sans/Mono) | Loaded by URL with system fallbacks. |
| Audio | — | None yet. |

## Artifact builds
Artifact hosting does not serve `.bin`/`.glb`, so `scripts/make-artifact.mjs` also writes base64 `.txt` copies; `src/render/binary.ts` falls back to them.
