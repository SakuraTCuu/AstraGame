import type { FogGrid } from "../fog/FogGrid";
import type { Vec2Like } from "../math/Vector2";
import type { GridNavigation } from "../navigation/GridNavigation";
import type { ProgressCondition } from "./ProgressConditions";
import { meetsCondition, unmetConditions, validateCondition } from "./ProgressConditions";
import { pointInPolygon, polygonIntersectsRect, validateConvexPolygon } from "./WorldGeometry";
import type { ProgressReward } from "./ProgressionJournal";

export interface WorldRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export type WorldObstacle =
  | { readonly id: string; readonly shape: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly id: string; readonly shape: "circle"; readonly x: number; readonly y: number; readonly radius: number };
export interface ResourceCost { readonly resource: string; readonly amount: number; }
export interface WorldPoi extends Vec2Like {
  readonly id: string; readonly name?: string; readonly type: string; readonly discoverRadius: number;
  readonly interaction?: { readonly radius: number; readonly cost?: ResourceCost; readonly grants?: Readonly<Record<string, number>>; readonly rewards?: readonly ProgressReward[]; readonly initiallyCompleted?: boolean; readonly condition?: ProgressCondition; readonly allowLockedApproach?: boolean; readonly command?: string; readonly auto?: boolean };
}
export interface WorldZone { readonly id: string; readonly name?: string; readonly rect: WorldRect; readonly unlock: string; readonly minimumLevel?: number; readonly polygon?: readonly Vec2Like[]; }
export interface ExperienceLevel { readonly level: number; readonly required: number; }
export interface WorldProgression { readonly level: number; readonly rank?: number; readonly initialFlags?: readonly string[]; readonly initialCounters?: Readonly<Record<string, number>>; readonly partyLevels?: readonly number[]; readonly experienceLevels?: readonly ExperienceLevel[]; readonly resources: Readonly<Record<string, { readonly name: string; readonly initial: number; readonly optionalInSave?: boolean; readonly showInHud?: boolean }>>; }
export interface MapProgress { readonly level: number; readonly rank?: number; readonly experience?: number; readonly counters?: Readonly<Record<string, number>>; readonly flags?: readonly string[]; readonly resources: Readonly<Record<string, number>>; readonly discoveredPoiIds: readonly string[]; readonly interactedPoiIds: readonly string[]; readonly completedEncounterIds: readonly string[]; }
export type InteractionResult = "completed" | "already_completed" | "out_of_range" | "insufficient_resources" | "requirements_not_met" | "locked" | "unavailable";
export interface ExplorationEvent { readonly type: "poi_discovered" | "poi_interacted" | "zone_unlocked" | "encounter_completed" | "progress_changed" | "resource_changed" | "teleported" | "level_up"; readonly id: string; }

function contains(rect: WorldRect, point: Vec2Like): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function overlapArea(left: WorldRect, right: WorldRect): number {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) *
    Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

export class WorldMap {
  private readonly navigation: GridNavigation;
  private readonly fog: FogGrid;
  private readonly bounds: WorldRect;
  readonly zones: readonly WorldZone[];
  readonly pois: readonly WorldPoi[];
  private readonly unlocked = new Set<string>();
  private readonly discovered = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly interacted = new Set<string>();
  private readonly balances = new Map<string, number>();
  private readonly resourceNames = new Map<string, string>();
  private readonly optionalResources = new Set<string>();
  private readonly hiddenResources = new Set<string>();
  private currentPartyLevels: readonly number[];
  private readonly experienceLevels = new Map<number, number>();
  private readonly counters = new Map<string, number>();
  private experience = 0;
  level: number;
  rank: number;
  private readonly flags = new Set<string>();
  private readonly zoneMode: "partition" | "overlay";
  revision = 0;
  private readonly events: ExplorationEvent[] = [];

