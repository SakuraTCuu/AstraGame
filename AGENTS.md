# Auto Explore Demo

These instructions apply to the whole `client/` tree.

## Runtime

- Use Cocos Creator 2.4.15 APIs and serialization.
- The start scene is `assets/scenes/demo.fire`.
- `assets/scripts/core` is deterministic TypeScript and must not depend on Cocos, DOM, storage, or networking.
- `assets/scripts/presentation` and `assets/scripts/app` own Cocos nodes, rendering, input, and lifecycle cleanup.
- Runtime tuning lives in `assets/resources/config/auto_explore/world_demo.json`.
- Existing Zhushen services are integrated later through ports under `assets/scripts/framework`; gameplay must not import legacy managers directly.

## Verification

- Run `npm test` after gameplay or framework changes.
- Build with the installed Cocos Creator 2.4.15 before claiming the scene is runnable.
- With the local Web Mobile build served on port 4173, run `npm run smoke:web` to verify the canvas, interactions, console, and Boss phase.
- `build`, `library`, `local`, and `temp` are generated state and must remain untracked.

## Content boundary

- Use original placeholders or assets with explicit project rights.
- Do not add extracted third-party game code, images, audio, fonts, text, or configuration.
- Reference-game observations belong in ignored local capture directories unless the user defines an approved evidence repository.

