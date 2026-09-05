import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../assets/scripts/framework/EventBus.ts";
import { FixedStepRunner } from "../assets/scripts/framework/FixedStepRunner.ts";

test("event bus preserves synchronous order and once semantics", () => {
  const bus = new EventBus();
  const received: string[] = [];
  bus.on<string>("state", (value) => received.push(`always:${value}`));
  bus.once<string>("state", (value) => received.push(`once:${value}`));

  bus.emit("state", "explore");
  bus.emit("state", "combat");

  assert.deepEqual(received, ["always:explore", "once:explore", "always:combat"]);
});

test("fixed step runner caps catch-up work and reports dropped time", () => {
  const runner = new FixedStepRunner(0.05, 3);
  let ticks = 0;
  const result = runner.advance(0.25, () => {
    ticks += 1;
  });

  assert.equal(ticks, 3);
  assert.equal(result.steps, 3);
  assert.ok(result.droppedTime >= 0.05);
  assert.ok(result.interpolation >= 0 && result.interpolation < 1);
});

