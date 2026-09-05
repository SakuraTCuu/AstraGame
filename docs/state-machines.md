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

- Supported damage actions can enter the target into `displaced`, interrupting its unfinished cast while retaining its cooldown unless it has interruption immunity. A protected cast retains its timeline during displacement; existing projectiles remain independent.
- Displacement follows a fixed direction and distance over its configured duration. It uses the ordinary collision boundary; neither AI, joystick movement nor formation updates add voluntary movement during that interval.
- A later impact replaces the remaining displacement from the current position. Explicit `unForceMove` or `ignoreControl` states prevent it. Returning actors are excluded by the current local contract.
- Completion returns the actor to `idle`. A displaced leader replans the remaining automatic route before resuming it. Death, removal, benching, travel resets and encounter resets clear displacement.
- Damage-based self healing uses actual health removed after defense and shields, including the overkill cap, and passes through healing reduction and the recipient's health cap. It cannot revive its caster.
- These are runtime contracts. Source knockback parameter units, interpolation, immunity and interruption parity remain audited until measured against the original battle.

### Timed Control States

- A status can create several states, each with its own duration. State duration `-1` is indefinite. States can expire before their Buff or continue after its modifiers expire. Reapplying the same Buff group refreshes its states; other groups retain their independent clocks.
- Stun, freeze, airborne and fear control block voluntary movement and casting. Root blocks movement and movement skills while allowing stationary attacks. Silence blocks tactical and ultimate skills while allowing normal attacks and movement. Explicit `uncontrolled` skill conditions reject all supported controls.
- Incoming control checks per-kind immunity, source state exclusions and the optional Boss exclusion. Interruption immunity protects a pending cast separately from control immunity. It does not enable new casts while controlled.
- Unsupported movement is suppressed in joystick, path, AI and formation updates. Hard control enters `controlled` after any interruptible cast is cancelled and returns to `idle` on expiry or cleanse. Freeze pauses the reference animation; root prevents a false walking animation.
- Cleansing can remove a remaining control after its owner Buff expires. NPC-only and protected-effect rules retain their original ownership. Death and recovery clear both Buffs and states, and configured return cleanup applies to both.
- Immunity currently blocks new controls without purging existing ones. Specialized state behavior and live parameter comparisons remain in the local audit.

### Control Motion

- Airborne states have a height, rise time and fall time, with any remaining duration held at the peak. Reapplying a lift preserves current height. Overlapping lifts use the highest elevation; expiry, cleansing and death ground the actor. Navigation and hit testing retain ground coordinates while both renderers lift the body and health bar.
- Fear selects seeded random headings at the configured interval and moves at its configured speed. Each segment uses collision separately, including when a single update spans several turns. Stun, freeze, root, airborne control and knockback suppress fear movement. Its timer continues while blocked.
- Fear replaces voluntary movement until its expiry or cleanse. The world retains route invalidation across control cleanup and replans from the displaced position before resuming automatic travel.
- The source adapter currently interprets optional fear operands as speed and milliseconds between direction changes. Missing values use 350 units/second and one second based on the cached skill description. The interval operand still requires live comparison.
- Explicit rise/fall/height values are supported for `upUp`. Other supported airborne actions use the local 160-unit jump-height default and a symmetric curve. Source heights, easing and remaining flight options are still unverified; `windFly` still needs its directional scene behavior.

### Directional Projectiles

- A directional skill emits one straight shot, independent of its primary target count. Its aim follows the living target during windup and locks on release. The released shot continues after the caster or original target dies.
- Swept circular contact prevents fast shots from skipping narrow targets. Contacts consume the configured total hit budget in travel order, with stable actor-ID ties. Each target is hit once unless a repeat interval is configured; leaving and reentering does not reset that interval.
- Travel is clipped to the lifetime boundary, and contact at or after expiry cannot add another periodic hit. Floating-point endpoint tolerance preserves the first eligible fixed-step hit.
- Contact actions retain their own timeline and can finish after the projectile visual expires. Target removal and encounter reset discard pending contact actions. All contacts from a cast share one energy award.
- Projectile snapshots use distinct projectile IDs and simulation age. Reference atlas frames follow that age and are released when the shot disappears or the view is destroyed.
- Circular hitbox interpretation, terrain collision, target replacement during windup, special projectile check modes, offsets, multi-shot patterns and complete effect orientation still require source/live comparison. Collision currently samples actor positions at each simulation step.

### Defensive States

- Invulnerability rejects incoming damage before shield consumption and exposes immunity feedback. A per-hit cap applies after damage modifiers and before shields. Death protection limits health loss to leave one HP; it neither restores health nor revives a dead actor.
- Untargetable actors are excluded from non-self target selection, retained enemy targets and new area/projectile contacts. Homing shots lose their lock, straight shots do not consume their hit budget on these actors, and pending targeted contact actions are cancelled. Self-directed effects remain available.
- Already attached periodic effects do not perform target selection again. They still obey invulnerability, per-hit caps and death protection. Healing prohibition blocks direct healing and damage-based recovery until its state ends.
- Explicit state removal clears named states across their owners while retaining other states and Buff modifiers. Source caster-directed `removeStateAction` can remove several names in one frame.
- Friendly/global-effect treatment of untargetability, exceptional damage types, source percentage limits, shield-break mechanics and exact live expiry ordering remain comparison work. These flags do not establish complete parity for the skills that grant them.

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
