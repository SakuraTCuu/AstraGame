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

`AstraExploreView` derives from the host's `BaseUI` and is opened through `UIManager`. It pauses on `exit`, resumes a cached instance, disposes its runtime on final destruction, and fits its portrait content without changing the host's global resolution or profiler setting.

## Services

| Contract | Host mapping |
| --- | --- |
| Config | `RuntimeConfigPort.load`; default Cocos resource JSON, replaceable with a host config provider |
| Storage | `StorageMgr.getObject/setObject/remove`, all with `useRoleKey = true` |
| Events | `MessageCenter.sendMessage`, namespaced with `auto_explore:` |
| Run protocol | `startRun`, `submitCheckpoint`, `settleRun` supplied through `RuntimeProtocolPort` |
| UI lifecycle | `BaseUI.enter/exit/dispose` and the host `UIManager` |

The default protocol is local/offline. A real server adapter must supply the run ID and map those calls to its own allocated protocol definitions. The integration does not allocate protocol numbers or consume the host's legacy turn-based battle reports.

`ExploreRuntime` makes one result submission per run, retries failed submissions with the same run ID and sequence, and ignores stale view callbacks after disposal. Stored checkpoints currently contain completed-run receipts and exploration summaries. They do not restore an in-progress battle.

## Current evidence

- Service adapter behavior is covered by `tests/runtime-host.test.ts`.
- The exported module has been checked against current Zhushen source and Cocos 2.4.15 declarations.
- The host Prefab is loaded and instantiated by the standalone browser smoke test.
- Actual installation, UI opening inside the host, real protocol traffic, reconnect and live role-data mapping remain separate validation items in the replica audit.
