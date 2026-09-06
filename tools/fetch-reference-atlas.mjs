import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { inside, mergeBundleParts, openCache } from "./reference-cache.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const cacheRoot = option("--cache"), baseUrl = option("--base-url"), atlas = option("--atlas");
if (!cacheRoot || !baseUrl || !/^uires\/skillEffect\/[A-Za-z0-9_]+$/.test(atlas || "")) throw new Error("Specify --cache, --base-url and one --atlas effect path");
const base = new URL(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
if (base.protocol !== "https:" || base.username || base.password || base.search) throw new Error("Use a public HTTPS resource base without credentials");
const output = inside(process.cwd(), option("--out", "reference-private/downloads"));
execFileSync("git", ["check-ignore", "--quiet", relative(process.cwd(), join(output, "manifest.json"))]);
const cache = await openCache(resolve(cacheRoot), output), parts = [];
for (const pattern of [/^remote\/resources\/config\.[^_]+\.json$/, /^remote\/resources\/config\.[^_]+_1\.json$/]) {
  const entry = cache.latest(pattern); if (!entry) throw new Error("Missing source resource configuration");
  const local = await cache.readConfig(entry), remote = await fetch(new URL(entry.key, base), { signal: AbortSignal.timeout(30000) });
  if (!remote.ok || !isDeepStrictEqual(await remote.json(), local)) throw new Error("Remote resource configuration differs from the supplied cache");
  parts.push(local);
}
const config = mergeBundleParts(parts), imports = new Map(), natives = new Map();
for (let index = 0; index < config.versions.import.length; index += 2) imports.set(config.versions.import[index], config.versions.import[index + 1]);
for (let index = 0; index < config.versions.native.length; index += 2) natives.set(config.versions.native[index], config.versions.native[index + 1]);
const selected = Object.entries(config.paths).filter(([, [path, type]]) => path === atlas && ["cc.SpriteAtlas", "cc.Texture2D"].includes(config.types[type]));
if (!selected.some(([, [, type]]) => config.types[type] === "cc.SpriteAtlas")) throw new Error("No source SpriteAtlas at the requested path");
const tasks = new Set();
for (const [indexText, [, type]] of selected) {
  const index = Number(indexText), uuid = config.uuids[index];
  const pack = Object.entries(config.packs).find(([, ids]) => ids.includes(index))?.[0], importId = pack || uuid, version = imports.get(pack || index);
  if (!version) throw new Error("Missing import version for the selected asset");
  tasks.add(`remote/resources/import/${importId.slice(0, 2)}/${importId}.${version}.json`);
  if (config.types[type] === "cc.Texture2D") {
    if (!natives.has(index)) throw new Error("Missing texture version");
    tasks.add(`remote/resources/native/${uuid.slice(0, 2)}/${uuid}.${natives.get(index)}.png`);
  }
}
await mkdir(output, { recursive: true });
let manifest = { schema: 1, baseUrl: base.href, files: {} };
try { manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (manifest.baseUrl !== base.href) throw new Error("Supplement directory belongs to a different resource base");
const downloaded = [];
for (const key of tasks) {
  if (cache.entries.some((entry) => entry.key === key)) continue;
  const response = await fetch(new URL(key, base), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${key}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (key.endsWith(".json")) JSON.parse(data.toString("utf8"));
  else if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Response is not a PNG asset");
  const destination = inside(output, key); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, data);
  manifest.files[key] = { file: key, path: atlas, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  downloaded.push({ key, bytes: data.length });
}
console.log(JSON.stringify({ atlas, downloaded, output }, null, 2));
