import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Actor,
  AutoPath,
  BossAI,
  CombatSystem,
  DemoSession,
  FogGrid,
  GridNavigation,
  SeededRandom,
  SquadFormation,
  StateMachine,
  Vector2,
  selectNearestTarget,
  type ActorStats,
  type DemoConfig,
  type SkillDefinition,
} from "../assets/scripts/core/index.ts";

const playerStats: ActorStats = {
  maxHealth: 100,
  attack: 20,
  defense: 2,
  moveSpeed: 4,
  attackRange: 2,
  aggroRange: 8,
};

const attack: SkillDefinition = { id: "basic", range: 2, cooldown: 1, power: 1, target: "enemy" };

function actor(id: string, faction: "player" | "enemy", x: number, y: number, stats = playerStats, tags: string[] = []): Actor {
  return new Actor({ id, faction, position: { x, y }, stats, tags });
}

test("seed RNG repeats the same sequence", () => {
  const first = new SeededRandom(1234);
  const second = new SeededRandom(1234);
  assert.deepEqual([first.next(), first.next(), first.next()], [second.next(), second.next(), second.next()]);
});

test("FSM only performs allowed guarded transitions", () => {
  const fsm = new StateMachine<"idle" | "fight" | "dead", { health: number }>("idle")
    .allow("idle", "fight")
    .allow("fight", "dead", ({ health }) => health <= 0);
  assert.equal(fsm.transition("fight", { health: 10 }), true);
  assert.equal(fsm.transition("dead", { health: 1 }), false);
  assert.equal(fsm.transition("dead", { health: 0 }), true);
});

test("fog reveal is persistent and reports only newly discovered cells", () => {
  const fog = new FogGrid(10, 10, 1);
  const first = fog.reveal({ x: 5.5, y: 5.5 }, 1.1);
  const second = fog.reveal({ x: 5.5, y: 5.5 }, 1.1);
  assert.equal(first, 5);
  assert.equal(second, 0);
  assert.equal(fog.discoveredCount(), 5);
  assert.equal(fog.isDiscoveredAt({ x: 5.5, y: 5.5 }), true);
  assert.equal(fog.isDiscoveredAt({ x: 0.5, y: 0.5 }), false);
});

