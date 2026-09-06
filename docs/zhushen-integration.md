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
import { realExploreProtocol } from "./RealExploreProtocol";

openAstraExplore({ protocol: realExploreProtocol });
```

The production entry has no protocol fallback. `openAstraExplore` validates synchronously before calling `UIManager.show`, and the view validates again before creating runtime content. Every caller must supply `RuntimeProtocolPort`. The isolated host fixture explicitly creates `LocalDemoPorts` and passes its protocol; there is no public offline bypass flag.

`AstraExploreView` derives from the host's `BaseUI` and is opened through `UIManager`. It pauses ready sessions on `exit`, resumes a cached instance, disposes its runtime immediately on final close, and fits its portrait content without changing the host's global resolution or profiler setting. Its back button calls the host's `closeSelf()` path. Pending configuration/open callbacks cannot restart a finally closed view.

Only one live `ExploreRuntime` may own a `checkpointScope` in the JavaScript process. The lease is acquired before configuration loading, session construction or `startRun`, so a second view for the same captured role fails observably without creating another server run. Restart on the owning instance is allowed. Disposal releases the run lease while leaving any shared result-delivery operation protected by the delivery ledger. Configuration or run-start failure with no pending delivery also releases the lease; pending recovery and unreadable/invalid receipt errors retain it until disposal so another view cannot race the unresolved scope.

Open after the host has initialized role information. The view derives the storage suffix with the same `StringUtil.getNorKey(reg_time, srv_id, rid)` call used by the role controller. An explicit `roleKey` option supports custom host setup and the offline probe. A cached view creates new content when its role changes.

## Services

| Contract | Host mapping |
| --- | --- |
| Config | `RuntimeConfigPort.load`; default Cocos resource JSON, replaceable with a host config provider |
| Storage | `StorageMgr.getObject/setObject/remove`, using a captured suffix and `useRoleKey = false` |
| Events | `MessageCenter.sendMessage`, namespaced with `auto_explore:` |
| Run protocol | `startRun`, `submitCheckpoint`, `settleRun` supplied through `RuntimeProtocolPort` |
| UI lifecycle | `BaseUI.enter/exit/dispose` and the host `UIManager` |

A real server adapter must supply the run ID and map those calls to its own allocated protocol definitions. The integration does not allocate protocol numbers, define response schemas, or consume the host's legacy turn-based battle reports. `realExploreProtocol` above is an application-owned example name, not a module export.

Every `RuntimeProtocolPort` method must resolve or reject within an adapter-owned bounded timeout. After reporting a timeout, the adapter must suppress a late transport callback so one request cannot produce two outcomes. The runtime deliberately does not start a competing retry while submit or settlement remains unresolved: every runtime sharing that checkpoint scope stays joined to the same operation and reports `submitting`. This avoids duplicating a potentially non-idempotent side effect, but it means a broken adapter can keep the scope locked. Production recovery, reconnect and crash handling still require server idempotency keyed by run ID and sequence once the real contract exists.

Capturing the suffix preserves the existing storage key format and keeps queued writes in the original role after `StorageMgr.setRoleKey()` changes. The view always supplies `roleKey`. A lower-level caller that intentionally retains `useRoleKey = true` must provide a stable, role-specific `checkpointScope`; otherwise `createZhushenPorts()` rejects the adapter because an in-process delivery ledger could cross role boundaries.

`ExploreRuntime` makes one result submission per run and ignores stale view callbacks after disposal. The local `astra.exploration.last-result.v2` delivery envelope stores `{ version, phase, checkpoint }`; delivery-only metadata is never sent through the protocol port. `pending` calls submit then settle, `submitted` calls settle only, and `settled` performs local cleanup only. The receipt is cleared only after the required protocol work and phase persistence succeed. Failure leaves `resultState === "retry_pending"`, exposes the original run ID and sequence through `AstraExploreView.getPendingResult()`, emits runtime `result_pending` and host `auto_explore:explore_result_pending`, and can be retried with `AstraExploreView.retryPendingResult()`. Reentrant retry calls while delivery is active receive the same promise and cannot start duplicate protocol work.

Startup loads the role-scoped v2 receipt before requesting a new run and resumes only the work remaining for its saved phase. `RuntimeStoragePort.checkpointScope` gives local storage and each captured Zhushen role a stable identity. A module-level ledger keeps both the newest known phase and its active operation promise for that scope across restart, disposal and a fresh ports wrapper in the same JavaScript process. A concurrent reopen joins the shared submit or settlement instead of issuing the same phase, then can take over persistence and remaining work after a disposed owner stops. A matching stale disk phase cannot replay already confirmed protocol work. A different stored run ID or sequence is reported as a conflict and neither identity is overwritten. The ledger is removed immediately after storage cleanup succeeds, even if the runtime that initiated cleanup was disposed meanwhile.

The old `.v1` key is never exposed through the v2 storage port. Earlier builds wrote an unversioned receipt after completion and did not clear it, so its delivery state is ambiguous: the upgrade ignores it, leaves it intact for support or an explicit migration, and allows a new v2 run to start. New writes and cleanup affect only `.v2`; when both keys exist, v2 is authoritative. Data actually returned from the v2 key remains fail-closed: an unversioned record, missing/invalid sequence, empty run ID, missing payload or another unsupported shape is retained with `resultState === "invalid"`; malformed JSON or another storage read failure is retained with `resultState === "unreadable"`. Restart first resolves a valid pending v2 delivery instead of blindly loading disk state. This ledger guarantee applies only within the same JavaScript process. A process crash after a remote side effect but before its newer phase is persisted still requires server idempotency by run ID and sequence once the real protocol contract exists. Stored receipts restore completed-run delivery only, not an in-progress battle.

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

The probe runs actual `BaseUI`, `BaseView`, `UIManager`, `LayerManager`, `ResourceManager`, `StorageMgr`, `TimerManager` and `MessageCenter` code with explicit probe-role suffixes. It uses the host's `Main` layout and loading animation but starts the UI/storage services directly, without the application's login flow. It enables exploration persistence in its supplied config and explicitly passes the locally created probe protocol. Host build plugins and backend protocol adapters are not installed by the preparer.

For the authorized local reference comparison, stage the cache separately into `temp/zhushen-runtime-checked/build/web-mobile/reference-preview` and append `?reference=1` to the URL. The runtime project, copied host files, dependencies, reference assets and captured reports remain ignored. None enter the module export or Git.

The preparer records source hashes and rejects conflicting edits in the generated project. If source files retire, prepare a fresh output directory. `verify-zhushen-runtime.mjs` compares the recorded source bytes with their current originals and verifies every staged exported module asset, including configs, resources and metadata rather than only TypeScript/JavaScript files. Valid `.meta` files use canonical structured-JSON comparison so Creator-only formatting changes do not hide field changes or create newline-only failures. The verifier also enumerates all three export roots and rejects unlisted or retired files.

## Current Evidence

- Service adapter behavior is covered by `tests/runtime-host.test.ts`.
- The exported module has been checked against current Zhushen source and Cocos 2.4.15 declarations.
- The host Prefab is loaded and instantiated by the standalone browser smoke test.
- On 2026-09-06, the isolated host runtime passed with the independent fixture and the local reference map. The final reference run covered joystick movement, the overview, the back button, final destruction, cached pause/reopen, role switching, pending configuration close, and a replacement open interrupted by close.
- Actual message observers confirmed one startup event per new runtime and no startup after cancellation. Role A's queued save stayed in A after switching storage to B. Cached content was reused within a role and replaced across roles.
- Desktop and mobile captures were inspected. The tested view preserved the host design resolution and profiler setting. No console errors, failed asset requests or external HTTP requests were recorded.
- 3,558 copied source files matched their recorded source hashes after the build. The original working copy was not installed into or edited. The build used the installed 2.4.15 editor and its configured custom engine.
- On 2026-09-07, 308 core/tool tests and 29 focused runtime-host tests passed. The final 104-file export had zero module errors and the same 17 unrelated host diagnostics. Role-scoped active-run leases, v1 upgrade isolation, v2 phase recovery, synchronous retry reentrancy, held submit/settle reopen joins, stale-disk takeover and result cleanup are covered.
- The final isolated browser run used cached roles A/B and a separate role C for non-cached close races, preserving one live runtime per role scope. Cache reuse, role replacement, delayed configuration close and two viewports passed with empty errors, external requests and protocol request failures.
- Final source verification reported zero changed source files, zero changed exported files and zero unexpected export-root files after Creator build.
- Production installation, the complete host startup, real protocol traffic, reconnect and live account integration remain separate validation items in the replica audit.
