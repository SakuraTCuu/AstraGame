import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--host") || !args.includes("--spine")) throw new Error("Required: --host <Creator host> --spine <Spine Creator project>");
const host = resolve(option("--host")), spine = resolve(option("--spine"));
const output = resolve(args.includes("--out") ? option("--out") : join(root, "temp/zhushen-runtime-checked"));
if (!output.startsWith(join(root, "temp") + sep) || output === host || output === spine || output.startsWith(host + sep)) throw new Error("The runtime probe must be staged under this repository's temp directory");
const manifestPath = join(output, "host-probe.json");
const exists = async (path) => { try { await stat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
if (await exists(output) && !await exists(manifestPath)) throw new Error("The destination is not a managed host probe");
const previous = await exists(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : { files: [] };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [], records = new Map(previous.files.map((file) => [file.path, file]));
const project = JSON.parse(await readFile(join(host, "project.json"), "utf8"));
if (project.version !== "2.4.15") throw new Error("The host must use Creator 2.4.15");
const require = createRequire(import.meta.url), ts = require(join(host, "node_modules/typescript"));
for (const name of ["AstraHostLoader", "AstraHostProbe"]) {
  const source = await readFile(join(root, `integrations/zhushen/runtime/${name}.ts`), "utf8");
  const result = ts.transpileModule(source, { fileName: `${name}.ts`, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
  if (result.diagnostics?.length) throw new Error(result.diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("\n"));
}

async function put(path, bytes, source = "generated") {
  const destination = resolve(output, path), sourceSha256 = hash(bytes);
  let digest = sourceSha256;
  let unchanged = false;
  if (!destination.startsWith(output + sep)) throw new Error("Probe file escaped the destination");
  if (await exists(destination)) {
    const currentBytes = await readFile(destination), current = hash(currentBytes), old = records.get(path);
    if (current !== digest && (!old || current !== old.sha256)) {
      if ((path.endsWith(".meta") || path === "settings/project.json" || path === "project.json") &&
          isDeepStrictEqual(JSON.parse(currentBytes.toString()), JSON.parse(bytes.toString()))) { bytes = currentBytes; digest = current; }
      else throw new Error(`Unmanaged probe edit: ${path}`);
    }
    unchanged = current === digest;
  }
  if (!unchanged) { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); }
  files.push({ path, source, sha256: digest, sourceSha256 });
}
const copy = async (source, path) => put(path, await readFile(source), source);
const code = new Set([".ts", ".js", ".json", ".mjs", ".wasm"]);
async function tree(source, destination, all = false) {
  for (const item of await readdir(source, { withFileTypes: true })) {
    const path = join(source, item.name), target = join(destination, item.name).replaceAll("\\", "/");
    if (item.isDirectory()) await tree(path, target, all);
    else if (item.isFile()) {
      let allowed = all || code.has(extname(item.name));
      if (item.name.endsWith(".meta")) {
        const asset = path.slice(0, -5);
        allowed = all || (await exists(asset) && ((await stat(asset)).isDirectory() || code.has(extname(asset))));
      }
      if (allowed) await copy(path, target);
    }
  }
}
try {
for (const folder of ["scripts", "startScripts", "addon"]) {
  await tree(join(host, "assets", folder), `assets/${folder}`, folder === "addon");
  if (await exists(join(host, "assets", `${folder}.meta`))) await copy(join(host, "assets", `${folder}.meta`), `assets/${folder}.meta`);
}
for (const suffix of ["", ".meta"]) await copy(join(host, `assets/scripts/launch/Main.prefab${suffix}`), `assets/scripts/launch/Main.prefab${suffix}`);
for (const path of ["assets/spine.meta", "assets/spine/spine.meta", "assets/spine/spine/E20910.meta"])
  await copy(join(spine, path), path);
await tree(join(spine, "assets/spine/spine/E20910"), "assets/spine/spine/E20910", true);
for (const path of ["assets/resources.meta", "tsconfig.json"]) if (await exists(join(host, path))) await copy(join(host, path), path);

const packages = new Set();
async function dependency(name) {
  if (packages.has(name)) return; packages.add(name);
  const source = join(host, "node_modules", name), destination = join(output, "node_modules", name);
  const data = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  await mkdir(dirname(destination), { recursive: true }); await cp(source, destination, { recursive: true, dereference: true });
  for (const child of Object.keys(data.dependencies || {})) await dependency(child);
}
const hostPackage = JSON.parse(await readFile(join(host, "package.json"), "utf8"));
for (const name of Object.keys(hostPackage.dependencies || {})) await dependency(name);
await put("package.json", Buffer.from(JSON.stringify({ private: true, dependencies: hostPackage.dependencies }, null, 2)));

const module = join(root, "temp/zhushen-module"), exported = JSON.parse(await readFile(join(module, "astra-module.json"), "utf8"));
for (const file of exported.files) await copy(join(module, file.path), file.path);
const loaderUuid = "58483505-1262-47be-8fe4-60b8294b0499", probeUuid = "73e21513-a121-444f-8bd7-6e5c0abc62b3";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const compress = (uuid) => {
  const value = uuid.replaceAll("-", ""); let result = value.slice(0, 5);
  for (let index = 5; index < value.length; index += 3) { const chunk = parseInt(value.slice(index, index + 3), 16); result += alphabet[chunk >> 6] + alphabet[chunk & 63]; }
  return result;
};
const baseMeta = JSON.parse(await readFile(join(root, "assets/scripts/app/DemoBootstrap.ts.meta"), "utf8"));
for (const [name, uuid, destination] of [["AstraHostLoader", loaderUuid, "assets/AstraHostLoader.ts"], ["AstraHostProbe", probeUuid, "assets/scripts/modules/auto_explore/AstraHostProbe.ts"]]) {
  await copy(join(root, `integrations/zhushen/runtime/${name}.ts`), destination);
  await put(`${destination}.meta`, Buffer.from(JSON.stringify({ ...baseMeta, uuid }, null, 2)));
}
const scene = JSON.parse(await readFile(join(root, "assets/scenes/demo.fire"), "utf8"));
const component = scene.find((entry) => entry.__type__ === compress(baseMeta.uuid));
if (!component) throw new Error("Could not identify the standalone scene bootstrap");
component.__type__ = compress(loaderUuid); scene[0]._name = "host_probe";
await put("assets/scenes/host_probe.fire", Buffer.from(JSON.stringify(scene, null, 2)));
await copy(join(root, "assets/scenes/demo.fire.meta"), "assets/scenes/host_probe.fire.meta");
const sceneUuid = JSON.parse(await readFile(join(root, "assets/scenes/demo.fire.meta"), "utf8")).uuid;
const settings = JSON.parse(await readFile(join(host, "settings/project.json"), "utf8")); settings["start-scene"] = sceneUuid;
await put("settings/project.json", Buffer.from(JSON.stringify(settings, null, 2)));
await put("project.json", Buffer.from(JSON.stringify({ ...project, name: "AstraZhushenHostProbe", id: "8065f790-c5c8-4dde-8512-5a020fd60d5a" }, null, 2)));
const paths = new Set(files.map((file) => file.path));
const retired = previous.files.filter((file) => !paths.has(file.path));
if (retired.length) throw new Error("The probe has retired source files; prepare a fresh output directory");
await mkdir(output, { recursive: true });
const report = { schema: 1, host, spine, sceneUuid, files, dependencies: [...packages], originalModified: false, loginStarted: false };
await writeFile(manifestPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, files: files.length, dependencies: [...packages], sceneUuid, originalModified: false }, null, 2));
} catch (error) {
  await mkdir(output, { recursive: true });
  const retained = new Map(previous.files.map((file) => [file.path, file]));
  for (const file of files) retained.set(file.path, file);
  await writeFile(manifestPath, JSON.stringify({ schema: 1, host, spine, files: [...retained.values()], failed: true }, null, 2));
  throw error;
}
