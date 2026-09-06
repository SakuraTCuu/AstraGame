import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, EnemyAI, PlayerAI, Vector2 } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/index.ts";
import type { StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "enemy" | "player", x: number, attack = 100) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 1000, attack, defense: 0, moveSpeed: 2, attackRange: 3, aggroRange: 5, leashRange: 20, maxEnergy: 100 } });
const taunt: StatusDefinition = { id: "taunt", duration: 0.5, harmful: true, states: [{ id: "taunt", duration: 1.2, control: "taunt" }] };
const normal: SkillDefinition = { id: "normal", target: "enemy", range: 20, cooldown: 0, power: 1, category: "normal" };

test("target groups do not replace defeated damage recipients when applying a limited Buff", () => {
  const source = actor("source", "player", 0), targets = [10, 30, 20, 5].map((attack, index) => actor(`target_${index}`, "enemy", index + 1, attack));
  targets[1].health = 50;
  const combat = new CombatSystem(), skill: SkillDefinition = { ...normal, targetRule: "highest_attack", maxTargets: 3, area: { shape: "circle", radius: 30 },
    actions: [{ at: 0, type: "damage", power: 1, targetGroup: "frame" }, { at: 0, type: "status", status: taunt, targetGroup: "frame", targetCount: 3 }] };
  combat.use(source, targets[1], skill, [source, ...targets]);
  assert.equal(targets[1].alive, false); assert.equal(targets[0].hasControl("taunt"), true); assert.equal(targets[2].hasControl("taunt"), true);
  assert.equal(targets[3].health, 1000); assert.equal(targets[3].hasControl("taunt"), false);
});

test("a target-limited status does not shrink the shared group for a later damage action", () => {
  const source = actor("source", "player", 0), targets = [1, 2, 3].map((x) => actor(`target_${x}`, "enemy", x)), combat = new CombatSystem();
  combat.use(source, targets[0], { ...normal, maxTargets: 3, area: { shape: "circle", radius: 30 }, actions: [
    { at: 0, type: "status", status: taunt, targetCount: 1, targetGroup: "frame" }, { at: 0, type: "damage", power: 1, targetGroup: "frame" }] }, [source, ...targets]);
  assert.deepEqual(targets.map((target) => target.health), [900, 900, 900]); assert.deepEqual(targets.map((target) => target.hasControl("taunt")), [true, false, false]);
});

test("grouped effects remain independent for each primary homing projectile", () => {
  const source = actor("source", "player", 0), targets = [2, 4].map((x) => actor(`target_${x}`, "enemy", x)), combat = new CombatSystem();
  combat.use(source, targets[0], { ...normal, targetCount: 2, maxTargets: 2, area: { shape: "circle", radius: 1 }, projectileSpeed: 10, projectileHoming: true,
    actions: [{ at: 0, type: "damage", power: 1, targetGroup: "impact" }, { at: 0, type: "status", status: taunt, targetGroup: "impact" }] }, [source, ...targets]);
  combat.update(0.5, [source, ...targets]); assert.deepEqual(targets.map((target) => target.health), [900, 900]); assert.ok(targets.every((target) => target.hasControl("taunt")));
});

test("taunt interrupts a pending tactical, preserves normal attacks and enforces its valid source", () => {
  const taunter = actor("taunter", "player", 10), other = actor("other", "player", 1), victim = actor("victim", "enemy", 0), combat = new CombatSystem();
  victim.gainEnergy(100); const actors = [taunter, other, victim];
  const tactical: SkillDefinition = { ...normal, id: "tactical", category: "skill", windup: 1, energyCost: 50 };
  combat.use(victim, other, tactical, actors);
  combat.use(taunter, victim, { ...normal, id: "apply", actions: [{ at: 0, type: "status", status: taunt }] }, actors);
  assert.equal(combat.castSnapshots().some((cast) => cast.sourceId === victim.id), false); assert.equal(victim.energy, 50);
  assert.equal(combat.canUse(victim, tactical), false); assert.equal(victim.canMove, true); assert.equal(victim.hardControlled, false);
  assert.equal(combat.selectTarget(victim, [other, taunter], normal), taunter);
  assert.equal(combat.use(victim, other, normal, actors), false); assert.equal(combat.use(victim, taunter, normal, actors), true);
  assert.equal(other.health, 1000); assert.equal(taunter.health, 900);
  combat.update(0.6, actors); assert.equal(victim.hasStatus(taunt.id), true); assert.equal(victim.hasControl("taunt"), true);
  combat.update(0.6, actors); assert.equal(victim.hasControl("taunt"), false); assert.equal(combat.canUse(victim, tactical), true);
});

test("taunt blocks normal-category ally heals and self buffs", () => {
  const taunter = actor("taunter", "player", 2), victim = actor("victim", "enemy", 0), ally = actor("ally", "enemy", 1), combat = new CombatSystem();
  const actors = [taunter, victim, ally];
  const heal: SkillDefinition = { id: "normal_heal", target: "ally", range: 20, cooldown: 0, power: 1, category: "normal", type: "heal", windup: 1 };
  const selfBuff: SkillDefinition = { id: "normal_buff", target: "self", range: 0, cooldown: 0, power: 0, category: "normal", type: "buff" };
  ally.health = 500;
  assert.equal(combat.use(victim, ally, heal, actors), true);
  victim.addStatus(taunt, taunter); combat.update(0, actors);
  assert.equal(combat.castSnapshots().some((cast) => cast.sourceId === victim.id), false);
  assert.equal(combat.canUse(victim, heal), false); assert.equal(combat.use(victim, ally, heal, actors), false);
  assert.equal(combat.canUse(victim, selfBuff), false); assert.equal(combat.use(victim, victim, selfBuff, actors), false);
  assert.equal(victim.blocksCasting("normal", "enemy"), false);
});

