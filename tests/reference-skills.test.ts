import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceSkillCompiler, heroSkillAtStar, skillFrames, skillTuple } from "../tools/reference-skills.mjs";

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

test("hero skill selection enforces star gates and selects the highest unlocked tier", () => {
  assert.equal(heroSkillAtStar("102_3,101_0,103_7", 0), 101);
  assert.equal(heroSkillAtStar("102_3,101_0,103_7", 6), 102);
  assert.equal(heroSkillAtStar("102_3,101_0,103_7", 7), 103);
  assert.equal(heroSkillAtStar("201_1,202_5", 0), undefined);
  assert.equal(heroSkillAtStar("101_0_201,102_4_202", 0), 101);
  assert.equal(heroSkillAtStar("101_0,102_4|1", 0), 101);
  assert.equal(heroSkillAtStar("201_1,202_1|2", 0), undefined);
  assert.equal(heroSkillAtStar(null), undefined);
  assert.throws(() => heroSkillAtStar("101_0,102_0"), /Duplicate/);
  assert.throws(() => heroSkillAtStar("101_bad"), /Invalid/);
});

test("zero-star heroes do not receive gated active or passive skills", () => {
  const queried: number[] = [];
  const compiler = createReferenceSkillCompiler((family, id) => {
    assert.equal(family, "Skill"); queried.push(id);
    if (id === 4) return { skillType: 3, triggerActions: "[changeAttrAction,atkRate,1000]" };
    if (id === 5) return { skillType: 3, triggerActions: "[changeAttrAction,atkRate,9000]" };
    return { skillType: 1, firstSelector: [50, 1], frameKey: "[key:0_action:[damageAction,10000]]" };
  });
  const result = compiler.heroSkills({ attack: "1_0,11_4", skill1: "2_0", skill2: "3_1", skill5: "4_0;5_3;6_2" }, 12);
  assert.deepEqual(result.ids, ["reference_skill_1", "reference_skill_2"]);
  assert.deepEqual(result.modifiers, { attackRate: 0.1 });
  assert.deepEqual(new Set(queried), new Set([1, 2, 4]));
});

test("annotated periodic buff actions preserve damage type, stacks and interval changes", () => {
  const rows = { Skill: { 1: { skillType: 2, frameKey: "[key:0_action:[addBuffAction,9,0]]" } },
    Buff: { 9: { id: 9, group: 9, duration: 7000, overlieAddEffect: 3, overlieRefreshFirst: 1,
      effects: "[buffDamageAction,2000,6,2500,9,0]_dmgType:[1]", buffTagActions: "[tickSpanChangeByBuffTag,2,1_9,-100]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  const status = compiler.compile(1).actions[0].status;
  assert.equal(status.maxStacks, 3); assert.equal(status.duration, 7);
  assert.deepEqual(status.periodicDamage, { interval: 2, power: 0.25, damageType: "soul", scaleWithStacks: true, intervalPerStack: -0.1 });
  assert.deepEqual(compiler.issues, []);
});

test("configured buff settlement attaches only to the matching damage skill group", () => {
  const rows = { 1: { skillType: 1, skillgroup: 10, frameKey: "[key:0_action:[damageAction,10000]_dmgType:[3]]" },
    2: { skillType: 8, skillgroup: 20, frameKey: "[key:1_action:[damageAction,20000]_dmgType:[3]]" },
    3: { skillType: 3, triggerActions: "[hurtCalcBuffAction,20,10000,1_9,4_9_6000]" } };
  const compiler = createReferenceSkillCompiler((family, id) => family === "Skill" ? rows[id] : undefined);
  compiler.heroSkills({ attack: "1_0", skill2: "2_0", skill5: "3_0" }, 10);
  assert.equal(compiler.definitions.get(1).actions[0].settleStatus, undefined);
  assert.deepEqual(compiler.definitions.get(2).actions[0].settleStatus, { group: "9", seconds: 6 });
  assert.equal(compiler.definitions.get(2).actions[0].damageType, "physical");
});
