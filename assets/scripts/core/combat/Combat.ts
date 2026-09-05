import type { Actor } from "../actor/Actor";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";

export interface SkillArea {
  readonly shape: "circle" | "cone" | "line";
  readonly radius: number;
  readonly angleDegrees?: number;
  readonly width?: number;
}

export interface SkillDefinition {
  readonly id: string;
  readonly range: number;
  readonly cooldown: number;
  readonly power: number;
  readonly target: "enemy" | "ally" | "self";
  readonly targetRule?: "nearest" | "lowest_hp" | "cluster";
  readonly type?: "damage" | "heal" | "telegraph_damage" | "shield" | "summon";
  readonly telegraph?: number;
  readonly windup?: number;
  readonly recovery?: number;
  readonly maxTargets?: number;
  readonly area?: SkillArea;
  readonly duration?: number;
  readonly projectileSpeed?: number;
  readonly projectileLifetime?: number;
  readonly summonEnemyId?: string;
  readonly summonRadius?: number;
  readonly summonLimit?: number;
  readonly priority?: number;
  readonly minimumPhase?: number;
}

export interface CombatEvent {
  readonly type: "damage" | "heal" | "death" | "skill" | "telegraph" | "shield" | "absorb" | "summon" | "cast_cancelled" | "projectile" | "miss";
  readonly sourceId: string;
  readonly targetId: string;
  readonly value?: number;
  readonly skillId?: string;
  readonly x?: number;
  readonly y?: number;
}

interface Cast {
  readonly id: number;
  readonly source: Actor;
  readonly targetId: string;
  readonly skill: SkillDefinition;
  readonly origin: Vector2;
  readonly point: Vector2;
  readonly startedAt: number;
  readonly hitAt: number;
  readonly readyAt: number;
  resolved: boolean;
}

interface Projectile { readonly cast: Cast; readonly expiresAt: number; position: Vector2; lastUpdate: number; }
export interface SummonRequest { readonly sourceId: string; readonly enemyId: string; readonly count: number; readonly limit: number; readonly radius: number; readonly position: Vec2Like; }
export interface CastSnapshot { readonly id: number; readonly sourceId: string; readonly skillId: string; readonly phase: "windup" | "recovery"; readonly remaining: number; readonly duration: number; readonly origin: Vec2Like; readonly point: Vec2Like; readonly area?: SkillArea; }
export interface ProjectileSnapshot { readonly id: number; readonly sourceId: string; readonly targetId: string; readonly skillId: string; readonly x: number; readonly y: number; }

export function selectNearestTarget(source: Actor, candidates: readonly Actor[], range: number): Actor | undefined {
  return candidates.filter((actor) => actor.alive && actor.id !== source.id && source.position.distance(actor.position) <= range)
    .sort((left, right) => source.position.distanceSquared(left.position) - source.position.distanceSquared(right.position) || left.id.localeCompare(right.id))[0];
}

export function selectSkillTarget(source: Actor, candidates: readonly Actor[], skill: SkillDefinition): Actor | undefined {
  if (skill.target === "self") return source;
  const eligible = candidates.filter((actor) => actor.alive &&
    (skill.target === "enemy" ? actor.faction !== source.faction : actor.faction === source.faction) &&
    source.position.distance(actor.position) <= skill.range &&
    (skill.type !== "heal" || actor.health < actor.stats.maxHealth));
  const clusterSize = (actor: Actor) => eligible.filter((candidate) => actor.position.distance(candidate.position) <= (skill.area?.radius ?? 0)).length;
  return eligible.sort((left, right) => {
    const rule = skill.targetRule === "lowest_hp" ? left.health / left.stats.maxHealth - right.health / right.stats.maxHealth :
      skill.targetRule === "cluster" ? clusterSize(right) - clusterSize(left) : 0;
    return rule || source.position.distanceSquared(left.position) - source.position.distanceSquared(right.position) || left.id.localeCompare(right.id);
  })[0];
}

export class CombatSystem {
  private readonly cooldowns = new Map<string, number>();
  private readonly casts = new Map<string, Cast>();
  private readonly projectiles = new Map<number, Projectile>();
  private readonly summons: SummonRequest[] = [];
  private actors: readonly Actor[] = [];
  private time = 0;
  private nextCastId = 1;
  readonly events: CombatEvent[] = [];

  updateCooldowns(deltaSeconds: number): void {
    for (const [key, remaining] of this.cooldowns) {
      const next = remaining - deltaSeconds;
      if (next <= 1e-9) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }
  }

