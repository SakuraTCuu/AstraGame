import { Actor } from "../actor/Actor";
import type { ActorOptions, ActorStats, Faction } from "../actor/Actor";
import type { BossPhase } from "../ai/BossAI";
import type { CastSnapshot, CombatEvent, ProjectileSnapshot, SkillArea, SkillDefinition } from "../combat/Combat";
import type { StatModifiers } from "../combat/SkillEffects";
import { FogGrid } from "../fog/FogGrid";
import type { FogCellState } from "../fog/FogGrid";
import { Vector2 } from "../math/Vector2";
import { GridNavigation } from "../navigation/GridNavigation";
import type { GridPoint } from "../navigation/GridNavigation";
import { GameWorld } from "../world/GameWorld";
import { WorldMap } from "../world/WorldMap";
import { SpawnDirector } from "../world/SpawnDirector";
import type { RespawnProgress, SpawnSnapshot } from "../world/SpawnDirector";
import type { ExplorationEvent, InteractionResult, MapProgress, WorldObstacle, WorldPoi, WorldProgression, WorldZone } from "../world/WorldMap";

export type DefeatReward = { readonly amount: number; readonly chance?: number } & ({ readonly resource: string } | { readonly experience: true });

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
  readonly energyOnDamage?: number;
  readonly criticalMultiplier?: number;
  readonly defeatFlag?: string;
  readonly defeatRewards?: readonly DefeatReward[];
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
  readonly world: {
    readonly width: number;
    readonly height: number;
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
  readonly session?: { readonly completionEncounterId?: string; readonly autoStopForCombat?: boolean; readonly persistExploration?: boolean };
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
}

