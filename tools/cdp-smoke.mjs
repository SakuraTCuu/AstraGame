import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createExplorationDriver } from "./exploration-playthrough.mjs";

const url = process.argv[2] || "http://127.0.0.1:4173";
const outputDir = resolve("temp/qa");
const debugPort = 9337;
const profileDir = await mkdtemp(join(tmpdir(), "auto-explore-cdp-"));
await mkdir(outputDir, { recursive: true });
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=" + debugPort, "--user-data-dir=" + profileDir, "--window-size=720,1280", url,
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.resume();
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
let socket;
const pending = new Map();
const consoleErrors = [];
let nextId = 1;

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveSend, rejectSend) => {
    const timer = setTimeout(() => { pending.delete(id); rejectSend(new Error("CDP timed out: " + method)); }, 30000);
    pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(fn, ...args) {
  const response = await send("Runtime.evaluate", {
    expression: "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")",
    awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const buffer = Buffer.from(result.data, "base64");
  await writeFile(join(outputDir, name + ".png"), buffer);
  return { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}

async function mouse(type, x, y, buttons = 0) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left",
    buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
}

async function click(x, y) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, 1);
  await mouse("mouseReleased", x, y);
}

async function advance(until) {
  return evaluate((until) => {
    const { boot, driver } = window.__astraQa;
    let snapshot = boot.session.getSnapshot();
    let reached = false;
    for (let tick = 0; tick < 10000 && boot.session.runState === "running"; tick++) {
      snapshot = driver.step();
      const boss = snapshot.actors.find((actor) => actor.kind === "boss");
      reached = until === "unlock" ? boot.session.map.isZoneUnlocked("boss") :
        until === "warning" ? boss && snapshot.bossPhases[boss.id] === "phase2" &&
          snapshot.casts.some((cast) => cast.sourceId === boss.id && cast.phase === "windup" && cast.area) :
        snapshot.runState === "won";
      if (reached) break;
    }
    for (let frame = 0; frame < 30; frame++) boot.renderer.update(snapshot, 0.1);
    boot.renderer.pushCombatFeedback(snapshot);
    boot.renderer.update(snapshot, 0);
    return { reached: Boolean(reached), state: snapshot.runState, casts: snapshot.casts, bossPhases: snapshot.bossPhases, report: driver.report() };
  }, until);
}

