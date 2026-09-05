# Replica Requirements and Evidence

The objective remains behavior parity with the WeChat game Zhenxieren, including its world map, free combat, fog and unlocking, flashlight, 2.5D presentation, exploration, navigation, squad formation, skills, damage, enemy/Boss targeting and state machines. The implementation must remain usable within the Zhushen H5 foundation. A working graybox or passing unit tests do not satisfy this objective alone.

## Reference identity

- WeChat AppID: `wxd53170210eef737f`.
- User-provided screenshots from task `01a06b72-3422-7ca3-8f2e-c60988987fdb`: portrait world exploration, four active party slots, auto-route markers, healing feedback and formation screens.
- Direct Windows Computer Use observation on 2026-09-05: the running game exposed a Boss encounter, a connected multi-region world-map overview, a level-15 region gate, and compact party movement. The observed account progressed through levels 10 and 11, so it is not a frozen new-player replay.
- Direct repair interaction on 2026-09-05: an unbuilt teleport platform displayed a cost of 5. Clicking it changed the visible resource balance from 299 to 294 and replaced the unbuilt platform with its completed appearance. This confirms paid platform repair, not every fog-unlock condition.
- A public nine-second clip linked from `https://www.17yoo.cn/detail/57220` was inspected and excluded: it depicts a landscape single-character interface, inconsistent with the user's reference. Its extracted contact sheet remains in ignored `reference-private/`.

## Requirement audit

| Requirement | Current implementation evidence | Remaining parity work |
| --- | --- | --- |
| World map | First reference world geometry, complete detailed ground, panning/zooming overview and source portals | Compare the original overview's connected-tile styling and extend to other main-world maps |
| Free combat and exploration | Movement and AI share collision/navigation | Compare manual movement, auto travel and combat interruption with repeated live observations |
| Fog and unlocking | 59 source polygon gates; incense, level, rank, defeat, quest and NPC conditions; UI purchase and reload verified | Connect real quest/rank/level progression and compare the exact fog appearance and transition timing |
| Flashlight | Direction and cone data; locked fog remains opaque | Match aim switching, softness, occlusion and range from reference observations |
| 2.5D presentation | Reference ground and temporary character/NPC assets, source grid projection and actor Y ordering | Complete foreground occlusion and provide owned/licensed release art |
| Automatic navigation | A*, overview POI destinations, manual override and route restoration | Match quest destinations and original route markers; verify long routes across all regions |
| Multiple characters | Four slots, navigation-aware follow, surviving leader selection | Compare compact movement formation and companion/pet behavior |
| Skills and damage | Tested timed casts, area hits, healing, shields, projectiles and summons | Calibrate actual timing, range, numeric behavior and visuals from repeated reference observations |
| Boss and normal enemies | Tested pursuit, return, thresholds, summon ownership, respawn and an unmodified-stat full-map victory | Match the reference enemy rules and health-layer counts; current Boss tuning is a fixture |
| State machines | Actor/cast/travel/run states; paid interactions; persisted exploration and respawn timers; coalesced storage writes | Match reference death/revival, restore in-progress enemy combat, and extend long-session checks |
| Zhushen/H5 foundation | `ExploreRuntime` plus a tested role-scoped `StorageMgr`/`MessageCenter` port adapter | Exercise the actual BaseUI module in the host; current integration tests use service doubles |

## Observed versus assumed rules

Directly observed: portrait framing; a four-slot party; route indicators; group healing feedback; region overview; a level gate; a Boss HUD with multiple health-bar layers and a physical-type weakness indicator; paid teleport-platform repair.

Source config now supplies fog costs and prerequisites, portal locations and costs, monster/resource placements, and base respawn parameters. The first two fog gates were reached and purchased through normal simulation movement. Browser tests separately verified a 5-incense purchase, reload restoration and free travel to a repaired portal.

Still unconfirmed or incomplete: full attack/cooldown formulas and damage-type modifiers, dynamic attribute scaling, exact Boss health layers, death/revival, other main-world maps, source quest progression and path-resume timing. Hero combat tuning and some enemy behavior remain independent fixtures.

The initial `discover:` and `clear:` demo rules remain engineering fixtures. Temporary reference art and converted configuration are used only in ignored local preview directories; the tracked implementation and host export contain owned code and fixture data. See `local-reference-preview.md` for current evidence and boundaries.
