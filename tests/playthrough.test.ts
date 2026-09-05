import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DemoSession } from "../assets/scripts/core/index.ts";
import { createExplorationDriver } from "../tools/exploration-playthrough.mjs";

test("shipped map completes through navigation, combat and telegraph dodges without stat changes", () => {
  const config = JSON.parse(readFileSync(new URL("../assets/resources/config/auto_explore/world_demo.json", import.meta.url), "utf8"));
  const session = new DemoSession(config);
  const driver = createExplorationDriver(session);
  for (let tick = 0; tick < 10000 && session.runState === "running"; tick += 1) driver.step();
  const report = driver.report();
  assert.equal(report.state, "won", JSON.stringify(report));
  assert.ok(report.dodges > 0);
  assert.ok(report.phases.includes("phase2") && report.phases.includes("enraged"));
  assert.ok(report.usedSkills.includes("warden_summon") && report.usedSkills.includes("iron_bell") && report.usedSkills.includes("green_mist"));
  assert.equal(report.events.filter((event) => event.type === "encounter_completed" && event.id === "boss_final").length, 1);
});
