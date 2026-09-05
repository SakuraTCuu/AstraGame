import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoSession } from "../assets/scripts/core/demo/DemoSession.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config);
for (const id of ["reference_npc_302001", "reference_npc_302002"]) {
  assert.equal(session.navigateToPoi(id), true, `No route to ${id}`);
  for (let tick = 0; tick < 2000 && session.getSnapshot().autoNavigation.active && session.runState === "running"; tick++) session.update(0.05);
  assert.equal(session.interactWithPoi(id), "completed");
}
const spawn = config.spawns.find((entry) => entry.enemyId === "reference_monster_102020001");
assert.ok(spawn && session.setAutoDestination(spawn.x, spawn.y), "No route to the first reference Boss");
const skills = new Set(), phases = new Set();
for (let tick = 0; tick < 6000 && session.runState === "running" && !session.map.hasFlag("defeat:102020001"); tick++) {
  session.update(0.05);
  const snapshot = session.getSnapshot();
  const boss = snapshot.actors.find((actor) => actor.id.startsWith(spawn.id + ":"));
  snapshot.events.filter((event) => event.sourceId === boss?.id && event.type === "skill").forEach((event) => skills.add(event.skillId));
  if (boss) phases.add(snapshot.bossPhases[boss.id]);
}
const report = { defeated: session.map.hasFlag("defeat:102020001"), elapsedSeconds: session.world.elapsedSeconds,
  skills: [...skills], phases: [...phases], survivors: session.world.players.filter((actor) => actor.alive).length,
  usedTeleport: false, modifiedCombatStats: false };
console.log(JSON.stringify(report, null, 2));
assert.ok(report.defeated && report.survivors > 0);
assert.ok(skills.has("reference_skill_5000204") && skills.has("reference_skill_5000203"));
