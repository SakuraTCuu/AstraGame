import { Actor, applyMaxHealthModifier } from "../actor/Actor";
import type { ActorOptions, ActorStats, Faction } from "../actor/Actor";
import type { BossPhase } from "../ai/BossAI";
import type { AreaEffectSnapshot, CastSnapshot, CombatEvent, ProjectileSnapshot, SkillArea, SkillDefinition } from "../combat/Combat";
import type { StatModifiers, StatusDefinition } from "../combat/SkillEffects";
import { FogGrid } from "../fog/FogGrid";
import type { FogCellState } from "../fog/FogGrid";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";
import { GridNavigation } from "../navigation/GridNavigation";
import type { GridPoint } from "../navigation/GridNavigation";
import { GameWorld } from "../world/GameWorld";
import { WorldMap } from "../world/WorldMap";
import { SpawnDirector } from "../world/SpawnDirector";
import type { RespawnProgress, SpawnSnapshot } from "../world/SpawnDirector";
import type { ExplorationEvent, InteractionResult, MapProgress, WorldObstacle, WorldPoi, WorldProgression, WorldZone } from "../world/WorldMap";
import { ProgressionJournal } from "../world/ProgressionJournal";
import type { JournalConfig, ProgressReward, ClaimResult } from "../world/ProgressionJournal";
import { PartyDevelopment } from "../world/PartyDevelopment";
import type { DevelopmentConfig, DevelopmentSave, DevelopmentResult } from "../world/PartyDevelopment";
import { HeroRoster } from "../world/HeroRoster";
import type { RosterDefinition, RosterSave } from "../world/HeroRoster";
import { Recruitment } from "../world/Recruitment";
import type { RecruitmentConfig } from "../world/Recruitment";

export type DefeatReward = ProgressReward;

export interface DemoActorConfig {
  readonly id: string;
  readonly name?: string;
  readonly kind: string;
  readonly team?: Faction;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp?: number;
  readonly attack: number;
  readonly defense: number;
  readonly moveSpeed: number;
  readonly attackRange: number;
  readonly aggroRange: number;
  readonly tags?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly phaseThresholds?: readonly number[];
  readonly phaseNames?: readonly string[];
  readonly leashRange?: number;
  readonly collisionRadius?: number;
  readonly summonerId?: string;
  readonly healthBars?: number;
  readonly modifiers?: StatModifiers;
  readonly maxEnergy?: number;
  readonly energy?: number;
  readonly energyPerSecond?: number;
  readonly energyOnSkill?: number;
  readonly energyOnNormal?: number;
  readonly energyOnDamage?: number;
  readonly criticalMultiplier?: number;
  readonly defeatFlag?: string;
  readonly defeatCounters?: readonly string[];
  readonly defeatRewards?: readonly DefeatReward[];
  readonly firstDefeatRewards?: readonly DefeatReward[];
}

export interface DemoSpawnConfig {
  readonly id: string;
  readonly trigger: "distance" | "zone_unlocked";
  readonly x: number;
  readonly y: number;
  readonly triggerRadius: number;
  readonly enemyId: string;
  readonly count: number;
  readonly spawnRadius: number;
  readonly respawn?: boolean;
  readonly encounterId?: string;
  readonly zoneId?: string;
  readonly respawnDelay?: number;
}

export interface DemoConfig {
  readonly meta?: { readonly id: string; readonly schemaVersion: number };
  readonly seed: number;
  readonly journal?: JournalConfig;
  readonly development?: DevelopmentConfig;
  readonly roster?: RosterDefinition & { readonly actors: readonly DemoActorConfig[] };
  readonly recruitment?: RecruitmentConfig;
  readonly world: {
    readonly width: number;
    readonly height: number;
    readonly combatMode?: "pve" | "pvp";
    readonly cellSize?: number;
    readonly blocked?: readonly GridPoint[];
    readonly obstacles?: readonly WorldObstacle[];
    readonly pointsOfInterest?: readonly WorldPoi[];
    readonly navigation?: { readonly manualResumeDelay?: number };
    readonly zoneMode?: "partition" | "overlay";
    readonly progression?: WorldProgression;
  };
  readonly fog: {
    readonly cellSize?: number;
    readonly revealRadius: number;
    readonly unlockZones?: readonly WorldZone[];
  };
  readonly flashlight?: { readonly range: number; readonly outerAngleDeg: number };
  readonly squad: {
    readonly actors: readonly DemoActorConfig[];
    readonly formationOffsets?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    readonly followLeashDistance?: number;
  };
  readonly enemies: readonly DemoActorConfig[] | { readonly actors: readonly DemoActorConfig[] };
  readonly skills: {
    readonly player: DemoSkillConfig;
    readonly enemy: DemoSkillConfig;
    readonly definitions?: readonly DemoSkillDefinitionConfig[];
  };
  readonly spawns?: readonly DemoSpawnConfig[];
  readonly ticksPerSecond?: number;
  readonly session?: { readonly completionEncounterId?: string; readonly autoStopForCombat?: boolean; readonly persistExploration?: boolean;
    readonly recovery?: { readonly town: Vec2Like; readonly nearestPortal?: boolean } };
}

export interface ExplorationSave {
  readonly schema: 1;
  readonly configId: string;
  readonly configVersion: number;
  readonly map: MapProgress;
  readonly exploredCells: readonly number[];
  readonly party: readonly { readonly id: string; readonly x: number; readonly y: number; readonly hp: number; readonly energy?: number }[];
  readonly elapsedSeconds: number;
  readonly randomState: number;
  readonly clearedSpawns: readonly string[];
  readonly respawns?: readonly RespawnProgress[];
  readonly development?: DevelopmentSave;
  readonly recoveryPosition?: Vec2Like;
  readonly roster?: RosterSave;
}

export type RunState = "running" | "paused" | "recovering" | "won" | "failed";
export interface RunResult { readonly outcome: "won" | "failed"; readonly elapsedSeconds: number; readonly defeatedEnemies: number; }

export interface DemoSkillConfig {
  readonly id: string;
  readonly range: number;
  readonly cooldown: number;
  readonly power: number;
  readonly target: string;
}

export interface DemoSkillDefinitionConfig extends Partial<Omit<SkillDefinition, "type" | "power" | "target">> {
  readonly id: string;
  readonly type: string;
  readonly coefficient: number;
  readonly cooldown: number;
  readonly range: number;
  readonly target: string;
  readonly maxTargets?: number;
  readonly telegraph?: number;
  readonly windup?: number;
  readonly recovery?: number;
  readonly duration?: number;
  readonly area?: SkillArea;
  readonly projectileSpeed?: number;
  readonly projectileLifetime?: number;
  readonly summonEnemyId?: string;
  readonly summonRadius?: number;
  readonly summonLimit?: number;
  readonly priority?: number;
  readonly minimumPhase?: number;
}

export interface ActorSnapshot {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly team: Faction;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly healthBars: number;
  readonly state: string;
  readonly targetId?: string;
  readonly energy?: number;
  readonly maxEnergy?: number;
  readonly skillEnergy?: number;
  readonly statuses?: readonly { readonly id: string; readonly remaining: number }[];
  readonly controls?: ReturnType<Actor["controlSnapshots"]>;
  readonly elevation?: number;
}

