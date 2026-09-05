import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "../assets/scripts/core/actor/Actor.ts";
import { CombatSystem } from "../assets/scripts/core/combat/Combat.ts";
import type { SkillDefinition } from "../assets/scripts/core/combat/Combat.ts";
import { Vector2 } from "../assets/scripts/core/math/Vector2.ts";

function actor(id: string, faction: "player" | "enemy", x = 0, y = 0) {
  return new Actor({ id, faction, position: { x, y }, stats: { maxHealth: 1000, attack: 100, defense: 0,
    moveSpeed: 10, attackRange: 5, aggroRange: 20, maxEnergy: 10000, energyPerSecond: 200, energyOnSkill: 1000 } });
}
const strike: SkillDefinition = { id: "triple", target: "enemy", range: 10, power: 0.6, cooldown: 5, windup: 0.1, castDuration: 1.5,
  actions: [{ at: 0.5, type: "damage", power: 0.6 }, { at: 1, type: "damage", power: 0.6 }, { at: 1.4, type: "damage", power: 0.6 }] };

test("multi-hit skills resolve each frame separately and stop when the caster dies", () => {
  const source = actor("hero", "player"), target = actor("enemy", "enemy", 1);
  const combat = new CombatSystem();
  assert.equal(combat.use(source, target, strike), true);
  combat.update(0.49, [source, target]); assert.equal(target.health, 1000);
  combat.update(0.01, [source, target]); assert.equal(target.health, 940);
  combat.update(0.5, [source, target]); assert.equal(target.health, 880);
  source.receiveDamage(10000);
  combat.update(1, [source, target]); assert.equal(target.health, 880);
});

test("primary-target projectiles heal separated injured allies and track their movement", () => {
  const source = actor("medic", "player"), left = actor("left", "player", 3), right = actor("right", "player", 0, 4);
  left.health = 100; right.health = 200;
  const combat = new CombatSystem();
  const heal: SkillDefinition = { id: "heal", type: "heal", target: "ally", targetRule: "lowest_hp", range: 10, power: 1, cooldown: 1,
    targetCount: 2, maxTargets: 2, area: { shape: "circle", radius: 1 }, projectileSpeed: 5, projectileHoming: true, projectileLifetime: 4,
    actions: [{ at: 0, type: "heal", power: 1 }] };
  assert.equal(combat.use(source, left, heal, [source, left, right]), true);
  assert.equal(combat.projectileSnapshots().length, 2);
  right.position = new Vector2(0, 6);
  combat.update(0.6, [source, left, right]); assert.equal(left.health, 200); assert.equal(right.health, 200);
  combat.update(0.6, [source, left, right]); assert.equal(right.health, 300);
});

test("energy and shared cooldowns gate ultimate and tactical skills", () => {
  const source = actor("hero", "player"), target = actor("enemy", "enemy", 1);
  const combat = new CombatSystem();
  const ultimate = { ...strike, id: "ultimate", energyCost: 10000, publicCooldown: 1, publicCooldownGroup: "active" };
  assert.equal(combat.use(source, target, ultimate), false);
  source.gainEnergy(10000);
  assert.equal(combat.use(source, target, ultimate), true);
  assert.equal(source.energy, 0);
  combat.cancelCaster(source.id);
  assert.equal(combat.canUse(source, { ...strike, id: "tactic", publicCooldownGroup: "active" }), false);
  combat.update(1, [source, target]);
  assert.equal(source.energy, 200);
  assert.equal(combat.canUse(source, { ...strike, id: "tactic", publicCooldownGroup: "active" }), true);
});

test("buffs refresh by group, change damage and expire without modifying base stats", () => {
  const source = actor("hero", "player"), target = actor("enemy", "enemy", 1);
  source.addStatus({ id: "attack", group: "attack", duration: 2, modifiers: { attackRate: 0.2 } });
  source.addStatus({ id: "attack", group: "attack", duration: 2, modifiers: { attackRate: 0.2 } });
  assert.equal(source.attackPower, 120);
  const combat = new CombatSystem();
  combat.use(source, target, { id: "critical", target: "enemy", range: 5, power: 2, cooldown: 0, forceCritical: true });
  assert.equal(target.health, 640);
  combat.update(2, [source, target]);
  assert.equal(source.attackPower, 100);
  assert.equal(source.stats.attack, 100);
});

test("a warned jump lands at the locked location and misses a target that escaped", () => {
  const source = actor("boss", "enemy"), target = actor("hero", "player", 5);
  const combat = new CombatSystem();
  const jump: SkillDefinition = { id: "jump", target: "enemy", range: 10, power: 4, cooldown: 23, windup: 3, castDuration: 4.3,
    area: { shape: "circle", radius: 1 }, motion: { kind: "jump", duration: 1.2 }, actions: [{ at: 4.2, type: "damage", power: 4 }] };
  combat.use(source, target, jump);
  combat.update(3, [source, target]);
  target.position = new Vector2(9, 5);
  combat.update(0.6, [source, target]);
  assert.ok(combat.castSnapshots()[0].elevation! > 100);
  combat.update(0.6, [source, target]);
  assert.ok(source.position.distance({ x: 5, y: 0 }) < 0.001);
  assert.equal(target.health, 1000);
});

test("HP and fight-time conditions keep advanced Boss attacks unavailable until triggered", () => {
  const source = actor("boss", "enemy"), target = actor("hero", "player", 1);
  source.targetId = target.id;
  const combat = new CombatSystem();
  const phase = { ...strike, conditions: { casterHpAtMost: 0.75 } };
  assert.equal(combat.canUse(source, phase), false);
  source.health = 750;
  assert.equal(combat.canUse(source, phase), true);
  const enrage = { ...strike, conditions: { combatTimeAtLeast: 1800, inCombat: true } };
  assert.equal(combat.canUse(source, enrage), false);
  combat.update(1800, [source, target]);
  assert.equal(combat.canUse(source, enrage), true);
});
