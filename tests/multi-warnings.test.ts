import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, x: number, y = 0, faction: "player" | "enemy" = "enemy") => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 20, aggroRange: 20, maxEnergy: 100, energyOnSkill: 10 } });
const waves: SkillDefinition = { id: "waves", target: "enemy", range: 20, cooldown: 0, power: 1, windup: 1, castDuration: 2,
  warnings: [{ start: 0, end: 1, geometry: { shape: "circle", radius: 1 }, anchor: "target" },
    { start: 0.5, end: 1.5, geometry: { shape: "circle", radius: 1 }, anchor: "target", distance: 4 }],
  actions: [{ at: 1, type: "damage", power: 1, warningIndex: 0 }, { at: 1.5, type: "damage", power: 1, warningIndex: 1 }] };

test("separate warning windows retain their own positions and damage times", () => {
  const source = actor("source", 0, 0, "player"), first = actor("first", 3), second = actor("second", 7), safe = actor("safe", 5), actors = [source, first, second, safe], combat = new CombatSystem();
  combat.use(source, first, waves, actors); assert.equal(combat.castSnapshots()[0].warnings!.length, 1);
  combat.update(0.5, actors); assert.deepEqual(combat.castSnapshots()[0].warnings!.map((warning) => warning.position.x), [3, 7]);
  first.position = new Vector2(5, 0); combat.update(0.5, actors);
  assert.equal(first.health, 1000); assert.equal(combat.castSnapshots()[0].phase, "active"); assert.equal(combat.castSnapshots()[0].warnings!.length, 1);
  combat.update(0.5, actors); assert.equal(second.health, 900); assert.equal(safe.health, 1000); assert.equal(source.energy, 10);
  assert.equal(combat.castSnapshots()[0].warnings!.length, 0);
});

test("ring warnings damage their own circles rather than one shared target point", () => {
  const source = actor("source", 0, 0, "player"), targets = [actor("east", 4), actor("north", 0, 4), actor("west", -4), actor("south", 0, -4)], combat = new CombatSystem();
  const ring: SkillDefinition = { ...waves, warnings: [0, 90, 180, 270].map((angleDegrees) => ({ start: 0, end: 1, anchor: "caster", distance: 4, angleDegrees, geometry: { shape: "circle", radius: 0.5 } })),
    actions: [0, 1, 2, 3].map((warningIndex) => ({ at: 1, type: "damage", power: 1, warningIndex })) };
  combat.use(source, targets[0], ring, [source, ...targets]); combat.update(1, [source, ...targets]);
  assert.deepEqual(targets.map((target) => target.health), [900, 900, 900, 900]); assert.equal(source.energy, 10);
});

test("tracked current and seeded random targets lock without a floating-point extra frame", () => {
  const source = actor("source", 0, 0, "player"), first = actor("first", 3), other = actor("other", 6), hidden = actor("hidden", 4), combat = new CombatSystem(() => 0);
  hidden.addStatus({ id: "hidden", duration: 5, states: [{ id: "hidden", duration: 5, untargetable: true }] });
  const skill: SkillDefinition = { ...waves, trackTargetFor: 0.5, warnings: [
    { start: 0, end: 1, anchor: "target", follow: true, geometry: { shape: "circle", radius: 1 } },
    { start: 0, end: 1.5, anchor: "random_target", follow: true, geometry: { shape: "circle", radius: 1 } }] };
  combat.use(source, first, skill, [source, first, hidden, other]);
  for (let tick = 0; tick < 10; tick++) combat.update(0.05, [source, first, hidden, other]);
  assert.deepEqual(combat.castSnapshots()[0].warnings!.map((warning) => warning.position.x), [3, 6]);
  first.position = new Vector2(8, 0); other.position = new Vector2(11, 0); combat.update(0.05, [source, first, hidden, other]);
  assert.deepEqual(combat.castSnapshots()[0].warnings!.map((warning) => warning.position.x), [3, 6]);
});

test("cancellation removes every future warning and its pending actions", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 3), combat = new CombatSystem();
  combat.use(source, target, waves, [source, target]); combat.update(0.5, [source, target]); combat.cancelCaster(source.id);
  assert.equal(combat.castSnapshots().length, 0); combat.update(3, [source, target]); assert.equal(target.health, 1000);
});

test("source round warnings broadcast damage while caster-only gains remain once per cast", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, firstSelector: [1000, 10], selectShape: "[circle,80]",
    frameKey: "[key:0_action:[damageAction,30000]|[addSkillEnegyAction,1,3]]", skillTagActions: "[warnRoundTag,90,200]",
    skillWarn: Array(4).fill("[3,1,0,2000,circle,80]").join("|") }));
  const skill = compiler.compile(1);
  assert.equal(skill.warnings.length, 4); assert.deepEqual(skill.warnings.map((warning) => warning.angleDegrees), [0, 90, 180, 270]);
  assert.deepEqual(skill.actions.filter((action) => action.type === "damage").map((action) => action.warningIndex), [0, 1, 2, 3]);
  assert.equal(skill.actions.filter((action) => action.type === "skill_energy").length, 1);
});

test("source staggered warning rows map to staggered hits and ambiguous layouts remain audited", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, firstSelector: [1000, 10], selectShape: "[circle,50]", skillTagActions: "[warnRoundTag,36,200]",
    frameKey: Array(10).fill("[key:2_action:[damageAction,15000]]").join("&"),
    skillWarn: Array.from({ length: 10 }, (_, index) => `[3,1,${index * 100},${2000 + index * 100},circle,50]`).join("|") }));
  const skill = compiler.compile(1); assert.deepEqual(skill.actions.map((action) => action.at), Array.from({ length: 10 }, (_, index) => 2 + index / 10));
  const ambiguous = createReferenceSkillCompiler(() => ({ skillType: 2, skillTagActions: "[warnRoundTag,120,300]", frameKey: Array(6).fill("[key:4_action:[damageAction,6600]]").join("&"),
    skillWarn: "[3,1,0,3000,circle,200]|[3,1,300,3300,circle,200]" }));
  assert.equal(ambiguous.compile(1).warnings, undefined); assert.ok(ambiguous.issues.some((issue) => issue.kind === "multiple_warnings"));
});

test("warning configuration rejects damage before the warning ends and invalid references", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 2 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 0, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 }] }, enemies: [],
    skills: { player: { id: "p", range: 1, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 1, cooldown: 1, power: 0, target: "enemy" } } };
  for (const action of [{ at: 0.5, type: "damage" as const, power: 1, warningIndex: 0 }, { at: 2, type: "damage" as const, power: 1, warningIndex: 3 }]) {
    const invalid = structuredClone(config); invalid.skills.definitions = [{ ...waves, type: "damage", coefficient: 1, actions: [action] }];
    assert.throws(() => new DemoSession(invalid), /Invalid warning action/);
  }
});
