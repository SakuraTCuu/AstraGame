import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, x: number, y = 0, faction: "player" | "enemy" = "enemy") => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 1000, attack: 10, defense: 0, moveSpeed: 0, attackRange: 20, aggroRange: 20, maxEnergy: 100, energyOnSkill: 10 } });
const shot: SkillDefinition = { id: "shot", target: "enemy", range: 20, cooldown: 0, power: 1, projectileSpeed: 10, projectileLifetime: 2,
  directionalProjectile: { radius: 0.25, maxHits: 2 }, actions: [{ at: 0, type: "damage", power: 1 }] };

test("a directional cast emits one shot and spends its hit budget in collision order", () => {
  const source = actor("source", 0, 0, "player"), far = actor("far", 8), near = actor("near", 2), middle = actor("middle", 4), side = actor("side", 3, 1), ally = actor("ally", 1, 0, "player");
  const actors = [source, far, near, middle, side, ally], combat = new CombatSystem();
  combat.use(source, far, { ...shot, targetCount: 10, maxTargets: 10 }, actors);
  assert.equal(combat.projectileSnapshots().length, 1); assert.equal(source.energy, 0);
  far.position = new Vector2(8, 8); combat.update(1, actors);
  assert.deepEqual([far.health, near.health, middle.health, side.health, ally.health], [1000, 990, 990, 1000, 1000]);
  assert.deepEqual(combat.events.filter((event) => event.type === "damage").map((event) => event.targetId), [near.id, middle.id]);
  assert.equal(source.energy, 10); assert.equal(combat.projectileSnapshots().length, 0);
});

test("swept collision catches thin targets and clips travel at the lifetime boundary", () => {
  const source = actor("source", 0, 0, "player"), first = actor("first", 1.5), edge = actor("edge", 9.5), outside = actor("outside", 11), combat = new CombatSystem();
  combat.use(source, first, { ...shot, projectileSpeed: 1000, projectileLifetime: 0.01, directionalProjectile: { radius: 0.01, maxHits: 10 } }, [source, first, edge, outside]);
  combat.update(0.1, [source, first, edge, outside]);
  assert.deepEqual([first.health, edge.health, outside.health], [990, 990, 1000]); assert.equal(combat.projectileSnapshots().length, 0);
});

test("persistent shots repeat per target without awarding energy more than once", () => {
  const source = actor("source", 0, 0, "player"), first = actor("first", 0.5), second = actor("second", 0.5, 0.1), combat = new CombatSystem();
  combat.use(source, first, { ...shot, projectileSpeed: 1, projectileLifetime: 2.5,
    directionalProjectile: { radius: 3, maxHits: 100, repeatInterval: 0.5 } }, [source, first, second]);
  combat.update(2.5, [source, first, second]);
  assert.equal(first.health, 950); assert.equal(second.health, 950); assert.equal(source.energy, 10);
  assert.equal(combat.events.filter((event) => event.type === "damage").length, 10);
});

test("floating-point endpoint contact resolves on its first eligible simulation tick", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 150), combat = new CombatSystem(), ticks: number[] = [];
  combat.use(source, target, { ...shot, range: 300, windup: 3, castDuration: 4, projectileSpeed: 200, projectileLifetime: 3,
    directionalProjectile: { radius: 100, maxHits: 999, repeatInterval: 1 } }, [source, target]);
  for (let tick = 1; tick <= 100; tick++) {
    combat.update(0.05, [source, target]);
    if (combat.drainEvents().some((event) => event.type === "damage")) ticks.push(tick);
  }
  assert.deepEqual(ticks, [65, 85]);
});

test("leaving and reentering a persistent shot does not bypass its per-target interval", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 0.5), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, { ...shot, projectileSpeed: 1, directionalProjectile: { radius: 1, maxHits: 100, repeatInterval: 0.5 } }, actors);
  combat.update(0.1, actors); assert.equal(target.health, 990);
  target.position = new Vector2(0.5, 3); combat.update(0.2, actors);
  target.position = new Vector2(0.5, 0); combat.update(0.1, actors); assert.equal(target.health, 990);
  combat.update(0.1, actors); assert.equal(target.health, 980);
});

