# Local Reference Preview

The user authorized temporary use of their local WeChat resource cache on 2026-09-05. Cached content, generated profiles, tables, and screenshots remain in ignored local directories. They are not part of the Git repository or the Zhushen module export.

## Run

Build the project with Cocos Creator 2.4.15, then stage the authorized cache:

```powershell
node tools/stage-reference-cache.mjs --cache '<authorized gamecaches directory>'
```

Serve `build/web-mobile`, and open `http://127.0.0.1:4174/?reference=1`. The reference mode is restricted to a localhost browser URL. The default URL continues to use the independent combat fixture. Restage after a Creator build or after visiting additional areas in the reference game.

## Asset Pipeline

- `cacheList.json` resolves original import/native paths to cached files.
- The base and extension bundle configurations are joined by decoded UUID. Pack ordering and version indices are preserved, including textures referenced across the two parts.
- Resource-only bundles load through Cocos `assetManager`. Original game scripts are not loaded.
- Table archives use bounded length fields, the compression flag, zlib, and JSON. `__KEY_MAP__` supplies field names; `$id` references resolve within the same field.
- `profile.json` supplies the local scene and presentation bindings. `audit.json` records missing art and adaptation limits.
- Ground textures use their logical slice dimensions. Native cache images may be reduced to 819 pixels while representing 1024 logical pixels.
- Visible map tiles load on demand and release when outside the viewport. Character nodes follow the existing combat snapshots.

## Current Boundary

The preview loads the actual first world map, available detailed map tiles, four Spine characters, and available enemy assets at configured spawn positions. The original collision grid is sampled into the independent navigation grid. All 224 source route points map to unblocked source cells; this validates the coordinate conversion, not every sampled boundary or gameplay restriction.

The map thumbnail fills areas whose detailed slices have not yet entered the supplied cache. Missing detailed art remains an explicit limitation. The preview currently adapts a subset of enemy fields; hero progression, complete skill formulas, fog payment conditions, NPC state, occlusion polygons, and original world-map interactions still need implementation and comparison with live gameplay. It is not a claim of complete replication.

`node tools/reference-smoke.mjs` validates local assets, movement, a naturally reached battle, atlas animation frames, bounded visible tiles, and three restarts at desktop and mobile sizes. The ordinary `npm run smoke:web -- http://127.0.0.1:4174` continues to validate the independent deterministic combat fixture.

## Validation On 2026-09-05

- 52 deterministic tests passed, including paid-interaction accounting and split-bundle dependency indexing.
- Creator 2.4.15 Web Mobile build succeeded.
- Reference browser smoke reached combat by navigation, observed positive damage, loaded four hero SkeletonData assets and enemy animation sequences, and reported no console errors or failed resource requests.
- Desktop 1280 x 800 and mobile 390 x 844 captures were inspected. Sampled screenshots contained 2033 or more distinct colors. Cached detail and thumbnail-only areas remain visually distinguishable.
- Three post-combat restarts retained five world-layer children and four character views. The damage-label pool remained bounded.
- The independent fixture still completed its full navigation, unlock and Boss sequence in about 183 seconds of simulated time.
- The Zhushen package exported 78 owned files. Host type checking reported zero module errors and 17 pre-existing host diagnostics. This does not replace a build or runtime test inside the host project.
