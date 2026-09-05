import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";
import type { ActorStats } from "../assets/scripts/core/actor/Actor.ts";
import type { StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import type { SkillDefinition } from "../assets/scripts/core/combat/Combat.ts";

const bleed: StatusDefinition = { id: "bleed", group: "bleed", duration: 3, periodicDamage: { interval: 1, power: 0.5, damageType: "soul" } };
const stackBleed: StatusDefinition = { ...bleed, duration: 8, maxStacks: 10, periodicDamage: { interval: 3, intervalPerStack: -0.1, power: 0.4, damageType: "soul", scaleWithStacks: true } };
function actor(id: string, stats: Partial<ActorStats> = {}): Actor {
  return new Actor({ id, faction: id === "source" ? "player" : "enemy", position: { x: 2, y: 2 }, stats: {
    maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 1, attackRange: 5, aggroRange: 5, ...stats } });
}
function apply(combat: CombatSystem, source: Actor, target: Actor, status = bleed): void {
  const skill: SkillDefinition = { id: "apply_bleed", target: "enemy", type: "buff", range: 5, power: 0, cooldown: 0, actions: [{ at: 0, type: "status", status }] };
  assert.equal(combat.use(source, target, skill, [source, target]), true); combat.drainEvents();
}

test("periodic damage includes the final expiry tick and retains the applying hero's kill credit", () => {
  const combat = new CombatSystem(), source = actor("source"), target = actor("target", { maxHealth: 125 });
  apply(combat, source, target); source.receiveDamage(1000);
  combat.update(0.99, [source, target]); assert.equal(target.health, 125);
  combat.update(0.01, [source, target]); assert.equal(target.health, 75);
  combat.update(5, [source, target]); assert.equal(target.health, 0);
  const events = combat.drainEvents();
  assert.deepEqual(events.filter((event) => event.type === "damage").map((event) => event.value), [50, 50, 25]);
  assert.equal(events.filter((event) => event.type === "death").length, 1);
  assert.ok(events.every((event) => event.sourceId === "source"));
  assert.equal(target.statusSnapshots().length, 0);
  combat.update(10, [source, target]); assert.deepEqual(combat.drainEvents(), []);
});

test("stacking refreshes expiry while preserving tick progress and respecting the cap", () => {
  const combat = new CombatSystem(), source = actor("source"), target = actor("target");
  apply(combat, source, target, stackBleed); combat.update(1, [source, target]);
  apply(combat, source, target, stackBleed);
  assert.deepEqual(target.statusSnapshots()[0], { id: "bleed", remaining: 8, stacks: 2 });
  combat.update(1.79, [source, target]); assert.equal(target.health, 1000);
  combat.update(0.01, [source, target]); assert.equal(target.health, 920);
  for (let index = 0; index < 15; index++) apply(combat, source, target, stackBleed);
  assert.equal(target.statusSnapshots()[0].stacks, 10);
  combat.update(1.99, [source, target]); assert.equal(target.health, 920);
  combat.update(0.01, [source, target]); assert.equal(target.health, 520);
});

test("periodic settlement adds full ticks without consuming the ordinary schedule", () => {
  const combat = new CombatSystem(), source = actor("source"), target = actor("target");
  apply(combat, source, target, stackBleed); combat.update(1, [source, target]);
  const before = target.statusSnapshots();
  const burst: SkillDefinition = { id: "burst", target: "enemy", range: 5, power: 0, cooldown: 0,
    actions: [{ at: 0, type: "damage", power: 0, settleStatus: { group: "bleed", seconds: 6 } }] };
  assert.equal(combat.use(source, target, burst, [source, target]), true);
  assert.equal(target.health, 920); assert.deepEqual(target.statusSnapshots(), before);
  assert.equal(combat.drainEvents().filter((event) => event.periodic).length, 2);
  combat.update(1.9, [source, target]); assert.equal(target.health, 880);
});

test("periodic damage shares shield absorption and separates physical, magic and soul reductions", () => {
  const combat = new CombatSystem(), source = actor("source", { modifiers: { physicalBonus: 1, magicBonus: 2, dotDamageBonus: 1, criticalChance: 1 } });
  const target = actor("target", { modifiers: { physicalReduction: 0.5, magicReduction: 0.25, dotDamageReduction: 0.5 } });
  target.addShield("shield", 30, 10);
  apply(combat, source, target); combat.update(1, [source, target]);
  assert.equal(target.health, 980); assert.equal(target.shield, 0);
  const event = combat.drainEvents().find((event) => event.type === "damage")!;
  assert.equal(event.periodic, true); assert.equal(event.critical, false); assert.equal(event.damageType, "soul");
  assert.equal(target.receiveDamage(100, "physical"), 50);
  assert.equal(target.receiveDamage(100, "magic"), 75);
  assert.equal(target.receiveDamage(100, "soul"), 100);
});

test("recovering or returning clears configured periodic effects", () => {
  const combat = new CombatSystem(), source = actor("source"), target = actor("target");
  apply(combat, source, target); target.recoverAt({ x: 2, y: 2 });
  combat.update(4, [source, target]); assert.equal(target.health, 1000);
  apply(combat, source, target, { ...bleed, clearOnReturn: true }); target.setState("returning");
  combat.update(4, [source, target]); assert.equal(target.health, 1000); assert.equal(target.statusSnapshots().length, 0);
});

test("periodic defeats grant one exploration reward and pause freezes their clocks", () => {
  const session = new DemoSession({ meta: { id: "periodic-reward", schemaVersion: 1 }, seed: 3,
    world: { width: 20, height: 20, progression: { level: 1, resources: { coin: { name: "Coin", initial: 0 } } } }, fog: { revealRadius: 5 },
    squad: { actors: [{ id: "source", x: 2, y: 2, hp: 100, attack: 100, moveSpeed: 0, attackRange: 0, aggroRange: 0 }] },
    enemies: [{ id: "target", x: 4, y: 4, hp: 70, attack: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0, defeatCounters: ["kill:target"], defeatRewards: [{ resource: "coin", amount: 2 }] }],
    skills: { player: { id: "hit", target: "enemy", range: 0, cooldown: 1, power: 0 }, enemy: { id: "hit", target: "enemy", range: 0, cooldown: 1, power: 0 } } });
  session.world.enemies[0].addStatus(bleed, session.world.players[0], "bleed_skill");
  session.pause(); session.update(10); assert.equal(session.world.enemies[0].health, 70);
  session.resume(); for (let index = 0; index < 80; index++) session.update(0.05);
  assert.equal(session.map.resourceBalance("coin"), 2); assert.equal(session.map.counter("kill:target"), 1);
  for (let index = 0; index < 80; index++) session.update(0.05);
  assert.equal(session.map.resourceBalance("coin"), 2);
});
