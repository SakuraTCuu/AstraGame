import assert from "node:assert/strict";
import test from "node:test";
import { Actor, DemoSession } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/demo/DemoSession.ts";

function config(): DemoConfig {
  const actors = ["one", "two"].map((id, index) => ({ id, kind: "hero", x: 2 + index, y: 2, hp: 100, attack: 10, defense: 0, moveSpeed: 3, attackRange: 4, aggroRange: 8 }));
  return { meta: { id: "growth", schemaVersion: 1 }, seed: 7,
    world: { width: 20, height: 20, progression: { level: 1, rank: 1, resources: { merit: { name: "Merit", initial: 12 }, bracer: { name: "Bracer", initial: 0 } } } },
    fog: { revealRadius: 10 }, squad: { actors },
    enemies: [{ id: "guard", kind: "resource", x: 4, y: 2, hp: 1, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0,
      defeatFlag: "defeat:guard", firstDefeatRewards: [{ resource: "bracer", amount: 1 }] }],
    spawns: [{ id: "guards", enemyId: "guard", trigger: "distance", x: 4, y: 2, triggerRadius: 10, count: 1, spawnRadius: 0, respawn: true, respawnDelay: 1 }],
    skills: { player: { id: "hit", target: "enemy", range: 4, cooldown: 0.2, power: 1 }, enemy: { id: "wait", target: "enemy", range: 0, cooldown: 1, power: 0 } },
    development: { heroes: actors.map((actor) => ({ actorId: actor.id, initialLevel: 1, levelTable: "shared" })),
      levelTables: { shared: [{ level: 1, attributes: { attack: 10, defense: 0, maxHealth: 100 }, cost: { merit: 5 } },
        { level: 2, attributes: { attack: 16, defense: 2, maxHealth: 120 }, cost: { merit: 9 } },
        { level: 3, attributes: { attack: 22, defense: 4, maxHealth: 140 } }] },
      equipment: [{ id: "bracer", resource: "bracer", name: "Bracer", type: 1, quality: 1, attributes: { attack: [4, 7], defense: [2, 2], maxHealth: [20, 20] } }],
      slots: actors.map((actor, index) => ({ id: `slot${index}`, actorId: actor.id, name: "Wrist", type: 1 })),
      ranks: [{ rank: 1, heroLevelLimit: 1, attributes: { attack: 0, defense: 0, maxHealth: 0 } },
        { rank: 2, heroLevelLimit: 3, attributes: { attack: 2, defense: 1, maxHealth: 10 } }] },
  };
}

test("first-defeat equipment drops once across respawns and rolls stable item attributes", () => {
  const session = new DemoSession(config()); session.update(4);
  assert.ok(session.map.counter("defeat:guard") > 1);
  assert.equal(session.map.resourceBalance("bracer"), 1);
  const items = session.development!.snapshot().items;
  assert.equal(items.length, 1); assert.ok(items[0].attributes.attack >= 4 && items[0].attributes.attack <= 7);
  const twin = new DemoSession(config()); twin.update(4);
  assert.deepEqual(twin.development!.save().items, session.development!.save().items);
  const restored = new DemoSession(config()); restored.restoreExploration(session.saveExploration()); restored.update(4);
  assert.equal(restored.map.resourceBalance("bracer"), 1);
  assert.equal(restored.map.hasFlag("first_drop:guard"), true);
});

