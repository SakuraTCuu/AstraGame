import assert from "node:assert/strict";
import test from "node:test";
import { ExploreRuntime } from "../assets/scripts/framework/ExploreRuntime.ts";
import { createZhushenPorts } from "../assets/scripts/framework/ZhushenPorts.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";
import { requireRuntimeProtocol } from "../assets/scripts/framework/RuntimePorts.ts";
import type { RunCheckpoint, RuntimePorts, StoredRunReceipt } from "../assets/scripts/framework/RuntimePorts.ts";

const config: DemoConfig = {
  seed: 12, world: { width: 10, height: 10 }, fog: { revealRadius: 3 },
  squad: { actors: [{ id: "hero", kind: "hero", x: 2.5, y: 2.5, hp: 100, attack: 20, defense: 0, moveSpeed: 2, attackRange: 5, aggroRange: 5 }] },
  enemies: [{ id: "enemy", kind: "boss", x: 3.5, y: 2.5, hp: 1, attack: 1, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 5 }],
  skills: { player: { id: "attack", range: 5, cooldown: 1, power: 1, target: "enemy" }, enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" } },
  spawns: [{ id: "boss", enemyId: "enemy", trigger: "distance", x: 3.5, y: 2.5, triggerRadius: 5, count: 1, spawnRadius: 0, encounterId: "final" }],
  session: { completionEncounterId: "final" },
};

let fixtureSequence = 0;
function portsFixture(checkpointScope = `test:runtime-host:${++fixtureSequence}`) {
  const starts: unknown[] = [];
  const checkpoints: RunCheckpoint[] = [];
  const settlements: any[] = [];
  const telemetry: string[] = [];
  let stored: unknown = null;
  const ports: RuntimePorts = {
    config: { load: async <T>() => config as T },
    storage: {
      checkpointScope,
      loadCheckpoint: async () => stored,
      saveCheckpoint: async (receipt) => { stored = receipt; },
      clearCheckpoint: async () => { stored = null; },
    },
    protocol: {
      startRun: async (request) => { starts.push(request); return { runId: `run-${starts.length}` }; },
      submitCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); return {}; },
      settleRun: async (request) => { settlements.push(request); return { ok: true }; },
    },
    telemetry: { track: (event) => { telemetry.push(event); } },
  };
  return { ports, starts, checkpoints, settlements, telemetry, setStored: (value: unknown) => { stored = value; } };
}

const receipt = (checkpoint: RunCheckpoint, phase: StoredRunReceipt["phase"] = "pending"): StoredRunReceipt =>
  ({ version: 2, phase, checkpoint });

test("runtime emits and submits a result once, then restarts with a new run", async () => {
  const fixture = portsFixture();
  const runtime = new ExploreRuntime(fixture.ports);
  let finished = 0;
  runtime.events.on("finished", () => { finished += 1; runtime.update(0.1); });
  assert.equal(await runtime.start(), true);
  for (let tick = 0; tick < 20; tick += 1) runtime.update(0.1);
  await runtime.waitForResult();
  assert.equal(finished, 1);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(fixture.settlements[0].runId, "run-1");
  assert.equal(await runtime.restart(), true);
  assert.equal(runtime.session!.runState, "running");
  runtime.update(0.1);
  await runtime.waitForResult();
  assert.equal(finished, 2);
  assert.equal(fixture.settlements[1].runId, "run-2");
  runtime.dispose();
  assert.equal(runtime.update(1), null);
});

test("disposing while config loads prevents stale session creation or protocol requests", async () => {
  const fixture = portsFixture();
  let complete: (value: DemoConfig) => void;
  const loading = new Promise<DemoConfig>((resolve) => { complete = resolve; });
  fixture.ports.config.load = async <T>() => await loading as T;
  const runtime = new ExploreRuntime(fixture.ports);
  const pending = runtime.start();
  runtime.dispose();
  complete!(config);
  assert.equal(await pending, false);
  assert.equal(runtime.session, null);
  assert.equal(fixture.starts.length, 0);
});