  constructor(
    navigation: GridNavigation,
    fog: FogGrid,
    bounds: WorldRect,
    zones: readonly WorldZone[] = [],
    pois: readonly WorldPoi[] = [],
    obstacles: readonly WorldObstacle[] = [],
    progression: WorldProgression = { level: 1, resources: {} },
    zoneMode: "partition" | "overlay" = "partition",
  ) {
    this.navigation = navigation;
    this.fog = fog;
    this.bounds = bounds;
    this.zones = zones;
    this.pois = pois;
    this.level = progression.level;
    this.rank = progression.rank ?? 0;
    this.currentPartyLevels = [...(progression.partyLevels ?? [])];
    if (this.partyLevels.some((level) => !Number.isSafeInteger(level) || level < 1)) throw new Error("Invalid party level");
    for (const [id, amount] of Object.entries(progression.initialCounters ?? {})) this.incrementCounter(id, amount);
    this.zoneMode = zoneMode;
    if (!Number.isSafeInteger(this.rank) || this.rank < 0) throw new Error("Invalid exploration rank");
    for (const flag of progression.initialFlags ?? []) { if (!flag || typeof flag !== "string") throw new Error("Invalid initial flag"); this.flags.add(flag); }
    if (!Number.isSafeInteger(this.level) || this.level < 1) throw new Error("Invalid exploration level");
    const levels = [...(progression.experienceLevels ?? [])].sort((a, b) => a.level - b.level);
    for (let index = 0; index < levels.length; index++) {
      const entry = levels[index];
      if (!Number.isSafeInteger(entry.level) || entry.level < 1 || !Number.isSafeInteger(entry.required) || entry.required <= 0 ||
          (index > 0 && entry.level !== levels[index - 1].level + 1)) throw new Error("Invalid experience level table");
      this.experienceLevels.set(entry.level, entry.required);
    }
    if (levels.length && !this.experienceLevels.has(this.level)) throw new Error("Starting level is absent from experience table");
    for (const id of Object.keys(progression.resources)) {
      const resource = progression.resources[id];
      if (!Number.isSafeInteger(resource.initial) || resource.initial < 0) throw new Error(`Invalid resource ${id}`);
      this.balances.set(id, resource.initial);
      this.resourceNames.set(id, resource.name);
      if (resource.optionalInSave) this.optionalResources.add(id);
      if (resource.showInHud === false) this.hiddenResources.add(id);
    }
    const ids = new Set<string>();
    for (const poi of pois) {
      if (ids.has(poi.id) || !contains(bounds, poi) || !(poi.discoverRadius > 0)) throw new Error(`Invalid POI ${poi.id}`);
      ids.add(poi.id);
      if (poi.interaction) {
        if (!(poi.interaction.radius > 0)) throw new Error(`Invalid interaction radius ${poi.id}`);
        if (poi.interaction.condition) validateCondition(poi.interaction.condition);
        if (poi.interaction.cost) this.validateResourceAmount(poi.interaction.cost.resource, poi.interaction.cost.amount);
        for (const id of Object.keys(poi.interaction.grants ?? {})) this.validateResourceAmount(id, poi.interaction.grants![id]);
        for (const reward of poi.interaction.rewards ?? []) this.validateReward(reward);
        if (poi.interaction.initiallyCompleted) this.interacted.add(poi.id);
      }
    }
    ids.clear();
    for (const zone of zones) {
      if (ids.has(zone.id) || !(zone.rect.width > 0 && zone.rect.height > 0) || zone.rect.x < bounds.x || zone.rect.y < bounds.y ||
          zone.rect.x + zone.rect.width > bounds.x + bounds.width + 1e-6 || zone.rect.y + zone.rect.height > bounds.y + bounds.height + 1e-6) throw new Error(`Invalid zone ${zone.id}`);
      ids.add(zone.id);
      if (zone.polygon) validateConvexPolygon(zone.polygon);
      for (const other of zones) {
        if (zoneMode === "partition" && other !== zone && overlapArea(zone.rect, other.rect) > 0) throw new Error(`Overlapping zones ${zone.id} and ${other.id}`);
      }
      if (zone.minimumLevel !== undefined && (!Number.isInteger(zone.minimumLevel) || zone.minimumLevel < 1)) throw new Error(`Invalid zone level ${zone.id}`);
      if (zone.unlock === "initial") { if ((zone.minimumLevel ?? 1) <= this.level) this.unlocked.add(zone.id); }
      else {
        const [kind, id, extra] = zone.unlock.split(":");
        if (!id || extra || !["discover", "clear", "interact"].includes(kind)) throw new Error(`Invalid unlock condition for ${zone.id}`);
        if ((kind === "discover" || kind === "interact") && !pois.some((poi) => poi.id === id && (kind !== "interact" || poi.interaction))) throw new Error(`Unknown unlock POI ${id}`);
      }
    }
    for (const obstacle of obstacles) {
      if (obstacle.shape === "rect" ? !(obstacle.width > 0 && obstacle.height > 0) : !(obstacle.radius > 0)) {
        throw new Error(`Invalid obstacle ${obstacle.id}`);
      }
    }
    this.forEachCell(navigation.width, navigation.height, navigation.cellSize, (x, y, rect) => {
      const outside = overlapArea(bounds, rect) < rect.width * rect.height;
      if (outside || obstacles.some((obstacle) => this.intersectsObstacle(rect, obstacle))) navigation.setBlocked({ x, y }, true);
    });
    this.refreshLocks();
    this.refreshUnlocks();
  }

