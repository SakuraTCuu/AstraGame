import assert from "node:assert/strict";
import test from "node:test";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";
import type { DemoConfig, SkillDefinition } from "../assets/scripts/core/index.ts";
import type { AreaEffectDefinition } from "../assets/scripts/core/combat/SkillEffects.ts";
import { createReferenceSkillCompiler } from "../tools/reference-skills.mjs";

const actor = (id: string, x: number, faction: "player" | "enemy" = "enemy") => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 20, aggroRange: 30, maxEnergy: 100, energyOnSkill: 10 } });
const zone: AreaEffectDefinition = { duration: 1, interval: 0.25, geometry: { shape: "circle", radius: 2 }, effects: [{ at: 0, type: "damage", power: 1 }] };
const field = (areaEffect: AreaEffectDefinition = zone): SkillDefinition => ({ id: "field", target: "enemy", range: 20, power: 0, cooldown: 0,
  actions: [{ at: 0, type: "area", areaEffect }] });

test("a ground area ticks on creation and inside its lifetime, and leaving stops new contacts", () => {
  const source = actor("source", 0, "player"), target = actor("target", 5), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, field(), actors); assert.equal(target.health, 9900); assert.equal(source.energy, 10);
  combat.update(0.25, actors); assert.equal(target.health, 9800);
  target.position = new Vector2(10, 0); combat.update(0.25, actors); assert.equal(target.health, 9800);
  target.position = new Vector2(5, 0); combat.update(0.25, actors); assert.equal(target.health, 9700);
  combat.update(0.25, actors); assert.equal(target.health, 9700); assert.equal(combat.areaSnapshots().length, 0); assert.equal(source.energy, 10);
});

test("areas can affect later entrants after their initially selected victim escapes", () => {
  const source = actor("source", 0, "player"), target = actor("target", 5), entrant = actor("entrant", 12), actors = [source, target, entrant], combat = new CombatSystem();
  combat.use(source, target, { ...field(), windup: 0.5 }, actors); target.position = new Vector2(12, 0);
  combat.update(0.5, actors); assert.equal(combat.areaSnapshots()[0].x, 5); assert.equal(source.energy, 0);
  entrant.position = new Vector2(5, 0); combat.update(0.25, actors); assert.equal(entrant.health, 9900); assert.equal(source.energy, 10);
});

test("per-target limits survive exit and reentry while allowing a different target", () => {
  const source = actor("source", 0, "player"), first = actor("first", 5), second = actor("second", 10), combat = new CombatSystem(), actors = [source, first, second];
  combat.use(source, first, field({ ...zone, hitsPerTarget: 1 }), actors);
  first.position = new Vector2(10, 0); combat.update(0.25, actors);
  first.position = new Vector2(5, 0); second.position = new Vector2(5, 0); combat.update(0.25, actors);
  assert.equal(first.health, 9900); assert.equal(second.health, 9900);
});

test("self-centered healing areas retain the friendly camp", () => {
  const source = actor("source", 0, "player"), ally = actor("ally", 1, "player"), enemy = actor("enemy", 1), combat = new CombatSystem();
  source.health = ally.health = enemy.health = 500;
  combat.use(source, source, { ...field({ ...zone, followCaster: true, effects: [{ at: 0, type: "heal", power: 1 }] }), target: "self", type: "buff" }, [source, ally, enemy]);
  assert.equal(source.health, 600); assert.equal(ally.health, 600); assert.equal(enemy.health, 500);
});

