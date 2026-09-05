import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:4174/?reference=1";
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
  let ready;
  for (let i = 0; i < 100 && !ready; i++) {
    ready = await evaluate(() => {
      const boot = window.cc && cc.find("Canvas")?.getComponent("DemoBootstrap");
      window.__referenceBoot = boot;
      return Boolean(boot?.session && boot.renderer.referenceArt?.views.size === 4 && boot.renderer.softFogReady);
    });
    if (!ready) await delay(200);
  }
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
    const targets = session.config.spawns.filter(detailedAt).sort((a, b) => Math.hypot(a.x - leader.position.x, a.y - leader.position.y) - Math.hypot(b.x - leader.position.x, b.y - leader.position.y));
    const target = targets.slice(0, 8).find((target) => session.setAutoDestination(target.x, target.y));
    if (!target) return { reached: false };
    for (let tick = 0; tick < 2000 && session.runState === "running"; tick++) {
      session.update(0.05);
      const snapshot = session.getSnapshot();
      if (detailedAt(session.world.leader.position) && snapshot.events.some((event) => event.type === "damage" && event.value > 0)) {
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
  assert.ok(battleArt.actors > 4 && battleArt.atlasFrames.every(Boolean));
  assert.ok(battleArt.tiles > 0 && battleArt.tiles <= 16);
  assert.ok(battleArt.atlasAnimationLengths.some((length) => length > 1), "Enemy atlas animations contain only a fallback frame");
  assert.deepEqual(battleArt.failures, []);
  await evaluate(() => { window.__referenceBoot.enabled = true; });
  const viewports = [];
  for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1280, 800]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    await capture(name);
    viewports.push(await evaluate(() => ({ width: innerWidth, height: innerHeight, canvas: cc.game.canvas.getBoundingClientRect().toJSON() })));
  }
  const resetCounts = [];
  for (let index = 0; index < 3; index++) {
    await evaluate(async () => { await window.__referenceBoot.restart(); });
    await delay(200);
    resetCounts.push(await evaluate(() => ({ root: window.__referenceBoot.node.childrenCount,
      world: window.__referenceBoot.renderer.worldRoot.childrenCount, actors: window.__referenceBoot.renderer.referenceArt.views.size })));
  }
  assert.ok(resetCounts.every((count) => count.root === resetCounts[0].root && count.world === 5 && count.actors === 4), JSON.stringify(resetCounts));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = { initial, movement, battle, battleArt, resetCounts, viewports, errors, failures };
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
