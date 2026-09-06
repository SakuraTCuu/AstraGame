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
export interface RespawnProgress { readonly id: string; readonly generation: number; readonly remaining: number; }

interface SpawnState { status: SpawnSnapshot["status"]; spawnedIds: string[]; generation: number; respawnAt?: number; }
interface SummonState { readonly ownerId: string; readonly expiresAt?: number; readonly removeWithOwner: boolean; readonly removeOnReturn: boolean; }

export class SpawnDirector {
  private readonly states = new Map<string, SpawnState>();
  private readonly ownerSpawns = new Map<string, string>();
  private readonly deadSince = new Map<string, number>();
  private readonly summonStates = new Map<string, SummonState>();
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
      const source = this.world.allActors.find((actor) => actor.id === request.sourceId);
      if (request.removeWithOwner && !source?.alive) continue;
      const template = this.templates.get(request.enemyId);
      if (!template) throw new Error(`Missing summon template ${request.enemyId}`);
      const active = this.world.allActors.filter((actor) => actor.alive && actor.summonerId === request.sourceId).length;
      const available = request.limit === undefined ? request.count : Math.max(0, request.limit - active);
      for (let index = 0; index < Math.min(request.count, available); index += 1) {
        const id = `${request.enemyId}:summon:${request.sourceId}:${this.nextSummonId++}`;
        const inherited = this.inheritTemplate(template, request.source);
        this.spawnActor({ ...inherited, team: request.source.faction, summonerId: request.sourceId,
          kind: request.source.faction === "player" ? "summon" : inherited.kind }, id, request.position.x, request.position.y, request.radius, true);
        this.summonStates.set(id, { ownerId: request.sourceId,
          expiresAt: request.expiresAfter === undefined ? undefined : this.world.elapsedSeconds + request.expiresAfter,
          removeWithOwner: request.removeWithOwner, removeOnReturn: Boolean(request.removeOnReturn) });
        const spawnId = this.ownerSpawns.get(request.sourceId);
        if (spawnId) { this.states.get(spawnId)!.spawnedIds.push(id); this.ownerSpawns.set(id, spawnId); }
      }
    }
    for (const actor of [...this.world.enemies, ...this.world.alliedSummons]) {
      const summonState = this.summonStates.get(actor.id);
      const ownerGone = actor.summonerId && (summonState?.removeWithOwner ?? true) && !this.world.allActors.some((entry) => entry.id === actor.summonerId && entry.alive);
      const returned = Boolean(summonState?.removeOnReturn && actor.fsm.state === "returning");
      const expired = summonState?.expiresAt !== undefined && this.world.elapsedSeconds + 1e-9 >= summonState.expiresAt;
      if (!actor.alive && !this.deadSince.has(actor.id)) this.deadSince.set(actor.id, this.world.elapsedSeconds);
      if (ownerGone || returned || expired || (this.deadSince.has(actor.id) && this.world.elapsedSeconds - this.deadSince.get(actor.id)! >= 1.5)) this.removeActor(actor.id);
    }
    this.pruneTracking();
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

  validateProgress(ids: readonly string[]): void {
    if (!Array.isArray(ids) || ids.some((id) => !this.spawns.some((spawn) => spawn.id === id && !spawn.respawn))) throw new Error("Invalid saved spawn progress");
  }

  restoreCleared(ids: readonly string[]): void {
    this.validateProgress(ids);
    for (const id of ids) this.states.get(id)!.status = "cleared";
  }

  clearedPermanentIds(): string[] { return this.spawns.filter((spawn) => !spawn.respawn && this.states.get(spawn.id)!.status === "cleared").map((spawn) => spawn.id); }

  respawnProgress(): RespawnProgress[] {
    return this.spawns.filter((spawn) => spawn.respawn && this.states.get(spawn.id)!.respawnAt !== undefined).map((spawn) => {
      const state = this.states.get(spawn.id)!;
      return { id: spawn.id, generation: state.generation, remaining: Math.max(0, state.respawnAt! - this.world.elapsedSeconds) };
    });
  }

  validateRespawns(entries: readonly RespawnProgress[]): void {
    if (!Array.isArray(entries) || new Set(entries.map((entry) => entry.id)).size !== entries.length || entries.some((entry) =>
      !this.spawns.some((spawn) => spawn.id === entry.id && spawn.respawn) || !Number.isInteger(entry.generation) || entry.generation < 0 || !Number.isFinite(entry.remaining) || entry.remaining < 0)) throw new Error("Invalid saved respawn timer");
  }

  restoreRespawns(entries: readonly RespawnProgress[], elapsedSeconds: number): void {
    this.validateRespawns(entries);
    for (const entry of entries) this.states.set(entry.id, { status: "cleared", spawnedIds: [], generation: entry.generation, respawnAt: elapsedSeconds + entry.remaining });
  }

  templateForActor(id: string): DemoActorConfig | undefined {
    if (this.world.allActors.find((actor) => actor.id === id)?.summonerId) return undefined;
    const spawnId = this.ownerSpawns.get(id);
    const spawn = this.spawns.find((entry) => entry.id === spawnId);
    return spawn && this.templates.get(spawn.enemyId);
  }

  clearSummons(): void {
    for (const actor of [...this.world.enemies, ...this.world.alliedSummons]) if (actor.summonerId) this.removeActor(actor.id);
    this.pruneTracking();
  }

  get trackedSummonCount(): number { return this.summonStates.size; }

  private inheritTemplate(template: DemoActorConfig, source: { readonly maxHealth: number; readonly attack: number; readonly defense: number }): DemoActorConfig {
    const inherit = template.summonInheritance;
    if (!inherit) return template;
    const hp = Math.max(1, Math.floor(source.maxHealth * inherit.maxHealth));
    return { ...template, hp, maxHp: hp, attack: Math.max(0, Math.floor(source.attack * inherit.attack)),
      defense: Math.max(0, Math.floor(source.defense * inherit.defense)) };
  }

  private removeActor(id: string): void {
    this.world.removeEnemy(id);
    this.ownerSpawns.delete(id);
    this.deadSince.delete(id);
    this.summonStates.delete(id);
    for (const state of this.states.values()) {
      const index = state.spawnedIds.indexOf(id);
      if (index >= 0) state.spawnedIds.splice(index, 1);
    }
  }

  private pruneTracking(): void {
    const liveIds = new Set(this.world.allActors.map((actor) => actor.id));
    for (const id of [...this.ownerSpawns.keys()]) if (!liveIds.has(id)) this.removeActor(id);
    for (const id of [...this.summonStates.keys()]) if (!liveIds.has(id)) this.removeActor(id);
    for (const id of [...this.deadSince.keys()]) if (!liveIds.has(id)) this.deadSince.delete(id);
  }

  private spawnActor(template: DemoActorConfig, id: string, x: number, y: number, radius: number, avoidActors = false): void {
    const angle = radius > 0 ? this.world.random.next() * Math.PI * 2 : 0;
    const distance = radius > 0 ? Math.sqrt(this.world.random.next()) * radius : 0;
    const desired = { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance };
    const position = avoidActors ? this.collisionSafePosition(desired, template.collisionRadius ?? 0) : this.world.options.navigation.nearestWalkable(desired);
    if (!position) throw new Error(`No walkable ground for ${id}`);
    const actor = this.create({ ...template, id, x: position.x, y: position.y });
    if (actor.faction === "player") this.world.alliedSummons.push(actor);
    else this.world.addEnemy(actor, template.phaseThresholds, template.phaseNames);
  }

  private collisionSafePosition(desired: { readonly x: number; readonly y: number }, radius: number) {
    const navigation = this.world.options.navigation;
    const candidates = [desired];
    const step = Math.max(navigation.cellSize, radius * 2, 1);
    for (let ring = 1; ring <= 16; ring++) for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      candidates.push({ x: desired.x + Math.cos(angle) * step * ring, y: desired.y + Math.sin(angle) * step * ring });
    }
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const position = navigation.nearestWalkable(candidate);
      if (!position) continue;
      const key = `${position.x}:${position.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.world.allActors.every((actor) => position.distance(actor.position) + 1e-9 >= radius + (actor.stats.collisionRadius ?? 0))) return position;
    }
    return undefined;
  }
}