test("one checkpoint scope permits only one live runtime before config or protocol work", async () => {
  const fixture = portsFixture();
  let configLoads = 0;
  fixture.ports.config.load = async <T>() => { configLoads += 1; return config as T; };
  const first = new ExploreRuntime(fixture.ports);
  const second = new ExploreRuntime({ ...fixture.ports, storage: { ...fixture.ports.storage } });
  assert.equal(await first.start(), true);
  let observed: Error | null = null;
  second.events.once<Error>("error", (error) => { observed = error; });
  assert.equal(await second.start(), false);
  assert.equal(second.session, null);
  assert.equal(second.state, "error");
  assert.match(observed!.message, /already active/);
  assert.equal(configLoads, 1);
  assert.equal(fixture.starts.length, 1);
  first.dispose(); second.dispose();
});

test("different checkpoint scopes can run concurrently", async () => {
  const firstFixture = portsFixture(), secondFixture = portsFixture();
  const first = new ExploreRuntime(firstFixture.ports), second = new ExploreRuntime(secondFixture.ports);
  assert.equal(await Promise.all([first.start(), second.start()]).then((values) => values.every(Boolean)), true);
  assert.equal(firstFixture.starts.length, 1);
  assert.equal(secondFixture.starts.length, 1);
  first.dispose(); second.dispose();
});

test("dispose releases the active-run lease for a new runtime in the same scope", async () => {
  const fixture = portsFixture();
  const first = new ExploreRuntime(fixture.ports);
  assert.equal(await first.start(), true);
  first.dispose();
  const second = new ExploreRuntime({ ...fixture.ports, storage: { ...fixture.ports.storage } });
  assert.equal(await second.start(), true);
  assert.equal(fixture.starts.length, 2);
  second.dispose();
});

for (const failure of ["config", "protocol"] as const) {
  test(`${failure} start failure releases a lease when no result delivery is pending`, async () => {
    const fixture = portsFixture();
    if (failure === "config") fixture.ports.config.load = async () => { throw new Error("config unavailable"); };
    else fixture.ports.protocol.startRun = async () => { throw new Error("start unavailable"); };
    const first = new ExploreRuntime(fixture.ports);
    assert.equal(await first.start(), false);

    const recovered = portsFixture(fixture.ports.storage.checkpointScope);
    const second = new ExploreRuntime({ ...recovered.ports, storage: fixture.ports.storage });
    assert.equal(await second.start(), true);
    assert.equal(second.state, "ready");
    second.dispose();
  });
}

test("failed result submission retries with the same run and sequence", async () => {
  const fixture = portsFixture();
  let attempts = 0;
  fixture.ports.protocol.settleRun = async (request) => {
    fixture.settlements.push(request);
    if (++attempts === 1) throw new Error("offline");
    return { ok: true };
  };
  const runtime = new ExploreRuntime(fixture.ports);
  await runtime.start();
  runtime.update(0.1);
  await runtime.waitForResult();
  assert.equal(runtime.lastError!.message, "offline");
  await runtime.retryResult();
  assert.equal(runtime.lastError, null);
  assert.equal(fixture.settlements.length, 2);
  assert.equal(fixture.settlements[0].runId, fixture.settlements[1].runId);
  assert.equal(fixture.settlements[0].sequence, fixture.settlements[1].sequence);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
  assert.equal(runtime.resultState, "settled");
});

test("startup retries a saved receipt before opening a new run and clears it only after settlement", async () => {
  const fixture = portsFixture();
  const checkpoint = { runId: "saved-run", sequence: 7, payload: { result: "won" } };
  await fixture.ports.storage.saveCheckpoint(receipt(checkpoint));
  const runtime = new ExploreRuntime(fixture.ports);
  const pending: any[] = [];
  runtime.events.on("result_pending", (notice) => pending.push(notice));

  assert.equal(await runtime.start(), true);
  assert.deepEqual(fixture.checkpoints, [checkpoint]);
  assert.deepEqual(fixture.settlements, [checkpoint]);
  assert.deepEqual(fixture.starts.length, 1);
  assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
  assert.equal(runtime.resultState, "idle");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].recovered, true);
});

