import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, EnemyAI, selectNearestTarget, selectSkillTarget } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import type { StatusDefinition, StatusState } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "player" | "enemy", x = 0) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 10, aggroRange: 20 } });
const state = (id: string, properties: Partial<StatusState>, duration = 1): StatusDefinition => ({ id, duration, states: [{ id, duration, ...properties }] });
const strike: SkillDefinition = { id: "strike", target: "enemy", range: 10, cooldown: 0, power: 1 };
const hidden = state("ghost", { untargetable: true }, 2);

test("invulnerability blocks direct and periodic damage before shields and emits immunity feedback", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem();
  target.addShield("shield", 50, 5); target.addStatus(state("protected", { invulnerable: true }));
  target.addStatus({ id: "bleed", duration: 1, periodicDamage: { interval: 0.25, power: 0.2 } }, source);
  combat.use(source, target, strike); combat.update(0.25, [source, target]);
  assert.equal(target.health, 1000); assert.equal(target.shield, 50);
  const damage = combat.events.filter((event) => event.type === "damage");
  assert.equal(damage.length, 2); assert.ok(damage.every((event) => event.immune && event.value === 0));
  target.updateEffects(0.75); combat.use(source, target, strike); assert.equal(target.shield, 0); assert.equal(target.health, 950);
});

test("per-hit damage caps apply before shields and expire independently from their Buff", () => {
  const target = actor("target", "enemy"); target.addShield("shield", 2, 20);
  target.addStatus({ ...state("armor", { damageCap: 1 }), duration: 10 });
  assert.equal(target.receiveDamage(1000), 0); assert.equal(target.shield, 1);
  assert.equal(target.receiveDamage(1000), 0); assert.equal(target.shield, 0);
  assert.equal(target.receiveDamage(1000), 1); assert.equal(target.health, 999);
  target.updateEffects(1); assert.equal(target.hasStatus("armor"), true); assert.equal(target.incomingDamageCap, Infinity);
  assert.equal(target.receiveDamage(100), 100);
});

test("death protection preserves one HP, cannot revive dead actors and does not grant false kill rewards", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 5 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 5, aggroRange: 10 }] },
    enemies: [{ id: "guard", kind: "enemy", x: 3, y: 2, hp: 30, attack: 0, defense: 0, moveSpeed: 0, attackRange: 5, aggroRange: 10, defeatFlag: "defeat:guard" }],
    skills: { player: { id: "p", target: "enemy", range: 5, cooldown: 0.2, power: 1 }, enemy: { id: "e", target: "enemy", range: 5, cooldown: 1, power: 0 } } };
  const session = new DemoSession(config), guard = session.world.enemies[0]; guard.addStatus(state("survive", { preventDeath: true }, 0.6));
  session.update(0.5); assert.equal(guard.health, 1); assert.equal(guard.alive, true); assert.equal(session.map.counter("defeat:guard"), 0);
  session.update(0.3); assert.equal(guard.alive, false); assert.equal(session.map.counter("defeat:guard"), 1);
  assert.equal(guard.addStatus(state("survive", { preventDeath: true })), false); assert.equal(guard.health, 0);
  session.update(1); assert.equal(session.map.counter("defeat:guard"), 1);
});

test("untargetable actors leave nearest, skill and retained enemy targets but can affect themselves", () => {
  const source = actor("source", "enemy"), ghost = actor("ghost", "player", 1), visible = actor("visible", "player", 3), combat = new CombatSystem();
  ghost.addStatus(hidden); source.targetId = ghost.id;
  assert.equal(selectNearestTarget(source, [ghost, visible], 10), visible); assert.equal(selectSkillTarget(source, [ghost, visible], strike), visible);
  assert.equal(combat.use(source, ghost, strike, [source, ghost, visible]), false);
  new EnemyAI(strike).update(source, [ghost, visible], combat, 0.1); assert.equal(source.targetId, visible.id); assert.equal(ghost.health, 1000);
  ghost.health = 500;
  const heal: SkillDefinition = { id: "self_heal", target: "self", type: "heal", range: 0, cooldown: 0, power: 1 };
  assert.equal(combat.use(ghost, ghost, heal, [source, ghost, visible]), true); assert.equal(ghost.health, 600);
});

test("targetability is rechecked on windup resolution and for every area target", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), visible = actor("visible", "enemy", 3), combat = new CombatSystem();
  combat.use(source, target, { ...strike, windup: 0.5 }, [source, target, visible]); target.addStatus(hidden);
  combat.update(0.5, [source, target, visible]); assert.equal(target.health, 1000);
  combat.use(source, visible, { ...strike, maxTargets: 5, area: { shape: "circle", radius: 5 } }, [source, target, visible]);
  assert.equal(target.health, 1000); assert.equal(visible.health, 900);
});

