import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";

export function inside(root, relative) {
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Path escapes directory: ${relative}`);
  return target;
}

export function decodeUuid(value) {
  if (value.length !== 22) return value;
  const hex = value.slice(0, 2) + Buffer.from(value.slice(2), "base64").toString("hex");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Invalid compressed UUID");
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export function readTableArchive(buffer) {
  let cursor = 0;
  const take = (size) => {
    if (!Number.isSafeInteger(size) || size < 0 || cursor + size > buffer.length) throw new Error("Truncated table archive");
    const data = buffer.subarray(cursor, cursor + size);
    cursor += size;
    return data;
  };
  const integer = () => take(4).readUInt32BE();
  const count = integer();
  if (count > 10000) throw new Error("Invalid table count");
  const tables = {};
  for (let index = 0; index < count; index++) {
    const name = take(integer()).toString("utf8");
    const compression = take(1)[0];
    if (compression > 1 || Object.hasOwn(tables, name)) throw new Error("Invalid table envelope");
    const data = take(integer());
    tables[name] = JSON.parse((compression ? inflateSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : data).toString("utf8"));
  }
  if (cursor !== buffer.length) throw new Error("Trailing table archive data");
  return tables;
}

export async function openCache(root, supplement) {
  const index = JSON.parse(await readFile(inside(root, "cacheList.json"), "utf8"));
  const entries = Object.entries(index.files).map(([key, value]) => {
    const prefix = "wxfile://usr/gamecaches/";
    if (!value.url.startsWith(prefix)) throw new Error("Unsupported cache location");
    return { key, file: inside(root, value.url.slice(prefix.length)), time: Number(value.lastTime || 0) };
  });
  if (supplement) {
    let manifest;
    try { manifest = JSON.parse(await readFile(inside(supplement, "manifest.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const [key, value] of Object.entries(manifest?.files || {})) {
      if (!/^remote\/map\/native\/[a-f0-9]{2}\/[a-f0-9-]+\.[a-f0-9]+\.png$/.test(key) &&
          !/^remote\/resources\/(?:import\/[a-f0-9]{2}\/[a-f0-9-]+\.[a-f0-9]+\.json|native\/[a-f0-9]{2}\/[a-f0-9-]+\.[a-f0-9]+\.(?:png|bin))$/.test(key)) throw new Error("Invalid supplemental resource path");
      if (!entries.some((entry) => entry.key === key)) entries.push({ key, file: inside(supplement, value.file), time: 0 });
    }
  }
  const latest = (pattern) => entries.filter((entry) => pattern.test(entry.key)).sort((a, b) => b.time - a.time)[0];
  const readConfig = async (entry) => JSON.parse(await readFile(entry.file, "utf8"));
  return { root, entries, latest, readConfig };
}

export function indexAssets(config, bundle, entries) {
  const cached = new Map();
  for (const entry of entries) {
    if (!entry.key.startsWith(`remote/${bundle}/`)) continue;
    const id = basename(entry.key).split(".")[0];
    const values = cached.get(id) || [];
    values.push(entry);
    cached.set(id, values);
  }
  const packById = new Map();
  for (const [pack, ids] of Object.entries(config.packs || {})) for (const id of ids) packById.set(id, pack);
  return Object.entries(config.paths).map(([index, [path, type]]) => {
    const uuid = decodeUuid(config.uuids[Number(index)]);
    const direct = cached.get(uuid) || [];
    const packed = cached.get(packById.get(Number(index))) || [];
    return { uuid, path, type: config.types[type],
      imported: direct.find((entry) => entry.key.includes("/import/")) || packed.find((entry) => entry.key.includes("/import/")),
      native: direct.find((entry) => entry.key.includes("/native/")) };
  });
}

export function mergeBundleParts(parts) {
  const combined = { paths: {}, types: [], uuids: [], packs: {}, versions: { import: [], native: [] }, deps: [], redirect: [], scenes: {} };
  const uuidIndices = new Map();
  const importVersions = new Map();
  const nativeVersions = new Map();
  for (const part of parts) {
    const ids = part.uuids.map((value) => {
      const uuid = decodeUuid(value);
      if (!uuidIndices.has(uuid)) { uuidIndices.set(uuid, combined.uuids.length); combined.uuids.push(uuid); }
      return uuidIndices.get(uuid);
    });
    const types = part.types.map((type) => {
      if (!combined.types.includes(type)) combined.types.push(type);
      return combined.types.indexOf(type);
    });
    for (const [index, [path, type, ...rest]] of Object.entries(part.paths)) combined.paths[ids[Number(index)]] = [path, types[type], ...rest];
    for (const [pack, indices] of Object.entries(part.packs || {})) combined.packs[pack] = indices.map((id) => ids[id]);
    for (const [kind, values] of Object.entries(part.versions || {})) {
      const versions = kind === "import" ? importVersions : nativeVersions;
      for (let index = 0; index < values.length; index += 2) versions.set(typeof values[index] === "number" ? ids[values[index]] : values[index], values[index + 1]);
    }
    const deps = (part.deps || []).map((name) => {
      if (!combined.deps.includes(name)) combined.deps.push(name);
      return combined.deps.indexOf(name);
    });
    for (let index = 0; index < (part.redirect || []).length; index += 2) combined.redirect.push(ids[part.redirect[index]], deps[part.redirect[index + 1]]);
  }
  combined.versions.import = [...importVersions].flat();
  combined.versions.native = [...nativeVersions].flat();
  return combined;
}

export function tableRow(table, id, seen = new Set()) {
  if (seen.has(String(id))) throw new Error(`Circular table reference ${id}`);
  const data = table[id]?.datas?.[0];
  if (!data) return null;
  const next = new Set(seen).add(String(id));
  const result = {};
  for (const [field, index] of Object.entries(table.__KEY_MAP__ || {})) {
    const value = data[index];
    result[field] = typeof value === "string" && /^\$\d+$/.test(value) ? tableRow(table, value.slice(1), next)?.[field] : value;
  }
  return result;
}