  update(deltaSeconds: number, actors: readonly Actor[]): void {
    this.actors = actors;
    this.time += deltaSeconds;
    this.updateCooldowns(deltaSeconds);
    for (const actor of actors) actor.updateEffects(deltaSeconds);
    for (const [id, cast] of this.casts) {
      if (!cast.source.alive || cast.source.fsm.state === "returning") { this.cancelCaster(id); continue; }
      if (!cast.resolved && this.time + 1e-9 >= cast.hitAt) this.launch(cast);
      if (this.time + 1e-9 >= cast.readyAt) {
        this.casts.delete(id);
        if (cast.source.alive) cast.source.setState("idle");
      }
    }
    for (const [id, projectile] of this.projectiles) {
      const target = actors.find((actor) => actor.id === projectile.cast.targetId && actor.alive);
      if ((!target && !projectile.cast.skill.area) || this.time >= projectile.expiresAt) { this.projectiles.delete(id); continue; }
      const travel = (this.time - projectile.lastUpdate) * projectile.cast.skill.projectileSpeed!;
      projectile.lastUpdate = this.time;
      const destination = projectile.cast.skill.area ? projectile.cast.point : target!.position;
      projectile.position = projectile.position.moveTowards(destination, Math.max(0, travel));
      if (projectile.position.distance(destination) <= 1e-6) {
        this.projectiles.delete(id);
        this.resolveHit(projectile.cast, true);
      }
    }
  }

  isBusy(actor: Actor): boolean { return this.casts.has(actor.id); }
  isWindingUp(actor: Actor): boolean { const cast = this.casts.get(actor.id); return Boolean(cast && !cast.resolved); }
  cooldownRemaining(actor: Actor, skill: SkillDefinition): number { return this.cooldowns.get(this.cooldownKey(actor, skill)) ?? 0; }
  canUse(actor: Actor, skill: SkillDefinition): boolean {
    if (skill.type === "summon" && this.actors.filter((candidate) => candidate.alive && candidate.summonerId === actor.id).length >= (skill.summonLimit ?? skill.maxTargets ?? 1)) return false;
    return actor.alive && actor.fsm.state !== "returning" && !this.isBusy(actor) && this.cooldownRemaining(actor, skill) === 0;
  }

  use(actor: Actor, target: Actor, skill: SkillDefinition, candidates: readonly Actor[] = this.actors): boolean {
    if (!this.canUse(actor, skill) || !target.alive || actor.position.distance(target.position) > skill.range) return false;
    if (skill.target === "enemy" ? actor.faction === target.faction : actor.faction !== target.faction) return false;
    if (skill.target === "self" && target !== actor) return false;
    this.actors = [...new Map([...candidates, actor, target].map((entry) => [entry.id, entry])).values()];
    const windup = skill.windup ?? (skill.type === "telegraph_damage" ? skill.telegraph ?? 0 : 0);
    const cast: Cast = {
      id: this.nextCastId++, source: actor, targetId: target.id, skill,
      origin: actor.position, point: target.position, startedAt: this.time,
      hitAt: this.time + windup, readyAt: this.time + windup + (skill.recovery ?? 0), resolved: false,
    };
    this.cooldowns.set(this.cooldownKey(actor, skill), skill.cooldown);
    this.casts.set(actor.id, cast);
    this.events.push({ type: "skill", sourceId: actor.id, targetId: target.id, skillId: skill.id });
    if (windup > 0) {
      actor.setState("windup");
      this.events.push({ type: "telegraph", sourceId: actor.id, targetId: target.id, value: windup, skillId: skill.id, x: cast.point.x, y: cast.point.y });
    } else this.launch(cast);
    if (cast.readyAt <= this.time) this.casts.delete(actor.id);
    return true;
  }

  cancelCaster(id: string): void {
    const cast = this.casts.get(id);
    if (!cast) return;
    this.casts.delete(id);
    if (!cast.resolved) this.events.push({ type: "cast_cancelled", sourceId: id, targetId: cast.targetId, skillId: cast.skill.id });
    if (cast.source.alive && cast.source.fsm.state !== "returning") cast.source.setState("idle");
  }

  castSnapshots(): CastSnapshot[] {
    return [...this.casts.values()].map((cast) => ({
      id: cast.id, sourceId: cast.source.id, skillId: cast.skill.id,
      phase: cast.resolved ? "recovery" : "windup",
      remaining: Math.max(0, (cast.resolved ? cast.readyAt : cast.hitAt) - this.time),
      duration: cast.resolved ? cast.readyAt - cast.hitAt : cast.hitAt - cast.startedAt,
      origin: cast.origin, point: cast.point, area: cast.skill.area,
    }));
  }

  projectileSnapshots(): ProjectileSnapshot[] {
    return [...this.projectiles.values()].map(({ cast, position }) => ({
      id: cast.id, sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id, x: position.x, y: position.y,
    }));
  }