export interface DemoSnapshot {
  readonly elapsedSeconds: number;
  readonly runState: RunState;
  readonly result: RunResult | null;
  readonly partyIds: readonly string[];
  readonly leaderId?: string;
  readonly actors: readonly ActorSnapshot[];
  readonly discoveredFogCells: ReadonlyArray<{ x: number; y: number }>;
  readonly fog: { readonly width: number; readonly height: number; readonly cellSize: number; readonly states: readonly FogCellState[] };
  readonly exploration: ReturnType<WorldMap["snapshot"]> & { readonly events: readonly ExplorationEvent[] };
  readonly journal: ReturnType<ProgressionJournal["snapshot"]>;
  readonly development: ReturnType<PartyDevelopment["snapshot"]> | null;
  readonly recovery: { readonly origin: Vec2Like; readonly town: Vec2Like; readonly portalId?: string; readonly portalName?: string } | null;
  readonly roster: ReturnType<HeroRoster["snapshot"]> | null;
  readonly recruitment: ReturnType<Recruitment["snapshot"]> | null;
  readonly flashlight: {
    readonly x: number;
    readonly y: number;
    readonly directionX: number;
    readonly directionY: number;
    readonly radius: number;
    readonly coneAngleDegrees: number;
  };
  readonly projectiles: readonly ProjectileSnapshot[];
  readonly areas: readonly AreaEffectSnapshot[];
  readonly casts: readonly CastSnapshot[];
  readonly effects: ReadonlyArray<{ readonly type: string; readonly sourceId: string; readonly targetId: string; readonly value?: number }>;
  readonly events: readonly CombatEvent[];
  readonly bossPhases: Readonly<Record<string, BossPhase>>;
  readonly autoNavigation: {
    readonly active: boolean;
    readonly mode: "idle" | "auto_path" | "manual" | "resume_wait" | "combat_hold" | "blocked";
    readonly destination: { readonly x: number; readonly y: number } | null;
    readonly remainingWaypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  };
  readonly spawns: readonly SpawnSnapshot[];
  readonly worldBounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

const DEFAULT_CONFIG: DemoConfig = {
  seed: 20260904,
  world: { width: 32, height: 48, cellSize: 1, blocked: [] },
  fog: { cellSize: 1, revealRadius: 5 },
  squad: {
    actors: [
      { id: "hero_1", kind: "leader", team: "player", x: 15, y: 4, hp: 140, attack: 24, defense: 4, moveSpeed: 4, attackRange: 2, aggroRange: 7 },
      { id: "hero_2", kind: "melee", team: "player", x: 14, y: 3, hp: 120, attack: 20, defense: 5, moveSpeed: 4, attackRange: 1.8, aggroRange: 7 },
      { id: "hero_3", kind: "ranged", team: "player", x: 16, y: 3, hp: 85, attack: 28, defense: 1, moveSpeed: 4, attackRange: 5, aggroRange: 8 },
      { id: "hero_4", kind: "support", team: "player", x: 15, y: 2, hp: 90, attack: 18, defense: 2, moveSpeed: 4, attackRange: 4, aggroRange: 8 },
    ],
  },
  enemies: [
    { id: "mob_1", kind: "mob", team: "enemy", x: 14, y: 14, hp: 60, attack: 10, defense: 1, moveSpeed: 2.4, attackRange: 1.5, aggroRange: 7 },
    { id: "mob_2", kind: "mob", team: "enemy", x: 18, y: 15, hp: 60, attack: 10, defense: 1, moveSpeed: 2.4, attackRange: 1.5, aggroRange: 7 },
    { id: "boss_1", kind: "boss", team: "enemy", x: 16, y: 30, hp: 500, attack: 22, defense: 5, moveSpeed: 1.8, attackRange: 2.2, aggroRange: 10, tags: ["boss"] },
  ],
  skills: {
    player: { id: "player_basic", range: 2, cooldown: 0.8, power: 1, target: "enemy" },
    enemy: { id: "enemy_basic", range: 1.5, cooldown: 1.2, power: 1, target: "enemy" },
  },
  ticksPerSecond: 20,
};

export class DemoSession {
  readonly world: GameWorld;
  readonly map: WorldMap;
  readonly spawns: SpawnDirector;
  readonly journal: ProgressionJournal;
  readonly development?: PartyDevelopment;
  readonly roster?: HeroRoster;
  readonly recruitment?: Recruitment;
  private readonly playerCatalog = new Map<string, Actor>();
  private readonly config: DemoConfig;
  private readonly fog: FogGrid;
  private readonly fixedStep: number;
  private accumulator = 0;
  private moveIntent = Vector2.ZERO;
  private flashlightDirection = new Vector2(0, 1);
  private frameEvents: CombatEvent[] = [];
  private explorationEvents: ExplorationEvent[] = [];
  private autoDestination: Vector2 | null = null;
  private questDestinationId: string | null = null;
  private resumeRemaining = 0;
  private navigationMode: DemoSnapshot["autoNavigation"]["mode"] = "idle";
  private readonly enemyTemplates = new Map<string, DemoActorConfig>();
  private state: RunState = "running";
  private result: RunResult | null = null;
  private recoveryPosition: Vector2 | null = null;
  private defeatedEnemies = 0;

