import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession, EnemyAI } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), definitions = session.world.options.skillDefinitions;
const profile = config.roster.heroes.find((entry) => entry.sourceId === 31), model = session.roster.actor(profile.id);
const actor = (id, faction, x, attack = 100) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 10000, attack, defense: 0, moveSpeed: 0, attackRange: 300, aggroRange: 500, leashRange: 1000, maxEnergy: 10000 } });
const source = actor("hero31", "player", 0), decoy = actor("decoy", "player", 250), targets = [10, 100, 200, 300].map((attack, index) => actor(`enemy_${index}`, "enemy", 100 + index * 40, attack));
source.gainEnergy(10000);
const combat = new CombatSystem(), actors = [source, decoy, ...targets];
const tactical = { id: "fixture_tactical", target: "enemy", range: 500, power: 1, cooldown: 10, category: "skill", windup: 2 };
const normal = { id: "fixture_normal", target: "enemy", range: 300, power: 1, cooldown: 0, category: "normal" };
for (const target of targets) assert.equal(combat.use(target, decoy, tactical, actors), true);
const ultimate = definitions.reference_skill_10310101, chosen = combat.selectTarget(source, targets, ultimate);
assert.equal(combat.use(source, chosen, ultimate, actors), true); combat.update(0.7, actors);
const affected = targets.filter((target) => target.hasControl("taunt"));
assert.deepEqual(affected.map((target) => target.id), ["enemy_1", "enemy_2", "enemy_3"]);
assert.deepEqual(targets.map((target) => target.health), [10000, 9700, 9700, 9700]);
assert.equal(combat.events.filter((event) => event.type === "cast_cancelled").length, 3);
assert.ok(affected.every((target) => target.tauntTarget === source && target.blocksCasting("skill") && !target.blocksCasting("normal")));
for (const target of affected) new EnemyAI([tactical, normal]).update(target, [source, decoy], combat, 0.05);
assert.ok(affected.every((target) => target.targetId === source.id)); assert.equal(decoy.health, 10000); assert.equal(source.health, 9490);
combat.update(2.6, actors); assert.ok(affected.every((target) => !target.hasControl("taunt") && !target.blocksCasting("skill")));
const charging = actor("charging", "player", 0), chargeTargets = [80, 100, 120].map((x) => actor(`charge_${x}`, "enemy", x)), charge = new CombatSystem();
assert.equal(charge.use(charging, chargeTargets[0], definitions.reference_skill_10310201, [charging, ...chargeTargets]), true);
for (let tick = 0; tick < 52; tick++) charge.update(0.05, [charging, ...chargeTargets]);
assert.equal(chargeTargets.filter((target) => target.hasStatus("reference_buff_103124")).length, 1);
console.log(JSON.stringify({ setup: "Actual source hero-31 actions against stationary fixture stats; forced-source, movement input, attackNotCtrl and the physical modifier sign still require native comparison",
  hero: { id: profile.id, role: model.combatRole, art: Boolean(config.presentation.reference.bindings[profile.id]), deployBlocked: Boolean(profile.deployCondition) },
  ultimate: { affected: affected.map((target) => target.id), damagePerTarget: 300, cancelledTacticals: 3, normalAttacksHitCaster: true, decoyUntouchedDuringTaunt: true, duration: 2.5, expired: true },
  tactical: { targetBuffCount: 1, additionalModifierUnverified: true } }, null, 2));
