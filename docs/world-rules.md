# World Rules

The world runtime connects obstacle collision, region unlocking, fog, navigation, formation, source encounters and persistent exploration. The standalone config uses owned placeholder data; local reference content remains ignored and is not a release asset set.

## Geometry and movement

- Rectangle obstacles use center coordinates; zone rectangles use bottom-left coordinates.
- An obstacle blocks every navigation cell it intersects. Collision is conservative at cell edges; it is not a rigid-body physics simulation.
- Manual movement checks crossed cells and slides along a blocked edge. It cannot cross a blocked corner or tunnel across an obstacle in one update.
- Automatic travel, follower movement and enemy pursuit use the same navigation grid. Followers route to the nearest walkable formation anchor when their requested slot is blocked.
- Formation correction consumes the configured fraction of slot error but is capped by the actor's effective movement speed times `formationCatchUpMultiplier`. The shipped local value is 1.21; zero-speed actors remain still and speed modifiers remain authoritative. This is local tuning, not an original-game measurement.
- A manual override retains the selected destination. Releasing input waits `world.navigation.manualResumeDelay` before planning a new route from the current position.
- Tapping a blocked destination rejects that request and preserves the existing route and quest identity. Only a successful explicit redirect clears quest navigation. Tapping the minimap selects a world destination.

## Regions and discovery

Zones must be non-overlapping rectangles. Uncovered ground is locked when zones are configured. Cells that straddle a locked boundary stay blocked until both sides are unlocked.

| Condition | Effect |
| --- | --- |
| `initial` | Region is open when the session starts |
| `discover:<poiId>` | Open after reaching the POI's discovery radius with a clear path to it |
| `clear:<encounterId>` | Open after every spawn belonging to that encounter has activated and cleared |

Discovery cannot reach a POI inside a locked zone. Unlock POIs must therefore be reachable from an earlier region. The supplied cache and shrine have been moved into the initial southern region to satisfy this rule.

Discovery, encounter completion and region unlock events fire once per session. Exploration saves retain opened regions, POIs, cleared persistent spawns and respawn timers; invalid restored state is rejected atomically. In-progress enemy combat still restarts under the current local rule.

Fog cells have four states: `locked`, `hidden`, `visible` and `explored`. Locked cells remain opaque even under the flashlight. Leaving visible ground preserves its explored state. Unlocking never removes static obstacle collision.

## Spawning

All spawns require an unlocked position and a leader within their trigger radius. A `zone_unlocked` spawn additionally requires an explicit, valid `zoneId`. The boss uses the `boss` region, opened by clearing `gate_guard`.

Spawn positions are projected onto walkable ground when random scatter intersects an obstacle. Multiple spawn entries may share an encounter ID; a pending entry prevents encounter completion.

The bounded source skill 5001603 emits ten action-time summon requests at fixed offsets. Summons capture effective owner attributes, use deterministic collision relocation, remain part of their encounter until removed, expire after ten seconds and clean all tracking on return/recovery/reset. Other summon layout and callback families remain unsupported rather than inheriting these rules.

## Verification scope

`tests/world.test.ts` covers collision, corners, sliding, fog transitions, input override, invalid zone references, reachable shipped POIs and an end-to-end small encounter. That encounter uses normal movement and combat to open a region, clear two guard spawns, unlock the boss and defeat it.

The Web Mobile smoke test verifies the shipped map's complete exploration/combat route and natural victory through normal movement and telegraph dodges. See [the current handoff](AI-HANDOFF.md) and [latest reference validation](local-reference-preview.md) for current evidence; [combat validation](validation-combat.md) is an earlier historical snapshot.
