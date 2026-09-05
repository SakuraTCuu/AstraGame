import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, SquadFormation, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import type { ControlKind, StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, faction: "player" | "enemy" = "player", kind?: string) => new Actor({ id, faction, kind, position: { x: faction === "enemy" ? 2 : 0, y: 0 },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 10, attackRange: 5, aggroRange: 20 } });
const control = (kind: ControlKind, duration = 1): StatusDefinition => ({ id: kind, duration, harmful: true, states: [{ id: kind, duration, control: kind }] });
const attack: SkillDefinition = { id: "attack", target: "enemy", category: "normal", range: 10, cooldown: 0, power: 1, windup: 0.5, castDuration: 1,
  actions: [{ at: 0.5, type: "damage", power: 1 }] };
const effect = (status: StatusDefinition): SkillDefinition => ({ id: "control", target: "enemy", range: 10, cooldown: 0, power: 0,
  actions: [{ at: 0, type: "status", status }] });

test("states keep their own lifetimes, preserve siblings and can outlive their owning buff", () => {
  const unit = actor("unit");
  unit.addStatus({ id: "long_buff", duration: 60, modifiers: { attackRate: 0.2 }, states: [{ id: "short_flag", duration: 6 }, { id: "long_flag", duration: 20 }] });
  unit.updateEffects(6); assert.equal(unit.hasStatus("short_flag"), false); assert.equal(unit.hasStatus("long_flag"), true); assert.equal(unit.modifier("attackRate"), 0.2);
  unit.addStatus({ ...control("airborne", 1), states: [{ id: "launch", duration: 2, control: "airborne" }] });
  unit.updateEffects(1); assert.equal(unit.hasStatus("airborne"), false); assert.equal(unit.hasStatus("launch"), true); assert.equal(unit.canMove, false);
  unit.updateEffects(0.95); assert.equal(unit.hasStatus("launch"), true);
  unit.updateEffects(0.05); assert.equal(unit.hasStatus("launch"), false); assert.equal(unit.canMove, true); assert.equal(unit.hasStatus("long_flag"), true);
});

test("stun immediately cancels a windup, including a control shorter than the next update", () => {
  const source = actor("source"), target = actor("target", "enemy"), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, attack, actors); combat.use(target, source, effect(control("stun", 0.1)), actors);
  assert.equal(source.fsm.state, "controlled"); assert.equal(combat.isWindingUp(source), false); assert.equal(combat.canUse(source, attack), false);
  combat.update(1, actors); assert.equal(target.health, 1000); assert.equal(source.fsm.state, "idle");
  assert.equal(combat.events.filter((event) => event.type === "cast_cancelled").length, 1);
  combat.use(source, target, attack, actors); source.addStatus(control("freeze", 0.05), target);
  combat.update(1, actors); assert.equal(target.health, 1000); assert.equal(source.hardControlled, false);
});

test("root holds movement but allows stationary attacks, while silence allows normals and movement", () => {
  const source = actor("source"), target = actor("target", "enemy"), combat = new CombatSystem();
  source.addStatus(control("root"));
  source.moveTowards(target.position, 1); assert.deepEqual(source.position, Vector2.ZERO);
  new SquadFormation([source]).update({ x: 10, y: 0 }, { x: 0, y: 1 }, 1); assert.deepEqual(source.position, Vector2.ZERO);
  assert.equal(combat.canUse(source, attack), true);
  assert.equal(combat.canUse(source, { ...attack, conditions: { uncontrolled: true } }), false);
  assert.equal(combat.canUse(source, { ...attack, motion: { kind: "charge", duration: 1, distance: 5 } }), false);
  source.updateEffects(1); source.addStatus(control("silence"));
  assert.equal(source.canMove, true); assert.equal(combat.canUse(source, attack), true);
  assert.equal(combat.canUse(source, { ...attack, category: "skill" }), false); assert.equal(combat.canUse(source, { ...attack, category: "ultimate" }), false);
  combat.use(source, target, attack); combat.update(1, [source, target]); assert.equal(target.health, 900);
});

