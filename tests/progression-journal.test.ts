import assert from "node:assert/strict";
import test from "node:test";
import { DemoSession, FogGrid, GridNavigation, ProgressionJournal, WorldMap } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";
import type { JournalConfig } from "../assets/scripts/core/world/ProgressionJournal.ts";
import { compileReferenceCondition } from "../tools/reference-rules.mjs";
import { createReferenceRewardCompiler } from "../tools/reference-progression.mjs";

function map() {
  return new WorldMap(new GridNavigation(20, 10), new FogGrid(20, 10), { x: 0, y: 0, width: 20, height: 10 }, [], [], [],
    { level: 1, rank: 1, resources: { incense: { name: "Incense", initial: 5 }, seals: { name: "Seals", initial: 0, optionalInSave: true } } });
}
const quests: JournalConfig = {
  quests: [
    { id: "kill", name: "Defeat two guards", category: "main", condition: { kind: "counter", id: "defeat:guard", value: 2 }, rewards: [{ resource: "incense", amount: 3 }] },
    { id: "boss", name: "First Boss", category: "boss", condition: { kind: "flag", id: "defeat:boss" }, rewards: [{ resource: "seals", amount: 1 }] },
    { id: "rank", name: "Earn a seal", category: "rank", condition: { kind: "counter", id: "owned:seals", value: 1 } },
    { id: "future", name: "Future rank", category: "rank", condition: { kind: "flag", id: "quest:kill" } },
    { id: "next", name: "Next task", category: "main", prerequisite: { kind: "flag", id: "quest:kill" }, condition: { kind: "rank", value: 2 } },
  ],
  ranks: [{ id: 1, name: "Recruit", questIds: [] }, { id: 2, name: "Guard", questIds: ["rank"] }, { id: 3, name: "Captain", questIds: ["future"] }],
};

test("claims preserve prerequisites, award once, and complete rank tasks before promotion", () => {
  const world = map(), journal = new ProgressionJournal(world, quests, () => 0.5);
  assert.equal(journal.claim("kill"), "requirements_not_met");
  world.incrementCounter("defeat:guard", 2);
  assert.equal(journal.claim("kill"), "claimed");
  assert.equal(journal.claim("kill"), "already_claimed");
  assert.equal(world.resourceBalance("incense"), 8);
  assert.equal(journal.claim("future"), "requirements_not_met");
  assert.equal(journal.promote(), "requirements_not_met");
  world.grantFlag("defeat:boss");
  assert.equal(journal.claim("boss"), "claimed");
  assert.equal(world.counter("owned:seals"), 1);
  assert.equal(journal.claim("rank"), "claimed");
  assert.equal(journal.promote(), "claimed");
  assert.equal(world.rank, 2);
  assert.equal(journal.claim("next"), "claimed");
  const restored = map(); restored.restoreProgress(world.saveProgress());
  const restoredJournal = new ProgressionJournal(restored, quests, () => 0.5);
  assert.equal(restoredJournal.claim("boss"), "already_claimed");
  assert.equal(restored.resourceBalance("seals"), 1);
});

test("new optional currencies can load old saves while required currency loss is rejected", () => {
  const world = map(), save = world.saveProgress();
  const restored = map(); restored.restoreProgress({ ...save, resources: { incense: 2 } });
  assert.equal(restored.resourceBalance("seals"), 0);
  assert.equal(restored.resourceBalance("incense"), 2);
  assert.throws(() => restored.restoreProgress({ ...save, resources: { seals: 0 } }), /Saved resources/);
});

test("invalid rewards cannot charge an interaction or mark a quest as claimed", () => {
  const world = map(); world.incrementCounter("owned:seals", Number.MAX_SAFE_INTEGER);
  const journal = new ProgressionJournal(world, quests, () => 0.5);
  world.grantFlag("defeat:boss");
  const before = world.saveProgress();
  assert.throws(() => journal.claim("boss"), /overflow/);
  assert.deepEqual(world.saveProgress(), before);
  assert.equal(journal.snapshot().quests.find((quest) => quest.id === "boss")!.state, "ready");
  const chest = new WorldMap(new GridNavigation(4, 4), new FogGrid(4, 4), { x: 0, y: 0, width: 4, height: 4 }, [],
    [{ id: "chest", type: "chest", x: 1, y: 1, discoverRadius: 1, interaction: { radius: 1,
      cost: { resource: "incense", amount: 1 }, grants: { seals: 1 }, rewards: [{ resource: "seals", amount: 1 }] } }], [],
    { level: 1, initialCounters: { "owned:seals": Number.MAX_SAFE_INTEGER - 1 }, resources: { incense: { name: "Incense", initial: 5 }, seals: { name: "Seal", initial: 0 } } });
  const chestBefore = chest.saveProgress();
  assert.throws(() => chest.interact("chest", { x: 1, y: 1 }, () => 0), /overflow/);
  assert.deepEqual(chest.saveProgress(), chestBefore);
});

