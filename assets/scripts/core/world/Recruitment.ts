import type { ProgressReward } from "./ProgressionJournal";
import type { ProgressCondition } from "./ProgressConditions";
import { validateCondition } from "./ProgressConditions";
import type { WorldMap } from "./WorldMap";

export interface RecruitmentEntry {
  readonly id: string; readonly name: string; readonly weight: number; readonly rewards: readonly ProgressReward[];
  readonly condition?: ProgressCondition; readonly quality?: number; readonly icon?: { readonly atlas: string; readonly frame: string };
}
export interface RecruitmentPool {
  readonly id: string; readonly name: string; readonly cost: Readonly<Record<string, number>>;
  readonly groups: readonly (readonly RecruitmentEntry[])[];
  readonly weightSteps: readonly { readonly unlocked: number; readonly weights: readonly number[] }[];
  readonly unlocks?: readonly ProgressCondition[];
  readonly prize?: { readonly chances: readonly number[]; readonly entries: readonly RecruitmentEntry[] };
}
export interface RecruitmentConfig { readonly pools: readonly RecruitmentPool[]; }
export interface RecruitmentDraw { readonly entryId: string; readonly name: string; readonly quality?: number; readonly icon?: { readonly atlas: string; readonly frame: string }; readonly prize: boolean; }

export class Recruitment {
  readonly config: RecruitmentConfig;
  private readonly map: WorldMap;
  private readonly random: () => number;
  private lastDraws: RecruitmentDraw[] = [];

  constructor(map: WorldMap, config: RecruitmentConfig, random: () => number) {
    this.map = map; this.config = config; this.random = random;
    const ids = new Set<string>();
    for (const pool of config.pools) {
      if (!pool.id || ids.has(pool.id) || !pool.groups.length || !pool.weightSteps.length || pool.weightSteps[0].unlocked !== 0) throw new Error("Invalid recruitment pool");
      ids.add(pool.id);
      for (const [resource, amount] of Object.entries(pool.cost)) map.validateReward({ resource, amount });
      for (const entry of [...pool.groups.reduce<RecruitmentEntry[]>((all, group) => all.concat(group), []), ...(pool.prize?.entries ?? [])]) {
        if (!entry.id || !entry.name || !(entry.weight > 0) || !Number.isSafeInteger(entry.weight)) throw new Error("Invalid recruitment weight");
        if (entry.condition) validateCondition(entry.condition);
        for (const reward of entry.rewards) map.validateReward(reward);
      }
      pool.weightSteps.forEach((step, index) => {
        if (!Number.isSafeInteger(step.unlocked) || step.unlocked < 0 || (index > 0 && step.unlocked <= pool.weightSteps[index - 1].unlocked) ||
            step.weights.length !== pool.groups.length || step.weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0) || !step.weights.some((weight) => weight > 0)) throw new Error("Invalid recruitment group weights");
      });
      for (const condition of pool.unlocks ?? []) validateCondition(condition);
      if (pool.prize && (!pool.prize.chances.length || pool.prize.chances.some((chance) => !Number.isFinite(chance) || chance < 0 || chance > 1) || !pool.prize.entries.length)) throw new Error("Invalid recruitment guarantee curve");
    }
  }

  draw(poolId: string, count = 1): "completed" | "insufficient_resources" | "unavailable" {
    const pool = this.config.pools.find((entry) => entry.id === poolId);
    if (!pool || !Number.isSafeInteger(count) || count < 1 || count > 10) return "unavailable";
    const cost: Record<string, number> = {};
    for (const [id, amount] of Object.entries(pool.cost)) { cost[id] = amount * count; if (this.map.resourceBalance(id) < cost[id]) return "insufficient_resources"; }
    const groups = pool.groups.map((group) => group.filter((entry) => this.map.isConditionMet(entry.condition)));
    const unlocked = (pool.unlocks ?? []).filter((condition) => this.map.isConditionMet(condition)).length;
    const step = [...pool.weightSteps].reverse().find((entry) => entry.unlocked <= unlocked)!;
    const groupWeights = groups.map((entries, index) => ({ entries, weight: entries.length ? step.weights[index] : 0 })).filter((group) => group.weight > 0);
    const prizes = pool.prize?.entries.filter((entry) => this.map.isConditionMet(entry.condition)) ?? [];
    if (!groupWeights.length || (pool.prize && !prizes.length)) return "unavailable";
    let streak = this.map.counter(`recruit_streak:${pool.id}`);
    const draws: RecruitmentDraw[] = [], rewards: ProgressReward[] = [];
    for (let index = 0; index < count; index++) {
      const chance = pool.prize?.chances[Math.min(streak, pool.prize.chances.length - 1)] ?? 0;
      const prize = Boolean(pool.prize && this.random() < chance);
      const entry = prize ? this.pick(prizes) : this.pick(this.pick(groupWeights).entries);
      draws.push({ entryId: entry.id, name: entry.name, quality: entry.quality, icon: entry.icon, prize });
      rewards.push(...entry.rewards); streak = prize ? 0 : streak + 1;
    }
    if (!this.map.transactRewards(cost, rewards, this.random)) return "insufficient_resources";
    this.map.incrementCounter("recruit", count); this.map.setCounter(`recruit_streak:${pool.id}`, streak); this.lastDraws = draws;
    return "completed";
  }

  snapshot() {
    return { pools: this.config.pools.map((pool) => ({ id: pool.id, name: pool.name,
      cost: Object.entries(pool.cost).map(([id, amount]) => ({ id, amount, owned: this.map.resourceBalance(id), name: this.map.resourceName(id) })),
      preview: (pool.prize?.entries ?? []).filter((entry) => this.map.isConditionMet(entry.condition)).slice(0, 5).map((entry) => ({ name: entry.name, icon: entry.icon, prize: true })),
      guaranteeIn: pool.prize ? Math.max(1, pool.prize.chances.length - this.map.counter(`recruit_streak:${pool.id}`)) : null })), lastDraws: [...this.lastDraws] };
  }

  private pick<T extends { readonly weight: number }>(entries: readonly T[]): T {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let value = this.random() * total;
    for (const entry of entries) { value -= entry.weight; if (value < 0) return entry; }
    return entries[entries.length - 1];
  }
}
