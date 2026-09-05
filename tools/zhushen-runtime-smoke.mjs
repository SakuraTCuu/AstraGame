import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:4175/", origin = new URL(url).origin;
const output = resolve("temp/qa-zhushen"), profile = await mkdtemp(join(tmpdir(), "astra-host-"));
await mkdir(output, { recursive: true });
await fetch(url).then((response) => assert.equal(response.status, 200, "Host probe server is unavailable"));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking",
  "--remote-debugging-port=9341", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const errors = [], external = [], requests = [], pending = new Map();
let socket, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, ...args) => {
  const result = await send("Runtime.evaluate", { expression: `(${fn.toString()})(${args.map((value) => JSON.stringify(value)).join(",")})`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const state = () => evaluate(() => window.__astraHostProbe?.getState());
const wait = async (predicate, name) => {
  for (let index = 0; index < 200; index++) {
    const result = await state();
    if (errors.length) throw new Error(errors.join("\n"));
    if (predicate(result)) return result;
    await delay(100);
  }
  throw new Error(`Host probe timed out: ${name}; ${JSON.stringify(await state())}`);
};
const capture = async (name) => {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, `${name}.png`), Buffer.from(result.data, "base64"));
};
const screenPoint = (x, y) => evaluate((x, y) => {
  const content = window.__astraHostProbe.lastView.content, point = content.convertToWorldSpaceAR(cc.v2(x, y));
  const viewport = cc.view.getViewportRect(), canvas = cc.game.canvas.getBoundingClientRect();
  return { x: canvas.left + (viewport.x + point.x * cc.view.getScaleX()) * canvas.width / cc.game.canvas.width,
    y: canvas.bottom - (viewport.y + point.y * cc.view.getScaleY()) * canvas.height / cc.game.canvas.height };
}, x, y);
const mouse = (type, point, buttons = 0) => send("Input.dispatchMouseEvent", { type, ...point, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: 1 });
const click = async (x, y) => { const point = await screenPoint(x, y); await mouse("mousePressed", point, 1); await mouse("mouseReleased", point); };

try {
  let page;
  for (let index = 0; index < 60 && !page; index++) {
    try { page = (await (await fetch("http://127.0.0.1:9341/json/list")).json()).find((entry) => entry.type === "page"); } catch {}
    if (!page) await delay(100);
  }
  assert.ok(page, "Host probe browser failed to start");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((value) => value.value || value.description).join(" "));
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) requests.push(message.params.response.url);
    if (message.method === "Fetch.requestPaused") {
      const request = message.params, target = new URL(request.request.url);
      if (target.origin === origin) void send("Fetch.continueRequest", { requestId: request.requestId });
      else { external.push(target.origin + target.pathname); void send("Fetch.failRequest", { requestId: request.requestId, errorReason: "BlockedByClient" }); }
    }
  });
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 1280, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  const initial = await wait((value) => value?.open && value.state === "running" && value.runtimeState === "ready" && value.artReady && value.telemetryCount > 0 && value.openCount > 0, "initial open");
  assert.equal(initial.baseUI, true); assert.equal(initial.backButton, true);
  await capture("initial");
  console.log(JSON.stringify({ phase: "opened", initial }));
  const beforeMove = await evaluate(() => window.__astraHostProbe.lastView.explore.session.world.leader.position);
  await mouse("mousePressed", await screenPoint(0, -470), 1);
  await mouse("mouseMoved", await screenPoint(0, -390), 1); await delay(250);
  await mouse("mouseReleased", await screenPoint(0, -390));
  const afterMove = await evaluate(() => window.__astraHostProbe.lastView.explore.session.world.leader.position);
  assert.ok(Math.hypot(afterMove.x - beforeMove.x, afterMove.y - beforeMove.y) > 1, "Host input did not move the party");
  await click(254, 443); await delay(100);
  assert.equal(await evaluate(() => window.__astraHostProbe.lastView.explore.renderer.overview.isOpen), true);
  assert.equal((await state()).state, "paused");
  await capture("overview"); await click(312, 570); await delay(100);
  assert.equal((await state()).state, "running");

  const back = await evaluate(() => {
    const probe = window.__astraHostProbe, view = probe.lastView;
    window.__closedHostNode = view.node; window.__closedHostRuntime = view.explore.runtime;
    const node = view.content.getChildByName("HostBackButton"), point = node.convertToWorldSpaceAR(cc.v2(0, 0));
    const viewport = cc.view.getViewportRect(), canvas = cc.game.canvas.getBoundingClientRect();
    return { x: canvas.left + (viewport.x + point.x * cc.view.getScaleX()) * canvas.width / cc.game.canvas.width,
      y: canvas.bottom - (viewport.y + point.y * cc.view.getScaleY()) * canvas.height / cc.game.canvas.height };
  });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: back.x, y: back.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: back.x, y: back.y, button: "left", buttons: 0, clickCount: 1 });
  await wait((value) => value && !value.open, "back button"); await delay(100);
  const closed = await evaluate(() => ({ destroyed: !cc.isValid(window.__closedHostNode, true), state: window.__closedHostRuntime.state }));
  assert.deepEqual(closed, { destroyed: true, state: "disposed" });
  await capture("closed");

  await evaluate(async () => { await window.__astraHostProbe.open(true); return true; });
  const cached = await wait((value) => value?.open && value.state === "running" && value.runtimeState === "ready" && value.artReady, "cached open");
  await evaluate(() => window.__astraHostProbe.close());
  const paused = await wait((value) => value && !value.open && value.state === "paused", "cached close");
  await delay(250); assert.equal((await state()).elapsed, paused.elapsed);
  await evaluate(async () => { await window.__astraHostProbe.open(true); return true; });
  const reopened = await wait((value) => value?.open && value.state === "running" && value.runtimeState === "ready" && value.artReady, "cached reopen");
  assert.equal(reopened.viewId, cached.viewId); assert.equal(reopened.contentId, cached.contentId);
  assert.deepEqual(reopened.design, initial.design);
  assert.equal(reopened.profiler, initial.profiler);

  await evaluate(() => {
    const probe = window.__astraHostProbe;
    probe.lastView.explore.session.map.grantFlag("host-probe:A");
    probe.close(); probe.setRole("B");
  });
  await delay(100);
  const roleStorage = await evaluate(() => ({ a: window.__astraHostProbe.readProgress("A"), b: window.__astraHostProbe.readProgress("B") }));
  assert.ok(roleStorage.a.map.flags.includes("host-probe:A")); assert.equal(roleStorage.b, null);
  await evaluate(async () => { await window.__astraHostProbe.open(true); return true; });
  const otherRole = await wait((value) => value?.open && value.state === "running" && value.runtimeState === "ready" && value.artReady, "other role");
  assert.equal(otherRole.viewId, cached.viewId); assert.notEqual(otherRole.contentId, cached.contentId);
  assert.equal(await evaluate(() => window.__astraHostProbe.lastView.explore.session.map.hasFlag("host-probe:A")), false);
  await evaluate(() => window.__astraHostProbe.close());

  const beforeDelayed = (await state()).telemetryCount;
  await evaluate(async () => { await window.__astraHostProbe.open(false, true); return true; });
  await wait((value) => value?.open && value.delayed, "delayed configuration");
  await evaluate(() => { const probe = window.__astraHostProbe; probe.close(); probe.resolveConfig(); });
  await delay(200);
  const cancelled = await state(); assert.equal(cancelled.open, false); assert.equal(cancelled.telemetryCount, beforeDelayed);
  assert.equal(cancelled.closedRuntimeState, "disposed");

  await evaluate(async () => { await window.__astraHostProbe.open(); return true; });
  await wait((value) => value?.state === "running" && value.runtimeState === "ready" && value.artReady, "open before replacement");
  const beforeReplacement = (await state()).telemetryCount;
  const replacement = await evaluate(async () => {
    const probe = window.__astraHostProbe, bootstrap = probe.lastView.explore;
    const pending = bootstrap.open(bootstrap.runtime.ports);
    probe.close(); return await pending;
  });
  assert.equal(replacement, false); assert.equal((await state()).telemetryCount, beforeReplacement);
  await evaluate(async () => { await window.__astraHostProbe.open(); return true; });
  await wait((value) => value?.state === "running" && value.runtimeState === "ready" && value.artReady, "final open");
  const viewports = [];
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); await delay(200);
    viewports.push({ width, height, ...(await state()) }); await capture(`${width}-${height}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(requests, []);
  await writeFile(join(output, "report.json"), JSON.stringify({ passed: true, initial, movement: { before: beforeMove, after: afterMove }, closed, cached, paused, reopened, otherRole, cancelled, viewports, errors, external, requests }, null, 2));
  console.log(JSON.stringify({ passed: true, roleIsolated: true, cacheReused: true, delayedClose: true, viewports: viewports.length, errors, external, requests }));
} catch (error) {
  if (socket?.readyState === 1) { await capture("failure"); await writeFile(join(output, "failure.json"), JSON.stringify({ message: error.message, errors, external, requests }, null, 2)); }
  throw error;
} finally {
  if (socket) socket.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  chrome.kill(); await delay(150);
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}
