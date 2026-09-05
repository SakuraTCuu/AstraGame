import assert from "node:assert/strict";
import test from "node:test";
import { FogGrid, GridNavigation, WorldMap } from "../assets/scripts/core/index.ts";

function createMap() {
  const nav = new GridNavigation(20, 10);
  const fog = new FogGrid(20, 10);
  const map = new WorldMap(nav, fog, { x: 0, y: 0, width: 20, height: 10 }, [
    { id: "entry", rect: { x: 0, y: 0, width: 10, height: 10 }, unlock: "initial" },
    { id: "north", rect: { x: 10, y: 0, width: 10, height: 10 }, unlock: "interact:gate", minimumLevel: 3 },
  ], [
    { id: "supply", type: "reward", x: 2.5, y: 2.5, discoverRadius: 2, interaction: { radius: 2, grants: { incense: 5 } } },
    { id: "gate", type: "portal", x: 8.5, y: 2.5, discoverRadius: 2, interaction: { radius: 2, cost: { resource: "incense", amount: 5 } } },
  ], [], { level: 1, resources: { incense: { name: "Incense", initial: 2 } } });
  return { nav, fog, map };
}

test("paid map interaction charges once and waits for all unlock requirements", () => {
  const { map, nav } = createMap();
  assert.equal(map.interact("gate", { x: 2.5, y: 2.5 }), "out_of_range");
  assert.equal(map.interact("gate", { x: 8.5, y: 2.5 }), "insufficient_resources");
  assert.equal(map.snapshot().resources[0].amount, 2);
  assert.equal(map.interact("supply", { x: 2.5, y: 2.5 }), "completed");
  assert.equal(map.interact("gate", { x: 8.5, y: 2.5 }), "completed");
  assert.equal(map.isPortalActive("gate"), true);
  assert.equal(map.isZoneUnlocked("north"), false);
  assert.equal(map.interact("gate", { x: 8.5, y: 2.5 }), "already_completed");
  assert.equal(map.snapshot().resources[0].amount, 2);
  map.setLevel(3);
  assert.equal(map.isZoneUnlocked("north"), true);
  assert.equal(nav.isWorldWalkable({ x: 15, y: 3 }), true);
});

test("restoring map progress keeps paid portals and rejects incompatible resource data atomically", () => {
  const { map } = createMap();
  map.interact("supply", { x: 2.5, y: 2.5 });
  map.interact("gate", { x: 8.5, y: 2.5 });
  map.setLevel(3);
  const restored = createMap().map;
  restored.restoreProgress(map.saveProgress());
  assert.equal(restored.isZoneUnlocked("north"), true);
  assert.equal(restored.isPortalActive("gate"), true);
  assert.deepEqual(restored.drainEvents(), []);
  const before = restored.saveProgress();
  assert.throws(() => restored.restoreProgress({ ...before, resources: { incense: -1 } }), /Invalid resource/);
  assert.deepEqual(restored.saveProgress(), before);
});
