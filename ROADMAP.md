# Roadmap — THE BIGSHOT

Status vocabulary: **planned → implemented → integrated → tested → playable → polished**.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Assessment & foundation | **tested** | Build, typecheck, Vitest (24 tests), browser playtest (`npm run e2e`), home-arrangement check (60 seeds) |
| 1 | Player & world | **playable** | Fully automatic follow camera, camera-relative movement with smooth acceleration, interiors with walls/ceilings, 30+ buildings, day/night, sky, character creator, save/load, autosave |
| 2 | Functional workplace (Retail Assistant) | **playable** | Apply → seated, real-time interview at the café (spoken questions from a role question bank, experience checks, interviewer personality) → uniform → clock in → restock, serve, mop, check in deliveries, face up shelves, bale cardboard, empty bins to the dumpster; staff roles (cashier, stocker, cleaner, supervisor, manager) |
| 2b | More playable jobs | **playable** | Warehouse Operative, Delivery Driver, Sales Assistant (Harbour Home), Kitchen Assistant / Cafe Cook (cook at the grill, serve at the counter) |
| 3 | Personal economy & needs | **playable** | Wages with tax, rent, groceries, cooking, café; energy, food, hygiene, mood with real effects; clothes affect performance; home chores (washing up, laundry in a washing machine, tidying) with effects on mood, shift grooming and interviews |
| 4 | NPC simulation | **tested** | Named NPCs with homes, jobs, rent, meals, sleep, shopping, job seeking; 14-day run keeps identities and attendance |
| 5 | Business operations | **playable** | Player can lease Dockside Unit 4: register, buy a till, set sections, prices, hours, order stock, invest/withdraw |
| 6 | Employees & management | **playable** | Player hires from the real labour pool, sets shifts, dismisses; NPC owners recruit |
| 7 | Property | **playable** | Buy the flat you rent with a 10% deposit and a 10-year mortgage, pay a weekly service charge, sell it back (equity after the mortgage), repossession after three missed payments; bank loans against your wages; Harbour Home furniture & decor store sells every home change (pay at the counter or order online, fitted later);  Residential and business leases, arrears, eviction, re-rent; no purchase yet |
| 8 | Construction | **playable** | Harbour Build Co. builds houses on two plots at the end of Harbour Road: groundworks, foundations, brickwork course by course, roof trusses and tiles, windows, finishing. Labourers (player or NPC) take the right tool from the site cabin or carry bricks from the pallet; an investor pays per stage; finished houses bring new households; the firm lays its labourers off with redundancy pay when both are done. Progress is visible on site (Heras fencing, cabin, mixer, scaffolding) |
| 9 | Transport & logistics | **playable** | Van drives real routes for both shops, cargo, receipt, invoicing; Harbour Wholesale is a walkable warehouse where Warehouse Operatives (player or NPC, evening shift) pick order lines from pallet racking into staging lanes that the morning van loads from; as a Delivery Driver the player drives the loaded van to the shop's bay and back (chase camera, collisions) |
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
| Real block of flats (Marlow Court), see-through windows | **integrated** (redesigned v19: glazed stair tower, render and cladding, glass balconies, solar roof, front garden, bin store, bike shelter) |
| Product packaging with printed labels | planned |
| Strand-like hair cards, better shoes | **integrated** (v12) |
| Faces: hair-stroke brows, lash line, lid crease, round irises, solid lashes | **integrated** (v17) |

## Performance
- Body builds cached per appearance and limited to one per frame; fabric textures no longer read back from the GPU.
- People far away or inside other buildings are not drawn; distant people cast no shadows.
- Pixel ratio capped (1.5 high / 1.0 low); automatic drop to Low graphics if frames stay above ~35 ms.

## Next highest-priority tasks
1. Goods-in put-away at the warehouse; forklift driving; traffic on the roads.
2. Faces, hair and shoes; props gripped properly (cases between the hands, picked items held then placed).
3. More step-by-step action sequences (cooking at the stove, getting changed at the wardrobe).
4. NPC–NPC avoidance and queue spacing; long-run economy verification (8+ weeks), events.
5. Sales Assistant at Harbour Home as a playable job; audio.

## Change log
- **Checkpoint 1** — simulation core + tests.
- **Checkpoint 2** — playable 3D client (v1, v2).
- **v3** — player-owned business, GTA camera, hiring.
- **v4** — realistic people, in-person interviews, needs, usable furniture, no interaction through walls, world overhaul.
- **v5** — clothes hang naturally (bum fix), apron/long-hair rebuilt, render performance work.
- **v6** — normal-mapped surfaces, consistent road markings, Blender cars/van/gondolas/checkout, more parked cars.
- **v7–v10** — motion capture, automatic camera, Blender furniture, Marlow Court block of flats, seated real-time interviews with spoken questions, staff roles, AI-arranged homes with decoration, see-through windows.
- **v17** — faces (brows, lash lines, round irises), food-hygiene inspections (0–5 ratings, stickers by the door, fines, demand effects), power cuts that close businesses; buy a car (Car tab), drive and park it anywhere, insurance and fuel; training courses at the Job Centre (food hygiene, driving licence with a test, forklift, supervision) that jobs and driving require; townspeople meet up in the park and chat (speech bubbles nearby); Saturday market in the park (stalls with traders, fresh produce, townspeople browse); lights go out in power cuts.
- **v16** — shares in local businesses (buy 5% stakes, Sunday dividends, sell back; with 25% buy the whole company — it keeps its staff and pays you its profit) in the Bank tab; friendships: chatting builds relationships (acquaintance → friend → close friend), invite friends for coffee at the cafe's corner table, People tab, friends lift mood, neglected friendships fade.
- **v15** — construction (build houses as a Site Labourer, visible stage by stage), Cafe Cook / Kitchen Assistant job, cafe keeps enough supplies.
- **v14** — buy your home (mortgage, sale, repossession), bank loans, sound (footsteps, tills, chimes, rain, traffic, engine, birds), relaxed idle stance, clean ribbed necklines, people step round each other, evening shelf stacker.
- **v13** — weather (deterministic rain spells: overcast sky, rain, fewer shoppers, wet and miserable outdoors, empty park), ambient traffic, Harbour Home furniture store with a playable Sales Assistant job, bread that looks like bread.
- **v12** — playable Delivery Driver (drive the van yourself), real shoes (trainers, oxfords, boots), strand hair, Blender fixtures and street furniture everywhere, cooking/tidying/eating acted out step by step, fuller job centre and cafe.
- **v11** — playable Warehouse Operative job at Harbour Wholesale (racking, pick lists, staging, dispatch). Flat rebuilt as a realistic 2-bed with spare room, dining area and utility room. Chores: facing up shelves, cardboard baler, litter bin and dumpster at work; washing up, laundry and tidying at home. New Blender models; messy shelves, cardboard piles, dirty dishes and clutter are visible.
