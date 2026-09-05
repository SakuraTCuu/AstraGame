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

The reference adapter includes 59 fog gates, 31 portals and 73 additional source interactions, including chests. Source item costs, level/rank/defeat/quest/NPC conditions and incense gathering probabilities are retained. Chests follow the source `autoOpen` flag. Fog rectangles are converted from the editor's 120-unit grid into convex world polygons. The overview supports panning, zooming, destination selection and repaired-portal travel. Opening it pauses the standalone simulation; this behavior still needs reference comparison.

Exploration saves are isolated by configuration and, in Zhushen, by role. They preserve balances, level/experience, counted kills, flags, opened gates, explored cells, party positions/HP/energy, the random state, permanent clears and respawn timers. Existing saves without experience/count fields load with zero for those fields. Explicit restart clears this exploration save. Active buffs, in-progress enemy HP and cast/cooldown state are not yet resumed.

The standalone comparison preset starts at world level 1 and rank 1 with 20 incense, its home portal repaired and fog containing the spawn open. It begins the first-world mainline after the tutorial's return-to-town step. The four heroes use level-10 attributes from the source tables. These are explicit comparison-preset choices, not the user's live account.

Source item 7 rewards now advance team experience using all 1525 `PlayerLevel` rows. The first world has 98 enemy templates with experience rewards. Experience carries across thresholds and immediately refreshes level-gated exploration. Kill-count conditions retain their required counts; one historical defeat is not treated as completion of a multi-kill task. Daily gain limits and account-dependent reward scaling remain unconfirmed. At the last configured level the local simulation stops accumulating experience.

The journal contains 156 mainline steps, 30 first-Boss-reward entries and 324 rank tasks across 109 configured ranks. It enforces prerequisites, counted kills, monster subtype counts, cumulative item gains, party-level checks and claim-once flags. Inventory rewards and claims persist across reloads, including compatibility with saves that predate the added currencies. The task tracker and journal expose navigation, reward claims and promotion. Task routes approach the first blocking fog entrance; paying the entrance resumes the original destination without bypassing the lock.

The first source promotion and seven mainline steps are playable through the first Boss. Nine source condition rows still require other game modes. Parsed rename, recruitment and equipped-item counters also still need their corresponding standalone account actions; rank attribute bonuses and hero development are not applied yet. Configuration conversion alone does not make those later tasks playable. The journal starts from an explicitly selected post-tutorial chapter rather than marking the complete campaign as reproduced.

The skill adapter compiles source coefficients, pre/post timing, target counts, projectiles, public cooldown groups, energy costs, HP/time gates and supported buffs. The core resolves multi-hit timelines, homing projectiles, healing, forced critical hits, attack-speed modifiers, charges and jumps. Boss HP phases come from their skill conditions; timed enrage is a separate status.

The renderer uses the scene's 549 foreground polygons and region light switches. It copies the visible ground into a render texture and composites only foreground pixels over actors. Directional regions use a smaller ambient light plus the flashlight cone.

Still incomplete: defense/critical calibration, specialized enemy actions and conditions, multiple-warning layouts, damage-limit rules, sword-fan timing, full skill effects, hero/account development and remaining task actions, complete enemy art and exact overview styling. `audit.json` lists unresolved skill actions and progression conditions instead of claiming complete adaptation.

`node tools/reference-smoke.mjs` validates local assets, movement, a naturally reached battle, atlas animation frames, bounded visible tiles, and three restarts at desktop and mobile sizes. The ordinary `npm run smoke:web -- http://127.0.0.1:4174` continues to validate the independent deterministic combat fixture.

## Validation On 2026-09-05

- 79 deterministic tests passed, including skill-frame parsing, multi-hit cancellation, multi-target homing heals, energy/public cooldown gates, buff expiry, jump dodging, experience rollover, atomic reward claims, rank prerequisites, fog-gate task routing and progression-save compatibility.
- Creator 2.4.15 Web Mobile build succeeded.
- Reference browser smoke opened the overview, selected a gate, navigated to it and clicked its unlock command. The balance changed from 20 to 15. Reload restored the same balance, position and 109 explored cells. Repaired-portal travel changed position without spending more incense. Combat, atlas animation, desktop/mobile views and three restarts passed without console errors or failed requests.
- Desktop 1280 x 800 and mobile 390 x 844 captures were inspected. Detailed map coverage is recorded in `audit.json` as required and missing tile paths.
- Foreground render-texture checks found 3153 covered samples in the starting view. A renderer-only flashlight probe measured alpha 0 ahead versus 64 behind, independently of gameplay progression.
- Three post-combat restarts retained eight world-layer children and four character views. The damage-label pool remained bounded.
- Browser combat earned 20 experience, matching the source rewards for its counted kills. Storage retained the same level, experience and counters; the HUD was inspected at desktop and mobile sizes.
- Browser UI claimed the three initial rank tasks, promoted to rank 2 and claimed the first mainline reward. Mobile and desktop journal captures were inspected. A label-size check prevents Cocos label creation from collapsing the task tracker to zero width.
- The independent fixture still completed its full navigation, unlock and Boss sequence in about 183 seconds of simulated time.
- The source Boss run reached both paid gates and defeated the first Boss in about 89.1 simulated seconds, with three survivors, without teleporting or changing combat stats. It observed normal attacks, charge, jump, phase 2 and death. Natural rewards advanced the team to level 2 with 40/600 experience; reload preserved the level, experience and one Boss kill. Run it with `node --no-warnings --loader ./tests/ts-loader.mjs tools/reference-boss-smoke.mjs` after staging.
- `node --no-warnings --loader ./tests/ts-loader.mjs tools/reference-journal-smoke.mjs` completed the first seven mainline steps, a chest, two paid gates and the first Boss in about 201.6 simulated seconds. Three heroes survived. Claiming the first-Boss reward produced one seal and brought vouchers to 270. Reload retained the reward and refused a duplicate claim. It did not teleport or alter combat stats.
- The Zhushen package contains 94 owned files. Current host type checking reports zero module errors and 17 other host diagnostics. A runtime test inside the host remains outstanding; no reference assets or converted source tables are exported.