export type RunState = "running" | "paused" | "won" | "failed";
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
  readonly statuses?: readonly { readonly id: string; readonly remaining: number }[];
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
  readonly flashlight: {
    readonly x: number;
    readonly y: number;
    readonly directionX: number;
    readonly directionY: number;
    readonly radius: number;
    readonly coneAngleDegrees: number;
  };
  readonly projectiles: readonly ProjectileSnapshot[];
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
  private readonly config: DemoConfig;
  private readonly fog: FogGrid;
  private readonly fixedStep: number;
  private accumulator = 0;
  private moveIntent = Vector2.ZERO;
  private flashlightDirection = new Vector2(0, 1);
  private frameEvents: CombatEvent[] = [];
  private explorationEvents: ExplorationEvent[] = [];
  private autoDestination: Vector2 | null = null;
  private resumeRemaining = 0;
  private navigationMode: DemoSnapshot["autoNavigation"]["mode"] = "idle";
  private readonly enemyTemplates = new Map<string, DemoActorConfig>();
  private state: RunState = "running";
  private result: RunResult | null = null;
  private defeatedEnemies = 0;

  constructor(config: DemoConfig = DEFAULT_CONFIG) {
    this.config = config;
    const players = config.squad.actors.map((entry) => this.createActor(entry, "player"));
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
    for (const enemy of enemyConfigs) for (const reward of enemy.defeatRewards ?? []) {
      if (!Number.isSafeInteger(reward.amount) || reward.amount < 0 || !Number.isFinite(reward.chance ?? 1) ||
          (reward.chance ?? 1) < 0 || (reward.chance ?? 1) > 1 ||
          ("resource" in reward ? !config.world.progression?.resources[reward.resource] : !config.world.progression?.experienceLevels?.length)) throw new Error(`Invalid defeat reward for ${enemy.id}`);
    }
    for (const player of players) {
      if (!navigation.isWorldWalkable(player.position)) throw new Error(`Player ${player.id} starts on blocked ground`);
    }
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
    for (const actor of [...config.squad.actors, ...enemyConfigs]) {
      for (const id of actor.skillIds ?? []) if (!skillDefinitions[id]) throw new Error(`Actor ${actor.id} references missing skill ${id}`);
    }
    this.world = new GameWorld({
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
    return this.map.interact(id, leader.position);
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
      party: this.world.players.map((actor) => ({ id: actor.id, x: actor.position.x, y: actor.position.y, hp: actor.health, energy: actor.energy })),
      elapsedSeconds: this.world.elapsedSeconds, randomState: this.world.random.snapshot(), clearedSpawns: this.spawns.clearedPermanentIds(), respawns: this.spawns.respawnProgress() };
  }

  restoreExploration(save: ExplorationSave): void {
    if (save.schema !== 1 || save.configId !== (this.config.meta?.id ?? "default") || save.configVersion !== (this.config.meta?.schemaVersion ?? 1)) throw new Error("Saved exploration uses another configuration");
    if (this.world.elapsedSeconds !== 0 || !Number.isFinite(save.elapsedSeconds) || save.elapsedSeconds < 0 ||
        !Number.isInteger(save.randomState) || save.randomState <= 0 || save.randomState > 0xffffffff) throw new Error("Invalid exploration clock or random state");
    if (save.party.length !== this.world.players.length || new Set(save.party.map((entry) => entry.id)).size !== save.party.length) throw new Error("Saved party does not match configuration");
    for (const entry of save.party) {
      const actor = this.world.players.find((actor) => actor.id === entry.id);
      if (!actor || ![entry.x, entry.y, entry.hp].every(Number.isFinite) || entry.hp < 0 || entry.hp > actor.stats.maxHealth ||
          entry.x < 0 || entry.y < 0 || entry.x >= this.config.world.width || entry.y >= this.config.world.height) throw new Error("Invalid saved party member");
      if (entry.energy !== undefined && (!Number.isFinite(entry.energy) || entry.energy < 0 || entry.energy > (actor.stats.maxEnergy ?? 0))) throw new Error("Invalid saved energy");
    }
    this.map.validateProgress(save.map);
    this.fog.validateProgress(save.exploredCells);
    this.spawns.validateProgress(save.clearedSpawns);
    this.spawns.validateRespawns(save.respawns ?? []);
    this.map.restoreProgress(save.map);
    this.spawns.restoreCleared(save.clearedSpawns);
    this.spawns.restoreRespawns(save.respawns ?? [], save.elapsedSeconds);
    this.fog.restore(save.exploredCells);
    for (const entry of save.party) {
      const actor = this.world.players.find((actor) => actor.id === entry.id)!;
      actor.position = this.world.options.navigation.nearestWalkable(entry) ?? actor.position;
      actor.health = entry.hp;
      actor.energy = entry.energy ?? 0;
      if (!actor.alive) actor.setState("dead");
    }
    this.world.random.restore(save.randomState);
    this.world.elapsedSeconds = save.elapsedSeconds;
    const leader = this.world.leader;
    if (leader) this.fog.reveal(leader.position, this.config.fog.revealRadius);
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
    if (this.state !== "running") return 0;
    this.accumulator += Math.max(0, deltaSeconds);
    let ticks = 0;
    while (this.state === "running" && this.accumulator + Number.EPSILON >= this.fixedStep) {
      const leader = this.world.leader;
      if (leader?.alive && this.moveIntent.lengthSquared() > 0) {
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
      const enemyIds = new Set(this.world.enemies.map((actor) => actor.id));
      this.spawns.afterTick();
      const events = this.world.combat.drainEvents();
      for (const event of events) {
        if (event.type !== "death" || !enemyIds.has(event.targetId)) continue;
        const template = this.spawns.templateForActor(event.targetId) ?? this.enemyTemplates.get(event.targetId);
        if (template?.defeatFlag) { this.map.grantFlag(template.defeatFlag); this.map.incrementCounter(template.defeatFlag); }
        const grants: Record<string, number> = {};
        let experience = 0;
        for (const reward of template?.defeatRewards ?? []) if (this.world.random.next() < (reward.chance ?? 1)) {
          if ("resource" in reward) grants[reward.resource] = (grants[reward.resource] ?? 0) + reward.amount;
          else experience += reward.amount;
        }
        if (Object.keys(grants).length) this.map.grantResources(grants);
        if (experience) this.map.grantExperience(experience);
      }
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
      if (!currentLeader) this.finish("failed");
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
      maxEnergy: entry.stats.maxEnergy ?? 0,
      statuses: entry.statusSnapshots(),
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
      flashlight: {
        x: leader?.position.x ?? 0,
        y: leader?.position.y ?? 0,
        directionX: this.flashlightDirection.x,
        directionY: this.flashlightDirection.y,
        radius: this.config.flashlight?.range ?? this.config.fog.revealRadius,
        coneAngleDegrees: this.config.flashlight?.outerAngleDeg ?? 70,
      },
      projectiles: this.world.combat.projectileSnapshots(),
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
      initialHealth: config.hp,
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
    if (config.type === "shield" && !(config.duration > 0)) throw new Error(`Shield ${config.id} requires a duration`);
    if (config.type === "summon" && !this.enemyTemplates.has(config.summonEnemyId)) throw new Error(`Summon ${config.id} references a missing template`);
    if (config.area && (!Number.isFinite(config.area.radius) || config.area.radius <= 0 || !["circle", "cone", "line"].includes(config.area.shape))) throw new Error(`Invalid skill area ${config.id}`);
    if (config.area?.shape === "line" && !(config.area.width > 0)) throw new Error(`Line skill ${config.id} requires width`);
    if (config.area?.shape === "cone" && !(config.area.angleDegrees > 0 && config.area.angleDegrees <= 360)) throw new Error(`Cone skill ${config.id} requires angleDegrees`);
    for (const value of [config.castDuration, config.publicCooldown, config.energyCost]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid cast value for ${config.id}`);
    if (config.targetCount !== undefined && (!Number.isInteger(config.targetCount) || config.targetCount < 1)) throw new Error(`Invalid primary target count for ${config.id}`);
    let previous = -1;
    for (const action of config.actions ?? []) {
      if (!Number.isFinite(action.at) || action.at < previous || !["damage", "heal", "status"].includes(action.type)) throw new Error(`Invalid skill timeline for ${config.id}`);
      if (action.at < 0 || (action.power !== undefined && (!Number.isFinite(action.power) || action.power < 0))) throw new Error(`Invalid skill action for ${config.id}`);
      previous = action.at;
      for (const status of [...(action.randomStatuses ?? []), ...(action.status ? [action.status] : [])]) {
        if (!status.id || !Number.isFinite(status.duration) || status.duration <= 0 || Object.values(status.modifiers ?? {}).some((value) => !Number.isFinite(value))) throw new Error(`Invalid status for ${config.id}`);
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
