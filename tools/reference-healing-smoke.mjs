import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), id = "reference_hero_16", source = session.roster.actor(id);
const hero = config.roster.heroes.find((entry) => entry.id === id);
session.map.grantResources({ [hero.cardResource]: 1, "item:3": 1000 }); session.roster.syncOwnership();
session.map.setRank(config.development.ranks.find((entry) => entry.heroLevelLimit >= 10).rank);
while (session.development.levelOf(id) < 10) assert.equal(session.upgradeHero(id), "completed");
const allies = Array.from({ length: 5 }, (_, index) => new Actor({ id: `ally_${index}`, faction: "player", position: { x: source.position.x + 20 * (index + 1), y: source.position.y },
  stats: { maxHealth: 10000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } }));
const npc = new Actor({ id: "npc", faction: "enemy", position: { x: source.position.x + 10, y: source.position.y },
  stats: { maxHealth: 100000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
const actors = [source, ...allies, npc], definitions = session.world.options.skillDefinitions;
const combat = new CombatSystem(() => 0.3, "pve", definitions);
const reports = [];
let time = 0;
const advance = (until) => { while (time + 1e-9 < until) { combat.update(0.05, actors); time += 0.05; } };
const wound = () => { for (const ally of allies) ally.health = 1000; };
const use = (skillId, target) => assert.equal(combat.use(source, target, definitions[`reference_skill_${skillId}`], actors), true, `Cannot cast ${skillId}`);
const record = (phase) => {
  const events = combat.drainEvents();
  const result = { phase, healing: events.filter((event) => event.type === "heal").map(({ skillId, targetId, value }) => ({ skillId, targetId, value })),
    cleanses: events.filter((event) => event.type === "cleanse").length, triggered: events.filter((event) => event.type === "skill" && event.triggered).length };
  reports.push(result); return result;
};
wound(); use(10160001, allies[0]); advance(1.3);
const normal = record("normal"); assert.equal(normal.healing.length, 1); assert.equal(normal.healing[0].value, Math.floor(source.attackPower * 0.7));
wound(); use(10160201, source); advance(2);
const extra = record("tactical_release"); assert.equal(extra.healing.length, 3); assert.equal(extra.triggered, 1);
assert.ok(extra.healing.every((event) => event.value === Math.floor(source.attackPower * 1.4)));
wound(); use(10160001, allies[0]); advance(3.4);
const empowered = record("empowered_normal"); assert.equal(empowered.healing.length, 3);
assert.ok(empowered.healing.every((event) => event.value === Math.floor(source.attackPower * 1.4)));
advance(5.1); assert.equal(source.hasStatus("101601"), false);
wound();
for (const ally of allies) {
  ally.addStatus({ id: "npc_slow", duration: 30, harmful: true, modifiers: { movementBonus: -1 } }, npc);
  ally.addStatus({ id: "player_heal_cut", duration: 30, harmful: true, modifiers: { healReduction: 0.5 } }, source);
}
source.gainEnergy(source.stats.maxEnergy); use(10160101, allies[0]); advance(6.5);
const ultimate = record("ultimate_cleanse"); assert.equal(ultimate.healing.length, 5); assert.equal(ultimate.cleanses, 5);
assert.ok(allies.every((ally) => !ally.hasStatus("npc_slow") && ally.hasStatus("player_heal_cut")));
for (const ally of allies) ally.recoverAt(ally.position);
wound(); use(10160001, allies[0]); advance(7.9);
assert.equal(record("expired_normal").healing.length, 1);
assert.equal(session.setLineup(0, id), true);
for (const ally of session.world.players) if (ally !== source) ally.health = 1;
source.energy = 0;
session.world.addEnemy(new Actor({ id: "ai_probe", faction: "enemy", position: { x: source.position.x + 20, y: source.position.y },
  stats: { maxHealth: 100000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } }));
const autoSkills = new Set();
for (let tick = 0; tick < 80; tick++) {
  session.update(0.05);
  for (const event of session.getSnapshot().events) if (event.type === "skill" && event.sourceId === id) autoSkills.add(event.skillId);
}
assert.ok(autoSkills.has("reference_skill_10160201") && autoSkills.has("reference_skill_10160701"), "Party AI did not activate the configured healing trigger");
console.log(JSON.stringify({ setup: "Source hero 16 at level 10 with fixture ownership/rank/materials and injured stationary allies; NPC/player statuses supplied for cleanse validation",
  hero: source.displayName, attack: source.attackPower, autoSkills: [...autoSkills], reports }, null, 2));
