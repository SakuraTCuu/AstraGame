import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { tableRow } from "./reference-cache.mjs";
import { compileReferenceCondition, parseReferenceItem, referenceFogPolygon } from "./reference-rules.mjs";
import { createReferenceSkillCompiler } from "./reference-skills.mjs";
import { createReferenceRewardCompiler, buildReferenceJournal } from "./reference-progression.mjs";
import { buildReferenceDevelopment } from "./reference-development.mjs";

function readJsonAsset(data) {
  const json = JSON.parse(data);
  if (json[0] !== 1 || json[3]?.[0]?.[0] !== "cc.JsonAsset" ||
      JSON.stringify(json[3][0][1]) !== '["_name","json"]' || json[5]?.length !== 1) throw new Error("Unsupported standalone JsonAsset encoding");
  return json[5][0][2];
}

export async function buildReferenceProfile(cache, assets, tables, baseConfig) {
  const families = new Map();
  for (const [name, table] of Object.entries(tables)) {
    const family = name.match(/^(Avatar|Hero|HeroLevel|Skill|Buff|Monster|MonsterSpawn|GameMap|WorldMap|Npc|NpcSpawn|Reward|MilitaryRank|Item|PlayerLevel|Quest|BossFirstKill|Equip|EquipType)(?:_(?:\d+|Xs))?$/)?.[1];
    if (!family) continue;
    if (!families.has(family)) families.set(family, new Map());
    for (const id of Object.keys(table)) if (id !== "__KEY_MAP__") families.get(family).set(id, table);
  }
  const row = (family, id) => {
    const table = families.get(family)?.get(String(id));
    return table ? tableRow(table, id) : null;
  };
  const sourceMap = row("GameMap", 100001);
  const skillCompiler = createReferenceSkillCompiler(row);
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
  config.meta = { id: "local-reference-world", schemaVersion: 2, contentStatus: "LOCAL_REFERENCE_PREVIEW" };
  config.session = { autoStopForCombat: true, persistExploration: true };
  config.world = { ...config.world, id: "reference-world", name: sourceMap.desc,
    width: Math.floor(cut.width / cellSize) * cellSize, height: Math.floor(cut.height / depth / cellSize) * cellSize,
    cellSize, obstacles: [], pointsOfInterest: [], blocked: [], start: toWorld(...sourceMap.born.split(",").map(Number)), zoneMode: "overlay",
    progression: { level: 1, rank: 0, initialFlags: [],
      experienceLevels: [...families.get("PlayerLevel").keys()].map((id) => { const level = row("PlayerLevel", id); return { level: level.level, required: level.exp }; }).sort((a, b) => a.level - b.level),
      resources: { incense: { name: row("Item", 4).name, initial: 20 } } } };
  if (sourceMap.revive) config.session.recovery = { town: config.world.start, nearestPortal: true };
  for (let y = 0; y < config.world.height / cellSize; y++) for (let x = 0; x < config.world.width / cellSize; x++) {
    const blocked = [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]].some(([dx, dy]) =>
      sourceBlocked(origin.x + (x + dx) * cellSize, origin.y + (y + dy) * cellSize * depth));
    if (blocked) config.world.blocked.push({ x, y });
  }
  config.fog = { ...config.fog, cellSize: 240, unlockZones: [], revealRadius: 600 };
  const art = { bundle: "reference-resources", mapBundle: "reference-map", mapName: cut.name,
    tileSize: 1024, mapHeight: cut.height, mapWidth: cut.width, depth, scale: 0.82,
    tiles: assets.filter((asset) => asset.bundle === "reference-map" && asset.type === "cc.Texture2D" && asset.native && asset.path.startsWith(`${cut.name}/`)).map((asset) => asset.path),
    bindings: {}, sourceOrigin: origin, regions: [], overviewScale: sourceMap.worldPicScale || 0.04,
    occlusionPolygons: Object.values(scene.occlusionLayer).flatMap((column) => Object.values(column).flat()).map((polygon) => polygon.map((point) => toWorld(point.x, point.y))),
    nightRegions: scene.regionLayer.filter((region) => region.showDirLight).flatMap((region) => region.regionArr.map((rect) => referenceFogPolygon(rect, toWorld))) };
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
    const isSpine = Boolean(avatar.isHeroSpine || avatar.spriteAtlasPath === "spine");
    const path = isSpine ? `spine/${avatar.atlasName}` : `uires/${avatar.spriteAtlasPath}/${avatar.atlasName}`;
    const type = isSpine ? "sp.SkeletonData" : "cc.SpriteAtlas";
    const found = assets.find((asset) => asset.path === path && asset.type === type && (type !== "sp.SkeletonData" || asset.native));
    return found ? { path, kind: isSpine ? "spine" : "atlas", scale: avatar.scale || 1,
      height: avatar.height || 120, fps: avatar.fps || 12, flip: Boolean(avatar.flip), avatarId } : null;
  };
  [13, 1, 9, 8].forEach((id, index) => {
    const hero = row("Hero", id);
    const actor = config.squad.actors[index];
    const attributes = row("HeroLevel", hero.levelType * 100000 + 10).attr;
    const compiled = skillCompiler.heroSkills(hero, row("Avatar", hero.display)?.fps || 12);
    actor.name = hero.name;
    actor.hp = actor.maxHp = attributes.maxhp;
    actor.attack = attributes.atk;
    actor.defense = attributes.def;
    actor.modifiers = compiled.modifiers;
    actor.maxEnergy = attributes.ultraEnegyMax || 0;
    actor.energyPerSecond = attributes.ultraEnegyRecoverRate || 0;
    actor.energyOnSkill = attributes.ultraEnegySkillHit || 0;
    actor.energyOnDamage = attributes.ultraEnegyBeHit || 0;
    actor.energy = 0;
    actor.skillIds = compiled.ids;
    actor.attackRange = row("Skill", Number(hero.attack.split("_")[0])).firstSelector[0];
    actor.aggroRange = hero.searchRange;
    actor.collisionRadius = hero.volume;
    Object.assign(actor, initialPosition(config.world.start.x + config.squad.formationOffsets[index].x,
      config.world.start.y + config.squad.formationOffsets[index].y));
    art.bindings[actor.id] = binding(hero.display);
    if (art.bindings[actor.id]) {
      const skills = [...skillCompiler.definitions.values()].filter((skill) => actor.skillIds.includes(skill.id));
      art.bindings[actor.id].skillAnimations = Object.fromEntries(skills.map((skill) => [skill.id, skill.presentation.release]));
      art.bindings[actor.id].skillPhases = Object.fromEntries(skills.map((skill) => [skill.id, skill.presentation]));
    }
  });
  const enemies = new Map();
  config.spawns = [];
  const skipped = [];
  const unsupported = [];
  const progressionIssues = [];
  const rewardCompiler = createReferenceRewardCompiler(row, config.world.progression.resources, progressionIssues);
  for (const id of families.get("NpcSpawn").keys()) {
    const spawn = row("NpcSpawn", id);
    if (spawn.map !== 100001) continue;
    const npc = row("Npc", spawn.npcId);
    if (!npc || ![1, 3, 5].includes(npc.type)) continue;
    const position = toWorld(spawn.px, spawn.py);
    if (position.x < 0 || position.y < 0 || position.x >= config.world.width || position.y >= config.world.height) continue;
    const poiId = `reference_npc_${id}`;
    let condition;
    try { condition = compileReferenceCondition(npc.condition, row); }
    catch (error) { unsupported.push({ npcId: id, field: "condition", source: npc.condition }); condition = { kind: "flag", id: `external:npc:${id}`, label: "\u524d\u7f6e\u6761\u4ef6\u672a\u6ee1\u8db3" }; }
    const cost = npc.cost ? parseReferenceItem(npc.cost) : null;
    const grant = rewardCompiler.safe(npc.type === 1 ? npc.reward : null, poiId);
    if (grant.blocked) condition = { kind: "all", conditions: [condition, grant.blocked].filter(Boolean) };
    const poi = { id: poiId, name: npc.name || (npc.type === 1 ? "\u5b9d\u7bb1" : npc.logName), type: npc.type === 3 ? "fog_gate" : npc.type === 5 ? "portal" : "chest", ...position,
      discoverRadius: Math.max(300, npc.activeDistance || 200), interaction: { radius: npc.activeDistance || 200,
        condition, allowLockedApproach: npc.type === 3, cost: cost ? { resource: rewardCompiler.resource(cost.itemId), amount: cost.amount } : undefined,
        rewards: grant.rewards, command: npc.type === 1 ? "\u6253\u5f00" : undefined, auto: npc.type === 1 && npc.autoOpen === 1,
        initiallyCompleted: npc.type === 5 && Number(id) === 500000 } };
    config.world.pointsOfInterest.push(poi);
    art.bindings[poiId] = binding(npc.display);
    if (npc.type === 3) {
      const fog = scene.fogLayer.find((entry) => String(entry.id) === id);
      if (!fog) throw new Error(`Missing fog geometry for NPC ${id}`);
      const polygon = referenceFogPolygon(fog, toWorld);
      const x = Math.max(0, Math.min(...polygon.map((point) => point.x))), y = Math.max(0, Math.min(...polygon.map((point) => point.y)));
      const width = Math.min(config.world.width, Math.max(...polygon.map((point) => point.x))) - x;
      const height = Math.min(config.world.height, Math.max(...polygon.map((point) => point.y))) - y;
      if (!(width > 0 && height > 0)) { unsupported.push({ npcId: id, field: "fog_outside_world" }); continue; }
      config.fog.unlockZones.push({ id: `fog_${id}`, name: npc.logName, rect: { x, y, width, height }, polygon, unlock: `interact:${poiId}` });
      const [sx, sy] = sourceMap.born.split(",").map(Number);
      const fx = sx * 0.6 - sy, fy = -sx * 0.6 - sy;
      if (fx >= fog.x && fx <= fog.x + fog.w && fy >= fog.y && fy <= fog.y + fog.h) poi.interaction.initiallyCompleted = true;
    }
  }
  for (const id of families.get("MonsterSpawn").keys()) {
    const spawn = row("MonsterSpawn", id);
    if (spawn.map !== 100001 || spawn.type === 1 || !/^\d+_\d+$/.test(spawn.monsterSpawn)) continue;
    const [monsterId, count] = spawn.monsterSpawn.split("_").map(Number);
    const monster = row("Monster", monsterId);
    if (!monster || ![1, 2, 3].includes(monster.type) || !monster.attr?.maxhp || (monster.type !== 3 && !monster.attr.atk)) continue;
    const position = toWorld(spawn.px, spawn.py);
    if (position.x < 0 || position.y < 0 || position.x >= config.world.width || position.y >= config.world.height) continue;
    const visual = binding(monster.avatar);
    if (!visual) skipped.push({ spawnId: id, monsterId, avatar: monster.avatar });
    const boss = monster.type === 2;
    const resource = monster.type === 3;
    const templateId = `reference_monster_${monsterId}`;
    const enemySkills = [];
    if (!resource) for (const sourceId of String(monster.skill || "20001").split(",")) {
      try { const skill = skillCompiler.compile(Number(sourceId.split("_")[0]), row("Avatar", monster.avatar)?.fps || 12); if (skill && skill.actions.length) enemySkills.push(skill); }
      catch (error) { skillCompiler.issues.push({ id: sourceId, kind: "compile_error", value: error.message }); }
    }
    const phaseThresholds = [...new Set(enemySkills.map((skill) => skill.conditions.casterHpAtMost).filter((value) => value > 0 && value < 1))].sort((a, b) => b - a);
    const rewards = [];
    const reward = row("Reward", monster.reward0);
    for (const [key, value] of Object.entries(reward || {})) {
      if (!/^options\d+$/.test(key) || typeof value !== "string" || !/^item\|id:(?:4|7)_/.test(value)) continue;
      const item = parseReferenceItem(value);
      rewards.push({ ...(item.itemId === 7 ? { experience: true } : { resource: "incense" }), amount: item.amount, chance: item.chance });
    }
    enemies.set(templateId, { id: templateId, name: monster.name || (resource ? row("Item", 4).name : visual?.path.split("/").pop() || "\u602a\u7269"), kind: boss ? "boss" : resource ? "resource" : "enemy",
      x: position.x, y: position.y, hp: monster.attr.maxhp, attack: monster.attr.atk || 0, defense: monster.attr.def || 0,
      moveSpeed: resource ? 0 : Math.max(50, (monster.attr.movespeed || 50) * (monster.runSpeedRate || 100) / 100),
      attackRange: resource ? 0 : enemySkills.find((skill) => skill.category === "normal")?.range || monster.atkRange || 150,
      aggroRange: resource ? 0 : monster.atkRange || 350, leashRange: resource ? 0 : monster.homeRange || 800,
      collisionRadius: row("Avatar", monster.avatar)?.volume || 20,
      phaseThresholds: boss ? phaseThresholds : undefined, phaseNames: boss ? Array.from({ length: phaseThresholds.length + 1 }, (_, index) => `phase${index + 1}`) : undefined,
      skillIds: enemySkills.map((skill) => skill.id), healthBars: boss ? 20 : 1, defeatFlag: `defeat:${monsterId}`, defeatRewards: rewards });
    enemies.get(templateId).defeatCounters = String(monster.subtype || "").split(",").filter(Boolean).map((subtype) => `defeat:type:${monster.type}:subtype:${subtype}`);
    const fullReward = rewardCompiler.safe(monster.reward0, `monster:${monsterId}`);
    if (!fullReward.blocked) enemies.get(templateId).defeatRewards = fullReward.rewards;
    enemies.get(templateId).firstDefeatRewards = rewardCompiler.safe(monster.firstReward, `first_drop:${monsterId}`).rewards;
    const spawnId = `reference_spawn_${id}`;
    art.bindings[spawnId] = visual;
    if (visual) {
      visual.skillAnimations = Object.fromEntries(enemySkills.map((skill) => [skill.id, skill.presentation.release]));
      visual.skillPhases = Object.fromEntries(enemySkills.map((skill) => [skill.id, skill.presentation]));
    }
    config.spawns.push({ id: spawnId, trigger: "distance", ...position, triggerRadius: 850, enemyId: templateId,
      count, spawnRadius: count > 1 ? 50 : 0, respawn: Boolean(monster.rebirthTime), respawnDelay: monster.rebirthTime || 45 });
    if (boss) config.world.pointsOfInterest.push({ id: spawnId, name: monster.name, type: "boss", ...position, discoverRadius: 500 });
  }
  config.enemies = [...enemies.values()];
  config.journal = buildReferenceJournal(row, (family) => [...(families.get(family)?.keys() ?? [])], config, toWorld, rewardCompiler, progressionIssues);
  config.development = buildReferenceDevelopment(row, (family) => [...(families.get(family)?.keys() ?? [])], config, rewardCompiler, progressionIssues);
  config.skills.definitions = [...config.skills.definitions.filter((skill) => !skill.summonEnemyId), ...skillCompiler.definitions.values()];
  for (const id of families.get("WorldMap").keys()) {
    const region = row("WorldMap", id);
    if (region.mapId !== 100001) continue;
    art.regions.push({ id, name: region.regionName, ...toWorld(...region.namePlace.split("_").map(Number)) });
  }
  config.presentation = { reference: art };
  const requiredTiles = Object.entries(cut.data).flatMap(([x, rows]) => Object.keys(rows).map((y) => `${cut.name}/${x}_${y}`));
  const availableTiles = new Set(art.tiles);
  return { config, audit: { map: sceneAsset.path, collisionGrid: [scene.blockLayer.width, scene.blockLayer.height],
    routeSamples: scene.pathpoint.reduce((count, path) => count + path.length / 2, 0),
    blockedRouteSamples: scene.pathpoint.reduce((count, path) => count + path.filter((_, index) => index % 2 === 0 && sourceBlocked(path[index], path[index + 1])).length, 0),
    cachedMapTextures: art.tiles.length, enemyTemplates: enemies.size, encounterPlacements: config.spawns.length, missingArt: skipped,
    fogZones: config.fog.unlockZones.length, portals: config.world.pointsOfInterest.filter(poi => poi.type === "portal").length, unsupported,
    requiredMapTiles: requiredTiles.length, missingMapTiles: requiredTiles.filter((path) => !availableTiles.has(path)),
    compiledSkills: skillCompiler.definitions.size, skillIssues: skillCompiler.issues.filter((issue) => issue.kind !== "no_direct_actions" || !skillCompiler.definitions.get(Number(issue.id))?.actions.length),
    journalQuests: config.journal.quests.length, progressionIssues,
    limitations: ["The party uses source level-10 hero attributes, not the live account. Defense math and critical multiplier still need live calibration.",
      "Standalone starts with 20 incense, a repaired home portal and spawn-containing fog already open; host account progression is separate.",
      "Quest progression, full skill formulas, other inventory rewards and dynamic NPC state still require adaptation."] } };
}
