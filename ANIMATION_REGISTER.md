# Animation Register

Clips are keyframed procedurally (`CLIP_DEFS` in `src/render/character.ts`) on the shared rig, so every clip works on every body/outfit. The `AnimationController` picks the clip from **authoritative state** (current sim action, carried inventory, measured speed) and cross-fades (0.22 s). Animation never completes tasks.

| Clip | Used for | Loop | Status |
|---|---|---|---|
| idle | standing (breathing, head look) | yes | verified in screenshots |
| walk | locomotion < 2.6 m/s, rate scaled to speed (ref 1.5 m/s) | yes | verified |
| run | locomotion ≥ 2.6 m/s (ref 4.2 m/s) | yes | implemented |
| carry_idle / carry_walk | hands container non-empty | yes | verified (case visible in hands) |
| pickup | take_case, return_case, take_mop, return_mop, change_outfit | yes during action | implemented |
| stock | stock_shelf, pick_item, store_food | yes | verified in screenshot |
| scan | serve_customer, self_checkout | yes | implemented |
| type | clock_in / clock_out at terminal | yes | implemented |
| clipboard | check_in_delivery | yes | implemented |
| mop | clean (with mop prop on right hand) | yes | implemented |
| eat | eat, buy_meal | yes | implemented |
| sit | chair, bench | yes | implemented |
| lie | sleep (body rotated onto bed/bench) | yes | implemented |
| talk | reserved for conversations | yes | not yet triggered |

**Alignment**: starting an action snaps facing to the interactable's anchor facing; actions cancel if the actor moves or leaves range, returning to locomotion.
**Gaps**: no door-opening clip (doors are open gaps or closed props); no vehicle enter/exit (van driver is hidden while driving); no IK hand placement on shelves.
