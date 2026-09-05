import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, selectNearestTarget } from "../assets/scripts/core/index.ts";
import { tableRow } from "./reference-cache.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const tables = JSON.parse(readFileSync("reference-private/reference-tables.json", "utf8"));
const buff = (id) => createReferenceSkillCompiler((family, key) => {
  if (family === "Skill") return { skillType: 2, frameKey: `[key:0_action:[addBuffAction,${id}]]` };
  const table = Object.entries(tables).find(([name, data]) => /^Buff(?:_(?:\d+|Xs))?$/.test(name) && data[key])?.[1];
  return table && tableRow(table, key);
}).compile(1).actions[0].status;
const stats = { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 50, aggroRange: 50 };
const source = new Actor({ id: "npc", faction: "enemy", position: { x: 0, y: 0 }, stats });
const target = new Actor({ id: "hero", faction: "player", position: { x: 10, y: 0 }, stats });
const combat = new CombatSystem(), reports = [];
target.addStatus(buff(510031), source); target.addShield("probe", 50, 10);
combat.use(source, target, { id: "strike", target: "enemy", range: 50, cooldown: 0, power: 1 });
assert.equal(target.health, 1000); assert.equal(target.shield, 50); assert.ok(combat.events.some((event) => event.immune));
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
console.log(JSON.stringify({ setup: "Actual cached defensive-state rows and staged map armor Buffs on fixture actors; enclosing skills, damage formulas and live interactions remain separate checks", reports }, null, 2));
