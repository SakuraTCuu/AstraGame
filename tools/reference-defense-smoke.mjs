import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, selectNearestTarget } from "../assets/scripts/core/index.ts";
import { tableRow } from "./reference-cache.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const tables = JSON.parse(readFileSync(process.argv[3] || "build/web-mobile/reference-preview/tables.json", "utf8"));
const families = new Map();
for (const [name, table] of Object.entries(tables)) {
  const family = name.match(/^(Hero|Avatar|Skill|Buff)(?:_(?:\d+|Xs))?$/)?.[1];
  if (!family) continue;
  if (!families.has(family)) families.set(family, new Map());
  for (const id of Object.keys(table)) if (id !== "__KEY_MAP__") families.get(family).set(id, table);
}
const row = (family, id) => {
  const table = families.get(family)?.get(String(id));
  return table ? tableRow(table, id) : null;
};
const buff = (id) => createReferenceSkillCompiler((family, key) => family === "Skill" ?
  { skillType: 2, frameKey: `[key:0_action:[addBuffAction,${id}]]` } : row(family, key)).compile(1).actions[0].status;
const compiler = createReferenceSkillCompiler(row);
const hero8 = row("Hero", 8), hero11 = row("Hero", 11), hero15 = row("Hero", 15), hero31 = row("Hero", 31);
compiler.heroSkills(hero8, row("Avatar", hero8.display)?.fps || 12);
compiler.heroSkills(hero11, row("Avatar", hero11.display)?.fps || 12);
compiler.heroSkills(hero15, row("Avatar", hero15.display)?.fps || 12);
compiler.heroSkills(hero31, row("Avatar", hero31.display)?.fps || 12);

const swordFan = compiler.definitions.get(10080101);
assert.equal(swordFan.type, "damage"); assert.ok(swordFan.actions.some((action) => action.type === "damage"));
assert.equal(swordFan.actions.some((action) => action.status?.id === "reference_buff_100806"), false);
assert.ok(compiler.issues.some((issue) => issue.id === "10080101" && issue.kind === "sword_fan_timing"));
assert.ok(compiler.issues.some((issue) => issue.id === "10080101" && issue.kind === "no_direct_actions"));

const ultimate = compiler.definitions.get(10110101);
const selfBuff = ultimate.actions.find((action) => action.type === "status" && action.recipient === "self");
assert.deepEqual(selfBuff.status.modifiers, { damageReduction: 0.1, defenseRate: 0.1 });
assert.equal(selfBuff.status.duration, 5);

const caster = new Actor({ id: "hero11", faction: "player", position: { x: 0, y: 0 }, initialEnergy: 10000,
  stats: { maxHealth: 1000, attack: 100, defense: 100, moveSpeed: 0, attackRange: 100, aggroRange: 100, maxEnergy: 10000 } });