test("area healing selects each ally once per tick and keeps paired effects on the same recipients", () => {
  const source = actor("source", 0, "player"), allies = Array.from({ length: 6 }, (_, index) => actor(`ally_${index}`, 1, "player")), combat = new CombatSystem();
  for (const ally of allies) ally.health = 100;
  const heal = (power: number) => [{ at: 0, type: "heal" as const, power, recipient: "allies" as const, targetCount: 5 },
    { at: 0, type: "status" as const, recipient: "allies" as const, targetCount: 5, status: { id: "mark", duration: 0.5 } }];
  const area: AreaEffectDefinition = { ...zone, duration: 10, interval: 1, target: "ally", effects: heal(1.5), maxTicks: 5,
    phases: [{ throughTick: 1, effects: heal(1.5) }, { throughTick: 2, effects: heal(0.75) }, { throughTick: 5, effects: heal(0.25) }] };
  combat.use(source, source, { ...field(area), target: "self", type: "buff" }, [source, ...allies]);
  assert.equal(allies[0].hasStatus("mark"), true); assert.equal(allies[5].hasStatus("mark"), false);
  for (let tick = 0; tick < 6; tick++) combat.update(1, [source, ...allies]);
  const heals = combat.events.filter((event) => event.type === "heal");
  assert.equal(heals.length, 25); assert.equal(heals.reduce((total, event) => total + event.value!, 0), 1500);
});

test("source area mode limits override ordinary per-action target counts", () => {
  for (const mode of ["pve", "pvp"] as const) {
    const source = actor("source", 0, "player"), targets = Array.from({ length: 6 }, (_, index) => actor(`target_${index}`, 1));
    const combat = new CombatSystem(undefined, mode);
    combat.use(source, targets[0], field({ ...zone, maxTargets: 20, pvpMaxTargets: 4, effects: [{ at: 0, type: "damage", power: 1, targetCount: 4 }] }), [source, ...targets]);
    assert.equal(targets.filter((target) => target.health < 10000).length, mode === "pve" ? 6 : 4);
  }
});

test("area ticks apply and refresh source stacks before evaluating stack-dependent damage", () => {
  const source = actor("source", 0, "player"), target = actor("target", 5), combat = new CombatSystem(), actors = [source, target];
  const poison: AreaEffectDefinition = { ...zone, duration: 2.01, interval: 0.5, effects: [
    { at: 0, type: "status", status: { id: "poison", duration: 0.6, maxStacks: 4 } },
    { at: 0, type: "damage", power: 0, powerPerStack: { group: "poison", amount: 0.5 } }] };
  combat.use(source, target, field(poison), actors);
  for (let tick = 0; tick < 4; tick++) combat.update(0.5, actors);
  assert.deepEqual(combat.events.filter((event) => event.type === "damage").map((event) => event.value), [50, 100, 150, 200, 200]);
  combat.update(0.6, actors); assert.equal(target.statusStacks("poison"), 0);
});

test("following fields use their source position, while return and reset discard pending area actions", () => {
  const source = actor("source", 0, "player"), target = actor("target", 1), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, field({ ...zone, followCaster: true }), actors);
  source.position = new Vector2(10, 0); combat.update(0.25, actors); assert.equal(target.health, 9900); assert.equal(combat.areaSnapshots()[0].x, 10);
  combat.resetEngagement(); assert.equal(combat.areaSnapshots().length, 0);
  target.position = new Vector2(11, 0);
  combat.use(source, target, field({ ...zone, followCaster: true, effects: [{ at: 0.5, type: "damage", power: 5 }] }), actors);
  source.setState("returning"); combat.update(0.6, actors); assert.equal(target.health, 9900); assert.equal(combat.areaSnapshots().length, 0);
});

test("homing impacts can create areas that remain after the projectile disappears", () => {
  const source = actor("source", 0, "player"), target = actor("target", 5), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, { ...field(), projectileSpeed: 10, projectileLifetime: 2, projectileHoming: true }, actors);
  combat.update(0.5, actors); assert.equal(combat.projectileSnapshots().length, 0); assert.equal(combat.areaSnapshots()[0].x, 5); assert.equal(target.health, 9900);
  combat.update(1, actors); assert.equal(combat.areaSnapshots().length, 0); assert.equal(target.health, 9600);
});

