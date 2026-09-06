import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, FogGrid, GameWorld, GridNavigation, Vector2 } from "../assets/scripts/core/index.ts";
import type { SkillDefinition } from "../assets/scripts/core/index.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "player" | "enemy", x = 0, y = 0, speed = 2) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: speed, attackRange: 30, aggroRange: 30, leashRange: 50 } });
const channel: SkillDefinition = { id: "channel", target: "enemy", range: 30, cooldown: 20, power: 0, windup: 0.5, castDuration: 1,
  completionState: "finished", returnHomeOnComplete: true, actions: [{ at: 0.5, type: "damage", power: 0 }] };
const finisher: SkillDefinition = { id: "finisher", target: "enemy", range: 30, cooldown: 10, power: 0, conditions: { requiredState: "finished" },
  actions: [{ at: 0, type: "damage", power: 0, healthDamage: { basis: "maximum", fraction: 0.8 } }, { at: 0, type: "remove_state", recipient: "self", stateId: "finished" }] };

test("instant attacks retain the existing attacking state unless they have a completion action", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 1), combat = new CombatSystem();
  combat.use(source, target, { id: "instant", target: "enemy", range: 30, cooldown: 0, power: 0 }, [source, target]);
  assert.equal(source.fsm.state, "attacking");
  combat.use(source, target, { id: "marked", target: "enemy", range: 30, cooldown: 0, power: 0, completionState: "finished" }, [source, target]);
  assert.equal(source.hasStatus("finished"), true); assert.equal(source.fsm.state, "idle");
});

test("completion walks home without healing and enables a single follow-up only after arrival", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 4), combat = new CombatSystem();
  source.position = new Vector2(4, 0); source.health = 300; source.gainSkillEnergy(2);
  assert.equal(combat.use(source, target, finisher, [source, target]), false);
  combat.use(source, target, channel, [source, target]); combat.update(1, [source, target]);
  assert.equal(source.position.x, 4); assert.equal(source.hasStatus("finished"), false); assert.equal(combat.isBusy(source), true);
  combat.update(1, [source, target]); assert.equal(source.position.x, 2); assert.equal(combat.canUse(source, finisher), false);
  combat.update(1, [source, target]); assert.equal(source.position.x, 0); assert.equal(source.health, 300); assert.equal(source.skillEnergy, 2);
  assert.equal(source.hasStatus("finished"), true); assert.ok(combat.cooldownRemaining(source, channel) > 0);
  assert.equal(combat.use(source, target, finisher, [source, target]), true); assert.equal(target.health, 200); assert.equal(source.hasStatus("finished"), false);
});

test("cancelling, replacing or resetting a returning caster never grants completion", () => {
  for (const mode of ["cancel", "replace", "reset"] as const) {
    const source = actor("source", "enemy"), target = actor("target", "player", 4), combat = new CombatSystem();
    source.position = new Vector2(4, 0); combat.use(source, target, channel, [source, target]); combat.update(1, [source, target]);
    if (mode === "cancel") combat.cancelCaster(source.id); else if (mode === "reset") combat.resetEngagement();
    const actors = mode === "replace" ? [actor("source", "enemy", 4), target] : [source, target];
    combat.update(3, actors); assert.equal(source.position.x, 4); assert.equal(source.hasStatus("finished"), false); assert.equal(combat.isBusy(actors[0]), false);
  }
});

test("shield interruption suppresses both pending return and an already granted completion marker", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 4), combat = new CombatSystem();
  source.position = new Vector2(4, 0);
  source.addShield("guard", 100, 5, { interruptOnBreak: true, breakState: "broken", clearStatesOnBreak: ["finished"] });
  combat.use(source, target, channel, [source, target]); combat.update(1, [source, target]); source.receiveDamage(100); combat.update(2, [source, target]);
  assert.equal(source.position.x, 4); assert.equal(source.hasStatus("finished"), false);
  source.addStatus({ id: "completion", permanent: true, duration: -1, states: [{ id: "finished", duration: -1 }] });
  source.addShield("second", 100, 5, { clearStatesOnBreak: ["finished"] }); source.receiveDamage(100);
  assert.equal(source.hasStatus("finished"), false);
});

test("world navigation routes completed casts around obstacles without a leash reset", () => {
  const nav = new GridNavigation(12, 12), fog = new FogGrid(12, 12), source = actor("source", "enemy", 2.5, 5.5, 4), target = actor("target", "player", 9.5, 5.5, 0);
  for (let y = 3; y <= 8; y++) nav.setBlocked({ x: 5, y }, true);
  source.position = new Vector2(8.5, 5.5); source.health = 350;
  const harmless: SkillDefinition = { id: "idle", target: "enemy", range: 30, cooldown: 100, power: 0, disabled: true };
  const world = new GameWorld({ seed: 1, navigation: nav, fog, players: [target], enemies: [source], playerSkill: harmless, enemySkill: harmless });
  world.combat.use(source, target, channel, world.allActors);
  let detoured = false;
  for (let tick = 0; tick < 160 && !source.hasStatus("finished"); tick++) {
    world.update(0.05); assert.equal(nav.isWorldWalkable(source.position), true); detoured ||= Math.abs(source.position.y - 5.5) > 2;
  }
  assert.equal(source.hasStatus("finished"), true); assert.equal(detoured, true); assert.ok(source.position.distance(source.homePosition) < 0.01); assert.equal(source.health, 350);
});

