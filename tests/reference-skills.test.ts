import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceSkillCompiler, hasExecutableSkillBehavior, heroSkillAtStar, skillFrames, skillTuple } from "../tools/reference-skills.mjs";

test("frame expressions preserve action order, frame timing and damage types", () => {
  const frames = skillFrames("[key:2_action:[damageAction,6000]_dmgType:[2]]&[key:4_action:[damageAction,6000]|[addBuffAction,9,1]]");
  assert.equal(frames.length, 2);
  assert.equal(frames[0].frame, 2);
  assert.equal(frames[0].damageType, 2);
  assert.deepEqual(frames[1].actions, [["damageAction", 6000], ["addBuffAction", 9, 1]]);
  assert.deepEqual(skillTuple("[box,200,600]"), ["box", 200, 600]);
  assert.throws(() => skillFrames("[key:2_action:[damageAction,1]"), /Unbalanced|Invalid/);
});

test("first-map Boss 5001603 preserves its ordered fixed summon contract", () => {
  const source = { name: "summon army", skillType: 2, firstSelector: [100, 1], preTime: 100, postTime: 1000,
    useCond: "[castHpRateCond,5000,1]", presentationIds: "[50016,skill2]",
    skillTagActions: "[damageTag]|[summonOffsetTag,-58_-36,-28_-36,28_-36,58_-36,-58_-16,-28_-16,28_-16,58_-16,-88_-26,88_-26]",
    frameKey: Array.from({ length: 10 }, (_, index) => `[key:5_action:[summonAction,${index < 5 ? 1601 : 1602},10000,501608]]`).join("&") };
  const compiler = createReferenceSkillCompiler((family, id) => family === "Skill" && id === 5001603 ? source : null);
  const skill = compiler.compile(5001603, 12);
  assert.equal(skill.type, "summon"); assert.equal(skill.disabled, undefined); assert.equal(skill.actions.length, 10);
  assert.deepEqual(skill.actions.map((action) => action.summon.enemyId), [
    ...Array(5).fill("reference_summon_1601"), ...Array(5).fill("reference_summon_1602"),
  ]);
  assert.deepEqual(skill.actions.map((action) => action.summon.offset), [
    { x: -58, y: -36 }, { x: -28, y: -36 }, { x: 28, y: -36 }, { x: 58, y: -36 }, { x: -58, y: -16 },
    { x: -28, y: -16 }, { x: 28, y: -16 }, { x: 58, y: -16 }, { x: -88, y: -26 }, { x: 88, y: -26 },
  ]);
  for (const action of skill.actions) assert.deepEqual({ expiresAfter: action.summon.expiresAfter,
    removeWithOwner: action.summon.removeWithOwner, removeOnReturn: action.summon.removeOnReturn },
    { expiresAfter: 10, removeWithOwner: false, removeOnReturn: true });
  assert.equal(compiler.issues.some((issue) => issue.id === "5001603" && ["action", "no_direct_actions"].includes(issue.kind)), false);
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

test("hero 12's four-operand area repel compiles as an inward impact-anchored displacement", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, firstSelector: [300, 5], preTime: 400, postTime: 1333,
    selectShape: "[circle,40,1]", skillTagActions: "[lockProTag,700,5000,1,1]|[sceneSpriteDmgTimesTag,1]", projectEffect: "[104504]",
    projectKey: "[key:0_action:[sceneSpriteAction,2000,410,circle,300,104505,-1]]",
    sceneSpriteActions: "[key:10_action:[damageAction,12000,5]_dmgType:[3]|[repelAction,600,350,1]]" }));
  const skill = compiler.compile(10120501, 12);
  const effect = skill.actions[0].areaEffect.effects[0];
  assert.deepEqual(effect.displacement, { duration: 0.6, distance: 350, direction: "toward", anchor: "impact" });
  assert.equal(effect.knockback, undefined);
  assert.equal(skill.disabled, undefined);
  assert.ok(compiler.issues.some((issue) => issue.kind === "inward_displacement_parity"));
  assert.equal(compiler.issues.some((issue) => issue.kind === "action" && issue.value[0] === "repelAction"), false);
});

test("generated actionless skills remain audited but are explicitly disabled", () => {
  const rows = {
    10120201: { name: "gravity proxy", skillType: 2, firstSelector: [50, 1], postTime: 100 },
    10110101: { name: "unsupported transform", skillType: 8, frameKey: "[key:0_action:[transformAction,1111,5000]]", skillTagActions: "[castCostTag,ultraEnegy,10000]" },
    2: { name: "metadata only", skillType: 2, firstSelector: [300, 5], selectShape: "[circle,300]", projectEffect: "[7]", skillTagActions: "[lockProTag,700,5000,1,1]" },
    1: { name: "supported", skillType: 1, frameKey: "[key:0_action:[damageAction,10000]]" },
  };
  const compiler = createReferenceSkillCompiler((family, id) => family === "Skill" ? rows[id] : undefined);
  const proxy = compiler.compile(10120201), transform = compiler.compile(10110101), metadata = compiler.compile(2), supported = compiler.compile(1);
  assert.equal(proxy.disabled, true); assert.equal(transform.disabled, true); assert.equal(metadata.disabled, true); assert.equal(supported.disabled, undefined);
  assert.equal(hasExecutableSkillBehavior(metadata), false); assert.equal(hasExecutableSkillBehavior(supported), true);
  assert.equal(proxy.actions.length, 0); assert.equal(transform.actions.length, 0);
  assert.deepEqual(compiler.issues.filter((issue) => issue.kind === "no_direct_actions").map((issue) => issue.id), ["10120201", "10110101", "2"]);
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
  assert.deepEqual(skill.actions[0].status.states, [{ id: "ready", duration: 3 }]);
});

