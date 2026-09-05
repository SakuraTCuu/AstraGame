import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, selectSkillTarget } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/combat/Combat.ts";
import type { StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";

function actor(id: string, faction: "player" | "enemy", x = 0, kind?: string, summonerId?: string): Actor {
  return new Actor({ id, faction, kind, summonerId, position: { x, y: 0 }, stats: { maxHealth: 1000, attack: 100, defense: 0,
    moveSpeed: 1, attackRange: 300, aggroRange: 300, maxEnergy: 10000, energyOnSkill: 100, energyOnNormal: 20 } });
}
const music: StatusDefinition = { id: "music_buff", group: "music", duration: 3, targetCountBonuses: { normal_heal: 2 } };
const normal: SkillDefinition = { id: "normal", group: "normal_heal", type: "heal", target: "ally", targetRule: "lowest_hp", category: "normal",
  range: 300, cooldown: 0, power: 0.7, maxTargets: 1, targetCount: 1, area: { shape: "circle", radius: 10 },
  actions: [{ at: 0, type: "heal", power: 0.7, healingBonuses: [{ conditions: { requiredState: "music" }, powerBonus: 1 }] }] };

test("a timed status expands healing targets and power only while present", () => {
  const source = actor("healer", "player"), allies = [1, 2, 3, 4].map((id) => actor(String(id), "player", id));
  allies.forEach((ally, index) => { ally.health = (index + 1) * 100; });
  const actors = [source, ...allies], combat = new CombatSystem();
  combat.use(source, allies[0], normal, actors); assert.deepEqual(allies.map((ally) => ally.health), [170, 200, 300, 400]);
  source.addStatus(music); combat.use(source, allies[0], normal, actors);
  assert.deepEqual(allies.map((ally) => ally.health), [310, 340, 440, 400]);
  combat.update(3, actors); allies.forEach((ally) => { ally.health = 100; });
  combat.use(source, allies[0], normal, actors); assert.deepEqual(allies.map((ally) => ally.health), [170, 100, 100, 100]);
});

test("healing bonus presence and absence choose all or weighted statuses", () => {
  const source = actor("healer", "player"), target = actor("ally", "player", 1), combat = new CombatSystem(() => 0.7);
  const choices = [{ status: { id: "one", duration: 4 }, weight: 1 }, { status: { id: "two", duration: 4 }, weight: 3 }];
  const skill: SkillDefinition = { ...normal, actions: [{ at: 0, type: "heal", power: 0.1, healingBonuses: [
    { conditions: { excludedState: "blessing" }, selection: "weighted", statuses: choices },
    { conditions: { requiredState: "blessing" }, selection: "all", statuses: choices },
  ] }] };
  target.health = 100; combat.use(source, target, skill, [source, target]);
  assert.deepEqual(target.statusSnapshots().map((entry) => entry.id), ["two"]);
  target.recoverAt(target.position); target.health = 100; source.addStatus({ id: "blessing", duration: 2 });
  combat.use(source, target, skill, [source, target]);
  assert.deepEqual(target.statusSnapshots().map((entry) => entry.id), ["one", "two"]);
});

test("an additional healing skill preserves the primary cast and does not award blocked energy", () => {
  const source = actor("healer", "player"), allies = [1, 2, 3].map((id) => actor(String(id), "player", id)), enemy = actor("enemy", "enemy", 5);
  allies.forEach((ally) => { ally.health = 100; });
  const child: SkillDefinition = { ...normal, id: "extra", group: "extra", blockEnergyGain: true, maxTargets: 3, targetCount: 3,
    castDuration: 1.2, actions: [{ at: 0, type: "heal", power: 1.4 }] };
  const parent: SkillDefinition = { id: "music", type: "buff", target: "self", range: 300, cooldown: 0, power: 0, category: "skill",
    windup: 0.2, castDuration: 0.8, actions: [{ at: 0.2, type: "status", status: music }], onRelease: [{ skillId: "extra" }] };
  const actors = [source, ...allies, enemy], combat = new CombatSystem(undefined, "pve", { extra: child });
  combat.use(source, source, parent, actors); assert.ok(allies.every((ally) => ally.health === 100));
  combat.update(0.2, actors); assert.ok(allies.every((ally) => ally.health === 240));
  assert.equal(source.energy, 100); assert.equal(source.fsm.state, "recovering"); assert.equal(combat.castSnapshots().length, 1);
  combat.update(0.6, actors); assert.equal(combat.isBusy(source), false);
  combat.use(source, enemy, { id: "slow", target: "enemy", range: 10, power: 1, cooldown: 0, windup: 2, castDuration: 3 }, actors);
  combat.update(0.7, actors); assert.equal(source.fsm.state, "windup"); assert.equal(combat.isBusy(source), true);
});

test("pending extra skills stop on cancellation, death and encounter reset", () => {
  const source = actor("healer", "player"), target = actor("ally", "player", 1); target.health = 100;
  const child: SkillDefinition = { ...normal, id: "extra", windup: 0.4, castDuration: 1, actions: [{ at: 0.8, type: "heal", power: 1 }] };
  const parent: SkillDefinition = { id: "parent", type: "buff", target: "self", range: 10, power: 0, cooldown: 0, actions: [], onRelease: [{ skillId: "extra" }] };
  const combat = new CombatSystem(undefined, "pve", { extra: child }), actors = [source, target];
  combat.use(source, source, parent, actors); combat.cancelCaster(source.id); combat.update(2, actors); assert.equal(target.health, 100);
  combat.use(source, source, parent, actors); combat.resetEngagement(); combat.update(2, actors); assert.equal(target.health, 100);
  combat.use(source, source, parent, actors); source.receiveDamage(10000); combat.update(2, actors); assert.equal(target.health, 100);
});

test("cyclic extra-skill links terminate without taking over the primary actor", () => {
  const source = actor("healer", "player");
  const first: SkillDefinition = { id: "first", type: "buff", target: "self", range: 1, power: 0, cooldown: 0, actions: [], onRelease: [{ skillId: "second" }] };
  const second: SkillDefinition = { ...first, id: "second", onRelease: [{ skillId: "first" }] };
  const combat = new CombatSystem(undefined, "pve", { first, second });
  assert.equal(combat.use(source, source, first, [source]), true);
  assert.equal(combat.drainEvents().filter((event) => event.type === "skill").length, 2);
});

test("cleansing preserves player-origin, protected and beneficial effects", () => {
  const source = actor("healer", "player"), target = actor("ally", "player", 100), npc = actor("npc", "enemy"), player = actor("opponent", "enemy", 1, "hero");
  const summon = actor("summon", "enemy", 1, "normal", player.id), combat = new CombatSystem(() => 0);
  target.addStatus({ id: "slow", duration: 5, harmful: true }, npc);
  target.addStatus({ id: "protected", duration: 5, harmful: true, dispellable: false }, npc);
  target.addStatus({ id: "positive", duration: 5 }, npc);
  target.addStatus({ id: "player_debuff", duration: 5, harmful: true }, player);
  const actors = [source, target, npc, player, summon];
  combat.use(summon, target, { id: "summon_debuff", type: "buff", target: "enemy", range: 300, cooldown: 0, power: 0,
    actions: [{ at: 0, type: "status", status: { id: "summon_status", duration: 5, harmful: true } }] }, actors);
  const cleanse: SkillDefinition = { id: "cleanse", type: "buff", target: "self", range: 5, cooldown: 0, power: 0,
    actions: [{ at: 0, type: "cleanse", recipient: "allies", globalTargets: true, targetCount: 99, cleanse: { count: 1, npcOnly: true } }] };
  combat.use(source, source, cleanse, actors);
  assert.equal(target.hasStatus("slow"), false);
  for (const id of ["protected", "positive", "player_debuff", "summon_status"]) assert.equal(target.hasStatus(id), true);
  assert.equal(combat.drainEvents().find((event) => event.type === "cleanse")?.value, 1);
});

test("enemy target-health conditions are enforced for selection and direct casts", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 1), combat = new CombatSystem();
  const skill: SkillDefinition = { id: "execute", target: "enemy", range: 5, cooldown: 0, power: 1, conditions: { targetHpBelow: 0.5 } };
  assert.equal(selectSkillTarget(source, [target], skill), undefined); assert.equal(combat.use(source, target, skill), false);
  target.health = 499; assert.equal(combat.use(source, target, skill), true);
});