test("synchronous pending handlers reuse the automatic recovery promise without duplicate delivery", async () => {
  const fixture = portsFixture();
  const checkpoint = { runId: "reentrant-run", sequence: 3, payload: { result: "won" } };
  await fixture.ports.storage.saveCheckpoint(receipt(checkpoint));
  const runtime = new ExploreRuntime(fixture.ports);
  let handlerPromise: Promise<void> | null = null;
  runtime.events.on("result_pending", () => {
    handlerPromise = runtime.retryResult();
    assert.equal(handlerPromise, runtime.waitForResult());
    assert.deepEqual(runtime.pendingResult, { runId: "reentrant-run", sequence: 3 });
  });

  assert.equal(await runtime.start(), true);
  await handlerPromise;
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(fixture.starts.length, 1);
});

test("saved delivery phases resume only their remaining protocol work", async () => {
  for (const phase of ["submitted", "settled"] as const) {
    const fixture = portsFixture();
    const checkpoint = { runId: `${phase}-run`, sequence: 4, payload: { result: "won" } };
    await fixture.ports.storage.saveCheckpoint(receipt(checkpoint, phase));
    const runtime = new ExploreRuntime(fixture.ports);
    assert.equal(await runtime.start(), true);
    assert.equal(fixture.checkpoints.length, 0);
    assert.equal(fixture.settlements.length, phase === "submitted" ? 1 : 0);
    assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
  }
});

test("known settlement success followed by local persistence failure never repeats protocol work", async () => {
  const fixture = portsFixture();
  const saved = fixture.ports.storage.saveCheckpoint;
  let failSettledSave = true;
  fixture.ports.storage.saveCheckpoint = async (value) => {
    if (value.phase === "settled" && failSettledSave) { failSettledSave = false; throw new Error("disk full"); }
    await saved(value);
  };
  const runtime = new ExploreRuntime(fixture.ports);
  await runtime.start();
  runtime.update(0.1);
  await runtime.waitForResult();
  assert.equal(runtime.resultState, "retry_pending");
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);

  await runtime.retryResult();
  assert.equal(runtime.resultState, "settled");
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
});

test("known submit success followed by phase persistence failure settles without resubmitting", async () => {
  const fixture = portsFixture();
  const saved = fixture.ports.storage.saveCheckpoint;
  let failSubmittedSave = true;
  fixture.ports.storage.saveCheckpoint = async (value) => {
    if (value.phase === "submitted" && failSubmittedSave) { failSubmittedSave = false; throw new Error("disk full"); }
    await saved(value);
  };
  const runtime = new ExploreRuntime(fixture.ports);
  await runtime.start();
  runtime.update(0.1);
  await runtime.waitForResult();
  assert.equal(runtime.resultState, "retry_pending");
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 0);

  await runtime.retryResult();
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
});

