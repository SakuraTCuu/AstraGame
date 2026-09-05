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

test("impact knockback and self healing attach to their own damage frame only", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 8, preTime: 500,
    frameKey: "[key:6_action:[damageAction,12000]_dmgType:[1]|[repelAction,300,20]|[healByDmgAction,5000]]&[key:9_action:[damageAction,5000]_dmgType:[1]]" }));
  const skill = compiler.compile(1, 12);
  assert.equal(skill.actions[0].at, 0.5); assert.equal(skill.actions[0].power, 1.2);
  assert.deepEqual(skill.actions[0].knockback, { duration: 0.3, distance: 20 });
  assert.equal(skill.actions[0].healFromDamage, 0.5); assert.equal(skill.actions[0].healFromDamageRecipient, "self");
  assert.equal(skill.actions[1].knockback, undefined); assert.equal(skill.actions[1].healFromDamage, undefined);
  assert.deepEqual(compiler.issues.map((issue) => issue.kind), ["knockback_parity"]);
  const unsupported = createReferenceSkillCompiler(() => ({ skillType: 2, frameKey: "[key:0_action:[repelAction,300,20]|[healByDmgAction,5000]]" }));
  assert.equal(unsupported.compile(1).actions.length, 0); assert.equal(unsupported.issues.filter((issue) => issue.kind === "action").length, 2);
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

test("unconditional permanent personal traits compile once per hero", () => {
  const rows = { Skill: { 1: { skillType: 1, frameKey: "[key:0_action:[damageAction,10000]]" },
    2: { skillType: 3, triggerActions: "[enterFightAddBuff,10000,null,2,9_1]" } },
    Buff: { 9: { duration: -1, effects: "[changeAttrAction,dotDmgBonus,1000]|[changeAttrAction,maxhpRate,500]|[changeAttrAction,normalDmgBonus,1000]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  const hero = { id: 8, attack: "1_0", skill5: "2_0" };
  const expected = { dotDamageBonus: 0.1, maxHealthRate: 0.05, soulBonus: 0.1 };
  assert.deepEqual(compiler.heroSkills(hero, 12).modifiers, expected);
  assert.deepEqual(compiler.heroSkills(hero, 12).modifiers, expected);
  assert.deepEqual(compiler.heroSkills({ id: 7, attack: "1_0" }, 12).modifiers, {});
  assert.deepEqual(compiler.issues, []);
});

test("redundant trailing passive brackets are audited but truncated expressions still fail", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 3,
    triggerActions: "[changeAttrAction,finalDmgReduction,3000]|[changeAttrAction,pveFinalDmgRecution,2000]]" }));
  assert.deepEqual(compiler.heroSkills({ id: 8, skill5: "1_0" }, 12).modifiers, { finalDamageReduction: 0.3, pveDamageReduction: 0.2 });
  assert.equal(compiler.issues[0].kind, "source_expression_padding");
  const invalid = createReferenceSkillCompiler(() => ({ skillType: 3, triggerActions: "[changeAttrAction,atkRate,1000" }));
  assert.throws(() => invalid.heroSkills({ id: 8, skill5: "1_0" }, 12), /Unbalanced/);
});

test("source special damage kinds retain their independent identities", () => {
  const compiler = createReferenceSkillCompiler((family, id) => family === "Skill" ? { skillType: 2,
    frameKey: `[key:0_action:[damageAction,10000]_dmgType:[${id}]]` } : undefined);
  assert.equal(compiler.compile(0).actions[0].damageType, "skill");
  assert.equal(compiler.compile(9).actions[0].damageType, "holy");
  assert.equal(compiler.compile(20).actions[0].damageType, "punishment");
  assert.deepEqual(compiler.issues, []);
});

test("source healing power, target buffs, extra casts and cleansing compile without inventing buff IDs", () => {
  const rows = { Skill: {
    1: { skillType: 1, skillgroup: 10, targetCamp: 2, firstSelector: [300, 1], frameKey: "[key:0_action:[healAction,7000,1]]" },
    2: { skillType: 2, skillgroup: 20, targetCamp: 1, frameKey: "[key:0_action:[addBuffAction,9,1]]" },
    3: { skillType: 8, skillgroup: 30, targetCamp: 2, frameKey: "[key:1_action:[healAction,31500,5]]" },
    4: { skillType: 3, triggerActions: "[skillHealBonusAction,10,1,10000,3_9_1_0,1_10000]|[skillCastSkillAction,20,1,10000,null,6]" },
    5: { skillType: 3, triggerActions: "[skillRemoveBuffAction,30,1,10000,null,2_99_1]" },
    6: { skillType: 1, targetCamp: 2, firstSelector: [300, 3], frameKey: "[key:0_action:[healAction,14000,3]]", skillTagActions: "[blockUltraEnegyTag]" },
  }, Buff: { 9: { id: 9, group: 9, duration: 3000, effects: "[addTargetAction,10,2]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  const hero = { id: 7, attack: "1_0", skill1: "2_0", skill2: "3_0", skill5: "4_0;5_0" };
  const result = compiler.heroSkills(hero, 12);
  assert.deepEqual(compiler.definitions.get(1).actions[0].healingBonuses[0], { conditions: { requiredState: "9" }, chance: 1, powerBonus: 1 });
  assert.deepEqual(compiler.definitions.get(2).actions[0].status.targetCountBonuses, { "10": 2 });
  assert.equal(compiler.definitions.get(2).onRelease[0].skillId, "reference_skill_6");
  assert.equal(result.ids.includes("reference_skill_6"), false);
  assert.equal(compiler.definitions.get(3).actions[0].cleanse.npcOnly, true);
  const before = JSON.stringify([...compiler.definitions.values()]); compiler.heroSkills(hero, 12);
  assert.equal(JSON.stringify([...compiler.definitions.values()]), before);
});

test("source bonus choice modes and absent-status conditions retain their meaning", () => {
  const rows = { Skill: { 1: { skillType: 2, skillgroup: 10, targetCamp: 2, frameKey: "[key:0_action:[healAction,10000]]" },
    2: { skillType: 3, triggerActions: "[skillHealBonusAction,10,2,10000,3_9_2_0,3_7_1_8_3]|[skillHealBonusAction,10,2,10000,3_9_1_0,2_7_1_8_1]" } },
    Buff: { 7: { duration: 1000, effects: "[changeAttrAction,atkRate,1000]" }, 8: { duration: 1000, effects: "[changeAttrAction,atkRate,-1000]", dispel: -1 } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  compiler.heroSkills({ id: 5, skill1: "1_0", skill5: "2_0" }, 12);
  const bonuses = compiler.definitions.get(1).actions[0].healingBonuses;
  assert.deepEqual(bonuses[0].conditions, { excludedState: "9" }); assert.equal(bonuses[0].selection, "weighted");
  assert.equal(bonuses[0].statuses[1].weight, 3); assert.equal(bonuses[1].selection, "all");
  assert.equal(bonuses[0].statuses[1].status.harmful, true); assert.equal(bonuses[0].statuses[1].status.dispellable, false);
});
