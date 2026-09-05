import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DemoSession, FogGrid, GridNavigation, WorldMap } from "../assets/scripts/core/index.ts";
import type { DemoConfig, ExplorationEvent } from "../assets/scripts/core/index.ts";

function explorationConfig(): DemoConfig {
  return {
    seed: 20260905,
    world: {
      width: 40, height: 20, cellSize: 1,
      navigation: { manualResumeDelay: 0.3 },
      obstacles: [{ id: "wall", shape: "rect", x: 6, y: 6, width: 3, height: 7 }],
      pointsOfInterest: [{ id: "key", type: "checkpoint", x: 11.5, y: 5.5, discoverRadius: 1 }],
    },
    fog: { cellSize: 1, revealRadius: 8, unlockZones: [
      { id: "start", rect: { x: 0, y: 0, width: 15, height: 20 }, unlock: "initial" },
      { id: "east", rect: { x: 15, y: 0, width: 15, height: 20 }, unlock: "discover:key" },
      { id: "boss", rect: { x: 30, y: 0, width: 10, height: 20 }, unlock: "clear:gate" },
    ] },
    squad: {
      actors: [0, 1, 2, 3].map((index) => ({
        id: `hero_${index}`, kind: "hero", x: 2.5, y: 5.5 - index,
        hp: 1000, attack: 40, defense: 10, moveSpeed: 8, attackRange: 2, aggroRange: 3,
      })),
      formationOffsets: [{ x: 0, y: 0 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: -2 }],
    },
    enemies: [
      { id: "guard", kind: "normal", x: 20.5, y: 10.5, hp: 20, attack: 1, defense: 0, moveSpeed: 2, attackRange: 1, aggroRange: 3 },
      { id: "boss_template", kind: "boss", x: 34.5, y: 10.5, hp: 200, attack: 1, defense: 0, moveSpeed: 1, attackRange: 1, aggroRange: 3 },
    ],
    skills: {
      player: { id: "strike", range: 2, cooldown: 0.3, power: 1, target: "enemy" },
      enemy: { id: "claw", range: 1, cooldown: 1, power: 1, target: "enemy" },
    },
    spawns: [
      { id: "first_guard", trigger: "distance", x: 20.5, y: 10.5, triggerRadius: 2, enemyId: "guard", count: 1, spawnRadius: 0, encounterId: "gate" },
      { id: "last_guard", trigger: "distance", x: 26.5, y: 10.5, triggerRadius: 2, enemyId: "guard", count: 2, spawnRadius: 0, encounterId: "gate" },
      { id: "boss_spawn", trigger: "zone_unlocked", zoneId: "boss", x: 34.5, y: 10.5, triggerRadius: 8, enemyId: "boss_template", count: 1, spawnRadius: 0 },
    ],
  };
}

function advanceUntil(session: DemoSession, condition: () => boolean, events: ExplorationEvent[] = [], maxTicks = 1000): void {
  for (let tick = 0; tick < maxTicks && !condition(); tick += 1) {
    session.update(0.05);
    events.push(...session.getSnapshot().exploration.events);
    for (const actor of [...session.world.players, ...session.world.enemies]) {
      assert.equal(session.world.options.navigation.isWorldWalkable(actor.position), true, `${actor.id} entered blocked ground`);
    }
  }
  assert.equal(condition(), true, "Exploration did not reach the expected state");
}

test("rectangles and circles block both routes and continuous manual movement", () => {
  const nav = new GridNavigation(12, 12);
  new WorldMap(nav, new FogGrid(12, 12), { x: 0, y: 0, width: 12, height: 12 }, [], [], [
    { id: "rect", shape: "rect", x: 5, y: 5, width: 2, height: 2 },
    { id: "pond", shape: "circle", x: 9, y: 3, radius: 1.5 },
  ]);
  assert.equal(nav.isWorldWalkable({ x: 4.1, y: 5.5 }), false);
  assert.equal(nav.isWorldWalkable({ x: 6.1, y: 5.5 }), true);
  assert.equal(nav.isWorldWalkable({ x: 9.5, y: 3.5 }), false);
  const from = { x: 1.5, y: 5.5 };
  const to = { x: 10.5, y: 5.5 };
  assert.equal(nav.isSegmentWalkable(from, to), false);
  assert.ok(nav.moveWithCollision(from, { x: 9, y: 0 }).x < 4);
  const path = nav.findWorldPath(from, to);
  assert.ok(path.length > 0);
  let previous = from;
  for (const point of path) {
    assert.equal(nav.isSegmentWalkable(previous, point), true);
    previous = point;
  }
});

