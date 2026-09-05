import type { Actor } from "../actor/Actor";
import type { DemoActorConfig, DemoSpawnConfig } from "../demo/DemoSession";
import type { GameWorld } from "./GameWorld";
import type { WorldMap } from "./WorldMap";

export interface SpawnSnapshot {
  readonly id: string;
  readonly status: "pending" | "spawned" | "cleared";
  readonly spawnedIds: readonly string[];
  readonly generation: number;
  readonly respawnIn: number | null;
}

interface SpawnState { status: SpawnSnapshot["status"]; spawnedIds: string[]; generation: number; respawnAt?: number; }

export class SpawnDirector {
  private readonly states = new Map<string, SpawnState>();
  private readonly ownerSpawns = new Map<string, string>();
  private readonly deadSince = new Map<string, number>();
  private nextSummonId = 1;
  private readonly world: GameWorld;
  private readonly map: WorldMap;
  private readonly spawns: readonly DemoSpawnConfig[];
  private readonly templates: ReadonlyMap<string, DemoActorConfig>;
  private readonly create: (config: DemoActorConfig) => Actor;

  constructor(world: GameWorld, map: WorldMap, spawns: readonly DemoSpawnConfig[], templates: ReadonlyMap<string, DemoActorConfig>,
    create: (config: DemoActorConfig) => Actor) {
    this.world = world;
    this.map = map;
    this.spawns = spawns;
    this.templates = templates;
    this.create = create;
    for (const spawn of spawns) {
      if (spawn.respawn && !(spawn.respawnDelay > 0)) throw new Error(`Respawning spawn ${spawn.id} requires respawnDelay`);
      this.states.set(spawn.id, { status: "pending", spawnedIds: [], generation: 0 });
    }
  }

  beforeTick(): void {
    const leader = this.world.leader;
    if (!leader) return;
    for (const spawn of this.spawns) {
      const state = this.states.get(spawn.id)!;
      if (state.status === "cleared" && state.respawnAt !== undefined && this.world.elapsedSeconds >= state.respawnAt) {
        state.status = "pending";
        state.spawnedIds = [];
        state.generation += 1;
        state.respawnAt = undefined;
      }
      if (state.status !== "pending" || !this.map.isPositionUnlocked(spawn) || (spawn.zoneId && !this.map.isZoneUnlocked(spawn.zoneId))) continue;
      if (leader.position.distance(spawn) > spawn.triggerRadius) continue;
      const template = this.templates.get(spawn.enemyId)!;
      for (let index = 0; index < spawn.count; index += 1) {
        const suffix = state.generation === 0 ? "" : `@${state.generation}`;
        const id = `${spawn.id}${suffix}:${index + 1}`;
        this.spawnActor(template, id, spawn.x, spawn.y, spawn.spawnRadius);
        state.spawnedIds.push(id);
        this.ownerSpawns.set(id, spawn.id);
      }
      state.status = "spawned";
    }
  }

  afterTick(): void {
    for (const request of this.world.combat.drainSummons()) {
      const source = this.world.allActors.find((actor) => actor.id === request.sourceId && actor.alive);
      if (!source) continue;
      const template = this.templates.get(request.enemyId);
      if (!template) throw new Error(`Missing summon template ${request.enemyId}`);
      const active = this.world.allActors.filter((actor) => actor.alive && actor.summonerId === source.id).length;
      for (let index = 0; index < Math.min(request.count, request.limit - active); index += 1) {
        const id = `${source.id}:summon:${this.nextSummonId++}`;
        this.spawnActor({ ...template, team: source.faction, summonerId: source.id,
          kind: source.faction === "player" ? "summon" : template.kind }, id, request.position.x, request.position.y, request.radius);
        const spawnId = this.ownerSpawns.get(source.id);
        if (spawnId) { this.states.get(spawnId)!.spawnedIds.push(id); this.ownerSpawns.set(id, spawnId); }
      }
    }
    for (const actor of [...this.world.enemies, ...this.world.alliedSummons]) {
      const ownerGone = actor.summonerId && !this.world.allActors.some((owner) => owner.id === actor.summonerId && owner.alive);
      if (!actor.alive && !this.deadSince.has(actor.id)) this.deadSince.set(actor.id, this.world.elapsedSeconds);
      if (ownerGone || (this.deadSince.has(actor.id) && this.world.elapsedSeconds - this.deadSince.get(actor.id)! >= 1.5)) {
        this.world.removeEnemy(actor.id);
        this.ownerSpawns.delete(actor.id);
        this.deadSince.delete(actor.id);
      }
    }
    for (const spawn of this.spawns) {
      const state = this.states.get(spawn.id)!;
      if (state.status === "spawned" && state.spawnedIds.every((id) => !this.world.allActors.some((actor) => actor.id === id && actor.alive))) {
        state.status = "cleared";
        if (spawn.respawn) state.respawnAt = this.world.elapsedSeconds + spawn.respawnDelay!;
      }
    }
    const encounters = new Set(this.spawns.map((spawn) => spawn.encounterId).filter((id): id is string => Boolean(id)));
    for (const id of encounters) {
      if (this.spawns.filter((spawn) => spawn.encounterId === id).every((spawn) => this.states.get(spawn.id)!.status === "cleared")) this.map.completeEncounter(id);
    }
  }

  hasBlockingEncounter(): boolean {
    const leader = this.world.leader;
    if (!leader) return false;
    return this.spawns.some((spawn) => spawn.encounterId && this.states.get(spawn.id)!.status === "spawned" &&
      this.states.get(spawn.id)!.spawnedIds.some((id) => this.world.enemies.some((actor) => actor.id === id && actor.alive &&
        leader.position.distance(actor.position) <= Math.max(leader.stats.aggroRange, actor.stats.aggroRange))));
  }

  snapshot(): SpawnSnapshot[] {
    return this.spawns.map((spawn) => {
      const state = this.states.get(spawn.id)!;
      return { id: spawn.id, status: state.status, spawnedIds: [...state.spawnedIds], generation: state.generation,
        respawnIn: state.respawnAt === undefined ? null : Math.max(0, state.respawnAt - this.world.elapsedSeconds) };
    });
  }

  private spawnActor(template: DemoActorConfig, id: string, x: number, y: number, radius: number): void {
    const angle = this.world.random.next() * Math.PI * 2;
    const distance = Math.sqrt(this.world.random.next()) * radius;
    const position = this.world.options.navigation.nearestWalkable({ x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance });
    if (!position) throw new Error(`No walkable ground for ${id}`);
    const actor = this.create({ ...template, id, x: position.x, y: position.y });
    if (actor.faction === "player") this.world.alliedSummons.push(actor);
    else this.world.addEnemy(actor, template.phaseThresholds);
  }
}