  isZoneUnlocked(id: string): boolean { return this.unlocked.has(id); }
  isPoiDiscovered(id: string): boolean { return this.discovered.has(id); }
  isEncounterCompleted(id: string): boolean { return this.completed.has(id); }
  isPoiInteracted(id: string): boolean { return this.interacted.has(id); }
  hasFlag(id: string): boolean { return this.flags.has(id) || (id.startsWith("poi:") && this.interacted.has(id.slice(4))); }
  counter(id: string): number { return this.counters.get(id) ?? 0; }
  get partyLevels(): readonly number[] { return this.currentPartyLevels; }
  setPartyLevels(levels: readonly number[]): void {
    if (levels.some((level) => !Number.isSafeInteger(level) || level < 1)) throw new Error("Invalid party level");
    if (levels.length === this.partyLevels.length && levels.every((level, index) => level === this.partyLevels[index])) return;
    this.currentPartyLevels = [...levels]; this.recordProgressChange("party_levels");
  }
  setCounter(id: string, amount: number): void {
    if (!id || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid progression count");
    if (this.counter(id) === amount) return;
    this.counters.set(id, amount); this.recordProgressChange(id);
  }
  recordProgressChange(id: string): void { this.revision += 1; this.events.push({ type: "progress_changed", id }); }
  incrementCounter(id: string, amount = 1): void {
    if (!id || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(this.counter(id) + amount)) throw new Error("Invalid progression count");
    if (!amount) return;
    this.counters.set(id, this.counter(id) + amount);
    this.revision += 1;
    this.events.push({ type: "progress_changed", id });
  }
  isConditionMet(condition?: ProgressCondition): boolean { return meetsCondition(condition, this); }
  resourceBalance(id: string): number { return this.balances.get(id) ?? 0; }
  resourceName(id: string): string { return this.resourceNames.get(id) ?? id; }
  grantFlag(id: string): void {
    if (!id || this.flags.has(id)) return;
    this.flags.add(id); this.revision += 1;
    this.events.push({ type: "progress_changed", id });
  }
  setRank(rank: number): void {
    if (!Number.isSafeInteger(rank) || rank < this.rank) throw new Error("Exploration rank cannot decrease");
    this.rank = rank; this.revision += 1;
  }
  recordTeleport(id: string): void { this.revision += 1; this.events.push({ type: "teleported", id }); }
  grantResources(grants: Readonly<Record<string, number>>): void {
    for (const id of Object.keys(grants)) {
      this.validateResourceAmount(id, grants[id]);
      if (!Number.isSafeInteger(this.balances.get(id)! + grants[id]) || !Number.isSafeInteger(this.counter(`owned:${id}`) + grants[id])) throw new Error(`Resource overflow: ${id}`);
    }
    for (const id of Object.keys(grants)) { this.balances.set(id, this.balances.get(id)! + grants[id]); this.incrementCounter(`owned:${id}`, grants[id]); this.events.push({ type: "resource_changed", id }); }
    this.revision += 1;
  }

  spendResources(cost: Readonly<Record<string, number>>): boolean {
    for (const [id, amount] of Object.entries(cost)) this.validateResourceAmount(id, amount);
    if (Object.entries(cost).some(([id, amount]) => this.resourceBalance(id) < amount)) return false;
    for (const [id, amount] of Object.entries(cost)) { this.balances.set(id, this.resourceBalance(id) - amount); this.events.push({ type: "resource_changed", id }); }
    if (Object.keys(cost).length) this.revision += 1;
    return true;
  }

  validateReward(reward: ProgressReward): void {
    if (!reward || !Number.isSafeInteger(reward.amount) || reward.amount < 0 || !Number.isFinite(reward.chance ?? 1) ||
        (reward.chance ?? 1) < 0 || (reward.chance ?? 1) > 1) throw new Error("Invalid progression reward");
    if ("resource" in reward) this.validateResourceAmount(reward.resource, reward.amount);
    else if (reward.experience !== true || !this.experienceLevels.size) throw new Error("Experience reward requires a level table");
  }

  private validateRewardBatch(rewards: readonly ProgressReward[], balances = this.balances, extraOwned: Readonly<Record<string, number>> = {}): void {
    const maximum: Record<string, number> = {};
    let maximumExperience = 0;
    for (const reward of rewards) {
      this.validateReward(reward);
      if ("resource" in reward) maximum[reward.resource] = (maximum[reward.resource] ?? 0) + reward.amount;
      else maximumExperience += reward.amount;
    }
    for (const [id, amount] of Object.entries(maximum)) if (!Number.isSafeInteger((balances.get(id) ?? 0) + amount) ||
        !Number.isSafeInteger(this.counter(`owned:${id}`) + (extraOwned[id] ?? 0) + amount)) throw new Error("Reward balance overflow");
    if (!Number.isSafeInteger(this.experience + maximumExperience)) throw new Error("Experience reward overflow");
  }

  grantRewards(rewards: readonly ProgressReward[], random: () => number): void {
    this.validateRewardBatch(rewards);
    const grants: Record<string, number> = {};
    let experience = 0;
    for (const reward of rewards) if (random() < (reward.chance ?? 1)) {
      if ("resource" in reward) grants[reward.resource] = (grants[reward.resource] ?? 0) + reward.amount;
      else experience += reward.amount;
    }
    if (Object.keys(grants).length) this.grantResources(grants);
    if (experience) this.grantExperience(experience);
  }

  grantExperience(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(this.experience + amount)) throw new Error("Invalid experience reward");
    if (!amount) return;
    if (!this.experienceLevels.size) throw new Error("Experience requires a level table");
    let level = this.level, remaining = this.experience + amount;
    while (this.experienceLevels.has(level + 1) && remaining >= this.experienceLevels.get(level)!) {
      remaining -= this.experienceLevels.get(level)!;
      level++;
      this.events.push({ type: "level_up", id: String(level) });
    }
    const changedLevel = level !== this.level;
    this.level = level;
    this.experience = this.experienceLevels.has(level + 1) ? remaining : 0;
    this.revision += 1;
    this.events.push({ type: "progress_changed", id: "experience" });
    if (changedLevel) this.refreshUnlocks();
  }

