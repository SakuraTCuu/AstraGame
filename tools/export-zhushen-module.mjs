import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const outputArg = value("--out");
if (!outputArg) {
  console.log("node tools/export-zhushen-module.mjs --out <export-directory> [--verify-host <creator-project>]");
  process.exit(0);
}
const output = resolve(outputArg);
if (output === root) throw new Error("The export directory must differ from the source project");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const readOptional = async (path) => { try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const previousBytes = await readOptional(join(output, "astra-module.json"));
const previous = previousBytes ? JSON.parse(previousBytes.toString()) : { files: [] };
if (await readOptional(join(output, "project.json"))) throw new Error("Export into a package directory, not directly over a Creator project");
const files = [];

async function add(sourcePath, destinationPath) {
  const bytes = await readFile(join(root, sourcePath));
  files.push({ path: destinationPath.replaceAll("\\", "/"), source: sourcePath.replaceAll("\\", "/"), sha256: hash(bytes), bytes });
}

async function addTree(source, destination) {
  for (const entry of await readdir(join(root, source), { withFileTypes: true })) {
    if (entry.isDirectory()) await addTree(join(source, entry.name), join(destination, entry.name));
    else await add(join(source, entry.name), join(destination, entry.name));
  }
}

const modulePath = "assets/scripts/modules/auto_explore";
for (const directory of ["app", "core", "framework", "presentation"]) {
  await addTree("assets/scripts/" + directory, modulePath + "/" + directory);
  await add("assets/scripts/" + directory + ".meta", modulePath + "/" + directory + ".meta");
}
await add("integrations/zhushen/AstraExploreView.ts", modulePath + "/AstraExploreView.ts");
await add("integrations/zhushen/AstraExploreView.ts.meta", modulePath + "/AstraExploreView.ts.meta");
await addTree("assets/resources/config/auto_explore", "assets/resources/config/auto_explore");
await add("assets/resources/config/auto_explore.meta", "assets/resources/config/auto_explore.meta");
await addTree("assets/resources/auto_explore", "assets/resources/auto_explore");
await add("assets/resources/auto_explore.meta", "assets/resources/auto_explore.meta");
const folderMeta = Buffer.from(JSON.stringify({ ver: "1.1.3", uuid: "cc09fe04-76d5-48d6-a0a5-4261d46fd423", importer: "folder",
  isBundle: false, bundleName: "", priority: 1, compressionType: {}, optimizeHotUpdate: {}, inlineSpriteFrames: {}, isRemoteBundle: {}, subMetas: {} }, null, 2) + "\n");
files.push({ path: modulePath + ".meta", source: "generated", sha256: hash(folderMeta), bytes: folderMeta });

let hostCheck = null;
const hostArg = value("--verify-host");
if (hostArg) {
  const host = resolve(hostArg);
  const project = JSON.parse((await readFile(join(host, "project.json"))).toString());
  if (project.version !== "2.4.15") throw new Error("Expected a Cocos Creator 2.4.15 host");
  for (const path of ["view/BaseUI.ts", "manager/UIManager.ts", "manager/StorageMgr.ts", "util/MessageCenter.ts", "constant/LayerConstant.ts"]) {
    await readFile(join(host, "assets/scripts/comm", path));
  }
  for (const file of files) {
    const existing = await readOptional(join(host, file.path));
    if (existing && hash(existing) !== file.sha256) throw new Error("Host conflict: " + file.path);
  }
  hostCheck = { path: host, creator: project.version, destinationConflicts: 0, installed: false };
}

for (const retired of previous.files) {
  if (!files.some((file) => file.path === retired.path)) throw new Error("Export contains retired files; choose a new output directory");
}
for (const file of files) {
  const destination = resolve(output, file.path);
  if (relative(output, destination).startsWith("..")) throw new Error("Export path escaped its directory");
  const existing = await readOptional(destination);
  const old = previous.files.find((entry) => entry.path === file.path);
  if (existing && hash(existing) !== file.sha256 && (!old || hash(existing) !== old.sha256)) throw new Error("Unmanaged export change: " + file.path);
}
for (const file of files) {
  const destination = join(output, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.bytes);
}
const manifest = { schemaVersion: 1, creator: "2.4.15", entry: modulePath + "/AstraExploreView.ts", hostCheck,
  files: files.map(({ path, source, sha256 }) => ({ path, source, sha256 })) };
await writeFile(join(output, "astra-module.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, fileCount: files.length, hostCheck }, null, 2));
