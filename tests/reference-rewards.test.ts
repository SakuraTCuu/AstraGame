import assert from "node:assert/strict";
import test from "node:test";
import { FogGrid, GridNavigation, ProgressionJournal, WorldMap } from "../assets/scripts/core/index.ts";
import { parseReferenceWeightedItem } from "../tools/reference-rules.mjs";
import { createReferenceRewardCompiler } from "../tools/reference-progression.mjs";

const source21102 = {
  id: 21102,
  options0: "item|id:101001002_num:1_weight:2500",
  options1: "item|id:102001002_num:1_weight:2500",
  options2: "item|id:103001002_num:1_weight:2500",
  type: "RepeatRand",
  options3: "item|id:103001002_num:1_weight:2500",
};

function compile21102() {
  const resources = {};
  const compiler = createReferenceRewardCompiler((family, id) => family === "Reward" && id === 21102 ? source21102 : { name: `Item ${id}` }, resources, []);
  return { rewards: compiler.compile(21102), resources };
}

function rewardMap(resources: Record<string, { name: string; initial: number }>) {
  return new WorldMap(new GridNavigation(2, 2), new FogGrid(2, 2), { x: 0, y: 0, width: 2, height: 2 }, [], [], [],
    { level: 1, resources });
}

test("source Reward 21102 compiles to one weighted and mutually exclusive choice", () => {
  const { rewards, resources } = compile21102();
  assert.deepEqual(rewards, [{ oneOf: [
    { resource: "item:101001002", amount: 1, weight: 2500 },
    { resource: "item:102001002", amount: 1, weight: 2500 },
    { resource: "item:103001002", amount: 1, weight: 2500 },
    { resource: "item:103001002", amount: 1, weight: 2500 },
  ] }]);
  const world = rewardMap(resources);
  for (const roll of [0, 0.249999, 0.25, 0.5, 0.75, 0.999999]) world.grantRewards(rewards, () => roll);
  assert.equal(world.resourceBalance("item:101001002"), 2);
  assert.equal(world.resourceBalance("item:102001002"), 1);
  assert.equal(world.resourceBalance("item:103001002"), 3);
  assert.equal(Object.values(world.saveProgress().resources).reduce((sum, amount) => sum + amount, 0), 6);
});

test("weighted item syntax and reward groups reject malformed or overflowing values atomically", () => {
  assert.deepEqual(parseReferenceWeightedItem("item|id:7_num:20_weight:2500"), { itemId: 7, amount: 20, weight: 2500 });
  for (const source of ["item|id:7_num:20", "item|id:7_num:20_weight:0", "item|id:0_num:20_weight:1",
    "item|id:7_num:-1_weight:1", `item|id:7_num:1_weight:${Number.MAX_SAFE_INTEGER}0`]) {
    assert.throws(() => parseReferenceWeightedItem(source));
  }
  const world = rewardMap({ token: { name: "Token", initial: 3 }, prize: { name: "Prize", initial: 0 } });
  assert.throws(() => world.validateReward({ oneOf: [] }), /weighted reward choices/);
  assert.throws(() => world.validateReward({ oneOf: [{ resource: "prize", amount: 1, weight: Number.MAX_SAFE_INTEGER },
    { resource: "prize", amount: 1, weight: 1 }] }), /weighted reward choice/);
  const compiler = createReferenceRewardCompiler((family) => family === "Reward" ? { type: "RepeatRand",
    options0: `item|id:1_num:1_weight:${Number.MAX_SAFE_INTEGER}`, options1: "item|id:2_num:1_weight:1" } : { name: "Item" }, {}, []);
  assert.throws(() => compiler.compile(1), /Weighted reward overflow/);
  const before = world.saveProgress();
  assert.throws(() => world.transactRewards({ token: 1 }, [{ oneOf: [{ resource: "prize", amount: 1, weight: 1 }] }], () => { throw new Error("rng failed"); }), /rng failed/);
  assert.deepEqual(world.saveProgress(), before);
  assert.throws(() => world.grantRewards([{ oneOf: [{ resource: "prize", amount: 1, weight: 1 }] }], () => 1), /random value/);
  assert.deepEqual(world.saveProgress(), before);
  const full = rewardMap({ prize: { name: "Prize", initial: Number.MAX_SAFE_INTEGER } }), fullBefore = full.saveProgress();
  let sampled = false;
  assert.throws(() => full.grantRewards([{ oneOf: [{ resource: "prize", amount: 1, weight: 1 }] }], () => { sampled = true; return 0; }), /overflow/);
  assert.equal(sampled, false);
  assert.deepEqual(full.saveProgress(), fullBefore);
});