test("A* navigation avoids blocked cells and AutoPath consumes distance budget", () => {
  const navigation = new GridNavigation(5, 3, [{ x: 2, y: 1 }]);
  const gridPath = navigation.findPath({ x: 0, y: 1 }, { x: 4, y: 1 });
  assert.deepEqual(gridPath[0], { x: 0, y: 1 });
  assert.deepEqual(gridPath.at(-1), { x: 4, y: 1 });
  assert.equal(gridPath.some((point) => point.x === 2 && point.y === 1), false);

  const path = new AutoPath();
  path.setPath([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.equal(path.update(Vector2.ZERO, 3, 0.5).equals({ x: 1.5, y: 0 }), true);
  assert.equal(path.complete, false);
  assert.equal(path.update({ x: 1.5, y: 0 }, 3, 0.5).equals({ x: 2, y: 0 }), true);
  assert.equal(path.complete, true);
});

test("navigation converts scaled world coordinates without allocating world-unit cells", () => {
  const navigation = new GridNavigation(60, 90, [{ x: 11, y: 15 }], 80);
  assert.deepEqual(navigation.worldToGrid({ x: 520, y: 520 }), { x: 6, y: 6 });
  assert.equal(navigation.isWorldWalkable({ x: 11 * 80 + 10, y: 15 * 80 + 10 }), false);
  assert.equal(navigation.gridToWorld({ x: 6, y: 6 }).equals({ x: 520, y: 520 }), true);
});

test("formation maps followers into stable oriented slots", () => {
  const members = [actor("p1", "player", 10, 10), actor("p2", "player", 10, 10), actor("p3", "player", 10, 10)];
  const formation = new SquadFormation(members, undefined, 100);
  formation.update({ x: 10, y: 10 }, { x: 1, y: 0 }, 1);
  assert.equal(members[0]!.position.equals({ x: 10, y: 10 }), true);
  assert.equal(members[1]!.position.equals({ x: 9, y: 11.25 }), true);
  assert.equal(members[2]!.position.equals({ x: 9, y: 8.75 }), true);
});

test("targeting chooses nearest target with id as deterministic tie breaker", () => {
  const source = actor("source", "player", 0, 0);
  const b = actor("b", "enemy", 1, 0);
  const a = actor("a", "enemy", -1, 0);
  assert.equal(selectNearestTarget(source, [b, a], 5)?.id, "a");
  assert.equal(selectNearestTarget(source, [b, a], 0.5), undefined);
});

test("combat applies defense, cooldown and death", () => {
  const source = actor("hero", "player", 0, 0);
  const target = actor("mob", "enemy", 1, 0, { ...playerStats, maxHealth: 30, defense: 5 });
  const combat = new CombatSystem();
  assert.equal(combat.use(source, target, attack), true);
  assert.equal(target.health, 15);
  assert.equal(combat.use(source, target, attack), false);
  combat.updateCooldowns(1);
  assert.equal(combat.use(source, target, attack), true);
  assert.equal(target.alive, false);
  assert.equal(target.fsm.state, "dead");
  assert.deepEqual(combat.drainEvents().map((event) => event.type), ["skill", "damage", "skill", "damage", "death"]);
});

test("boss enters phase2, enraged and dead phases at health thresholds", () => {
  const boss = actor("boss", "enemy", 0, 0, { ...playerStats, maxHealth: 100 }, ["boss"]);
  const hero = actor("hero", "player", 1, 0);
  const combat = new CombatSystem();
  const ai = new BossAI(attack);
  boss.health = 70;
  ai.update(boss, [hero], combat, 0.1);
  assert.equal(ai.phase, "phase2");
  boss.health = 30;
  ai.update(boss, [hero], combat, 0.1);
  assert.equal(ai.phase, "enraged");
  boss.receiveDamage(999);
  ai.update(boss, [hero], combat, 0.1);
  assert.equal(ai.phase, "dead");
  assert.deepEqual(ai.phaseChanges.map((change) => change.to), ["phase2", "enraged", "dead"]);
});

test("boss uses configured phase thresholds", () => {
  const boss = actor("boss", "enemy", 0, 0, { ...playerStats, maxHealth: 100 }, ["boss"]);
  const hero = actor("hero", "player", 1, 0);
  const ai = new BossAI(attack, [0.66, 0.33]);
  boss.health = 67;
  ai.update(boss, [hero], new CombatSystem(), 0.1);
  assert.equal(ai.phase, "phase1");
  boss.health = 66;
  ai.update(boss, [hero], new CombatSystem(), 0.1);
  assert.equal(ai.phase, "phase2");
  boss.health = 33;
  ai.update(boss, [hero], new CombatSystem(), 0.1);
  assert.equal(ai.phase, "enraged");
});

test("telegraph damage emits warning before delayed damage", () => {
  const source = actor("boss", "enemy", 0, 0);
  const target = actor("hero", "player", 1, 0);
  const combat = new CombatSystem();
  const telegraph: SkillDefinition = { ...attack, id: "shockwave", type: "telegraph_damage", telegraph: 0.5 };
  assert.equal(combat.use(source, target, telegraph), true);
  assert.deepEqual(combat.drainEvents().map((event) => event.type), ["skill", "telegraph"]);
  combat.update(0.4, [source, target]);
  assert.equal(target.health, 100);
  combat.update(0.1, [source, target]);
  assert.equal(target.health, 82);
  assert.equal(combat.drainEvents()[0]?.skillId, "shockwave");
});

function featureConfig(): DemoConfig {
  return {
    seed: 7,
    world: { width: 100, height: 100, cellSize: 5, blocked: [] },
    fog: { cellSize: 5, revealRadius: 10 },
    squad: {
      actors: [
        { id: "leader", kind: "hero", team: "player", x: 0, y: 0, hp: 100, attack: 20, defense: 0, moveSpeed: 10, attackRange: 10, aggroRange: 20, skillIds: ["strike"] },
        { id: "support", kind: "hero", team: "player", x: 0, y: 0, hp: 100, attack: 10, defense: 0, moveSpeed: 10, attackRange: 10, aggroRange: 20, skillIds: ["heal", "support_bolt"] },
      ],
      formationOffsets: [{ x: 0, y: 0 }, { x: 0, y: -2 }],
    },
    enemies: [
      { id: "mob_template", kind: "normal", team: "enemy", x: 5, y: 0, hp: 1000, attack: 1, defense: 0, moveSpeed: 0, attackRange: 1, aggroRange: 0, skillIds: ["claw"] },
      { id: "boss_template", kind: "boss", team: "enemy", x: 40, y: 0, hp: 1000, attack: 1, defense: 0, moveSpeed: 0, attackRange: 1, aggroRange: 0, skillIds: ["claw"], phaseThresholds: [0.66, 0.33] },
    ],
    skills: {
      player: { id: "fallback", range: 10, cooldown: 1, power: 1, target: "nearest_enemy" },
      enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "nearest_hero" },
      definitions: [
        { id: "strike", type: "damage", coefficient: 1, cooldown: 1, range: 10, target: "nearest_enemy" },
        { id: "heal", type: "heal", coefficient: 1, cooldown: 10, range: 10, target: "lowest_hp_ally" },
        { id: "support_bolt", type: "damage", coefficient: 1, cooldown: 1, range: 10, target: "nearest_enemy" },
        { id: "claw", type: "damage", coefficient: 1, cooldown: 1, range: 1, target: "nearest_hero" },
      ],
    },
    spawns: [
      { id: "near", trigger: "distance", x: 5, y: 0, triggerRadius: 2, enemyId: "mob_template", count: 3, spawnRadius: 1 },
      { id: "boss", trigger: "zone_unlocked", x: 40, y: 0, triggerRadius: 3, enemyId: "boss_template", count: 1, spawnRadius: 0 },
    ],
    ticksPerSecond: 20,
  };
}

test("distance and boss-zone spawns create unique configured instances", () => {
  const session = DemoSession.create(featureConfig());
  assert.equal(session.getSnapshot().actors.filter((entry) => entry.team === "enemy").length, 0);
  session.setMoveIntent(1, 0);
  session.update(0.35);
  const snapshot = session.getSnapshot();
  const near = snapshot.spawns.find((spawn) => spawn.id === "near")!;
  assert.equal(near.status, "spawned");
  assert.deepEqual(near.spawnedIds, ["near:1", "near:2", "near:3"]);
  assert.equal(new Set(near.spawnedIds).size, 3);
  assert.equal(snapshot.spawns.find((spawn) => spawn.id === "boss")!.status, "pending");
  session.update(4);
  const bossSnapshot = session.getSnapshot();
  assert.equal(bossSnapshot.spawns.find((spawn) => spawn.id === "boss")!.status, "spawned");
  assert.equal(bossSnapshot.bossPhases["boss:1"], "phase1");
});

test("support prioritizes heal then uses its configured damage skill", () => {
  const config = featureConfig();
  const session = DemoSession.create({ ...config, spawns: undefined });
  const leader = session.world.players.find((entry) => entry.id === "leader")!;
  leader.receiveDamage(50);
  session.update(0.1);
  const events = session.getSnapshot().events;
  assert.equal(events.some((event) => event.type === "heal" && event.skillId === "heal"), true);
  assert.equal(events.some((event) => event.type === "damage" && event.sourceId === "support" && event.skillId === "support_bolt"), true);
  assert.equal(leader.health > 50, true);
});

test("DemoSession exposes deterministic fixed-step input and render snapshot", () => {
  const first = DemoSession.create();
  const second = DemoSession.create();
  first.setMoveIntent(1, 0);
  second.setMoveIntent(1, 0);
  assert.equal(first.update(0.1), 2);
  assert.equal(second.update(0.1), 2);
  const firstSnapshot = first.getSnapshot();
  const secondSnapshot = second.getSnapshot();
  assert.deepEqual(firstSnapshot, secondSnapshot);
  assert.equal(firstSnapshot.actors[0]!.x > 15, true);
  assert.equal(firstSnapshot.discoveredFogCells.length > 0, true);
  assert.deepEqual(firstSnapshot.worldBounds, { minX: 0, minY: 0, maxX: 32, maxY: 48 });
  assert.deepEqual(firstSnapshot.flashlight.directionX, 1);
});

test("shipped world_demo config satisfies the DemoSession runtime contract", () => {
  const configUrl = new URL("../assets/resources/config/auto_explore/world_demo.json", import.meta.url);
  const config = JSON.parse(readFileSync(configUrl, "utf8")) as DemoConfig;
  const session = DemoSession.create(config);
  session.update(0.05);
  const snapshot = session.getSnapshot();
  assert.deepEqual(snapshot.worldBounds, { minX: 0, minY: 0, maxX: 4800, maxY: 7200 });
  assert.equal(snapshot.actors.filter((entry) => entry.team === "enemy").length, 0);
  assert.equal(snapshot.spawns.length, config.spawns!.length);
});
