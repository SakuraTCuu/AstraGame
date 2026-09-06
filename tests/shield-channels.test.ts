import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, EnemyAI } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/index.ts";
import type { StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "enemy" | "player", x = 0, hp = 1000) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: hp, attack: 100, defense: 0, moveSpeed: 0, attackRange: 100, aggroRange: 100 } });
const shield: StatusDefinition = { id: "ice_shield", duration: 4, shields: [{ basis: "max_health", amount: 0.2, duration: 4,
  healthCostFraction: 0.2, breakState: "chantBroken", interruptOnBreak: true }] };
const channel: SkillDefinition = { id: "channel", target: "enemy", range: 100, power: 0, cooldown: 0, windup: 1, castDuration: 5,
  conditions: { hasShield: true, excludedState: "chantBroken" }, maintainConditions: { hasShield: true },
  warnings: [{ start: 0, end: 1, anchor: "target", geometry: { shape: "circle", radius: 1 } },
    { start: 2, end: 3, anchor: "target", geometry: { shape: "circle", radius: 1 } }],
  actions: [{ at: 1, type: "damage", power: 1, warningIndex: 0 }, { at: 3, type: "damage", power: 1, warningIndex: 1 }] };

test("shield conversion spends health once, preserves conversion ratio and respects blocked Buffs", () => {
  const target = actor("target", "player", 0, 638), convert = { ...shield, shields: [{ ...shield.shields![0], amount: 0.36, healthCostFraction: 0.18 }] };
  target.addStatus(convert); assert.equal(target.health, 524); assert.equal(target.shield, 228);
  target.recoverAt(target.position); target.health = 50; target.addStatus(convert); assert.equal(target.health, 1); assert.equal(target.shield, 98);
  target.recoverAt(target.position); target.addStatus({ id: "blocked", duration: 5 });
  assert.equal(target.addStatus({ ...convert, blockedByStates: ["blocked"] }), false); assert.equal(target.health, 638); assert.equal(target.shield, 0);
});

test("health-based and flat shields retain their independent lifetimes and replacement keys", () => {
  const target = actor("target", "player"); target.addStatus({ id: "mixed", duration: 0.2,
    shields: [{ basis: "flat", amount: 40, duration: 1 }, { basis: "max_health", amount: 0.1, duration: 2 }] });
  assert.equal(target.shield, 140); target.updateEffects(0.5); assert.equal(target.shield, 140);
  target.updateEffects(0.5); assert.equal(target.shield, 100); target.updateEffects(1); assert.equal(target.shield, 0); assert.equal(target.hasStatus("chantBroken"), false);
});

test("shield depletion cancels future channel hits immediately and emits its break state only once", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 10), combat = new CombatSystem();
  assert.equal(combat.use(source, target, channel, [source, target]), false); source.addStatus(shield);
  assert.equal(combat.use(source, target, channel, [source, target]), true); combat.update(1, [source, target]); assert.equal(target.health, 900);
  combat.use(target, source, { id: "break", target: "enemy", range: 100, cooldown: 0, power: 2 }, [source, target]);
  assert.equal(source.shield, 0); assert.equal(source.health, 800); assert.equal(source.shieldBreakVersion, 1); assert.equal(source.hasStatus("chantBroken"), true);
  assert.equal(combat.castSnapshots().filter((cast) => cast.sourceId === source.id).length, 0);
  combat.update(3, [source, target]); assert.equal(target.health, 900); assert.equal(source.shieldBreakVersion, 1);
  source.removeState("chantBroken"); assert.equal(source.hasStatus("chantBroken"), false);
});

test("natural shield expiry stops maintained casting without creating a break state", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 10), combat = new CombatSystem();
  source.addStatus({ ...shield, shields: [{ ...shield.shields![0], duration: 0.5 }] });
  combat.use(source, target, channel, [source, target]); combat.update(0.5, [source, target]);
  assert.equal(source.shield, 0); assert.equal(source.hasStatus("chantBroken"), false); assert.equal(combat.castSnapshots().length, 0);
  combat.update(3, [source, target]); assert.equal(target.health, 1000);
});

