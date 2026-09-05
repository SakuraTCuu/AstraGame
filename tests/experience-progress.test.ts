import assert from "node:assert/strict";
import test from "node:test";
import { DemoSession, FogGrid, GridNavigation, WorldMap } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";
import { compileReferenceCondition } from "../tools/reference-rules.mjs";

const experienceLevels = [10, 20, 40, 80].map((required, index) => ({ level: index + 1, required }));
function createMap() {
  return new WorldMap(new GridNavigation(10, 10), new FogGrid(10, 10), { x: 0, y: 0, width: 10, height: 10 },
    [{ id: "next", rect: { x: 5, y: 0, width: 5, height: 10 }, unlock: "initial", minimumLevel: 3 }], [], [],
    { level: 1, experienceLevels, resources: {} }, "overlay");
}

test("experience rolls over configured thresholds and refreshes level-gated exploration", () => {
  const map = createMap();
  map.grantExperience(9);
  assert.equal(map.level, 1);
  assert.equal(map.isZoneUnlocked("next"), false);
  map.grantExperience(26);
  assert.equal(map.level, 3);
  assert.deepEqual(map.snapshot().experience, { current: 5, required: 40 });
  assert.equal(map.isZoneUnlocked("next"), true);
  assert.deepEqual(map.drainEvents().filter((event) => event.type === "level_up").map((event) => event.id), ["2", "3"]);
  map.grantExperience(1000);
  assert.equal(map.level, 4);
  assert.deepEqual(map.snapshot().experience, { current: 0, required: null });
});

test("experience and counted kill prerequisites survive save and old saves remain compatible", () => {
  const map = createMap();
  const condition = compileReferenceCondition("HisKillMonsterCondition|{id:12_num:3}", () => ({ name: "Guard" }));
  map.incrementCounter("defeat:12", 2);
  map.grantExperience(14);
  const restored = createMap();
  restored.restoreProgress(map.saveProgress());
  assert.equal(restored.isConditionMet(condition), false);
  restored.incrementCounter("defeat:12");
  assert.equal(restored.isConditionMet(condition), true);
  assert.deepEqual(restored.snapshot().experience, { current: 4, required: 20 });
  const old = map.saveProgress();
  const { experience, counters, ...legacy } = old;
  const migrated = createMap();
  migrated.restoreProgress(legacy);
  assert.equal(migrated.counter("defeat:12"), 0);
  assert.deepEqual(migrated.snapshot().experience, { current: 0, required: 20 });
});

test("invalid saved experience or counters cannot partially replace paid progress", () => {
  const map = createMap();
  map.grantExperience(4);
  const before = map.saveProgress();
  for (const patch of [{ experience: 10 }, { experience: -1 }, { experience: 0.2 }, { level: 99 }, { counters: { bad: -1 } }]) {
    assert.throws(() => map.restoreProgress({ ...before, ...patch }));
    assert.deepEqual(map.saveProgress(), before);
  }
  assert.throws(() => map.grantExperience(Number.MAX_SAFE_INTEGER), /Invalid experience/);
  assert.throws(() => map.incrementCounter("bad", NaN), /Invalid progression count/);
  assert.deepEqual(map.saveProgress(), before);
});

test("natural combat grants each kill reward once for static enemies and preserves it on reload", () => {
  const config: DemoConfig = {
    meta: { id: "experience-test", schemaVersion: 1 }, seed: 3,
    world: { width: 20, height: 20, progression: { level: 1, experienceLevels, resources: { coins: { name: "Coins", initial: 0 } } } },
    fog: { revealRadius: 10 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 10, defense: 0, moveSpeed: 4, attackRange: 3, aggroRange: 10 }] },
    enemies: ["one", "two"].map((id, index) => ({ id, kind: "resource", x: 3 + index, y: 2, hp: 1, attack: 0, defense: 0,
      moveSpeed: 0, attackRange: 0, aggroRange: 0, defeatFlag: "defeat:guard",
      defeatCounters: ["defeat:type:1:subtype:2"],
      defeatRewards: [{ experience: true, amount: 7 }, { resource: "coins", amount: 2 }] })),
    skills: { player: { id: "hit", range: 3, cooldown: 0.2, power: 1, target: "enemy" }, enemy: { id: "wait", range: 0, cooldown: 1, power: 0, target: "enemy" } },
  };
  const session = new DemoSession(config);
  session.update(2);
  assert.equal(session.map.counter("defeat:guard"), 2);
  assert.equal(session.map.counter("defeat:type:1:subtype:2"), 2);
  assert.equal(session.map.level, 2);
  assert.deepEqual(session.map.snapshot().experience, { current: 4, required: 20 });
  assert.equal(session.map.snapshot().resources[0].amount, 4);
  session.update(5);
  assert.equal(session.map.counter("defeat:guard"), 2);
  const restored = new DemoSession(config);
  restored.restoreExploration(session.saveExploration());
  assert.equal(restored.map.counter("defeat:guard"), 2);
  assert.deepEqual(restored.map.snapshot().experience, { current: 4, required: 20 });
});
