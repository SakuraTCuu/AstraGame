# Replica Requirements and Evidence

The objective remains behavior parity with the WeChat game Zhenxieren, including its world map, free combat, fog and unlocking, flashlight, 2.5D presentation, exploration, navigation, squad formation, skills, damage, enemy/Boss targeting and state machines. The implementation must remain usable within the Zhushen H5 foundation. A working graybox or passing unit tests do not satisfy this objective alone.

## Reference identity

- WeChat AppID: `wxd53170210eef737f`.
- User-provided screenshots from task `01a06b72-3422-7ca3-8f2e-c60988987fdb`: portrait world exploration, four active party slots, auto-route markers, healing feedback and formation screens.
- Direct Windows Computer Use observation on 2026-09-05: the running game exposed a Boss encounter, a connected multi-region world-map overview, a level-15 region gate, and compact party movement. The observed account progressed through levels 10 and 11, so it is not a frozen new-player replay.
- Direct repair interaction on 2026-09-05: an unbuilt teleport platform displayed a cost of 5. Clicking it changed the visible resource balance from 299 to 294 and replaced the unbuilt platform with its completed appearance. This confirms paid platform repair, not every fog-unlock condition.
- A later same-day roster observation showed five deployed heroes on the level-17 account, eight formation positions and a rank requirement on the sixth position. The four-character comparison preset therefore does not represent the reference's full roster capacity.
- Native character-trait observation on 2026-09-06 confirmed hero 26's displayed 25% general damage bonus, 10% periodic bonus and 2% normal-attack energy return. The first two belong to the character itself. Energy timing remains under comparison.
- A second character-panel observation confirmed hero 8 also displays a 2% normal-attack energy return. The adapter now separates normal and tactical gains; the exact live regeneration and hit-timing rules remain under comparison.
- A public nine-second clip linked from `https://www.17yoo.cn/detail/57220` was inspected and excluded: it depicts a landscape single-character interface, inconsistent with the user's reference. Its extracted contact sheet remains in ignored `reference-private/`.

## Requirement audit

| Requirement | Current implementation evidence | Remaining parity work |
| --- | --- | --- |
| World map | First reference world geometry, complete detailed ground, panning/zooming overview and source portals | Compare the original overview's connected-tile styling and extend to other main-world maps |
| Free combat and exploration | Movement and AI share collision/navigation | Compare manual movement, auto travel and combat interruption with repeated live observations |
| Fog and unlocking | 59 source polygon gates; source experience, mainline/first-kill claims, first rank promotion and NPC interactions; UI purchase and reload verified | Complete later account/mode prerequisites and compare exact fog appearance and transition timing |
| Flashlight | Source regional switches, ambient/cone rendering and directional pixel checks | Match aim switching, softness and range against live observations |
| 2.5D presentation | Reference ground/characters, source grid projection, actor Y ordering and 549 foreground polygons | Broaden foreground alignment checks and provide owned/licensed release art |
| Automatic navigation | A*, overview POI and source quest destinations, approach blocking fog gates and resume after payment, manual override | Match original route markers and resume timing; verify long routes across all regions |
| Multiple characters | Eight rank-gated positions, owned-hero deployment and swaps, navigation-aware follow, surviving leader selection, per-position equipment and table-driven levels | Complete remaining hero skill/art adapters; compare compact movement formation, roster changes and companion/pet behavior |
| Skills and damage | Source skill coefficients/timelines, multi-target projectiles, separate normal/tactical energy, public cooldowns, buffs and critical hits; periodic stacking/settlement, separate damage categories and personal traits; equipment and rank stats affect combat | Verify live energy regeneration/hit timing; complete specialized actions, conditional/team buffs, effect playback, defense/critical formulas and live periodic-damage comparison |
| Boss and normal enemies | Source first-Boss attacks, charge, jump and HP gate; natural two-gate/Boss run completed with three survivors | Complete other Boss-specific mechanics, damage limits and health-layer counts |
| State machines | Actor/cast/travel/run states; recoverable full-party defeat, town/repaired-portal return and battle reset; persisted exploration, development and respawn timers | Verify exact revival fees/timers, partial-party recovery and reset rules; restore in-progress enemy combat; extend long-session checks |
| Zhushen/H5 foundation | Actual host UI/storage/resource/message managers exercised in an isolated Creator project; input, cache, role isolation and close races verified | Integrate into the production checkout and verify full startup, live account/protocol/reconnect behavior |

## Observed versus assumed rules

Directly observed: portrait framing; a four-slot party; route indicators; group healing feedback; region overview; a level gate; a Boss HUD with multiple health-bar layers and a physical-type weakness indicator; paid teleport-platform repair.

Source config now supplies fog costs and prerequisites, portal locations and costs, monster/resource placements, and base respawn parameters. The first two fog gates were reached and purchased through normal simulation movement. Browser tests separately verified a 5-incense purchase, reload restoration and free travel to a repaired portal.

Team experience follows item 7 rewards and the configured PlayerLevel thresholds. A natural first-Boss run advanced from level 1 to 2 with 40/600 experience, and restored those values from a save. Kill counters support multi-kill and monster-subtype prerequisites. The journal adds mainline/first-kill reward claims and ordered rank promotion, with nine mainline steps, equipment assignment and the first promotion verified through natural gameplay. Basic hero upgrades consume configured merit and honor rank caps. Ordinary recruitment now consumes vouchers and uses source reward weights and a persistent guarantee curve. Its combined probabilities still need live comparison. Rename, fragment activation, duplicate conversion, star growth, recruitment wishlists and other-mode actions remain absent; their conditions remain enforced.

The roster contains 44 source profiles, of which 33 are initially visible and 22 have deployable skill/art adapters. Positions five through eight require ranks 4, 10, 19 and 28. Browser validation used an explicit rank/card fixture for the fifth position; it does not demonstrate naturally reaching rank 4. Source portraits, live formation changes, reserve health/energy and reload restoration were inspected. The initial owned heroes remain the four comparison characters, independent of the observed account.

Still unconfirmed or incomplete: defense and critical formulas, specialized source skill actions and modifiers, dynamic attribute scaling, exact Boss health layers, death/revival, other main-world maps, source quest progression and path-resume timing. The comparison party now uses source level-10 attributes; it remains separate from the live account.

Revival support currently follows the main-map enable flag and source return-command labels. Its full-health return, zeroed energy, encounter reset and nearest repaired-portal selection still require live parity checks. Controlled engine tests exercise natural defeats; browser recovery checks use an explicit lethal-damage fixture after the natural Boss route. Neither proves the unobserved original-game timing or cost rules.

The initial `discover:` and `clear:` demo rules remain engineering fixtures. Temporary reference art and converted configuration are used only in ignored local preview directories; the tracked implementation and host export contain owned code and fixture data. See `local-reference-preview.md` for current evidence and boundaries.
