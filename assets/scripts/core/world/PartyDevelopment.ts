import type { Actor, ActorStats } from "../actor/Actor";
import type { ProgressCondition } from "./ProgressConditions";
import { validateCondition } from "./ProgressConditions";
import type { WorldMap } from "./WorldMap";

export interface GrowthAttributes { readonly attack: number; readonly defense: number; readonly maxHealth: number; }
export interface HeroLevelDefinition { readonly level: number; readonly attributes: GrowthAttributes; readonly cost?: Readonly<Record<string, number>>; readonly condition?: ProgressCondition; }
export interface EquipmentDefinition {
  readonly id: string; readonly resource: string; readonly name: string; readonly type: number; readonly quality: number;
  readonly attributes: Readonly<Record<keyof GrowthAttributes, readonly [number, number]>>;
  readonly icon?: { readonly atlas: string; readonly frame: string };
  readonly condition?: ProgressCondition;
}
export interface EquipmentSlotDefinition { readonly id: string; readonly actorId: string; readonly type: number; readonly name: string; readonly condition?: ProgressCondition; }
export interface DevelopmentConfig {
  readonly heroes: readonly { readonly actorId: string; readonly initialLevel: number; readonly levels?: readonly HeroLevelDefinition[]; readonly levelTable?: string }[];
  readonly levelTables?: Readonly<Record<string, readonly HeroLevelDefinition[]>>;
  readonly equipment: readonly EquipmentDefinition[];
  readonly slots: readonly EquipmentSlotDefinition[];
  readonly ranks?: readonly { readonly rank: number; readonly heroLevelLimit: number; readonly attributes: GrowthAttributes }[];
}
export interface EquipmentInstance { readonly id: string; readonly definitionId: string; readonly attributes: GrowthAttributes; }
export interface DevelopmentSave { readonly levels: Readonly<Record<string, number>>; readonly items: readonly EquipmentInstance[]; readonly equipped: Readonly<Record<string, string>>; readonly nextItemId: number; }
export type DevelopmentResult = "completed" | "insufficient_resources" | "requirements_not_met" | "unavailable";

const ATTRIBUTES: readonly (keyof GrowthAttributes)[] = ["attack", "defense", "maxHealth"];

export class PartyDevelopment {
  readonly config: DevelopmentConfig;
  private readonly actors: readonly Actor[];
  private readonly map: WorldMap;
  private readonly random: () => number;
  private readonly baseStats = new Map<string, ActorStats>();
  private readonly levels = new Map<string, ReadonlyMap<number, HeroLevelDefinition>>();
  private state: { levels: Record<string, number>; items: EquipmentInstance[]; equipped: Record<string, string>; nextItemId: number };
  private statsKey = "";