test("OddsReward keeps independent chance entries and nested reward behavior", () => {
  const rows = {
    1: { type: "OddsReward", options0: "item|id:4_num:2_prob:1/2", options1: "reward|rewardId:2_num:2" },
    2: { type: "OddsReward", options0: "item|id:52_num:1" },
  };
  const compiler = createReferenceRewardCompiler((family, id) => family === "Reward" ? rows[id] : { name: `Item ${id}` }, {}, []);
  assert.deepEqual(compiler.compile(1), [
    { resource: "incense", amount: 2, chance: 0.5 },
    { resource: "item:52", amount: 1, chance: 1 },
    { resource: "item:52", amount: 1, chance: 1 },
  ]);
});

test("quest snapshots preserve one-of groups and claims consume one random value per reward entry across reloads", () => {
  const create = () => rewardMap({ direct: { name: "Direct", initial: 0 }, a: { name: "A", initial: 0 }, b: { name: "B", initial: 0 },
    c: { name: "C", initial: 0 }, d: { name: "D", initial: 0 } });
  const quest = { id: "weighted", name: "Weighted", category: "main" as const, condition: { kind: "level" as const, value: 1 }, rewards: [
    { resource: "direct", amount: 2 },
    { oneOf: [{ resource: "a", amount: 1, weight: 1 }, { resource: "b", amount: 3, weight: 3 }] },
    { oneOf: [{ resource: "c", amount: 4, weight: 2 }, { resource: "d", amount: 5, weight: 2 }] },
  ] };
  const rolls = [0.9, 0.75, 0.1], consumed = [];
  const world = create(), journal = new ProgressionJournal(world, { quests: [quest] }, () => {
    const roll = rolls[consumed.length]; consumed.push(roll); return roll;
  });
  assert.deepEqual(journal.snapshot().quests[0].rewards, [
    { resource: "direct", amount: 2, name: "Direct" },
    { oneOf: [{ resource: "a", amount: 1, weight: 1, name: "A" }, { resource: "b", amount: 3, weight: 3, name: "B" }] },
    { oneOf: [{ resource: "c", amount: 4, weight: 2, name: "C" }, { resource: "d", amount: 5, weight: 2, name: "D" }] },
  ]);
  assert.equal(journal.claim("weighted"), "claimed");
  assert.deepEqual(consumed, rolls);
  assert.deepEqual(world.saveProgress().resources, { direct: 2, a: 0, b: 3, c: 4, d: 0 });
  const restoredWorld = create(); restoredWorld.restoreProgress(world.saveProgress());
  let restoredCalls = 0;
  const restored = new ProgressionJournal(restoredWorld, { quests: [quest] }, () => { restoredCalls++; return 0; });
  assert.equal(restored.claim("weighted"), "already_claimed");
  assert.equal(restoredCalls, 0);
  assert.deepEqual(restoredWorld.saveProgress(), world.saveProgress());
});

test("POI one-of rewards remain completed after save and reload without another draw", () => {
  const resources = { a: { name: "A", initial: 0 }, b: { name: "B", initial: 0 }, c: { name: "C", initial: 0 } };
  const create = () => new WorldMap(new GridNavigation(3, 3), new FogGrid(3, 3), { x: 0, y: 0, width: 3, height: 3 }, [], [
    { id: "chest", type: "chest", x: 1, y: 1, discoverRadius: 1, interaction: { radius: 1, rewards: [
      { oneOf: [{ resource: "a", amount: 1, weight: 1 }, { resource: "b", amount: 1, weight: 1 }] },
      { oneOf: [{ resource: "c", amount: 2, weight: 1 }] },
    ] } },
  ], [], { level: 1, resources });
  const world = create(), rolls = [0.75, 0.25], consumed = [];
  assert.equal(world.interact("chest", { x: 1, y: 1 }, () => {
    const roll = rolls[consumed.length]; consumed.push(roll); return roll;
  }), "completed");
  assert.deepEqual(consumed, rolls);
  assert.deepEqual(world.saveProgress().resources, { a: 0, b: 1, c: 2 });
  const restored = create(); restored.restoreProgress(world.saveProgress());
  let restoredCalls = 0;
  assert.equal(restored.interact("chest", { x: 1, y: 1 }, () => { restoredCalls++; return 0; }), "already_completed");
  assert.equal(restoredCalls, 0);
  assert.deepEqual(restored.saveProgress(), world.saveProgress());
});
