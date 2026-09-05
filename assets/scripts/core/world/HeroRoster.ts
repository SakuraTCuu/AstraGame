import type { Actor } from "../actor/Actor";
import type { ConditionContext, ProgressCondition } from "./ProgressConditions";
import { meetsCondition, validateCondition } from "./ProgressConditions";
import type { WorldMap } from "./WorldMap";

export interface RosterHeroDefinition {
  readonly id: string;
  readonly cardResource?: string;
  readonly initiallyOwned?: boolean;
  readonly ownershipFlag?: string;
  readonly visibility?: ProgressCondition;
  readonly deployCondition?: ProgressCondition;
  readonly quality?: number;
  readonly icon?: { readonly atlas: string; readonly frame: string };
}
export interface RosterDefinition {
  readonly heroes: readonly RosterHeroDefinition[];
  readonly slots: readonly { readonly condition?: ProgressCondition }[];
  readonly initialLineup: readonly (string | null)[];
}
export interface ReserveVitals { readonly id: string; readonly hp: number; readonly energy: number; }
export interface RosterSave { readonly owned: readonly string[]; readonly lineup: readonly (string | null)[]; readonly reserves: readonly ReserveVitals[]; }

export class HeroRoster {
  private readonly actors: ReadonlyMap<string, Actor>;
  private readonly map: WorldMap;
  readonly config: RosterDefinition;
  private owned: Set<string>;
  private lineup: (string | null)[];

  constructor(actors: readonly Actor[], map: WorldMap, config: RosterDefinition) {
    this.actors = new Map(actors.map((actor) => [actor.id, actor])); this.map = map; this.config = config;
    const ids = new Set<string>();
    for (const hero of config.heroes) {
      if (!this.actors.has(hero.id) || ids.has(hero.id)) throw new Error("Invalid roster hero");
      ids.add(hero.id);
      if (hero.visibility) validateCondition(hero.visibility);
      if (hero.deployCondition) validateCondition(hero.deployCondition);
      if (hero.cardResource) map.validateReward({ resource: hero.cardResource, amount: 0 });
    }
    for (const slot of config.slots) if (slot.condition) validateCondition(slot.condition);
    this.owned = new Set(config.heroes.filter((hero) => hero.initiallyOwned).map((hero) => hero.id));
    this.lineup = [...config.initialLineup];
    this.validateLineup(this.lineup, this.owned, map);
    this.publishOwnership(); this.publishLineup();
  }

  owns(id: string): boolean { return this.owned.has(id); }
  slots(): readonly (string | null)[] { return this.lineup; }
  activeActors(): Actor[] { return this.lineup.filter((id): id is string => Boolean(id)).map((id) => this.actors.get(id)!); }
  actor(id: string): Actor | undefined { return this.actors.get(id); }

  syncOwnership(): void {
    let changed = false;
    for (const hero of this.config.heroes) {
      if (this.owned.has(hero.id)) continue;
      if ((hero.cardResource && this.map.resourceBalance(hero.cardResource) > 0) || (hero.ownershipFlag && this.map.hasFlag(hero.ownershipFlag))) {
        this.owned.add(hero.id); changed = true;
      }
    }
    if (changed) { this.publishOwnership(); this.map.recordProgressChange("roster"); }
  }

  planAssignment(index: number, id: string | null): (string | null)[] | null {
    const slot = this.config.slots[index];
    const hero = id ? this.config.heroes.find((hero) => hero.id === id) : undefined;
    if (!slot || !this.map.isConditionMet(slot.condition) || (id && (!this.owned.has(id) || !this.map.isConditionMet(hero?.deployCondition)))) return null;
    const next = [...this.lineup];
    const previous = id ? next.indexOf(id) : -1;
    if (previous >= 0 && previous !== index) next[previous] = next[index];
    next[index] = id;
    if (!next.some(Boolean)) return null;
    return next;
  }

  assign(lineup: readonly (string | null)[]): void {
    this.validateLineup(lineup, this.owned, this.map);
    this.lineup = [...lineup]; this.publishLineup(); this.map.recordProgressChange("lineup");
  }

  save(): RosterSave {
    return { owned: [...this.owned], lineup: [...this.lineup], reserves: [...this.owned].filter((id) => !this.lineup.includes(id)).map((id) => {
      const actor = this.actors.get(id)!; return { id, hp: actor.persistentHealth, energy: actor.energy };
    }) };
  }

  validateSave(save: RosterSave, context: ConditionContext): void {
    if (!save || !Array.isArray(save.owned) || !Array.isArray(save.reserves) || new Set(save.owned).size !== save.owned.length ||
        save.owned.some((id) => !this.config.heroes.some((hero) => hero.id === id))) throw new Error("Invalid saved roster ownership");
    const owned = new Set(save.owned);
    this.validateLineup(save.lineup, owned, context);
    const reserves = new Set<string>();
    for (const hero of save.reserves) {
      if (!owned.has(hero.id) || save.lineup.includes(hero.id) || reserves.has(hero.id) || ![hero.hp, hero.energy].every(Number.isFinite) ||
          hero.hp < 0 || hero.energy < 0) throw new Error("Invalid saved reserve hero");
      reserves.add(hero.id);
    }
    if (reserves.size + save.lineup.filter(Boolean).length !== owned.size) throw new Error("Saved reserve heroes are incomplete");
  }

  restore(save: RosterSave): void {
    this.owned = new Set(save.owned); this.lineup = [...save.lineup];
    for (const hero of save.reserves) { const actor = this.actors.get(hero.id)!; actor.health = hero.hp; actor.energy = hero.energy; if (!actor.alive) actor.setState("dead"); }
    this.publishOwnership(); this.publishLineup();
  }

  snapshot(level: (id: string) => number) {
    return { slots: this.config.slots.map((slot, index) => ({ index, unlocked: this.map.isConditionMet(slot.condition), heroId: this.lineup[index], condition: slot.condition })),
      heroes: this.config.heroes.filter((hero) => this.owned.has(hero.id) || this.map.isConditionMet(hero.visibility)).map((hero) => ({ ...hero,
        name: this.actors.get(hero.id)!.displayName, owned: this.owned.has(hero.id), available: this.map.isConditionMet(hero.deployCondition), level: level(hero.id), position: this.lineup.indexOf(hero.id) })) };
  }

  private validateLineup(lineup: readonly (string | null)[], owned: ReadonlySet<string>, context: ConditionContext): void {
    if (!Array.isArray(lineup) || lineup.length !== this.config.slots.length || !lineup.some(Boolean)) throw new Error("Invalid roster slot count");
    const assigned = new Set<string>();
    lineup.forEach((id, index) => {
      if (id === null) return;
      const hero = this.config.heroes.find((entry) => entry.id === id);
      if (!hero || !owned.has(id) || assigned.has(id) || !meetsCondition(this.config.slots[index].condition, context) || !meetsCondition(hero.deployCondition, context)) throw new Error("Invalid roster assignment");
      assigned.add(id);
    });
  }
  private publishOwnership(): void { for (const hero of this.config.heroes) if (this.owned.has(hero.id) && hero.ownershipFlag) this.map.grantFlag(hero.ownershipFlag); }
  private publishLineup(): void { this.map.setCounter("party_count", this.lineup.filter(Boolean).length); }
}
