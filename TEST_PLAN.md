# Test Plan

## Automated (Vitest, `npm test`) — 13 tests, all passing
| Test | Covers |
|---|---|
| ledger | overdraft, invalid amounts, duplicate keys, audit, zero-sum |
| nav: edges vs colliders | every navigation edge is clear of walls/furniture |
| nav: connectivity | every node reachable |
| nav: anchors | every interactable reachable and not inside a collider |
| Journey A | apply → offer → hire → uniform rule → clock in → take case → stock → clock out → exact net wage → payroll idempotent → rent |
| Journey B ×3 | sale moves goods/money/tax exactly; partial affordability; unpaid basket returned when leaving |
| Journey F | order → van dispatch → arrival → check-in → single invoice, bay emptied |
| Journey G | milk shortage → supply news, low stock, lost sales |
| Journey H/J | 14-day run: identities, zero-sum, audit, no negative/over-capacity containers, attendance, trading, nobody stuck |
| Journey I ×2 | save mid-shift/mid-delivery resumes **bit-identically**; backup recovery; tampered ledger rejected |

## Browser playtest (`npm run e2e` / `scripts/playtest.mjs`)
Real Chromium (SwiftShader WebGL). Uses real keyboard input plus debug teleports for long walks. Checks: no console errors; walk; job board → phone; apply via interview dialog; offer appears and is accepted; wardrobe → uniform; clock in; take case; stock shelf; screenshots of street, job centre, store room, shop floor, till.
Last result: all steps pass, 0 console errors.

## Measurement scripts
- `scripts/simrun.ts N` — N-day economy log. `scripts/staffcheck.ts` — shop P&L with/without the morning assistant. `scripts/trace*.ts` — NPC activity traces.

## Not yet testable / not yet covered
- Journey C/D/E (player business, delegation, construction) — features not built.
- Journey K partially (variations visible in creator; no automated visual diff).
- Eviction path automated test; 8+ week economic stability.
