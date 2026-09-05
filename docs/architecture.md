# Auto Explore Demo Architecture

## Purpose

This demo validates the first playable slice of a portrait 2.5D exploration game: free movement, fog discovery, flashlight visibility, automatic pathfinding, a four-member formation, automatic target selection, skills, damage, normal enemies and a boss.

The demo reproduces a genre interaction pattern, not proprietary implementation or content. All names, geometry, assets and numeric values in this repository are original placeholders. Reference-game assets, source code, text and extracted configuration must not enter this project.

## Runtime Shape

```text
AutoExploreScene
  InputController ------> ExploreSession <------ DemoConfig
                                |
             +------------------+------------------+
             |                  |                  |
          World              Squad              Combat
    navigation/obstacles  formation/AI     target/skill/damage
             |                  |                  |
          FogSystem       Presentation       SpawnDirector
             |                  |                  |
        Flashlight          camera/y-sort       encounter
```

`ExploreSession` owns the lifecycle and is the only component allowed to start, pause, reset or finish a run. Systems exchange typed events or narrow method calls; view nodes must not mutate combat state directly.

## Module Boundaries

| Module | Owns | Does not own |
| --- | --- | --- |
| Session | Run state, pause, reset, win/fail | Damage formulas or node visuals |
| Input | Joystick vector and manual override | Path planning or position authority |
| World | Bounds, obstacles, walkability, coordinate transforms | Unit tactics |
| Navigation | Auto path, repath, arrival, stuck recovery | Combat targeting |
| Fog | Visible/explored/hidden cells and unlock gates | Lighting render details |
| Flashlight | Aim direction and visibility mask parameters | Fog persistence |
| Squad | Four slots, formation anchors, catch-up and member state | Enemy spawning |
| Combat | Target selection, cooldowns, hit resolution, death | Scene progression |
| Spawn | Trigger activation, enemy construction, encounter completion | Enemy AI transitions |
| Presentation | Camera, 2.5D y-sort, placeholders, health bars and float text | Authoritative simulation state |
| Config | Tunable static data | Mutable run state |

## Data Contract

The single source of demo tuning is `assets/resources/config/auto_explore/world_demo.json`. `seed`, `world.cellSize`, `world.blocked`, `squad.actors`, `enemies`, and `skills.player/enemy` form the minimal graybox compatibility surface; richer systems use the remaining fields and `skills.definitions`. In Cocos Creator 2.4 it should be loaded as a `cc.JsonAsset` through:

```ts
cc.loader.loadRes("config/auto_explore/world_demo", cc.JsonAsset, callback);
```

Runtime code must resolve references by stable IDs and fail fast in development when an enemy or skill ID is missing. It must not silently invent fallback combat values. JSON data is read-only after loading; each run creates separate mutable runtime objects.

The schema is intentionally consolidated for fast iteration. Split it into generated tables only after the demo loop and field ownership stabilize.

## Simulation Rules

- World coordinates use `x` right and `y` up. Rendering uses orthographic projection and sorts actors by their ground-contact `y`.
- A fixed simulation tick advances AI and combat. Rendering interpolates positions and may run at a different frame rate.
- The leader position is authoritative for navigation and fog reveal. Followers seek rotated formation anchors and may catch up when too far away.
- Manual input immediately overrides auto path. Releasing input waits for the configured delay, rejoins a reachable waypoint and resumes automatic movement.
- Target selection is deterministic: eligible targets in aggro range are ordered by configured target rule, then distance, then stable runtime ID.
- Skill cooldown starts on successful cast. Damage resolves at the hit event, not at animation start.
- The initial damage formula and zero variance are deliberate engineering placeholders so validation is reproducible.
- Encounter completion is emitted once after all units associated with the encounter are dead. The final boss completion wins the demo.

## Framework Reuse Boundary

Reuse the existing project's boot, UI layering, resource loading, audio, logging, networking and protocol primitives when they are copied into the minimal client. Do not couple this demo to the old turn-based battle model, old economy models, old UI pages or old game-specific configuration.

The offline demo has no server authority. Future server integration must sit behind an adapter at the session boundary. Movement may remain client-simulated, while run creation, checkpoints and reward settlement become server-authoritative and idempotent.

## Performance Guardrails

Initial engineering targets, pending device measurement:

- 30 FPS on the selected low-end test device.
- Four heroes, ten normal enemies and one boss visible without state errors.
- Fog updates at its configured interval rather than rebuilding every render frame.
- Pathfinding is requested only on target change, repath interval or stuck recovery.
- Reuse actors, projectiles, health bars and floating numbers through pools before content scale increases.
- Keep the current, previous and next map regions active once streamed map art replaces the graybox.

These are demo guardrails, not production claims.
