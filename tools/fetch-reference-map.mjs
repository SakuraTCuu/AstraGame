import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { decodeUuid, inside, openCache } from "./reference-cache.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const cacheRoot = option("--cache"), baseUrl = option("--base-url"), mapName = option("--map");
if (!cacheRoot || !baseUrl || !/^[A-Za-z0-9_]+$/.test(mapName || "")) throw new Error("Specify --cache, --base-url and --map for the authorized reference scene");
const base = new URL(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
if (base.protocol !== "https:" || base.username || base.password || base.search) throw new Error("Use a public HTTPS resource base without credentials");
const output = inside(process.cwd(), option("--out", "reference-private/downloads"));
execFileSync("git", ["check-ignore", "--quiet", relative(process.cwd(), join(output, "manifest.json"))]);
const cache = await openCache(resolve(cacheRoot));
const configEntry = cache.latest(/^remote\/map\/config\.[^_]+\.json$/);
const config = await cache.readConfig(configEntry);
const remote = await fetch(new URL(configEntry.key, base), { signal: AbortSignal.timeout(30000) });
if (!remote.ok || !isDeepStrictEqual(await remote.json(), config)) throw new Error("The remote map configuration does not match the supplied cache");
await mkdir(output, { recursive: true });
let manifest = { schema: 1, baseUrl: base.href, files: {} };
try { manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (manifest.baseUrl !== base.href) throw new Error("Supplement directory belongs to a different resource base");
const versions = new Map();
for (let index = 0; index < config.versions.native.length; index += 2) versions.set(config.versions.native[index], config.versions.native[index + 1]);
const present = new Set(cache.entries.map((entry) => entry.key));
const tasks = [];
for (const [index, [path, type]] of Object.entries(config.paths)) {
  if (config.types[type] !== "cc.Texture2D" || !path.startsWith(mapName + "/")) continue;
  const uuid = decodeUuid(config.uuids[Number(index)]), version = versions.get(Number(index));
  if (!version) throw new Error(`Missing native version for ${path}`);
  const key = `remote/map/native/${uuid.slice(0, 2)}/${uuid}.${version}.png`;
  if (present.has(key) || manifest.files[key]) continue;
  tasks.push({ key, path });
}
let cursor = 0, complete = 0, bytes = 0;
const errors = [];
const worker = async () => {
  while (cursor < tasks.length) {
    const task = tasks[cursor++];
    try {
      const response = await fetch(new URL(task.key, base), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Response is not a PNG asset");
      const destination = inside(output, task.key);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
      manifest.files[task.key] = { file: task.key, path: task.path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
      bytes += data.length; complete++;
      if (complete % 50 === 0) console.log(JSON.stringify({ downloaded: complete, total: tasks.length }));
    } catch (error) { errors.push({ path: task.path, error: error.message }); }
  }
};
await Promise.all(Array.from({ length: 4 }, worker));
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ mapName, downloaded: complete, bytes, errors, output }, null, 2));
if (errors.length) process.exitCode = 1;
