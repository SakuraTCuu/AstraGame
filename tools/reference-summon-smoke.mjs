import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tableRow } from "./reference-cache.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";
import { DemoSession } from "../assets/scripts/core/demo/DemoSession.ts";

const tables = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/tables.json", "utf8"));
const profile = JSON.parse(readFileSync(process.argv[3] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const audit = JSON.parse(readFileSync(process.argv[4] || "build/web-mobile/reference-preview/audit.json", "utf8"));
const families = new Map();
for (const [name, table] of Object.entries(tables)) {
  const family = name.match(/^(Skill|Summon)(?:_(?:\d+|Xs))?$/)?.[1];
  if (!family) continue;
  if (!families.has(family)) families.set(family, new Map());
  for (const id of Object.keys(table)) if (id !== "__KEY_MAP__") families.get(family).set(id, table);
}
const lookup = (family, id) => {
  const table = families.get(family)?.get(String(id));
  return table ? tableRow(table, id) : null;
};
const compiler = createReferenceSkillCompiler(lookup);
const skill = compiler.compile(5001603, 12);
assert.equal(skill.type, "summon");
assert.deepEqual(skill.actions.map((action) => action.summon.enemyId), [
  ...Array(5).fill("reference_summon_1601"), ...Array(5).fill("reference_summon_1602"),
]);
assert.deepEqual(skill.actions.map((action) => action.summon.offset), [
  { x: -58, y: -36 }, { x: -28, y: -36 }, { x: 28, y: -36 }, { x: 58, y: -36 }, { x: -58, y: -16 },
  { x: -28, y: -16 }, { x: 28, y: -16 }, { x: 58, y: -16 }, { x: -88, y: -26 }, { x: 88, y: -26 },
]);
for (const id of [1601, 1602]) {
  const summon = lookup("Summon", id);
  assert.deepEqual(summon.inherit, { atk: 1700, def: 10000, maxhp: 500 });
  assert.equal(summon.goDieWithMaster, 0); assert.equal(summon.tagAction, "[backHomeRemoveTag]");
  assert.ok(compiler.compile(Number(summon.skill), 12).actions.length > 0);
}
assert.equal(compiler.issues.some((issue) => issue.id === "5001603" && ["action", "no_direct_actions"].includes(issue.kind)), false);
const generated = profile.skills.definitions.find((entry) => entry.sourceId === 5001603);
assert.deepEqual(generated.actions, skill.actions);
assert.deepEqual(audit.skillIssues.filter((issue) => issue.id === "5001603").map((issue) => issue.kind), ["summon_parity"]);
assert.match(audit.skillIssues.find((issue) => issue.id === "5001603").value, /stats.*rounded down.*offsets.*return timing.*501608/);
assert.deepEqual(profile.enemies.filter((entry) => /^reference_summon_160[12]$/.test(entry.id)).map((entry) => ({
  id: entry.id, skillIds: entry.skillIds, inheritance: entry.summonInheritance,
})), [
  { id: "reference_summon_1601", skillIds: ["reference_skill_5001608"], inheritance: { attack: 0.17, defense: 1, maxHealth: 0.05 } },
  { id: "reference_summon_1602", skillIds: ["reference_skill_5001609"], inheritance: { attack: 0.17, defense: 1, maxHealth: 0.05 } },
]);
new DemoSession(profile);
console.log(JSON.stringify({ skill: skill.id, summons: skill.actions.length, templates: [1601, 1602], lifetime: 10,
  childSkills: ["reference_skill_5001608", "reference_skill_5001609"] }, null, 2));
