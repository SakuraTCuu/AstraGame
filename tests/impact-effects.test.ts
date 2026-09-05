import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, EnemyAI, GameWorld, GridNavigation, FogGrid, Vector2 } from "../assets/scripts/core/index.ts";
import type { ActorStats, DemoConfig, Faction, SkillDefinition } from "../assets/scripts/core/index.ts";

const actor = (id: string, faction: Faction, x = 0, y = 0, stats: Partial<ActorStats> = {}) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 5, attackRange: 10, aggroRange: 30, ...stats } });
const strike: SkillDefinition = { id: "push", target: "enemy", range: 10, cooldown: 0, power: 1, windup: 0.2, castDuration: 0.4,
  actions: [{ at: 0.2, type: "damage", power: 1, knockback: { distance: 6, duration: 0.3 } }] };
const advance = (combat: CombatSystem, seconds: number, actors: Actor[]) => {
  for (let time = 0; time < seconds - 1e-9; time += 0.05) combat.update(0.05, actors);
};
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("knockback holds movement and casting, interrupts pending hits and ends at the configured distance", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), actors = [source, target];
  const combat = new CombatSystem();
  const pending = { ...strike, id: "pending", windup: 1, castDuration: 2, actions: [{ at: 1, type: "damage" as const, power: 3 }] };
  assert.equal(combat.use(target, source, pending, actors), true);
  assert.equal(combat.use(source, target, strike, actors), true);
  combat.update(0.2, actors);
  assert.equal(target.health, 900); assert.equal(target.fsm.state, "displaced"); assert.equal(combat.isWindingUp(target), false);
  assert.equal(combat.canUse(target, pending), false); close(target.position.x, 2);
  combat.update(0.15, actors); close(target.position.x, 5);
  const before = target.position;
  new EnemyAI(pending).update(target, [source], combat, 1);
  target.moveTowards(source.position, 1); assert.deepEqual(target.position, before);
  combat.update(0.15, actors); close(target.position.x, 8); assert.equal(target.fsm.state, "idle");
  advance(combat, 2, actors); assert.equal(source.health, 1000);
  assert.equal(combat.events.filter((event) => event.type === "cast_cancelled" && event.sourceId === target.id).length, 1);
});

test("multi-target knockback shares the damage selection and respects explicit displacement immunity", () => {
  const source = actor("source", "player"), near = actor("near", "enemy", 2), immune = actor("immune", "enemy", 0, 3),
    far = actor("far", "enemy", 4), friendly = actor("friendly", "player", 1);
  immune.addStatus({ id: "anchor", duration: 10, state: "unForceMove" });
  const actors = [source, near, immune, far, friendly], combat = new CombatSystem();
  combat.use(source, near, { ...strike, maxTargets: 2, areaAnchor: "caster", area: { shape: "circle", radius: 5 } }, actors);
  advance(combat, 0.6, actors);
  assert.deepEqual([near.health, immune.health, far.health, friendly.health], [900, 900, 1000, 1000]);
  close(near.position.x, 8); close(immune.position.y, 3); close(far.position.x, 4);
  assert.deepEqual(combat.events.filter((event) => event.type === "knockback").map((event) => event.targetId), [near.id]);
});

test("projectile impact starts displacement and does not replay it on later updates", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), actors = [source, target], combat = new CombatSystem();
  const projectile = { ...strike, windup: 0, castDuration: 0, projectileSpeed: 2, projectileLifetime: 3,
    actions: [{ ...strike.actions![0], at: 0 }] };
  combat.use(source, target, projectile, actors);
  advance(combat, 0.9, actors); assert.equal(target.health, 1000); close(target.position.x, 2);
  advance(combat, 0.1, actors); assert.equal(target.fsm.state, "displaced");
  advance(combat, 2, actors); close(target.position.x, 8);
  assert.equal(combat.events.filter((event) => event.type === "knockback").length, 1);
});

test("new impacts replace remaining displacement and death, removal and reset clear it", () => {
  for (const cleanup of ["death", "removal", "reset", "immunity"] as const) {
    const left = actor("left", "player"), right = actor("right", "player", 10), target = actor("target", "enemy", 2);
    const actors = [left, right, target], combat = new CombatSystem();
    const instant = { ...strike, windup: 0, castDuration: 0, actions: [{ ...strike.actions![0], at: 0 }] };
    combat.use(left, target, instant, actors); combat.update(0.15, actors); close(target.position.x, 5);
    combat.use(right, target, instant, actors); combat.update(0.15, actors); close(target.position.x, 2);
    if (cleanup === "death") target.receiveDamage(10000);
    if (cleanup === "removal") actors.splice(actors.indexOf(target), 1);
    if (cleanup === "reset") combat.resetEngagement();
    if (cleanup === "immunity") target.addStatus({ id: "immune", duration: 5, state: "ignoreControl" });
    combat.update(1, actors); close(target.position.x, 2); assert.equal(combat.isDisplaced(target), false);
    assert.notEqual(target.fsm.state, "displaced");
  }
});

