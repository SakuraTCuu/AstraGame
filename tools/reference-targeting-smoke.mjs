import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, EnemyAI } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), definitions = session.world.options.skillDefinitions;
const hero = (id) => session.roster.actor(config.roster.heroes.find((entry) => entry.sourceId === id).id);
const roles = { tank: hero(10).combatRole, melee: hero(1).combatRole, ranged: hero(13).combatRole, support: hero(8).combatRole };
assert.deepEqual(roles, { tank: "tank", melee: "melee", ranged: "ranged", support: "support" });
const actor = (id, faction, x, role, attack = 100) => new Actor({ id, faction, combatRole: role, position: { x, y: 0 },
  stats: { maxHealth: 10000, attack, defense: 0, moveSpeed: 0, attackRange: 150, aggroRange: 150, leashRange: 1000, maxEnergy: 10000 } });
const source = actor("boss", "enemy", 0), support = actor("support", "player", -80, roles.support), tank = actor("tank", "player", 300, roles.tank);
const melee = actor("melee", "player", -250, roles.melee), ranged = actor("ranged", "player", 200, roles.ranged), players = [support, tank, melee, ranged];
const combat = new CombatSystem(() => 0.99), laser = definitions.reference_skill_5007003;
combat.update(0, [source, ...players]); new EnemyAI([laser]).update(source, players, combat, 0.05);
assert.equal(combat.castSnapshots()[0].targetId, tank.id); assert.equal(source.targetId, support.id);
combat.cancelCaster(source.id); combat.resetEngagement();
tank.health = 0; assert.equal(combat.selectTarget(source, players, laser).id, melee.id);
melee.health = 0; assert.equal(combat.selectTarget(source, players, laser).id, ranged.id);
ranged.health = 0; assert.equal(combat.selectTarget(source, players, laser).id, support.id);
const randomSource = actor("random_boss", "enemy", 0), randomTargets = [100, 200, 250].map((x, index) => actor(`random_${index}`, "player", x));
const random = new CombatSystem(() => 0.99), tornado = definitions.reference_skill_5000503;
random.update(0, [randomSource, ...randomTargets]); new EnemyAI([tornado]).update(randomSource, randomTargets, random, 0.05);
assert.equal(random.castSnapshots()[0].targetId, "random_2"); assert.equal(randomSource.targetId, "random_0");
random.update(3.05, [randomSource, ...randomTargets]); assert.equal(random.projectileSnapshots()[0].targetId, "random_2");
const strongestSource = actor("hero_31", "player", 0, hero(31).combatRole), targets = [20, 500, 300, 400].map((attack, index) => actor(`attack_${index}`, "enemy", 20 + index * 20, undefined, attack));
const strongest = new CombatSystem(), ultimate = definitions.reference_skill_10310101;
strongestSource.gainEnergy(10000); strongest.update(0, [strongestSource, ...targets]);
const chosen = strongest.selectTarget(strongestSource, targets, ultimate); assert.equal(chosen.id, "attack_1");
assert.equal(strongest.use(strongestSource, chosen, ultimate, [strongestSource, ...targets]), true);
strongest.update(1, [strongestSource, ...targets]);
const damaged = strongest.events.filter((event) => event.type === "damage").map((event) => event.targetId);
assert.deepEqual(damaged, ["attack_1", "attack_3", "attack_2"]); assert.equal(targets[0].health, 10000);
console.log(JSON.stringify({ setup: "Actual source selector rules and roster professions on fixture positions/stats; unknown selectors, summon priority and remaining hero-31 effects remain separate parity work",
  roles, laser: { engagement: support.id, cast: tank.id, fallback: [melee.id, ranged.id, support.id] },
  tornado: { engagement: randomSource.targetId, cast: "random_2", released: true }, highestAttack: { first: chosen.id, damaged } }, null, 2));
