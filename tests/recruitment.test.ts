import assert from "node:assert/strict";
import test from "node:test";
import { Actor, FogGrid, GridNavigation, Recruitment, SeededRandom, WorldMap } from "../assets/scripts/core/index.ts";
import type { RecruitmentConfig } from "../assets/scripts/core/world/Recruitment.ts";

function create() {
  const map = new WorldMap(new GridNavigation(2, 2), new FogGrid(2, 2), { x: 0, y: 0, width: 2, height: 2 }, [], [], [],
    { level: 1, resources: { tickets: { name: "Tickets", initial: 60 }, card: { name: "Card", initial: 0 }, rare: { name: "Rare", initial: 0 } } });
  const config: RecruitmentConfig = { pools: [{ id: "pool", name: "Pool", cost: { tickets: 10 },
    groups: [[{ id: "card", name: "Card", weight: 1, rewards: [{ resource: "card", amount: 1 }] }]], weightSteps: [{ unlocked: 0, weights: [1] }],
    prize: { chances: [0, 0, 1], entries: [{ id: "rare", name: "Rare", weight: 1, rewards: [{ resource: "rare", amount: 1 }] }] } }] };
  const random = new SeededRandom(7), recruitment = new Recruitment(map, config, () => random.next());
  return { map, config, random, recruitment };
}

test("recruitment spends configured costs and applies a persistent pity curve", () => {
  const { map, recruitment } = create();
  assert.equal(recruitment.draw("pool", 3), "completed");
  assert.equal(map.resourceBalance("tickets"), 30);
  assert.equal(map.resourceBalance("card"), 2);
  assert.equal(map.resourceBalance("rare"), 1);
  assert.equal(map.counter("recruit"), 3);
  assert.equal(map.counter("recruit_streak:pool"), 0);
  assert.deepEqual(recruitment.snapshot().lastDraws.map((draw) => draw.prize), [false, false, true]);
  recruitment.draw("pool");
  const restored = create(); restored.map.restoreProgress(map.saveProgress());
  assert.equal(restored.recruitment.snapshot().pools[0].guaranteeIn, 2);
});

test("insufficient resources do not advance RNG, pity or award counters", () => {
  const { map, recruitment, random } = create();
  const before = map.saveProgress(), seed = random.snapshot();
  assert.equal(recruitment.draw("pool", 10), "insufficient_resources");
  assert.deepEqual(map.saveProgress(), before);
  assert.equal(random.snapshot(), seed);
});

test("ineligible rewards are excluded and unlock counts select the configured group weights", () => {
  const { map } = create();
  const recruitment = new Recruitment(map, { pools: [{ id: "pool", name: "Pool", cost: { tickets: 10 },
    groups: [[{ id: "locked", name: "Locked", weight: 1, condition: { kind: "flag", id: "unlocked" }, rewards: [{ resource: "rare", amount: 1 }] }],
      [{ id: "card", name: "Card", weight: 1, rewards: [{ resource: "card", amount: 1 }] }]],
    unlocks: [{ kind: "flag", id: "unlocked" }], weightSteps: [{ unlocked: 0, weights: [0, 1] }, { unlocked: 1, weights: [1, 0] }] }] }, () => 0);
  recruitment.draw("pool"); assert.equal(map.resourceBalance("card"), 1);
  map.grantFlag("unlocked"); recruitment.draw("pool");
  assert.equal(map.resourceBalance("rare"), 1);
});

test("permanent healing reduction persists until an explicit battle reset", () => {
  const actor = new Actor({ id: "hero", faction: "player", position: { x: 0, y: 0 }, stats: { maxHealth: 100, attack: 10, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 } });
  actor.receiveDamage(80);
  actor.addStatus({ id: "wound", duration: 0, permanent: true, modifiers: { healReduction: 0.5 } });
  actor.updateEffects(1000);
  assert.equal(actor.heal(20), 10);
  assert.equal(actor.statusSnapshots()[0].remaining, -1);
  actor.recoverAt({ x: 0, y: 0 }); actor.receiveDamage(40);
  assert.equal(actor.heal(20), 20);
});