for (const failedPhase of ["submitted", "settled"] as const) {
  test(`restart resumes the in-process ${failedPhase} phase without replaying known protocol success`, async () => {
    const fixture = portsFixture();
    const saved = fixture.ports.storage.saveCheckpoint;
    let fail = true;
    fixture.ports.storage.saveCheckpoint = async (value) => {
      if (value.phase === failedPhase && fail) { fail = false; throw new Error("disk full"); }
      await saved(value);
    };
    const runtime = new ExploreRuntime(fixture.ports);
    await runtime.start();
    runtime.update(0.1);
    await runtime.waitForResult();
    assert.equal(await runtime.restart(), true);
    assert.equal(fixture.checkpoints.length, 1);
    assert.equal(fixture.settlements.length, 1);
    assert.equal(fixture.starts.length, 2);
    assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
  });

  test(`dispose and reopen resumes the in-process ${failedPhase} phase across ports wrappers`, async () => {
    const fixture = portsFixture();
    const saved = fixture.ports.storage.saveCheckpoint;
    let fail = true;
    fixture.ports.storage.saveCheckpoint = async (value) => {
      if (value.phase === failedPhase && fail) { fail = false; throw new Error("disk full"); }
      await saved(value);
    };
    const first = new ExploreRuntime(fixture.ports);
    await first.start();
    first.update(0.1);
    await first.waitForResult();
    first.dispose();

    const freshPorts: RuntimePorts = { ...fixture.ports, storage: { ...fixture.ports.storage } };
    const second = new ExploreRuntime(freshPorts);
    assert.equal(await second.start(), true);
    assert.equal(fixture.checkpoints.length, 1);
    assert.equal(fixture.settlements.length, 1);
    assert.equal(fixture.starts.length, 2);
    assert.equal(await freshPorts.storage.loadCheckpoint(), null);
  });
}

test("a conflicting stored identity never overwrites an in-process delivery", async () => {
  const fixture = portsFixture();
  const saved = fixture.ports.storage.saveCheckpoint;
  fixture.ports.storage.saveCheckpoint = async (value) => {
    if (value.phase === "submitted") throw new Error("disk full");
    await saved(value);
  };
  const first = new ExploreRuntime(fixture.ports);
  await first.start();
  first.update(0.1);
  await first.waitForResult();
  first.dispose();
  fixture.setStored(receipt({ runId: "different-run", sequence: 1, payload: {} }));

  const second = new ExploreRuntime({ ...fixture.ports, storage: { ...fixture.ports.storage } });
  assert.equal(await second.start(), false);
  assert.equal(second.resultState, "invalid");
  assert.match(second.lastError!.message, /conflicts with the active in-process delivery/);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 0);
});

test("failed startup receipt remains retryable and retry resumes startup with the same identity", async () => {
  const fixture = portsFixture();
  const checkpoint = { runId: "saved-run", sequence: 9, payload: { result: "won" } };
  await fixture.ports.storage.saveCheckpoint(receipt(checkpoint));
  let attempts = 0;
  fixture.ports.protocol.settleRun = async (request) => {
    fixture.settlements.push(request);
    if (++attempts === 1) throw new Error("still offline");
    return { ok: true };
  };
  const runtime = new ExploreRuntime(fixture.ports);

  assert.equal(await runtime.start(), false);
  assert.equal(runtime.state, "error");
  assert.equal(runtime.resultState, "retry_pending");
  assert.deepEqual(runtime.pendingResult, { runId: "saved-run", sequence: 9 });
  assert.equal(fixture.starts.length, 0);
  assert.deepEqual(await fixture.ports.storage.loadCheckpoint(), receipt(checkpoint, "submitted"));

  await runtime.retryResult();
  assert.equal(runtime.state, "ready");
  assert.equal(runtime.resultState, "idle");
  assert.equal(fixture.starts.length, 1);
  assert.deepEqual(fixture.settlements.map((entry) => [entry.runId, entry.sequence]), [["saved-run", 9], ["saved-run", 9]]);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(await fixture.ports.storage.loadCheckpoint(), null);
});

test("malformed v2 receipts are retained without guessing protocol fields", async () => {
  const fixture = portsFixture();
  const legacy = { runId: "legacy-run", sequence: 1, payload: { result: "won" } };
  fixture.setStored(legacy);
  const runtime = new ExploreRuntime(fixture.ports);

  assert.equal(await runtime.start(), false);
  assert.equal(runtime.resultState, "invalid");
  assert.match(runtime.lastError!.message, /unsupported legacy format/);
  assert.deepEqual(await fixture.ports.storage.loadCheckpoint(), legacy);
  assert.equal(fixture.checkpoints.length, 0);
  assert.equal(fixture.settlements.length, 0);
  assert.equal(fixture.starts.length, 0);
});

