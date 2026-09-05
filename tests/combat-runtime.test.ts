import assert from "node:assert/strict";
import test from "node:test";
import { Actor, BossAI, CombatSystem, DemoSession, EnemyAI, Vector2, selectSkillTarget } from "../assets/scripts/core/index.ts";
import type { ActorStats, DemoConfig, Faction, SkillDefinition } from "../assets/scripts/core/index.ts";

function actor(id: string, faction: Faction, x = 0, y = 0, stats: Partial<ActorStats> = {}): Actor {
  return new Actor({ id, faction, position: { x, y }, stats: {
    maxHealth: 100, attack: 20, defense: 0, moveSpeed: 2, attackRange: 1, aggroRange: 10, ...stats,
  } });
}

const strike: SkillDefinition = { id: "strike", type: "damage", range: 10, cooldown: 1, power: 1, target: "enemy" };

function runtimeConfig(): DemoConfig {
  return {
    seed: 31, world: { width: 40, height: 30, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 6 },
    squad: {
      actors: [0, 1, 2, 3].map((id) => ({ id: `p${id}`, kind: "hero", x: 5.5 + id, y: 5.5,
        hp: 1000, attack: 0, defense: 0, moveSpeed: 4, attackRange: 10, aggroRange: 20 })),
      formationOffsets: [{ x: 0, y: 0 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: -2 }],
    },
    enemies: [
      { id: "caster", kind: "boss", x: 12.5, y: 5.5, hp: 5000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 1, aggroRange: 20, skillIds: ["summon"] },
      { id: "minion", kind: "normal", x: 12.5, y: 5.5, hp: 1000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 1, aggroRange: 20 },
    ],
    skills: {
      player: { id: "basic", range: 10, cooldown: 0.2, power: 1, target: "enemy" },
      enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" },
      definitions: [{ id: "summon", type: "summon", coefficient: 0, range: 0, cooldown: 1, target: "self", maxTargets: 2, summonLimit: 2, summonRadius: 1, summonEnemyId: "minion" }],
    },
    spawns: [{ id: "wave", trigger: "distance", x: 12.5, y: 5.5, triggerRadius: 20, enemyId: "caster", count: 1, spawnRadius: 0, encounterId: "gate" }],
  };
}

test("windup, hit, recovery and cooldown prevent overlapping casts", () => {
  const source = actor("source", "player");
  const target = actor("target", "enemy", 1);
  const combat = new CombatSystem();
  const skill = { ...strike, windup: 0.4, recovery: 0.3 };
  assert.equal(combat.use(source, target, skill), true);
  assert.equal(source.fsm.state, "windup");
  combat.update(0.39, [source, target]);
  assert.equal(target.health, 100);
  combat.update(0.01, [source, target]);
  assert.equal(target.health, 80);
  assert.equal(source.fsm.state, "recovering");
  assert.equal(combat.canUse(source, { ...strike, id: "other" }), false);
  combat.update(0.3, [source, target]);
  assert.equal(combat.canUse(source, { ...strike, id: "other" }), true);
  assert.equal(combat.canUse(source, skill), false);
  combat.update(0.3, [source, target]);
  assert.equal(combat.canUse(source, skill), true);
});

test("ground telegraphs can be dodged and affect only enemies still inside the area", () => {
  const source = actor("boss", "enemy");
  const dodger = actor("dodger", "player", 3);
  const other = actor("other", "player", 3, 0.5);
  const friendly = actor("friendly", "enemy", 3, 0.2);
  const combat = new CombatSystem();
  combat.use(source, dodger, { ...strike, type: "telegraph_damage", telegraph: 0.5, maxTargets: 4, area: { shape: "circle", radius: 1 } }, [source, dodger, other, friendly]);
  dodger.position = new Vector2(8, 0);
  combat.update(0.5, [source, dodger, other, friendly]);
  assert.equal(dodger.health, 100);
  assert.equal(other.health, 80);
  assert.equal(friendly.health, 100);
});

test("cone attacks respect direction, range and maxTargets", () => {
  const source = actor("hero", "player");
  const targets = [actor("front1", "enemy", 1), actor("front2", "enemy", 2), actor("front3", "enemy", 3),
    actor("behind", "enemy", -1), actor("side", "enemy", 0, 2), actor("ally", "player", 1)];
  new CombatSystem().use(source, targets[0], { ...strike, maxTargets: 2, area: { shape: "cone", radius: 5, angleDegrees: 90 } }, [source, ...targets]);
  assert.deepEqual(targets.map((entry) => entry.health), [80, 80, 100, 100, 100, 100]);
});

