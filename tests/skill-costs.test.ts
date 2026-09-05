import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, EnemyAI } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/index.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "player" | "enemy", x = 0) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 10, aggroRange: 20, maxEnergy: 100, energyOnDamage: 10 } });
const cost: SkillDefinition = { id: "paid", target: "enemy", range: 10, cooldown: 5, power: 1, windup: 0.5,
  energyCost: 80, skillEnergyCost: 2, healthCost: { fraction: 0.2, basis: "maximum" } };

test("a cast validates every resource and target before debiting health, energy or charges", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem();
  source.gainEnergy(100); source.gainSkillEnergy(1);
  assert.equal(combat.use(source, target, cost), false);
  assert.deepEqual([source.health, source.energy, source.skillEnergy, combat.cooldownRemaining(source, cost)], [1000, 100, 1, 0]);
  source.gainSkillEnergy(1);
  const distant = actor("distant", "enemy", 30); assert.equal(combat.use(source, distant, cost), false);
  assert.deepEqual([source.health, source.energy, source.skillEnergy], [1000, 100, 2]);
  assert.equal(combat.use(source, target, cost), true);
  assert.deepEqual([source.health, source.energy, source.skillEnergy], [800, 20, 0]);
  assert.deepEqual(combat.events.filter((event) => event.type === "resource_cost").map((event) => [event.resource, event.value]), [["health", 200], ["energy", 80], ["skill_energy", 2]]);
  combat.cancelCaster(source.id); assert.deepEqual([source.health, source.energy, source.skillEnergy], [800, 20, 0]);
});

test("health expenditure bypasses defenses without causing damage triggers or killing its caster", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem();
  source.health = 50; source.addShield("shield", 500, 10);
  source.addStatus({ id: "protection", duration: 10, states: [{ id: "god", duration: 10, invulnerable: true, damageCap: 1, preventDeath: true, healingBlocked: true }] });
  combat.use(source, target, { ...cost, energyCost: 0, skillEnergyCost: 0 });
  assert.equal(source.health, 1); assert.equal(source.shield, 500); assert.equal(source.energy, 0);
  assert.equal(combat.events.some((event) => ["damage", "death", "absorb"].includes(event.type)), false);
  const other = actor("other", "player"); other.health = 101;
  new CombatSystem().use(other, target, { ...cost, energyCost: 0, skillEnergyCost: 0, healthCost: { fraction: 0.2, basis: "current" } });
  assert.equal(other.health, 81);
});

test("charge gain ranges are deterministic and capped Buff gains do not reduce larger existing pools", () => {
  const source = actor("source", "player"), combat = new CombatSystem(() => 0.5);
  const gain: SkillDefinition = { id: "gain", target: "self", range: 0, cooldown: 0, power: 0,
    actions: [{ at: 0, type: "skill_energy", skillEnergy: { minimum: 1, maximum: 3 } }] };
  combat.use(source, source, gain); assert.equal(source.skillEnergy, 2);
  combat.use(source, source, gain); assert.equal(source.skillEnergy, 4);
  source.gainSkillEnergy(1, 3); assert.equal(source.skillEnergy, 4);
  source.gainSkillEnergy(-3); assert.equal(source.skillEnergy, 1);
  source.gainSkillEnergy(10, 3); assert.equal(source.skillEnergy, 3);
  source.recoverAt(source.position); assert.equal(source.skillEnergy, 0);
});

test("periodic charge Buffs wait for their interval, include expiry ticks and obey their ceiling", () => {
  const source = actor("source", "player");
  source.addStatus({ id: "charge", duration: 1, periodicSkillEnergy: { interval: 0.25, amount: 1, cap: 3 } });
  source.updateEffects(0.24); assert.equal(source.skillEnergy, 0);
  source.updateEffects(0.01); assert.equal(source.skillEnergy, 1);
  source.updateEffects(0.75); assert.equal(source.skillEnergy, 3); assert.equal(source.hasStatus("charge"), false);
  source.gainSkillEnergy(-3); source.updateEffects(1); assert.equal(source.skillEnergy, 0);
});

