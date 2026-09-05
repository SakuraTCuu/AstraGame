# Exploration Demo

Minimal Cocos Creator 2.4.15 frontend prototype for a portrait 2.5D squad exploration game.

## Current scope

- large scrollable world with a 2.5D presentation
- fog of war and persistent discovery during a session
- player-centered flashlight cone
- pointer navigation and automatic path following
- four-character squad formation
- autonomous target acquisition
- attacks, skills, healing, damage numbers, enemies, and a boss
- explicit actor, navigation, combat, and boss state machines
- deterministic core tests independent of Cocos

All visuals and tuning values are original placeholders. No third-party game assets or extracted code are included.

## Open in Creator

Use Cocos Creator `2.4.15` and open this directory as a project. The configured start scene is `assets/scenes/demo.fire`.

## Verification

```powershell
npm test
```

Build the Web Mobile target with the installed Creator version:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& 'C:\ProgramData\cocos\editors\Creator\2.4.15\CocosCreator.exe' `
  --path (Get-Location).Path `
  --build 'platform=web-mobile;debug=true;buildPath=build' `
  --force
```

Serve and smoke-test the generated build in separate terminals:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory build\web-mobile
npm run smoke:web
```

Open `http://127.0.0.1:4173/` to play the current build.

Generated directories such as `library`, `temp`, and `build` are intentionally ignored.