test("movement cannot tunnel through a corner or leave the world, and slides along walls", () => {
  const nav = new GridNavigation(5, 5, [{ x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.equal(nav.isSegmentWalkable({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }), false);
  const corner = nav.moveWithCollision({ x: 0.5, y: 0.5 }, { x: 4, y: 4 });
  assert.ok(corner.x < 1 && corner.y < 1);
  assert.ok(nav.moveWithCollision({ x: 0.5, y: 0.5 }, { x: -10, y: 0 }).x >= 0);
  const wall = new GridNavigation(5, 5, [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }]);
  const slid = wall.moveWithCollision({ x: 1.5, y: 1.5 }, { x: 1, y: 1 });
  assert.ok(slid.x < 2 && slid.y > 2);
});

test("locked fog stays opaque under reveal and unlocks only after a reachable POI", () => {
  const session = DemoSession.create(explorationConfig());
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.fog.states[5 * 40 + 15], "locked");
  assert.equal(session.setAutoDestination(20.5, 5.5), false);
  assert.equal(session.setAutoDestination(11.5, 5.5), true);
  const events: ExplorationEvent[] = [];
  advanceUntil(session, () => session.map.isZoneUnlocked("east"), events);
  assert.equal(session.world.options.navigation.isWorldWalkable({ x: 20.5, y: 5.5 }), true);
  assert.equal(session.map.isZoneUnlocked("boss"), false);
  assert.notEqual(session.getSnapshot().fog.states[5 * 40 + 15], "locked");
  session.update(1);
  events.push(...session.getSnapshot().exploration.events);
  assert.equal(events.filter((event) => event.type === "zone_unlocked" && event.id === "east").length, 1);
  assert.equal(events.filter((event) => event.type === "poi_discovered" && event.id === "key").length, 1);
});

test("fog distinguishes current visibility from persistent exploration", () => {
  const fog = new FogGrid(10, 10);
  fog.setLocked(2, 2, true);
  fog.reveal({ x: 2.5, y: 2.5 }, 2);
  assert.equal(fog.states()[22], "locked");
  assert.equal(fog.states()[23], "visible");
  fog.reveal({ x: 8.5, y: 8.5 }, 1);
  assert.equal(fog.states()[23], "explored");
  fog.setLocked(2, 2, false);
  assert.equal(fog.states()[22], "hidden");
});

test("manual override preserves the destination and replans after the configured delay", () => {
  const session = DemoSession.create(explorationConfig());
  assert.equal(session.setAutoDestination(11.5, 5.5), true);
  session.update(0.1);
  session.setMoveIntent(-1, 0);
  session.update(0.1);
  assert.equal(session.getSnapshot().autoNavigation.mode, "manual");
  assert.equal(session.getSnapshot().autoNavigation.active, false);
  assert.equal(session.setAutoDestination(35, 10), false);
  assert.equal(session.getSnapshot().autoNavigation.mode, "manual");
  session.setMoveIntent(0, 0);
  session.update(0.25);
  assert.equal(session.getSnapshot().autoNavigation.mode, "resume_wait");
  session.update(0.05);
  assert.equal(session.getSnapshot().autoNavigation.mode, "auto_path");
  advanceUntil(session, () => session.getSnapshot().autoNavigation.mode === "idle");
  assert.ok(session.world.players[0].position.distance({ x: 11.5, y: 5.5 }) < 0.01);
  assert.equal(session.getSnapshot().autoNavigation.destination, null);
});

test("normal movement and combat unlock the boss only after every guard spawn clears", () => {
  const session = DemoSession.create(explorationConfig());
  const events: ExplorationEvent[] = [];
  assert.equal(session.setAutoDestination(11.5, 5.5), true);
  advanceUntil(session, () => session.map.isZoneUnlocked("east"), events);
  assert.equal(session.setAutoDestination(20.5, 10.5), true);
  advanceUntil(session, () => session.getSnapshot().spawns[0].status === "cleared", events);
  assert.equal(session.getSnapshot().spawns[1].status, "pending");
  assert.equal(session.map.isZoneUnlocked("boss"), false);
  assert.equal(session.getSnapshot().spawns[2].status, "pending");
  assert.equal(session.setAutoDestination(26.5, 10.5), true);
  advanceUntil(session, () => session.map.isZoneUnlocked("boss"), events);
  assert.equal(session.setAutoDestination(34.5, 10.5), true);
  advanceUntil(session, () => session.getSnapshot().spawns[2].status === "cleared", events);
  assert.equal(session.getSnapshot().bossPhases["boss_spawn:1"], "dead");
  assert.equal(events.filter((event) => event.type === "encounter_completed" && event.id === "gate").length, 1);
  assert.equal(events.filter((event) => event.type === "zone_unlocked" && event.id === "boss").length, 1);
  assert.equal(session.world.players.every((actor) => actor.alive), true);
  const fresh = DemoSession.create(explorationConfig());
  assert.equal(fresh.map.isZoneUnlocked("east"), false);
  assert.equal(fresh.getSnapshot().spawns.every((spawn) => spawn.status === "pending"), true);
});

test("invalid zone references and overlapping zones fail before the run starts", () => {
  const config = explorationConfig();
  assert.throws(() => DemoSession.create({ ...config, spawns: [{ ...config.spawns![2], zoneId: "missing" }] }), /Unknown spawn zone/);
  assert.throws(() => DemoSession.create({ ...config, spawns: [{ ...config.spawns![2], zoneId: undefined }] }), /requires zoneId/);
  assert.throws(() => DemoSession.create({ ...config, fog: { ...config.fog, unlockZones: [
    ...config.fog.unlockZones!, { id: "overlap", rect: { x: 1, y: 1, width: 2, height: 2 }, unlock: "initial" },
  ] } }), /Overlapping zones/);
});

test("shipped map unlock POIs are reachable from the initial region", () => {
  const config = JSON.parse(readFileSync(new URL("../assets/resources/config/auto_explore/world_demo.json", import.meta.url), "utf8")) as DemoConfig;
  const session = DemoSession.create(config);
  for (const id of ["cache_east", "shrine_west"]) {
    const poi = config.world.pointsOfInterest!.find((entry) => entry.id === id)!;
    assert.ok(session.world.options.navigation.findWorldPath(session.world.players[0].position, poi).length > 0, id);
  }
  assert.equal(session.setAutoDestination(4000, 6240), false);
});
