import assert from "node:assert/strict";
import test from "node:test";
import { Actor, DemoSession } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";

function config(): DemoConfig {
  const actors = Array.from({ length: 5 }, (_, index) => ({ id: `hero${index}`, name: `Hero ${index}`, kind: "hero", x: 10 + index, y: 10,
    hp: 100, attack: 10, defense: 0, moveSpeed: 3, attackRange: 3, aggroRange: 3, maxEnergy: 100, energyPerSecond: 1 }));
  return { meta: { id: "roster", schemaVersion: 1 }, seed: 7,
    world: { width: 40, height: 40, progression: { level: 1, rank: 1, resources: { fifth: { name: "Fifth hero", initial: 0 }, gear: { name: "Gear", initial: 1 } } } },
    fog: { revealRadius: 5 }, squad: { actors: actors.slice(0, 4) }, enemies: [],
    skills: { player: { id: "hit", target: "enemy", range: 3, cooldown: 10, power: 1 }, enemy: { id: "hit", target: "enemy", range: 3, cooldown: 10, power: 1 } },
    roster: { actors, heroes: actors.map((actor, index) => ({ id: actor.id, initiallyOwned: index < 4, ownershipFlag: `owned:${actor.id}`, cardResource: index === 4 ? "fifth" : undefined })),
      slots: [{}, {}, {}, {}, { condition: { kind: "rank", value: 4 } }], initialLineup: ["hero0", "hero1", "hero2", "hero3", null] },
    development: { heroes: actors.map((actor, index) => ({ actorId: actor.id, initialLevel: 1, levelTable: "shared", optionalInSave: index === 4 })),
      levelTables: { shared: [{ level: 1, attributes: { attack: 10, defense: 0, maxHealth: 100 } }] },
      equipment: [{ id: "gear", resource: "gear", name: "Gear", type: 1, quality: 1, attributes: { attack: [5, 5], defense: [1, 1], maxHealth: [20, 20] } }],
      slots: [{ id: "wrist", position: 0, name: "Wrist", type: 1 }] },
  };
}

test("fifth deployment requires ownership and the configured rank", () => {
  const session = new DemoSession(config());
  assert.equal(session.world.players.length, 4);
  assert.equal(session.setLineup(4, "hero4"), false);
  session.map.grantResources({ fifth: 1 }); session.update(0.05);
  assert.equal(session.roster!.owns("hero4"), true);
  assert.equal(session.setLineup(4, "hero4"), false);
  session.map.setRank(4);
  assert.equal(session.setLineup(4, "hero4"), true);
  assert.equal(session.world.players.length, 5);
  assert.equal(session.map.counter("party_count"), 5);
  session.setAutoDestination(20, 20); session.update(1);
  assert.ok(session.world.players.every((actor) => session.world.options.navigation.isWorldWalkable(actor.position)));
});

test("reordering heroes moves slot equipment without cloning it", () => {
  const session = new DemoSession(config()); session.update(0.05);
  session.equipItem(session.development!.snapshot().items[0].id, "wrist");
  const first = session.roster!.actor("hero0")!, second = session.roster!.actor("hero1")!;
  assert.equal(first.stats.attack, 15);
  assert.equal(session.setLineup(0, "hero1"), true);
  assert.deepEqual(session.roster!.slots().slice(0, 2), ["hero1", "hero0"]);
  assert.equal(first.stats.attack, 10); assert.equal(second.stats.attack, 15);
  assert.equal(session.development!.snapshot().items.length, 1);
  assert.equal(session.development!.snapshot().slots[0].actorId, "hero1");
});

test("benching preserves hero wounds, energy and skill cooldowns", () => {
  const session = new DemoSession(config()); session.map.grantResources({ fifth: 1 }); session.update(0.05);
  const hero = session.roster!.actor("hero0")!; hero.receiveDamage(50); hero.gainEnergy(20);
  const target = new Actor({ id: "dummy", faction: "enemy", position: { x: hero.position.x + 1, y: hero.position.y }, stats: { maxHealth: 100, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
  const skill = { id: "hero_cooldown", target: "enemy" as const, range: 3, cooldown: 10, power: 1 };
  session.world.combat.use(hero, target, skill, [hero, target]);
  const hp = hero.health, energy = hero.energy;
  assert.equal(session.setLineup(0, "hero4"), true);
  session.update(1);
  assert.equal(hero.health, hp); assert.equal(hero.energy, energy);
  assert.equal(session.setLineup(0, "hero0"), true);
  assert.equal(hero.health, hp);
  assert.ok(session.world.combat.cooldownRemaining(hero, skill) > 8);
});

test("dynamic lineups and reserve vitals survive save while invalid assignments are atomic", () => {
  const session = new DemoSession(config()); session.map.grantResources({ fifth: 1 }); session.update(0.05);
  session.roster!.actor("hero0")!.receiveDamage(40);
  session.setLineup(0, "hero4");
  const save = session.saveExploration(), restored = new DemoSession(config());
  restored.restoreExploration(save);
  assert.deepEqual(restored.roster!.save(), save.roster);
  assert.equal(restored.roster!.actor("hero0")!.health, 60);
  assert.equal(restored.world.leader!.id, "hero4");
  const clean = new DemoSession(config()), before = clean.saveExploration();
  assert.throws(() => clean.restoreExploration({ ...save, roster: { ...save.roster!, lineup: ["hero4", "hero4", "hero2", "hero3", null] } }), /roster assignment/);
  assert.deepEqual(clean.saveExploration(), before);
});

test("legacy four-hero saves fill only explicitly optional new hero levels", () => {
  const data = config();
  const legacy = new DemoSession({ ...data, roster: undefined, development: { ...data.development!, heroes: data.development!.heroes.slice(0, 4),
    slots: [{ id: "wrist", actorId: "hero0", type: 1, name: "Wrist" }] } });
  legacy.update(0.05); legacy.equipItem(legacy.development!.snapshot().items[0].id, "wrist");
  const current = new DemoSession(data); current.restoreExploration(legacy.saveExploration());
  assert.equal(current.world.players.length, 4);
  assert.equal(current.world.players[0].stats.maxHealth, 120);
  assert.equal(current.development!.levelOf("hero4"), 1);
  assert.equal(current.roster!.owns("hero4"), false);
});

test("the last deployed hero cannot be removed", () => {
  const session = new DemoSession(config());
  for (const index of [3, 2, 1]) assert.equal(session.setLineup(index, null), true);
  assert.equal(session.setLineup(0, null), false);
  assert.equal(session.world.players.length, 1);
});

test("saved ownership cannot bypass a hero deployment condition", () => {
  const data = config();
  const unavailable = { ...data, roster: { ...data.roster!, heroes: data.roster!.heroes.map((hero) => hero.id === "hero4" ?
    { ...hero, deployCondition: { kind: "flag" as const, id: "hero4_ready" } } : hero) } };
  const source = new DemoSession(data); source.map.grantResources({ fifth: 1 }); source.update(0.05); source.setLineup(0, "hero4");
  const target = new DemoSession(unavailable), before = target.saveExploration();
  assert.throws(() => target.restoreExploration(source.saveExploration()), /roster assignment/);
  assert.deepEqual(target.saveExploration(), before);
});