test("immunity blocks incoming controls and source exclusions without discarding other state flags", () => {
  const unit = actor("unit"), boss = actor("boss", "enemy", "boss");
  unit.addStatus({ id: "immunity", duration: 3, states: [{ id: "force_anchor", duration: 3, displacementImmunity: true },
    { id: "immune", duration: 1, controlImmunity: ["stun", "freeze", "airborne", "root", "silence"] }] });
  for (const kind of ["stun", "freeze", "airborne", "root", "silence"] as ControlKind[]) assert.equal(unit.addStatus(control(kind)), false);
  assert.equal(unit.displacementImmune, true); unit.updateEffects(1); assert.equal(unit.addStatus(control("freeze")), true);
  assert.equal(unit.displacementImmune, true); assert.equal(unit.hasStatus("force_anchor"), true);
  boss.addStatus({ id: "boss_stun", duration: 1, states: [{ id: "stunNotBoss", duration: 1, control: "stun", excludeBoss: true }] });
  assert.equal(boss.controlled, false); assert.equal(boss.hasStatus("boss_stun"), false);
  boss.addStatus({ id: "frost_immunity", duration: 5, states: [{ id: "unForzen", duration: 5 }] });
  assert.equal(boss.addStatus({ ...control("freeze"), blockedByStates: ["unForzen"] }), false);
});

test("interruption immunity lets a current cast finish without allowing another while stunned", () => {
  const source = actor("source"), target = actor("target", "enemy"), combat = new CombatSystem(), actors = [source, target];
  source.addStatus({ id: "protected_cast", duration: 2, states: [{ id: "keep_casting", duration: 2, interruptionImmunity: true }] });
  combat.use(source, target, attack, actors); combat.use(target, source, effect(control("stun", 3)), actors);
  assert.equal(combat.isWindingUp(source), true); assert.equal(source.canMove, false);
  combat.update(1, actors); assert.equal(target.health, 900); assert.equal(source.fsm.state, "controlled"); assert.equal(combat.canUse(source, attack), false);
  combat.update(2, actors); assert.equal(source.fsm.state, "idle"); assert.equal(combat.canUse(source, attack), true);
});

test("interruption immunity also preserves a cast during knockback without cancelling displacement", () => {
  const source = actor("source"), target = actor("target", "enemy"), combat = new CombatSystem(), actors = [source, target];
  source.addStatus({ id: "protected_cast", duration: 3, states: [{ id: "keep_casting", duration: 3, interruptionImmunity: true }] });
  combat.use(source, target, attack, actors);
  combat.use(target, source, { id: "push", target: "enemy", range: 10, cooldown: 0, power: 0,
    actions: [{ at: 0, type: "damage", power: 0, knockback: { distance: 4, duration: 0.8 } }] }, actors);
  combat.update(0.5, actors); assert.equal(target.health, 900); assert.equal(source.fsm.state, "displaced");
  assert.equal(source.canMove, false); assert.equal(source.position.x, -2.5);
  combat.update(0.3, actors); assert.equal(source.position.x, -4); assert.equal(source.fsm.state, "recovering");
  combat.update(0.2, actors); assert.equal(source.fsm.state, "idle"); assert.equal(combat.events.some((event) => event.type === "cast_cancelled"), false);
});

test("cleanse removes an expired buff's surviving NPC control while preserving protected and player controls", () => {
  const unit = actor("unit"), npc = actor("npc", "enemy"), ally = actor("ally");
  unit.addStatus({ ...control("airborne", 0.5), states: [{ id: "airborne", duration: 2, control: "airborne" }] }, npc);
  unit.addStatus({ ...control("freeze", 3), dispellable: false }, npc);
  unit.addStatus(control("root", 3), ally);
  unit.updateEffects(0.5); assert.equal(unit.statusSnapshots().some((status) => status.id === "airborne"), false);
  assert.deepEqual(unit.cleanse(5, true, () => 0), ["airborne"]);
  assert.equal(unit.hasControl("airborne"), false); assert.equal(unit.hasControl("freeze"), true); assert.equal(unit.hasControl("root"), true);
  unit.recoverAt(unit.position); assert.deepEqual(unit.stateSnapshots(), []); assert.equal(unit.canMove, true);
  unit.addStatus(control("stun"), npc); unit.receiveDamage(10000); assert.deepEqual(unit.stateSnapshots(), []);
});