test("homing loses untargetable locks while straight projectiles pass through without spending a hit", () => {
  const source = actor("source", "player"), ghost = actor("ghost", "enemy", 2), visible = actor("visible", "enemy", 4), combat = new CombatSystem(), actors = [source, ghost, visible];
  combat.use(source, ghost, { ...strike, projectileSpeed: 2, projectileHoming: true, projectileLifetime: 5 }, actors);
  ghost.addStatus(hidden); combat.update(0.1, actors); assert.equal(combat.projectileSnapshots().length, 0);
  combat.use(source, visible, { ...strike, projectileSpeed: 10, projectileLifetime: 2, directionalProjectile: { radius: 0.1, maxHits: 1 } }, actors);
  combat.update(0.5, actors); assert.equal(ghost.health, 1000); assert.equal(visible.health, 900);
});

test("existing periodic effects remain attached while untargetable, but pending contact damage is cancelled", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem(), actors = [source, target];
  target.addStatus({ id: "bleed", duration: 2, periodicDamage: { interval: 0.5, power: 0.1 } }, source);
  combat.use(source, target, { ...strike, projectileSpeed: 10, projectileLifetime: 1, directionalProjectile: { radius: 0.1, maxHits: 1 },
    actions: [{ at: 0.5, type: "damage", power: 5 }] }, actors);
  combat.update(0.2, actors); target.addStatus(hidden); combat.update(0.3, actors);
  assert.equal(target.health, 990); combat.update(0.5, actors); assert.equal(target.health, 980);
});

test("healing prohibition overrides direct healing and damage-based self recovery until cleansed", () => {
  const source = actor("source", "player"), target = actor("target", "enemy", 2), combat = new CombatSystem(); source.health = 100;
  source.addStatus({ ...state("no_heal", { healingBlocked: true }), harmful: true }, target);
  assert.equal(source.heal(100), 0);
  combat.use(source, target, { ...strike, actions: [{ at: 0, type: "damage", power: 1, healFromDamage: 0.5, healFromDamageRecipient: "self" }] });
  assert.equal(source.health, 100); assert.equal(target.health, 900);
  source.cleanse(1, true, () => 0); assert.equal(source.heal(50), 50); assert.equal(source.health, 150);
});

test("source defensive markers become explicit capabilities without becoming unrelated control states", () => {
  const compiler = createReferenceSkillCompiler((family) => family === "Buff" ? { duration: 2000,
    effects: "[addStateAction,invincible,1000]|[addStateAction,notDead,1500]|[addStateAction,unselected,2000]|[addStateAction,unHeal]|[addStateAction,fixOneDmg,500]" } :
    { skillType: 2, frameKey: "[key:0_action:[addBuffAction,9]]" });
  const status = compiler.compile(1).actions[0].status;
  assert.deepEqual(status.states.map((entry) => [entry.id, entry.duration]), [["invincible", 1], ["notDead", 1.5], ["unselected", 2], ["unHeal", 2], ["fixOneDmg", 0.5]]);
  assert.equal(status.states[0].invulnerable, true); assert.equal(status.states[1].preventDeath, true); assert.equal(status.states[2].untargetable, true);
  assert.equal(status.states[3].healingBlocked, true); assert.equal(status.states[4].damageCap, 1); assert.equal(status.harmful, true);
  assert.deepEqual(compiler.issues, []);
});

test("explicit removal clears named permanent states while retaining sibling states and Buff modifiers", () => {
  const source = actor("source", "player"), combat = new CombatSystem();
  source.addStatus({ id: "form", duration: 5, modifiers: { attackRate: 0.2 }, states: [
    { id: "ghost", duration: -1, untargetable: true }, { id: "immortal", duration: -1, preventDeath: true }, { id: "protection", duration: 5, invulnerable: true }] });
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, targetCamp: 1, frameKey: "[key:0_action:[removeStateAction,1,ghost,immortal]]" }));
  const definition = compiler.compile(1);
  combat.use(source, source, { ...definition, power: 0, target: "self" });
  assert.equal(source.targetable, true); assert.equal(source.preventsDeath, false); assert.equal(source.invulnerable, true);
  assert.equal(source.hasStatus("form"), true); assert.equal(source.modifier("attackRate"), 0.2);
  assert.deepEqual(combat.events.filter((event) => event.type === "state_removed").map((event) => event.statusId), ["ghost", "immortal"]);
  assert.deepEqual(compiler.issues, []);
});