  constructor(config: DemoConfig = DEFAULT_CONFIG) {
    this.config = config;
    const playerConfigs = config.roster?.actors ?? config.squad.actors;
    for (const entry of playerConfigs) {
      if (this.playerCatalog.has(entry.id)) throw new Error("Duplicate roster actor");
      this.playerCatalog.set(entry.id, this.createActor(entry, "player"));
    }
    const players = config.squad.actors.map((entry) => { const actor = this.playerCatalog.get(entry.id); if (!actor) throw new Error("Initial party actor is absent from the roster"); return actor; });
    const enemyConfigs = "actors" in config.enemies ? config.enemies.actors : config.enemies;
    for (const enemy of enemyConfigs) this.enemyTemplates.set(enemy.id, enemy);
    const enemies = config.spawns ? [] : enemyConfigs.map((entry) => this.createActor(entry, "enemy"));
    const cellSize = config.world.cellSize ?? 1;
    const navigation = new GridNavigation(
      Math.ceil(config.world.width / cellSize),
      Math.ceil(config.world.height / cellSize),
      config.world.blocked ?? [],
      cellSize,
    );
    this.fog = new FogGrid(
      Math.ceil(config.world.width / (config.fog.cellSize ?? cellSize)),
      Math.ceil(config.world.height / (config.fog.cellSize ?? cellSize)),
      config.fog.cellSize ?? cellSize,
    );
    this.map = new WorldMap(navigation, this.fog, { x: 0, y: 0, width: config.world.width, height: config.world.height },
      config.fog.unlockZones, config.world.pointsOfInterest, config.world.obstacles, config.world.progression, config.world.zoneMode);
    for (const enemy of enemyConfigs) for (const reward of [...(enemy.defeatRewards ?? []), ...(enemy.firstDefeatRewards ?? [])]) this.map.validateReward(reward);
    for (const player of players) {
      if (!navigation.isWorldWalkable(player.position)) throw new Error(`Player ${player.id} starts on blocked ground`);
    }
    const recovery = config.session?.recovery;
    if (recovery && (![recovery.town.x, recovery.town.y].every(Number.isFinite) || !navigation.isWorldWalkable(recovery.town))) throw new Error("Recovery town must be on unlocked walkable ground");
    const spawnIds = new Set<string>();
    for (const spawn of config.spawns ?? []) {
      if (spawnIds.has(spawn.id)) throw new Error(`Duplicate spawn ${spawn.id}`);
      spawnIds.add(spawn.id);
      if (!this.enemyTemplates.has(spawn.enemyId)) throw new Error(`Spawn ${spawn.id} references missing enemy template ${spawn.enemyId}`);
      if (spawn.trigger !== "distance" && spawn.trigger !== "zone_unlocked") throw new Error(`Invalid trigger for ${spawn.id}`);
      if (spawn.trigger === "zone_unlocked" && !spawn.zoneId) throw new Error(`Spawn ${spawn.id} requires zoneId`);
      if (spawn.zoneId && !(config.fog.unlockZones ?? []).some((zone) => zone.id === spawn.zoneId)) throw new Error(`Unknown spawn zone ${spawn.zoneId}`);
      if (!Number.isInteger(spawn.count) || spawn.count < 1) throw new Error(`Invalid spawn count for ${spawn.id}`);
    }
    for (const zone of config.fog.unlockZones ?? []) {
      if (zone.unlock.startsWith("clear:") && !(config.spawns ?? []).some((spawn) => spawn.encounterId === zone.unlock.slice(6))) {
        throw new Error(`Unknown unlock encounter for ${zone.id}`);
      }
    }
    const skillDefinitions: Record<string, SkillDefinition> = {};
    for (const definition of config.skills.definitions ?? []) {
      const normalized = this.normalizeDefinition(definition);
      if (skillDefinitions[normalized.id]) throw new Error(`Duplicate skill ${normalized.id}`);
      skillDefinitions[normalized.id] = normalized;
    }
    for (const actor of [...playerConfigs, ...enemyConfigs]) {
      for (const id of actor.skillIds ?? []) if (!skillDefinitions[id]) throw new Error(`Actor ${actor.id} references missing skill ${id}`);
    }
    for (const skill of Object.values(skillDefinitions)) for (const trigger of skill.onRelease ?? []) {
      if (!skillDefinitions[trigger.skillId] || skillDefinitions[trigger.skillId].motion || skillDefinitions[trigger.skillId].channelMove) throw new Error(`Invalid triggered skill reference ${trigger.skillId}`);
    }
    this.world = new GameWorld({
      combatMode: config.world.combatMode,
      seed: config.seed,
      navigation,
      fog: this.fog,
      players,
      enemies,
      playerSkill: this.normalizeSkill(config.skills.player),
      enemySkill: this.normalizeSkill(config.skills.enemy),
      skillDefinitions,
      revealRadius: config.fog.revealRadius,
      formationOffsets: config.squad.formationOffsets,
      followLeashDistance: config.squad.followLeashDistance,
    });
    const ticksPerSecond = config.ticksPerSecond ?? 20;
    if (ticksPerSecond <= 0) throw new RangeError("ticksPerSecond must be positive");
    this.fixedStep = 1 / ticksPerSecond;
    this.spawns = new SpawnDirector(this.world, this.map, config.spawns ?? [], this.enemyTemplates, (entry) => this.createActor(entry, "enemy"));
    this.journal = new ProgressionJournal(this.map, config.journal, () => this.world.random.next());
    this.roster = config.roster ? new HeroRoster([...this.playerCatalog.values()], this.map, config.roster) : undefined;
    this.development = config.development ? new PartyDevelopment([...this.playerCatalog.values()], this.map, config.development, () => this.world.random.next()) : undefined;
    if (this.roster) { this.world.setPlayers(this.roster.activeActors()); this.development?.setActiveRoster(this.roster.slots()); }
    this.recruitment = config.recruitment ? new Recruitment(this.map, config.recruitment, () => this.world.random.next()) : undefined;
    const leader = this.world.leader;
    if (leader) {
      this.map.discoverAt(leader.position);
      this.fog.reveal(leader.position, config.fog.revealRadius);
    }
  }

  static create(config?: DemoConfig): DemoSession {
    return new DemoSession(config);
  }

  get runState(): RunState { return this.state; }

  interactWithPoi(id: string): InteractionResult {
    const leader = this.world.leader;
    if (this.state !== "running" || !leader) return "unavailable";
    const result = this.map.interact(id, leader.position, () => this.world.random.next());
    if (result === "completed") this.syncProgression();
    if (result === "completed" && this.questDestinationId) this.navigateToQuest(this.questDestinationId);
    return result;
  }

  claimQuest(id: string): ClaimResult {
    if (this.state !== "running" && this.state !== "paused") return "unavailable";
    const result = this.journal.claim(id);
    if (result === "claimed") this.syncProgression();
    if (result === "claimed" && this.questDestinationId === id) this.questDestinationId = null;
    return result;
  }

  promoteRank(): ClaimResult {
    if (this.state !== "running" && this.state !== "paused") return "unavailable";
    const result = this.journal.promote();
    if (result === "claimed") this.syncProgression();
    return result;
  }

  equipItem(itemId: string, slotId: string): DevelopmentResult { return this.canDevelop() ? this.development!.equip(itemId, slotId) : "unavailable"; }
  unequipItem(slotId: string): DevelopmentResult { return this.canDevelop() ? this.development!.unequip(slotId) : "unavailable"; }
  upgradeHero(actorId: string): DevelopmentResult { return this.canDevelop() && (!this.roster || this.roster.owns(actorId)) ? this.development!.upgrade(actorId) : "unavailable"; }
  private canDevelop(): boolean { return Boolean(this.development && (this.state === "running" || this.state === "paused")); }

  setLineup(index: number, actorId: string | null): boolean {
    if (!this.roster || (this.state !== "running" && this.state !== "paused")) return false;
    const next = this.roster.planAssignment(index, actorId);
    if (!next) return false;
    const leader = this.world.leader;
    if (!leader) return false;
    const actors = next.filter((id): id is string => Boolean(id)).map((id) => this.roster!.actor(id)!);
    const placements = new Map<Actor, Vector2>();
    for (let index = 0; index < actors.length; index++) if (!this.world.players.includes(actors[index])) {
      const target = this.world.formation.slotPosition(index, leader.position, this.world.facingDirection);
      const position = this.world.options.navigation.nearestWalkable(target);
      if (!position || position.distance(target) > this.world.options.navigation.cellSize * 3) return false;
      placements.set(actors[index], position);
    }
    this.roster.assign(next); this.development?.setActiveRoster(next);
    for (const [actor, position] of placements) actor.position = position;
    this.world.setPlayers(actors);
    if (this.autoDestination) this.navigationMode = this.world.navigateTo(this.autoDestination) ? "auto_path" : "blocked";
    return true;
  }

  private syncProgression(): void { this.roster?.syncOwnership(); this.development?.syncInventory(); }

  recruit(poolId: string, count = 1): "completed" | "insufficient_resources" | "unavailable" {
    if (!this.recruitment || (this.state !== "running" && this.state !== "paused")) return "unavailable";
    const result = this.recruitment.draw(poolId, count);
    if (result === "completed") this.syncProgression();
    return result;
  }