test("self control stops remaining actions and release triggers without overwriting the controlled FSM", () => {
  const source = actor("source"), target = actor("target", "enemy"), extra = { ...attack, id: "extra", windup: 0, castDuration: 0, actions: [{ at: 0, type: "damage" as const, power: 5 }] };
  const combat = new CombatSystem(undefined, "pve", { extra });
  const skill: SkillDefinition = { ...attack, onRelease: [{ skillId: "extra" }], actions: [{ at: 0.5, type: "status", status: control("stun"), recipient: "self" }, { at: 0.6, type: "damage", power: 5 }] };
  combat.use(source, target, skill); combat.update(0.7, [source, target]);
  assert.equal(target.health, 1000); assert.equal(source.fsm.state, "controlled"); assert.equal(combat.events.some((event) => event.triggered), false);
});

test("source state actions preserve multiple timers, immunity tags and control-free cast requirements", () => {
  const rows = { Skill: { 1: { skillType: 2, frameKey: "[key:0_action:[addBuffAction,9]]", useCond: "[notControlCond]" } },
    Buff: { 9: { duration: 1000, effects: "[addStateAction,ignoreBreakSkill,500]|[addStateAction,knockUp,2000]|[addStateAction,notControl,1000]", buffTagActions: "[noStateTag,unFlyUp]" } } };
  const compiler = createReferenceSkillCompiler((family, id) => rows[family]?.[id]), skill = compiler.compile(1), status = skill.actions[0].status;
  assert.equal(skill.conditions.uncontrolled, true); assert.deepEqual(status.blockedByStates, ["unFlyUp"]);
  assert.deepEqual(status.states.map((state) => [state.id, state.duration]), [["ignoreBreakSkill", 0.5], ["knockUp", 2], ["notControl", 1]]);
  assert.equal(status.states[0].interruptionImmunity, true); assert.equal(status.states[1].control, "airborne"); assert.equal(status.states[2].controlImmunity.length, 5);
  assert.equal(status.harmful, true); assert.deepEqual(compiler.issues, []);
});

test("manual and automatic travel stay still during control and reject invalid state durations", () => {
  const config: DemoConfig = { seed: 1, world: { width: 30, height: 30, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 3 },
    squad: { actors: [{ id: "leader", kind: "hero", x: 10.5, y: 10.5, hp: 1000, attack: 0, defense: 0, moveSpeed: 4, attackRange: 0, aggroRange: 0 }] }, enemies: [],
    skills: { player: { id: "p", range: 0, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 0, cooldown: 1, power: 0, target: "enemy" } } };
  for (const manual of [false, true]) {
    const session = new DemoSession(config), leader = session.world.leader!, before = leader.position;
    if (manual) session.setMoveIntent(1, 0); else session.setAutoDestination(15.5, 10.5);
    leader.addStatus(control("freeze", 1)); session.update(0.5); assert.deepEqual(leader.position, before);
    session.update(1); assert.ok(leader.position.x > before.x);
  }
  const invalid = structuredClone(config);
  invalid.skills.definitions = [{ id: "invalid", type: "buff", coefficient: 0, target: "self", range: 0, cooldown: 0,
    actions: [{ at: 0, type: "status", status: { id: "bad", duration: 1, states: [{ id: "bad_state", duration: 0 }] } }] }];
  assert.throws(() => new DemoSession(invalid), /Invalid status state/);
});