test("broken-shield state enables the configured self-stun follow-up and is consumed", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 10), combat = new CombatSystem();
  source.addStatus(shield); source.receiveDamage(200); combat.update(0, [source, target]);
  const follow: SkillDefinition = { id: "broken", target: "self", range: 100, cooldown: 10, power: 0, conditions: { requiredState: "chantBroken" },
    actions: [{ at: 0, type: "remove_state", recipient: "self", stateId: "chantBroken" },
      { at: 0, type: "status", recipient: "self", status: { id: "stun", duration: 2, states: [{ id: "stun", duration: 2, control: "stun" }] } }] };
  new EnemyAI([follow]).update(source, [target], combat, 0.05);
  assert.equal(source.hasStatus("chantBroken"), false); assert.equal(source.hasControl("stun"), true);
  combat.update(2, [source, target]); assert.equal(source.hasControl("stun"), false); assert.equal(source.fsm.state, "idle");
});

test("separate direction groups choose unique sectors in every delayed wave", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 10), combat = new CombatSystem(() => 0);
  const definition: SkillDefinition = { ...channel, conditions: undefined, maintainConditions: undefined, warnings: [0, 1, 2, 3].map((index) => ({
    start: Math.floor(index / 2) * 2, end: Math.floor(index / 2) * 2 + 1, anchor: "caster", geometry: { shape: "cone", radius: 20, angleDegrees: 90 },
    directionAngles: [0, 90, 180, 270], directionGroup: String(Math.floor(index / 2)) })) };
  combat.use(source, target, definition, [source, target]);
  assert.deepEqual(combat.castSnapshots()[0].warnings!.map((mark) => [Math.round(mark.direction.x), Math.round(mark.direction.y)]), [[1, 0], [0, 1]]);
  combat.update(2, [source, target]);
  assert.deepEqual(combat.castSnapshots()[0].warnings!.map((mark) => [Math.round(mark.direction.x), Math.round(mark.direction.y)]), [[1, 0], [0, 1]]);
});

test("source shield modes and sector loops compile to health conversion, gated waves and independent areas", () => {
  const rows = { 1: { skillType: 2, frameKey: "[key:0_action:[addBuffAction,10,1]]" }, 2: { skillType: 2, firstSelector: [1000, 10],
    useCond: "[shieldCond]", skillTagActions: "[warnRandomDirTag,8]|[warnRoundForeTag,2,90,0,2]|[chantLoopTag,4,3000,3000]|[chantSkillTag]",
    skillWarn: "[2,-1,0,2000,sector1_4,1000]|[2,-1,0,2000,sector1_4,1000]",
    frameKey: "[key:0_action:[sceneSpriteAction,2500,1000,sector,800,90,20]]&[key:0_action:[sceneSpriteAction,2500,1000,sector,800,90,20]]",
    sceneSpriteActions: "[key:0_action:[damageAction,10000]]" } };
  const compiler = createReferenceSkillCompiler((family: string, id: number) => family === "Skill" ? rows[id] :
    { id, duration: 30000, effects: "[addShieldAction,5,30000,2000,2000]", buffTagActions: "[shieldBreakStopTag]" });
  assert.deepEqual(compiler.compile(1).actions[0].status.shields[0], { basis: "max_health", duration: 30, amount: 0.2, healthCostFraction: 0.2, breakState: "chantBroken", interruptOnBreak: true, clearStatesOnBreak: ["backCenter"] });
  const compiled = compiler.compile(2); assert.equal(compiled.warnings.length, 8); assert.equal(compiled.actions.length, 8);
  assert.deepEqual(compiled.actions.map((action) => action.at), [2, 2, 5, 5, 8, 8, 11, 11]); assert.deepEqual(compiled.maintainConditions, { hasShield: true });
  assert.ok(!compiler.issues.some((issue) => ["area_layout", "multiple_warnings", "chant_loop"].includes(issue.kind)));
});
