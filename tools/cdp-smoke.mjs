import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

  await mouse("mouseMoved", 605, 410);
  await mouse("mousePressed", 605, 410, 1);
  await mouse("mouseReleased", 605, 410, 0);
  await delay(1800);
  const afterPath = await capture("after-path");

  await mouse("mouseMoved", 360, 1110);
  await mouse("mousePressed", 360, 1110, 1);
  await mouse("mouseMoved", 455, 1050, 1);
  await delay(1200);
  await mouse("mouseReleased", 455, 1050, 0);
  await delay(300);
  const afterJoystick = await capture("after-joystick");

  const bossRuntime = await send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = cc.find('Canvas');
      const boot = canvas && canvas._components.find((component) => component.session && component.renderer);
      if (!boot) return { ready: false, reason: 'bootstrap-not-found' };
      const session = boot.session;
      const leader = session.world.players[0];
      leader.position.x = 3800;
      leader.position.y = 6000;
      session.update(0.2);
      const boss = session.world.enemies.find((actor) => actor.tags && actor.tags.has('boss'));
      if (!boss) return { ready: false, reason: 'boss-not-spawned' };
      boss.health = boss.stats.maxHealth * 0.5;
      session.update(0.1);
      const snapshot = session.getSnapshot();
      return {
        ready: true,
        id: boss.id,
        phase: snapshot.bossPhases[boss.id],
        hp: boss.health,
        maxHp: boss.stats.maxHealth,
      };
    })()`,
    returnByValue: true,
  });
  await delay(600);
  const bossEncounter = await capture("boss-encounter");

  const distinctFrames = new Set([initial.sha256, afterPath.sha256, afterJoystick.sha256, bossEncounter.sha256]).size;
  const report = {
    runtime: runtime.result.value,
    boss: bossRuntime.result.value,
    screenshots: { initial, afterPath, afterJoystick, bossEncounter, distinctFrames },
    consoleErrors,
    passed: Boolean(runtime.result.value?.ready) && bossRuntime.result.value?.phase === "phase2" && distinctFrames === 4 && consoleErrors.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill();
  await delay(100);
  await rm(profileDir, { recursive: true, force: true });
}