test("shields absorb after defense, refresh without duplicating a layer, and expire", () => {
  const target = actor("guard", "player", 0, 0, { defense: 5 });
  target.addShield("bell", 20, 1);
  assert.equal(target.receiveDamage(15), 0);
  assert.equal(target.shield, 10);
  assert.equal(target.health, 100);
  target.addShield("bell", 30, 1);
  assert.equal(target.shield, 30);
  target.updateEffects(1);
  assert.equal(target.shield, 0);
  assert.equal(target.receiveDamage(15), 10);
  assert.equal(target.health, 90);
});

test("group healing chooses the lowest health ratios and respects the target cap", () => {
  const support = actor("support", "player");
  const allies = [actor("a", "player", 1), actor("b", "player", 2), actor("c", "player", 3)];
  allies[0].health = 40; allies[1].health = 20; allies[2].health = 80;
  const heal: SkillDefinition = { ...strike, type: "heal", target: "ally", targetRule: "lowest_hp", maxTargets: 2 };
  const target = selectSkillTarget(support, [support, ...allies], heal)!;
  assert.equal(target.id, "b");
  new CombatSystem().use(support, target, heal, [support, ...allies]);
  assert.deepEqual(allies.map((entry) => entry.health), [60, 40, 80]);
});

test("projectiles travel before applying damage and survive a launched caster's death", () => {
  const source = actor("archer", "player");
  const target = actor("target", "enemy", 8);
  const combat = new CombatSystem();
  combat.use(source, target, { ...strike, projectileSpeed: 10, windup: 0.2, recovery: 0.1 });
  combat.update(0.2, [source, target]);
  assert.equal(combat.projectileSnapshots().length, 1);
  combat.update(0.2, [source, target]);
  assert.equal(target.health, 100);
  assert.equal(combat.projectileSnapshots()[0].x, 2);
  source.receiveDamage(999);
  combat.update(0.6, [source, target]);
  assert.equal(target.health, 80);
  assert.equal(combat.projectileSnapshots().length, 0);
});

test("caster death cancels an unfinished windup", () => {
  const source = actor("caster", "player");
  const target = actor("target", "enemy", 1);
  const combat = new CombatSystem();
  combat.use(source, target, { ...strike, windup: 1 });
  source.receiveDamage(999);
  combat.update(1, [source, target]);
  assert.equal(target.health, 100);
  assert.equal(combat.castSnapshots().length, 0);
  assert.equal(combat.events.some((event) => event.type === "cast_cancelled"), true);
});

test("area projectiles resolve at the ground point after their original target dies", () => {
  const source = actor("caster", "player");
  const target = actor("target", "enemy", 5);
  const nearby = actor("nearby", "enemy", 5, 1);
  const combat = new CombatSystem();
  combat.use(source, target, { ...strike, projectileSpeed: 10, maxTargets: 3, area: { shape: "circle", radius: 2 } }, [source, target, nearby]);
  target.receiveDamage(999);
  combat.update(0.5, [source, target, nearby]);
  assert.equal(nearby.health, 80);
  assert.equal(combat.projectileSnapshots().length, 0);
});

test("projectiles expire when their target cannot be reached in time", () => {
  const source = actor("caster", "player");
  const target = actor("target", "enemy", 9);
  const combat = new CombatSystem();
  combat.use(source, target, { ...strike, projectileSpeed: 1, projectileLifetime: 0.5 });
  combat.update(0.6, [source, target]);
  assert.equal(target.health, 100);
  assert.equal(combat.projectileSnapshots().length, 0);
});

test("heroes approach basic-attack range while a longer skill is cooling down", () => {
  const config = runtimeConfig();
  const session = new DemoSession({ ...config,
    squad: { actors: [{ ...config.squad.actors[0], attack: 20, attackRange: 2, skillIds: ["long", "short"] }] },
    enemies: [{ id: "target", kind: "normal", x: 11.5, y: 5.5, hp: 5000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 }],
    spawns: undefined,
    skills: { ...config.skills, definitions: [
      { id: "long", type: "damage", coefficient: 1, range: 10, cooldown: 5, target: "nearest_enemy", priority: 10 },
      { id: "short", type: "damage", coefficient: 1, range: 2, cooldown: 1, target: "nearest_enemy" },
    ] },
  });
  session.update(2);
  assert.equal(session.getSnapshot().events.some((event) => event.skillId === "short" && event.type === "damage"), true);
});

