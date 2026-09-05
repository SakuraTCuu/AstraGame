function splitConditions(text) {
  let depth = 0, start = 0;
  const result = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "[" || text[index] === "{") depth++;
    else if (text[index] === "]" || text[index] === "}") depth--;
    if (depth < 0) throw new Error("Unbalanced condition expression");
    if (text[index] === "," && depth === 0) { result.push(text.slice(start, index)); start = index + 1; }
  }
  if (depth !== 0) throw new Error("Unbalanced condition expression");
  result.push(text.slice(start));
  return result;
}

export function compileReferenceCondition(source, lookup, depth = 0) {
  if (!source) return undefined;
  if (depth > 10) throw new Error("Condition expression is too deep");
  const separator = source.indexOf("|");
  const type = source.slice(0, separator).trim();
  let body = source.slice(separator + 1).trim();
  if (separator < 1) throw new Error(`Unsupported condition ${source}`);
  if (type === "AndCondition" || type === "OrCondition") {
    if (!body.startsWith("[") || !body.endsWith("]")) throw new Error("Invalid compound condition");
    return { kind: type === "AndCondition" ? "all" : "any", conditions: splitConditions(body.slice(1, -1)).map((entry) => compileReferenceCondition(entry.trim(), lookup, depth + 1)) };
  }
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1);
  const killCount = /^id:(\d+)_num:(\d+)$/.exec(body);
  if (type === "HisKillMonsterCondition" && killCount) return { kind: "counter", id: `defeat:${killCount[1]}`, value: Number(killCount[2]), label: `\u51fb\u8d25${lookup("Monster", Number(killCount[1]))?.name || "\u602a\u7269"}` };
  if (type === "HisOwnItemNumCondition" && killCount) return { kind: "counter", id: `owned:${Number(killCount[1]) === 4 ? "incense" : `item:${killCount[1]}`}`, value: Number(killCount[2]), label: lookup("Item", Number(killCount[1]))?.name || "\u7d2f\u8ba1\u83b7\u5f97" };
  const partyLevel = /^level:(\d+)_num:(\d+)$/.exec(body);
  if (type === "HeroLevelNumCondition" && partyLevel) return { kind: "party_level", level: Number(partyLevel[1]), count: Number(partyLevel[2]), label: `${partyLevel[2]}\u540d\u9547\u90aa\u4eba\u8fbe\u5230${partyLevel[1]}\u7ea7` };
  const totalLevel = /^level:(\d+)$/.exec(body);
  if (type === "HeroTotalLevelCondition" && totalLevel) return { kind: "party_total_level", value: Number(totalLevel[1]), label: "\u51fa\u6218\u603b\u7b49\u7ea7" };
  const count = /^num:(\d+)$/.exec(body);
  const counters = { HisRenameTimesCond: ["rename", "\u66f4\u6539\u540d\u5b57"], HisRecruitCondition: ["recruit", "\u7d2f\u8ba1\u62db\u52df"], DressEquipQualityCondition: ["equipped", "\u7a7f\u6234\u88c5\u5907"], HeroAllocCondition: ["party_count", "\u51fa\u6218\u4eba\u6570"] };
  const heroStar = /^heroId:(\d+)_star:(\d+)$/.exec(body);
  if (type === "HisHeroStarCond" && heroStar) return { kind: "all", conditions: [{ kind: "flag", id: `hero:${heroStar[1]}`, label: "\u83b7\u5f97\u6307\u5b9a\u9547\u90aa\u4eba" }, { kind: "counter", id: `hero_star:${heroStar[1]}`, value: Number(heroStar[2]), label: "\u6307\u5b9a\u9547\u90aa\u4eba\u661f\u7ea7" }] };
  const activity = /^activityId:(\d+)$/.exec(body);
  if (type === "HisActivityOpenedCondition" && activity) return { kind: "flag", id: `activity:${activity[1]}`, label: "\u6d3b\u52a8\u672a\u5f00\u653e" };
  if (count && counters[type]) return { kind: "counter", id: counters[type][0], value: Number(count[1]), label: counters[type][1] };
  const subtype = /^type:(\d+)_subType:(\d+)_num:(\d+)$/.exec(body);
  if (type === "KillMonsterSubTypeCondition" && subtype) return { kind: "counter", id: `defeat:type:${subtype[1]}:subtype:${subtype[2]}`, value: Number(subtype[3]), label: "\u51fb\u8d25\u6307\u5b9a\u7c7b\u578b\u602a\u7269" };
  const fields = /^([A-Za-z]+)\s*:\s*(\d+)$/.exec(body);
  if (!fields) throw new Error(`Unsupported condition arguments ${source}`);
  const value = Number(fields[2]);
  if (type === "PlayerLevel" && fields[1] === "minLevel") return { kind: "level", value, label: `\u7b49\u7ea7 ${value}` };
  if (type === "MilitaryRankCondition" && fields[1] === "id") return { kind: "rank", value, label: lookup("MilitaryRank", value)?.name || `\u9547\u90aa\u5b98\u9636 ${value}` };
  if (type === "HisKillMonsterCondition" && fields[1] === "id") return { kind: "flag", id: `defeat:${value}`, label: `\u51fb\u8d25${lookup("Monster", value)?.name || "\u5b88\u5173\u9996\u9886"}` };
  if (type === "CompleteQuestCondition" && fields[1] === "questId") return { kind: "flag", id: `quest:${value}`, label: "\u5b8c\u6210\u524d\u7f6e\u4efb\u52a1" };
  if (type === "TriggerNpcCondition" && fields[1] === "npcSpawnId") return { kind: "flag", id: `poi:reference_npc_${value}`, label: "\u89e3\u9501\u524d\u7f6e\u533a\u57df" };
  throw new Error(`Unsupported condition ${source}`);
}

export function parseReferenceItem(source) {
  const match = /^item\|id:(\d+)_num:(\d+)(?:_prob:(\d+)\/(\d+))?$/.exec(source || "");
  if (!match) throw new Error(`Unsupported item expression ${source}`);
  const amount = Number(match[2]);
  const chance = match[3] === undefined ? 1 : Number(match[3]) / Number(match[4]);
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(chance) || chance < 0 || chance > 1) throw new Error("Invalid item reward");
  return { itemId: Number(match[1]), amount, chance };
}

export function referenceFogPolygon(rect, toWorld) {
  // Fog uses 120-unit editor cells; ground cells project to 200 by 120 units.
  return [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]]
    .map(([x, y]) => toWorld((x - y) * 5 / 6, -(x + y) / 2));
}
