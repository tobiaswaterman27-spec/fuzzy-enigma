# Roadmap — THE BIGSHOT

Status vocabulary: **planned → implemented → integrated → tested → playable → polished**.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Assessment & foundation | **tested** | Build, typecheck, Vitest (14 tests), browser playtest (`npm run e2e`) |
| 1 | Player & world | **playable** | GTA-style over-the-shoulder camera with pointer lock and occlusion, interiors with walls/ceilings, 30+ buildings, day/night, sky, character creator, save/load, autosave |
| 2 | Functional workplace (Retail Assistant) | **playable** | Apply → in-person interview with the manager (answers, outfit, hygiene, punctuality, mood) → uniform → clock in → restock, serve, mop, check in deliveries; browser playtest verified |
| 3 | Personal economy & needs | **playable** | Wages with tax, rent, groceries, cooking, café; energy, food, hygiene, mood with real effects; clothes affect performance |
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
| Blender-modelled furniture (sofa, bed, kitchen, tables), street props | planned |
| Product packaging with printed labels | planned |
| Strand-like hair cards, better shoes | planned |

## Performance
- Body builds cached per appearance and limited to one per frame; fabric textures no longer read back from the GPU.
- People far away or inside other buildings are not drawn; distant people cast no shadows.
- Pixel ratio capped (1.5 high / 1.0 low); automatic drop to Low graphics if frames stay above ~35 ms.

## Next highest-priority tasks
1. Blender furniture for the flat and café; product packaging labels.
2. Second playable profession (Warehouse Operative at Harbour Wholesale).
3. NPC–NPC avoidance and queue spacing.
4. Long-run economy verification (8+ weeks), events.
5. Audio (ambience, till beeps).

## Change log
- **Checkpoint 1** — simulation core + tests.
- **Checkpoint 2** — playable 3D client (v1, v2).
- **v3** — player-owned business, GTA camera, hiring.
- **v4** — realistic people, in-person interviews, needs, usable furniture, no interaction through walls, world overhaul.
- **v5** — clothes hang naturally (bum fix), apron/long-hair rebuilt, render performance work.
- **v6** — normal-mapped surfaces, consistent road markings, Blender cars/van/gondolas/checkout, more parked cars.