  isPortalActive(id: string): boolean {
    const poi = this.pois.find((entry) => entry.id === id);
    return Boolean(poi && poi.type === "portal" && this.interacted.has(id) && this.isPositionUnlocked(poi));
  }

  interact(id: string, position: Vec2Like, random?: () => number): InteractionResult {
    const poi = this.pois.find((entry) => entry.id === id);
    if (!poi?.interaction) return "unavailable";
    if (!this.isPositionUnlocked(position) || (!poi.interaction.allowLockedApproach && !this.isPositionUnlocked(poi))) return "locked";
    if (this.interacted.has(id)) return "already_completed";
    if (!this.isConditionMet(poi.interaction.condition)) return "requirements_not_met";
    if (Math.hypot(position.x - poi.x, position.y - poi.y) > poi.interaction.radius || !this.navigation.isSegmentWalkable(position, poi, Boolean(poi.interaction.allowLockedApproach))) return "out_of_range";
    const cost = poi.interaction.cost;
    if (cost && this.balances.get(cost.resource)! < cost.amount) return "insufficient_resources";
    if (poi.interaction.rewards?.length && !random) throw new Error("Reward interaction requires deterministic random");
    const next = new Map(this.balances);
    if (cost) next.set(cost.resource, next.get(cost.resource)! - cost.amount);
    for (const resource of Object.keys(poi.interaction.grants ?? {})) {
      const balance = next.get(resource)! + poi.interaction.grants![resource];
      if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(this.counter(`owned:${resource}`) + poi.interaction.grants![resource])) throw new Error(`Resource overflow: ${resource}`);
      next.set(resource, balance);
    }
    this.validateRewardBatch(poi.interaction.rewards ?? [], next, poi.interaction.grants);
    for (const [resource, amount] of next) this.balances.set(resource, amount);
    for (const [id, amount] of Object.entries(poi.interaction.grants ?? {})) this.incrementCounter(`owned:${id}`, amount);
    if (poi.interaction.rewards?.length) this.grantRewards(poi.interaction.rewards, random!);
    this.interacted.add(id);
    this.revision += 1;
    this.events.push({ type: "poi_interacted", id });
    this.refreshUnlocks();
    return "completed";
  }

  setLevel(level: number): void {
    if (!Number.isSafeInteger(level) || level < this.level) throw new Error("Exploration level cannot decrease");
    if (this.experienceLevels.size && !this.experienceLevels.has(level)) throw new Error("Level is absent from experience table");
    if (level === this.level) return;
    this.level = level;
    this.experience = 0;
    this.revision += 1;
    this.refreshUnlocks();
  }

  isPositionUnlocked(point: Vec2Like): boolean {
    if (!contains(this.bounds, point)) return false;
    if (this.zoneMode === "overlay") return !this.zones.some((zone) => !this.unlocked.has(zone.id) && contains(zone.rect, point) && (!zone.polygon || pointInPolygon(point, zone.polygon)));
    return this.zones.length === 0 || this.zones.some((zone) => contains(zone.rect, point) && this.unlocked.has(zone.id));
  }

  blockingGateAt(point: Vec2Like): string | undefined {
    const cell = this.navigation.worldToGrid(point), size = this.navigation.cellSize;
    const rect = { x: cell.x * size, y: cell.y * size, width: size, height: size };
    return this.zones.find((zone) => !this.unlocked.has(zone.id) && zone.unlock.startsWith("interact:") &&
      (zone.polygon ? polygonIntersectsRect(zone.polygon, rect) : overlapArea(zone.rect, rect) > 0))?.unlock.slice(9);
  }

  discoverAt(position: Vec2Like): void {
    if (!this.navigation.isWorldWalkable(position)) return;
    for (const poi of this.pois) {
      if (this.discovered.has(poi.id) || !this.isPositionUnlocked(poi)) continue;
      const distance = Math.hypot(position.x - poi.x, position.y - poi.y);
      if (distance > poi.discoverRadius || !this.navigation.isSegmentWalkable(position, poi)) continue;
      this.discovered.add(poi.id);
      this.revision += 1;
      this.events.push({ type: "poi_discovered", id: poi.id });
      this.refreshUnlocks();
    }
  }

  completeEncounter(id: string): void {
    if (this.completed.has(id)) return;
    this.completed.add(id);
    this.revision += 1;
    this.events.push({ type: "encounter_completed", id });
    this.refreshUnlocks();
  }

  drainEvents(): ExplorationEvent[] { return this.events.splice(0); }

  snapshot() {
    return {
      zones: this.zones.map((zone) => ({ ...zone, unlocked: this.unlocked.has(zone.id) })),
      discoveredPoiIds: [...this.discovered],
      completedEncounterIds: [...this.completed],
      interactedPoiIds: [...this.interacted],
      level: this.level,
      rank: this.rank,
      experience: this.experienceLevels.size ? { current: this.experience, required: this.experienceLevels.has(this.level + 1) ? this.experienceLevels.get(this.level)! : null } : null,
      counters: this.counterProgress(),
      flags: [...this.flags],
      resources: [...this.balances].map(([id, amount]) => ({ id, name: this.resourceNames.get(id)!, amount, showInHud: !this.hiddenResources.has(id) })),
      pois: this.pois.map((poi) => ({ ...poi, discovered: this.discovered.has(poi.id), completed: this.interacted.has(poi.id),
        unlocked: this.isPositionUnlocked(poi), requirements: this.interacted.has(poi.id) ? [] : unmetConditions(poi.interaction?.condition, this),
        canAfford: !poi.interaction?.cost || this.balances.get(poi.interaction.cost.resource)! >= poi.interaction.cost.amount })),
    };
  }

  saveProgress(): MapProgress {
    const resources: Record<string, number> = {};
    for (const [id, amount] of this.balances) resources[id] = amount;
    return { level: this.level, rank: this.rank, experience: this.experience, counters: this.counterProgress(), flags: [...this.flags], resources, discoveredPoiIds: [...this.discovered],
      interactedPoiIds: [...this.interacted], completedEncounterIds: [...this.completed] };
  }

  validateProgress(progress: MapProgress): void {
    if (!Number.isSafeInteger(progress.level) || progress.level < 1) throw new Error("Invalid saved level");
    const experience = progress.experience ?? 0;
    if (!Number.isSafeInteger(experience) || experience < 0 ||
        (this.experienceLevels.size && !this.experienceLevels.has(progress.level)) ||
        (this.experienceLevels.has(progress.level + 1) ? experience >= this.experienceLevels.get(progress.level)! : experience !== 0)) throw new Error("Invalid saved experience");
    for (const [id, amount] of Object.entries(progress.counters ?? {})) if (!id || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid saved progression count");
    for (const [id, amount] of Object.entries(progress.resources)) this.validateResourceAmount(id, amount);
    for (const id of this.balances.keys()) if (!(id in progress.resources) && !this.optionalResources.has(id)) throw new Error("Saved resources do not match configuration");
    for (const id of progress.discoveredPoiIds) if (!this.pois.some((poi) => poi.id === id)) throw new Error(`Unknown saved POI ${id}`);
    for (const id of progress.interactedPoiIds) if (!this.pois.some((poi) => poi.id === id && poi.interaction)) throw new Error(`Unknown saved interaction ${id}`);
    if (!Number.isSafeInteger(progress.rank ?? 0) || (progress.rank ?? 0) < 0) throw new Error("Invalid saved rank");
    for (const id of progress.flags ?? []) if (!id || typeof id !== "string") throw new Error("Invalid saved progression flag");
    for (const id of progress.completedEncounterIds) if (!id || typeof id !== "string") throw new Error("Invalid saved encounter");
  }

  restoreProgress(progress: MapProgress): void {
    this.validateProgress(progress);
    this.level = Math.max(this.level, progress.level);
    this.experience = progress.level >= this.level ? progress.experience ?? 0 : 0;
    for (const [id, amount] of Object.entries(progress.counters ?? {})) this.counters.set(id, Math.max(this.counter(id), amount));
    this.rank = Math.max(this.rank, progress.rank ?? 0);
    for (const id of progress.flags ?? []) this.flags.add(id);
    for (const [id, amount] of Object.entries(progress.resources)) this.balances.set(id, amount);
    for (const id of progress.discoveredPoiIds) this.discovered.add(id);
    for (const id of progress.interactedPoiIds) this.interacted.add(id);
    for (const id of progress.completedEncounterIds) this.completed.add(id);
    this.refreshUnlocks();
    this.events.splice(0);
    this.revision += 1;
  }

  private counterProgress(): Record<string, number> {
    const counters: Record<string, number> = {};
    for (const [id, amount] of this.counters) counters[id] = amount;
    return counters;
  }

  private refreshUnlocks(): void {
    let changed = false;
    for (const zone of this.zones) {
      const [kind, id] = zone.unlock.split(":");
      const condition = kind === "initial" || (kind === "discover" && this.discovered.has(id)) ||
        (kind === "interact" && this.interacted.has(id)) || (kind === "clear" && this.completed.has(id));
      if (!condition || (zone.minimumLevel ?? 1) > this.level || this.unlocked.has(zone.id)) continue;
      this.unlocked.add(zone.id);
      this.events.push({ type: "zone_unlocked", id: zone.id });
      changed = true;
      this.revision += 1;
    }
    if (changed) this.refreshLocks();
  }

  private validateResourceAmount(id: string, amount: number): void {
    if (!this.balances.has(id) || !Number.isSafeInteger(amount) || amount < 0) throw new Error(`Invalid resource amount: ${id}`);
  }

  private refreshLocks(): void {
    if (this.zoneMode === "overlay") {
      this.forEachCell(this.navigation.width, this.navigation.height, this.navigation.cellSize, (x, y) => this.navigation.setLocked({ x, y }, false));
      this.forEachCell(this.fog.width, this.fog.height, this.fog.cellSize, (x, y) => this.fog.setLocked(x, y, false));
      for (const zone of this.zones) {
        if (this.unlocked.has(zone.id)) continue;
        const mark = (width: number, height: number, size: number, setter: (x: number, y: number) => void) => {
          for (let y = Math.max(0, Math.floor(zone.rect.y / size)); y < Math.min(height, Math.ceil((zone.rect.y + zone.rect.height) / size)); y++) {
            for (let x = Math.max(0, Math.floor(zone.rect.x / size)); x < Math.min(width, Math.ceil((zone.rect.x + zone.rect.width) / size)); x++) {
              if (!zone.polygon || polygonIntersectsRect(zone.polygon, { x: x * size, y: y * size, width: size, height: size })) setter(x, y);
            }
          }
        };
        mark(this.navigation.width, this.navigation.height, this.navigation.cellSize, (x, y) => this.navigation.setLocked({ x, y }, true));
        mark(this.fog.width, this.fog.height, this.fog.cellSize, (x, y) => this.fog.setLocked(x, y, true));
      }
      return;
    }
    this.forEachCell(this.navigation.width, this.navigation.height, this.navigation.cellSize,
      (x, y, rect) => this.navigation.setLocked({ x, y }, !this.isAreaUnlocked(rect)));
    this.forEachCell(this.fog.width, this.fog.height, this.fog.cellSize,
      (x, y, rect) => this.fog.setLocked(x, y, !this.isAreaUnlocked(rect)));
  }

  private isAreaUnlocked(rect: WorldRect): boolean {
    const area = overlapArea(this.bounds, rect);
    if (area < rect.width * rect.height) return false;
    if (this.zones.length === 0) return true;
    let covered = 0;
    for (const zone of this.zones) {
      const overlap = overlapArea(zone.rect, rect);
      if (overlap > 0 && !this.unlocked.has(zone.id)) return false;
      covered += overlap;
    }
    return covered >= area;
  }

  private intersectsObstacle(cell: WorldRect, obstacle: WorldObstacle): boolean {
    if (obstacle.shape === "rect") {
      return overlapArea(cell, { x: obstacle.x - obstacle.width / 2, y: obstacle.y - obstacle.height / 2,
        width: obstacle.width, height: obstacle.height }) > 0;
    }
    const x = Math.max(cell.x, Math.min(cell.x + cell.width, obstacle.x));
    const y = Math.max(cell.y, Math.min(cell.y + cell.height, obstacle.y));
    return (x - obstacle.x) ** 2 + (y - obstacle.y) ** 2 < obstacle.radius ** 2;
  }

  private forEachCell(width: number, height: number, size: number, visit: (x: number, y: number, rect: WorldRect) => void): void {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) visit(x, y, { x: x * size, y: y * size, width: size, height: size });
    }
  }
}
