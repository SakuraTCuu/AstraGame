import type { Vec2Like } from "../math/Vector2";
import type { ProgressCondition } from "./ProgressConditions";
import { unmetConditions, validateCondition } from "./ProgressConditions";
import type { WorldMap } from "./WorldMap";

export type ProgressRewardGrant = { readonly amount: number } & ({ readonly resource: string } | { readonly experience: true });
export type WeightedProgressReward = ProgressRewardGrant & { readonly weight: number };
export type ProgressReward = (ProgressRewardGrant & { readonly chance?: number }) | { readonly oneOf: readonly WeightedProgressReward[] };
export type ProgressRewardDisplay = (ProgressRewardGrant & { readonly name: string; readonly chance?: number }) |
  { readonly oneOf: readonly (WeightedProgressReward & { readonly name: string })[] };
export interface QuestDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: "main" | "boss" | "rank";
  readonly order?: number;
  readonly flag?: string;
  readonly prerequisite?: ProgressCondition;
  readonly condition: ProgressCondition;
  readonly rewards?: readonly ProgressReward[];
  readonly destination?: { readonly poiId?: string; readonly position?: Vec2Like; readonly menu?: "development" | "lineup" | "recruitment" };
}
export interface RankDefinition { readonly id: number; readonly name: string; readonly questIds: readonly string[]; }
export interface JournalConfig { readonly quests: readonly QuestDefinition[]; readonly ranks?: readonly RankDefinition[]; }
export type QuestState = "locked" | "active" | "ready" | "claimed";
export type ClaimResult = "claimed" | "already_claimed" | "requirements_not_met" | "unavailable";
export interface JournalSnapshot {
  readonly quests: readonly (Omit<QuestDefinition, "rewards"> & { readonly state: QuestState; readonly requirements: readonly string[]; readonly rewards: readonly ProgressRewardDisplay[] })[];
  readonly rank: { readonly id: number; readonly name: string; readonly next: (RankDefinition & { readonly ready: boolean }) | null };
}

export class ProgressionJournal {
  readonly quests: readonly QuestDefinition[];
  readonly ranks: readonly RankDefinition[];
  private readonly map: WorldMap;
  private readonly random: () => number;
  private cached: { revision: number; snapshot: JournalSnapshot } | null = null;

  constructor(map: WorldMap, config: JournalConfig = { quests: [] }, random: () => number) {
    this.map = map;
    this.random = random;
    this.quests = [...config.quests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    this.ranks = [...(config.ranks ?? [])].sort((a, b) => a.id - b.id);
    const ids = new Set<string>(), flags = new Set<string>();
    for (const quest of this.quests) {
      if (!quest.id || !quest.name || ids.has(quest.id) || flags.has(this.flag(quest)) || !["main", "boss", "rank"].includes(quest.category)) throw new Error("Invalid quest definition");
      ids.add(quest.id); flags.add(this.flag(quest));
      validateCondition(quest.condition);
      if (quest.prerequisite) validateCondition(quest.prerequisite);
      for (const reward of quest.rewards ?? []) map.validateReward(reward);
      if (quest.destination?.position && ![quest.destination.position.x, quest.destination.position.y].every(Number.isFinite)) throw new Error("Invalid quest destination");
    }
    const rankIds = new Set<number>();
    for (const rank of this.ranks) {
      if (!Number.isSafeInteger(rank.id) || rank.id < 1 || rankIds.has(rank.id) || !rank.name ||
          rank.questIds.some((id) => !this.quests.some((quest) => quest.id === id && quest.category === "rank"))) throw new Error("Invalid rank definition");
      rankIds.add(rank.id);
    }
  }

  state(quest: QuestDefinition): QuestState {
    if (this.map.hasFlag(this.flag(quest))) return "claimed";
    if (quest.category === "rank") {
      const next = this.ranks.find((rank) => rank.id > this.map.rank);
      if (!next?.questIds.includes(quest.id)) return "locked";
    }
    if (!this.map.isConditionMet(quest.prerequisite)) return "locked";
    return this.map.isConditionMet(quest.condition) ? "ready" : "active";
  }

  claim(id: string): ClaimResult {
    const quest = this.quests.find((entry) => entry.id === id);
    if (!quest) return "unavailable";
    const state = this.state(quest);
    if (state === "claimed") return "already_claimed";
    if (state !== "ready") return "requirements_not_met";
    this.map.grantRewards(quest.rewards ?? [], this.random);
    this.map.grantFlag(this.flag(quest));
    return "claimed";
  }

  promote(): ClaimResult {
    const next = this.ranks.find((rank) => rank.id > this.map.rank);
    if (!next) return "unavailable";
    if (!next.questIds.every((id) => this.state(this.quests.find((quest) => quest.id === id)!) === "claimed")) return "requirements_not_met";
    this.map.setRank(next.id);
    return "claimed";
  }

  snapshot(): JournalSnapshot {
    if (this.cached?.revision === this.map.revision) return this.cached.snapshot;
    const next = this.ranks.find((rank) => rank.id > this.map.rank);
    const snapshot: JournalSnapshot = {
      quests: this.quests.map((quest) => ({ ...quest, state: this.state(quest),
        requirements: unmetConditions(this.state(quest) === "locked" ? quest.prerequisite : quest.condition, this.map),
        rewards: this.displayRewards(quest.rewards ?? []) })),
      rank: { id: this.map.rank, name: this.ranks.find((rank) => rank.id === this.map.rank)?.name ?? "",
        next: next ? { ...next, ready: next.questIds.every((id) => this.state(this.quests.find((quest) => quest.id === id)!) === "claimed") } : null },
    };
    this.cached = { revision: this.map.revision, snapshot };
    return snapshot;
  }

  private displayRewards(rewards: readonly ProgressReward[]): ProgressRewardDisplay[] {
    const result: ProgressRewardDisplay[] = [];
    for (const reward of rewards) {
      if ("oneOf" in reward) result.push({ oneOf: reward.oneOf.map((choice) => ({ ...choice,
        name: "resource" in choice ? this.map.resourceName(choice.resource) : "\u961f\u4f0d\u7ecf\u9a8c" })) });
      else result.push({ ...reward, name: "resource" in reward ? this.map.resourceName(reward.resource) : "\u961f\u4f0d\u7ecf\u9a8c" });
    }
    return result;
  }

  private flag(quest: QuestDefinition): string { return quest.flag ?? `quest:${quest.id}`; }
}
