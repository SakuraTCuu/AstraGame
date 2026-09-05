import { Actor } from "../actor/Actor";
import type { ActorOptions, ActorStats, Faction } from "../actor/Actor";
import type { BossPhase } from "../ai/BossAI";
import type { CombatEvent, SkillDefinition } from "../combat/Combat";
import { FogGrid } from "../fog/FogGrid";
import { Vector2 } from "../math/Vector2";
import { GridNavigation } from "../navigation/GridNavigation";
import type { GridPoint } from "../navigation/GridNavigation";
import { GameWorld } from "../world/GameWorld";

export interface DemoActorConfig {
  readonly id: string;
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
}

export interface DemoConfig {
  readonly seed: number;
  readonly world: {
    readonly width: number;
    readonly height: number;
    readonly cellSize?: number;
    readonly blocked?: readonly GridPoint[];
  };
  readonly fog: {
    readonly cellSize?: number;
    readonly revealRadius: number;
  };
  readonly squad: {
    readonly actors: readonly DemoActorConfig[];
    readonly formationOffsets?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  };
  readonly enemies: readonly DemoActorConfig[] | { readonly actors: readonly DemoActorConfig[] };
  readonly skills: {
    readonly player: DemoSkillConfig;
    readonly enemy: DemoSkillConfig;
    readonly definitions?: readonly DemoSkillDefinitionConfig[];
  };
  readonly spawns?: readonly DemoSpawnConfig[];
  readonly ticksPerSecond?: number;
}

export interface DemoSkillConfig {
  readonly id: string;
  readonly range: number;
  readonly cooldown: number;
  readonly power: number;
  readonly target: string;
}

export interface DemoSkillDefinitionConfig {
  readonly id: string;
  readonly type: string;
  readonly coefficient: number;
  readonly cooldown: number;
  readonly range: number;
  readonly target: string;
  readonly maxTargets?: number;
  readonly telegraph?: number;
}

export interface ActorSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly team: Faction;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly state: string;
  readonly targetId?: string;
}

export interface DemoSnapshot {
  readonly elapsedSeconds: number;
  readonly actors: readonly ActorSnapshot[];
  readonly discoveredFogCells: ReadonlyArray<{ x: number; y: number }>;
  readonly fog: { readonly width: number; readonly height: number; readonly cellSize: number };
  readonly flashlight: {
    readonly x: number;
    readonly y: number;
    readonly directionX: number;
    readonly directionY: number;
    readonly radius: number;
    readonly coneAngleDegrees: number;
  };
  readonly projectiles: readonly never[];
  readonly effects: ReadonlyArray<{ readonly type: string; readonly sourceId: string; readonly targetId: string; readonly value?: number }>;
  readonly events: readonly CombatEvent[];
  readonly bossPhases: Readonly<Record<string, BossPhase>>;
  readonly autoNavigation: {
    readonly active: boolean;
    readonly remainingWaypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  };
  readonly spawns: ReadonlyArray<{
    readonly id: string;
    readonly status: "pending" | "spawned" | "cleared";
    readonly spawnedIds: readonly string[];
  }>;
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
  private readonly config: DemoConfig;
  private readonly fog: FogGrid;
  private readonly kinds = new Map<string, string>();
  private readonly fixedStep: number;
  private accumulator = 0;
  private moveIntent = Vector2.ZERO;
  private flashlightDirection = new Vector2(0, 1);
  private frameEvents: CombatEvent[] = [];
  private readonly enemyTemplates = new Map<string, DemoActorConfig>();
  private readonly spawnStates = new Map<string, { status: "pending" | "spawned" | "cleared"; spawnedIds: string[] }>();

