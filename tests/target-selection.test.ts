import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, EnemyAI, Vector2, selectSkillTarget } from "../assets/scripts/core/index.ts";
import type { CombatRole, SkillDefinition } from "../assets/scripts/core/index.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, x: number, role?: CombatRole, faction: "enemy" | "player" = "player", attack = 100) => new Actor({ id, faction, combatRole: role,
  position: { x, y: 0 }, stats: { maxHealth: 1000, attack, defense: 0, moveSpeed: 0, attackRange: 5, aggroRange: 5, leashRange: 20 } });
const skill: SkillDefinition = { id: "choose", target: "enemy", range: 20, power: 1, cooldown: 0, windup: 1, castDuration: 1.5, targetRule: "role_priority" };

test("role selection orders tank, melee, ranged and support after validity and range checks", () => {
  const source = actor("source", 0, undefined, "enemy"), tank = actor("tank", 10, "tank"), melee = actor("melee", 8, "melee"), ranged = actor("ranged", 6, "ranged"), support = actor("support", 1, "support"), unknown = actor("unknown", 0.5);
  const candidates = [support, unknown, ranged, melee, tank];
  assert.equal(selectSkillTarget(source, candidates, skill), tank);
  tank.position = new Vector2(30, 0); assert.equal(selectSkillTarget(source, candidates, skill), melee);
  melee.health = 0; assert.equal(selectSkillTarget(source, candidates, skill), ranged);
  ranged.addStatus({ id: "hidden", duration: 2, states: [{ id: "hidden", duration: 2, untargetable: true }] });
  assert.equal(selectSkillTarget(source, candidates, skill), support);
  support.health = 0; assert.equal(selectSkillTarget(source, candidates, skill), unknown);
});

test("random selection is seeded, input-order independent and excludes invalid candidates", () => {
  const source = actor("source", 0, undefined, "enemy"), targets = [1, 2, 3, 4].map((x) => actor(`target_${x}`, x)), hidden = actor("hidden", 0.1), far = actor("far", 30);
  hidden.addStatus({ id: "hidden", duration: 2, states: [{ id: "hidden", duration: 2, untargetable: true }] });
  const random: SkillDefinition = { ...skill, targetRule: "random" };
  assert.equal(selectSkillTarget(source, [...targets, hidden, far, source], random, () => 0.99), targets[3]);
  assert.equal(selectSkillTarget(source, [...targets].reverse(), random, () => 0.99), targets[3]);
  assert.equal(selectSkillTarget(source, targets, random, () => 0.25), targets[1]);
});

test("random multi-primary casts keep one distinct ordered target list for all hit frames", () => {
  const source = actor("source", 0, undefined, "enemy"), targets = [1, 2, 3, 4].map((x) => actor(`target_${x}`, x)), combat = new CombatSystem(() => 0.99);
  const random: SkillDefinition = { ...skill, targetRule: "random", targetCount: 3, maxTargets: 3, area: { shape: "circle", radius: 1 },
    actions: [{ at: 1, type: "damage", power: 1 }, { at: 1.2, type: "damage", power: 1 }] };
  const first = combat.selectTarget(source, targets, random)!; combat.use(source, first, random, [source, ...targets]);
  combat.update(1.2, [source, ...targets]);
  assert.deepEqual(combat.events.filter((event) => event.type === "damage").map((event) => event.targetId),
    ["target_4", "target_3", "target_2", "target_4", "target_3", "target_2"]);
  assert.equal(targets[0].health, 1000);
});

test("highest attack selection uses current attack attributes and respects area target limits", () => {
  const source = actor("source", 0, undefined, "enemy"), near = actor("near", 1, undefined, "player", 150), buffed = actor("buffed", 8, undefined, "player", 100), weak = actor("weak", 2, undefined, "player", 50), combat = new CombatSystem();
  buffed.addStatus({ id: "attack", duration: 3, modifiers: { attackRate: 1 } }); weak.addStatus({ id: "damage", duration: 3, modifiers: { damageBonus: 10 } });
  const strongest: SkillDefinition = { ...skill, targetRule: "highest_attack", maxTargets: 2, area: { shape: "circle", radius: 20 }, areaAnchor: "caster" };
  assert.equal(selectSkillTarget(source, [near, buffed, weak], strongest), buffed);
  combat.use(source, buffed, strongest, [source, near, buffed, weak]); combat.update(1, [source, near, buffed, weak]);
  assert.deepEqual(combat.events.filter((event) => event.type === "damage").map((event) => event.targetId), ["buffed", "near"]); assert.equal(weak.health, 1000);
});

test("AI separates engagement from cast targets and holds valid long-range casts inside the leash", () => {
  const source = actor("source", 0, undefined, "enemy"), support = actor("support", 1, "support"), tank = actor("tank", 10, "tank"), combat = new CombatSystem(), ai = new EnemyAI([skill]);
  combat.update(0, [source, support, tank]); ai.update(source, [support, tank], combat, 0.05);
  assert.equal(source.targetId, support.id); assert.equal(combat.castingTargetId(source), tank.id); assert.equal(combat.castSnapshots()[0].targetId, tank.id);
  support.position = new Vector2(25, 0); tank.position = new Vector2(12, 0); combat.update(0.2, [source, support, tank]); ai.update(source, [support, tank], combat, 0.05);
  assert.equal(combat.castSnapshots().length, 1);
  tank.position = new Vector2(25, 0); ai.update(source, [support, tank], combat, 0.05); assert.equal(combat.castSnapshots().length, 0);
});

test("source role metadata and explicit target rules survive session normalization and restoration", () => {
  const config = JSON.parse(readFileSync(new URL("../assets/resources/config/auto_explore/world_demo.json", import.meta.url), "utf8"));
  config.squad.actors[0].combatRole = "tank"; config.skills.definitions[0].targetRule = "role_priority";
  const session = new DemoSession(config); assert.equal(session.world.players[0].combatRole, "tank");
  assert.equal(session.world.options.skillDefinitions![config.skills.definitions[0].id].targetRule, "role_priority");
  const restored = new DemoSession(config); restored.restoreExploration(session.saveExploration());
  assert.equal(restored.getSnapshot().actors.find((entry) => entry.id === restored.world.players[0].id)!.combatRole, "tank");
});

test("source selector and attack-sort tags retain their own rules and audit unsupported combinations", () => {
  const base = { skillType: 2, firstSelector: [100, 3], frameKey: "[key:0_action:[damageAction,10000]]" };
  for (const [targetSelectType, expected] of [[0, "nearest"], [1, "lowest_hp"], [2, "random"], [9, "role_priority"]] as const) {
    assert.equal(createReferenceSkillCompiler(() => ({ ...base, targetSelectType })).compile(1).targetRule, expected);
  }
  assert.equal(createReferenceSkillCompiler(() => ({ ...base, skillTagActions: "[extraSortTag,2,atk]" })).compile(1).targetRule, "highest_attack");
  const unsupported = createReferenceSkillCompiler(() => ({ ...base, targetSelectType: 9, skillTagActions: "[extraSortTag,2,atk]" }));
  assert.equal(unsupported.compile(1).targetRule, "role_priority"); assert.ok(unsupported.issues.some((issue) => issue.kind === "target_sort"));
});