test("damage healing uses actual health loss, heals the caster only and applies healing reduction", () => {
  const source = actor("source", "player"), ally = actor("ally", "player", 1), target = actor("target", "enemy", 2, 0, { defense: 20 }),
    fragile = actor("fragile", "enemy", 3), actors = [source, ally, target, fragile], combat = new CombatSystem();
  source.health = ally.health = 100; fragile.health = 20; target.addShield("shield", 30, 5);
  source.addStatus({ id: "healing_cut", duration: 10, modifiers: { healReduction: 0.2 } });
  const drain = { ...strike, windup: 0, castDuration: 0, maxTargets: 2, areaAnchor: "caster" as const, area: { shape: "circle" as const, radius: 5 },
    actions: [{ at: 0, type: "damage" as const, power: 1, healFromDamage: 0.5, healFromDamageRecipient: "self" as const }] };
  combat.use(source, target, drain, actors);
  assert.equal(target.health, 950); assert.equal(fragile.health, 0); assert.equal(source.health, 128); assert.equal(ally.health, 100);
  assert.deepEqual(combat.events.filter((event) => event.type === "heal").map((event) => [event.targetId, event.value]), [[source.id, 20], [source.id, 8]]);
  target.addShield("immune", 1000, 5); combat.use(source, target, drain, actors); assert.equal(source.health, 128);
});

test("world knockback obeys walls and replans the leader path after displacement", () => {
  const navigation = new GridNavigation(20, 20, [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }]);
  const source = actor("source", "enemy", 2.5, 4.5, { attack: 0, aggroRange: 0 }), leader = actor("leader", "player", 3.5, 4.5, { attack: 0, aggroRange: 0 });
  const world = new GameWorld({ seed: 1, navigation, fog: new FogGrid(20, 20, 1), players: [leader], enemies: [source],
    playerSkill: { id: "none", range: 0, cooldown: 100, power: 0, target: "enemy" }, enemySkill: { id: "none", range: 0, cooldown: 100, power: 0, target: "enemy" } });
  assert.equal(world.navigateTo({ x: 7.5, y: 4.5 }), true);
  source.position = new Vector2(3.5, 3.5);
  world.combat.use(source, leader, { ...strike, windup: 0, castDuration: 0, actions: [{ ...strike.actions![0], at: 0 }] }, world.allActors);
  world.update(0.15); close(leader.position.x, 3.5); close(leader.position.y, 7.5);
  world.update(0.15);
  for (let step = 0; step < 80 && !world.path.complete; step++) { world.update(0.05); assert.equal(navigation.isWorldWalkable(leader.position), true); }
  close(leader.position.x, 7.5); close(leader.position.y, 4.5);
  // Push toward the wall from the right, with ordinary movement disabled for this probe.
  source.position = new Vector2(6.5, 6.5); leader.position = new Vector2(9.5, 6.5);
  world.combat.use(leader, source, { ...strike, windup: 0, castDuration: 0, actions: [{ ...strike.actions![0], at: 0 }] }, world.allActors);
  world.combat.update(0.3, world.allActors, (unit, destination) => { unit.position = navigation.moveWithCollision(unit.position, Vector2.from(destination).subtract(unit.position)); });
  assert.ok(source.position.x >= 5 && source.position.x < 6.5); assert.equal(navigation.isWorldWalkable(source.position), true);
});

test("manual input cannot override displacement and malformed impact configuration is rejected", () => {
  const config: DemoConfig = { seed: 1, world: { width: 40, height: 40, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 3 },
    squad: { actors: [{ id: "leader", kind: "hero", x: 10.5, y: 10.5, hp: 1000, attack: 0, defense: 0, moveSpeed: 4, attackRange: 0, aggroRange: 0 }] },
    enemies: [], skills: { player: { id: "p", range: 0, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 0, cooldown: 1, power: 0, target: "enemy" } } };
  const session = new DemoSession(config), leader = session.world.leader!, source = actor("source", "enemy", 9.5, 10.5, { aggroRange: 0, attack: 0, moveSpeed: 0 });
  session.world.addEnemy(source);
  session.world.combat.use(source, leader, { ...strike, windup: 0, castDuration: 0, actions: [{ ...strike.actions![0], at: 0 }] }, session.world.allActors);
  session.setMoveIntent(0, 1); session.update(0.15);
  close(leader.position.x, 13.5); close(leader.position.y, 10.5); assert.equal(leader.fsm.state, "displaced");
  for (const knockback of [{ distance: -1, duration: 0.3 }, { distance: 1, duration: 0 }, { distance: Infinity, duration: 1 }]) {
    const invalid = structuredClone(config);
    invalid.skills.definitions = [{ ...strike, type: "damage", coefficient: 1, actions: [{ ...strike.actions![0], knockback }] }];
    assert.throws(() => new DemoSession(invalid), /Invalid knockback/);
  }
});