  recoverParty(destination: "town" | "nearest_portal"): boolean {
    const recovery = this.config.session?.recovery;
    if (this.state !== "recovering" || !recovery || (destination !== "town" && destination !== "nearest_portal")) return false;
    const portal = destination === "nearest_portal" ? this.nearestRecoveryPortal() : undefined;
    if (destination === "nearest_portal" && !portal) return false;
    const target = portal ?? recovery.town;
    const navigation = this.world.options.navigation;
    const positions = this.world.players.map((_, index) => navigation.nearestWalkable(Vector2.from(target).add(this.config.squad.formationOffsets?.[index] ?? Vector2.ZERO)));
    if (positions.some((position, index) => !position || position.distance(Vector2.from(target).add(this.config.squad.formationOffsets?.[index] ?? Vector2.ZERO)) > navigation.cellSize * 3)) return false;
    this.world.recoverParty(positions as Vector2[]);
    this.state = "running"; this.result = null; this.recoveryPosition = null;
    this.frameEvents = []; this.accumulator = 0;
    this.autoDestination = null; this.questDestinationId = null; this.moveIntent = Vector2.ZERO; this.resumeRemaining = 0; this.navigationMode = "idle";
    this.map.recordProgressChange("party_recovered");
    this.map.discoverAt(this.world.leader!.position);
    return true;
  }

  private nearestRecoveryPortal(): WorldPoi | undefined {
    if (!this.config.session?.recovery?.nearestPortal || !this.recoveryPosition) return undefined;
    return this.map.pois.filter((poi) => this.map.isPortalActive(poi.id)).slice()
      .sort((a, b) => this.recoveryPosition!.distanceSquared(a) - this.recoveryPosition!.distanceSquared(b) || a.id.localeCompare(b.id))[0];
  }

  private enterRecovery(position: Vec2Like): void {
    if (this.state === "recovering") return;
    this.state = "recovering"; this.recoveryPosition = Vector2.from(position);
    this.world.clearTravel(); this.moveIntent = Vector2.ZERO; this.autoDestination = null; this.questDestinationId = null; this.resumeRemaining = 0; this.navigationMode = "idle";
    this.map.recordProgressChange("party_defeated");
  }

  navigateToQuest(id: string): boolean {
    const quest = this.journal.quests.find((entry) => entry.id === id);
    const leader = this.world.leader;
    if (!quest?.destination || !leader || this.state !== "running" || this.journal.state(quest) === "locked") return false;
    const poi = this.map.pois.find((entry) => entry.id === quest.destination?.poiId);
    const target = poi ?? quest.destination.position;
    if (!target) return false;
    let accepted = poi ? this.navigateToPoi(poi.id) : this.setAutoDestination(target.x, target.y);
    if (!accepted) {
      const path = this.world.options.navigation.findWorldPath(leader.position, target, true);
      for (const point of path) {
        const gate = this.map.blockingGateAt(point);
        if (gate) { accepted = this.navigateToPoi(gate); break; }
      }
    }
    if (accepted) this.questDestinationId = id;
    return accepted;
  }

  navigateToPoi(id: string): boolean {
    const poi = this.map.pois.find((entry) => entry.id === id);
    const leader = this.world.leader;
    if (!poi || !leader || this.state !== "running") return false;
    const radius = Math.max(this.world.options.navigation.cellSize, (poi.interaction?.radius ?? poi.discoverRadius) * 0.75);
    const candidates = [new Vector2(poi.x, poi.y)];
    for (let index = 0; index < 16; index++) candidates.push(new Vector2(poi.x + Math.cos(index * Math.PI / 8) * radius, poi.y + Math.sin(index * Math.PI / 8) * radius));
    candidates.sort((a, b) => a.distanceSquared(leader.position) - b.distanceSquared(leader.position));
    for (const point of candidates) if (this.world.options.navigation.isWorldWalkable(point) && this.setAutoDestination(point.x, point.y)) return true;
    return false;
  }

  teleportToPoi(id: string): boolean {
    if (this.state !== "running" || !this.world.leader || !this.map.isPortalActive(id)) return false;
    const poi = this.map.pois.find((entry) => entry.id === id)!;
    const navigation = this.world.options.navigation;
    const destination = navigation.nearestWalkable(poi);
    if (!destination || destination.distance(poi) > (poi.interaction?.radius ?? 200)) return false;
    const positions = this.world.players.map((player, index) => navigation.nearestWalkable(destination.add(this.config.squad.formationOffsets?.[index] ?? Vector2.ZERO)));
    if (positions.some((position) => !position)) return false;
    this.world.clearTravel();
    this.setAutoDestination(null, null);
    this.setMoveIntent(0, 0);
    this.world.players.forEach((player, index) => { if (player.alive) player.position = positions[index]!; });
    this.map.discoverAt(this.world.leader.position);
    this.fog.reveal(this.world.leader.position, this.config.fog.revealRadius);
    this.map.recordTeleport(id);
    return true;
  }

  saveExploration(): ExplorationSave {
    return { schema: 1, configId: this.config.meta?.id ?? "default", configVersion: this.config.meta?.schemaVersion ?? 1,
      map: this.map.saveProgress(), exploredCells: this.fog.exploredIndices(),
      party: this.world.players.map((actor) => ({ id: actor.id, x: actor.position.x, y: actor.position.y, hp: actor.persistentHealth, energy: actor.energy })),
      elapsedSeconds: this.world.elapsedSeconds, randomState: this.world.random.snapshot(), clearedSpawns: this.spawns.clearedPermanentIds(), respawns: this.spawns.respawnProgress(), development: this.development?.save(),
      recoveryPosition: this.recoveryPosition ?? undefined, roster: this.roster?.save() };
  }

