import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] || "temp/zhushen-runtime-checked");
const manifest = JSON.parse(await readFile(join(directory, "host-probe.json"), "utf8"));
if (manifest.failed) throw new Error("The host probe was not prepared successfully");
const files = manifest.files.filter((file) => file.source !== "generated"), changed = [], stagedExportChanged = [];
const isExportedAsset = (path) => path.startsWith("assets/scripts/modules/auto_explore/") ||
  path.startsWith("assets/resources/config/auto_explore/") || path.startsWith("assets/resources/auto_explore/") ||
  path === "assets/scripts/modules/auto_explore.meta" || path === "assets/resources/config/auto_explore.meta" || path === "assets/resources/auto_explore.meta";
const canonicalJson = (value) => Array.isArray(value) ? value.map(canonicalJson) : value && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])])) : value;
const equivalentMeta = (source, staged) => {
  try { return JSON.stringify(canonicalJson(JSON.parse(source))) === JSON.stringify(canonicalJson(JSON.parse(staged))); }
  catch { return false; }
};
const exists = async (path) => access(path).then(() => true, () => false);
const listFiles = async (root, prefix) => {
  if (!await exists(root)) return [];
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name), relative = `${prefix}/${entry.name}`.replace(/\\/g, "/");
    if (entry.isDirectory()) result.push(...await listFiles(path, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
};
for (let index = 0; index < files.length; index += 32) {
  await Promise.all(files.slice(index, index + 32).map(async (file) => {
    const digest = createHash("sha256").update(await readFile(file.source)).digest("hex");
    if (digest !== (file.sourceSha256 || file.sha256)) changed.push(file.source);
  }));
}
const exportedFiles = manifest.files.filter((file) => isExportedAsset(file.path));
for (let index = 0; index < exportedFiles.length; index += 32) {
  await Promise.all(exportedFiles.slice(index, index + 32).map(async (file) => {
    const stagedBytes = await readFile(join(directory, file.path));
    const staged = createHash("sha256").update(stagedBytes).digest("hex");
    if (staged === file.sha256) return;
    if (file.path.endsWith(".meta") && file.source !== "generated") {
      const sourceBytes = await readFile(file.source);
      if (equivalentMeta(sourceBytes.toString("utf8"), stagedBytes.toString("utf8"))) return;
    }
    stagedExportChanged.push(file.path);
  }));
}
const expectedExportPaths = new Set(exportedFiles.map((file) => file.path));
const actualExportPaths = (await Promise.all([
  listFiles(join(directory, "assets/scripts/modules/auto_explore"), "assets/scripts/modules/auto_explore"),
  listFiles(join(directory, "assets/resources/config/auto_explore"), "assets/resources/config/auto_explore"),
  listFiles(join(directory, "assets/resources/auto_explore"), "assets/resources/auto_explore"),
])).flat();
for (const path of ["assets/scripts/modules/auto_explore.meta", "assets/resources/config/auto_explore.meta", "assets/resources/auto_explore.meta"])
  if (await exists(join(directory, path))) actualExportPaths.push(path);
const unexpectedExportFiles = actualExportPaths.filter((path) => !expectedExportPaths.has(path)).sort();
const report = { sourceFilesVerified: files.length, changed, stagedExportChanged, unexpectedExportFiles,
  runtimeFiles: manifest.files.filter((file) => /comm\/(view\/(BaseUI|BaseView)|manager\/(UIManager|StorageMgr|ResourceManager|LayerManager)|util\/MessageCenter)\.ts$/.test(file.path)) };
await writeFile(join(directory, "source-verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceFilesVerified: files.length, changed, stagedExportChanged, unexpectedExportFiles }, null, 2));
if (changed.length || stagedExportChanged.length || unexpectedExportFiles.length) process.exitCode = 1;