test("Zhushen upgrade ignores retained v1 receipts and only reads or clears v2", async () => {
  const fixture = portsFixture();
  const values = new Map<string, unknown>();
  const roleKey = "_upgrade_role";
  const v1Key = `astra.exploration.last-result.v1${roleKey}`;
  const v2Key = `astra.exploration.last-result.v2${roleKey}`;
  const legacy = { runId: "legacy-run", sequence: 1, payload: { result: "won" } };
  values.set(v1Key, legacy);
  const ports = createZhushenPorts({ config: fixture.ports.config, protocol: fixture.ports.protocol, roleKey,
    storage: { getObject: (key, fallback) => values.get(key) ?? fallback,
      setObject: (key, value) => { values.set(key, value); }, remove: (key) => { values.delete(key); } },
    messages: { sendMessage: () => {} } });

  assert.equal(await ports.storage.loadCheckpoint(), null);
  const runtime = new ExploreRuntime(ports);
  assert.equal(await runtime.start(), true);
  assert.deepEqual(values.get(v1Key), legacy);

  const current = receipt({ runId: "current-run", sequence: 2, payload: {} }, "submitted");
  values.set(v2Key, current);
  assert.deepEqual(await ports.storage.loadCheckpoint(), current);
  await ports.storage.clearCheckpoint();
  assert.equal(values.has(v2Key), false);
  assert.deepEqual(values.get(v1Key), legacy);
});

test("local upgrade ignores retained v1 receipts and only reads or clears v2", async () => {
  const previousCc = (globalThis as any).cc;
  const values = new Map<string, string>();
  (globalThis as any).cc = { log: () => {}, sys: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } };
  try {
    const { createLocalDemoPorts } = await import("../assets/scripts/framework/LocalDemoPorts.ts");
    const ports = createLocalDemoPorts();
    const legacy = JSON.stringify({ runId: "legacy-run", sequence: 1, payload: {} });
    values.set("astra.exploration.last-result.v1", legacy);
    assert.equal(await ports.storage.loadCheckpoint(), null);
    ports.config = { load: async <T>() => config as T };
    const runtime = new ExploreRuntime(ports);
    assert.equal(await runtime.start(), true);
    assert.equal(values.get("astra.exploration.last-result.v1"), legacy);

    const current = receipt({ runId: "current-run", sequence: 2, payload: {} }, "settled");
    values.set("astra.exploration.last-result.v2", JSON.stringify(current));
    assert.deepEqual(await ports.storage.loadCheckpoint(), current);
    await ports.storage.clearCheckpoint();
    assert.equal(values.has("astra.exploration.last-result.v2"), false);
    assert.equal(values.get("astra.exploration.last-result.v1"), legacy);
  } finally {
    (globalThis as any).cc = previousCc;
  }
});

test("unreadable stored receipts report unreadable state without clearing storage", async () => {
  const fixture = portsFixture();
  let clears = 0;
  fixture.ports.storage.loadCheckpoint = async () => { throw new SyntaxError("bad json"); };
  fixture.ports.storage.clearCheckpoint = async () => { clears += 1; };
  const runtime = new ExploreRuntime(fixture.ports);

  assert.equal(await runtime.start(), false);
  assert.equal(runtime.resultState, "unreadable");
  assert.match(runtime.lastError!.message, /could not be read and was retained: bad json/);
  assert.equal(clears, 0);
  assert.equal(fixture.starts.length, 0);
});

