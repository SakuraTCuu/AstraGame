import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/combat/Combat.ts";
import { referenceEnergy } from "../tools/reference-development.mjs";

function actor(id: string, x = 0): Actor {
  return new Actor({ id, faction: id === "source" ? "player" : "enemy", position: { x, y: 0 },
    stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 10, aggroRange: 10,
      maxEnergy: 10000, energyOnNormal: 200, energyOnSkill: 1000, energyOnDamage: 10 } });
}
const hit: SkillDefinition = { id: "hit", target: "enemy", range: 10, cooldown: 0, power: 1, category: "normal", windup: 0.1,
  castDuration: 0.5, actions: [{ at: 0.2, type: "damage", power: 1 }] };

test("normal and tactical energy arrive on impact and a cancelled attack grants nothing", () => {
  const source = actor("source"), target = actor("target", 1), combat = new CombatSystem();
  combat.use(source, target, hit, [source, target]); assert.equal(source.energy, 0);
  combat.update(0.1, [source, target]); assert.equal(source.energy, 0);
  combat.cancelCaster(source.id); combat.update(1, [source, target]); assert.equal(source.energy, 0);
  combat.use(source, target, hit, [source, target]); combat.update(0.2, [source, target]); assert.equal(source.energy, 200);
  combat.update(0.4, [source, target]);
  combat.use(source, target, { ...hit, id: "tactical", category: "skill" }, [source, target]);
  assert.equal(source.energy, 200); combat.update(0.2, [source, target]); assert.equal(source.energy, 1200);
});

test("a fully missed action grants no energy", () => {
  const source = actor("source"), target = actor("target", 1), combat = new CombatSystem();
  combat.use(source, target, { ...hit, area: { shape: "circle", radius: 1 } }, [source, target]);
  target.position = target.position.add({ x: 5, y: 0 }); combat.update(1, [source, target]);
  assert.equal(source.energy, 0); assert.equal(target.health, target.stats.maxHealth);
  assert.ok(combat.drainEvents().some((event) => event.type === "miss"));
});

test("multi-hit and multi-target projectiles share one energy award", () => {
  const source = actor("source"), first = actor("first", 1), second = actor("second", 3), combat = new CombatSystem();
  const projectile: SkillDefinition = { id: "projectile", target: "enemy", range: 10, cooldown: 0, power: 1, category: "skill",
    targetCount: 2, maxTargets: 2, area: { shape: "circle", radius: 1 }, projectileSpeed: 10, projectileHoming: true, projectileLifetime: 2,
    actions: [{ at: 0, type: "damage", power: 1 }, { at: 0.1, type: "damage", power: 1 }] };
  combat.use(source, first, projectile, [source, first, second]); assert.equal(source.energy, 0);
  combat.update(0.1, [source, first, second]); assert.equal(source.energy, 1000);
  combat.update(0.2, [source, first, second]); combat.update(0.2, [source, first, second]);
  assert.equal(source.energy, 1000);
  assert.equal(combat.drainEvents().filter((event) => event.type === "damage").length, 4);
});

test("a launched projectile cannot grant reserve energy after its caster leaves", () => {
  const source = actor("source"), target = actor("target", 3), combat = new CombatSystem();
  combat.use(source, target, { ...hit, windup: 0, castDuration: 0, projectileSpeed: 1, projectileLifetime: 5,
    actions: [{ at: 0, type: "damage", power: 1 }] }, [source, target]);
  combat.update(3, [target]);
  assert.equal(target.health, 9900); assert.equal(source.energy, 0);
});

test("ultimates, blocked procs and periodic ticks cannot generate cast energy", () => {
  const source = actor("source"), target = actor("target", 1), combat = new CombatSystem();
  source.gainEnergy(10000);
  combat.use(source, target, { ...hit, category: "ultimate", energyCost: 10000 }, [source, target]);
  combat.update(0.5, [source, target]); assert.equal(source.energy, 0);
  combat.use(source, target, { ...hit, id: "proc", blockEnergyGain: true }, [source, target]);
  combat.update(0.5, [source, target]); assert.equal(source.energy, 0);
  combat.use(source, target, { ...hit, id: "bleed", windup: 0, castDuration: 0, actions: [{ at: 0, type: "status",
    status: { id: "bleed", duration: 3, periodicDamage: { interval: 1, power: 1 } } }] }, [source, target]);
  assert.equal(source.energy, 200); combat.update(3, [source, target]); assert.equal(source.energy, 200);
});

test("energy gain efficiency scales gains without changing spending", () => {
  const source = actor("source"), target = actor("target", 1), combat = new CombatSystem();
  source.addStatus({ id: "energy", duration: 5, modifiers: { energyGainRate: 0.5 } });
  combat.use(source, target, hit, [source, target]); combat.update(0.2, [source, target]); assert.equal(source.energy, 300);
  source.gainEnergy(-200); assert.equal(source.energy, 100);
});

test("reference energy conversion retains configured percentages and the observed normal baseline", () => {
  assert.deepEqual(referenceEnergy({ ultraEnegyMax: 10000, ultraEnegyRecoverRate: 200, ultraEnegySkillHit: 1000, ultraEnegyBeHit: 10 }),
    { maxEnergy: 10000, energyPerSecond: 200, energyOnNormal: 200, energyOnSkill: 1000, energyOnDamage: 10 });
  assert.equal(referenceEnergy({ ultraEnegyMax: 5000, ultraEnegyNormalHit: 400 }).energyOnNormal, 200);
  assert.equal(referenceEnergy({ ultraEnegyMax: 10000, ultraEnegyNormalHit: 0 }).energyOnNormal, 0);
  assert.equal(referenceEnergy({}).energyOnNormal, 0);
});
