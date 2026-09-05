import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:4174/?reference=1";
await fetch(url, { signal: AbortSignal.timeout(5000) }).then((response) => { if (!response.ok) throw new Error(`Development server returned ${response.status}`); });
const profile = await mkdtemp(join(tmpdir(), "astra-reference-"));
const output = resolve("temp/qa-reference");
await mkdir(output, { recursive: true });
const port = 9339;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=720,1280", url], { stdio: "ignore" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Map();
const errors = [];
const failures = [];
let socket, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, ...args) => {
  const response = await send("Runtime.evaluate", { expression: `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
const capture = async (name) => {
  const image = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, `${name}.png`), Buffer.from(image.data, "base64"));
};
const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, buttons,
  button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
const screenPoint = (x, y) => evaluate((x, y) => {
  const boot = window.__referenceBoot;
  const world = boot.node.convertToWorldSpaceAR(cc.v2(x, y));
  const viewport = cc.view.getViewportRect(), rect = cc.game.canvas.getBoundingClientRect();
  return { x: rect.left + (viewport.x + world.x * cc.view.getScaleX()) * rect.width / cc.game.canvas.width,
    y: rect.bottom - (viewport.y + world.y * cc.view.getScaleY()) * rect.height / cc.game.canvas.height };
}, x, y);
const clickDesign = async (x, y) => { const point = await screenPoint(x, y); await mouse("mousePressed", point.x, point.y, 1); await mouse("mouseReleased", point.x, point.y); await delay(100); };
const waitReady = async () => {
  for (let index = 0; index < 150; index++) {
    const ready = await evaluate(() => {
      const boot = window.cc && cc.find("Canvas")?.getComponent("DemoBootstrap"); window.__referenceBoot = boot;
      return Boolean(boot?.session && boot.session.world.players.every((actor) => !actor.alive || boot.renderer.referenceArt?.views.has(actor.id)) && boot.renderer.softFogReady);
    });
    if (ready) return true;
    await delay(200);
  }
  return false;
};
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => entry.type === "page"); } catch {}
    if (!target) await delay(100);
  }
  assert.ok(target, "Reference browser did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (pending.has(message.id)) {
      const entry = pending.get(message.id); clearTimeout(entry.timer); pending.delete(message.id);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value || arg.description).join(" "));
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) failures.push(message.params.response.url);
  });
  await send("Runtime.enable");
  await send("Network.enable");
  const ready = await waitReady();
  await capture("initial");
  assert.ok(ready, `Reference view did not initialize: ${errors.join("; ")}`);
  const initial = await evaluate(() => {
    const boot = window.__referenceBoot;
    return { actors: boot.session.getSnapshot().actors.length, tiles: boot.renderer.referenceArt.tiles.size,
      artActors: boot.renderer.referenceArt.views.size, failures: [...boot.renderer.referenceArt.failed],
      world: boot.session.getSnapshot().worldBounds, start: boot.session.world.leader.position, children: boot.node.childrenCount };
  });
  assert.ok(initial.tiles > 0, "No detailed map textures rendered");
  assert.deepEqual(initial.failures, []);
  assert.ok(await evaluate(() => {
    const journal = window.__referenceBoot.renderer.journal;
    return journal.trackerTitle.string.length > 0 && journal.trackerTitle.node.width > 200 && journal.trackerStatus.node.width > 200;
  }), "Quest tracker labels lost their fixed layout dimensions");
  const foreground = await evaluate(() => {
    const renderer = window.__referenceBoot.renderer.referenceArt.foreground;
    const pixels = renderer.maskTexture.readPixels();
    let covered = 0;
    for (let index = 0; index < pixels.length; index += 16) if (pixels[index] > 20) covered++;
    return { polygons: renderer.visiblePolygons, coveredSamples: covered, totalSamples: pixels.length / 16 };
  });
  assert.ok(foreground.polygons > 0 && foreground.coveredSamples > 100 && foreground.coveredSamples < foreground.totalSamples);
  await clickDesign(-310, 300);
  assert.ok(await evaluate(() => window.__referenceBoot.renderer.journal.isOpen && window.__referenceBoot.session.runState === "paused"));
  await clickDesign(214, 484);
  await capture("rank-tasks");
  for (let index = 0; index < 3; index++) { await clickDesign(0, 355 - index * 83); await clickDesign(140, -547); }
  await clickDesign(-170, -547);
  const journal = await evaluate(() => ({ rank: window.__referenceBoot.session.map.rank,
    rankClaims: window.__referenceBoot.session.journal.snapshot().quests.filter((quest) => quest.category === "rank" && quest.state === "claimed").length }));
  assert.ok(journal.rank === 2 && journal.rankClaims === 3, JSON.stringify(journal));
  await capture("rank-promoted");
  await clickDesign(306, 557);
  await clickDesign(-185, 380);
  assert.ok(await evaluate(() => window.__referenceBoot.session.map.hasFlag("quest:10010018") && window.__referenceBoot.session.map.resourceBalance("item:1") === 10));
  await clickDesign(254, 443);
  const overview = await evaluate(() => ({ open: window.__referenceBoot.renderer.overview.isOpen, state: window.__referenceBoot.session.runState,
    scale: window.__referenceBoot.renderer.overview.scale }));
  assert.ok(overview.open && overview.state === "paused");
  await capture("overview");
  const beforePan = await evaluate(() => ({ x: window.__referenceBoot.renderer.overview.center.x, y: window.__referenceBoot.renderer.overview.center.y }));
  const dragFrom = await screenPoint(0, 250), dragTo = await screenPoint(60, 210);
  await mouse("mousePressed", dragFrom.x, dragFrom.y, 1);
  await mouse("mouseMoved", dragTo.x, dragTo.y, 1);
  await mouse("mouseReleased", dragTo.x, dragTo.y);
  assert.ok(await evaluate((before) => Math.hypot(window.__referenceBoot.renderer.overview.center.x - before.x, window.__referenceBoot.renderer.overview.center.y - before.y) > 100, beforePan));
  await mouse("mousePressed", dragTo.x, dragTo.y, 1);
  await mouse("mouseMoved", dragFrom.x, dragFrom.y, 1);
  await mouse("mouseReleased", dragFrom.x, dragFrom.y);
  await clickDesign(300, -380);
  assert.ok(await evaluate((scale) => window.__referenceBoot.renderer.overview.scale > scale, overview.scale));
  await clickDesign(230, -380);
  const gateMarker = await evaluate(() => {
    const marker = window.__referenceBoot.renderer.overview.markers.find((marker) => marker.poi.id === "reference_npc_302001");
    return marker ? { x: marker.point.x, y: marker.point.y + 20 } : null;
  });
  assert.ok(gateMarker, "First fog entrance is absent from the overview");
  await clickDesign(gateMarker.x, gateMarker.y);
  assert.equal(await evaluate(() => window.__referenceBoot.renderer.overview.selectedId), "reference_npc_302001");
  await capture("overview-gate");
  await clickDesign(253, -552);
  const entrance = await evaluate(() => {
    const boot = window.__referenceBoot;
    boot.enabled = false;
    for (let tick = 0; tick < 1600 && boot.session.getSnapshot().autoNavigation.active; tick++) boot.runtime.update(0.05);
    const snapshot = boot.session.getSnapshot();
    for (let frame = 0; frame < 30; frame++) boot.renderer.update(snapshot, 0.1);
    return { active: snapshot.autoNavigation.active, state: snapshot.runState, resources: snapshot.exploration.resources,
      id: boot.renderer.interactionId, x: boot.renderer.interactionPoint.x, y: boot.renderer.interactionPoint.y };
  });
  assert.equal(entrance.id, "reference_npc_302001");
  await delay(400);
  await evaluate(() => window.__referenceBoot.renderer.update(window.__referenceBoot.session.getSnapshot(), 0.1));
  await capture("fog-before");
  await clickDesign(entrance.x, entrance.y);
  const purchased = await evaluate(async () => {
    const boot = window.__referenceBoot;
    const snapshot = boot.runtime.update(0.05);
    boot.renderer.update(snapshot, 0.1);
    await boot.runtime.flushProgress();
    return { unlocked: boot.session.map.isZoneUnlocked("fog_302001"), balance: snapshot.exploration.resources[0].amount,
      position: boot.session.world.leader.position, explored: snapshot.discoveredFogCells.length };
  });
  assert.ok(purchased.unlocked);
  assert.equal(purchased.balance, entrance.resources[0].amount - 5);
  await capture("fog-after");
  await send("Page.reload", { ignoreCache: true });
  assert.ok(await waitReady());
  const restored = await evaluate(() => {
    const boot = window.__referenceBoot; boot.enabled = false;
    return { unlocked: boot.session.map.isZoneUnlocked("fog_302001"), balance: boot.session.map.snapshot().resources[0].amount,
      position: boot.session.world.leader.position, explored: boot.session.getSnapshot().discoveredFogCells.length };
  });
  assert.ok(restored.unlocked && restored.explored >= purchased.explored);
  assert.equal(restored.balance, purchased.balance);
  assert.ok(Math.hypot(restored.position.x - purchased.position.x, restored.position.y - purchased.position.y) < 150);
  await clickDesign(254, 443);
  await evaluate(() => window.__referenceBoot.renderer.update(window.__referenceBoot.session.getSnapshot(), 0.1));
  const homeMarker = await evaluate(() => {
    const marker = window.__referenceBoot.renderer.overview.markers.find((marker) => marker.poi.id === "reference_npc_500000");
    return marker ? { x: marker.point.x, y: marker.point.y + 20 } : null;
  });
  assert.ok(homeMarker);
  await clickDesign(homeMarker.x, homeMarker.y);
  const travel = await evaluate(() => {
    const boot = window.__referenceBoot;
    const home = boot.session.map.pois.find((poi) => poi.id === "reference_npc_500000");
    boot.renderer.update(boot.runtime.update(0.05), 0.1);
    return { distance: boot.session.world.leader.position.distance(home), balance: boot.session.map.snapshot().resources[0].amount,
      overviewClosed: !boot.renderer.overview.isOpen };
  });
  assert.ok(travel.distance < 200 && travel.overviewClosed);
  assert.equal(travel.balance, restored.balance);
  await capture("teleported");
  await evaluate(() => { window.__referenceBoot.enabled = true; });
  if (process.argv.includes("--collision")) {
    await evaluate(() => {
      const boot = window.__referenceBoot, renderer = boot.renderer;
      const node = new cc.Node("CollisionDebug"); node.zIndex = 3; renderer.worldRoot.addChild(node);
      const g = node.addComponent(cc.Graphics); g.fillColor = cc.color(255, 30, 30, 100);
      const config = boot.session.config, cell = config.world.cellSize;
      for (const point of config.world.blocked) { const p = renderer.project({ x: point.x * cell, y: point.y * cell });
        if (Math.abs(p.x) < 450 && Math.abs(p.y) < 750) { g.rect(p.x, p.y, cell * renderer.worldScale, cell * renderer.worldScale * renderer.depthScale); g.fill(); } }
    });
    await delay(100); await capture("collision");
  }
  const movement = await evaluate(() => {
    const boot = window.__referenceBoot;
    const leader = boot.session.world.leader;
    const from = { x: leader.position.x, y: leader.position.y };
    const nav = boot.session.world.options.navigation;
    const targets = [{ x: from.x - 300, y: from.y + 300 }, { x: from.x + 300, y: from.y + 300 }, { x: from.x, y: from.y + 600 }];
    const destination = targets.find((target) => nav.isWorldWalkable(target) && boot.session.setAutoDestination(target.x, target.y));
    if (!destination) return { accepted: false };
    for (let tick = 0; tick < 30; tick++) boot.session.update(0.05);
    boot.renderer.update(boot.session.getSnapshot(), 0.1);
    return { accepted: true, from, to: leader.position, destination, walkable: nav.isWorldWalkable(leader.position) };
  });
  assert.ok(movement.accepted && movement.walkable);
  assert.ok(Math.hypot(movement.to.x - movement.from.x, movement.to.y - movement.from.y) > 20);
  await delay(300);
  await capture("moving");
  const battle = await evaluate(() => {
    const boot = window.__referenceBoot, session = boot.session, leader = session.world.leader;
    const art = boot.renderer.config.presentation.reference;
    const detailedAt = (point) => art.tiles.includes(`${art.mapName}/${Math.floor(point.x / art.tileSize)}_${Math.floor((art.mapHeight - point.y * art.depth) / art.tileSize)}`);
    const targets = session.config.spawns.filter((spawn) => detailedAt(spawn) && session.config.enemies.find((enemy) => enemy.id === spawn.enemyId)?.kind !== "resource")
      .sort((a, b) => Math.hypot(a.x - leader.position.x, a.y - leader.position.y) - Math.hypot(b.x - leader.position.x, b.y - leader.position.y));
    const target = targets.slice(0, 8).find((target) => session.setAutoDestination(target.x, target.y));
    if (!target) return { reached: false };
    for (let tick = 0; tick < 2000 && session.runState === "running"; tick++) {
      session.update(0.05);
      const snapshot = session.getSnapshot();
      if (detailedAt(session.world.leader.position) && snapshot.events.some((event) => event.type === "damage" && event.value > 0 && snapshot.actors.find(actor => actor.id === event.targetId)?.kind !== "resource")) {
        window.__referenceBattle = snapshot;
        boot.enabled = false;
        for (let frame = 0; frame < 30; frame++) boot.renderer.update(snapshot, 0.1);
        boot.renderer.pushCombatFeedback(snapshot);
        return { reached: true, elapsed: snapshot.elapsedSeconds, target: target.id,
          damage: snapshot.events.filter((event) => event.type === "damage"),
          enemies: snapshot.actors.filter((actor) => actor.team === "enemy" && actor.hp > 0).length };
      }
    }
    return { reached: false };
  });
  assert.ok(battle.reached && battle.enemies > 0, "No battle reached by normal navigation");
  await delay(500);
  const battleArt = await evaluate(() => {
    const boot = window.__referenceBoot;
    boot.renderer.update(window.__referenceBattle, 0.1);
    const art = boot.renderer.referenceArt;
    return { actors: art.views.size, tiles: art.tiles.size, failures: [...art.failed],
      atlasFrames: [...art.views.values()].filter((view) => view.sprite).map((view) => view.sprite.spriteFrame?.name),
      atlasAnimationLengths: [...art.frames.values()].map((frames) => frames.length) };
  });
  await delay(100);
  await capture("battle");
  const experience = await evaluate(async () => {
    const boot = window.__referenceBoot, session = boot.session;
    for (let tick = 0; tick < 1200 && session.runState === "running" && !session.map.snapshot().experience.current; tick++) session.update(0.05);
    const progress = session.map.saveProgress();
    const earned = session.config.world.progression.experienceLevels.filter((entry) => entry.level < progress.level)
      .reduce((sum, entry) => sum + entry.required, progress.experience);
    const expected = session.config.enemies.reduce((sum, enemy) => sum + (progress.counters[enemy.defeatFlag] || 0) *
      (enemy.defeatRewards || []).filter((reward) => reward.experience && reward.chance === 1).reduce((total, reward) => total + reward.amount, 0), 0);
    await boot.runtime.flushProgress();
    const saved = await boot.runtime.ports.storage.loadExploration(session.config.meta.id);
    boot.renderer.update(session.getSnapshot(), 0.1);
    return { earned, expected, level: progress.level, current: progress.experience,
      savedLevel: saved.map.level, savedExperience: saved.map.experience, countersMatch: JSON.stringify(saved.map.counters) === JSON.stringify(progress.counters) };
  });
  assert.ok(experience.earned > 0 && experience.earned === experience.expected, JSON.stringify(experience));
  assert.ok(experience.level === experience.savedLevel && experience.current === experience.savedExperience && experience.countersMatch);
  await capture("experience");
  const lightProbe = await evaluate(() => {
    const boot = window.__referenceBoot;
    const original = boot.session.getSnapshot();
    const snapshot = JSON.parse(JSON.stringify(original));
    const leader = snapshot.actors.find((actor) => actor.id === snapshot.leaderId);
    const dx = 19000 - leader.x, dy = 11000 - leader.y;
    snapshot.actors = snapshot.actors.filter((actor) => snapshot.partyIds.includes(actor.id));
    snapshot.actors.forEach((actor) => { actor.x += dx; actor.y += dy; actor.targetId = undefined; });
    Object.assign(snapshot.flashlight, { x: 19000, y: 11000, directionX: 1, directionY: 0 });
    snapshot.fog.states.fill("explored");
    snapshot.casts = []; snapshot.projectiles = []; snapshot.events = [];
    boot.renderer.centerOnLeader(snapshot);
    boot.renderer.update(snapshot, 0.1);
    window.__lightProbeSnapshot = snapshot;
    const foreground = boot.renderer.referenceArt.foreground;
    const target = foreground.camera.targetTexture;
    const texture = new cc.RenderTexture(); texture.initWithSize(720, 1280);
    foreground.camera.targetTexture = texture;
    foreground.camera.render(boot.renderer.softFog.node);
    const pixels = texture.readPixels();
    const center = boot.renderer.project(snapshot.flashlight);
    const alpha = (offset) => pixels[(Math.round(center.y + 640) * 720 + Math.round(center.x + 360 + offset * 0.82)) * 4 + 3];
    const result = { ahead: alpha(300), behind: alpha(-300) };
    foreground.camera.targetTexture = target; texture.destroy();
    return result;
  });
  assert.ok(lightProbe.ahead + 20 < lightProbe.behind, `Flashlight cone is not visible: ${JSON.stringify(lightProbe)}`);
  await delay(300);
  await evaluate(() => window.__referenceBoot.renderer.update(window.__lightProbeSnapshot, 0.1));
  await capture("directional-light");
  await evaluate(() => { const boot = window.__referenceBoot; const snapshot = boot.session.getSnapshot(); boot.renderer.centerOnLeader(snapshot); boot.renderer.update(snapshot, 0.1); });
  assert.ok(battleArt.actors > 4 && battleArt.atlasFrames.every(Boolean));
  assert.ok(battleArt.tiles > 0 && battleArt.tiles <= 16);
  assert.ok(battleArt.atlasAnimationLengths.some((length) => length > 1), "Enemy atlas animations contain only a fallback frame");
  assert.deepEqual(battleArt.failures, []);
  const advanceBattle = async (boss) => {
    for (let index = 0; index < 40; index++) {
      const result = await evaluate((boss) => {
        const boot = window.__referenceBoot, session = boot.session; boot.enabled = false;
        for (let tick = 0; tick < 250 && session.runState === "running" && (boss ? !session.map.hasFlag("defeat:102020001") : !session.world.path.complete); tick++) session.update(0.05);
        boot.renderer.update(session.getSnapshot(), 0.1);
        return { state: session.runState, complete: boss ? session.map.hasFlag("defeat:102020001") : session.world.path.complete };
      }, boss);
      assert.equal(result.state, "running", "Party was defeated during equipment acquisition");
      if (result.complete) return;
    }
    throw new Error("Natural equipment route timed out");
  };
  assert.ok(await evaluate(() => window.__referenceBoot.session.navigateToPoi("reference_npc_302002")));
  await advanceBattle(false);
  assert.equal(await evaluate(() => window.__referenceBoot.session.interactWithPoi("reference_npc_302002")), "completed");
  assert.ok(await evaluate(() => window.__referenceBoot.session.navigateToPoi("reference_spawn_100190001")));
  await advanceBattle(true);
  const equipmentBefore = await evaluate(() => {
    const boot = window.__referenceBoot; boot.session.setAutoDestination(null, null); boot.enabled = true;
    const actor = boot.session.world.players[0], item = boot.session.development.snapshot().items.find((item) => item.resource === "item:101001001");
    return { actorId: actor.id, stats: actor.stats, itemId: item?.id, count: boot.session.map.resourceBalance("item:101001001") };
  });
  assert.ok(equipmentBefore.itemId && equipmentBefore.count === 1, "First Boss did not award its equipment");
  await clickDesign(-238, 300);
  assert.ok(await evaluate(() => window.__referenceBoot.renderer.development.isOpen && !window.__referenceBoot.renderer.journal.node.active));
  for (let index = 0; index < 30; index++) {
    if (await evaluate(() => window.__referenceBoot.renderer.development.icons.some((icon) => icon.node.active && icon.spriteFrame?.name === "equip_06003"))) break;
    await delay(100);
  }
  assert.ok(await evaluate(() => window.__referenceBoot.renderer.development.icons.some((icon) => icon.node.active && icon.spriteFrame?.name === "equip_06003")), "Source equipment icon did not render");
  await capture("equipment-before");
  await clickDesign(174, -548);
  const equipped = await evaluate(async () => {
    const boot = window.__referenceBoot; await boot.runtime.flushProgress();
    return { stats: boot.session.world.players[0].stats, count: boot.session.map.counter("equipped"),
      itemId: boot.session.development.snapshot().slots[0].itemId, icons: boot.renderer.development.icons.filter((icon) => icon.node.active).map((icon) => icon.spriteFrame.name) };
  });
  assert.equal(equipped.itemId, equipmentBefore.itemId);
  assert.equal(equipped.stats.attack, equipmentBefore.stats.attack + 23);
  assert.equal(equipped.stats.defense, equipmentBefore.stats.defense + 4);
  assert.equal(equipped.stats.maxHealth, equipmentBefore.stats.maxHealth + 338);
  assert.ok(await evaluate(() => window.__referenceBoot.renderer.development.labels.some((label) => label.node.active && label.string === "\u653b\u51fb -23")), "Unequip preview does not show the lost attack stat");
  await capture("equipment-after");
  await send("Page.reload", { ignoreCache: true });
  assert.ok(await waitReady());
  const equipmentRestored = await evaluate(() => ({ stats: window.__referenceBoot.session.world.players[0].stats,
    itemId: window.__referenceBoot.session.development.snapshot().slots[0].itemId }));
  assert.equal(equipmentRestored.itemId, equipmentBefore.itemId);
  assert.deepEqual(equipmentRestored.stats, equipped.stats);
  await clickDesign(-238, 300);
  await clickDesign(174, -548);
  assert.equal(await evaluate(() => window.__referenceBoot.session.world.players[0].stats.attack), equipmentBefore.stats.attack);
  await clickDesign(-82, 481);
  await clickDesign(174, -548);
  assert.ok(await evaluate(() => window.__referenceBoot.session.development.snapshot().slots.some((slot) => slot.actorId === window.__referenceBoot.session.world.players[1].id && slot.itemId)));
  assert.equal(await evaluate(() => window.__referenceBoot.session.map.counter("equipped")), 1);
  await clickDesign(306, 557);
  const development = { before: equipmentBefore, equipped, restored: equipmentRestored, unequippedAndTransferred: true };
  const induceDefeat = () => evaluate(async () => {
    const boot = window.__referenceBoot; boot.enabled = false;
    for (const actor of boot.session.world.players) actor.receiveDamage(1000000000);
    boot.session.update(0.05);
    const snapshot = boot.session.getSnapshot();
    boot.renderer.centerOnLeader(snapshot); boot.renderer.update(snapshot, 0.1);
    await boot.runtime.flushProgress();
    return { state: snapshot.runState, result: snapshot.result, recovery: snapshot.recovery,
      resources: boot.session.map.saveProgress().resources, equipment: boot.session.development.save(), explored: snapshot.discoveredFogCells.length };
  });
  const defeat = await induceDefeat();
  assert.equal(defeat.state, "recovering");
  assert.equal(defeat.result, null);
  assert.ok(defeat.recovery.portalId);
  await capture("recovery-before");
  await send("Page.reload", { ignoreCache: true });
  assert.ok(await waitReady());
  const defeatRestored = await evaluate(() => {
    const boot = window.__referenceBoot; boot.enabled = false;
    return { state: boot.session.runState, recovery: boot.session.getSnapshot().recovery,
      equipment: boot.session.development.save(), resources: boot.session.map.saveProgress().resources,
      controlsHidden: !boot.renderer.controlGraphics.node.active && !boot.renderer.development.node.active && !boot.renderer.journal.node.active };
  });
  assert.equal(defeatRestored.state, "recovering");
  assert.deepEqual(defeatRestored.recovery, defeat.recovery);
  assert.deepEqual(defeatRestored.equipment, defeat.equipment);
  assert.deepEqual(defeatRestored.resources, defeat.resources);
  assert.ok(defeatRestored.controlsHidden);
  for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1280, 800]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(200); await capture(`${name}-recovery`);
  }
  await clickDesign(148, -40);
  const revivedAtPortal = await evaluate((portalId) => {
    const boot = window.__referenceBoot, snapshot = boot.session.getSnapshot();
    const portal = boot.session.map.pois.find((poi) => poi.id === portalId);
    return { state: snapshot.runState, distance: boot.session.world.leader.position.distance(portal),
      fullHealth: boot.session.world.players.every((actor) => actor.health === actor.stats.maxHealth),
      resources: boot.session.map.saveProgress().resources, equipment: boot.session.development.save(),
      projectiles: snapshot.projectiles.length, casts: snapshot.casts.length, explored: snapshot.discoveredFogCells.length };
  }, defeat.recovery.portalId);
  assert.ok(revivedAtPortal.state === "running" && revivedAtPortal.fullHealth && revivedAtPortal.distance < 120);
  assert.equal(revivedAtPortal.projectiles + revivedAtPortal.casts, 0);
  assert.deepEqual(revivedAtPortal.resources, defeat.resources);
  assert.deepEqual(revivedAtPortal.equipment, defeat.equipment);
  assert.ok(revivedAtPortal.explored >= defeat.explored);
  await capture("recovered-at-portal");
  await induceDefeat();
  await clickDesign(-148, -40);
  const revivedAtTown = await evaluate(async () => {
    const boot = window.__referenceBoot;
    await boot.runtime.flushProgress();
    const save = await boot.runtime.ports.storage.loadExploration(boot.session.config.meta.id);
    const result = { distance: boot.session.world.leader.position.distance(boot.session.config.session.recovery.town), state: boot.session.runState,
      savedAlive: save.party.every((actor) => actor.hp > 0), savedRecovery: save.recoveryPosition || null };
    boot.enabled = true;
    return result;
  });
  assert.ok(revivedAtTown.state === "running" && revivedAtTown.distance < 120 && revivedAtTown.savedAlive && revivedAtTown.savedRecovery === null);
  await capture("recovered-at-town");
  const recovery = { setup: "lethal-damage fixture after normal Boss and equipment play", defeat, defeatRestored, revivedAtPortal, revivedAtTown };
  await clickDesign(-310, 300); await clickDesign(0, 484); await clickDesign(140, -547); await clickDesign(306, 557);
  assert.ok(await evaluate(() => window.__referenceBoot.session.map.hasFlag("firstkill:90101")), "First-kill reward was not claimed through the journal");
  await clickDesign(-166, 300);
  assert.ok(await evaluate(() => window.__referenceBoot.renderer.roster.isOpen));
  const rosterBefore = await evaluate(() => [...window.__referenceBoot.session.roster.slots()]);
  const slotFrom = await screenPoint(-246, 386), slotTo = await screenPoint(-82, 386);
  await mouse("mousePressed", slotFrom.x, slotFrom.y, 1); await mouse("mouseMoved", slotTo.x, slotTo.y, 1); await mouse("mouseReleased", slotTo.x, slotTo.y);
  assert.equal(await evaluate(() => window.__referenceBoot.session.roster.slots()[1]), rosterBefore[0]);
  await mouse("mousePressed", slotFrom.x, slotFrom.y, 1); await mouse("mouseMoved", slotTo.x, slotTo.y, 1); await mouse("mouseReleased", slotTo.x, slotTo.y);
  assert.deepEqual(await evaluate(() => [...window.__referenceBoot.session.roster.slots()]), rosterBefore);
  const medicIndex = await evaluate(() => window.__referenceBoot.renderer.roster.rows.findIndex((hero) => hero.id === "hero_medic"));
  assert.ok(medicIndex >= 0);
  await clickDesign(-246 + medicIndex % 4 * 164, 139 - Math.floor(medicIndex / 4) * 166);
  assert.equal(await evaluate(() => window.__referenceBoot.session.world.players.length), 3);
  await clickDesign(-246 + medicIndex % 4 * 164, 139 - Math.floor(medicIndex / 4) * 166);
  assert.equal(await evaluate(() => window.__referenceBoot.session.world.players.length), 4);
  await capture("lineup-four");
  await clickDesign(160, 485);
  const recruitBefore = await evaluate(() => window.__referenceBoot.session.map.resourceBalance("item:2"));
  assert.ok(recruitBefore >= 200);
  await capture("recruitment-pool");
  await clickDesign(-174, -548); await clickDesign(-174, -548);
  const recruitment = await evaluate(() => ({ remaining: window.__referenceBoot.session.map.resourceBalance("item:2"),
    count: window.__referenceBoot.session.map.counter("recruit"), state: window.__referenceBoot.session.recruitment.snapshot() }));
  assert.equal(recruitment.remaining, recruitBefore - 200); assert.equal(recruitment.count, 2);
  await delay(400); await capture("recruitment-result");
  await clickDesign(306, 557);
  const fifthHero = await evaluate(() => {
    const boot = window.__referenceBoot, session = boot.session;
    const hero = session.getSnapshot().roster.heroes.find((hero) => !hero.owned && hero.available && hero.cardResource);
    session.map.setRank(4); session.map.grantResources({ [hero.cardResource]: 1 }); session.update(0.05); boot.renderer.update(session.getSnapshot(), 0.1);
    return hero.id;
  });
  await clickDesign(-166, 300);
  const fifthIndex = await evaluate((id) => window.__referenceBoot.renderer.roster.rows.findIndex((hero) => hero.id === id), fifthHero);
  assert.ok(fifthIndex >= 0);
  await clickDesign(-246 + fifthIndex % 4 * 164, 139 - Math.floor(fifthIndex / 4) * 166);
  const five = await evaluate(() => ({ lineup: [...window.__referenceBoot.session.roster.slots()], party: window.__referenceBoot.session.getSnapshot().partyIds,
    development: window.__referenceBoot.session.development.save() }));
  assert.equal(five.party.length, 5); assert.equal(five.lineup[4], fifthHero);
  await capture("lineup-five");
  await evaluate(async () => { await window.__referenceBoot.runtime.flushProgress(); });
  await send("Page.reload", { ignoreCache: true }); assert.ok(await waitReady());
  assert.deepEqual(await evaluate(() => [...window.__referenceBoot.session.roster.slots()]), five.lineup);
  assert.equal(await evaluate(() => window.__referenceBoot.session.map.counter("recruit")), 2);
  const roster = { reordered: true, toggled: true, five, setup: "rank-four and owned-card fixture after ordinary recruitment" };
  const periodicHeroes = await evaluate(() => {
    const boot = window.__referenceBoot, session = boot.session;
    const results = [2, 26, 10].map((sourceId, index) => {
      const id = `reference_hero_${sourceId}`, hero = session.roster.config.heroes.find((hero) => hero.id === id);
      session.map.grantResources({ [hero.cardResource]: 1, "item:3": 1000 }); session.roster.syncOwnership();
      while (session.development.levelOf(id) < 10) { if (session.upgradeHero(id) !== "completed") throw new Error(`Cannot grow ${id}`); }
      if (!session.setLineup(index, id)) throw new Error(`Cannot deploy ${id}`);
      const actor = session.roster.actor(id); actor.gainEnergy(actor.stats.maxEnergy);
      return { id, level: session.development.levelOf(id), maxEnergy: actor.stats.maxEnergy };
    });
    boot.renderer.update(session.getSnapshot(), 0.1);
    return results;
  });
  assert.ok(periodicHeroes.every((hero) => hero.level === 10 && hero.maxEnergy === 10000));
  assert.ok(await waitReady(), "Periodic heroes did not load their battle art");
  await evaluate(async () => { await window.__referenceBoot.runtime.flushProgress(); });
  await send("Page.reload", { ignoreCache: true }); assert.ok(await waitReady());
  const periodicArt = await evaluate((heroes) => heroes.map(({ id }) => {
    const boot = window.__referenceBoot, view = boot.renderer.referenceArt.views.get(id), actor = boot.session.roster.actor(id);
    return { id, spine: Boolean(view?.skeleton?.skeletonData), action: view?.action, level: boot.session.development.levelOf(id), maxEnergy: actor.stats.maxEnergy, energy: actor.energy,
      dotDamageBonus: actor.modifier("dotDamageBonus"), pveDamageReduction: actor.modifier("pveDamageReduction") };
  }), periodicHeroes);
  assert.ok(periodicArt.every((hero) => hero.spine && hero.action && hero.level === 10 && hero.maxEnergy === 10000 && hero.energy > 0));
  assert.equal(periodicArt.find((hero) => hero.id === "reference_hero_26").dotDamageBonus, 0.1);
  assert.equal(periodicArt.find((hero) => hero.id === "reference_hero_10").pveDamageReduction, 0.2);
  assert.equal(periodicArt.find((hero) => hero.id === "reference_hero_2").dotDamageBonus, 0);
  await capture("periodic-heroes");
  const viewports = [];
  for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1280, 800]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    await capture(name);
    viewports.push(await evaluate(() => ({ width: innerWidth, height: innerHeight, canvas: cc.game.canvas.getBoundingClientRect().toJSON() })));
    await clickDesign(254, 443);
    await capture(`${name}-overview`);
    await clickDesign(312, 570);
    await clickDesign(-310, 300);
    await capture(`${name}-journal`);
    await clickDesign(306, 557);
    await clickDesign(-166, 300); await capture(`${name}-roster`); await clickDesign(306, 557);
    await clickDesign(-238, 300);
    await capture(`${name}-development`);
    await clickDesign(306, 557);
  }
  const resetCounts = [];
  for (let index = 0; index < 3; index++) {
    await evaluate(async () => { await window.__referenceBoot.restart(); });
    await delay(200);
    await waitReady();
    resetCounts.push(await evaluate(() => ({ root: window.__referenceBoot.node.childrenCount,
      world: window.__referenceBoot.renderer.worldRoot.childrenCount, actors: window.__referenceBoot.session.world.players.filter(actor => window.__referenceBoot.renderer.referenceArt.views.has(actor.id)).length })));
  }
  assert.ok(resetCounts.every((count) => count.root === resetCounts[0].root && count.world === 8 && count.actors === 4), JSON.stringify(resetCounts));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = { initial, foreground, journal, lightProbe, overview, purchased, restored, travel, movement, battle, battleArt, experience, development, recovery, recruitment, roster,
    periodicHeroes: { setup: "owned-card and merit fixture for source hero growth, energy and Spine checks", heroes: periodicArt }, resetCounts, viewports, errors, failures };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (socket) socket.close();
  chrome.kill();
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else chrome.once("exit", resolve); });
  for (const entry of pending.values()) clearTimeout(entry.timer);
  await delay(100);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