  restoreExploration(save: ExplorationSave): void {
    if (save.schema !== 1 || save.configId !== (this.config.meta?.id ?? "default") || save.configVersion !== (this.config.meta?.schemaVersion ?? 1)) throw new Error("Saved exploration uses another configuration");
    if (this.world.elapsedSeconds !== 0 || !Number.isFinite(save.elapsedSeconds) || save.elapsedSeconds < 0 ||
        !Number.isInteger(save.randomState) || save.randomState <= 0 || save.randomState > 0xffffffff) throw new Error("Invalid exploration clock or random state");
    if (save.roster && !this.roster) throw new Error("Saved roster is not supported by this configuration");
    const roster = this.roster && (save.roster ?? this.roster.save());
    if (roster) this.roster!.validateSave(roster, this.map.savedConditionContext(save.map));
    const lineup = roster?.lineup ?? this.world.players.map((actor) => actor.id);
    const activeIds = lineup.filter((id): id is string => Boolean(id));
    if (save.party.length !== activeIds.length || new Set(save.party.map((entry) => entry.id)).size !== save.party.length || save.party.some((entry) => !activeIds.includes(entry.id))) throw new Error("Saved party does not match configuration");
    if (save.recoveryPosition && (!this.config.session?.recovery || ![save.recoveryPosition.x, save.recoveryPosition.y].every(Number.isFinite) ||
        save.recoveryPosition.x < 0 || save.recoveryPosition.y < 0 || save.recoveryPosition.x >= this.config.world.width || save.recoveryPosition.y >= this.config.world.height || save.party.some((actor) => actor.hp > 0))) throw new Error("Invalid saved recovery position");
    if (save.development && !this.development) throw new Error("Saved development is not supported by this configuration");
    const development = this.development && this.development.prepareSave(save.development ?? this.development.save());
    if (development) this.development!.validateSave(development, save.map.resources);
    for (const entry of save.party) {
      const actor = this.playerCatalog.get(entry.id);
      const stats = actor && (development ? this.development!.statsFor(actor.id, development, Math.max(this.map.rank, save.map.rank ?? 0), lineup) : actor.stats);
      if (!actor || ![entry.x, entry.y, entry.hp].every(Number.isFinite) || entry.hp < 0 || entry.hp > stats!.maxHealth ||
          entry.x < 0 || entry.y < 0 || entry.x >= this.config.world.width || entry.y >= this.config.world.height) throw new Error("Invalid saved party member");
      if (entry.energy !== undefined && (!Number.isFinite(entry.energy) || entry.energy < 0 || entry.energy > (stats!.maxEnergy ?? 0))) throw new Error("Invalid saved energy");
    }
    for (const entry of roster?.reserves ?? []) {
      const actor = this.playerCatalog.get(entry.id)!;
      const stats = development ? this.development!.statsFor(actor.id, development, Math.max(this.map.rank, save.map.rank ?? 0), lineup) : actor.stats;
      if (entry.hp > stats.maxHealth || entry.energy > (stats.maxEnergy ?? 0)) throw new Error("Invalid saved reserve vitals");
    }
    this.map.validateProgress(save.map);
    this.fog.validateProgress(save.exploredCells);
    this.spawns.validateProgress(save.clearedSpawns);
    this.spawns.validateRespawns(save.respawns ?? []);
    this.map.restoreProgress(save.map);
    this.development?.setActiveRoster(lineup);
    if (development) this.development!.restore(development);
    if (roster) this.roster!.restore(roster);
    this.spawns.restoreCleared(save.clearedSpawns);
    this.spawns.restoreRespawns(save.respawns ?? [], save.elapsedSeconds);
    this.fog.restore(save.exploredCells);
    for (const entry of save.party) {
      const actor = this.playerCatalog.get(entry.id)!;
      actor.position = this.world.options.navigation.nearestWalkable(entry) ?? actor.position;
      actor.health = entry.hp;
      actor.energy = entry.energy ?? 0;
      if (!actor.alive) actor.setState("dead");
    }
    this.world.setPlayers(activeIds.map((id) => this.playerCatalog.get(id)!));
    this.world.random.restore(save.randomState);
    this.syncProgression();
    this.world.elapsedSeconds = save.elapsedSeconds;
    const leader = this.world.leader;
    if (leader) this.fog.reveal(leader.position, this.config.fog.revealRadius);
    else if (this.config.session?.recovery) this.enterRecovery(save.recoveryPosition ?? save.party[save.party.length - 1]);
    else this.finish("failed");
  }

  pause(): boolean {
    if (this.state !== "running") return false;
    this.setMoveIntent(0, 0);
    this.state = "paused";
    return true;
  }

  resume(): boolean {
    if (this.state !== "paused") return false;
    this.state = "running";
    return true;
  }

  setMoveIntent(x: number, y: number): void {
    if (this.state !== "running") return;
    const wasMoving = this.moveIntent.lengthSquared() > 0;
    const intent = new Vector2(x, y);
    this.moveIntent = intent.lengthSquared() > 1 ? intent.normalized() : intent;
    if (this.moveIntent.lengthSquared() > 0) {
      const leader = this.world.leader;
      if (leader && this.world.combat.isWindingUp(leader)) this.world.combat.cancelCaster(leader.id);
      this.world.path.clear();
      this.flashlightDirection = this.moveIntent.normalized();
      this.world.setFacing(this.flashlightDirection);
      this.navigationMode = "manual";
    } else if (wasMoving) {
      this.resumeRemaining = this.autoDestination ? this.config.world.navigation?.manualResumeDelay ?? 0.65 : 0;
      this.navigationMode = this.autoDestination ? "resume_wait" : "idle";
    }
  }

  setAutoDestination(x: number | null, y: number | null): boolean {
    if (this.state !== "running") return false;
    this.questDestinationId = null;
    if (x === null || y === null) {
      this.world.path.clear();
      this.autoDestination = null;
      this.resumeRemaining = 0;
      if (this.moveIntent.lengthSquared() === 0) this.navigationMode = "idle";
      return true;
    }
    if (!this.world.navigateTo({ x, y })) return false;
    this.moveIntent = Vector2.ZERO;
    this.autoDestination = new Vector2(x, y);
    this.resumeRemaining = 0;
    this.navigationMode = "auto_path";
    const leader = this.world.leader;
    if (leader) {
      const direction = new Vector2(x, y).subtract(leader.position);
      if (direction.lengthSquared() > 0) this.flashlightDirection = direction.normalized();
    }
    return true;
  }

  update(deltaSeconds: number): number {
    this.frameEvents = [];
    this.explorationEvents = [];
    if (this.state !== "running" && this.state !== "recovering") return 0;
    this.accumulator += Math.max(0, deltaSeconds);
    let ticks = 0;
    while ((this.state === "running" || this.state === "recovering") && this.accumulator + Number.EPSILON >= this.fixedStep) {
      const leader = this.world.leader;
      if (leader?.canMove && this.moveIntent.lengthSquared() > 0) {
        leader.position = this.world.options.navigation.moveWithCollision(leader.position,
          this.moveIntent.scale(leader.movementSpeed * this.fixedStep));
      } else if (leader?.alive && this.navigationMode === "resume_wait") {
        this.resumeRemaining = Math.max(0, this.resumeRemaining - this.fixedStep);
        if (this.resumeRemaining <= 1e-9) {
          const resumed = this.autoDestination && this.world.navigateTo(this.autoDestination);
          this.navigationMode = resumed ? "auto_path" : "blocked";
        }
      }
      const hold = this.config.session?.autoStopForCombat && this.autoDestination && this.moveIntent.lengthSquared() === 0 && this.spawns.hasBlockingEncounter();
      if (hold && this.navigationMode === "auto_path") this.navigationMode = "combat_hold";
      if (!hold && this.navigationMode === "combat_hold") {
        this.navigationMode = this.autoDestination && this.world.navigateTo(this.autoDestination) ? "auto_path" : "blocked";
      }
      this.world.autoTravelPaused = this.navigationMode === "combat_hold";
      this.world.manualControlActive = this.moveIntent.lengthSquared() > 0;
      this.world.leaderTravelActive = this.moveIntent.lengthSquared() > 0 || (!this.world.path.complete && !this.world.autoTravelPaused);
      if (leader?.alive) this.map.discoverAt(leader.position);
      this.spawns.beforeTick();
      this.world.update(this.fixedStep);
      const currentLeader = this.world.leader;
      if (currentLeader) this.map.discoverAt(currentLeader.position);
      if (currentLeader) for (const poi of this.map.pois) if (poi.interaction?.auto && !this.map.isPoiInteracted(poi.id) &&
          currentLeader.position.distance(poi) <= poi.interaction.radius) this.interactWithPoi(poi.id);
      const enemyIds = new Set(this.world.enemies.map((actor) => actor.id));
      this.spawns.afterTick();
      const events = this.world.combat.drainEvents();
      for (const event of events) {
        if (event.type !== "death" || !enemyIds.has(event.targetId)) continue;
        const template = this.spawns.templateForActor(event.targetId) ?? this.enemyTemplates.get(event.targetId);
        if (template?.defeatFlag) { this.map.grantFlag(template.defeatFlag); this.map.incrementCounter(template.defeatFlag); }
        for (const counter of new Set(template?.defeatCounters ?? [])) this.map.incrementCounter(counter);
        if (template?.defeatRewards?.length) this.map.grantRewards(template.defeatRewards, () => this.world.random.next());
        if (template?.firstDefeatRewards?.length && !this.map.hasFlag(`first_drop:${template.id}`)) {
          this.map.grantRewards(template.firstDefeatRewards, () => this.world.random.next());
          this.map.grantFlag(`first_drop:${template.id}`);
        }
      }
      this.syncProgression();
      this.defeatedEnemies += events.filter((event) => event.type === "death" && enemyIds.has(event.targetId)).length;
      this.frameEvents.push(...events);
      this.explorationEvents.push(...this.map.drainEvents());
      if (leader?.id !== currentLeader?.id && currentLeader && this.autoDestination && this.moveIntent.lengthSquared() === 0) {
        this.navigationMode = this.world.navigateTo(this.autoDestination) ? "auto_path" : "blocked";
      }
      if (this.navigationMode === "auto_path" && this.world.path.complete) {
        this.navigationMode = "idle";
        this.autoDestination = null;
      }
      if (currentLeader) {
        this.flashlightDirection = this.world.facingDirection;
        const target = this.world.enemies.find((actor) => actor.id === currentLeader.targetId && actor.alive);
        if (target && this.moveIntent.lengthSquared() === 0) this.flashlightDirection = target.position.subtract(currentLeader.position).normalized();
      }
      if (!currentLeader && this.config.session?.recovery) this.enterRecovery(leader?.position ?? this.recoveryPosition ?? this.world.players[this.world.players.length - 1].position);
      else if (!currentLeader) this.finish("failed");
      else if (this.config.session?.completionEncounterId && this.map.isEncounterCompleted(this.config.session.completionEncounterId)) this.finish("won");
      this.accumulator -= this.fixedStep;
      ticks += 1;
    }
    return ticks;
  }

