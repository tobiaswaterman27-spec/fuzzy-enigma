# Roadmap — THE BIGSHOT

Status vocabulary: **planned → implemented → integrated → tested → playable → polished**.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Assessment & foundation | **tested** | Build, typecheck, Vitest (16 tests), browser playtest (`npm run e2e`), home-arrangement check (60 seeds) |
| 1 | Player & world | **playable** | Fully automatic follow camera, camera-relative movement with smooth acceleration, interiors with walls/ceilings, 30+ buildings, day/night, sky, character creator, save/load, autosave |
| 2 | Functional workplace (Retail Assistant) | **playable** | Apply → seated, real-time interview at the café (spoken questions from a role question bank, experience checks, interviewer personality) → uniform → clock in → restock, serve, mop, check in deliveries, face up shelves, bale cardboard, empty bins to the dumpster; staff roles (cashier, stocker, cleaner, supervisor, manager) |
| 3 | Personal economy & needs | **playable** | Wages with tax, rent, groceries, cooking, café; energy, food, hygiene, mood with real effects; clothes affect performance; home chores (washing up, laundry in a washing machine, tidying) with effects on mood, shift grooming and interviews |
| 4 | NPC simulation | **tested** | Named NPCs with homes, jobs, rent, meals, sleep, shopping, job seeking; 14-day run keeps identities and attendance |
| 5 | Business operations | **playable** | Player can lease Dockside Unit 4: register, buy a till, set sections, prices, hours, order stock, invest/withdraw |
| 6 | Employees & management | **playable** | Player hires from the real labour pool, sets shifts, dismisses; NPC owners recruit |
| 7 | Property | partial | Residential and business leases, arrears, eviction, re-rent; no purchase yet |
| 8 | Construction | planned | — |
| 9 | Transport & logistics | **integrated** | Van drives real routes for both shops, cargo, receipt, invoicing |
| 10 | Connected regional economy | partial | District demand split between competing shops, wholesale trade, government |
| 11–13 | Corporate, national, polish | planned | — |

## Visual realism track (from playtest feedback)
| Item | Status |
|---|---|
| Realistic people (MakeHuman CC0 bodies, body/skin/hair variety) | **integrated** |
| Clothing that hangs like fabric (no shrink-wrap), real apron, blazer, long hair | **integrated** (v5) |
| Surface relief (normal maps) on all procedural surfaces | **integrated** |
| Blender-modelled assets: cars, van, gondola shelving, checkout | **integrated** |
| Blender-modelled furniture (sofa, bed, kitchen, tables, armchair, desk, sideboard, bathroom) | **integrated** |
| Blender-modelled chore equipment (baler, dumpster, litter bin, washing machine, bin bag, cartons) | **integrated** (v11) |
| CMU motion capture retargeted to the body (walk, run, idle, sit down/stand up, wash, cook, mop, …) | **integrated** |
| Seeded interior designer for homes; wallpaper, flooring, rugs and extras in a Home tab | **integrated** |
| Real block of flats (Marlow Court), see-through windows | **integrated** |
| Product packaging with printed labels | planned |
| Strand-like hair cards, better shoes | planned |

## Performance
- Body builds cached per appearance and limited to one per frame; fabric textures no longer read back from the GPU.
- People far away or inside other buildings are not drawn; distant people cast no shadows.
- Pixel ratio capped (1.5 high / 1.0 low); automatic drop to Low graphics if frames stay above ~35 ms.

## Next highest-priority tasks
1. Second playable profession (Warehouse Operative at Harbour Wholesale): walkable warehouse, picking for shipments.
2. Faces, hair and shoes; props gripped properly (cases between the hands, picked items held then placed).
3. More step-by-step action sequences (cooking at the stove, getting changed at the wardrobe).
4. NPC–NPC avoidance and queue spacing; long-run economy verification (8+ weeks), events.
5. Furniture shop and jobs for home customisation; audio.

## Change log
- **Checkpoint 1** — simulation core + tests.
- **Checkpoint 2** — playable 3D client (v1, v2).
- **v3** — player-owned business, GTA camera, hiring.
- **v4** — realistic people, in-person interviews, needs, usable furniture, no interaction through walls, world overhaul.
- **v5** — clothes hang naturally (bum fix), apron/long-hair rebuilt, render performance work.
- **v6** — normal-mapped surfaces, consistent road markings, Blender cars/van/gondolas/checkout, more parked cars.
- **v7–v10** — motion capture, automatic camera, Blender furniture, Marlow Court block of flats, seated real-time interviews with spoken questions, staff roles, AI-arranged homes with decoration, see-through windows.
- **v11** — chores: facing up shelves, cardboard baler, litter bin and dumpster at work; washing up, laundry and tidying at home. New Blender models; messy shelves, cardboard piles, dirty dishes and clutter are visible.
