import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, Vector2 } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), definitions = session.world.options.skillDefinitions;
const actor = (id, faction, x, y = 0) => new Actor({ id, faction, position: { x, y },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 1000, aggroRange: 1000, maxEnergy: 10000 } });
const reports = [];
const source = actor("boss", "enemy", 0), chosen = actor("chosen", "player", 100), occupant = actor("occupant", "player", 100), actors = [source, chosen, occupant];
source.health = 4000;
const combat = new CombatSystem(), hits = [];
assert.equal(combat.use(source, chosen, definitions.reference_skill_5000604, actors), true);
for (let tick = 1; tick <= 100; tick++) {
  if (tick === 42) chosen.position = new Vector2(500, 0);
  combat.update(0.05, actors);
  hits.push(...combat.drainEvents().filter((event) => event.type === "damage" && event.targetId === occupant.id).map((event) => event.value));
}
assert.deepEqual(hits, [50, 100, 150, 200, 200]); assert.equal(chosen.health, 10000);
const area = combat.areaSnapshots()[0]; assert.equal(area.x, 100);
occupant.position = new Vector2(500, 0); const health = occupant.health;
for (let tick = 0; tick < 170; tick++) combat.update(0.05, actors);
assert.equal(occupant.health, health); assert.equal(combat.areaSnapshots().length, 0);
reports.push({ phase: "source_poison", damage: hits, lockedCenter: area.x, dodgerHealth: chosen.health, stoppedAfterExit: true, expired: true });
const auraSource = actor("lich", "enemy", 0), auraTarget = actor("aura_target", "player", 100), auraCombat = new CombatSystem();
assert.equal(auraCombat.use(auraSource, auraTarget, definitions.reference_skill_5001202, [auraSource, auraTarget]), true);
for (let tick = 0; tick < 70; tick++) auraCombat.update(0.05, [auraSource, auraTarget]);
assert.ok(auraSource.position.x > 90); assert.equal(auraCombat.areaSnapshots()[0].x, auraSource.position.x);
reports.push({ phase: "source_following_aura", sourceX: auraSource.position.x, areaX: auraCombat.areaSnapshots()[0].x });
const healer = actor("healer", "player", 0), allies = Array.from({ length: 5 }, (_, index) => actor(`ally_${index}`, "player", 20 + index * 10));
for (const ally of allies) ally.health = 1000;
healer.gainEnergy(10000); const healing = new CombatSystem();
const healingActors = [healer, ...allies, actor("healing_enemy", "enemy", 100)];
assert.equal(healing.use(healer, allies[0], definitions.reference_skill_10440101, healingActors), true);
for (let tick = 0; tick < 120; tick++) healing.update(0.05, healingActors);
const heals = healing.events.filter((event) => event.type === "heal");
assert.equal(heals.length, 25); assert.deepEqual(heals.map((event) => event.value), [...Array(5).fill(150), ...Array(5).fill(75), ...Array(15).fill(25)]);
assert.equal(healing.areaSnapshots().length, 0);
reports.push({ phase: "source_healing_field", heals: heals.length, totalHealing: heals.reduce((total, event) => total + event.value, 0), expired: true });
console.log(JSON.stringify({ setup: "Actual compiled source area skills with fixture positions and stats; unported modifiers, layouts and exact live timing remain separate parity work", reports }, null, 2));