test("maximum and current health damage ignore offensive scaling but retain shields and defenses", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 1), combat = new CombatSystem(() => 0);
  source.addStatus({ id: "offense", duration: 10, modifiers: { attackRate: 10, damageBonus: 10, criticalChance: 1 } });
  const rate = (basis: "maximum" | "current", fraction: number): SkillDefinition => ({ id: basis, target: "enemy", range: 30, cooldown: 0, power: 0,
    actions: [{ at: 0, type: "damage", healthDamage: { basis, fraction } }] });
  target.health = 500; target.addShield("test", 50, 5); combat.use(source, target, rate("maximum", 0.1), [source, target]);
  assert.equal(target.health, 450); assert.equal(target.shield, 0); combat.use(source, target, rate("current", 0.5), [source, target]); assert.equal(target.health, 225);
  target.addStatus({ id: "invulnerable", duration: 1, states: [{ id: "invulnerable", duration: 1, invulnerable: true }] });
  combat.use(source, target, rate("maximum", 1), [source, target]); assert.equal(target.health, 225); assert.ok(combat.events.some((event) => event.immune));
  assert.ok(combat.events.filter((event) => event.type === "damage").every((event) => !event.critical));
});

test("shield conversion heals only available HP and cooldown reset only affects named skills", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 1), combat = new CombatSystem();
  const first = { id: "first", target: "enemy" as const, range: 30, cooldown: 20, power: 0 }, second = { ...first, id: "second" };
  combat.use(source, target, first, [source, target]); combat.use(source, target, second, [source, target]);
  source.health = 900; source.addShield("guard", 200, 10, { breakState: "broken", interruptOnBreak: true });
  combat.use(source, source, { id: "convert", target: "self", range: 1, cooldown: 0, power: 0, actions: [
    { at: 0, type: "shield_to_health", recipient: "self", power: 1 }, { at: 0, type: "clear_cooldowns", recipient: "self", cooldownIds: [first.id] }] }, [source, target]);
  assert.equal(source.health, 1000); assert.equal(source.shield, 0); assert.equal(source.hasStatus("broken"), false);
  assert.equal(combat.cooldownRemaining(source, first), 0); assert.equal(combat.cooldownRemaining(source, second), 20);
});

test("cast-cycle snapshots restart windup timing for every expanded warning wave", () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 1), combat = new CombatSystem();
  const repeat: SkillDefinition = { ...channel, completionState: undefined, returnHomeOnComplete: undefined, windup: 1, castDuration: 6,
    castCycles: { count: 3, interval: 2 }, actions: [1, 3, 5].map((at) => ({ at, type: "damage", power: 0 })) };
  combat.use(source, target, repeat, [source, target]); combat.update(1.5, [source, target]); assert.equal(combat.castSnapshots()[0].phase, "active");
  combat.update(0.5, [source, target]); const next = combat.castSnapshots()[0];
  assert.equal(next.cycle, 1); assert.equal(next.phase, "windup"); assert.equal(next.remaining, 1); assert.equal(next.duration, 1); assert.equal(combat.isWindingUp(source), true);
  combat.update(1, [source, target]); assert.equal(combat.castSnapshots()[0].phase, "active");
});

test("NPC finish tags and absent-state conditions compile without gating hero skills", () => {
  const row = { skillType: 2, firstSelector: [100, 10], useCond: "[castStateCond,2,broken]", skillTagActions: "[backCenterTag]", frameKey: "[key:0_action:[rateDmgAction,1,8000]]",
    selectShape: "[circle,80]", skillWarn: "[2,-1,0,200,circle,80]" };
  const compiler = createReferenceSkillCompiler(() => row), npc = compiler.compile(1, 12, [], true);
  assert.equal(npc.conditions.excludedState, "broken"); assert.equal(npc.conditions.requiredState, "backCenter");
  assert.deepEqual(npc.actions[0].healthDamage, { basis: "maximum", fraction: 0.8 });
  assert.equal(npc.areaAnchor, "caster"); assert.equal(npc.warnings[0].anchor, "caster");
  assert.deepEqual(npc.actions.slice(1).map((action) => action.type), ["remove_state", "clear_shields"]);
  assert.equal(createReferenceSkillCompiler(() => row).compile(1).conditions.requiredState, undefined);
  assert.equal(createReferenceSkillCompiler(() => ({ ...row, useCond: "[hasTipCond,-1,1]" })).compile(1).disabled, true);
});
