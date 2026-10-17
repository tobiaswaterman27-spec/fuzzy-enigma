# Roadmap — THE BIGSHOT

Status vocabulary: **planned → implemented → integrated → tested → playable → polished**.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Assessment & foundation | **tested** | Build, typecheck, Vitest suite, Playwright playtest all run |
| 1 | Player & world | **playable** | Movement, collision, camera with occlusion pull-in, cutaway interiors, 30+ buildings, day/night, character creator, save/load |
| 2 | Functional workplace (Retail Assistant) | **playable** | Clock in (uniform enforced), restock from store room, serve at till, mop spills, check in deliveries, clock out; browser playtest verified |
| 3 | Personal economy | **tested / playable** | Wages via payroll with tax, rent, groceries, café meals, bank history; Journey A test exact to the cent |
| 4 | NPC simulation | **integrated / tested** | 14 named NPCs with homes, jobs, rent, meals, sleep, shopping; 14-day run keeps identities & attendance |
| 5 | Business operations | **integrated** (NPC-owned) | Corner Market stock, supplier, reorders, P&L stats, reputation; *player ownership not yet* |
| 6 | Employees & management | partial | NPC recruitment from labour pool, manager delegation of purchasing; no player-run hiring UI |
| 7 | Property | partial | Residential leases, arrears, eviction, re-rent. No purchasing/commercial property |
| 8 | Construction | planned | — |
| 9 | Transport & logistics | **integrated** | Van drives route, cargo loaded/unloaded, verified receipt, invoicing; driver must be on shift |
| 10 | Connected regional economy | partial | Aggregate district, wholesale regional trade, government revenue/spending |
| 11–13 | Corporate, national, polish | planned | — |

## Next highest-priority tasks
1. **Player-owned business (Milestone 5/6)** — lease the vacant Dockside Unit 4 (currently a background building) and open a shop: buy fixtures and stock from Harbour Wholesale, set prices/hours, hire from the real labour pool. Reuses retail, logistics and employment systems.
2. **Second playable profession** — Warehouse Operative at Harbour Wholesale (make the warehouse walkable; picking orders for the real van shipments).
3. NPC–NPC avoidance & queue spacing; talk interaction with NPCs (relationships).
4. Long-run economy verification (8+ weeks) and recession/recovery events.
5. Audio (ambience, till beeps) via WebAudio synthesis.

## Change log
- **Checkpoint 1** — simulation core + tests.
- **Checkpoint 2** — playable 3D client, published as artifact (v1, v2). Fixed: phone re-render swallowing clicks, instanced shelf stock culled, camera inside buildings, actions continuing after leaving range.