  constructor(actors: readonly Actor[], map: WorldMap, config: DevelopmentConfig, random: () => number) {
    this.actors = actors; this.map = map; this.config = config; this.random = random;
    for (const actor of actors) this.baseStats.set(actor.id, actor.stats);
    this.state = { levels: {}, items: [], equipped: {}, nextItemId: 1 };
    const levelTables = new Map<readonly HeroLevelDefinition[], ReadonlyMap<number, HeroLevelDefinition>>();
    for (const hero of config.heroes) {
      if (!this.baseStats.has(hero.actorId) || this.state.levels[hero.actorId] !== undefined) throw new Error("Invalid development hero");
      const source = hero.levels ?? config.levelTables?.[hero.levelTable ?? ""];
      if (!source?.length) throw new Error("Missing hero level table");
      let table = levelTables.get(source);
      if (!table) {
        const parsed = new Map<number, HeroLevelDefinition>();
        for (const level of source) {
          if (!Number.isSafeInteger(level.level) || level.level < 1 || parsed.has(level.level) || !this.validAttributes(level.attributes, true)) throw new Error("Invalid hero level");
          parsed.set(level.level, level);
          for (const [resource, amount] of Object.entries(level.cost ?? {})) map.validateReward({ resource, amount });
          if (level.condition) validateCondition(level.condition);
        }
        table = parsed; levelTables.set(source, table);
      }
      if (!table.has(hero.initialLevel)) throw new Error("Initial hero level is absent from configuration");
      this.levels.set(hero.actorId, table);
      this.state.levels[hero.actorId] = hero.initialLevel;
    }
    if (config.heroes.length !== actors.length) throw new Error("Development roster must match the party");
    const items = new Set<string>(), resources = new Set<string>(), slots = new Set<string>();
    for (const item of config.equipment) {
      if (!item.id || items.has(item.id) || resources.has(item.resource) || !item.name || !Number.isSafeInteger(item.type) || item.type < 1) throw new Error("Invalid equipment definition");
      items.add(item.id); resources.add(item.resource); map.validateReward({ resource: item.resource, amount: 0 });
      if (item.condition) validateCondition(item.condition);
      for (const key of ATTRIBUTES) {
        const range = item.attributes[key];
        if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0]) throw new Error("Invalid equipment attribute range");
      }
    }
    for (const slot of config.slots) {
      if (!slot.id || slots.has(slot.id) || !this.baseStats.has(slot.actorId) || !slot.name) throw new Error("Invalid equipment slot");
      slots.add(slot.id); if (slot.condition) validateCondition(slot.condition);
    }
    const ranks = new Set<number>();
    for (const rank of config.ranks ?? []) {
      if (!Number.isSafeInteger(rank.rank) || rank.rank < 1 || ranks.has(rank.rank) || !Number.isSafeInteger(rank.heroLevelLimit) || rank.heroLevelLimit < 1 || !this.validAttributes(rank.attributes)) throw new Error("Invalid development rank");
      ranks.add(rank.rank);
    }
    this.refreshStats();
  }

  syncInventory(): void {
    let changed = false;
    for (const definition of this.config.equipment) {
      const quantity = this.map.resourceBalance(definition.resource);
      const existing = this.state.items.filter((item) => item.definitionId === definition.id).length;
      for (let index = existing; index < quantity; index++) {
        const attributes = { attack: 0, defense: 0, maxHealth: 0 };
        for (const key of ATTRIBUTES) { const [min, max] = definition.attributes[key]; attributes[key] = min === max ? min : min + Math.floor(this.random() * (max - min + 1)); }
        this.state.items.push({ id: `equipment_${this.state.nextItemId++}`, definitionId: definition.id, attributes }); changed = true;
      }
    }
    if (changed) this.map.recordProgressChange("inventory");
    this.refreshStats();
  }

  equip(itemId: string, slotId: string): DevelopmentResult {
    const item = this.state.items.find((entry) => entry.id === itemId), slot = this.config.slots.find((entry) => entry.id === slotId);
    const definition = item && this.config.equipment.find((entry) => entry.id === item.definitionId);
    if (!item || !slot || definition?.type !== slot.type) return "unavailable";
    if (!this.map.isConditionMet(slot.condition) || !this.map.isConditionMet(definition.condition)) return "requirements_not_met";
    for (const [id, equipped] of Object.entries(this.state.equipped)) if (equipped === itemId) delete this.state.equipped[id];
    this.state.equipped[slotId] = itemId;
    this.refreshStats(); this.map.recordProgressChange("equipment");
    return "completed";
  }

  unequip(slotId: string): DevelopmentResult {
    if (!this.state.equipped[slotId]) return "unavailable";
    delete this.state.equipped[slotId]; this.refreshStats(); this.map.recordProgressChange("equipment");
    return "completed";
  }

  upgrade(actorId: string): DevelopmentResult {
    const table = this.levels.get(actorId);
    const level = this.state.levels[actorId], current = table?.get(level);
    if (!current || !table!.has(level + 1)) return "unavailable";
    if (level >= this.levelLimit() || !this.map.isConditionMet(current.condition)) return "requirements_not_met";
    if (!this.map.spendResources(current.cost ?? {})) return "insufficient_resources";
    this.state.levels[actorId] = level + 1; this.refreshStats(); this.map.recordProgressChange("hero_level");
    return "completed";
  }

  statsFor(actorId: string, state: DevelopmentSave = this.state, rank = this.map.rank): ActorStats {
    const base = this.baseStats.get(actorId)!;
    const attributes = { ...this.levels.get(actorId)!.get(state.levels[actorId])!.attributes };
    const rankStats = this.config.ranks?.find((entry) => entry.rank === rank)?.attributes;
    for (const key of ATTRIBUTES) attributes[key] += rankStats?.[key] ?? 0;
    for (const slot of this.config.slots.filter((entry) => entry.actorId === actorId)) {
      const item = state.items.find((entry) => entry.id === state.equipped[slot.id]);
      if (item) for (const key of ATTRIBUTES) attributes[key] += item.attributes[key];
    }
    return { ...base, ...attributes };
  }

  save(): DevelopmentSave { return { levels: { ...this.state.levels }, items: this.state.items.map((item) => ({ ...item, attributes: { ...item.attributes } })), equipped: { ...this.state.equipped }, nextItemId: this.state.nextItemId }; }

  validateSave(state: DevelopmentSave, resources: Readonly<Record<string, number>>): void {
    if (!state || !Number.isSafeInteger(state.nextItemId) || state.nextItemId < 1 || Object.keys(state.levels).length !== this.config.heroes.length) throw new Error("Invalid saved development state");
    for (const hero of this.config.heroes) if (!this.levels.get(hero.actorId)!.has(state.levels[hero.actorId])) throw new Error("Invalid saved hero level");
    const ids = new Set<string>(), counts = new Map<string, number>();
    for (const item of state.items) {
      const definition = this.config.equipment.find((entry) => entry.id === item.definitionId);
      const sequence = /^equipment_(\d+)$/.exec(item.id);
      if (!definition || ids.has(item.id) || !sequence || Number(sequence[1]) < 1 || Number(sequence[1]) >= state.nextItemId || !this.validAttributes(item.attributes)) throw new Error("Invalid saved equipment");
      for (const key of ATTRIBUTES) if (item.attributes[key] < definition.attributes[key][0] || item.attributes[key] > definition.attributes[key][1]) throw new Error("Saved equipment is outside its attribute range");
      ids.add(item.id); counts.set(definition.resource, (counts.get(definition.resource) ?? 0) + 1);
    }
    for (const [resource, count] of counts) if (count > (resources[resource] ?? 0)) throw new Error("Saved equipment exceeds owned inventory");
    const equipped = new Set<string>();
    for (const [slotId, itemId] of Object.entries(state.equipped)) {
      const slot = this.config.slots.find((entry) => entry.id === slotId), item = state.items.find((entry) => entry.id === itemId);
      if (!slot || !item || equipped.has(itemId) || this.config.equipment.find((entry) => entry.id === item.definitionId)?.type !== slot.type) throw new Error("Invalid saved equipment assignment");
      equipped.add(itemId);
    }
  }

  restore(state: DevelopmentSave): void {
    this.state = { levels: { ...state.levels }, items: state.items.map((item) => ({ ...item, attributes: { ...item.attributes } })), equipped: { ...state.equipped }, nextItemId: state.nextItemId };
    this.statsKey = ""; this.refreshStats();
  }

  snapshot() {
    return { heroes: this.actors.map((actor) => {
      const table = this.levels.get(actor.id)!, level = this.state.levels[actor.id];
      const current = table.get(level)!;
      return { id: actor.id, name: actor.displayName, level, limit: this.levelLimit(), attributes: this.statsFor(actor.id),
        canUpgrade: level < this.levelLimit() && table.has(level + 1) && this.map.isConditionMet(current.condition),
        cost: Object.entries(current.cost ?? {}).map(([id, amount]) => ({ id, amount, name: this.map.resourceName(id), owned: this.map.resourceBalance(id) })) };
    }), items: this.state.items.map((item) => ({ ...this.config.equipment.find((entry) => entry.id === item.definitionId)!, ...item,
      usable: this.map.isConditionMet(this.config.equipment.find((entry) => entry.id === item.definitionId)!.condition),
      slotId: Object.keys(this.state.equipped).find((id) => this.state.equipped[id] === item.id) })),
    slots: this.config.slots.map((slot) => ({ ...slot, unlocked: this.map.isConditionMet(slot.condition), itemId: this.state.equipped[slot.id] })) };
  }

  private levelLimit(): number { return this.config.ranks?.length ? this.config.ranks.find((entry) => entry.rank === this.map.rank)?.heroLevelLimit ?? 0 : Number.MAX_SAFE_INTEGER; }
  private validAttributes(attributes: GrowthAttributes, healthRequired = false): boolean { return Boolean(attributes && ATTRIBUTES.every((key) => Number.isSafeInteger(attributes[key]) && attributes[key] >= 0) && (!healthRequired || attributes.maxHealth > 0)); }
  private refreshStats(): void {
    const key = JSON.stringify([this.map.rank, this.state.levels, this.state.equipped]);
    if (key === this.statsKey) return;
    this.statsKey = key;
    for (const actor of this.actors) actor.updateStats(this.statsFor(actor.id));
    this.map.setPartyLevels(this.actors.map((actor) => this.state.levels[actor.id]));
    this.map.setCounter("equipped", Object.keys(this.state.equipped).length);
  }
}
