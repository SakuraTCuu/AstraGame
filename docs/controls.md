# Demo Controls and Verification Use

## Start

Open `assets/scenes/demo.fire` in Cocos Creator 2.4.15 and run Preview.

The configuration is loaded from `assets/resources/config/auto_explore/world_demo.json`. A configuration error should appear visibly and stop the run.

## Controls

| Input | Result |
| --- | --- |
| Drag the virtual joystick | Move the squad leader and immediately override auto path |
| Release the joystick | After a short delay, rejoin the route and resume auto path |
| Tap the world or minimap | Select a reachable auto-path destination; blocked requests preserve the previous route |
| Reload the preview | Recreate the same deterministic demo from initial state |

The current phase intentionally has no manual attack button. Heroes and enemies acquire targets and release skills through their state machines.

Pause and in-game reset controls remain planned. Region rules and implemented validation are recorded in [world-rules.md](world-rules.md).

## What to Observe

- The flashlight follows movement direction, then turns toward a combat target.
- The leader reveals fog; visited ground remains dimly explored after leaving it.
- Locked northern regions remain blocked until their configured discovery or encounter condition is met.
- Followers maintain distinct front, flank and rear positions, catch up after separation and do not permanently overlap the leader.
- Manual movement always wins over automatic movement and does not cause speed stacking.
- Heroes stop or reposition for combat, choose reachable enemies, cast skills, deal damage and return to travel after clearing an encounter.
- The support heals an injured ally. The ranged hero keeps more distance than melee heroes.
- The boss telegraphs its area attack, crosses two phase thresholds and completes the run on death.

## Debug Expectations

A development overlay should expose at least:

- Session and navigation state.
- Leader position and current waypoint.
- Current encounter and living enemy count.
- Each actor's AI state, target, HP and next cooldown.
- Fog zone unlock state.
- Current FPS and active actor count.

The overlay is an engineering surface, not final game UI. Reset should reproduce the same spawn order and damage sequence because demo damage variance is zero.

## Tuning

Edit only `world_demo.json` for first-pass tuning. Treat all values as provisional. Do not claim that any value matches the reference game unless a separate black-box study records version, account state, repeated measurements and confidence.

After changing data, reload the scene and record the configuration ID/schema version with the result. Avoid embedding tuning constants in components; a hardcoded fallback can hide a missing field and invalidate comparisons.
