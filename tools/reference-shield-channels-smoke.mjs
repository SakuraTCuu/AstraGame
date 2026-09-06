import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Actor, BossAI, CombatSystem, DemoSession } from "../assets/scripts/core/index.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const definitions = new DemoSession(config).world.options.skillDefinitions;
const actor = (id, faction, x = 0) => new Actor({ id, faction, position: { x, y: 0 },
  stats: { maxHealth: 10000, attack: 100, defense: 0, moveSpeed: 0, attackRange: 1000, aggroRange: 1000, maxEnergy: 10000 } });
const prepare = () => {
  const source = actor("source", "enemy"), target = actor("target", "player", 300), actors = [source, target], combat = new CombatSystem(() => 0);
  source.health = 3500;
  const ai = new BossAI([5004502, 5004503, 5004505].map((id) => definitions[`reference_skill_${id}`]), [0.35], ["phase1", "phase2"]);
  const releases = [];
  combat.update(0, actors); ai.update(source, [target], combat, 0.05);
  const tick = (seconds) => { for (let tick = 0; tick < Math.round(seconds * 20); tick++) {
    combat.update(0.05, actors); ai.update(source, [target], combat, 0.05);
    for (const event of combat.drainEvents()) if (event.type === "area_created") releases.push(event);
  } };
  return { source, target, actors, combat, ai, tick, releases };
};
const complete = prepare(); complete.tick(15);
assert.equal(complete.source.health, 1500); assert.equal(complete.source.shield, 2000);
assert.equal(complete.releases.length, 8); assert.equal(complete.target.health, 8800); assert.equal(complete.ai.phase, "phase2");
complete.tick(17); assert.equal(complete.source.shield, 0); assert.equal(complete.source.hasStatus("chantBroken"), false);
assert.equal(complete.combat.castSnapshots().length, 0);
const broken = prepare(); broken.tick(3.2);
assert.equal(broken.releases.length, 2); assert.equal(broken.source.shield, 2000);
assert.equal(broken.combat.use(broken.target, broken.source, { id: "fixture_break", target: "enemy", range: 1000, cooldown: 0, power: 20 }, broken.actors), true);
assert.equal(broken.source.health, 1500); assert.equal(broken.source.hasStatus("chantBroken"), true);
assert.equal(broken.combat.castSnapshots().filter((cast) => cast.sourceId === broken.source.id).length, 0);
broken.tick(0.2); assert.equal(broken.source.hasControl("stun"), true); assert.equal(broken.source.hasStatus("chantBroken"), false);
broken.tick(6); assert.equal(broken.source.hasControl("stun"), false); assert.equal(broken.releases.length, 2); assert.equal(broken.combat.areaSnapshots().length, 0);
const converter = actor("converter", "player"), conversionTarget = actor("conversion_target", "enemy", 100), conversion = new CombatSystem(); converter.gainEnergy(10000);
assert.equal(conversion.use(converter, converter, definitions.reference_skill_10320101, [converter, conversionTarget]), true);
conversion.update(2, [converter, conversionTarget]); assert.equal(converter.health, 8200); assert.equal(converter.shield, 3600);
console.log(JSON.stringify({ setup: "Actual source shield/channel/aftermath skills selected by Boss AI on fixture actors; source descriptions, return-to-center, avalanche and live layout remain separate parity work",
  completed: { phase: complete.ai.phase, paidHealth: 2000, shield: 2000, waves: complete.releases.length / 2, damage: 1200, expiredWithoutBreak: true },
  broken: { areasBeforeBreak: 2, laterAreas: broken.releases.length - 2, stateConsumed: true, stunSeconds: 5, recovered: true },
  conversion: { sourceId: 10320101, paidHealth: 1800, shield: converter.shield, energy: converter.energy } }, null, 2));
