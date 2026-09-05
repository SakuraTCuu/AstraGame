# State Machines and System Contracts

All transition names below are implementation contracts for the graybox. Timing and distances come from `world_demo.json` and remain adjustable original placeholders.

## Session

```text
BOOT -> LOADING -> READY -> RUNNING
                         RUNNING <-> PAUSED
                         RUNNING -> WON
                         RUNNING -> FAILED
                 WON/FAILED -> RESETTING -> READY
```

- `BOOT -> LOADING`: scene component starts configuration load.
- `LOADING -> READY`: schema and all ID references validate successfully.
- `READY -> RUNNING`: actors, fog and spawn triggers are reset.
- `RUNNING -> WON`: final boss encounter completes exactly once.
- `RUNNING -> FAILED`: all squad members are dead.
- Any configuration failure remains in `LOADING` and displays a diagnostic; it must not start a partial run.

## Movement and Navigation

```text
IDLE -> AUTO_PATH -> ARRIVING -> IDLE
          |              ^
          v              |
    MANUAL_OVERRIDE -> REJOIN_PATH
          |
          v
      COMBAT_HOLD
```

Rules:

- Non-zero joystick input enters `MANUAL_OVERRIDE` in the same simulation tick.
- Manual velocity never adds to navigation velocity.
- On input release, wait `manualResumeDelay`, choose the closest reachable forward waypoint and enter `REJOIN_PATH`.
- `COMBAT_HOLD` stops automatic travel during a blocking encounter but manual repositioning remains available.
- A unit that has not progressed for `stuckTimeout` requests a path once, then moves to the nearest walkable cell if still blocked.
- Auto path never crosses locked fog zones or obstacle geometry.

## Squad Member AI

```text
FOLLOW -> ACQUIRE -> CHASE -> ATTACK -> RECOVER
  ^         |          |        |         |
  +---------+----------+--------+---------+
                       |
                     DEAD
```

- `FOLLOW`: seek formation anchor; do not independently start long chases.
- `ACQUIRE`: evaluate alive and reachable enemies within aggro range.
- `CHASE`: approach until the selected skill range is satisfied.
- `ATTACK`: face target and run the cast/hit event.
- `RECOVER`: wait for attack recovery or skill cooldown, retaining target if valid.
- If no target remains, return to `FOLLOW`; if HP reaches zero, enter `DEAD` permanently for the run.
- Support healing checks take precedence when a valid ally is below `combat.supportHealThreshold`; the configured value is an adjustable placeholder.

## Enemy AI

```text
DORMANT -> SPAWN -> IDLE -> ACQUIRE -> CHASE -> ATTACK -> RECOVER
                     ^         |          |         |         |
                     +---------+----------+---------+---------+
                                      |
                                   RETURN
                                      |
                                     IDLE

Any active state -> DEAD -> DESPAWN
```

- Spawn triggers activate once in the demo.
- Enemies select only living heroes. Equal-distance ties use stable runtime ID.
- Leaving `leashRange` enters `RETURN`; HP does not reset in the demo.
- Boss phases switch when normalized HP crosses the configured thresholds. A threshold fires once even if one hit crosses multiple thresholds.
- Telegraph skills expose warning geometry for the configured duration before hit resolution.

## Skill Execution

```text
READY -> WINDUP -> HIT -> RECOVERY -> COOLDOWN -> READY
           |        |
           +------> CANCELLED
```

- A cast requires a living caster, valid target, satisfied range and zero cooldown.
- The target may become invalid during windup. Single-target damage then cancels; area skills resolve at the locked ground point.
- Damage is `max(minimumDamage, floor(attack * coefficient - defense))`.
- Healing is `floor(attack * coefficient)` and is capped at target maximum HP.
- Shields absorb damage before HP and expire at duration end.
- Death is resolved immediately after the hit batch; dead units cannot cast later in the same tick.

### Impact Displacement

- Supported damage actions can enter the target into `displaced`, interrupting its unfinished cast while retaining its cooldown. Existing projectiles remain independent.
- Displacement follows a fixed direction and distance over its configured duration. It uses the ordinary collision boundary; neither AI, joystick movement nor formation updates add voluntary movement during that interval.
- A later impact replaces the remaining displacement from the current position. Explicit `unForceMove` or `ignoreControl` states prevent it. Returning actors are excluded by the current local contract.
- Completion returns the actor to `idle`. A displaced leader replans the remaining automatic route before resuming it. Death, removal, benching, travel resets and encounter resets clear displacement.
- Damage-based self healing uses actual health removed after defense and shields, including the overkill cap, and passes through healing reduction and the recipient's health cap. It cannot revive its caster.
- These are runtime contracts. Source knockback parameter units, interpolation, immunity and interruption parity remain audited until measured against the original battle.

## Fog and Discovery

Each fog cell is one of:

```text
LOCKED -> HIDDEN -> VISIBLE -> EXPLORED
                     ^           |
                     +-----------+
```

- `LOCKED` cells cannot be entered or revealed until their zone condition passes.
- An unlocked cell begins `HIDDEN`.
- Cells within leader reveal radius become `VISIBLE`.
- Previously seen cells outside current visibility become `EXPLORED`, never `HIDDEN`, when persistence is enabled.
- Discovering a point of interest emits its event once. Unlock conditions consume those stable event IDs.
- Flashlight affects rendered visibility inside already unlocked cells; it does not bypass a locked zone.

## Cross-System Event Contract

| Event | Producer | Consumers | Required payload |
| --- | --- | --- | --- |
| `manual_input_changed` | Input | Navigation, Flashlight | normalized vector, active flag |
| `leader_moved` | Squad | Camera, Fog, Spawn | current and previous position |
| `poi_discovered` | Fog/World | Session, Fog, UI | POI ID |
| `spawn_activated` | Spawn | Combat, UI | spawn ID, encounter ID, runtime enemy IDs |
| `unit_damaged` | Combat | Presentation, AI | source, target, amount, skill ID |
| `unit_healed` | Combat | Presentation | source, target, amount, skill ID |
| `unit_died` | Combat | Spawn, Squad, Presentation | unit ID, faction |
| `encounter_completed` | Spawn | Navigation, Fog, Session | encounter ID |
| `run_finished` | Session | UI, persistence adapter | result, elapsed time |

Every one-shot event must be idempotent. Presentation listeners may miss or replay an event without altering simulation state.
