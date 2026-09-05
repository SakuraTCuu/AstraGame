import assert from "node:assert/strict";
import test from "node:test";
import { DemoSession } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";
import { ExploreRuntime } from "../assets/scripts/framework/ExploreRuntime.ts";
import type { RuntimePorts } from "../assets/scripts/framework/RuntimePorts.ts";

function config(): DemoConfig {
  const actors = ["one", "two"].map((id, index) => ({ id, kind: "hero", x: 2.5 + index, y: 2.5, hp: 5, attack: 1, defense: 0,
    moveSpeed: 4, attackRange: 3, aggroRange: 6, maxEnergy: 100, energy: 100 }));
  return { meta: { id: "recovery", schemaVersion: 1 }, seed: 9,
    world: { width: 40, height: 30, zoneMode: "overlay", progression: { level: 1, rank: 1, resources: { coins: { name: "Coins", initial: 12 }, gear: { name: "Gear", initial: 1 } } },
      pointsOfInterest: [
        { id: "home", type: "portal", x: 2.5, y: 2.5, discoverRadius: 2, interaction: { radius: 2, initiallyCompleted: true } },
        { id: "near", type: "portal", x: 20.5, y: 13.5, discoverRadius: 2, interaction: { radius: 2, initiallyCompleted: true } },
        { id: "unbuilt", type: "portal", x: 18.5, y: 5.5, discoverRadius: 2, interaction: { radius: 2 } },
        { id: "locked", type: "portal", x: 23.5, y: 5.5, discoverRadius: 2, interaction: { radius: 2, initiallyCompleted: true } },
        { id: "gate", type: "fog_gate", x: 21.5, y: 25.5, discoverRadius: 2, interaction: { radius: 2, allowLockedApproach: true } },
      ] },
    fog: { revealRadius: 5, unlockZones: [{ id: "locked", rect: { x: 22, y: 0, width: 6, height: 30 }, unlock: "interact:gate" }] },
    squad: { actors }, enemies: [{ id: "boss", kind: "boss", x: 20.5, y: 5.5, hp: 100, attack: 25, defense: 0, moveSpeed: 0, attackRange: 3, aggroRange: 8, leashRange: 12 }],
    skills: { player: { id: "hit", target: "enemy", range: 3, cooldown: 1, power: 1 }, enemy: { id: "slam", target: "enemy", range: 3, cooldown: 0.2, power: 1 } },
    session: { persistExploration: true, recovery: { town: { x: 2.5, y: 2.5 }, nearestPortal: true } },
    development: { heroes: actors.map((actor) => ({ actorId: actor.id, initialLevel: 1, levelTable: "shared" })),
      levelTables: { shared: [{ level: 1, attributes: { attack: 1, defense: 0, maxHealth: 5 } }] },
      equipment: [{ id: "gear", resource: "gear", name: "Gear", type: 1, quality: 1, attributes: { attack: [1, 1], defense: [1, 1], maxHealth: [2, 2] } }],
      slots: [{ id: "wrist", actorId: "one", type: 1, name: "Wrist" }] },
  };
}

function loseBattle(session: DemoSession): void {
  session.development!.syncInventory();
  session.equipItem(session.development!.snapshot().items[0].id, "wrist");
  session.map.grantFlag("quest:kept");
  session.world.enemies[0].receiveDamage(45);
  assert.ok(session.setAutoDestination(20.5, 5.5));
  for (let tick = 0; tick < 600 && session.runState === "running"; tick++) session.update(0.05);
  assert.equal(session.runState, "recovering");
}

test("a natural wipe becomes recoverable and nearest travel excludes locked and unrepaired portals", () => {
  const session = new DemoSession(config()); loseBattle(session);
  const saved = session.saveExploration();
  assert.equal(session.getSnapshot().result, null);
  assert.equal(session.getSnapshot().recovery!.portalId, "near");
  assert.notEqual(session.world.bosses.get("boss")!.phase, "phase1");
  assert.equal(session.recoverParty("nearest_portal"), true);
  assert.equal(session.runState, "running");
  assert.equal(session.world.leader!.id, "one");
  assert.ok(session.world.leader!.position.distance({ x: 20.5, y: 13.5 }) < 0.01);
  assert.ok(session.world.players.every((actor) => actor.alive && actor.health === actor.stats.maxHealth && actor.energy === 0));
  assert.equal(session.world.enemies[0].health, 100);
  assert.equal(session.world.bosses.get("boss")!.phase, "phase1");
  assert.deepEqual(session.map.saveProgress().resources, saved.map.resources);
  assert.deepEqual(session.development!.save(), saved.development);
  assert.equal(session.map.hasFlag("quest:kept"), true);
  assert.ok(session.getSnapshot().discoveredFogCells.length >= saved.exploredCells.length);
  assert.ok(session.setAutoDestination(18.5, 18.5));
  session.update(0.1);
  assert.equal(session.getSnapshot().autoNavigation.active, true);
});

