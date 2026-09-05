# World Rules Validation

Date: 2026-09-05. Baseline commit: `c0f70ef`. Configuration: `auto_explore_demo_v2`, schema version 2.

| Check | Result | Evidence |
| --- | --- | --- |
| Deterministic core and framework tests | PASS, 25 tests | `npm test`; exploration additions in `tests/world.test.ts` |
| Creator 2.4.15 Web Mobile build | PASS | CLI exited 0; `temp/build-v2.log` records successful output |
| Minimap selection and joystick override | PASS | Browser input reached `resume_wait` with its destination retained |
| Shipped map progression | PASS | Normal movement reached the shrine and cache; normal combat cleared `gate_guard` and unlocked the boss region |
| Shared navigation collision | PASS | More than 11,000 actor-position checks during browser progression remained on walkable ground |
| Boss phase rendering | PASS, controlled test | Boss was reached after region unlocking; health was then explicitly set to 50 percent to check `phase2` rendering |
| Browser runtime errors | PASS, 0 errors | `temp/qa/report.json` |
| Viewport checks | PASS | 720 x 1280 reference, 390 x 844 mobile, 1280 x 800 desktop; HUD and joystick bounds checked on mobile and desktop |
| Visual and pixel checks | PASS | Seven PNG captures reviewed; all had more than 100 distinct sampled colors |

Reproduce the browser check against an existing local server with:

```powershell
npm run smoke:web -- http://127.0.0.1:4174
```

The smoke test writes its report and screenshots under ignored `temp/qa/`. Exploration is simulated through normal session inputs and fixed ticks, with no position teleport or combat-stat changes. The subsequent controlled Boss phase check is separate and must not be described as a natural full-map victory.

The Creator log contains legacy engine deprecation/profile warnings. They did not prevent the build; browser runtime errors were zero.

Not validated in this increment: reference-game timing or numeric parity, natural victory against the shipped boss tuning, production settlement or persistence, WeChat developer-tool packaging, physical mobile devices and long-session performance. The small deterministic test encounter does cover a natural boss defeat.
