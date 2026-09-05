import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceSkillCompiler, skillFrames, skillTuple } from "../tools/reference-skills.mjs";

test("frame expressions preserve action order, frame timing and damage types", () => {
  const frames = skillFrames("[key:2_action:[damageAction,6000]_dmgType:[2]]&[key:4_action:[damageAction,6000]|[addBuffAction,9,1]]");
  assert.equal(frames.length, 2);
  assert.equal(frames[0].frame, 2);
  assert.equal(frames[0].damageType, 2);
  assert.deepEqual(frames[1].actions, [["damageAction", 6000], ["addBuffAction", 9, 1]]);
  assert.deepEqual(skillTuple("[box,200,600]"), ["box", 200, 600]);
  assert.throws(() => skillFrames("[key:2_action:[damageAction,1]"), /Unbalanced|Invalid/);
});

test("the adapter converts source timing, projectile and energy units explicitly", () => {
  const row = { skillType: 8, firstSelector: [300, 3], preTime: 500, postTime: 1250, cd: 15000, publicCd: 1000, publicCdGroup: 1,
    selectShape: "[circle,10]", skillTagActions: "[lockProTag,600,3000,1,1]|[castCostTag,ultraEnegy,10000]|[criticalTag]",
    projectEffect: "[8]", projectKey: "[key:0_action:[damageAction,20000]_dmgType:[2]]", presentationIds: "[1,skill1]" };
  const compiler = createReferenceSkillCompiler((family, id) => family === "Skill" && id === 1 ? row : null);
  const skill = compiler.compile(1);
  assert.equal(skill.cooldown, 15);
  assert.equal(skill.windup, 0.5);
  assert.equal(skill.castDuration, 1.25);
  assert.equal(skill.projectileSpeed, 600);
  assert.equal(skill.projectileLifetime, 3);
  assert.equal(skill.projectileHoming, true);
  assert.equal(skill.energyCost, 10000);
  assert.equal(skill.targetCount, 3);
  assert.equal(skill.actions[0].power, 2);
  assert.equal(skill.actions[0].forceCritical, true);
});

test("source buffs become timed modifiers and source HP gates remain conditions", () => {
  const rows = { Skill: { 1: { skillType: 2, targetCamp: 1, firstSelector: [50, 1], preTime: 0, postTime: 1000,
    frameKey: "[key:3_action:[addBuffAction,7,1]]", useCond: "[castHpRateCond,7500]", presentationIds: "[1,skill2]" } },
    Buff: { 7: { duration: 3000, group: 2, effects: "[changeAttrAction,atkRate,2000]|[addStateAction,ready,3000]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  const skill = compiler.compile(1, 12);
  assert.equal(skill.conditions.casterHpAtMost, 0.75);
  assert.equal(skill.actions[0].at, 0.25);
  assert.equal(skill.actions[0].status.duration, 3);
  assert.equal(skill.actions[0].status.modifiers.attackRate, 0.2);
  assert.equal(skill.actions[0].status.state, "ready");
});