test("disposing during checkpoint persistence leaves the receipt and stops stale protocol work", async () => {
  const fixture = portsFixture();
  let release: () => void;
  let started: () => void;
  const persisted = new Promise<void>((resolve) => { release = resolve; });
  const saving = new Promise<void>((resolve) => { started = resolve; });
  const originalSave = fixture.ports.storage.saveCheckpoint;
  fixture.ports.storage.saveCheckpoint = async (value) => { await originalSave(value); started(); await persisted; };
  const runtime = new ExploreRuntime(fixture.ports);
  await runtime.start();
  runtime.update(0.1);
  await saving;
  runtime.dispose();
  release!();
  await runtime.waitForResult();
  assert.equal(fixture.checkpoints.length, 0);
  assert.equal(fixture.settlements.length, 0);
  const saved = await fixture.ports.storage.loadCheckpoint();
  const stored = saved as StoredRunReceipt;
  assert.deepEqual(stored && { version: stored.version, phase: stored.phase, runId: stored.checkpoint.runId, sequence: stored.checkpoint.sequence },
    { version: 2, phase: "pending", runId: "run-1", sequence: 1 });
});

test("a reopened runtime joins an in-flight submit before taking over settlement", async () => {
  const fixture = portsFixture();
  let releaseSubmit: () => void;
  let markSubmitStarted: () => void;
  const heldSubmit = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  const submitStarted = new Promise<void>((resolve) => { markSubmitStarted = resolve; });
  fixture.ports.protocol.submitCheckpoint = async (checkpoint) => {
    fixture.checkpoints.push(checkpoint);
    markSubmitStarted();
    await heldSubmit;
    return {};
  };
  const first = new ExploreRuntime(fixture.ports);
  await first.start();
  first.update(0.1);
  await submitStarted;
  first.dispose();

  let markLoaded: () => void;
  const loaded = new Promise<void>((resolve) => { markLoaded = resolve; });
  const loadCheckpoint = fixture.ports.storage.loadCheckpoint;
  const freshPorts: RuntimePorts = { ...fixture.ports, storage: { ...fixture.ports.storage,
    loadCheckpoint: async () => { const value = await loadCheckpoint(); markLoaded(); return value; } }, protocol: { ...fixture.ports.protocol } };
  const second = new ExploreRuntime(freshPorts);
  let markJoined: () => void;
  const joined = new Promise<void>((resolve) => { markJoined = resolve; });
  second.events.once("result_pending", () => markJoined());
  const reopened = second.start();
  await loaded;
  await joined;
  await Promise.resolve();
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 0);
  assert.equal(second.resultState, "submitting");
  assert.deepEqual(second.pendingResult, { runId: "run-1", sequence: 1 });
  releaseSubmit!();
  assert.equal(await reopened, true);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(fixture.starts.length, 2);
  assert.equal(await freshPorts.storage.loadCheckpoint(), null);
});

test("a reopened runtime joins an in-flight settlement before taking over cleanup", async () => {
  const fixture = portsFixture();
  let releaseSettle: () => void;
  let markSettleStarted: () => void;
  const heldSettle = new Promise<void>((resolve) => { releaseSettle = resolve; });
  const settleStarted = new Promise<void>((resolve) => { markSettleStarted = resolve; });
  fixture.ports.protocol.settleRun = async (request) => {
    fixture.settlements.push(request);
    markSettleStarted();
    await heldSettle;
    return { ok: true };
  };
  const first = new ExploreRuntime(fixture.ports);
  await first.start();
  first.update(0.1);
  await settleStarted;
  first.dispose();

  let markLoaded: () => void;
  const loaded = new Promise<void>((resolve) => { markLoaded = resolve; });
  const loadCheckpoint = fixture.ports.storage.loadCheckpoint;
  const freshPorts: RuntimePorts = { ...fixture.ports, storage: { ...fixture.ports.storage,
    loadCheckpoint: async () => { const value = await loadCheckpoint(); markLoaded(); return value; } }, protocol: { ...fixture.ports.protocol } };
  const second = new ExploreRuntime(freshPorts);
  let markJoined: () => void;
  const joined = new Promise<void>((resolve) => { markJoined = resolve; });
  second.events.once("result_pending", () => markJoined());
  const reopened = second.start();
  await loaded;
  await joined;
  await Promise.resolve();
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(second.resultState, "submitting");
  assert.deepEqual(second.pendingResult, { runId: "run-1", sequence: 1 });
  releaseSettle!();
  assert.equal(await reopened, true);
  assert.equal(fixture.checkpoints.length, 1);
  assert.equal(fixture.settlements.length, 1);
  assert.equal(fixture.starts.length, 2);
  assert.equal(await freshPorts.storage.loadCheckpoint(), null);
});

