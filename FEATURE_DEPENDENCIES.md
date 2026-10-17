# Feature Dependency Register

Each entry: description · player experience · systems · data · assets/animation · dependencies · acceptance · tests · status · limits · next.

## F1 Retail Assistant employment (Corner Market)
- **Experience**: find the vacancy, answer three interview questions, get an offer, wear the uniform, work real shifts, get paid.
- **Systems**: employment, actions/tasks, inventory, ledger, retail, NPC customers, UI phone, save.
- **Data**: `Vacancy`, `Application`, `Contract`, `Attendance`, `Task`, containers `shelf_*`, `market_backroom`, `market_bay`, `hands_*`.
- **Assets/anim**: market interior, terminal, gondolas, pallets, till, mop; clips `type`, `pickup`, `carry_*`, `stock`, `scan`, `mop`, `clipboard`.
- **Depends on**: F3 ledger, F4 inventory, F6 NPC customers, F7 logistics (deliveries to check in).
- **Acceptance**: ✔ vacancy reflects real headcount gap · ✔ offer only after review delay & score · ✔ clock-in refused without uniform · ✔ case pickup moves stock store room→hands · ✔ stocking moves hands→shelf unit by unit · ✔ serving requires customer at till; payment moves money/tax/goods · ✔ performance from lateness, tasks/hour, waiting customers, uniform, early leave · ✔ wages = minutes × rate, tax withheld, paid once · ✔ save/load mid-shift deterministic.
- **Tests**: `Journey A`, `Journey B`, `Journey I`; browser `scripts/playtest.mjs`.
- **Status**: playable. **Limits**: no in-person interview scene; promotion is a wage/title change.

## F2 Personal life (needs, home, food, sleep, wardrobe)
- Energy/food decay with visible effects (slower movement/work below thresholds). Bed sleep fast-forwards; bench sleep is poor rest. Kitchen eats real pantry/bag items. Wardrobe changes visible outfit.
- **Status**: playable. **Tests**: indirectly in Journey A; effects shown in Phone > Me.

## F3 Ledger & accounting
- Every money change is a `Txn` with reason/memo/ref; idempotency keys; audit; zero-sum including External and Aggregate accounts.
- **Acceptance**: ✔ no overdraft for people/firms · ✔ duplicates rejected · ✔ audit after 14 days · ✔ Σbalances = 0.
- **Status**: tested.

## F4 Inventory
- Containers with capacity/filter; moves are atomic; items only enter via imports/production and leave via consumption.
- **Status**: tested (capacity bug found and fixed in store room).

## F5 Housing & rent
- Weekly rent Mondays 09:00, arrears collected daily, late fee, eviction after 3 misses, re-rent recovery path, bench sleeping fallback (no softlock).
- **Status**: integrated; eviction path not yet covered by an automated test.

## F6 NPC simulation
- Decision layer (work > sleep > groceries > leisure > home) every 10 min; plan executor shares the player's validated actions; arrival verified by distance; replanning and stuck recovery; till pre-emption.
- **Status**: tested (14-day run). **Limits**: no avoidance; ambient shoppers pooled.

## F7 Supply chain & delivery van
- Manager reorders at 16:00 (only if a manager is employed); wholesaler dispatches at 06:30 if a driver is on shift; van drives road route; unload to bay; staff check-in counts goods into the store room and pays the invoice once.
- **Tests**: Journey F, Journey G (shortage → supply problem news, short deliveries, lost sales).
- **Status**: tested.

## F8 Aggregate economy & government
- District households earn from the rest of the country, pay tax, spend elsewhere and at the shop (via physical ambient shoppers) and café (statistical). Council spends surplus on public services. Wholesale regional trade limited by labour actually worked.
- **Status**: integrated. **Next**: recessions/booms changing `confidence`.

## F9 Save/load
- Versioned, validated (references, quantities, ledger audit), migration table, temp-write verification, backup slot, autosave every 3 real minutes.
- **Status**: tested.

## F10 Player-owned business (planned, next)
- **Depends on**: F3, F4, F7, employment (hiring), property (commercial lease), retail (reuse), UI.
- **Acceptance (draft)**: lease premises; buy fixtures; order opening stock (delivered, not instant); set prices & hours; serve customers yourself or hire from the labour pool; business P&L separate from personal account; profit/loss and cash flow visible.