test("warning tracking locks at its configured time before a ground area is created", () => {
  const source = actor("source", 0, "player"), target = actor("target", 5), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, { ...field(), windup: 1, trackTargetFor: 0.5 }, actors);
  target.position = new Vector2(6, 0); combat.update(0.25, actors);
  target.position = new Vector2(8, 0); combat.update(0.25, actors);
  target.position = new Vector2(12, 0); combat.update(0.25, actors); assert.equal(combat.castSnapshots()[0].point.x, 8);
  combat.update(0.25, actors); assert.equal(combat.areaSnapshots()[0].x, 8); assert.equal(target.health, 10000);
});

test("channeled movement starts after its offset and following line fields turn toward the target", () => {
  const source = actor("source", 0, "player"), target = actor("target", 3), combat = new CombatSystem(), actors = [source, target];
  combat.use(source, target, { ...field({ ...zone, duration: 3, followCaster: true, turnSpeedDegrees: 90, geometry: { shape: "line", width: 1, radius: 5 } }),
    windup: 1, castDuration: 3, channelMove: { speed: 2, start: 1 } }, actors);
  combat.update(1, actors); assert.equal(source.position.x, 0);
  target.position = new Vector2(0, 3); combat.update(0.5, actors); assert.equal(source.position.x, 1); assert.ok(combat.areaSnapshots()[0].directionY > 0);
  combat.update(0.5, actors); assert.ok(source.position.y > 0); assert.equal(combat.areaSnapshots()[0].x, source.position.x);
});

test("source scene actions become an independent timeline with source geometry and stack coefficients", () => {
  const compiler = createReferenceSkillCompiler((family) => family === "Buff" ? { id: 7, duration: 1000, overlieAddEffect: 4 } : {
    skillType: 2, preTime: 500, frameKey: "[key:3_action:[sceneSpriteAction,1000,250,circle,2,9]]", sceneSpriteActions: "[key:0_action:[addBuffAction,7,0]|[damageByBuffAction,0,7,5000]]",
    skillTagActions: "[warnFollowBreakTag,250]" });
  const skill = compiler.compile(1), area = skill.actions[0].areaEffect;
  assert.equal(skill.actions[0].at, 0.5); assert.equal(skill.trackTargetFor, 0.25);
  assert.deepEqual(area.geometry, { shape: "circle", radius: 2 }); assert.equal(area.duration, 1); assert.equal(area.interval, 0.25);
  assert.equal(area.effects[0].at, 0); assert.deepEqual(area.effects[1].powerPerStack, { group: "7", amount: 0.5 }); assert.equal(area.effectKey, "reference_effect_9");
});

test("unsupported randomized source layouts stay audited instead of stacking fields at one point", () => {
  const compiler = createReferenceSkillCompiler(() => ({ skillType: 2, frameKey: "[key:0_action:[sceneSpriteAction,1000,250,circle,2,9]]",
    sceneSpriteActions: "[key:0_action:[damageAction,10000]]", skillTagActions: "[warnRandomLineTag,0,0,1_2_3_4]" }));
  assert.equal(compiler.compile(1).actions.length, 0); assert.ok(compiler.issues.some((issue) => issue.kind === "area_layout"));
});

test("persistent area validation rejects invalid intervals and recursive spawning", () => {
  const config: DemoConfig = { seed: 1, world: { width: 20, height: 20, cellSize: 1 }, fog: { cellSize: 1, revealRadius: 2 },
    squad: { actors: [{ id: "hero", kind: "hero", x: 2, y: 2, hp: 100, attack: 0, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 1 }] }, enemies: [],
    skills: { player: { id: "p", range: 1, cooldown: 1, power: 0, target: "enemy" }, enemy: { id: "e", range: 1, cooldown: 1, power: 0, target: "enemy" } } };
  for (const area of [{ ...zone, interval: 0 }, { ...zone, effects: [{ at: 0, type: "area" as const, areaEffect: zone }] }]) {
    const invalid = structuredClone(config); invalid.skills.definitions = [{ ...field(area), type: "damage", coefficient: 0 }];
    assert.throws(() => new DemoSession(invalid), /Invalid persistent area/);
  }
});
