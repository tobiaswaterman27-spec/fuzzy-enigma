# Asset Register

All assets are **generated in code** (no external files, no third-party licences). Provenance: original to this project.

| Asset | Source | Notes |
|---|---|---|
| Characters (player, NPCs) | `src/render/character.ts` | Articulated low-poly rig, 17 joints, shared by all bodies. Variations: 6 skin tones, 5 hairstyles, 7 hair colours, 3 builds, 3 heights. Facial features: eyes, nose, mouth. |
| Outfits | `OUTFITS` in character.ts | Casual tee, smart shirt, Corner Market polo+apron+badge, hi-vis workwear with reflective stripes, café apron. Built on the same joints → no clipping by construction. |
| Buildings | `src/render/world.ts` from `layout.ts` | Functional (walkable interior, cutaway walls), simplified (shell + door, simulated inside), decorative (facade texture, clearly labelled "background" on the map). Canvas-generated signs and window textures. |
| Furniture & equipment | `buildObstacle` | Gondolas, checkout counter, self-checkout kiosk, staff terminal, pallets, cleaning cupboard, bed, kitchen with fridge, table, wardrobe, sofa, vacancy board, desk, benches, bins, bus shelters, trees, street lamps. |
| Stock visuals | `src/render/views.ts` | Instanced product boxes per shelf (count = real shelf inventory), case stacks per pallet (= store-room cases), bay stack (= loading bay contents), carried case (scaled by units in hands), mop. |
| Vehicles | `buildCar` | Parked cars (decorative, static), Harbour Wholesale van (simulated, drives). |
| Spills | views.ts | Decal scaled by dirt level. |
| UI fonts | Google Fonts (Archivo Black, IBM Plex Sans/Mono) | Loaded by URL with system fallbacks. |
| Audio | — | None yet (planned: WebAudio synthesis). |

Scale: 1 unit = 1 m; characters ~1.75 m. Pivots at feet. Collision is defined in `layout.ts`, not derived from meshes.
