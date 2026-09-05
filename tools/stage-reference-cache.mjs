import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { indexAssets, inside, mergeBundleParts, openCache, readTableArchive } from "./reference-cache.mjs";
import { buildReferenceProfile } from "./build-reference-profile.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const cacheRoot = option("--cache");
if (!cacheRoot) throw new Error("Usage: node tools/stage-reference-cache.mjs --cache <authorized cache directory> [--out build/web-mobile/reference-preview]");
const output = inside(process.cwd(), option("--out", "build/web-mobile/reference-preview"));
execFileSync("git", ["check-ignore", "--quiet", relative(process.cwd(), join(output, "manifest.json"))]);
const cache = await openCache(resolve(cacheRoot), resolve(option("--supplement", "reference-private/downloads")));
const specs = [
  ["resources", "reference-resources", [/^remote\/resources\/config\.[^_]+\.json$/, /^remote\/resources\/config\.[^_]+_1\.json$/]],
  ["map", "reference-map", [/^remote\/map\/config\.[^_]+\.json$/]],
];
const manifest = { schema: 1, bundles: [], assets: [], tables: "tables.json" };
let copied = 0;
for (const [source, name, patterns] of specs) {
  const entries = patterns.map((pattern) => cache.latest(pattern));
  if (entries.some((entry) => !entry)) throw new Error(`Missing bundle configuration: ${source}`);
  const config = mergeBundleParts(await Promise.all(entries.map((entry) => cache.readConfig(entry))));
  Object.assign(config, { name, importBase: "import", nativeBase: "native", debug: false, isZip: false, encrypted: false });
  await mkdir(join(output, name), { recursive: true });
  await writeFile(join(output, name, "config.json"), JSON.stringify(config));
  await writeFile(join(output, name, "index.js"), "// Local resource-only bundle.\n");
  for (const resource of cache.entries) {
    if (!resource.key.startsWith(`remote/${source}/`) || !/\/(import|native)\//.test(resource.key)) continue;
    const target = inside(join(output, name), resource.key.slice(`remote/${source}/`.length));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resource.file, target);
    copied++;
  }
  const assets = indexAssets(config, source, cache.entries).filter((asset) => asset.imported);
  manifest.bundles.push({ name, configKeys: entries.map((entry) => entry.key) });
  manifest.assets.push(...assets.map(({ uuid, path, type, native }) => ({ bundle: name, uuid, path, type,
    native: native ? `${name}/${native.key.slice(`remote/${source}/`.length)}` : null })));
}
const tableEntries = new Map();
for (const entry of cache.entries.filter((entry) => entry.key.endsWith(".sd33"))) {
  const part = entry.key.match(/_sd_(\d+)\.sd33$/)?.[1];
  if (part === undefined) continue;
  if (!tableEntries.has(part) || tableEntries.get(part).time < entry.time) tableEntries.set(part, entry);
}
const tables = {};
for (const entry of tableEntries.values()) Object.assign(tables, readTableArchive(await readFile(entry.file)));
await writeFile(join(output, "tables.json"), JSON.stringify(tables));
const profile = await buildReferenceProfile(cache, manifest.assets, tables,
  JSON.parse(await readFile("assets/resources/config/auto_explore/world_demo.json", "utf8")));
await writeFile(join(output, "profile.json"), JSON.stringify(profile.config));
await writeFile(join(output, "audit.json"), JSON.stringify(profile.audit, null, 2));
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, copied, tables: Object.keys(tables).length,
  bundles: manifest.bundles, spines: manifest.assets.filter((asset) => asset.type === "sp.SkeletonData" && asset.native).length }, null, 2));
