import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { tableRow } from "./reference-cache.mjs";

function readJsonAsset(data) {
  const json = JSON.parse(data);
  if (json[0] !== 1 || json[3]?.[0]?.[0] !== "cc.JsonAsset" ||
      JSON.stringify(json[3][0][1]) !== '["_name","json"]' || json[5]?.length !== 1) throw new Error("Unsupported standalone JsonAsset encoding");
  return json[5][0][2];
}

export async function buildReferenceProfile(cache, assets, tables, baseConfig) {
  const families = new Map();
  for (const [name, table] of Object.entries(tables)) {
    const family = name.match(/^(Avatar|Hero|Monster|MonsterSpawn|GameMap|WorldMap)_(?:\d+|Xs)$/)?.[1];
    if (!family) continue;
    if (!families.has(family)) families.set(family, new Map());
    for (const id of Object.keys(table)) if (id !== "__KEY_MAP__") families.get(family).set(id, table);
  }
  const row = (family, id) => {
    const table = families.get(family)?.get(String(id));
    return table ? tableRow(table, id) : null;
  };
  const sourceMap = row("GameMap", 100001);
  const sceneAsset = assets.find((asset) => asset.path === `data/mapCfg/${sourceMap.name}` && asset.type === "cc.JsonAsset");
  const entry = cache.entries.find((entry) => entry.key.includes(`/import/${sceneAsset.uuid.slice(0, 2)}/${sceneAsset.uuid}.`));
  const scene = readJsonAsset(await readFile(entry.file, "utf8"));
  const cut = scene.cutImgLayer;
  const depth = 0.6;
  const origin = { x: cut.offset.x, y: cut.offset.y - cut.height };
  const toWorld = (x, y) => ({ x: x - origin.x, y: (y - origin.y) / depth });
  const collision = inflateSync(Buffer.from(scene.blockLayer.bufferStr, "base64"));
  if (collision.length !== scene.blockLayer.width * scene.blockLayer.height) throw new Error("Collision layer length mismatch");
  const sourceBlocked = (x, y) => {
    const gx = Math.floor(x * 3 / 200 - y * 3 / 120) + scene.blockLayer.offset.x;
    const gy = Math.floor(-x * 3 / 200 - y * 3 / 120) + scene.blockLayer.offset.y;
    return gx < 0 || gy < 0 || gx >= scene.blockLayer.width || gy >= scene.blockLayer.height || collision[gy * scene.blockLayer.width + gx] !== 0;
  };
  const config = structuredClone(baseConfig);
  const cellSize = 40;
  config.meta = { id: "local-reference-world", schemaVersion: 1, contentStatus: "LOCAL_REFERENCE_PREVIEW" };
  config.session = { autoStopForCombat: true };
  config.world = { ...config.world, id: "reference-world", name: sourceMap.desc,
    width: Math.floor(cut.width / cellSize) * cellSize, height: Math.floor(cut.height / depth / cellSize) * cellSize,
    cellSize, obstacles: [], pointsOfInterest: [], blocked: [], start: toWorld(...sourceMap.born.split(",").map(Number)) };
  for (let y = 0; y < config.world.height / cellSize; y++) for (let x = 0; x < config.world.width / cellSize; x++) {
    const blocked = [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]].some(([dx, dy]) =>
      sourceBlocked(origin.x + (x + dx) * cellSize, origin.y + (y + dy) * cellSize * depth));
    if (blocked) config.world.blocked.push({ x, y });
  }
  config.fog = { ...config.fog, cellSize: 240, unlockZones: [], revealRadius: 600 };
  const art = { bundle: "reference-resources", mapBundle: "reference-map", mapName: cut.name,
    tileSize: 1024, mapHeight: cut.height, mapWidth: cut.width, depth, scale: 0.82,
    tiles: assets.filter((asset) => asset.bundle === "reference-map" && asset.type === "cc.Texture2D" && asset.native && asset.path.startsWith(`${cut.name}/`)).map((asset) => asset.path),
    bindings: {}, sourceOrigin: origin, regions: [] };
  const blockedCells = new Set(config.world.blocked.map(({ x, y }) => `${x},${y}`));
  const initialPosition = (x, y) => {
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
    if (!blockedCells.has(`${cx},${cy}`)) return { x, y };
    const candidates = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (cx + dx < 0 || cy + dy < 0 || blockedCells.has(`${cx + dx},${cy + dy}`)) continue;
      candidates.push({ x: (cx + dx + 0.5) * cellSize, y: (cy + dy + 0.5) * cellSize });
    }
    candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    if (!candidates.length) throw new Error("No walkable party start near source spawn");
    return candidates[0];
  };
  const binding = (avatarId) => {
    const avatar = row("Avatar", avatarId);
    if (!avatar) return null;
    const path = avatar.isHeroSpine ? `spine/${avatar.atlasName}` : `uires/${avatar.spriteAtlasPath}/${avatar.atlasName}`;
    const type = avatar.isHeroSpine ? "sp.SkeletonData" : "cc.SpriteAtlas";
    const found = assets.find((asset) => asset.path === path && asset.type === type && (type !== "sp.SkeletonData" || asset.native));
    return found ? { path, kind: avatar.isHeroSpine ? "spine" : "atlas", scale: avatar.scale || 1,
      height: avatar.height || 120, fps: avatar.fps || 12, flip: Boolean(avatar.flip), avatarId } : null;
  };
  [13, 1, 9, 8].forEach((id, index) => {
    const hero = row("Hero", id);
    const actor = config.squad.actors[index];
    actor.name = hero.name;
    Object.assign(actor, initialPosition(config.world.start.x + config.squad.formationOffsets[index].x,
      config.world.start.y + config.squad.formationOffsets[index].y));
    art.bindings[actor.id] = binding(hero.display);
    if (art.bindings[actor.id]) art.bindings[actor.id].skillAnimations = Object.fromEntries(actor.skillIds.map((id, index) => [id, index === 0 ? "attack" : `skill${index}`]));
  });
  const enemies = new Map();
  config.spawns = [];
  const skipped = [];
  for (const id of families.get("MonsterSpawn").keys()) {
    const spawn = row("MonsterSpawn", id);
    if (spawn.map !== 100001 || spawn.type === 1 || !/^\d+_\d+$/.test(spawn.monsterSpawn)) continue;
    const [monsterId, count] = spawn.monsterSpawn.split("_").map(Number);
    const monster = row("Monster", monsterId);
    if (!monster || ![1, 2].includes(monster.type) || !monster.attr?.atk) continue;
    const position = toWorld(spawn.px, spawn.py);
    if (position.x < 0 || position.y < 0 || position.x >= config.world.width || position.y >= config.world.height) continue;
    const visual = binding(monster.avatar);
    if (!visual) { skipped.push({ spawnId: id, monsterId, avatar: monster.avatar }); continue; }
    const boss = monster.type === 2;
    const templateId = `reference_monster_${monsterId}`;
    enemies.set(templateId, { id: templateId, name: monster.name || visual.path.split("/").pop(), kind: boss ? "boss" : "enemy",
      x: position.x, y: position.y, hp: monster.attr.maxhp, attack: monster.attr.atk, defense: monster.attr.def || 0,
      moveSpeed: Math.max(50, (monster.attr.movespeed || 50) * (monster.runSpeedRate || 100) / 100),
      attackRange: monster.atkRange || 150, aggroRange: boss ? 480 : 350, leashRange: Math.min(monster.homeRange || 800, 1600),
      phaseThresholds: boss ? [0.7, 0.3] : undefined, healthBars: boss ? 20 : 1 });
    const spawnId = `reference_spawn_${id}`;
    art.bindings[spawnId] = visual;
    config.spawns.push({ id: spawnId, trigger: "distance", ...position, triggerRadius: 850, enemyId: templateId,
      count: Math.min(count, 8), spawnRadius: count > 1 ? 50 : 0, respawn: Boolean(monster.rebirthTime), respawnDelay: monster.rebirthTime || 45 });
  }
  config.enemies = [...enemies.values()];
  config.skills.definitions = config.skills.definitions.filter((skill) => !skill.summonEnemyId);
  for (const id of families.get("WorldMap").keys()) {
    const region = row("WorldMap", id);
    if (region.mapId !== 100001) continue;
    art.regions.push({ id, name: region.regionName, ...toWorld(...region.namePlace.split("_").map(Number)) });
  }
  config.presentation = { reference: art };
  return { config, audit: { map: sceneAsset.path, collisionGrid: [scene.blockLayer.width, scene.blockLayer.height],
    routeSamples: scene.pathpoint.reduce((count, path) => count + path.length / 2, 0),
    blockedRouteSamples: scene.pathpoint.reduce((count, path) => count + path.filter((_, index) => index % 2 === 0 && sourceBlocked(path[index], path[index + 1])).length, 0),
    cachedMapTextures: art.tiles.length, enemyTemplates: enemies.size, encounterPlacements: config.spawns.length, missingArt: skipped,
    limitations: ["Hero stats and skill execution use the independent combat fixture; they do not reconstruct the account.", "Fog purchase conditions, source skill formulas and dynamic NPC state are pending adaptation."] } };
}