test("town recovery clears old projectiles and cooldowns without starting another run", () => {
  const session = new DemoSession(config()), boss = session.world.enemies[0];
  const bomb = { id: "old_bomb", target: "enemy" as const, range: 30, cooldown: 99, power: 3, projectileSpeed: 0.1, projectileLifetime: 300,
    area: { shape: "circle" as const, radius: 2 } };
  assert.equal(session.world.combat.use(boss, session.world.players[0], bomb, session.world.allActors), true);
  loseBattle(session);
  assert.ok(session.world.combat.projectileSnapshots().length > 0);
  assert.equal(session.recoverParty("town"), true);
  assert.equal(session.world.combat.projectileSnapshots().length, 0);
  assert.equal(session.world.combat.castSnapshots().length, 0);
  assert.equal(session.world.combat.cooldownRemaining(boss, bomb), 0);
  session.update(30);
  assert.ok(session.world.players.every((actor) => actor.alive));
  assert.equal(session.map.resourceBalance("coins"), 12);
});

test("recovery survives reload and malformed recovery state is rejected atomically", () => {
  const session = new DemoSession(config()); loseBattle(session);
  const save = session.saveExploration(), restored = new DemoSession(config());
  restored.restoreExploration(save);
  assert.equal(restored.runState, "recovering");
  assert.deepEqual(restored.getSnapshot().recovery, session.getSnapshot().recovery);
  assert.equal(restored.recoverParty("town"), true);
  assert.equal(restored.world.players[0].stats.maxHealth, 7);
  const clean = new DemoSession(config()), before = clean.saveExploration();
  assert.throws(() => clean.restoreExploration({ ...save, recoveryPosition: { x: -1, y: 0 } }), /recovery position/);
  assert.deepEqual(clean.saveExploration(), before);
  assert.equal(new DemoSession(config()).recoverParty("town"), false);
});

test("recovery-disabled encounters retain terminal defeat", () => {
  const data = config();
  const session = new DemoSession({ ...data, session: { persistExploration: true } });
  session.setAutoDestination(20.5, 5.5);
  for (let tick = 0; tick < 600 && session.runState === "running"; tick++) session.update(0.05);
  assert.equal(session.runState, "failed");
  assert.equal(session.getSnapshot().result!.outcome, "failed");
  assert.equal(session.recoverParty("town"), false);
});

test("runtime saves a recoverable wipe without settling it or replacing its run", async () => {
  const data = config();
  let starts = 0, checkpoints = 0, settlements = 0, finished = 0;
  let saved: ReturnType<DemoSession["saveExploration"]> | null = null;
  const ports: RuntimePorts = {
    config: { load: async <T>() => data as T },
    storage: { loadCheckpoint: async () => null, saveCheckpoint: async () => {}, clearCheckpoint: async () => {},
      loadExploration: async () => saved, saveExploration: async (_id, save) => { saved = save; }, clearExploration: async () => { saved = null; } },
    protocol: { startRun: async () => ({ runId: `run-${++starts}` }), submitCheckpoint: async () => { checkpoints++; return {}; },
      settleRun: async () => { settlements++; return {}; } },
    telemetry: { track: () => {} },
  };
  const runtime = new ExploreRuntime(ports); runtime.events.on("finished", () => { finished++; });
  assert.equal(await runtime.start(), true);
  loseBattle(runtime.session!); runtime.update(0.05); await runtime.flushProgress(); await runtime.waitForResult();
  assert.ok(saved!.recoveryPosition);
  assert.ok(saved!.party.every((actor) => actor.hp === 0));
  assert.equal(runtime.session!.recoverParty("town"), true);
  runtime.update(0.05); await runtime.flushProgress();
  assert.equal(saved!.recoveryPosition, undefined);
  assert.ok(saved!.party.every((actor) => actor.hp > 0));
  assert.deepEqual({ starts, checkpoints, settlements, finished }, { starts: 1, checkpoints: 0, settlements: 0, finished: 0 });
  runtime.dispose();
});
