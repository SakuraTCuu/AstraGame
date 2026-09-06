import assert from "node:assert/strict";
import test from "node:test";
import { DemoSession } from "../assets/scripts/core/demo/DemoSession.ts";
import type { DemoConfig, ExplorationSave } from "../assets/scripts/core/demo/DemoSession.ts";
import { ExploreRuntime } from "../assets/scripts/framework/ExploreRuntime.ts";
import type { RuntimePorts } from "../assets/scripts/framework/RuntimePorts.ts";

function config(): DemoConfig {
  return { meta: { id: "saved-world", schemaVersion: 1 }, seed: 17,
    world: { width: 30, height: 20, cellSize: 1, zoneMode: "overlay", progression: { level: 1, rank: 0, resources: { incense: { name: "Incense", initial: 12 } } },
      pointsOfInterest: [
        { id: "home", type: "portal", x: 2.5, y: 2.5, discoverRadius: 2, interaction: { radius: 2, initiallyCompleted: true } },
        { id: "gate", type: "fog_gate", x: 9.5, y: 10.5, discoverRadius: 2, interaction: { radius: 3, allowLockedApproach: true,
          cost: { resource: "incense", amount: 5 }, condition: { kind: "all", conditions: [{ kind: "level", value: 2 }, { kind: "flag", id: "defeat:guard" }] } } },
        { id: "outpost", type: "portal", x: 24.5, y: 10.5, discoverRadius: 2, interaction: { radius: 2, cost: { resource: "incense", amount: 5 } } },
      ] },
    fog: { cellSize: 1, revealRadius: 3, unlockZones: [{ id: "diamond", rect: { x: 8, y: 5, width: 8, height: 10 },
      polygon: [{ x: 8, y: 10 }, { x: 12, y: 5 }, { x: 16, y: 10 }, { x: 12, y: 15 }], unlock: "interact:gate" }] },
    squad: { actors: [0, 1].map((index) => ({ id: `hero${index}`, kind: "hero", x: 2.5 + index, y: 2.5,
      hp: 100, attack: 10, defense: 0, moveSpeed: 6, attackRange: 1, aggroRange: 2 })), formationOffsets: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    enemies: [], skills: { player: { id: "hit", range: 1, cooldown: 1, power: 1, target: "enemy" }, enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" } },
    session: { persistExploration: true } };
}

function reach(session: DemoSession, id: string) {
  assert.equal(session.navigateToPoi(id), true);
  for (let tick = 0; tick < 300 && session.getSnapshot().autoNavigation.active; tick++) session.update(0.05);
}

test("polygon gates charge only after prerequisites and open both navigation and fog", () => {
  const session = new DemoSession(config());
  const nav = session.world.options.navigation;
  assert.equal(nav.isWorldWalkable({ x: 9, y: 6 }), true);
  assert.equal(nav.isWorldWalkable({ x: 12, y: 10 }), false);
  session.map.setLevel(2);
  reach(session, "gate");
  assert.equal(session.interactWithPoi("gate"), "requirements_not_met");
  assert.equal(session.map.snapshot().resources[0].amount, 12);
  session.map.grantFlag("defeat:guard");
  assert.equal(session.interactWithPoi("gate"), "completed");
  assert.equal(nav.isWorldWalkable({ x: 12, y: 10 }), true);
  assert.equal(session.getSnapshot().fog.states[10 * 30 + 12], "hidden");
  assert.equal(session.map.snapshot().resources[0].amount, 7);
});

test("paid portals, exploration, party health and position survive reload", () => {
  const session = new DemoSession(config());
  reach(session, "outpost");
  assert.equal(session.interactWithPoi("outpost"), "completed");
  session.world.players[0].receiveDamage(13);
  const save = session.saveExploration();
  const restored = new DemoSession(config());
  restored.restoreExploration(save);
  assert.deepEqual(restored.saveExploration(), save);
  assert.equal(restored.teleportToPoi("home"), true);
  assert.equal(restored.getSnapshot().autoNavigation.active, false);
  assert.equal(restored.world.players[0].health, 87);
  assert.equal(restored.map.snapshot().resources[0].amount, 7);
  assert.ok(restored.world.leader!.position.distance({ x: 2.5, y: 2.5 }) < 1);
  assert.equal(restored.teleportToPoi("gate"), false);
});

test("invalid save data is rejected before changing resources and unlocks", () => {
  const session = new DemoSession(config());
  const before = session.saveExploration();
  assert.throws(() => session.restoreExploration({ ...before, party: [{ ...before.party[0], hp: 1000 }, before.party[1]] }), /Invalid saved party/);
  assert.deepEqual(session.saveExploration(), before);
  assert.throws(() => session.restoreExploration({ ...before, exploredCells: [100000] }), /Invalid saved fog/);
  assert.deepEqual(session.saveExploration(), before);
});

let portScopeSequence = 0;
function ports() {
  let saved: ExplorationSave | null = null;
  let sequence = 0;
  const service: RuntimePorts = { config: { load: async <T>() => config() as T },
    storage: { checkpointScope: `test:exploration-save:${++portScopeSequence}`, loadCheckpoint: async () => null, saveCheckpoint: async () => {}, clearCheckpoint: async () => {},
      loadExploration: async () => saved, saveExploration: async (_id, value) => { saved = structuredClone(value); }, clearExploration: async () => { saved = null; } },
    protocol: { startRun: async () => ({ runId: `run-${++sequence}` }), submitCheckpoint: async () => ({}), settleRun: async () => ({}) },
    telemetry: { track: () => {} } };
  return { service, read: () => saved };
}

test("runtime reload resumes exploration while explicit restart clears only this save", async () => {
  const { service, read } = ports();
  const runtime = new ExploreRuntime(service);
  assert.equal(await runtime.start(), true);
  runtime.session!.map.grantResources({ incense: 3 });
  runtime.session!.setMoveIntent(1, 0);
  runtime.update(0.5);
  await runtime.flushProgress();
  const saved = structuredClone(read());
  runtime.dispose();
  const reopened = new ExploreRuntime(service);
  assert.equal(await reopened.start(), true);
  assert.deepEqual(reopened.session!.saveExploration(), saved);
  assert.equal(await reopened.restart(), true);
  assert.equal(reopened.session!.map.snapshot().resources[0].amount, 12);
  assert.equal(reopened.session!.world.elapsedSeconds, 0);
  reopened.dispose();
});

test("a pending save finishes before restart clears progress", async () => {
  const { service } = ports();
  const writes: string[] = [];
  let finish: (() => void) | undefined;
  service.storage.saveExploration = async () => { writes.push("save"); await new Promise<void>((resolve) => { finish = resolve; }); writes.push("saved"); };
  service.storage.clearExploration = async () => { writes.push("clear"); };
  const runtime = new ExploreRuntime(service);
  await runtime.start();
  const saving = runtime.flushProgress();
  await Promise.resolve();
  const restarting = runtime.restart();
  await Promise.resolve();
  assert.deepEqual(writes, ["save"]);
  finish!();
  await saving;
  assert.equal(await restarting, true);
  assert.deepEqual(writes, ["save", "saved", "clear"]);
});

test("slow storage coalesces intermediate progress without losing the latest balance", async () => {
  const { service } = ports();
  const writes: number[] = [];
  let finish: (() => void) | undefined;
  service.storage.saveExploration = async (_id, value) => {
    writes.push(value.map.resources.incense);
    if (writes.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
  };
  const runtime = new ExploreRuntime(service);
  await runtime.start();
  const pending = runtime.flushProgress();
  await Promise.resolve();
  runtime.session!.map.grantResources({ incense: 1 });
  void runtime.flushProgress();
  runtime.session!.map.grantResources({ incense: 1 });
  void runtime.flushProgress();
  finish!();
  await pending;
  assert.deepEqual(writes, [12, 14]);
  assert.equal(runtime.progressState, "saved");
});

test("a collected resource retains its respawn delay after reloading", () => {
  const base = config();
  const data: DemoConfig = { ...base,
    enemies: [{ id: "jar", kind: "resource", x: 2.8, y: 2.8, hp: 1, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0,
      defeatRewards: [{ resource: "incense", amount: 2 }], defeatFlag: "defeat:jar" }],
    spawns: [{ id: "resource", trigger: "distance", enemyId: "jar", x: 2.8, y: 2.8, count: 1, triggerRadius: 3, spawnRadius: 0, respawn: true, respawnDelay: 10 }] };
  const session = new DemoSession(data);
  session.update(0.1);
  assert.equal(session.map.snapshot().resources[0].amount, 14);
  assert.equal(session.map.hasFlag("defeat:jar"), true);
  const save = session.saveExploration();
  assert.equal(save.respawns!.length, 1);
  const reloaded = new DemoSession(data);
  reloaded.restoreExploration(save);
  reloaded.update(2);
  assert.equal(reloaded.world.enemies.length, 0);
  assert.equal(reloaded.map.snapshot().resources[0].amount, 14);
  assert.ok(reloaded.saveExploration().respawns![0].remaining > 7);
});
