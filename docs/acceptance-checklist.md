# Auto Explore Graybox Acceptance Checklist

This checklist verifies an engineering demo, not complete parity with any reference title. All configured content and values are original placeholders.

Record each item as `PASS`, `FAIL`, `BLOCKED` or `NOT IMPLEMENTED`, plus build revision and evidence. A static source inspection is not a runtime pass.

The world-rules increment has a scoped [validation record](validation-world-rules.md). Unchecked items below are not implicitly covered by that record.

## Boot and Configuration

- [ ] The project opens in Cocos Creator 2.4.15 without missing-script errors.
- [ ] The standalone auto-explore scene starts without loading the legacy game scene.
- [ ] `world_demo.json` loads and all hero, enemy, skill, POI and spawn references validate.
- [ ] A deliberately invalid reference produces a clear diagnostic and does not start a partial run.
- [ ] Reset restores initial actors, fog, triggers, HP and cooldowns deterministically.

## World and 2.5D Presentation

- [ ] The walkable area matches the configured 4800 x 7200 bounds.
- [ ] Each configured rectangle and circle obstacle blocks movement.
- [ ] Actors sort by ground-contact Y without visibly jumping layers.
- [ ] The camera follows smoothly, stays within world bounds and provides forward look-ahead.
- [ ] Portrait resize and safe-area changes do not cover the joystick or critical status UI.
- [ ] All visual assets are original placeholders or explicitly licensed project assets.

## Fog, Unlocking and Flashlight

- [ ] Undiscovered unlocked cells render hidden.
- [ ] Cells inside the leader reveal radius become visible.
- [ ] Previously visible cells become explored rather than fully hidden.
- [ ] Locked zone boundaries reject movement and auto-path traversal.
- [ ] Discovering `cache_east` and `shrine_west` unlocks their configured zones once.
- [ ] Clearing `gate_guard` unlocks the boss zone once.
- [ ] Flashlight direction follows movement outside combat and target direction during combat.
- [ ] Flashlight rendering does not reveal or permit entry into locked zones.

## Free Movement and Auto Path

- [ ] Joystick input changes leader direction in the same simulation tick.
- [ ] Diagonal movement is normalized and not faster than cardinal movement.
- [ ] Manual input never combines with auto-path velocity.
- [ ] Releasing the joystick resumes auto travel after the configured delay.
- [ ] The route avoids all obstacles and locked cells.
- [ ] A blocked actor repaths or recovers without an infinite oscillation.
- [ ] Reaching the selected POI ends navigation within the configured arrival radius.

## Squad and Formation

- [ ] Exactly four configured heroes spawn at start.
- [ ] Each hero occupies its configured formation role relative to the leader.
- [ ] Formation rotates with movement direction without rapid left/right flipping.
- [ ] Followers navigate around obstacles rather than passing through them.
- [ ] A follower beyond catch-up distance rejoins and resumes its normal state.
- [ ] Dead members stop moving, targeting and casting.

## Enemy Spawning and AI

- [ ] Every spawn activates only through its configured trigger.
- [ ] Non-respawning spawns cannot activate twice after backtracking.
- [ ] Enemies idle before aggro, chase valid heroes and attack in range.
- [ ] Equal target candidates resolve deterministically.
- [ ] Enemies outside leash range return without corrupting target state.
- [ ] Clearing a blocking encounter lets auto travel continue.
- [ ] The final boss does not spawn before its zone unlock condition.

## Skills, Damage and Healing

- [ ] Every listed skill resolves to an existing caster and valid target rule.
- [ ] Cooldowns begin only after a successful cast.
- [ ] Damage matches the configured deterministic formula for a recorded hit.
- [ ] Defense and minimum damage behave correctly at boundary values.
- [ ] Area skills affect no more than `maxTargets`.
- [ ] Healing prioritizes an injured ally, does not exceed maximum HP and produces visible feedback.
- [ ] Shields absorb damage before HP and expire at the correct time.
- [ ] A dead target cannot receive a later single-target hit in the same tick.
- [ ] Boss telegraph duration precedes damage and remains readable beneath combat effects.
- [ ] Boss phase thresholds fire once each, including a hit that crosses both thresholds.

## Completion and Stability

- [ ] Killing the boss emits one encounter completion and one run completion.
- [ ] Losing all four heroes emits one failure and stops simulation.
- [ ] Pause freezes movement, AI, cooldowns, fog and elapsed run time.
- [ ] Thirty consecutive resets and full runs produce no retained actors, listeners or trigger state.
- [ ] Four heroes, ten normal enemies and one boss can coexist without broken AI states.
- [ ] FPS, peak actor count and error logs are captured on the agreed target device.
- [ ] Runtime evidence includes a full recording from start through boss completion.

## Explicitly Outside This Demo

- Server login, authoritative settlement, persistence and reconnect.
- Production art, Spine content, audio and final UI polish.
- Character collection, equipment, currencies, tasks, shops and monetization.
- Claiming exact numeric, visual or source equivalence with the reference game.

These items require later phases and must not be marked implicitly complete because the graybox runs.
