import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, EnemyAI } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), definitions = session.world.options.skillDefinitions;
const actor = (id, faction, x, y = 0) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 300, aggroRange: 1000 } });
const tornado = definitions.reference_skill_5000503, source = actor("boss", "enemy", 0);
const first = actor("first", "player", 150), second = actor("second", "player", 250), dodger = actor("dodger", "player", 250, 180);
const actors = [source, first, second, dodger], combat = new CombatSystem(() => 0.5), ai = new EnemyAI([tornado]);
const hits = [], counts = [];
for (let tick = 1; tick <= 130; tick++) {
  combat.update(0.05, actors); ai.update(source, [first, second, dodger], combat, 0.05);
  for (const event of combat.drainEvents()) if (event.type === "damage") hits.push({ target: event.targetId, at: tick * 0.05, damage: event.value });
  counts.push(combat.projectileSnapshots().length);
}
assert.equal(Math.max(...counts), 1); assert.equal(combat.projectileSnapshots().length, 0);
assert.equal(dodger.health, 10000);
for (const target of [first, second]) {
  const damage = hits.filter((hit) => hit.target === target.id);
  assert.equal(damage.length, 2); assert.ok(damage[0].at >= 3);
  assert.ok(Math.abs(damage[1].at - damage[0].at - 1) < 1e-6); assert.ok(damage.every((hit) => hit.damage === 200));
}
const hero = actor("hero", "player", 0), targets = [350, 450, 550, 650].map((x, index) => actor(`target_${index}`, "enemy", x));
const piercing = new CombatSystem(() => 0.5), soul = definitions.reference_skill_10250201;
assert.equal(piercing.use(hero, targets[0], soul, [hero, ...targets]), true);
for (let tick = 0; tick < 50; tick++) piercing.update(0.05, [hero, ...targets]);
assert.ok(targets.slice(0, 3).every((target) => target.health < 10000)); assert.equal(targets[3].health, 10000);
assert.equal(piercing.projectileSnapshots().length, 0);
assert.ok(config.presentation.reference.projectiles.reference_skill_5000503);
console.log(JSON.stringify({ setup: "Actual source skills on stationary fixture actors; source attack/HP fixed for isolated collision and cadence checks",
  tornado: { automaticCast: true, hits, dodgerHealth: dodger.health, maxProjectiles: Math.max(...counts), cleaned: true,
    art: config.presentation.reference.projectiles.reference_skill_5000503 },
  piercing: { targetHealth: targets.map((target) => target.health), hitBudget: soul.directionalProjectile.maxHits } }, null, 2));