test("AI alternates a charge builder with a paid enhanced skill at its configured threshold", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 2), combat = new CombatSystem();
  const normal: SkillDefinition = { id: "normal", target: "enemy", range: 10, cooldown: 0, power: 0, priority: 1, conditions: { skillEnergyAtMost: 2 },
    actions: [{ at: 0, type: "skill_energy", recipient: "self", skillEnergy: { minimum: 1, maximum: 1, cap: 3 } }] };
  const enhanced: SkillDefinition = { id: "enhanced", target: "enemy", range: 10, cooldown: 0, power: 1, priority: 2, skillEnergyCost: 3 };
  const ai = new EnemyAI([normal, enhanced]), skills: string[] = [];
  for (let step = 0; step < 8; step++) {
    combat.update(0.1, [source, target]); ai.update(source, [target], combat, 0.1);
    skills.push(...combat.drainEvents().filter((event) => event.type === "skill").map((event) => event.skillId!));
  }
  assert.deepEqual(skills, ["normal", "normal", "normal", "enhanced", "normal", "normal", "normal", "enhanced"]);
  assert.equal(source.skillEnergy, 0); assert.equal(target.health, 800);
});

test("paid additional skills cannot bypass their resource costs through release triggers", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2);
  const child: SkillDefinition = { id: "child", target: "enemy", range: 10, cooldown: 0, power: 5, skillEnergyCost: 1 };
  const combat = new CombatSystem(undefined, "pve", { child });
  combat.use(source, target, { id: "parent", target: "enemy", range: 10, cooldown: 0, power: 1, onRelease: [{ skillId: child.id }] });
  assert.equal(target.health, 900); assert.equal(combat.events.some((event) => event.triggered), false);
});

test("the source adapter preserves compound costs and rejects unsupported resource costs", () => {
  const rows = { 1: { skillType: 8, frameKey: "[key:0_action:[damageAction,10000]]", skillTagActions: "[castCostTag,hp,2000,ultraEnegy,10000]" },
    2: { skillType: 2, frameKey: "[key:0_action:[damageAction,10000]]", skillTagActions: "[castCostTag,enegy,3]", useCond: "[enegyCond,>,2]" },
    3: { skillType: 1, frameKey: "[key:0_action:[damageAction,10000]]", skillTagActions: "[castCostTag,bullet,1]" } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[id]);
  assert.equal(compiler.compile(1).energyCost, 10000); assert.deepEqual(compiler.compile(1).healthCost, { fraction: 0.2, basis: "maximum" });
  assert.equal(compiler.compile(2).skillEnergyCost, 3); assert.equal(compiler.compile(2).conditions.skillEnergyAtLeast, 3);
  const unsupported = compiler.compile(3); assert.equal(unsupported.disabled, true);
  assert.equal(new CombatSystem().canUse(actor("source", "player"), { ...unsupported, power: 1 }), false);
});

test("source charge actions and instant or periodic charge Buffs retain separate gain contracts", () => {
  const rows = { Skill: { 1: { skillType: 2, frameKey: "[key:0_action:[addSkillEnegyAction,3,6]]" },
    2: { skillType: 2, targetCamp: 1, frameKey: "[key:0_action:[addBuffAction,9,1]]" }, 3: { skillType: 2, frameKey: "[key:0_action:[addBuffAction,10,1]]" } },
    Buff: { 9: { duration: 100, effects: "[buffAddEnegyAction,-1,1,3]" }, 10: { duration: 6000, effects: "[buffAddEnegyAction,5000,3,3]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  assert.deepEqual(compiler.compile(1).actions[0].skillEnergy, { minimum: 3, maximum: 6 });
  assert.deepEqual(compiler.compile(2).actions[0].skillEnergy, { minimum: 1, maximum: 1, cap: 3 });
  assert.deepEqual(compiler.compile(3).actions[0].status.periodicSkillEnergy, { interval: 5, amount: 3, cap: 3 });
});

test("malformed resource costs cannot partially mutate a directly requested cast", () => {
  for (const patch of [{ skillEnergyCost: 0.5 }, { energyCost: -1 }, { healthCost: { fraction: NaN, basis: "maximum" as const } }]) {
    const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem(); source.gainEnergy(100); source.gainSkillEnergy(3);
    assert.equal(combat.use(source, target, { ...cost, ...patch }), false);
    assert.deepEqual([source.health, source.energy, source.skillEnergy, combat.cooldownRemaining(source, cost)], [1000, 100, 3, 0]);
  }
});
