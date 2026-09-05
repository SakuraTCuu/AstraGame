import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoSession } from "../assets/scripts/core/demo/DemoSession.ts";

const config = JSON.parse(readFileSync(process.argv[2] || "build/web-mobile/reference-preview/profile.json", "utf8"));
const session = new DemoSession(config);
const completed = [], interactions = [];
for (const id of session.journal.snapshot().rank.next.questIds) assert.equal(session.claimQuest(id), "claimed");
assert.equal(session.promoteRank(), "claimed");
assert.equal(session.map.rank, 2);
for (let index = 0; index < 12; index++) {
  const quest = session.journal.quests.find((entry) => entry.category === "main" && session.journal.state(entry) !== "claimed");
  assert.ok(quest, "Mainline stopped before the first Boss");
  console.log(JSON.stringify({ step: quest.id, state: session.journal.state(quest), elapsed: session.world.elapsedSeconds }));
  if (session.journal.state(quest) === "active") {
    assert.ok(session.navigateToQuest(quest.id), `Quest has no reachable destination: ${quest.id}`);
    for (let tick = 0; tick < 6000 && session.runState === "running" && session.journal.state(quest) !== "ready"; tick++) {
      session.update(0.05);
      if (session.world.path.complete) {
        const leader = session.world.leader;
        const poi = session.map.pois.filter((poi) => poi.interaction && !session.map.isPoiInteracted(poi.id) &&
          (poi.type === "fog_gate" || poi.id === quest.destination?.poiId) && leader.position.distance(poi) <= poi.interaction.radius)
          .sort((a, b) => leader.position.distance(a) - leader.position.distance(b))[0];
        if (poi) { const result = session.interactWithPoi(poi.id); assert.equal(result, "completed", `${poi.id}: ${result}`); interactions.push(poi.id); }
      }
    }
  }
  assert.equal(session.claimQuest(quest.id), "claimed", `Quest stalled: ${quest.id}, state ${session.runState}`);
  completed.push(quest.id);
  session.setAutoDestination(null, null);
  if (quest.id === "reference_quest_11010001") break;
}
assert.ok(completed.includes("reference_quest_11010001"));
assert.equal(session.claimQuest("reference_firstkill_90101"), "claimed");
assert.equal(session.map.resourceBalance("item:52"), 1);
assert.equal(session.claimQuest("reference_firstkill_90101"), "already_claimed");
const restored = new DemoSession(config);
restored.restoreExploration(session.saveExploration());
assert.equal(restored.map.resourceBalance("item:52"), 1);
assert.equal(restored.claimQuest("reference_firstkill_90101"), "already_claimed");
console.log(JSON.stringify({ completed, interactions, rank: session.map.rank, level: session.map.level,
  seals: session.map.resourceBalance("item:52"), vouchers: session.map.resourceBalance("item:2"), elapsed: session.world.elapsedSeconds,
  survivors: session.world.players.filter((actor) => actor.alive).length, usedTeleport: false, modifiedCombatStats: false }, null, 2));
