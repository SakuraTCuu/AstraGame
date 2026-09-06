import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const definitions = new DemoSession(config).world.options.skillDefinitions;
const actor = (id, faction, x, y = 0) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 1000, aggroRange: 1000 } });
const reports = [];
for (const [skillId, count, radius, damage, initialCharges] of [[5200402, 4, 200, 300, 0], [5200403, 6, 300, 300, 1], [5002106, 10, 200, 150, 0]]) {
  const source = actor("boss", "enemy", 0), center = actor("center", "player", 500);
  const targets = Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return actor(`target_${index}`, "player", 500 + Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  source.gainSkillEnergy(initialCharges);
  const actors = [source, center, ...targets], combat = new CombatSystem(() => 0.5), hits = [];
  assert.equal(combat.use(source, center, definitions[`reference_skill_${skillId}`], actors), true);
  for (let tick = 1; tick <= 61; tick++) {
    combat.update(0.05, actors);
    if (tick === 20) {
      const warnings = combat.castSnapshots()[0].warnings;
      assert.equal(warnings.length, count);
      assert.equal(new Set(warnings.map((warning) => `${warning.position.x},${warning.position.y}`)).size, count);
    }
    hits.push(...combat.drainEvents().filter((event) => event.type === "damage").map((event) => ({ targetId: event.targetId, value: event.value, at: tick / 20 })));
  }
  assert.equal(center.health, 10000);
  assert.equal(hits.length, count);
  assert.deepEqual(targets.map((target) => target.health), Array(count).fill(10000 - damage));
  assert.deepEqual(hits.map((hit) => hit.at), skillId === 5002106 ? Array.from({ length: count }, (_, index) => 2 + index / 10) : Array(count).fill(2));
  assert.equal(source.skillEnergy, skillId === 5200402 ? 2 : 0);
  assert.ok(combat.castSnapshots().every((cast) => cast.warnings.length === 0));
  reports.push({ skillId, circles: count, centerHealth: center.health, hits, charges: source.skillEnergy, warningsExpired: true });
}
const source = actor("bone_boss", "enemy", 0), first = actor("first", "player", 250), second = actor("second", "player", -250);
const actors = [source, first, second], combat = new CombatSystem(() => 0);
assert.equal(combat.use(source, first, definitions.reference_skill_5001602, actors), true);
for (let tick = 0; tick < 40; tick++) combat.update(0.05, actors);
const locked = combat.castSnapshots()[0].warnings.map((warning) => warning.position.x);
assert.deepEqual(locked, [250, -250]);
first.position = new Vector2(650, 0); second.position = new Vector2(-650, 0);
for (let tick = 0; tick < 21; tick++) combat.update(0.05, actors);
assert.deepEqual([first.health, second.health], [10000, 10000]);
reports.push({ skillId: 5001602, locked, dodgerHealth: [first.health, second.health], warningsExpired: combat.castSnapshots()[0].warnings.length === 0 });
console.log(JSON.stringify({ setup: "Actual compiled source warning skills with fixture positions and stats; ring anchor, random selection and live release timing remain comparison work", reports }, null, 2));
