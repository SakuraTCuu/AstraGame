import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem } from "../assets/scripts/core/index.ts";
import { tableRow } from "./reference-cache.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const tables = JSON.parse(readFileSync("reference-private/reference-tables.json", "utf8"));
const buffRow = (id) => {
  const table = Object.entries(tables).find(([name, data]) => /^Buff(?:_(?:\d+|Xs))?$/.test(name) && data[id])?.[1];
  return table && tableRow(table, id);
};
const compileBuff = (id) => createReferenceSkillCompiler((family, key) => family === "Buff" ? buffRow(key) : {
  skillType: 2, firstSelector: [50, 1], frameKey: `[key:0_action:[addBuffAction,${id}]]`,
}).compile(1).actions[0].status;
const stats = { maxHealth: 1000, attack: 0, defense: 0, moveSpeed: 100, attackRange: 10, aggroRange: 50 };
const source = new Actor({ id: "npc", faction: "enemy", position: { x: 0, y: 0 }, stats });
const target = new Actor({ id: "hero", faction: "player", position: { x: 10, y: 0 }, stats });
const actors = [source, target], combat = new CombatSystem(), reports = [];
const advance = (seconds) => { for (let time = 0; time < seconds - 1e-9; time += 0.05) combat.update(0.05, actors); };
const apply = (status) => {
  combat.cancelCaster(source.id);
  assert.equal(combat.use(source, target, { id: status.id, range: 50, target: "enemy", cooldown: 0, power: 0,
    actions: [{ at: 0, type: "status", status }] }, actors), true);
};
const frozen = compileBuff(203);
assert.equal(frozen.states[0].duration, 0.75); assert.deepEqual(frozen.blockedByStates, ["unForzen"]);
apply(frozen); assert.equal(target.canMove, false); assert.equal(target.fsm.state, "controlled");
advance(0.7); assert.equal(target.hardControlled, true); advance(0.05); assert.equal(target.hardControlled, false);
reports.push({ phase: "source_freeze", stateSeconds: 0.75, resumed: target.canMove });
const launch = config.skills.definitions.flatMap((skill) => skill.actions || []).find((action) => action.status?.id === "reference_buff_103705").status;
assert.equal(launch.duration, 1); assert.equal(launch.states[0].duration, 2);
apply(launch); advance(1.05);
assert.equal(target.hasStatus(launch.id), false); assert.equal(target.hasControl("airborne"), true);
reports.push({ phase: "source_airborne", buffExpired: true, remainingState: target.controlSnapshots()[0].remaining });
assert.deepEqual(target.cleanse(1, true, () => 0), [launch.id]); combat.update(0, actors);
assert.equal(target.canMove, true); assert.equal(target.fsm.state, "idle");
target.addStatus(compileBuff(1702), target);
for (const id of ["ignoreExtrude", "unForceMove", "holdRecover", "ignoreControl"]) assert.equal(target.hasStatus(id), true);
apply(frozen); assert.equal(target.controlled, false); assert.equal(target.displacementImmune, true);
const before = target.position;
combat.cancelCaster(source.id);
combat.use(source, target, { id: "push", target: "enemy", range: 50, cooldown: 0, power: 0,
  actions: [{ at: 0, type: "damage", power: 0, knockback: { distance: 100, duration: 0.3 } }] }, actors);
advance(0.5); assert.deepEqual(target.position, before);
reports.push({ phase: "source_immunity", states: target.stateSnapshots().map((state) => state.id), controls: target.controlSnapshots(), moved: false });
target.recoverAt(target.position); assert.deepEqual(target.stateSnapshots(), []);
console.log(JSON.stringify({ setup: "Actual cached Buff rows and staged source hero-37 control against stationary fixture actors; source animation trajectories and live immunity interactions remain unmeasured", reports }, null, 2));
