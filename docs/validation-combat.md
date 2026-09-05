# Combat Runtime Validation

Date: 2026-09-05. Starting commit: `92a14d7`. Configuration: `auto_explore_demo_v3`, schema version 3.

## Implemented behavior

- Explicit windup, hit, recovery and cooldown; unfinished casts cancel when their caster dies.
- Circle, cone and line hit geometry; target caps; lowest-health-ratio and cluster selection.
- Group healing, timed shields and shield absorption before HP loss.
- Traveling projectiles, ground-point area resolution and bounded projectile lifetime.
- Summon ownership, active limits, removal on owner loss and encounter completion.
- Enemy return to spawn after leaving the leash, configurable respawn delay and unique spawn generations.
- Party regroup during manual movement, basic-attack-range pursuit, living-leader promotion and full-party defeat.
- Pause/resume, restart, configured encounter victory and one result submission per run.
- Visible telegraphs, projectiles, shields, configurable Boss health layers, pooled damage labels and desktop/mobile controls.

## Evidence

`npm test` covers 46 cases, including the complete shipped map. The playthrough uses session navigation/movement inputs and dodges live telegraphs; it does not teleport actors or modify combat stats. It reaches the Boss's normal, second and enraged phases, observes summons and ends in victory after roughly 183 simulated seconds.

Creator 2.4.15 Web Mobile and browser checks verify the same progression, result storage, real pause/resume and restart button events, and stable node count across consecutive resets. Browser evidence is written to ignored `temp/qa/report.json` and PNG captures. This supersedes the old controlled-health phase check recorded in `validation-world-rules.md`.

Host integration is documented in `zhushen-integration.md`. The module's compiler check separates diagnostics in the new module from diagnostics elsewhere in the host. No host installation or whole-host runtime success is implied.

The current package has 72 files and no destination-path conflict with the inspected host. The compiler reports zero diagnostics in the new module and 17 elsewhere in its host dependency graph. The exported view Prefab loads and instantiates successfully in the standalone browser. Actual host execution remains pending.

## Fidelity boundary

These checks prove the implemented game's behavior, not complete parity with the reference. Current numeric values, skill timings, map geometry and health-layer count remain fixtures. Direct reference observations and remaining requirements are recorded in `replica-requirements.md`.

Remaining work includes the actual world-map overview and progression, resource-gated interactions, reference fog/lighting appearance, character/terrain visuals and occlusion, in-progress persistence, the actual H5 host run, WeChat packaging/device validation, and repeated timing/numeric comparison against the running reference game.