  getSnapshot(): DemoSnapshot {
    const actors = this.world.allActors.map((entry): ActorSnapshot => ({
      id: entry.id,
      name: entry.displayName,
      kind: entry.kind,
      team: entry.faction,
      x: entry.position.x,
      y: entry.position.y,
      hp: entry.health,
      maxHp: entry.stats.maxHealth,
      shield: entry.shield,
      healthBars: entry.healthBars,
      state: entry.fsm.state,
      targetId: entry.targetId,
      energy: entry.energy,
      skillEnergy: entry.skillEnergy,
      maxEnergy: entry.stats.maxEnergy ?? 0,
      statuses: entry.statusSnapshots(),
      controls: entry.controlSnapshots(),
      elevation: entry.controlElevation,
    }));
    const leader = this.world.leader;
    const bossPhases: Record<string, BossPhase> = {};
    for (const [id, ai] of this.world.bosses) bossPhases[id] = ai.phase;
    return {
      elapsedSeconds: this.world.elapsedSeconds,
      runState: this.state,
      result: this.result,
      partyIds: this.world.players.map((actor) => actor.id),
      leaderId: leader?.id,
      actors,
      discoveredFogCells: this.fog.discoveredCells(),
      fog: { width: this.fog.width, height: this.fog.height, cellSize: this.fog.cellSize, states: this.fog.states() },
      exploration: { ...this.map.snapshot(), events: [...this.explorationEvents] },
      journal: this.journal.snapshot(),
      development: this.development?.snapshot() ?? null,
      roster: this.roster?.snapshot((id) => this.development?.levelOf(id) ?? 1) ?? null,
      recruitment: this.recruitment?.snapshot() ?? null,
      recovery: this.state === "recovering" && this.config.session?.recovery ? { origin: this.recoveryPosition!, town: this.config.session.recovery.town,
        portalId: this.nearestRecoveryPortal()?.id, portalName: this.nearestRecoveryPortal()?.name } : null,
      flashlight: {
        x: leader?.position.x ?? this.recoveryPosition?.x ?? 0,
        y: leader?.position.y ?? this.recoveryPosition?.y ?? 0,
        directionX: this.flashlightDirection.x,
        directionY: this.flashlightDirection.y,
        radius: this.config.flashlight?.range ?? this.config.fog.revealRadius,
        coneAngleDegrees: this.config.flashlight?.outerAngleDeg ?? 70,
      },
      projectiles: this.world.combat.projectileSnapshots(),
      areas: this.world.combat.areaSnapshots(),
      casts: this.world.combat.castSnapshots(),
      effects: this.frameEvents.map((event) => ({ type: event.type, sourceId: event.sourceId, targetId: event.targetId, value: event.value })),
      events: [...this.frameEvents],
      bossPhases,
      autoNavigation: {
        active: !this.world.path.complete,
        mode: this.navigationMode,
        destination: this.autoDestination ? { x: this.autoDestination.x, y: this.autoDestination.y } : null,
        remainingWaypoints: this.world.path.remainingWaypoints().map((point) => ({ x: point.x, y: point.y })),
      },
      spawns: this.spawns.snapshot(),
      worldBounds: { minX: 0, minY: 0, maxX: this.config.world.width, maxY: this.config.world.height },
    };
  }

  private createActor(config: DemoActorConfig, fallbackTeam: Faction): Actor {
    const stats: ActorStats = {
      maxHealth: config.maxHp ?? config.hp,
      attack: config.attack,
      defense: config.defense,
      moveSpeed: config.moveSpeed,
      attackRange: config.attackRange,
      aggroRange: config.aggroRange,
      leashRange: config.leashRange,
      collisionRadius: config.collisionRadius,
      modifiers: config.modifiers,
      maxEnergy: config.maxEnergy,
      energyPerSecond: config.energyPerSecond,
      energyOnSkill: config.energyOnSkill,
      energyOnNormal: config.energyOnNormal,
      energyOnDamage: config.energyOnDamage,
      criticalMultiplier: config.criticalMultiplier,
    };
    const options: ActorOptions = {
      id: config.id,
      faction: config.team ?? fallbackTeam,
      position: { x: config.x, y: config.y },
      stats,
      tags: config.kind === "boss" ? [...(config.tags ?? []), "boss"] : config.tags,
      skillIds: config.skillIds,
      initialHealth: config.hp / stats.maxHealth * applyMaxHealthModifier(stats).maxHealth,
      summonerId: config.summonerId,
      kind: config.kind,
      name: config.name,
      healthBars: config.healthBars,
      initialEnergy: config.energy,
    };
    return new Actor(options);
  }

  private normalizeSkill(config: DemoSkillConfig): SkillDefinition {
    return {
      id: config.id,
      range: config.range,
      cooldown: config.cooldown,
      power: config.power,
      target: config.target.includes("enemy") || config.target.includes("hero") ? "enemy" : "ally",
    };
  }

