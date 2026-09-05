import { compileReferenceCondition, parseReferenceItem } from "./reference-rules.mjs";

export function createReferenceRewardCompiler(lookup, resources, issues) {
  const resource = (id) => {
    if (id === 7) throw new Error("Experience cannot be used as an inventory cost");
    const key = id === 4 ? "incense" : `item:${id}`;
    if (!resources[key]) resources[key] = { name: lookup("Item", id)?.name || lookup("Equip", id)?.name || "\u6218\u5229\u54c1", initial: 0, optionalInSave: true, showInHud: false };
    return key;
  };
  const compile = (id, stack = []) => {
    if (!id) return [];
    if (stack.includes(id)) throw new Error(`Cyclic reward ${id}`);
    const row = lookup("Reward", id);
    if (!row || row.type !== "OddsReward") throw new Error(`Unsupported reward ${id}: ${row?.type}`);
    const rewards = [];
    for (const [key, value] of Object.entries(row)) {
      if (!/^options\d+$/.test(key) || !value) continue;
      if (value.startsWith("item|")) {
        const item = parseReferenceItem(value);
        rewards.push({ ...(item.itemId === 7 ? { experience: true } : { resource: resource(item.itemId) }), amount: item.amount, chance: item.chance });
      } else {
        const nested = /^reward\|rewardId:(\d+)_num:(\d+)(?:_prob:(\d+)\/(\d+))?$/.exec(value);
        if (!nested || (nested[3] !== undefined && Number(nested[3]) !== Number(nested[4]))) throw new Error(`Unsupported nested reward ${id}: ${value}`);
        for (let index = 0; index < Number(nested[2]); index++) rewards.push(...compile(Number(nested[1]), [...stack, id]));
      }
    }
    return rewards;
  };
  const safe = (id, owner) => {
    try { return { rewards: compile(id) }; }
    catch (error) { issues.push({ owner, kind: "reward", sourceId: id, message: error.message }); return { rewards: [], blocked: { kind: "flag", id: `external:reward:${owner}`, label: "\u5956\u52b1\u6761\u4ef6\u672a\u5b8c\u6210" } }; }
  };
  return { compile, safe, resource };
}

export function buildReferenceJournal(lookup, ids, config, toWorld, rewards, issues) {
  const all = ids("Quest").map((id) => lookup("Quest", id));
  const sourceDestination = (quest) => quest.pathPosition || (quest.questAim?.type === 1 ? lookup("MonsterSpawn", quest.questAim.content) :
    quest.questAim?.type === 2 ? lookup("NpcSpawn", quest.questAim.content) : null);
  const beginning = lookup("Quest", 10010018);
  const lastIndex = Math.max(...all.filter((quest) => !quest.type && sourceDestination(quest)?.map === 100001).map((quest) => quest.index));
  const condition = (row) => {
    try { return compileReferenceCondition(row.completeCondition, lookup); }
    catch (error) { issues.push({ owner: row.id, kind: "condition", source: row.completeCondition }); return { kind: "flag", id: `external:quest:${row.id}`, label: row.text }; }
  };
  const quest = (row, category) => {
    const prerequisiteIds = String(row.unlockQuest || "").split(",").filter(Boolean);
    if (prerequisiteIds.some((id) => !/^\d+$/.test(id))) throw new Error(`Unsupported quest prerequisite ${row.id}`);
    let prerequisite = prerequisiteIds.length ? { kind: "all", conditions: prerequisiteIds.map((id) => ({ kind: "flag", id: `quest:${id}`, label: lookup("Quest", id)?.text || "\u524d\u7f6e\u4efb\u52a1" })) } : undefined;
    const grant = rewards.safe(row.questReward, row.id);
    if (grant.blocked) prerequisite = { kind: "all", conditions: [prerequisite, grant.blocked].filter(Boolean) };
    const aim = row.questAim;
    let destination;
    const npcId = aim?.type === 2 ? `reference_npc_${aim.content}` : null;
    if (npcId && config.world.pointsOfInterest.some((poi) => poi.id === npcId)) destination = { poiId: npcId };
    else {
      const source = sourceDestination(row);
      if (source?.map === 100001) destination = { position: toWorld(source.px ?? source.x, source.py ?? source.y) };
    }
    const completeCondition = condition(row);
    if (!destination && (completeCondition.kind === "party_level" || completeCondition.kind === "party_total_level" ||
        (completeCondition.kind === "counter" && completeCondition.id === "equipped"))) destination = { menu: "development" };
    if (!destination && completeCondition.kind === "counter" && completeCondition.id === "party_count") destination = { menu: "lineup" };
    if (!destination && completeCondition.kind === "counter" && completeCondition.id === "recruit") destination = { menu: "recruitment" };
    return { id: `reference_quest_${row.id}`, flag: `quest:${row.id}`, name: row.text, category, order: row.index,
      prerequisite, condition: completeCondition, rewards: grant.rewards, destination };
  };
  const quests = all.filter((row) => !row.type && row.index >= beginning.index && row.index <= lastIndex).map((row) => quest(row, "main"));
  const ranks = ids("MilitaryRank").map((id) => lookup("MilitaryRank", id)).map((rank) => ({ id: rank.id, name: rank.name,
    questIds: String(rank.questIds || "").split(",").filter(Boolean).map((id) => {
      const row = lookup("Quest", id);
      if (!row) throw new Error(`Missing rank quest ${id}`);
      const definition = quest(row, "rank");
      if (!quests.some((entry) => entry.id === definition.id)) quests.push(definition);
      return definition.id;
    }) }));
  for (const id of ids("BossFirstKill")) {
    const boss = lookup("BossFirstKill", id);
    const spawn = config.spawns.find((entry) => entry.id === `reference_spawn_${boss.bossSpawnId}`);
    if (!spawn) continue;
    const monster = config.enemies.find((entry) => entry.id === spawn.enemyId);
    const grant = rewards.safe(boss.personReward, `boss:${id}`);
    quests.push({ id: `reference_firstkill_${id}`, flag: `firstkill:${id}`, name: monster.name, category: "boss", order: boss.order,
      prerequisite: grant.blocked, condition: { kind: "flag", id: monster.defeatFlag, label: `\u51fb\u8d25${monster.name}` },
      rewards: grant.rewards, destination: { poiId: spawn.id } });
  }
  config.world.progression.rank = 1;
  config.world.progression.initialFlags.push(...String(beginning.unlockQuest).split(",").map((id) => `quest:${id}`));
  config.world.progression.partyLevels = config.squad.actors.map(() => 10);
  return { quests, ranks };
}