test("runtime protocol selection requires an explicit protocol", () => {
  const fixture = portsFixture();
  assert.equal(requireRuntimeProtocol(fixture.ports.protocol), fixture.ports.protocol);
  assert.throws(() => requireRuntimeProtocol(undefined), /explicit protocol adapter/);
});

test("Zhushen adapter uses role-scoped StorageMgr methods and MessageCenter events", async () => {
  const fixture = portsFixture();
  const calls: unknown[][] = [];
  const messages: unknown[][] = [];
  let stored: unknown = null;
  const ports = createZhushenPorts({
    config: fixture.ports.config,
    protocol: fixture.ports.protocol,
    checkpointScope: "fixture-role",
    storage: {
      getObject: (key, fallback, role) => { calls.push(["get", key, role]); return stored ?? fallback; },
      setObject: (key, value, role) => { calls.push(["set", key, role]); stored = value; },
      remove: (key, role) => { calls.push(["remove", key, role]); stored = null; },
    },
    messages: { sendMessage: (...payload) => { messages.push(payload); } },
  });
  const checkpoint = { runId: "host-run", sequence: 1, payload: { result: "won" } };
  await ports.storage.saveCheckpoint(receipt(checkpoint));
  assert.deepEqual(await ports.storage.loadCheckpoint(), receipt(checkpoint));
  await ports.storage.clearCheckpoint();
  assert.equal(calls.every((entry) => entry[2] === true), true);
  assert.equal(ports.storage.checkpointScope, "zhushen-storage:fixture-role");
  ports.telemetry.track("explore_finished", { runId: "host-run" });
  assert.deepEqual(messages, [["auto_explore:explore_finished", { runId: "host-run" }]]);
});

test("queued exploration writes retain the captured host role after a switch", async () => {
  const fixture = portsFixture(), values = new Map<string, unknown>();
  fixture.ports.config.load = async <T>() => ({ ...config, session: { ...config.session, persistExploration: true } }) as T;
  let currentRole = "_A";
  const services = { config: fixture.ports.config, protocol: fixture.ports.protocol, messages: { sendMessage: () => {} },
    storage: { getObject: (key: string, fallback: unknown, role: boolean) => values.get(key + (role ? currentRole : "")) ?? fallback,
      setObject: (key: string, value: unknown, role: boolean) => { values.set(key + (role ? currentRole : ""), value); },
      remove: (key: string, role: boolean) => { values.delete(key + (role ? currentRole : "")); } } };
  const first = createZhushenPorts({ ...services, roleKey: currentRole });
  const runtime = new ExploreRuntime(first); assert.equal(await runtime.start(), true);
  runtime.session!.world.players[0].health = 41;
  runtime.session!.map.recordProgressChange("wound");
  const saved = runtime.flushProgress(); runtime.dispose(); currentRole = "_B";
  const second = createZhushenPorts({ ...services, roleKey: currentRole });
  await saved;
  assert.equal((await first.storage.loadExploration!("default"))!.party[0].hp, 41);
  assert.equal(await second.storage.loadExploration!("default"), null);
  const checkpoint = { runId: "B", sequence: 1, payload: {} };
  await second.storage.saveCheckpoint(receipt(checkpoint));
  assert.equal(await first.storage.loadCheckpoint(), null);
  await first.storage.clearExploration!("default");
  assert.deepEqual(await second.storage.loadCheckpoint(), receipt(checkpoint));
});
