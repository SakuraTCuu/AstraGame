import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, FogGrid, GameWorld, GridNavigation, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig } from "../assets/scripts/core/index.ts";
import type { StatusDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = () => new Actor({ id: "hero", faction: "player", position: { x: 0, y: 0 },
  stats: { maxHealth: 1000, attack: 10, defense: 0, moveSpeed: 5, attackRange: 1, aggroRange: 10 } });
const lift: StatusDefinition = { id: "lift", duration: 0.5, harmful: true, states: [{ id: "airborne", duration: 1, control: "airborne", lift: { height: 80, rise: 0.5, fall: 0.5 } }] };
const fear: StatusDefinition = { id: "fear", duration: 1.25, harmful: true, states: [{ id: "fear", duration: 1.25, control: "fear", wander: { speed: 4, turnInterval: 0.5 } }] };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("airborne height rises and falls independently of ground position and the expired buff", () => {
  const unit = actor(); unit.addStatus(lift);
  close(unit.controlElevation, 0); unit.updateEffects(0.25); close(unit.controlElevation, 60);
  unit.updateEffects(0.25); close(unit.controlElevation, 80); assert.equal(unit.hasStatus(lift.id), false);
  assert.equal(unit.canMove, false); unit.updateEffects(0.25); close(unit.controlElevation, 60);
  unit.updateEffects(0.25); close(unit.controlElevation, 0); assert.equal(unit.canMove, true); assert.deepEqual(unit.position, Vector2.ZERO);
});

test("reapplying airborne control preserves current height and cleanup always grounds the actor", () => {
  const unit = actor(); unit.addStatus(lift); unit.updateEffects(0.25); close(unit.controlElevation, 60);
  unit.addStatus(lift); close(unit.controlElevation, 60); unit.updateEffects(0.25); close(unit.controlElevation, 75);
  unit.cleanse(1, false, () => 0); close(unit.controlElevation, 0);
  unit.addStatus(lift); unit.updateEffects(0.5); unit.receiveDamage(10000); close(unit.controlElevation, 0);
  unit.recoverAt({ x: 2, y: 2 }); close(unit.controlElevation, 0);
});

test("fear uses deterministic turning segments and consumes only the remaining control duration", () => {
  const run = (steps: number[]) => {
    const unit = actor(); unit.addStatus(fear); let calls = 0;
    const combat = new CombatSystem(() => [0, 0.25, 0.5][calls++]);
    const segments: Vector2[] = [];
    for (const step of steps) combat.update(step, [unit], (source, point, kind) => { assert.equal(kind, "fear"); source.position = Vector2.from(point); segments.push(source.position); });
    close(unit.position.x, 1); close(unit.position.y, 2); assert.equal(calls, 3); assert.equal(unit.canMove, true);
    return segments;
  };
  assert.equal(run([2]).length, 3); run([0.25, 0.25, 0.25, 0.25, 0.25]);
});

test("freeze and root suppress fear movement, while immunity prevents fear from starting", () => {
  for (const kind of ["freeze", "root"] as const) {
    const unit = actor(); unit.addStatus(fear); unit.addStatus({ id: "stop", duration: 0.5, states: [{ id: kind, duration: 0.5, control: kind }] });
    const combat = new CombatSystem(() => 0); combat.update(0.5, [unit]); assert.deepEqual(unit.position, Vector2.ZERO);
    combat.update(0.5, [unit]); close(unit.position.x, 2); assert.equal(unit.canMove, false);
  }
  const immune = actor(); immune.addStatus({ id: "immune", duration: 2, states: [{ id: "immune_fear", duration: 2, controlImmunity: ["fear"] }] });
  assert.equal(immune.addStatus(fear), false); new CombatSystem().update(1, [immune]); assert.deepEqual(immune.position, Vector2.ZERO);
});

test("fear obeys collision and replans an existing route even when cleansed between world ticks", () => {
  const navigation = new GridNavigation(20, 20, [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }]), leader = actor(); leader.position = new Vector2(3.5, 4.5);
  const world = new GameWorld({ seed: 1, navigation, fog: new FogGrid(20, 20, 1), players: [leader], enemies: [],
    playerSkill: { id: "p", target: "enemy", range: 0, cooldown: 1, power: 0 }, enemySkill: { id: "e", target: "enemy", range: 0, cooldown: 1, power: 0 } });
  world.random.next = () => 0.25; world.autoTravelPaused = true; world.navigateTo({ x: 7.5, y: 4.5 });
  leader.addStatus({ ...fear, states: [{ ...fear.states![0], wander: { speed: 8, turnInterval: 1 } }] });
  world.update(0.75); close(leader.position.y, 10.5);
  leader.cleanse(1, false, () => 0); world.update(0.05); world.autoTravelPaused = false;
  for (let tick = 0; tick < 80 && !world.path.complete; tick++) { world.update(0.05); assert.equal(navigation.isWorldWalkable(leader.position), true); }
  close(leader.position.x, 7.5); close(leader.position.y, 4.5);
  leader.position = new Vector2(3.5, 6.5); world.random.next = () => 0; leader.addStatus(fear); world.update(0.5);
  assert.ok(leader.position.x < 4); assert.equal(navigation.isWorldWalkable(leader.position), true);
});

test("source fear speed and flight phases become motion metadata with explicit parity notes", () => {
  const rows = { 1: { duration: 1500, effects: "[addStateAction,fear,1500,350,500]" },
    2: { duration: 4000, effects: "[addStateAction,upUp,4000,2000,2000,600]" }, 3: { duration: 1000, effects: "[addStateAction,knockUp,1000,1000]" } };
  const compiler = createReferenceSkillCompiler((family, id) => family === "Buff" ? rows[id] : { skillType: 2, frameKey: `[key:0_action:[addBuffAction,${id}]]` });
  const state = (id: number) => compiler.compile(id).actions[0].status.states[0];
  assert.deepEqual(state(1).wander, { speed: 350, turnInterval: 0.5 });
  assert.deepEqual(state(2).lift, { height: 600, rise: 2, fall: 2 });
  assert.deepEqual(state(3).lift, { height: 160, rise: 0.5, fall: 0.5 });
  assert.deepEqual(compiler.issues.map((issue) => issue.kind), ["fear_motion_parity", "airborne_motion_parity", "airborne_motion_parity"]);
});

test("invalid flight phases and fear intervals fail configuration validation", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 2 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 0, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 }] }, enemies: [],
    skills: { player: { id: "p", range: 1, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 1, cooldown: 1, power: 0, target: "enemy" } } };
  for (const state of [{ ...lift.states![0], lift: { height: 80, rise: 1, fall: 1 } }, { ...fear.states![0], wander: { speed: 4, turnInterval: 0 } }]) {
    const invalid = structuredClone(config);
    invalid.skills.definitions = [{ id: "bad", type: "buff", coefficient: 0, target: "self", range: 0, cooldown: 0,
      actions: [{ at: 0, type: "status", status: { id: "bad", duration: 1, states: [state] } }] }];
    assert.throws(() => new DemoSession(invalid), /Invalid airborne motion|Invalid fear motion/);
  }
});