test("enemies leave combat and return home when a target escapes their leash", () => {
  const enemy = actor("enemy", "enemy", 0, 0, { leashRange: 5 });
  const hero = actor("hero", "player", 3);
  const ai = new EnemyAI({ ...strike, range: 1 });
  const combat = new CombatSystem();
  ai.update(enemy, [hero], combat, 1);
  assert.equal(enemy.position.x, 2);
  hero.position = new Vector2(8, 0);
  ai.update(enemy, [hero], combat, 1);
  ai.update(enemy, [hero], combat, 0.1);
  assert.equal(enemy.position.x, 0);
  assert.equal(enemy.targetId, undefined);
  assert.equal(enemy.fsm.state, "idle");
});

test("boss transitions cross every configured threshold once and never roll back on healing", () => {
  const boss = actor("boss", "enemy");
  const hero = actor("hero", "player", 1);
  const ai = new BossAI(strike, [0.8, 0.5, 0.2]);
  const combat = new CombatSystem();
  boss.health = 15;
  ai.update(boss, [hero], combat, 0.1);
  assert.deepEqual(ai.phaseChanges.map((change) => change.to), ["phase2", "phase3", "enraged"]);
  boss.health = 90;
  ai.update(boss, [hero], combat, 0.1);
  assert.equal(ai.phase, "enraged");
  assert.equal(ai.phaseChanges.length, 3);
});

test("summons are capped, linked to their owner and removed before encounter completion", () => {
  const config = runtimeConfig();
  const session = new DemoSession({ ...config, session: { completionEncounterId: "gate" } });
  session.update(3);
  assert.equal(session.world.enemies.filter((actor) => actor.summonerId === "wave:1" && actor.alive).length, 2);
  session.world.enemies.find((actor) => actor.id === "wave:1")!.receiveDamage(99999);
  session.update(0.05);
  assert.equal(session.world.enemies.some((actor) => actor.summonerId === "wave:1"), false);
  assert.equal(session.runState, "won");
  const result = session.getSnapshot().result;
  session.update(20);
  assert.deepEqual(session.getSnapshot().result, result);
  assert.equal(session.resume(), false);
});

test("respawns use fresh IDs and retire dead actors instead of growing forever", () => {
  const config = runtimeConfig();
  const session = new DemoSession({ ...config,
    squad: { ...config.squad, actors: config.squad.actors.map((entry) => ({ ...entry, attack: 100 })) },
    enemies: [{ ...config.enemies[0], hp: 1, skillIds: [] }],
    skills: { ...config.skills, definitions: [] },
    spawns: [{ ...config.spawns![0], respawn: true, respawnDelay: 0.5 }],
  });
  session.update(0.05);
  assert.deepEqual(session.getSnapshot().spawns[0].spawnedIds, ["wave:1"]);
  session.update(3);
  assert.ok(session.getSnapshot().spawns[0].generation >= 4);
  assert.ok(session.getSnapshot().spawns[0].spawnedIds[0].includes("@"));
  session.update(30);
  assert.ok(session.world.enemies.length <= 4);
});

test("leader death promotes a living party member, and only a full wipe ends the run", () => {
  const session = new DemoSession({ ...runtimeConfig(), enemies: [], spawns: [], skills: { ...runtimeConfig().skills, definitions: [] } });
  session.world.players[0].receiveDamage(99999);
  const next = session.world.players[1];
  const before = next.position.x;
  session.setMoveIntent(1, 0);
  session.update(0.1);
  assert.equal(session.getSnapshot().leaderId, next.id);
  assert.ok(next.position.x > before);
  assert.equal(session.runState, "running");
  for (const player of session.world.players) player.receiveDamage(99999);
  session.update(0.05);
  assert.equal(session.runState, "failed");
  assert.equal(session.setAutoDestination(10, 10), false);
});

test("pause freezes actors, skills, fog and spawn clocks until resume", () => {
  const session = new DemoSession(runtimeConfig());
  session.update(0.2);
  assert.equal(session.pause(), true);
  const before = session.getSnapshot();
  assert.equal(session.update(30), 0);
  const after = session.getSnapshot();
  assert.equal(after.elapsedSeconds, before.elapsedSeconds);
  assert.deepEqual(after.actors, before.actors);
  assert.deepEqual(after.casts, before.casts);
  assert.deepEqual(after.fog, before.fog);
  assert.deepEqual(after.spawns, before.spawns);
  assert.equal(session.resume(), true);
  session.update(0.05);
  assert.ok(session.getSnapshot().elapsedSeconds > before.elapsedSeconds);
});
