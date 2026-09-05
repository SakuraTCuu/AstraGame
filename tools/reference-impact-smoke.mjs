import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), id = "reference_hero_10", source = session.roster.actor(id);
const hero = config.roster.heroes.find((entry) => entry.id === id);
session.map.grantResources({ [hero.cardResource]: 1, "item:3": 1000 }); session.roster.syncOwnership();
session.map.setRank(config.development.ranks.find((entry) => entry.heroLevelLimit >= 10).rank);
while (session.development.levelOf(id) < 10) assert.equal(session.upgradeHero(id), "completed");
const enemies = Array.from({ length: 6 }, (_, index) => new Actor({ id: `enemy_${index}`, faction: "enemy",
  position: source.position.add({ x: 10 + index * 10, y: 0 }),
  stats: { maxHealth: 10000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } }));
const ally = new Actor({ id: "ally", faction: "player", position: source.position.add({ x: 0, y: 20 }),
  stats: { maxHealth: 10000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 }, initialHealth: 100 });
const actors = [source, ally, ...enemies], definitions = session.world.options.skillDefinitions, reports = [];
const combat = new CombatSystem(() => 0.3, "pve", definitions);
const advance = (seconds) => { for (let time = 0; time < seconds - 1e-9; time += 0.05) combat.update(0.05, actors); };
const use = (skillId) => assert.equal(combat.use(source, enemies[0], definitions[`reference_skill_${skillId}`], actors), true);
const positions = enemies.map((enemy) => enemy.position);
use(10100201); advance(1.05);
const tacticalEvents = combat.drainEvents(), tacticalDamage = tacticalEvents.filter((event) => event.type === "damage");
assert.equal(tacticalDamage.length, 4); assert.equal(tacticalEvents.filter((event) => event.type === "knockback").length, 4);
const distances = enemies.map((enemy, index) => enemy.position.distance(positions[index]));
distances.forEach((distance, index) => assert.ok(Math.abs(distance - (index < 4 ? 100 : 0)) < 1e-6));
reports.push({ phase: "tactical", damage: tacticalDamage.map((event) => event.value), distances });
enemies.forEach((enemy, index) => { enemy.position = Vector2.from(positions[index]); });
source.health = 100; source.gainEnergy(source.stats.maxEnergy); use(10100101); advance(1.55);
const ultimateEvents = combat.drainEvents(), damage = ultimateEvents.filter((event) => event.type === "damage"), healing = ultimateEvents.filter((event) => event.type === "heal");
assert.equal(damage.length, 6); assert.equal(healing.length, 6);
assert.ok(damage.every((event) => event.value === Math.floor(source.attackPower * 1.2)));
assert.ok(healing.every((event, index) => event.targetId === source.id && event.value === Math.floor(damage[index].value * 0.5)));
assert.equal(ally.health, 100); assert.equal(source.health, 100 + healing.reduce((total, event) => total + event.value, 0));
const ultimateDistances = enemies.map((enemy, index) => enemy.position.distance(positions[index]));
assert.ok(ultimateDistances.every((distance) => Math.abs(distance - 20) < 1e-6));
reports.push({ phase: "ultimate", damage: damage.map((event) => event.value), healing: healing.map((event) => event.value),
  casterHealth: source.health, allyHealth: ally.health, distances: ultimateDistances });
assert.equal(session.setLineup(0, id), true);
const enemy = new Actor({ id: "ai_probe", faction: "enemy", position: source.position.add({ x: 40, y: 0 }),
  stats: { maxHealth: 10000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 250 } });
session.world.addEnemy(enemy);
let autoKnockback = false;
const autoSkills = [];
for (let tick = 0; tick < 60; tick++) {
  session.update(0.05);
  for (const event of session.getSnapshot().events) if (event.type === "skill" && event.sourceId === id) autoSkills.push(event.skillId);
  if (session.getSnapshot().events.some((event) => event.type === "knockback" && event.sourceId === id)) autoKnockback = true;
}
assert.equal(autoKnockback, true, JSON.stringify({ autoSkills, source: { health: source.health, position: source.position, state: source.fsm.state },
  target: { health: enemy.health, position: enemy.position, state: enemy.fsm.state }, skills: source.skillIds }));
console.log(JSON.stringify({ setup: "Source hero 10 at level 10 with fixture ownership/rank/materials, wounded caster and stationary targets; not a live timing measurement",
  hero: source.displayName, attack: source.attackPower, autoKnockback, autoSkills, reports }, null, 2));
