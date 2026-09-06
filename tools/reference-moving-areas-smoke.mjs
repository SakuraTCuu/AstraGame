import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, EnemyAI, Vector2 } from "../assets/scripts/core/index.ts";
import { tableRow } from "./reference-cache.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const tables = JSON.parse(readFileSync("reference-private/reference-tables.json", "utf8"));
const compiler = createReferenceSkillCompiler((family, id) => {
  const table = Object.entries(tables).find(([name, value]) => new RegExp(`^${family}(?:_(?:\\d+|Xs))?$`).test(name) && value[id])?.[1];
  return table && tableRow(table, id);
});
const tracking = compiler.compile(5006509);
config.skills.definitions = [...config.skills.definitions.filter((skill) => skill.id !== tracking.id), tracking];
const definitions = new DemoSession(config).world.options.skillDefinitions;
const actor = (id, faction, x, y = 0) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 3000, aggroRange: 3000 } });
const source = actor("source", "enemy", 0), aim = actor("aim", "player", 2500), combat = new CombatSystem(() => 0);
combat.update(0, [source, aim]); new EnemyAI([definitions.reference_skill_5200103]).update(source, [aim], combat, 0.05);
assert.ok(combat.events.some((event) => event.type === "skill" && event.skillId === "reference_skill_5200103"));
const warnings = combat.castSnapshots()[0].warnings;
assert.equal(warnings.length, 4);
assert.equal(new Set(warnings.map((warning) => `${warning.position.x},${warning.position.y}`)).size, 4);
const first = warnings[0], point = Vector2.from(first.position).add(Vector2.from(first.direction).scale(450));
const witness = actor("witness", "player", point.x, point.y), safe = actor("safe", "player", 5000, 5000), actors = [source, aim, witness, safe];
for (let tick = 0; tick < 70; tick++) combat.update(0.05, actors);
const areas = combat.areaSnapshots(); assert.equal(areas.length, 4);
const distances = areas.map((area, index) => Vector2.from(area).distance(warnings[index].position));
assert.ok(distances.every((distance) => Math.abs(distance - 400) < 1e-7));
assert.equal(witness.health, 9800); assert.equal(safe.health, 10000);
assert.ok(witness.hasControl("airborne"));
source.health = 0; combat.update(0.25, actors); assert.equal(combat.areaSnapshots().length, 4);
combat.update(4.4, actors); assert.equal(combat.areaSnapshots().length, 0);
const homingSource = actor("homing_source", "enemy", 0), target = actor("homing_target", "player", 200), homing = new CombatSystem();
assert.equal(homing.use(homingSource, target, definitions[tracking.id], [homingSource, target]), true);
for (let tick = 0; tick < 80; tick++) homing.update(0.05, [homingSource, target]);
const before = homing.areaSnapshots()[0]; assert.ok(Math.abs(before.x - 100) < 1e-7); assert.equal(target.health, 9700);
target.position = new Vector2(200, 200); homing.update(0.5, [homingSource, target]);
const after = homing.areaSnapshots()[0]; assert.ok(Math.abs(Vector2.from(after).distance(before) - 50) < 1e-7); assert.ok(after.directionY > 0);
homing.resetEngagement(); assert.equal(homing.areaSnapshots().length, 0);
console.log(JSON.stringify({ setup: "Actual source route and tracking skills on stationary fixtures; home-relative path selection, terrain and exact live timing remain comparison work",
  routes: { automaticCast: true, count: areas.length, distanceInHalfSecond: distances, witnessDamage: 10000 - witness.health, airborne: true, safeHealth: safe.health, survivesCasterDeath: true, expired: true },
  tracking: { sourceId: 5006509, firstSecondDistance: before.x, damage: 300, turned: true, halfSecondDistance: Vector2.from(after).distance(before), cleaned: true } }, null, 2));