  private normalizeDefinition(config: DemoSkillDefinitionConfig): SkillDefinition {
    const types = ["damage", "heal", "telegraph_damage", "shield", "summon", "buff"];
    if (!types.includes(config.type)) throw new Error(`Unknown skill type ${config.type}`);
    const targets = ["enemy", "ally", "self", "nearest_enemy", "nearest_hero", "nearest_ally", "lowest_hp_enemy", "lowest_hp_ally", "enemy_cluster", "hero_cluster", "ally_cluster"];
    if (!targets.includes(config.target)) throw new Error(`Unknown skill target ${config.target}`);
    if (![config.range, config.cooldown, config.coefficient].every((value) => Number.isFinite(value) && value >= 0)) throw new Error(`Invalid skill values for ${config.id}`);
    for (const value of [config.windup, config.recovery, config.telegraph, config.summonRadius]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid timing or radius for ${config.id}`);
    }
    for (const value of [config.maxTargets, config.minimumPhase, config.summonLimit]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`Invalid target or phase count for ${config.id}`);
    }
    for (const value of [config.projectileSpeed, config.projectileLifetime]) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`Invalid projectile for ${config.id}`);
    }
    if (config.directionalProjectile && (!(config.projectileSpeed > 0) || !(config.projectileLifetime > 0) || config.projectileHoming ||
        !Number.isFinite(config.directionalProjectile.radius) || config.directionalProjectile.radius < 0 || !Number.isSafeInteger(config.directionalProjectile.maxHits) || config.directionalProjectile.maxHits < 1 ||
        (config.directionalProjectile.repeatInterval !== undefined && (!Number.isFinite(config.directionalProjectile.repeatInterval) || config.directionalProjectile.repeatInterval <= 0)))) throw new Error(`Invalid directional projectile for ${config.id}`);
    if (config.type === "shield" && !(config.duration > 0)) throw new Error(`Shield ${config.id} requires a duration`);
    if (config.type === "summon" && !this.enemyTemplates.has(config.summonEnemyId)) throw new Error(`Summon ${config.id} references a missing template`);
    const areas = (config.actions ?? []).filter((action) => action.type === "area").map((action) => action.areaEffect!);
    for (const area of areas) {
      if (!area || !Number.isFinite(area.duration) || area.duration <= 0 || !Number.isFinite(area.interval) || area.interval <= 0 || !area.geometry || !area.effects?.length ||
          area.effects.some((action) => action.type === "area") || (area.hitsPerTarget !== undefined && (!Number.isSafeInteger(area.hitsPerTarget) || area.hitsPerTarget < 1)) ||
          (area.turnSpeedDegrees !== undefined && (!Number.isFinite(area.turnSpeedDegrees) || area.turnSpeedDegrees < 0)) ||
          (area.target !== undefined && !["enemy", "ally"].includes(area.target))) throw new Error(`Invalid persistent area for ${config.id}`);
      if ([area.maxTargets, area.pvpMaxTargets, area.maxTicks].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 1))) throw new Error(`Invalid persistent area limits for ${config.id}`);
      if (area.motion && (area.followCaster || area.turnSpeedDegrees || !["straight", "homing"].includes(area.motion.kind) || !Number.isFinite(area.motion.speed) || area.motion.speed <= 0)) throw new Error(`Invalid area motion for ${config.id}`);
      let previousPhase = 0;
      for (const phase of area.phases ?? []) {
        if (!Number.isSafeInteger(phase.throughTick) || phase.throughTick <= previousPhase || !phase.effects.length || phase.effects.some((effect) => effect.type === "area")) throw new Error(`Invalid persistent area phase for ${config.id}`);
        previousPhase = phase.throughTick;
      }
    }
    for (const area of [config.area, ...areas.map((area) => area.geometry), ...(config.warnings ?? []).map((warning) => warning.geometry)]) {
      if (area && (!Number.isFinite(area.radius) || area.radius <= 0 || !["circle", "cone", "line"].includes(area.shape))) throw new Error(`Invalid skill area ${config.id}`);
      if (area?.shape === "line" && !(area.width > 0)) throw new Error(`Line skill ${config.id} requires width`);
      if (area?.shape === "cone" && !(area.angleDegrees > 0 && area.angleDegrees <= 360)) throw new Error(`Cone skill ${config.id} requires angleDegrees`);
    }
    for (const warning of config.warnings ?? []) {
      if (![warning.start, warning.end, warning.distance ?? 0, warning.angleDegrees ?? 0].every(Number.isFinite) || warning.start < 0 || warning.end <= warning.start ||
          (warning.distance ?? 0) < 0 || !["caster", "target", "random_target", "home"].includes(warning.anchor) || !warning.geometry) throw new Error(`Invalid skill warning for ${config.id}`);
      if (warning.paths && (!warning.paths.length || warning.paths.some((path) => !path.from || !path.to || ![path.from.x, path.from.y, path.to.x, path.to.y].every(Number.isFinite) ||
          (path.from.x === path.to.x && path.from.y === path.to.y)))) throw new Error(`Invalid warning paths for ${config.id}`);
    }
    if (config.trackTargetFor !== undefined && (!Number.isFinite(config.trackTargetFor) || config.trackTargetFor < 0)) throw new Error(`Invalid aim tracking for ${config.id}`);
    if (config.channelMove && (config.motion || !Number.isFinite(config.channelMove.speed) || config.channelMove.speed <= 0 || !Number.isFinite(config.channelMove.start) || config.channelMove.start < 0)) throw new Error(`Invalid channel movement for ${config.id}`);
    for (const value of [config.castDuration, config.publicCooldown, config.energyCost]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid cast value for ${config.id}`);
    if (config.skillEnergyCost !== undefined && (!Number.isSafeInteger(config.skillEnergyCost) || config.skillEnergyCost < 0)) throw new Error(`Invalid skill-energy cost for ${config.id}`);
    if (config.healthCost && (!Number.isFinite(config.healthCost.fraction) || config.healthCost.fraction <= 0 || config.healthCost.fraction > 1 || !["maximum", "current"].includes(config.healthCost.basis))) throw new Error(`Invalid health cost for ${config.id}`);
    if (config.disabled !== undefined && typeof config.disabled !== "boolean") throw new Error(`Invalid disabled skill for ${config.id}`);
    if ([config.conditions?.skillEnergyAtLeast, config.conditions?.skillEnergyAtMost].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0)) ||
        (config.conditions?.skillEnergyAtLeast ?? 0) > (config.conditions?.skillEnergyAtMost ?? Infinity)) throw new Error(`Invalid skill-energy condition for ${config.id}`);
    if (config.targetCount !== undefined && (!Number.isInteger(config.targetCount) || config.targetCount < 1)) throw new Error(`Invalid primary target count for ${config.id}`);
    for (const trigger of config.onRelease ?? []) if (!trigger.skillId || !Number.isFinite(trigger.chance ?? 1) || (trigger.chance ?? 1) < 0 || (trigger.chance ?? 1) > 1) throw new Error(`Invalid skill trigger for ${config.id}`);
    const timelines = [config.actions ?? [], ...areas.map((area) => area.effects)];
    for (const area of areas) for (const phase of area.phases ?? []) timelines.push(phase.effects);
    for (const timeline of timelines) {
      let previous = -1;
      for (const action of timeline) {
        if (!Number.isFinite(action.at) || action.at < previous || !["damage", "heal", "status", "cleanse", "remove_state", "skill_energy", "area"].includes(action.type)) throw new Error(`Invalid skill timeline for ${config.id}`);
        if (action.at < 0 || (action.power !== undefined && (!Number.isFinite(action.power) || action.power < 0))) throw new Error(`Invalid skill action for ${config.id}`);
        if (action.warningIndex !== undefined && (!Number.isSafeInteger(action.warningIndex) || action.warningIndex < 0 || !config.warnings?.[action.warningIndex] ||
            action.at < config.warnings[action.warningIndex].end || (action.recipient && action.recipient !== "targets") || config.projectileSpeed)) throw new Error(`Invalid warning action for ${config.id}`);
        if (action.type === "remove_state" && (typeof action.stateId !== "string" || !action.stateId)) throw new Error(`Invalid state removal for ${config.id}`);
        if (action.type === "skill_energy" && (!action.skillEnergy || ![action.skillEnergy.minimum, action.skillEnergy.maximum, action.skillEnergy.cap ?? 0].every((value) => Number.isSafeInteger(value) && value >= 0) ||
            action.skillEnergy.minimum > action.skillEnergy.maximum)) throw new Error(`Invalid skill-energy gain for ${config.id}`);
        if (action.healFromDamage !== undefined && (action.type !== "damage" || !Number.isFinite(action.healFromDamage) || action.healFromDamage < 0)) throw new Error(`Invalid damage healing for ${config.id}`);
        if (action.healFromDamageRecipient !== undefined && !["self", "allies"].includes(action.healFromDamageRecipient)) throw new Error(`Invalid damage healing recipient for ${config.id}`);
        if (action.knockback && (action.type !== "damage" || ![action.knockback.distance, action.knockback.duration].every((value) => Number.isFinite(value) && value > 0))) throw new Error(`Invalid knockback for ${config.id}`);
        if (action.settleStatus && (!action.settleStatus.group || !Number.isFinite(action.settleStatus.seconds) || action.settleStatus.seconds <= 0)) throw new Error(`Invalid periodic settlement for ${config.id}`);
        if (action.powerPerStack && (!action.powerPerStack.group || !Number.isFinite(action.powerPerStack.amount))) throw new Error(`Invalid stacked damage for ${config.id}`);
        previous = action.at;
        if (action.cleanse && (!Number.isSafeInteger(action.cleanse.count) || action.cleanse.count < 1)) throw new Error(`Invalid cleanse for ${config.id}`);
        const bonusStatuses: StatusDefinition[] = [];
        for (const bonus of action.healingBonuses ?? []) {
          if (!Number.isFinite(bonus.powerBonus ?? 0) || !Number.isFinite(bonus.chance ?? 1) || (bonus.chance ?? 1) < 0 || (bonus.chance ?? 1) > 1) throw new Error(`Invalid healing bonus for ${config.id}`);
          for (const entry of bonus.statuses ?? []) { if (!Number.isSafeInteger(entry.weight) || entry.weight <= 0) throw new Error(`Invalid healing bonus weight for ${config.id}`); bonusStatuses.push(entry.status); }
        }
        for (const status of [...(action.randomStatuses ?? []), ...(action.status ? [action.status] : []), ...bonusStatuses]) {
          if (!status.id || !Number.isFinite(status.duration) || (!status.permanent && status.duration <= 0) || Object.values(status.modifiers ?? {}).some((value) => !Number.isFinite(value))) throw new Error(`Invalid status for ${config.id}`);
          if (!Number.isSafeInteger(status.maxStacks ?? 1) || (status.maxStacks ?? 1) < 1) throw new Error(`Invalid status stack limit for ${config.id}`);
          if (Object.entries(status.targetCountBonuses ?? {}).some(([id, count]) => !id || !Number.isSafeInteger(count))) throw new Error(`Invalid target count bonus for ${config.id}`);
          const controls = ["stun", "freeze", "root", "silence", "airborne", "fear"];
          if (status.blockedByStates?.some((state) => !state || typeof state !== "string")) throw new Error(`Invalid state exclusion for ${config.id}`);
          for (const state of status.states ?? []) {
            if (!state.id || !Number.isFinite(state.duration) || (state.duration <= 0 && state.duration !== -1) || (state.control && !controls.includes(state.control)) ||
                state.controlImmunity?.some((kind) => !controls.includes(kind))) throw new Error(`Invalid status state for ${config.id}`);
            if ([state.invulnerable, state.preventDeath, state.untargetable, state.healingBlocked].some((value) => value !== undefined && typeof value !== "boolean") ||
                (state.damageCap !== undefined && (!Number.isSafeInteger(state.damageCap) || state.damageCap < 0))) throw new Error(`Invalid defensive state for ${config.id}`);
            if (state.lift && (state.control !== "airborne" || ![state.lift.height, state.lift.rise, state.lift.fall].every((value) => Number.isFinite(value) && value > 0) ||
                state.duration < state.lift.rise + state.lift.fall - 1e-9)) throw new Error(`Invalid airborne motion for ${config.id}`);
            if (state.wander && (state.control !== "fear" || ![state.wander.speed, state.wander.turnInterval].every((value) => Number.isFinite(value) && value > 0))) throw new Error(`Invalid fear motion for ${config.id}`);
          }
          const periodic = status.periodicDamage;
          const energy = status.periodicSkillEnergy;
          if (energy && (!Number.isFinite(energy.interval) || energy.interval <= 0 || ![energy.amount, energy.cap].every((value) => Number.isSafeInteger(value) && value > 0))) throw new Error(`Invalid periodic skill energy for ${config.id}`);
          if (periodic && (![periodic.interval, periodic.power, periodic.intervalPerStack ?? 0].every(Number.isFinite) || periodic.interval <= 0 || periodic.power < 0 ||
              periodic.interval + Math.min(0, periodic.intervalPerStack ?? 0) * (status.maxStacks ?? 1) <= 0)) throw new Error(`Invalid periodic damage for ${config.id}`);
        }
      }
    }
    if (config.motion && (!(config.motion.duration > 0) || !["charge", "jump"].includes(config.motion.kind))) throw new Error(`Invalid skill motion for ${config.id}`);
    return {
      ...config,
      id: config.id,
      range: config.range,
      cooldown: config.cooldown,
      power: config.coefficient,
      target: config.target === "self" ? "self" : config.target.includes("ally") ? "ally" : "enemy",
      targetRule: config.target.includes("lowest_hp") ? "lowest_hp" : config.target.includes("cluster") ? "cluster" : "nearest",
      type: config.type as SkillDefinition["type"],
      telegraph: config.telegraph,
      maxTargets: config.maxTargets,
      windup: config.windup,
      recovery: config.recovery,
      duration: config.duration,
      area: config.area,
      projectileSpeed: config.projectileSpeed,
      projectileLifetime: config.projectileLifetime,
      summonEnemyId: config.summonEnemyId,
      summonRadius: config.summonRadius,
      summonLimit: config.summonLimit,
      priority: config.priority,
      minimumPhase: config.minimumPhase,
    };
  }

  private finish(outcome: RunResult["outcome"]): void {
    if (this.result) return;
    this.result = { outcome, elapsedSeconds: this.world.elapsedSeconds, defeatedEnemies: this.defeatedEnemies };
    this.state = outcome;
    this.world.path.clear();
    this.autoDestination = null;
    this.moveIntent = Vector2.ZERO;
    this.navigationMode = "idle";
  }
}

export function createDemoSession(config?: DemoConfig): DemoSession {
  return DemoSession.create(config);
}
