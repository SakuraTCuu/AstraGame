import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:4173";
const outputDir = resolve("temp/qa");
const debugPort = 9337;
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profileDir = await mkdtemp(join(tmpdir(), "auto-explore-cdp-"));

await mkdir(outputDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=720,1280",
  url,
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeLog = "";
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => { chromeLog += chunk; });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(url));
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Chrome debugging target");
}

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const consoleErrors = [];
let nextId = 1;

await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
    else callbacks.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    consoleErrors.push(message.params.entry.text);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map((item) => item.value || item.description || "").join(" "));
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveSend, rejectSend) => {
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const buffer = Buffer.from(result.data, "base64");
  await writeFile(join(outputDir, `${name}.png`), buffer);
  return {
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function mouse(type, x, y, buttons = 0) {
  await send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseMoved" ? "none" : "left",
    buttons,
    clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
  });
}

try {
  await Promise.all([
    send("Page.enable"),
    send("Runtime.enable"),
    send("Log.enable"),
  ]);
  await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 1280, deviceScaleFactor: 1, mobile: false });
  await delay(2500);

  const runtime = await send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas && canvas.getBoundingClientRect();
      const scene = window.cc && cc.director && cc.director.getScene();
      const labels = scene ? scene.getComponentsInChildren(cc.Label).map((label) => ({
        name: label.node.name,
        text: label.string,
        active: label.node.activeInHierarchy,
        x: label.node.x,
        y: label.node.y,
        width: label.node.width,
        height: label.node.height,
      })) : [];
      return {
        title: document.title,
        canvas: rect ? { width: rect.width, height: rect.height } : null,
        scene: scene ? scene.name : null,
        labels,
        ready: Boolean(canvas && scene),
      };
    })()`,
    returnByValue: true,
  });

  const initial = await capture("initial");

  // Select the reachable shrine on the minimap, then interrupt its route.
  await mouse("mouseMoved", 555, 223);
  await mouse("mousePressed", 555, 223, 1);
  await mouse("mouseReleased", 555, 223, 0);
  await delay(1800);
  const afterPath = await capture("after-path");

  await mouse("mouseMoved", 360, 1110);
  await mouse("mousePressed", 360, 1110, 1);
  await mouse("mouseMoved", 455, 1050, 1);
  await delay(1200);
  await mouse("mouseReleased", 455, 1050, 0);
  await delay(300);
  const afterJoystick = await capture("after-joystick");

  const progression = await send("Runtime.evaluate", {
    expression: `(() => {
      const boot = cc.find('Canvas')._components.find((component) => component.session && component.renderer);
      if (!boot) return { passed: false, reason: 'bootstrap-not-found' };
      boot.enabled = false;
      const session = boot.session;
      const inputMode = session.getSnapshot().autoNavigation.mode;
      const bossInitiallyBlocked = !session.setAutoDestination(4000, 6240);
      const events = [];
      let collisionChecks = 0;
      const step = () => {
        session.update(0.05);
        events.push(...session.getSnapshot().exploration.events);
        for (const actor of [...session.world.players, ...session.world.enemies]) {
          if (!session.world.options.navigation.isWorldWalkable(actor.position)) throw new Error('Blocked actor: ' + actor.id);
          collisionChecks += 1;
        }
        if (!session.world.players[0].alive) throw new Error('Leader died during exploration');
      };
      const travel = (x, y) => {
        if (!session.setAutoDestination(x, y)) throw new Error('Unreachable waypoint: ' + x + ',' + y);
        let ticks = 0;
        while (!session.world.path.complete && ticks++ < 1600) step();
        if (!session.world.path.complete) throw new Error('Travel timed out');
      };
      travel(720, 2320);
      travel(2080, 1640);
      travel(1500, 3000);
      travel(1850, 4000);
      travel(2420, 4860);
      let ticks = 0;
      while (!session.map.isZoneUnlocked('boss') && ticks++ < 1600) step();
      const snapshot = session.getSnapshot();
      for (let frame = 0; frame < 30; frame++) boot.renderer.update(snapshot, 0.1);
      return {
        passed: bossInitiallyBlocked && session.map.isZoneUnlocked('east') && session.map.isZoneUnlocked('north') && session.map.isZoneUnlocked('boss'),
        inputMode,
        bossInitiallyBlocked,
        collisionChecks,
        events,
        zones: snapshot.exploration.zones.map((zone) => ({ id: zone.id, unlocked: zone.unlocked })),
        guard: snapshot.spawns.find((spawn) => spawn.id === 'spawn_gate_guard').status,
        elapsedSeconds: snapshot.elapsedSeconds,
        usedTeleport: false,
        modifiedCombatStats: false,
      };
    })()`,
    returnByValue: true,
  });
  if (progression.exceptionDetails) throw new Error(progression.exceptionDetails.exception?.description || "Exploration runtime failure");
  await delay(100);
  const afterUnlock = await capture("after-unlock");

  const bossRuntime = await send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = cc.find('Canvas');
      const boot = canvas && canvas._components.find((component) => component.session && component.renderer);
      if (!boot) return { ready: false, reason: 'bootstrap-not-found' };
      const session = boot.session;
      const leader = session.world.players[0];
      if (!session.map.isZoneUnlocked('boss')) return { ready: false, reason: 'boss-region-locked' };
      for (let tick = 0; tick < 2000 && leader.alive && leader.health < leader.stats.maxHealth * 0.95; tick++) session.update(0.05);
      if (!session.setAutoDestination(3800, 5600)) return { ready: false, reason: 'boss-route-blocked' };
      for (let tick = 0; tick < 1600 && !session.world.enemies.some((actor) => actor.tags.has('boss')); tick++) session.update(0.05);
      const boss = session.world.enemies.find((actor) => actor.tags && actor.tags.has('boss'));
      if (!boss) return { ready: false, reason: 'boss-not-spawned' };
      boss.health = boss.stats.maxHealth * 0.5;
      session.update(0.1);
      session.setAutoDestination(boss.position.x, boss.position.y);
      for (let tick = 0; tick < 300 && leader.alive && leader.position.distance(boss.position) > 300; tick++) session.update(0.05);
      const snapshot = session.getSnapshot();
      for (let frame = 0; frame < 30; frame++) boot.renderer.update(snapshot, 0.1);
      return {
        ready: true,
        id: boss.id,
        phase: snapshot.bossPhases[boss.id],
        hp: boss.health,
        maxHp: boss.stats.maxHealth,
        phaseCheck: 'controlled-health',
      };
    })()`,
    returnByValue: true,
  });
  await delay(600);
  const bossEncounter = await capture("boss-encounter");

  const viewports = [];
  for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }]) {
    await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await delay(400);
    const measured = await send("Runtime.evaluate", {
      expression: `(() => {
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const root = cc.find('Canvas');
        const viewport = cc.view.getViewportRect();
        const sx = cc.view.getScaleX();
        const sy = cc.view.getScaleY();
        const controls = ['Status', 'Objective'].map((name) => {
          const box = root.getChildByName(name).getBoundingBoxToWorld();
          return { name, left: viewport.x + box.x * sx, bottom: viewport.y + box.y * sy, width: box.width * sx, height: box.height * sy };
        });
        const joystick = root.convertToWorldSpaceAR(cc.v2(0, -470));
        controls.push({ name: 'Joystick', left: viewport.x + (joystick.x - 105) * sx, bottom: viewport.y + (joystick.y - 105) * sy, width: 210 * sx, height: 210 * sy });
        return {
          width: rect.width, height: rect.height,
          inViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          controlsVisible: controls.every((box) => box.left >= -1 && box.bottom >= -1 && box.left + box.width <= canvas.width + 1 && box.bottom + box.height <= canvas.height + 1),
          controls,
        };
      })()`,
      returnByValue: true,
    });
    viewports.push({ ...viewport, canvas: measured.result.value, screenshot: await capture(viewport.name) });
  }

  const distinctFrames = new Set([initial.sha256, afterPath.sha256, afterJoystick.sha256, bossEncounter.sha256]).size;
  const report = {
    runtime: runtime.result.value,
    boss: bossRuntime.result.value,
    progression: progression.result.value,
    screenshots: { initial, afterPath, afterJoystick, afterUnlock, bossEncounter, distinctFrames },
    viewports,
    consoleErrors,
    passed: Boolean(runtime.result.value?.ready) && progression.result.value?.passed && progression.result.value?.inputMode === "resume_wait" &&
      bossRuntime.result.value?.phase === "phase2" && distinctFrames === 4 && consoleErrors.length === 0 &&
      viewports.every((entry) => entry.canvas.inViewport && entry.canvas.controlsVisible),
  };
  await writeFile(join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill();
  await delay(100);
  if (dirname(resolve(profileDir)) !== resolve(tmpdir()) || !basename(profileDir).startsWith("auto-explore-cdp-")) throw new Error("Unexpected Chrome profile directory");
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