test("taunt immunity, cleansing and source validity keep independent lifetimes", () => {
  const source = actor("source", "player", 8), next = actor("next", "player", 10), victim = actor("victim", "enemy", 0);
  victim.addStatus({ id: "immune", duration: 1, states: [{ id: "immune", duration: 1, controlImmunity: ["taunt"] }] });
  assert.equal(victim.addStatus(taunt, source), false); assert.equal(victim.tauntTarget, undefined);
  victim.updateEffects(1); victim.addStatus(taunt, source); victim.addStatus({ ...taunt, id: "second", states: [{ id: "taunt2", duration: 0.3, control: "taunt" }] }, next);
  assert.equal(victim.tauntTarget, next); victim.updateEffects(0.4); assert.equal(victim.tauntTarget, source);
  source.health = 0; assert.equal(victim.tauntTarget, undefined); assert.equal(victim.blocksCasting("ultimate"), true);
  victim.cleanse(5, false, () => 0); assert.equal(victim.hasControl("taunt"), false);
});

test("enemy and player AI chase a taunter using normal-attack range", () => {
  const caster = actor("caster", "player", 10), victim = actor("victim", "enemy", 0), other = actor("other", "player", 1), combat = new CombatSystem();
  const attack = { ...normal, range: 3 }, tactical = { ...normal, id: "tactical", category: "skill" as const, range: 1, priority: 100 };
  victim.addStatus(taunt, caster); combat.update(0, [caster, victim, other]); new EnemyAI([tactical, attack]).update(victim, [other, caster], combat, 0.5);
  assert.equal(victim.targetId, caster.id); assert.equal(victim.fsm.state, "chasing"); assert.equal(victim.position.x, 1);
  const player = actor("player", "player", 0), npc = actor("npc", "enemy", 10), close = actor("close", "enemy", 1), playerCombat = new CombatSystem();
  player.addStatus(taunt, npc); playerCombat.update(0, [player, npc, close]);
  new PlayerAI().update(player, player, [player], [npc, close], [tactical, attack], playerCombat, 0.5, false, false, 20, (unit, point, delta) => unit.moveTowards(point, delta));
  assert.equal(player.targetId, npc.id); assert.equal(player.position.x, 1);
  npc.position = new Vector2(30, 0); assert.equal(player.tauntTarget, undefined);
});

test("taunted player followers ignore manual-control and regroup early returns", () => {
  const attack = { ...normal, range: 3 }, move = (unit: Actor, point: Vector2, delta: number) => unit.moveTowards(point, delta);

  const manualLeader = actor("manual_leader", "player", 0), manualFollower = actor("manual_follower", "player", 0), manualTaunter = actor("manual_taunter", "enemy", 10);
  const manualCombat = new CombatSystem(); manualFollower.addStatus(taunt, manualTaunter); manualCombat.update(0, [manualLeader, manualFollower, manualTaunter]);
  new PlayerAI().update(manualFollower, manualLeader, [manualLeader, manualFollower], [manualTaunter], [attack], manualCombat, 0.5, false, true, 5, move);
  assert.equal(manualFollower.targetId, manualTaunter.id); assert.equal(manualFollower.fsm.state, "chasing"); assert.equal(manualFollower.position.x, 1);

  const regroupLeader = actor("regroup_leader", "player", 20), regroupFollower = actor("regroup_follower", "player", 0), regroupTaunter = actor("regroup_taunter", "enemy", 10);
  const regroupCombat = new CombatSystem(), regroupAI = new PlayerAI(), regroupActors = [regroupLeader, regroupFollower, regroupTaunter];
  regroupCombat.update(0, regroupActors);
  regroupAI.update(regroupFollower, regroupLeader, [regroupLeader, regroupFollower], [regroupTaunter], [attack], regroupCombat, 0.5, false, false, 5, move);
  assert.equal(regroupFollower.targetId, undefined);
  regroupFollower.addStatus(taunt, regroupTaunter); regroupCombat.update(0, regroupActors);
  regroupAI.update(regroupFollower, regroupLeader, [regroupLeader, regroupFollower], [regroupTaunter], [attack], regroupCombat, 0.5, false, false, 5, move);
  assert.equal(regroupFollower.targetId, regroupTaunter.id); assert.equal(regroupFollower.fsm.state, "chasing"); assert.equal(regroupFollower.position.x, 1);
});

test("source target-Buff counts and taunt states compile with shared frame recipients", () => {
  const compiler = createReferenceSkillCompiler((family: string) => family === "Skill" ? { skillType: 8, firstSelector: [300, 3], frameKey:
    "[key:8_action:[damageAction,30000]_dmgType:[1]|[targetBuffAction,3,0,10]|[addBuffAction,11,1]]" } :
    { duration: 2500, effects: "[addStateAction,taunt,2500]" });
  const compiled = compiler.compile(1), damage = compiled.actions[0], buff = compiled.actions[1];
  assert.equal(damage.targetGroup, buff.targetGroup); assert.equal(buff.targetCount, 3); assert.equal(buff.status.states[0].control, "taunt");
  assert.equal(compiled.actions[2].targetGroup, undefined);
  const negative = createReferenceSkillCompiler(() => ({ skillType: 2, frameKey: "[key:0_action:[targetBuffAction,-1,0,10]]" }));
  assert.equal(negative.compile(1).actions.length, 0); assert.ok(negative.issues.some((issue) => issue.kind === "action"));
});
