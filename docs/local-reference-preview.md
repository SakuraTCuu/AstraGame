# Local Reference Preview

The user authorized temporary use of their local WeChat resource cache on 2026-09-05. Cached content, generated profiles, tables, and screenshots remain in ignored local directories. They are not part of the Git repository or the Zhushen module export.

## Run

Build the project with Cocos Creator 2.4.15, then stage the authorized cache:

```powershell
node tools/stage-reference-cache.mjs --cache '<authorized gamecaches directory>'
```

Serve `build/web-mobile`, and open `http://127.0.0.1:4174/?reference=1`. The reference mode is restricted to a localhost browser URL. The default URL continues to use the independent combat fixture. Restage after a Creator build or after visiting additional areas in the reference game.

The optional `tools/fetch-reference-map.mjs` command accepts `--cache`, `--base-url`, and `--map`. It compares the remote map configuration with the supplied cache before downloading missing PNG tiles. Downloads and their SHA256 manifest remain in ignored `reference-private/downloads`; staging includes this supplement automatically. It never changes the WeChat cache.

## Asset Pipeline

- `cacheList.json` resolves original import/native paths to cached files.
- The base and extension bundle configurations are joined by decoded UUID. Pack ordering and version indices are preserved, including textures referenced across the two parts.
- Resource-only bundles load through Cocos `assetManager`. Original game scripts are not loaded.
- Table archives use bounded length fields, the compression flag, zlib, and JSON. `__KEY_MAP__` supplies field names; `$id` references resolve within the same field.
- `profile.json` supplies the local scene and presentation bindings. `audit.json` records missing art and adaptation limits.
- Ground textures use their logical slice dimensions. Native cache images may be reduced to 819 pixels while representing 1024 logical pixels.
- Visible map tiles load on demand and release when outside the viewport. Character nodes follow the existing combat snapshots.

## Current Boundary

The preview loads the actual first world map, four Spine characters, 135 enemy/resource templates and 2489 configured spawn points. Missing art no longer removes an encounter from the simulation. The original collision grid is sampled into a 40-unit navigation grid. All 224 source route points map to unblocked source cells; this validates the coordinate conversion, not every sampled boundary or gameplay restriction.

The current first-map supplement fills 648 missing tiles from the verified resource base. All 844 required ground tiles are present, with zero missing paths. There are 845 texture entries including the thumbnail, which remains useful for the overview; detailed ground is loaded by viewport.

The reference adapter includes 59 fog gates and 31 portals, source item costs, level/rank/defeat/quest/NPC conditions, and incense gathering probabilities. Fog rectangles are converted from the editor's 120-unit grid into convex world polygons. The overview supports panning, zooming, destination selection and repaired-portal travel. Opening it pauses the standalone simulation; this behavior still needs reference comparison.

Exploration saves are isolated by configuration and, in Zhushen, by role. They preserve balances, flags, opened gates, explored cells, party positions/HP/energy, the random state, permanent clears and respawn timers. Explicit restart clears this exploration save. Active buffs, in-progress enemy HP and cast/cooldown state are not yet resumed.

The standalone comparison preset starts at world level 1 with 20 incense, its home portal repaired and fog containing the spawn open. The four heroes use level-10 attributes from the source tables. This is not the user's live account.

The skill adapter compiles source coefficients, pre/post timing, target counts, projectiles, public cooldown groups, energy costs, HP/time gates and supported buffs. The core resolves multi-hit timelines, homing projectiles, healing, forced critical hits, attack-speed modifiers, charges and jumps. Boss HP phases come from their skill conditions; timed enrage is a separate status.

The renderer uses the scene's 549 foreground polygons and region light switches. It copies the visible ground into a render texture and composites only foreground pixels over actors. Directional regions use a smaller ambient light plus the flashlight cone.

Still incomplete: defense/critical calibration, specialized enemy actions and conditions, multiple-warning layouts, damage-limit rules, sword-fan timing, full skill effects, hero/quest progression, complete enemy art and exact overview styling. `audit.json` lists every unresolved skill action instead of claiming complete adaptation.

`node tools/reference-smoke.mjs` validates local assets, movement, a naturally reached battle, atlas animation frames, bounded visible tiles, and three restarts at desktop and mobile sizes. The ordinary `npm run smoke:web -- http://127.0.0.1:4174` continues to validate the independent deterministic combat fixture.

## Validation On 2026-09-05

- 70 deterministic tests passed, including skill-frame parsing, multi-hit cancellation, multi-target homing heals, energy/public cooldown gates, buff expiry and jump dodging.
- Creator 2.4.15 Web Mobile build succeeded.
- Reference browser smoke opened the overview, selected a gate, navigated to it and clicked its unlock command. The balance changed from 20 to 15. Reload restored the same balance, position and 109 explored cells. Repaired-portal travel changed position without spending more incense. Combat, atlas animation, desktop/mobile views and three restarts passed without console errors or failed requests.
- Desktop 1280 x 800 and mobile 390 x 844 captures were inspected. Detailed map coverage is recorded in `audit.json` as required and missing tile paths.
- Foreground render-texture checks found 3153 covered samples in the starting view. A renderer-only flashlight probe measured alpha 0 ahead versus 64 behind, independently of gameplay progression.
- Three post-combat restarts retained eight world-layer children and four character views. The damage-label pool remained bounded.
- The independent fixture still completed its full navigation, unlock and Boss sequence in about 183 seconds of simulated time.
- The source Boss run reached both paid gates and defeated the first Boss in about 89.55 simulated seconds, with three survivors, without teleporting or changing combat stats. It observed normal attacks, charge, jump, phase 2 and death. Run it with `node --no-warnings --loader ./tests/ts-loader.mjs tools/reference-boss-smoke.mjs` after staging.
- The Zhushen package contains 90 owned files. Current host type checking reports zero module errors and 17 other host diagnostics. A runtime test inside the host remains outstanding; no reference assets or converted source tables are exported.
