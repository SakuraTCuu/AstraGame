import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import type { AreaEffectDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, x: number, y = 0, faction: "enemy" | "player" = "enemy") => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 100, aggroRange: 100 } });
const area: AreaEffectDefinition = { duration: 2.1, interval: 0.5, geometry: { shape: "circle", radius: 0.1 },
  motion: { kind: "straight", speed: 2 }, effects: [{ at: 0, type: "damage", power: 1 }] };
const skill = (effect = area): SkillDefinition => ({ id: "moving", target: "enemy", range: 100, cooldown: 0, power: 0,
  actions: [{ at: 0, type: "area", areaEffect: effect }] });

test("moving areas sample each damage time at its own position even across a large update", () => {
  const run = (step: number) => {
    const source = actor("source", 0, 0, "player"), aim = actor("aim", 10), targets = [actor("one", 1), actor("two", 2), actor("three", 3)], combat = new CombatSystem();
    const actors = [source, aim, ...targets]; combat.use(source, aim, skill(), actors);
    for (let time = 0; time < 2 - 1e-9; time += step) combat.update(step, actors);
    return { health: targets.map((target) => target.health), x: combat.areaSnapshots()[0].x, aimHealth: aim.health };
  };
  assert.deepEqual(run(2), { health: [900, 900, 900], x: 4, aimHealth: 1000 });
  const small = run(0.05); assert.deepEqual(small.health, [900, 900, 900]); assert.ok(Math.abs(small.x - 4) < 1e-9);
});

test("homing area turns its inherited warning hitbox toward the moving target", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 4), combat = new CombatSystem();
  const definition: SkillDefinition = { ...skill({ ...area, motion: { kind: "homing", speed: 2 }, geometry: { shape: "line", radius: 5, width: 0.2 } }),
    windup: 0.5, warnings: [{ start: 0, end: 0.5, anchor: "caster", geometry: { shape: "line", radius: 5, width: 0.2 } }],
    actions: [{ at: 0.5, type: "area", warningIndex: 0, areaEffect: { ...area, motion: { kind: "homing", speed: 2 }, geometry: { shape: "line", radius: 5, width: 0.2 } } }] };
  combat.use(source, target, definition, [source, target]); combat.update(0.5, [source, target]); assert.equal(target.health, 900);
  target.position = new Vector2(0, 4); combat.update(0.5, [source, target]);
  const snapshot = combat.areaSnapshots()[0]; assert.equal(snapshot.x, 0); assert.equal(snapshot.y, 1); assert.equal(snapshot.directionY, 1);
  assert.equal(target.health, 800);
});

test("homing area reaches a nearby target without overshoot then retains heading when that target disappears", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 0.5), combat = new CombatSystem();
  combat.use(source, target, skill({ ...area, motion: { kind: "homing", speed: 2 } }), [source, target]); combat.update(0.5, [source, target]);
  assert.equal(combat.areaSnapshots()[0].x, 0.5); target.health = 0; combat.update(0.5, [source, target]);
  assert.equal(combat.areaSnapshots()[0].x, 1.5);
});

test("seeded warning paths stay relative to home and launch areas along distinct stored directions", () => {
  const source = actor("source", 10, 10, "player"), target = actor("target", 20, 20), combat = new CombatSystem(() => 0);
  source.position = new Vector2(14, 15);
  const paths = [{ from: { x: -4, y: 0 }, to: { x: 4, y: 0 } }, { from: { x: 0, y: -4 }, to: { x: 0, y: 4 } }];
  const definition: SkillDefinition = { ...skill(), windup: 1, warnings: [0, 1].map(() => ({ start: 0, end: 1, anchor: "home", paths, geometry: { shape: "line", radius: 8, width: 1 } })),
    actions: [0, 1].map((warningIndex) => ({ at: 1, type: "area", areaEffect: area, warningIndex })) };
  combat.use(source, target, definition, [source, target]);
  assert.deepEqual(combat.castSnapshots()[0].warnings!.map((mark) => mark.position), [new Vector2(6, 10), new Vector2(10, 6)]);
  combat.update(1, [source, target]); combat.update(0.5, [source, target]);
  assert.deepEqual(combat.areaSnapshots().map(({ x, y, directionX, directionY }) => ({ x, y, directionX, directionY })),
    [{ x: 7, y: 10, directionX: 1, directionY: 0 }, { x: 10, y: 7, directionX: 0, directionY: 1 }]);
});

test("released moving areas survive caster death but return and reset clean them up", () => {
  const source = actor("source", 0, 0, "player"), target = actor("target", 10), combat = new CombatSystem();
  combat.use(source, target, skill(), [source, target]); source.health = 0; combat.update(0.5, [source, target]);
  assert.equal(combat.areaSnapshots()[0].x, 1); combat.resetEngagement(); assert.equal(combat.areaSnapshots().length, 0);
  source.recoverAt({ x: 0, y: 0 }); combat.use(source, target, skill(), [source, target]); source.setState("returning"); combat.update(0.1, [source, target]);
  assert.equal(combat.areaSnapshots().length, 0);
});

test("source line warnings bind each moving area and unsupported search modes stay audited", () => {
  const row = { skillType: 2, firstSelector: [100, 10], frameKey: Array(2).fill("[key:2_action:[sceneSpriteAction,5000,100,box,2,1,10,-1]]").join("&"),
    skillWarn: Array(2).fill("[4,1,0,1000,box,2,20]").join("|"), sceneSpriteActions: "[key:0_action:[damageAction,20000]]",
    skillTagActions: "[warnRandomLineTag,0,0,-10_8_8_-8,-8_-8_8_10]|[sceneSpriteSearchTag,0,8,-1,2]|[sceneSpriteWarnDirTag,1]" };
  const compiler = createReferenceSkillCompiler(() => row), compiled = compiler.compile(1);
  assert.equal(compiled.warnings.length, 2); assert.equal(compiled.warnings[0].paths.length, 2);
  assert.deepEqual(compiled.actions.map((action) => ({ index: action.warningIndex, motion: action.areaEffect.motion })),
    [0, 1].map((index) => ({ index, motion: { kind: "straight", speed: 8 } })));
  const unsupported = createReferenceSkillCompiler(() => ({ ...row, skillTagActions: "[sceneSpriteSearchTag,0,8,-1,4]" }));
  assert.equal(unsupported.compile(1).actions.length, 0); assert.ok(unsupported.issues.some((issue) => issue.kind === "area_layout"));
});

test("configuration rejects contradictory area motion and invalid path coordinates", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 2 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 0, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 }] }, enemies: [],
    skills: { player: { id: "p", range: 1, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 1, cooldown: 1, power: 0, target: "enemy" } } };
  config.skills.definitions = [{ ...skill({ ...area, followCaster: true }), type: "damage", coefficient: 0 }];
  assert.throws(() => new DemoSession(config), /Invalid area motion/);
  config.skills.definitions = [{ ...skill(), type: "damage", coefficient: 0, warnings: [{ start: 0, end: 1, anchor: "home", geometry: { shape: "circle", radius: 1 },
    paths: [{ from: { x: 1, y: 1 }, to: { x: 1, y: 1 } }] }] }];
  assert.throws(() => new DemoSession(config), /Invalid warning paths/);
});