  constructor(config: DemoConfig = DEFAULT_CONFIG) {
    this.config = config;
    const players = config.squad.actors.map((entry) => this.createActor(entry, "player"));
    const enemyConfigs = Array.isArray(config.enemies) ? config.enemies : config.enemies.actors;
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
    const skillDefinitions: Record<string, SkillDefinition> = {};
    for (const definition of config.skills.definitions ?? []) {
      const normalized = this.normalizeDefinition(definition);
      if (normalized) skillDefinitions[normalized.id] = normalized;
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
    });
    const ticksPerSecond = config.ticksPerSecond ?? 20;
    if (ticksPerSecond <= 0) throw new RangeError("ticksPerSecond must be positive");
    this.fixedStep = 1 / ticksPerSecond;
    for (const spawn of config.spawns ?? []) this.spawnStates.set(spawn.id, { status: "pending", spawnedIds: [] });
  }

  static create(config?: DemoConfig): DemoSession {
    return new DemoSession(config);
  }

  setMoveIntent(x: number, y: number): void {
    const intent = new Vector2(x, y);
    this.moveIntent = intent.lengthSquared() > 1 ? intent.normalized() : intent;
    if (this.moveIntent.lengthSquared() > 0) {
      this.world.path.clear();
      this.flashlightDirection = this.moveIntent.normalized();
    }
  }

  setAutoDestination(x: number | null, y: number | null): boolean {
    if (x === null || y === null) {
      this.world.path.clear();
      return true;
    }
    this.moveIntent = Vector2.ZERO;
    const leader = this.world.players[0];
    if (leader) {
      const direction = new Vector2(x, y).subtract(leader.position);
      if (direction.lengthSquared() > 0) this.flashlightDirection = direction.normalized();
    }
    return this.world.navigateTo({ x, y });
  }

  update(deltaSeconds: number): number {
    this.accumulator += Math.max(0, deltaSeconds);
    this.frameEvents = [];
    let ticks = 0;
    while (this.accumulator + Number.EPSILON >= this.fixedStep) {
      const leader = this.world.players[0];
      if (leader?.alive && this.moveIntent.lengthSquared() > 0) {
        const candidate = leader.position.add(this.moveIntent.scale(leader.stats.moveSpeed * this.fixedStep));
        const bounded = new Vector2(
          Math.max(0, Math.min(this.config.world.width, candidate.x)),
          Math.max(0, Math.min(this.config.world.height, candidate.y)),
        );
        if (this.world.options.navigation.isWorldWalkable(bounded)) leader.position = bounded;
      }
      this.world.leaderTravelActive = this.moveIntent.lengthSquared() > 0 || !this.world.path.complete;
      this.updateSpawns();
      this.world.update(this.fixedStep);
      this.updateClearedSpawns();
      this.frameEvents.push(...this.world.combat.drainEvents());
      this.accumulator -= this.fixedStep;
      ticks += 1;
    }
    return ticks;
  }

  getSnapshot(): DemoSnapshot {
    const actors = [...this.world.players, ...this.world.enemies].map((entry): ActorSnapshot => ({
      id: entry.id,
      kind: this.kinds.get(entry.id) ?? "actor",
      team: entry.faction,
      x: entry.position.x,
      y: entry.position.y,
      hp: entry.health,
      maxHp: entry.stats.maxHealth,
      state: entry.fsm.state,
      targetId: entry.targetId,
    }));
    const leader = this.world.players[0];
    const bossPhases: Record<string, BossPhase> = {};
    for (const [id, ai] of this.world.bosses) bossPhases[id] = ai.phase;
    return {
      elapsedSeconds: this.world.elapsedSeconds,
      actors,
      discoveredFogCells: this.fog.discoveredCells(),
      fog: { width: this.fog.width, height: this.fog.height, cellSize: this.fog.cellSize },
      flashlight: {
        x: leader?.position.x ?? 0,
        y: leader?.position.y ?? 0,
        directionX: this.flashlightDirection.x,
        directionY: this.flashlightDirection.y,
        radius: this.config.fog.revealRadius,
        coneAngleDegrees: 70,
      },
      projectiles: [],
      effects: this.frameEvents.map((event) => ({ type: event.type, sourceId: event.sourceId, targetId: event.targetId, value: event.value })),
      events: [...this.frameEvents],
      bossPhases,
      autoNavigation: {
        active: !this.world.path.complete,
        remainingWaypoints: this.world.path.remainingWaypoints().map((point) => ({ x: point.x, y: point.y })),
      },
      spawns: (this.config.spawns ?? []).map((spawn) => {
        const state = this.spawnStates.get(spawn.id)!;
        return { id: spawn.id, status: state.status, spawnedIds: [...state.spawnedIds] };
      }),
      worldBounds: { minX: 0, minY: 0, maxX: this.config.world.width, maxY: this.config.world.height },
    };
  }

  private createActor(config: DemoActorConfig, fallbackTeam: Faction): Actor {
    this.kinds.set(config.id, config.kind);
    const stats: ActorStats = {
      maxHealth: config.maxHp ?? config.hp,
      attack: config.attack,
      defense: config.defense,
      moveSpeed: config.moveSpeed,
      attackRange: config.attackRange,
      aggroRange: config.aggroRange,
    };
    const options: ActorOptions = {
      id: config.id,
      faction: config.team ?? fallbackTeam,
      position: { x: config.x, y: config.y },
      stats,
      tags: config.kind === "boss" ? [...(config.tags ?? []), "boss"] : config.tags,
      skillIds: config.skillIds,
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

  private normalizeDefinition(config: DemoSkillDefinitionConfig): SkillDefinition | undefined {
    if (config.type !== "damage" && config.type !== "heal" && config.type !== "telegraph_damage") return undefined;
    return {
      id: config.id,
      range: config.range,
      cooldown: config.cooldown,
      power: config.coefficient,
      target: config.target.includes("ally") || config.target === "self" ? "ally" : "enemy",
      type: config.type,
      telegraph: config.telegraph,
      maxTargets: config.maxTargets,
    };
  }

  private updateSpawns(): void {
    const leader = this.world.players[0];
    if (!leader?.alive) return;
    for (const spawn of this.config.spawns ?? []) {
      const state = this.spawnStates.get(spawn.id)!;
      if (state.status !== "pending") continue;
      if (leader.position.distance({ x: spawn.x, y: spawn.y }) > spawn.triggerRadius) continue;
      const template = this.enemyTemplates.get(spawn.enemyId);
      if (!template) throw new Error(`Spawn ${spawn.id} references missing enemy template ${spawn.enemyId}`);
      for (let index = 0; index < spawn.count; index += 1) {
        const angle = this.world.random.next() * Math.PI * 2;
        const radius = Math.sqrt(this.world.random.next()) * spawn.spawnRadius;
        const id = `${spawn.id}:${index + 1}`;
        const instance = this.createActor({
          ...template,
          id,
          x: spawn.x + Math.cos(angle) * radius,
          y: spawn.y + Math.sin(angle) * radius,
        }, "enemy");
        this.world.addEnemy(instance, template.phaseThresholds);
        state.spawnedIds.push(id);
      }
      state.status = "spawned";
    }
  }

  private updateClearedSpawns(): void {
    for (const state of this.spawnStates.values()) {
      if (state.status === "spawned" && state.spawnedIds.every((id) => !this.world.enemies.find((enemy) => enemy.id === id)?.alive)) {
        state.status = "cleared";
      }
    }
  }
}

export function createDemoSession(config?: DemoConfig): DemoSession {
  return DemoSession.create(config);
}