try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:" + debugPort + "/json/list");
      target = (await response.json()).find((entry) => entry.type === "page" && entry.url.startsWith(url));
    } catch { /* Chrome is starting. */ }
    if (!target) await delay(100);
  }
  if (!target) throw new Error("Chrome target did not appear");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callbacks = pending.get(message.id);
      if (!callbacks) return;
      clearTimeout(callbacks.timer);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(JSON.stringify(message.error))); else callbacks.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
    else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
    else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((item) => item.value || item.description || "").join(" "));
    }
  });
  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
  await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 1280, deviceScaleFactor: 1, mobile: false });
  await delay(2500);

  const runtime = await evaluate(() => {
    const root = window.cc && cc.find("Canvas");
    const boot = root && root._components.find((component) => component.session && component.renderer);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return { ready: Boolean(boot), canvas: { width: rect.width, height: rect.height }, state: boot?.session.runState };
  });
  const screenshots = { initial: await capture("initial") };
  const hostPrefab = await evaluate(() => new Promise((resolve, reject) => {
    cc.resources.load("auto_explore/ExploreView", cc.Prefab, (error, asset) => {
      if (error) { reject(error); return; }
      const node = cc.instantiate(asset);
      const result = { name: node.name, width: node.width, height: node.height, valid: cc.isValid(node) };
      node.destroy();
      resolve(result);
    });
  }));
  await click(555, 223);
  await delay(200);
  const overviewOpened = await evaluate(() => cc.find("Canvas").getComponent("DemoBootstrap").renderer.overview.isOpen);
  await click(672, 70);
  await delay(100);
  await evaluate(() => cc.find("Canvas").getComponent("DemoBootstrap").session.setAutoDestination(1200, 1400));
  await delay(1800);
  screenshots.afterPath = await capture("after-path");
  await mouse("mousePressed", 360, 1110, 1);
  await mouse("mouseMoved", 455, 1050, 1);
  await delay(800);
  await mouse("mouseReleased", 455, 1050);
  await delay(200);
  screenshots.afterJoystick = await capture("after-joystick");
  const inputMode = await evaluate(() => cc.find("Canvas")._components.find((component) => component.session).session.getSnapshot().autoNavigation.mode);

  await click(55, 1195);
  await delay(500);
  const bossInitiallyBlocked = await evaluate((factoryCode) => {
    const boot = cc.find("Canvas")._components.find((component) => component.session && component.renderer);
    const blocked = !boot.session.setAutoDestination(4000, 6240);
    boot.enabled = false;
    window.__astraQa = { boot, driver: (0, eval)("(" + factoryCode + ")")(boot.session) };
    return blocked;
  }, createExplorationDriver.toString());

  const progression = await advance("unlock");
  screenshots.afterUnlock = await capture("after-unlock");
  const bossWarning = await advance("warning");
  screenshots.bossEncounter = await capture("boss-encounter");

  const viewports = [];
  for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }]) {
    await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await delay(350);
    const canvas = await evaluate(() => {
      const element = document.querySelector("canvas");
      const rect = element.getBoundingClientRect();
      const root = cc.find("Canvas");
      const viewport = cc.view.getViewportRect();
      const sx = cc.view.getScaleX();
      const sy = cc.view.getScaleY();
      const controls = ["Status", "Objective", "BossHealth"].map((name) => {
        const box = root.getChildByName(name).getBoundingBoxToWorld();
        return { name, left: viewport.x + box.x * sx, bottom: viewport.y + box.y * sy, width: box.width * sx, height: box.height * sy };
      });
      for (const [name, x, y, radius] of [["Joystick", 0, -470, 105], ["Pause", 305, -555, 36], ["Restart", -305, -555, 36]]) {
        const point = root.convertToWorldSpaceAR(cc.v2(x, y));
        controls.push({ name, left: viewport.x + (point.x - radius) * sx, bottom: viewport.y + (point.y - radius) * sy, width: radius * 2 * sx, height: radius * 2 * sy });
      }
      return { width: rect.width, height: rect.height,
        inViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        controlsVisible: controls.every((box) => box.left >= -1 && box.bottom >= -1 && box.left + box.width <= element.width + 1 && box.bottom + box.height <= element.height + 1) };
    });
    viewports.push({ ...viewport, canvas, screenshot: await capture(viewport.name) });
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 1280, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const completion = await advance("victory");
  screenshots.victory = await capture("victory");
  const resultSaved = await evaluate(async () => {
    const boot = window.__astraQa.boot;
    boot.runtime.update(0);
    await boot.runtime.waitForResult();
    boot.enabled = true;
    return JSON.parse(cc.sys.localStorage.getItem("astra.exploration.last-result.v1"))?.payload.result.outcome === "won";
  });

  await click(55, 1195);
  await delay(400);
  await click(665, 1195);
  await delay(100);
  const paused = await evaluate(() => {
    const boot = cc.find("Canvas")._components.find((component) => component.session);
    return { state: boot.session.runState, time: boot.session.getSnapshot().elapsedSeconds, nodes: boot.node.children.length };
  });
  await delay(300);
  const pausedTime = await evaluate(() => cc.find("Canvas")._components.find((component) => component.session).session.getSnapshot().elapsedSeconds);
  screenshots.paused = await capture("paused");
  await click(665, 1195);
  await delay(150);
  const resumed = await evaluate(() => cc.find("Canvas")._components.find((component) => component.session).session.runState);
  const resetCounts = [];
  for (let index = 0; index < 3; index++) {
    await click(55, 1195);
    await delay(250);
    resetCounts.push(await evaluate(() => {
      const boot = cc.find("Canvas")._components.find((component) => component.session);
      return { nodes: boot.node.children.length, state: boot.session.runState, zones: boot.session.getSnapshot().exploration.zones.filter((zone) => zone.unlocked).map((zone) => zone.id) };
    }));
  }
  screenshots.restarted = await capture("restarted");
  const controls = { paused, frozen: pausedTime === paused.time, resumed, resets: resetCounts };
  const report = { runtime, hostPrefab, overviewOpened, inputMode, bossInitiallyBlocked, progression, bossWarning, completion, resultSaved, controls, viewports, screenshots, consoleErrors,
    passed: runtime.ready && overviewOpened && inputMode === "resume_wait" && bossInitiallyBlocked && progression.reached && bossWarning.reached &&
      completion.reached && completion.report.state === "won" && resultSaved && paused.state === "paused" && controls.frozen &&
      resumed === "running" && resetCounts.every((entry) => entry.state === "running" && entry.zones.join(",") === "south") &&
      new Set(resetCounts.map((entry) => entry.nodes)).size === 1 && hostPrefab.valid && hostPrefab.name === "AstraExploreView" &&
      viewports.every((entry) => entry.canvas.inViewport && entry.canvas.controlsVisible) && consoleErrors.length === 0 };
  await writeFile(join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  if (socket) socket.close();
  for (const callbacks of pending.values()) clearTimeout(callbacks.timer);
  chrome.kill();
  await delay(100);
  if (dirname(resolve(profileDir)) !== resolve(tmpdir()) || !basename(profileDir).startsWith("auto-explore-cdp-")) throw new Error("Unexpected Chrome profile path");
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