test("dead original targets and dead casters do not erase an already launched straight shot", () => {
  const source = actor("source", 0, 0, "player"), original = actor("original", 8), victim = actor("victim", 3), combat = new CombatSystem();
  combat.use(source, original, shot, [source, original, victim]); source.receiveDamage(10000); original.receiveDamage(10000);
  combat.update(0.5, [source, original, victim]); assert.equal(victim.health, 990);
  assert.equal(combat.projectileSnapshots().length, 1); assert.ok(combat.projectileSnapshots()[0].x > victim.position.x);
});

test("windup aim follows the target until launch and stops following afterward", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 8), combat = new CombatSystem();
  combat.use(source, target, { ...shot, windup: 1, castDuration: 1 }, [source, target]);
  target.position = new Vector2(0, 8); assert.deepEqual(combat.castSnapshots()[0].point, target.position);
  combat.update(1, [source, target]); const launched = combat.projectileSnapshots()[0];
  assert.equal(launched.directionX, 0); assert.equal(launched.directionY, 1);
  target.position = new Vector2(8, 0); combat.update(0.5, [source, target]);
  assert.equal(combat.projectileSnapshots()[0].x, 0); assert.equal(target.health, 1000);
});

test("delayed contact actions survive visual expiry but reset and target removal cancel them", () => {
  for (const cleanup of ["none", "reset", "remove"] as const) {
    const source = actor("source", 0, 0, "player"), target = actor("target", 0.5), combat = new CombatSystem(), actors = [source, target];
    combat.use(source, target, { ...shot, projectileLifetime: 0.1, actions: [{ at: 0.5, type: "damage", power: 1 }] }, actors);
    combat.update(0.1, actors); assert.equal(target.health, 1000); assert.equal(combat.projectileSnapshots().length, 0);
    if (cleanup === "reset") combat.resetEngagement(); if (cleanup === "remove") actors.pop();
    combat.update(0.5, actors); assert.equal(target.health, cleanup === "none" ? 990 : 1000);
  }
});

test("projectile snapshots have distinct IDs for multiple shots from one cast", () => {
  const source = actor("source", 0, 0, "player"), first = actor("first", 2), second = actor("second", 3), combat = new CombatSystem();
  combat.use(source, first, { ...shot, directionalProjectile: undefined, targetCount: 2, projectileHoming: true }, [source, first, second]);
  assert.equal(combat.projectileSnapshots().length, 2); assert.equal(new Set(combat.projectileSnapshots().map((projectile) => projectile.id)).size, 2);
});

test("source straight and repeat tags retain their units and separate body radius from warning length", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, firstSelector: [300, 10], selectShape: "[box,200,600]",
    projectEffect: "[9]", projectKey: "[key:0_action:[damageAction,20000]]", skillTagActions: "[dirProTag,200,3000,999]|[proClearDmgTag,1000]" }));
  const skill = compiler.compile(1);
  assert.equal(skill.projectileSpeed, 200); assert.equal(skill.projectileLifetime, 3); assert.equal(skill.projectileHoming, undefined);
  assert.deepEqual(skill.directionalProjectile, { radius: 100, maxHits: 999, repeatInterval: 1 });
  assert.equal(skill.area.radius, 600); assert.deepEqual(skill.projectileEffectIds, [9]);
});

test("directional configuration rejects invalid budgets, intervals and incompatible homing", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 2 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 0, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 }] }, enemies: [],
    skills: { player: { id: "p", range: 1, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 1, cooldown: 1, power: 0, target: "enemy" } } };
  for (const patch of [{ directionalProjectile: { radius: -1, maxHits: 1 } }, { directionalProjectile: { radius: 1, maxHits: 0 } },
    { directionalProjectile: { radius: 1, maxHits: 1, repeatInterval: 0 } }, { projectileHoming: true }]) {
    const invalid = structuredClone(config); invalid.skills.definitions = [{ ...shot, ...patch, type: "damage", coefficient: 1 }];
    assert.throws(() => new DemoSession(invalid), /Invalid directional projectile/);
  }
});