  drainEvents(): CombatEvent[] { return this.events.splice(0); }
  drainSummons(): SummonRequest[] { return this.summons.splice(0); }

  private launch(cast: Cast): void {
    cast.resolved = true;
    if (cast.skill.projectileSpeed && cast.skill.projectileSpeed > 0) {
      this.projectiles.set(cast.id, { cast, position: cast.origin, lastUpdate: cast.hitAt,
        expiresAt: cast.hitAt + (cast.skill.projectileLifetime ?? Math.max(1, cast.skill.range / cast.skill.projectileSpeed * 3)) });
      this.events.push({ type: "projectile", sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id });
    } else this.resolveHit(cast, false);
    if (cast.source.alive) cast.source.setState(cast.readyAt > this.time ? "recovering" : "attacking");
  }

  private resolveHit(cast: Cast, projectile: boolean): void {
    const { source, skill } = cast;
    if (skill.type === "summon") {
      if (!source.alive || !skill.summonEnemyId) return;
      this.summons.push({ sourceId: source.id, enemyId: skill.summonEnemyId, count: skill.maxTargets ?? 1, limit: skill.summonLimit ?? skill.maxTargets ?? 1,
        radius: skill.summonRadius ?? 0, position: source.position });
      this.events.push({ type: "summon", sourceId: source.id, targetId: source.id, value: skill.maxTargets ?? 1, skillId: skill.id });
      return;
    }
    const targets = this.hitTargets(cast, projectile);
    if (targets.length === 0) this.events.push({ type: "miss", sourceId: source.id, targetId: cast.targetId, skillId: skill.id });
    for (const target of targets) {
      if (!target.alive) continue;
      if (skill.type === "shield") {
        const value = target.addShield(`${source.id}:${skill.id}`, source.stats.attack * skill.power, skill.duration ?? 0);
        this.events.push({ type: "shield", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
      } else if (skill.type === "heal" || (skill.target !== "enemy" && skill.type !== "damage")) {
        const value = target.heal(source.stats.attack * skill.power);
        this.events.push({ type: "heal", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
      } else {
        const previousShield = target.shield;
        const damage = target.receiveDamage(source.stats.attack * skill.power);
        const absorbed = previousShield - target.shield;
        if (absorbed > 0) this.events.push({ type: "absorb", sourceId: source.id, targetId: target.id, value: absorbed, skillId: skill.id });
        this.events.push({ type: "damage", sourceId: source.id, targetId: target.id, value: damage, skillId: skill.id });
        if (!target.alive) {
          this.cancelCaster(target.id);
          this.events.push({ type: "death", sourceId: source.id, targetId: target.id, skillId: skill.id });
        }
      }
    }
  }

  private hitTargets(cast: Cast, projectile: boolean): Actor[] {
    const { source, skill } = cast;
    const area = skill.area;
    const center = skill.target === "self" || area?.shape === "cone" || area?.shape === "line" ? cast.origin : cast.point;
    const forward = cast.point.subtract(cast.origin).normalized();
    const candidates = this.actors.filter((actor) => {
      if (!actor.alive || (skill.target === "enemy" ? actor.faction === source.faction : actor.faction !== source.faction)) return false;
      if (!area) {
        if ((skill.maxTargets ?? 1) > 1 && skill.target === "ally") return source.position.distance(actor.position) <= skill.range;
        return actor.id === cast.targetId && (projectile || source.position.distance(actor.position) <= skill.range);
      }
      const delta = actor.position.subtract(center);
      const radius = actor.stats.collisionRadius ?? 0;
      if (area.shape === "circle") return delta.length() <= area.radius + radius;
      const along = delta.x * forward.x + delta.y * forward.y;
      if (area.shape === "line") return along >= -radius && along <= area.radius + radius &&
        Math.abs(delta.x * forward.y - delta.y * forward.x) <= (area.width ?? 0) / 2 + radius;
      return delta.length() <= area.radius + radius && (delta.lengthSquared() === 0 ||
        along / delta.length() >= Math.cos((area.angleDegrees ?? 90) * Math.PI / 360));
    });
    return candidates.sort((left, right) => {
      const health = skill.targetRule === "lowest_hp" ? left.health / left.stats.maxHealth - right.health / right.stats.maxHealth : 0;
      return health || left.position.distanceSquared(center) - right.position.distanceSquared(center) || left.id.localeCompare(right.id);
    }).slice(0, skill.maxTargets ?? 1);
  }

  private cooldownKey(actor: Actor, skill: SkillDefinition): string { return `${actor.id}:${skill.id}`; }
}