const enemy = new Actor({ id: "enemy", faction: "enemy", position: { x: 1, y: 0 },
  stats: { maxHealth: 1000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
caster.targetId = enemy.id;
const combat = new CombatSystem();
assert.equal(combat.use(caster, caster, ultimate, [caster, enemy]), true);
assert.equal(caster.energy, 0); assert.ok(Math.abs(caster.defensePower - 110) < 1e-9); assert.equal(caster.receiveDamage(200), 81);
caster.gainEnergy(10000);
combat.update(1, [caster, enemy]);
assert.equal(combat.canUse(caster, ultimate), false);
combat.update(4, [caster, enemy]);
assert.equal(caster.defensePower, 100); assert.equal(caster.hasStatus("reference_buff_101111"), false);
combat.update(10, [caster, enemy]);
assert.equal(combat.canUse(caster, ultimate), true);

const transform = compiler.definitions.get(10150101);
const healthBuff = transform.actions.find((action) => action.type === "status" && action.recipient === "self");
assert.equal(healthBuff.status.duration, 5); assert.deepEqual(healthBuff.status.modifiers, { maxHealthRate: 0.1 });
const transformed = new Actor({ id: "hero15", faction: "player", position: { x: 0, y: 0 }, initialEnergy: 10000, initialHealth: 500,
  stats: { maxHealth: 1000, attack: 100, defense: 100, moveSpeed: 0, attackRange: 100, aggroRange: 100, maxEnergy: 10000 } });
transformed.targetId = enemy.id;
const transformCombat = new CombatSystem();
assert.equal(transformCombat.use(transformed, enemy, transform, [transformed, enemy]), true);
assert.equal(transformed.stats.maxHealth, 1100); assert.equal(transformed.health, 550);
transformCombat.update(5, [transformed, enemy]);
assert.equal(transformed.stats.maxHealth, 1000); assert.equal(transformed.health, 500);
assert.ok(compiler.issues.some((issue) => issue.id === "10150101" && issue.kind === "action" && issue.value[0] === "transformAction"));
assert.ok(compiler.issues.some((issue) => issue.id === "15" && issue.kind === "passive" && issue.value[0] === "rateBlockDmgAction"));

const charge = compiler.definitions.get(10310201);
const vulnerability = charge.actions.find((action) => action.status?.id === "reference_buff_103124").status;
assert.equal(vulnerability.modifiers.physicalReduction, -0.2);
assert.equal(vulnerability.duration, 8);
assert.ok(compiler.issues.some((issue) => issue.id === "103124" && issue.kind === "buff_duration_parity"));
const physical = new Actor({ id: "physical", faction: "enemy", position: { x: 0, y: 0 },
  stats: { maxHealth: 1000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
const magic = new Actor({ id: "magic", faction: "enemy", position: { x: 0, y: 0 },
  stats: { maxHealth: 1000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
physical.addStatus(vulnerability); magic.addStatus(vulnerability);
assert.equal(physical.receiveDamage(100, "physical"), 120);
assert.equal(magic.receiveDamage(100, "magic"), 100);
const unconfirmedCompiler = createReferenceSkillCompiler((family, id) => family === "Skill" ?
  { skillType: 2, frameKey: "[key:0_action:[addBuffAction,300601,0]]" } : row(family, id));
const unconfirmed = unconfirmedCompiler.compile(1).actions[0].status;
assert.equal(unconfirmed.modifiers.physicalReduction, undefined);
assert.ok(unconfirmedCompiler.issues.some((issue) => issue.id === "300601" && issue.kind === "modifier"));

const baseStats = { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 50, aggroRange: 50 };
const source = new Actor({ id: "npc", faction: "enemy", position: { x: 0, y: 0 }, stats: baseStats });
const target = new Actor({ id: "hero", faction: "player", position: { x: 10, y: 0 }, stats: baseStats });
const defensiveCombat = new CombatSystem(), reports = [];
target.addStatus(buff(510031), source); target.addShield("probe", 50, 10);
defensiveCombat.use(source, target, { id: "strike", target: "enemy", range: 50, cooldown: 0, power: 1 });
assert.equal(target.health, 1000); assert.equal(target.shield, 50); assert.ok(defensiveCombat.events.some((event) => event.immune));
reports.push({ phase: "source_invulnerability", hp: target.health, shield: target.shield, feedback: true });
target.updateEffects(4); assert.equal(target.invulnerable, false); assert.equal(target.receiveDamage(100), 50);
target.recoverAt(target.position); target.addStatus(buff(1755), source);
target.receiveDamage(10000); assert.equal(target.health, 1); target.updateEffects(30); assert.equal(target.preventsDeath, true);
target.removeState("notDead"); target.receiveDamage(1); assert.equal(target.alive, false);
reports.push({ phase: "source_death_protection", hpFloor: 1, permanent: true, removable: true });
target.recoverAt(target.position); target.addStatus(buff(1705), source);
assert.equal(selectNearestTarget(source, [target], 50), undefined); target.removeState("unselected"); assert.equal(selectNearestTarget(source, [target], 50), target);
reports.push({ phase: "source_untargetable", excluded: true, restored: true });
for (const id of [504401, 501301]) {
  target.recoverAt(target.position);
  const status = config.skills.definitions.flatMap((skill) => skill.actions || []).find((action) => action.status?.id === `reference_buff_${id}`).status;
  target.addStatus(status, source); assert.equal(target.receiveDamage(500), 1);
  const seconds = status.states.find((state) => state.damageCap === 1).duration;
  target.updateEffects(seconds); assert.equal(target.incomingDamageCap, Infinity); assert.equal(target.receiveDamage(100), 100);
  reports.push({ phase: "source_armor", id, stateSeconds: seconds, buffRemains: target.hasStatus(status.id), cappedDamage: 1, uncappedDamage: 100 });
}
target.recoverAt(target.position); target.health = 100; target.addStatus(buff(37207100), source);
assert.equal(target.heal(50), 0); target.removeState("unHeal"); assert.equal(target.heal(50), 50);
reports.push({ phase: "source_healing_prohibition", blocked: true, restored: true });

console.log(JSON.stringify({
  hero8: { skill: swordFan.id, projectileDamagePreserved: true, noNoopStatus: true, sourceTimingAudited: true },
  hero11: { skill: ultimate.id, energyCost: ultimate.energyCost, cooldown: ultimate.cooldown, buff: selfBuff.status.id,
    duration: selfBuff.status.duration, defenseRate: selfBuff.status.modifiers.defenseRate, damageReduction: selfBuff.status.modifiers.damageReduction },
  hero15: { skill: transform.id, buff: healthBuff.status.id, duration: healthBuff.status.duration,
    maxHealthRate: healthBuff.status.modifiers.maxHealthRate, healthRatioPreserved: true, transformAndBlockRateAudited: true },
  hero31: { skill: charge.id, buff: vulnerability.id, physicalReduction: vulnerability.modifiers.physicalReduction,
    sourceDuration: vulnerability.duration, describedDuration: 5, durationConflictAudited: true, physicalDamage: 120, magicDamage: 100,
    unconfirmed300601RemainsAudited: true },
  setup: "Actual staged source tables and profile definitions on fixture actors; transform visuals, damage immunity, lifesteal and broader damage formulas remain separate parity work",
  reports,
}, null, 2));
