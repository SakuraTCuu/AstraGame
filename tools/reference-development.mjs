import { compileReferenceCondition, parseReferenceItem } from "./reference-rules.mjs";

const attributes = (source = {}) => ({ attack: source.atk || 0, defense: source.def || 0, maxHealth: source.maxhp || 0 });

export function buildReferenceDevelopment(lookup, ids, config, rewards, issues) {
  const heroRows = ids("HeroLevel").map((id) => lookup("HeroLevel", id));
  const levelTables = {};
  const profiles = config.roster?.heroes || [13, 1, 9, 8].map((sourceId, index) => ({ sourceId, id: config.squad.actors[index].id, initiallyOwned: true }));
  const heroes = profiles.map((profile) => {
    const hero = lookup("Hero", profile.sourceId), actorId = profile.id;
    if (!levelTables[hero.levelType]) levelTables[hero.levelType] = heroRows.filter((row) => row.type === hero.levelType && row.attr?.maxhp > 0).map((row) => {
      let cost = {}, condition;
      try {
        for (const entry of String(row.cost || "").split(",").filter(Boolean)) {
          const item = parseReferenceItem(entry); cost[rewards.resource(item.itemId)] = (cost[rewards.resource(item.itemId)] || 0) + item.amount;
        }
      } catch (error) { issues.push({ owner: row.id, kind: "hero_cost", source: row.cost }); condition = { kind: "flag", id: `external:hero_cost:${row.id}`, label: "\u7a81\u7834\u6761\u4ef6\u672a\u6ee1\u8db3" }; }
      return { level: row.level, attributes: attributes(row.attr), cost, condition };
    }).sort((a, b) => a.level - b.level);
    return { actorId, initialLevel: profile.initiallyOwned ? 10 : 1, levelTable: String(hero.levelType), optionalInSave: !profile.initiallyOwned };
  });
  const equipment = [];
  for (const resource of Object.keys(config.world.progression.resources)) {
    if (!resource.startsWith("item:")) continue;
    const id = Number(resource.slice(5)), row = lookup("Equip", id);
    if (!row) continue;
    const item = lookup("Item", id), ranges = { attack: [0, 0], defense: [0, 0], maxHealth: [0, 0] };
    let unsupported = Boolean(row.specialAttr1 || row.specialAttr2);
    for (const entry of String(row.baseAttr || "").split(",").filter(Boolean)) {
      const match = /^(atk|def|maxhp)_(\d+)_(\d+)$/.exec(entry);
      if (!match) { unsupported = true; continue; }
      ranges[{ atk: "attack", def: "defense", maxhp: "maxHealth" }[match[1]]] = [Number(match[2]), Number(match[3])];
    }
    if (unsupported) issues.push({ owner: id, kind: "equipment_attributes", base: row.baseAttr, special: [row.specialAttr1, row.specialAttr2] });
    equipment.push({ id: `reference_equipment_${id}`, resource, name: item?.name || "\u88c5\u5907", type: row.type, quality: row.quality,
      attributes: ranges, icon: item?.icon ? { atlas: "uires/equip/equip", frame: item.icon } : undefined,
      condition: unsupported ? { kind: "flag", id: `external:equipment:${id}`, label: "\u88c5\u5907\u6761\u4ef6\u672a\u6ee1\u8db3" } : undefined });
  }
  const slots = ids("EquipType").map((id) => lookup("EquipType", id)).filter((row) => row.heroSlot <= (config.roster?.slots.length || config.squad.actors.length)).map((row) => ({
    id: `reference_slot_${row.id}`, ...(config.roster ? { position: row.heroSlot - 1 } : { actorId: config.squad.actors[row.heroSlot - 1].id }), type: row.type, name: row.name,
    condition: compileReferenceCondition(row.condition, lookup),
  }));
  const ranks = ids("MilitaryRank").map((id) => lookup("MilitaryRank", id)).map((row) => ({ rank: row.id, heroLevelLimit: row.heroLvLimit, attributes: attributes(row.attr) }));
  return { heroes, levelTables, equipment, slots, ranks };
}
