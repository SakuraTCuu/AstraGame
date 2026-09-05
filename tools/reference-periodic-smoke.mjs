import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config);
const reports = [];
for (const sourceId of [2, 26]) {
  const source = session.roster.actor(`reference_hero_${sourceId}`);
  assert.ok(source, "Source hero profile is missing");
  const hero = config.roster.heroes.find((hero) => hero.id === source.id);
  session.map.grantResources({ [hero.cardResource]: 1 }); session.roster.syncOwnership();
  const development = config.development.heroes.find((hero) => hero.actorId === source.id);
  const costs = {};
  for (const row of config.development.levelTables[development.levelTable].filter((row) => row.level < 10))
    for (const [id, amount] of Object.entries(row.cost)) costs[id] = (costs[id] || 0) + amount;
  session.map.grantResources(costs);
  session.map.setRank(config.development.ranks.find((rank) => rank.heroLevelLimit >= 10).rank);
  while (session.development.levelOf(source.id) < 10) assert.equal(session.upgradeHero(source.id), "completed");
  assert.equal(source.stats.maxEnergy, 10000);
  source.gainEnergy(source.stats.maxEnergy);
  const target = new Actor({ id: "periodic_probe", faction: "enemy", position: { x: source.position.x + 20, y: source.position.y },
    stats: { maxHealth: 100000, attack: 0, defense: 0, moveSpeed: 0, attackRange: 0, aggroRange: 0 } });
  const combat = new CombatSystem(() => 0.99), actors = [source, target], events = [];
  let elapsed = 0;
  const advance = (seconds) => {
    while (elapsed + 1e-9 < seconds) {
      combat.update(0.05, actors); elapsed += 0.05;
      events.push(...combat.drainEvents().map((event) => ({ ...event, at: Number(elapsed.toFixed(2)) })));
    }
  };
  const use = (id) => {
    const skill = session.world.options.skillDefinitions[`reference_skill_${id}`];
    assert.ok(skill, `Missing skill ${id}`);
    assert.equal(combat.use(source, target, skill, actors), true, `Cannot cast ${id}`);
  };
  if (sourceId === 2) {
    use(10020101); advance(4);
    const ticks = events.filter((event) => event.periodic);
    assert.equal(ticks.length, 3);
    assert.ok(Math.abs(ticks[1].at - ticks[0].at - 1) < 1e-8);
    assert.ok(Math.abs(ticks[2].at - ticks[1].at - 1) < 1e-8);
    assert.ok(ticks.every((event) => event.damageType === "soul" && event.sourceId === source.id));
    assert.equal(target.statusSnapshots().length, 0);
  } else {
    use(10260201); advance(5); use(10260201); advance(7);
    assert.equal(target.statusSnapshots()[0].stacks, 2);
    use(10260101); advance(9);
    const settlement = events.filter((event) => event.periodic && event.skillId === "reference_skill_10260101");
    assert.equal(settlement.length, 2);
    assert.equal(settlement[0].at, settlement[1].at);
    assert.equal(target.statusSnapshots()[0].stacks, 2);
    assert.ok(events.some((event) => event.type === "damage" && !event.periodic && event.damageType === "physical"));
  }
  reports.push({ sourceId, name: source.displayName, attack: source.attackPower, healthLost: target.stats.maxHealth - target.health,
    statuses: target.statusSnapshots(), damage: events.filter((event) => event.type === "damage").map(({ at, value, skillId, damageType, periodic }) => ({ at, value, skillId, damageType, periodic: Boolean(periodic) })) });
}
console.log(JSON.stringify({ setup: "Source heroes upgraded to level 10 using fixture ownership/rank/materials, then tested against a stationary durable target with prefilled energy; no live-account changes", reports }, null, 2));