test("quest travel stops at a locked gate and resumes the actual goal only after payment", () => {
  const config: DemoConfig = {
    seed: 2, world: { width: 20, height: 10, zoneMode: "overlay", navigation: { manualResumeDelay: 0.1 }, progression: { level: 1, resources: { incense: { name: "Incense", initial: 5 } } },
      pointsOfInterest: [{ id: "gate", name: "Gate", type: "fog_gate", x: 9.5, y: 2.5, discoverRadius: 2,
        interaction: { radius: 2, allowLockedApproach: true, cost: { resource: "incense", amount: 5 } } },
        { id: "autoChest", type: "chest", x: 15.5, y: 2.5, discoverRadius: 1, interaction: { radius: 1, auto: true, rewards: [{ resource: "incense", amount: 2 }] } }] },
    fog: { revealRadius: 4, unlockZones: [{ id: "locked", rect: { x: 10, y: 0, width: 10, height: 10 }, unlock: "interact:gate" }] },
    squad: { actors: [{ id: "hero", kind: "hero", x: 1.5, y: 2.5, hp: 10, attack: 1, defense: 0, moveSpeed: 3, attackRange: 1, aggroRange: 1 }] },
    enemies: [], skills: { player: { id: "hit", range: 1, cooldown: 1, power: 1, target: "enemy" }, enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" } },
    journal: { quests: [{ id: "travel", name: "Travel", category: "main", condition: { kind: "flag", id: "destination" }, destination: { position: { x: 15.5, y: 2.5 } } }] },
  };
  const session = new DemoSession(config);
  assert.equal(session.setAutoDestination(15.5, 2.5), false);
  assert.equal(session.navigateToQuest("travel"), true);
  const gateDestination = session.getSnapshot().autoNavigation.destination;
  session.update(0.1);
  session.setMoveIntent(0, 1);
  session.update(0.05);
  assert.equal(session.getSnapshot().autoNavigation.mode, "manual");
  assert.equal(session.setAutoDestination(15.5, 2.5), false);
  assert.deepEqual(session.getSnapshot().autoNavigation.destination, gateDestination);
  session.setMoveIntent(0, 0);
  assert.equal(session.getSnapshot().autoNavigation.mode, "resume_wait");
  session.update(0.1);
  assert.equal(session.getSnapshot().autoNavigation.mode, "auto_path");
  session.update(4);
  assert.ok(session.world.leader!.position.x < 10);
  assert.equal(session.map.resourceBalance("incense"), 5);
  assert.equal(session.interactWithPoi("gate"), "completed");
  assert.equal(session.map.resourceBalance("incense"), 0);
  session.update(5);
  assert.ok(session.world.leader!.position.distance({ x: 15.5, y: 2.5 }) < 0.2);
  assert.equal(session.map.isPoiInteracted("autoChest"), true);
  assert.equal(session.map.resourceBalance("incense"), 2);
  session.update(2);
  assert.equal(session.map.resourceBalance("incense"), 2);
});

test("source inventory and party level conditions retain their exact counts", () => {
  const world = new WorldMap(new GridNavigation(2, 2), new FogGrid(2, 2), { x: 0, y: 0, width: 2, height: 2 }, [], [], [],
    { level: 1, partyLevels: [10, 5, 5], resources: { "item:52": { name: "Seal", initial: 0 } } });
  const seal = compileReferenceCondition("HisOwnItemNumCondition|{id:52_num:2}", () => ({ name: "Seal" }));
  world.grantResources({ "item:52": 1 }); assert.equal(world.isConditionMet(seal), false);
  world.grantResources({ "item:52": 1 }); assert.equal(world.isConditionMet(seal), true);
  assert.equal(world.isConditionMet(compileReferenceCondition("HeroTotalLevelCondition|{level:20}", () => null)), true);
  assert.equal(world.isConditionMet(compileReferenceCondition("HeroLevelNumCondition|{level:10_num:2}", () => null)), false);
  const monsterType = compileReferenceCondition("KillMonsterSubTypeCondition|{type:1_subType:2_num:5}", () => null);
  world.incrementCounter("defeat:type:1:subtype:3", 20);
  assert.equal(world.isConditionMet(monsterType), false);
  world.incrementCounter("defeat:type:1:subtype:2", 5);
  assert.equal(world.isConditionMet(monsterType), true);
  const compiler = createReferenceRewardCompiler((family, id) => family === "Reward" ? { type: "OddsReward", options0: "item|id:52_num:1", options1: "item|id:7_num:20" } : { name: "Seal" }, {}, []);
  assert.deepEqual(compiler.compile(1), [{ resource: "item:52", amount: 1, chance: 1 }, { experience: true, amount: 20, chance: 1 }]);
});
