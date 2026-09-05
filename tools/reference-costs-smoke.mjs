import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config), definitions = session.world.options.skillDefinitions;
const actor = (id, faction, x = 0) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 1000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 1000, aggroRange: 1000, maxEnergy: 10000 } });
const source = actor("source", "player"), target = actor("target", "enemy", 50), actors = [source, target], reports = [];
const ultimate = definitions.reference_skill_10370201, combat = new CombatSystem(() => 0.5, "pve", definitions);
assert.equal(ultimate.energyCost, 10000); assert.equal(ultimate.healthCost.fraction, 0.2);
assert.equal(combat.use(source, target, ultimate, actors), false); assert.equal(source.health, 1000);
source.gainEnergy(10000); assert.equal(combat.use(source, target, ultimate, actors), true);
assert.equal(source.health, 800); assert.equal(source.energy, 0);
reports.push({ phase: "source_compound_cost", blockedWithoutEnergy: true, health: source.health, energy: source.energy,
  costs: combat.events.filter((event) => event.type === "resource_cost").map(({ resource, value }) => ({ resource, value })) });
combat.resetEngagement(); source.recoverAt(source.position);
const fill = definitions.reference_skill_10470201, charged = definitions.reference_skill_10470501;
assert.equal(combat.canUse(source, charged), false);
assert.equal(combat.use(source, source, fill, actors), true); assert.equal(source.skillEnergy, 1);
combat.update(1.05, actors); assert.equal(combat.use(source, target, charged, actors), true); assert.equal(source.skillEnergy, 0);
combat.update(1.1, actors); assert.equal(combat.canUse(source, charged), false);
reports.push({ phase: "source_charge_skill", filled: 1, remaining: source.skillEnergy, cannotRepeatWithoutCharge: true });
combat.resetEngagement(); source.recoverAt(source.position);
const base = definitions.reference_skill_10250201, enhanced = definitions.reference_skill_10250501;
combat.update(0, actors);
assert.equal(combat.canUse(source, base), true); assert.equal(combat.canUse(source, enhanced), false);
source.gainSkillEnergy(3); assert.equal(combat.canUse(source, base), false); assert.equal(combat.use(source, target, enhanced, actors), true);
assert.equal(source.skillEnergy, 0);
reports.push({ phase: "source_enhanced_gate", setup: "three fixture charges; zero-star source base does not generate them", consumed: 3, remaining: source.skillEnergy });
combat.resetEngagement(); source.recoverAt(source.position);
const generate = definitions.reference_skill_5200402, consume = definitions.reference_skill_5200403;
assert.equal(combat.use(source, target, consume, actors), false);
assert.equal(combat.use(source, target, generate, actors), true); combat.update(3.05, actors);
assert.equal(source.skillEnergy, 2);
for (let index = 0; index < 2; index++) { assert.equal(combat.use(source, target, consume, actors), true); combat.update(3.05, actors); }
assert.equal(source.skillEnergy, 0); assert.equal(combat.canUse(source, consume), false);
reports.push({ phase: "source_boss_charge", seededGain: 2, paidCasts: 2, exhausted: true });
console.log(JSON.stringify({ setup: "Actual compiled source skills on fixture actors; HP basis/nonlethal policy and charge gain interpretations still require live comparison", reports }, null, 2));