test("equipment changes only its assigned hero and moves a single item between slots", () => {
  const session = new DemoSession(config()); session.update(0.3);
  const item = session.development!.snapshot().items[0], first = session.world.players[0], second = session.world.players[1];
  first.health = 50;
  assert.equal(session.equipItem(item.id, "slot0"), "completed");
  assert.equal(first.stats.attack, 10 + item.attributes.attack);
  assert.equal(first.stats.maxHealth, 120); assert.equal(first.health, 60);
  assert.equal(second.stats.attack, 10);
  const target = new Actor({ id: "target", faction: "enemy", position: { x: 5, y: 2 }, stats: { maxHealth: 100, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
  assert.equal(session.world.combat.use(first, target, { id: "equipment_hit", range: 4, cooldown: 0, power: 1, target: "enemy" }, [first, target]), true);
  assert.equal(100 - target.health, first.stats.attack);
  assert.equal(session.equipItem(item.id, "slot1"), "completed");
  assert.equal(first.stats.attack, 10); assert.equal(second.stats.maxHealth, 120);
  assert.equal(session.map.counter("equipped"), 1);
  assert.equal(session.development!.snapshot().slots[0].itemId, undefined);
  second.receiveDamage(1000);
  assert.equal(session.unequipItem("slot1"), "completed");
  assert.equal(second.health, 0); assert.equal(second.fsm.state, "dead");
  assert.equal(session.map.counter("equipped"), 0);
});

test("rank limits block upgrades, successful upgrades consume their configured costs and update combat stats", () => {
  const session = new DemoSession(config());
  assert.equal(session.upgradeHero("one"), "requirements_not_met");
  assert.equal(session.map.resourceBalance("merit"), 12);
  session.map.setRank(2); session.development!.syncInventory();
  assert.equal(session.world.players[0].stats.attack, 12);
  assert.equal(session.upgradeHero("one"), "completed");
  assert.equal(session.map.resourceBalance("merit"), 7);
  assert.equal(session.world.players[0].stats.attack, 18);
  assert.equal(session.world.players[0].stats.maxHealth, 130);
  assert.deepEqual(session.map.partyLevels, [2, 1]);
  assert.equal(session.upgradeHero("one"), "insufficient_resources");
  assert.equal(session.map.resourceBalance("merit"), 7);
});

test("level thresholds unlock energy capacity and regeneration and restore before energy validation", () => {
  const data = config();
  const profile = { ...data, enemies: [], spawns: [], development: { ...data.development!, levelTables: { shared: data.development!.levelTables!.shared.map((row) => ({ ...row,
    energy: row.level === 1 ? { maxEnergy: 0, energyPerSecond: 0, energyOnSkill: 0, energyOnDamage: 0 } :
      row.level === 2 ? { maxEnergy: 100, energyPerSecond: 20, energyOnSkill: 10, energyOnDamage: 2 } : undefined })) } } };
  const session = new DemoSession(profile), source = session.world.players[0];
  const ultimate = { id: "ultimate", target: "enemy" as const, range: 4, cooldown: 1, power: 1, energyCost: 100 };
  source.gainEnergy(100); assert.equal(source.energy, 0); assert.equal(session.world.combat.canUse(source, ultimate), false);
  session.map.setRank(2); assert.equal(session.upgradeHero(source.id), "completed");
  for (let index = 0; index < 100; index++) session.update(0.05);
  assert.equal(source.energy, 100); assert.equal(session.world.combat.canUse(source, ultimate), true);
  const saved = session.saveExploration(), restored = new DemoSession(profile); restored.restoreExploration(saved);
  assert.equal(restored.world.players[0].stats.maxEnergy, 100); assert.equal(restored.world.players[0].energy, 100);
  restored.map.grantResources({ merit: 10 }); assert.equal(restored.upgradeHero(source.id), "completed");
  assert.equal(restored.world.players[0].stats.energyPerSecond, 20);
});

test("grown health, rolled equipment and assignments restore before party health validation", () => {
  const session = new DemoSession(config()); session.update(0.3);
  const item = session.development!.snapshot().items[0];
  session.equipItem(item.id, "slot0");
  session.map.setRank(2); session.development!.syncInventory(); session.upgradeHero("one");
  const save = session.saveExploration();
  assert.ok(save.party[0].hp > 100);
  const restored = new DemoSession(config()); restored.restoreExploration(save);
  assert.deepEqual(restored.development!.save(), save.development);
  assert.equal(restored.world.players[0].health, save.party[0].hp);
  assert.deepEqual(restored.world.players[0].stats, session.world.players[0].stats);
  restored.update(3);
  assert.equal(restored.map.resourceBalance("bracer"), 1);
});

test("tampered equipment and duplicate assignments fail before changing progress", () => {
  const session = new DemoSession(config()); session.update(0.3);
  const save = session.saveExploration(), target = new DemoSession(config()), before = target.saveExploration();
  const item = save.development!.items[0];
  const invalid = [{ ...save.development!, items: [{ ...item, attributes: { ...item.attributes, attack: 99 } }] },
    { ...save.development!, equipped: { slot0: item.id, slot1: item.id } }];
  for (const development of invalid) {
    assert.throws(() => target.restoreExploration({ ...save, development }));
    assert.deepEqual(target.saveExploration(), before);
  }
});
