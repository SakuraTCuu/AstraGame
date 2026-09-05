import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config);
const tank = session.roster.actor("reference_hero_10"), healer = session.roster.actor("reference_hero_23");
const blade = session.roster.actor("reference_hero_26"), soul = session.roster.actor("reference_hero_25");
assert.equal(tank.modifier("finalDamageReduction"), 0.3);
assert.equal(tank.modifier("pveDamageReduction"), 0.2);
assert.equal(healer.modifier("maxHealthRate"), 0.05);
assert.equal(blade.modifier("dotDamageBonus"), 0.1);
assert.equal(soul.modifier("soulBonus"), 0.1);
assert.ok(session.world.players.every((actor) => actor.modifier("dotDamageBonus") === 0 && actor.modifier("soulBonus") === 0));

const damage = {};
for (const mode of ["pve", "pvp"]) {
  const target = new Actor({ id: "tank_probe", faction: "player", position: { x: 0, y: 0 }, stats: tank.baseStats });
  const attacker = new Actor({ id: "attacker", faction: "enemy", position: { x: 1, y: 0 },
    stats: { maxHealth: 100, attack: 100, defense: 0, moveSpeed: 0, attackRange: 5, aggroRange: 5 } });
  const combat = new CombatSystem(() => 0.99, mode);
  assert.equal(combat.use(attacker, target, { id: "probe", target: "enemy", range: 5, cooldown: 0, power: 1 }, [attacker, target]), true);
  damage[mode] = combat.drainEvents().find((event) => event.type === "damage").value;
}
assert.ok(damage.pve < damage.pvp);

const entry = config.roster.heroes.find((hero) => hero.id === healer.id);
session.map.grantResources({ [entry.cardResource]: 1 }); session.roster.syncOwnership();
const deployable = session.map.isConditionMet(entry.deployCondition);
assert.equal(session.setLineup(0, healer.id), deployable);
const maxHealth = healer.stats.maxHealth;
assert.equal(maxHealth, Math.floor(healer.baseStats.maxHealth * 1.05));
healer.health = Math.floor(maxHealth / 2);
const initialHealth = healer.health;
healer.addStatus({ id: "temporary_probe", duration: 2, modifiers: { maxHealthRate: 0.5 } });
const save = session.saveExploration(), restored = new DemoSession(config); restored.restoreExploration(save);
const returned = restored.roster.actor(healer.id);
assert.equal(returned.stats.maxHealth, maxHealth);
assert.ok(Math.abs(returned.health - initialHealth) <= 1);
assert.equal(returned.statusSnapshots().length, 0);
console.log(JSON.stringify({ setup: "Source personal traits; fixture ownership and health changes for save validation; isolated PvE/PvP damage probes",
  traits: { tank: tank.stats.modifiers, healer: healer.stats.modifiers, blade: blade.stats.modifiers, soul: soul.stats.modifiers },
  damage, health: { position: deployable ? "active" : "reserve (battle art unavailable)", baseMax: healer.baseStats.maxHealth, traitMax: maxHealth, temporaryMax: healer.stats.maxHealth,
    before: initialHealth, restored: returned.health }, leakedToInitialParty: false }, null, 2));