test("hero 11's confirmed ultimate passive attaches its timed self defense buff", () => {
  const rows = { Skill: {
    10110101: { skillType: 8, skillgroup: 101101, targetCamp: 1, cd: 15000, publicCd: 1000, publicCdGroup: 1,
      skillTagActions: "[castCostTag,ultraEnegy,10000]", frameKey: "[key:5_action:[transformAction,1111,5000]]" },
    10110601: { skillType: 3, triggerActions: "[skillAddBuffAction,101101,2,10000,null,1,101111_1]" },
    10110602: { skillType: 3, triggerActions: "[skillAddBuffAction,101101,2,9999,null,1,101111_1]" },
  }, Buff: { 101111: { duration: 5000, group: 101111,
    effects: "[changeAttrAction,damageReduction,1000]|[changeAttrAction,defRate,1000]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  compiler.heroSkills({ id: 11, skill2: "10110101_0", skill5: "10110601_0" }, 12);
  const ultimate = compiler.definitions.get(10110101);
  assert.equal(ultimate.energyCost, 10000); assert.equal(ultimate.cooldown, 15); assert.equal(ultimate.publicCooldown, 1);
  assert.deepEqual(ultimate.actions[0], { at: 0, type: "status", recipient: "self", status: {
    id: "reference_buff_101111", group: "101111", duration: 5, permanent: false, maxStacks: 1,
    modifiers: { damageReduction: 0.1, defenseRate: 0.1 }, dispellable: true, harmful: false } });

  const other = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  other.heroSkills({ id: 11, skill2: "10110101_0", skill5: "10110602_0" }, 12);
  assert.equal(other.definitions.get(10110101).actions.some((action) => action.type === "status"), false);
  assert.ok(other.issues.some((issue) => issue.kind === "passive_buff"));
});

test("the same strict self-buff tuple supports hero 15 without consuming unrelated passive actions", () => {
  const rows = { Skill: {
    10150101: { skillType: 8, skillgroup: 101501, targetCamp: 2, frameKey: "[key:5_action:[transformAction,1151,5000]]" },
    10150501: { skillType: 3, triggerActions: "[rateBlockDmgAction,1500,1]|[skillAddBuffAction,101501,2,10000,null,1,101511_1]" },
  }, Buff: { 101511: { duration: 5000, group: 101511, effects: "[changeAttrAction,maxhpRate,1000]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  compiler.heroSkills({ id: 15, skill2: "10150101_0", skill5: "10150501_0" }, 12);
  const ultimate = compiler.definitions.get(10150101);
  assert.equal(ultimate.actions[0].recipient, "self");
  assert.equal(ultimate.actions[0].status.duration, 5);
  assert.equal(ultimate.actions[0].status.modifiers.maxHealthRate, 0.1);
  assert.ok(compiler.issues.some((issue) => issue.kind === "action" && issue.value[0] === "transformAction"));
  assert.ok(compiler.issues.some((issue) => issue.kind === "passive" && issue.value[0] === "rateBlockDmgAction"));
});

test("hero 8's sword-fan Buff remains a projectile conversion instead of a no-op status", () => {
  const rows = { Skill: {
    10080101: { skillType: 8, skillgroup: 100801, firstSelector: [300, 4] },
    10080601: { skillType: 3, triggerActions: "[skillAddBuffAction,100801,2,10000,null,1,100806_1]" },
    10080701: { skillType: 2, frameKey: "[key:1_action:[damageAction,28000]_dmgType:[2]]" },
  }, Buff: { 100806: { duration: 2000, effects: "[tickZXFlySwordAction,100,10080701,3,100]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  compiler.heroSkills({ id: 8, skill2: "10080101_0", skill5: "10080601_0" }, 12);
  const ultimate = compiler.definitions.get(10080101);
  assert.equal(ultimate.type, "damage"); assert.equal(ultimate.actions[0].type, "damage");
  assert.equal(ultimate.actions.some((action) => action.type === "status"), false);
  assert.ok(compiler.issues.some((issue) => issue.id === "10080101" && issue.kind === "sword_fan_timing"));
  assert.ok(compiler.issues.some((issue) => issue.id === "10080101" && issue.kind === "no_direct_actions"));
});

test("physical vulnerability maps to a negative incoming physical reduction", () => {
  const rows = { Skill: { 1: { skillType: 2, frameKey: "[key:0_action:[targetBuffAction,1,0,103124]]" } },
    Buff: { 103124: { duration: 8000, effects: "[changeAttrAction,RevertDmgTypeBonus3,-2000]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  assert.equal(compiler.compile(1).actions[0].status.modifiers.physicalReduction, -0.2);
  assert.deepEqual(compiler.issues.map((issue) => issue.kind), ["buff_duration_parity", "target_buff_parity"]);
});

test("unconfirmed RevertDmgTypeBonus3 rows remain audited rather than sharing hero 31's sign", () => {
  const rows = { Skill: { 1: { skillType: 2, frameKey: "[key:0_action:[addBuffAction,300601,0]]" } },
    Buff: { 300601: { duration: 6000, effects: "[changeAttrAction,RevertDmgTypeBonus3,1500]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]);
  const status = compiler.compile(1).actions[0].status;
  assert.equal(status.modifiers.physicalReduction, undefined);
  assert.ok(compiler.issues.some((issue) => issue.id === "300601" && issue.kind === "modifier"));
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
