# Project Assessment — THE BIGSHOT

_Last updated: Day 1 of development (see git log for dates)._

## Starting state (inspection)
- The repository contained only `MasterPrompt` (the specification). No engine, code, assets, build, tests or saves existed. Two commits, clean tree, no uncommitted user work.
- Environment: Linux container, Node 22, Chromium + Playwright 1.56 available. **No Blender, Godot, Unity or GPU**; WebGL runs via SwiftShader for testing.

## Engine & architecture decision
- **Browser game: TypeScript 5.9 + Three.js 0.180 (WebGL2) + Vite 7.** Chosen because it is the only full 3D pipeline available here, it builds and runs headless for automated testing, and it can be published as a playable artifact.
- **Strict split between simulation and presentation.**
  - `src/sim/` — pure TypeScript, no Three.js. The whole game state is plain JSON (`GameState`), advanced by `step(state, gameMinutes)`. Deterministic (seeded RNG stored in state). Runs in Node for tests.
  - `src/render/` — Three.js views that *read* state (characters, world, stock, van). They never change state.
  - `src/game/` — game loop, player controller, camera, save slots.
  - `src/ui/` — HTML HUD/phone/menus that call sim functions; they never invent results.
- Static world geometry (`src/sim/world/layout.ts`) is code, shared by collision, navigation, interaction anchors and rendering, so they cannot disagree.

| Spec module | Implementation |
|---|---|
| WorldSimulation / TimeAndCalendar | `sim/sim.ts`, `sim/clock.ts` (fixed sub-steps, every whole minute processed once) |
| TransactionSystem / AccountingSystem | `sim/ledger.ts` (idempotency keys, audit, compaction) |
| InventorySystem | `sim/inventory.ts`, `sim/items.ts` |
| EmploymentSystem / TaskAndJobSystem | `sim/employment.ts`, `sim/actions.ts`, tasks in `sim/retail.ts` |
| BusinessSimulation / MarketSimulation | `sim/retail.ts`, `sim/economy.ts` |
| SupplyChainSystem / VehicleSystem | `sim/logistics.ts` |
| PropertySystem (leases only) | `sim/housing.ts` |
| NPCSimulation / Navigation | `sim/npc.ts`, `sim/world/nav.ts` |
| EventAndNewsSystem | `sim/events.ts` |
| SaveLoadSystem | `sim/save.ts` |
| CharacterAppearance / AnimationController | `render/character.ts` |
| UIController | `ui/ui.ts` |
| DiagnosticsAndTesting | `tests/sim.test.ts`, `scripts/*.ts|mjs` |

## Build & run
- `npm install`, `npm run dev` (play at localhost:5173), `npm run build` (typecheck + bundle to `dist/`), `npm test` (Vitest), `npm run e2e` (Playwright browser playtest; needs `npx vite preview --port 4173` running).
- Debug hook: `window.__bigshot = { game, ui, sim }`. `?skipcreator` skips the character creator.

## Time model
- 1 real second = 1/3 game minute at 1× (a 6-hour shift ≈ 18 real minutes; 2×/4×/8× available; sleeping fast-forwards at 45 game-min/s).
- Reason: with faster clocks, walking (1.5 m/s) became absurdly slow in game-time terms and starved every business of labour (measured: 380 walking minutes per 4 cases stocked).

## Risks
- **Scope**: the spec covers a national simulation; only a single district slice exists.
- **Art**: no modelling tool; characters and buildings are procedural low-poly. Consistent but simple.
- **Performance**: fine at ~30 people; the aggregate population model exists to avoid simulating thousands individually.
- **Economy balance** is tuned by measurement scripts (`scripts/staffcheck.ts`); long runs (>4 weeks) not yet verified.

## Known defects / limitations (honest list)
- NPCs do not physically avoid each other (they can overlap in queues/doorways).
- Ambient shoppers are pooled identities for the aggregate district population (stable ids, but no homes).
- Café kitchen and wholesale warehouse are *simplified* locations (simulated statistically, not walkable).
- Only the Retail Assistant job is playable. Other vacancies are clearly labelled "not yet playable".
- Rent eviction recovery exists but has no in-world estate-agent location yet (done via phone).
- The artifact build is verified in local Chromium; behaviour inside the hosted artifact frame is not independently verified.
