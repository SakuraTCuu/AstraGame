import assert from "node:assert/strict";
import test from "node:test";
import { ExploreRuntime } from "../assets/scripts/framework/ExploreRuntime.ts";
import { createZhushenPorts } from "../assets/scripts/framework/ZhushenPorts.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";
import type { RunCheckpoint, RuntimePorts } from "../assets/scripts/framework/RuntimePorts.ts";

const config: DemoConfig = {
  seed: 12, world: { width: 10, height: 10 }, fog: { revealRadius: 3 },
  squad: { actors: [{ id: "hero", kind: "hero", x: 2.5, y: 2.5, hp: 100, attack: 20, defense: 0, moveSpeed: 2, attackRange: 5, aggroRange: 5 }] },
  enemies: [{ id: "enemy", kind: "boss", x: 3.5, y: 2.5, hp: 1, attack: 1, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 5 }],
  skills: { player: { id: "attack", range: 5, cooldown: 1, power: 1, target: "enemy" }, enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" } },
  spawns: [{ id: "boss", enemyId: "enemy", trigger: "distance", x: 3.5, y: 2.5, triggerRadius: 5, count: 1, spawnRadius: 0, encounterId: "final" }],
  session: { completionEncounterId: "final" },
};

function portsFixture() {
  const starts: unknown[] = [];
  const checkpoints: RunCheckpoint[] = [];
  const settlements: any[] = [];
  const telemetry: string[] = [];
  let stored: RunCheckpoint | null = null;
  const ports: RuntimePorts = {
    config: { load: async <T>() => config as T },
    storage: {
      loadCheckpoint: async () => stored,
      saveCheckpoint: async (checkpoint) => { stored = checkpoint; },
      clearCheckpoint: async () => { stored = null; },
    },
    protocol: {
      startRun: async (request) => { starts.push(request); return { runId: `run-${starts.length}` }; },
      submitCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); return {}; },
      settleRun: async (request) => { settlements.push(request); return { ok: true }; },
    },
    telemetry: { track: (event) => { telemetry.push(event); } },
  };
  return { ports, starts, checkpoints, settlements, telemetry };
}

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
});

test("Zhushen adapter uses role-scoped StorageMgr methods and MessageCenter events", async () => {
  const fixture = portsFixture();
  const calls: unknown[][] = [];
  const messages: unknown[][] = [];
  let stored: unknown = null;
  const ports = createZhushenPorts({
    config: fixture.ports.config,
    protocol: fixture.ports.protocol,
    storage: {
      getObject: (key, fallback, role) => { calls.push(["get", key, role]); return stored ?? fallback; },
      setObject: (key, value, role) => { calls.push(["set", key, role]); stored = value; },
      remove: (key, role) => { calls.push(["remove", key, role]); stored = null; },
    },
    messages: { sendMessage: (...payload) => { messages.push(payload); } },
  });
  const checkpoint = { runId: "host-run", sequence: 1, payload: { result: "won" } };
  await ports.storage.saveCheckpoint(checkpoint);
  assert.deepEqual(await ports.storage.loadCheckpoint(), checkpoint);
  await ports.storage.clearCheckpoint();
  assert.equal(calls.every((entry) => entry[2] === true), true);
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
  await second.storage.saveCheckpoint(checkpoint);
  assert.equal(await first.storage.loadCheckpoint(), null);
  await first.storage.clearExploration!("default");
  assert.deepEqual(await second.storage.loadCheckpoint(), checkpoint);
});
