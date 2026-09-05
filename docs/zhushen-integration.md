# Zhushen H5 Integration

The standalone demo and the host module share the same `core`, `presentation`, `app` and `framework` code. The core has no Cocos, DOM, storage or networking dependency.

## Export

```powershell
node tools/export-zhushen-module.mjs --out temp/zhushen-module --verify-host D:\group\zhushen\client
node tools/check-zhushen-host.mjs temp/zhushen-module D:\group\zhushen\client
```

The export contains a Cocos 2.4.15 module under `assets/scripts/modules/auto_explore`, its config, an empty host Prefab, metadata and a SHA-256 manifest. The exporter checks target-file conflicts and preserves unrelated files. It produces a package; it does not install into the host or modify SVN state.

The compiler check overlays the package onto the host's current source in memory and reports diagnostics in the exported module separately. It does not prove that the whole host builds or that the view has run inside it.

## Host entry

Once the exported assets are integrated and imported by Creator, the module entry is:

```ts
import { openAstraExplore } from "./modules/auto_explore/AstraExploreView";

openAstraExplore();
```

`AstraExploreView` derives from the host's `BaseUI` and is opened through `UIManager`. It pauses ready sessions on `exit`, resumes a cached instance, disposes its runtime immediately on final close, and fits its portrait content without changing the host's global resolution or profiler setting. Its back button calls the host's `closeSelf()` path. Pending configuration/open callbacks cannot restart a finally closed view.

Open after the host has initialized role information. The view derives the storage suffix with the same `StringUtil.getNorKey(reg_time, srv_id, rid)` call used by the role controller. An explicit `roleKey` option supports custom host setup and the offline probe. A cached view creates new content when its role changes.

## Services

| Contract | Host mapping |
| --- | --- |
| Config | `RuntimeConfigPort.load`; default Cocos resource JSON, replaceable with a host config provider |
| Storage | `StorageMgr.getObject/setObject/remove`, using a captured suffix and `useRoleKey = false` |
| Events | `MessageCenter.sendMessage`, namespaced with `auto_explore:` |
| Run protocol | `startRun`, `submitCheckpoint`, `settleRun` supplied through `RuntimeProtocolPort` |
| UI lifecycle | `BaseUI.enter/exit/dispose` and the host `UIManager` |

The default protocol is local/offline. A real server adapter must supply the run ID and map those calls to its own allocated protocol definitions. The integration does not allocate protocol numbers or consume the host's legacy turn-based battle reports.

Capturing the suffix preserves the existing storage key format and keeps queued writes in the original role after `StorageMgr.setRoleKey()` changes. The lower-level `createZhushenPorts()` retains its old `useRoleKey = true` behavior when no suffix is supplied; the view always supplies one.

`ExploreRuntime` makes one result submission per run, retries failed submissions with the same run ID and sequence, and ignores stale view callbacks after disposal. Stored checkpoints currently contain completed-run receipts and exploration summaries. They do not restore an in-progress battle.

## Isolated Host Runtime

Prepare an ignored Creator project using the current host code and loading Spine:

```powershell
node tools/export-zhushen-module.mjs --out temp/zhushen-module --verify-host D:\group\zhushen\client
node tools/prepare-zhushen-runtime.mjs --host D:\group\zhushen\client --spine D:\group\zhushen\spine
```

Build `temp/zhushen-runtime-checked` with Creator 2.4.15. Its generated `host_probe` scene is the start scene. Serve its `build/web-mobile` directory on an available localhost port, then run:

```powershell
node tools/zhushen-runtime-smoke.mjs http://127.0.0.1:4175/
node tools/verify-zhushen-runtime.mjs temp/zhushen-runtime-checked
```

The probe runs actual `BaseUI`, `BaseView`, `UIManager`, `LayerManager`, `ResourceManager`, `StorageMgr`, `TimerManager` and `MessageCenter` code with explicit probe-role suffixes. It uses the host's `Main` layout and loading animation but starts the UI/storage services directly, without the application's login flow. It enables exploration persistence in its supplied config. Host build plugins and backend protocol adapters are not installed by the preparer.

For the authorized local reference comparison, stage the cache separately into `temp/zhushen-runtime-checked/build/web-mobile/reference-preview` and append `?reference=1` to the URL. The runtime project, copied host files, dependencies, reference assets and captured reports remain ignored. None enter the module export or Git.

The preparer records source hashes and rejects conflicting edits in the generated project; equivalent Creator JSON formatting is preserved. If source files retire, prepare a fresh output directory. `verify-zhushen-runtime.mjs` compares the recorded source bytes with their current originals.

## Current Evidence

- Service adapter behavior is covered by `tests/runtime-host.test.ts`.
- The exported module has been checked against current Zhushen source and Cocos 2.4.15 declarations.
- The host Prefab is loaded and instantiated by the standalone browser smoke test.
- On 2026-09-06, the isolated host runtime passed with the independent fixture and the local reference map. The final reference run covered joystick movement, the overview, the back button, final destruction, cached pause/reopen, role switching, pending configuration close, and a replacement open interrupted by close.
- Actual message observers confirmed one startup event per new runtime and no startup after cancellation. Role A's queued save stayed in A after switching storage to B. Cached content was reused within a role and replaced across roles.
- Desktop and mobile captures were inspected. The tested view preserved the host design resolution and profiler setting. No console errors, failed asset requests or external HTTP requests were recorded.
- 3,558 copied source files matched their recorded source hashes after the build. The original working copy was not installed into or edited. The build used the installed 2.4.15 editor and its configured custom engine.
- Production installation, the complete host startup, real protocol traffic, reconnect and live account integration remain separate validation items in the replica audit.
