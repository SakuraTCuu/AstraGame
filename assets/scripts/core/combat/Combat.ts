import type { Actor } from "../actor/Actor";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";
import { SeededRandom } from "../random/SeededRandom";
import type { DamageType, SkillAction, SkillConditions, SkillMotion } from "./SkillEffects";

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
  readonly type?: "damage" | "heal" | "telegraph_damage" | "shield" | "summon" | "buff";
  readonly telegraph?: number;
  readonly windup?: number;
  readonly recovery?: number;
  readonly maxTargets?: number;
  readonly area?: SkillArea;
  readonly duration?: number;
  readonly projectileSpeed?: number;
  readonly projectileLifetime?: number;
  readonly projectileHoming?: boolean;
  readonly summonEnemyId?: string;
  readonly summonRadius?: number;
  readonly summonLimit?: number;
  readonly priority?: number;
  readonly minimumPhase?: number;
  readonly actions?: readonly SkillAction[];
  readonly castDuration?: number;
  readonly targetCount?: number;
  readonly category?: "normal" | "skill" | "ultimate";
  readonly publicCooldown?: number;
  readonly publicCooldownGroup?: string;
  readonly energyCost?: number;
  readonly blockEnergyGain?: boolean;
  readonly conditions?: SkillConditions;
  readonly linkedCooldowns?: readonly { readonly id: string; readonly duration: number }[];
  readonly motion?: SkillMotion;
  readonly damageType?: DamageType;
  readonly forceCritical?: boolean;
  readonly areaAnchor?: "caster" | "target";
}

export interface CombatEvent {
  readonly type: "damage" | "heal" | "death" | "skill" | "telegraph" | "shield" | "absorb" | "summon" | "cast_cancelled" | "projectile" | "miss" | "status";
  readonly sourceId: string;
  readonly targetId: string;
  readonly value?: number;
  readonly skillId?: string;
  readonly x?: number;
  readonly y?: number;
  readonly critical?: boolean;
  readonly damageType?: DamageType;
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
  actionIndex: number;
  readonly primaryIds: readonly string[];
  readonly speed: number;
}

interface Projectile { readonly cast: Cast; readonly expiresAt: number; position: Vector2; lastUpdate: number; impactAt?: number; impactCast?: Cast; actionIndex: number; }
export interface SummonRequest { readonly sourceId: string; readonly enemyId: string; readonly count: number; readonly limit: number; readonly radius: number; readonly position: Vec2Like; }
export interface CastSnapshot { readonly id: number; readonly sourceId: string; readonly skillId: string; readonly phase: "windup" | "active" | "recovery"; readonly remaining: number; readonly duration: number; readonly origin: Vec2Like; readonly point: Vec2Like; readonly area?: SkillArea; readonly elevation?: number; readonly playbackRate?: number; }
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
    (skill.type !== "heal" || actor.health / actor.stats.maxHealth < (skill.conditions?.targetHpBelow ?? 1)));
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
  private nextProjectileId = 1;
  private readonly publicCooldowns = new Map<string, number>();
  private readonly combatTimes = new Map<string, number>();
  private readonly random: () => number;
  private move: ((actor: Actor, destination: Vec2Like, kind: SkillMotion["kind"]) => void) | undefined;
  readonly events: CombatEvent[] = [];

  constructor(random?: () => number) { const fallback = new SeededRandom(1); this.random = random ?? (() => fallback.next()); }

  updateCooldowns(deltaSeconds: number): void {
    for (const [key, remaining] of this.cooldowns) {
      const next = remaining - deltaSeconds;
      if (next <= 1e-9) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }
    for (const [key, remaining] of this.publicCooldowns) {
      if (remaining <= deltaSeconds + 1e-9) this.publicCooldowns.delete(key);
      else this.publicCooldowns.set(key, remaining - deltaSeconds);
    }
  }

  update(deltaSeconds: number, actors: readonly Actor[], move?: (actor: Actor, destination: Vec2Like, kind: SkillMotion["kind"]) => void): void {
    this.actors = actors;
    this.move = move;
    this.time += deltaSeconds;
    this.updateCooldowns(deltaSeconds);
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    for (const id of this.combatTimes.keys()) if (!byId.has(id)) this.combatTimes.delete(id);
    for (const actor of actors) {
      actor.updateEffects(deltaSeconds);
      const target = actor.targetId && byId.get(actor.targetId);
      if (actor.alive && target && target.alive && target.faction !== actor.faction && actor.fsm.state !== "returning") this.combatTimes.set(actor.id, (this.combatTimes.get(actor.id) ?? 0) + deltaSeconds);
      else this.combatTimes.delete(actor.id);
    }
    for (const [id, cast] of this.casts) {
      if (!cast.source.alive || cast.source.fsm.state === "returning") { this.cancelCaster(id); continue; }
      if (cast.skill.motion && this.time >= cast.hitAt) this.updateMotion(cast);
      if (!cast.resolved && this.time + 1e-9 >= cast.hitAt) this.launch(cast);
      if (cast.resolved && cast.skill.actions && !cast.skill.projectileSpeed) this.advanceActions(cast);
      if (this.time + 1e-9 >= cast.readyAt) {
        this.casts.delete(id);
        if (cast.source.alive) cast.source.setState("idle");
      }
    }
    for (const [id, projectile] of this.projectiles) {
      const target = actors.find((actor) => actor.id === projectile.cast.targetId && actor.alive);
      if (projectile.impactAt === undefined) {
        if ((!target && (!projectile.cast.skill.area || projectile.cast.skill.projectileHoming)) || this.time >= projectile.expiresAt) { this.projectiles.delete(id); continue; }
        const travel = (this.time - projectile.lastUpdate) * projectile.cast.skill.projectileSpeed!;
        projectile.lastUpdate = this.time;
        const destination = projectile.cast.skill.projectileHoming || !projectile.cast.skill.area ? target!.position : projectile.cast.point;
        projectile.position = projectile.position.moveTowards(destination, Math.max(0, travel));
        if (projectile.position.distance(destination) > 1e-6) continue;
        projectile.impactAt = this.time;
        projectile.impactCast = { ...projectile.cast, point: destination };
      }
      const actions = projectile.cast.skill.actions;
      if (!actions) { this.resolveHit(projectile.impactCast!, true); this.projectiles.delete(id); continue; }
      while (projectile.actionIndex < actions.length && projectile.impactAt! + actions[projectile.actionIndex].at / projectile.cast.speed <= this.time + 1e-9) this.resolveHit(projectile.impactCast!, true, actions[projectile.actionIndex++]);
      if (projectile.actionIndex >= actions.length) this.projectiles.delete(id);
    }
  }

  isBusy(actor: Actor): boolean { return this.casts.has(actor.id); }
  isWindingUp(actor: Actor): boolean { const cast = this.casts.get(actor.id); return Boolean(cast && !cast.resolved); }
  cooldownRemaining(actor: Actor, skill: SkillDefinition): number { return this.cooldowns.get(this.cooldownKey(actor, skill)) ?? 0; }
  canUse(actor: Actor, skill: SkillDefinition): boolean {
    if (skill.type === "summon" && this.actors.filter((candidate) => candidate.alive && candidate.summonerId === actor.id).length >= (skill.summonLimit ?? skill.maxTargets ?? 1)) return false;
    const condition = skill.conditions;
    if ((skill.energyCost ?? 0) > actor.energy || this.publicCooldowns.has(this.publicKey(actor, skill))) return false;
    if (condition?.requiredState && !actor.hasStatus(condition.requiredState)) return false;
    if (condition?.casterHpAtMost !== undefined && actor.health / actor.stats.maxHealth > condition.casterHpAtMost) return false;
    if (condition?.combatTimeAtLeast && (this.combatTimes.get(actor.id) ?? 0) < condition.combatTimeAtLeast) return false;
    if (condition?.inCombat && !actor.targetId && !this.actors.some((other) => other.alive && other.faction !== actor.faction && actor.position.distance(other.position) <= actor.stats.aggroRange)) return false;
    return actor.alive && actor.fsm.state !== "returning" && !this.isBusy(actor) && this.cooldownRemaining(actor, skill) === 0;
  }

  use(actor: Actor, target: Actor, skill: SkillDefinition, candidates: readonly Actor[] = this.actors): boolean {
    this.actors = [...new Map([...candidates, actor, target].map((entry) => [entry.id, entry])).values()];
    if (!this.canUse(actor, skill) || !target.alive || actor.position.distance(target.position) > skill.range) return false;
    if (skill.target === "enemy" ? actor.faction === target.faction : actor.faction !== target.faction) return false;
    if (skill.target === "self" && target !== actor) return false;
    const speed = Math.max(0.1, 1 + actor.modifier("attackSpeedRate") + (skill.category === "normal" ? actor.modifier("normalAttackSpeedRate") : 0));
    const windup = (skill.windup ?? (skill.type === "telegraph_damage" ? skill.telegraph ?? 0 : 0)) / speed;
    const primary = this.primaryTargets(actor, target, skill);
    const end = Math.max(skill.castDuration ?? 0, (skill.windup ?? 0) + (skill.recovery ?? 0), ...(skill.actions ?? []).map((action) => action.at));
    const cast: Cast = {
      id: this.nextCastId++, source: actor, targetId: target.id, skill,
      origin: actor.position, point: target.position, startedAt: this.time,
      hitAt: this.time + windup, readyAt: this.time + (skill.actions || skill.castDuration ? end / speed : windup + (skill.recovery ?? 0)), resolved: false,
      actionIndex: 0, primaryIds: primary.map((actor) => actor.id), speed,
    };
    this.cooldowns.set(this.cooldownKey(actor, skill), skill.cooldown);
    if (skill.publicCooldown) this.publicCooldowns.set(this.publicKey(actor, skill), skill.publicCooldown);
    for (const linked of skill.linkedCooldowns ?? []) this.cooldowns.set(`${actor.id}:${linked.id}`, linked.duration);
    actor.gainEnergy(-(skill.energyCost ?? 0));
    if (!skill.blockEnergyGain && !skill.energyCost) actor.gainEnergy(actor.stats.energyOnSkill ?? 0);
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
    if (!cast.resolved || cast.actionIndex < (cast.skill.actions?.length ?? 0)) this.events.push({ type: "cast_cancelled", sourceId: id, targetId: cast.targetId, skillId: cast.skill.id });
    if (cast.source.alive && cast.source.fsm.state !== "returning") cast.source.setState("idle");
  }

  castSnapshots(): CastSnapshot[] {
    return [...this.casts.values()].map((cast) => ({
      id: cast.id, sourceId: cast.source.id, skillId: cast.skill.id,
      phase: !cast.resolved ? "windup" : cast.actionIndex < (cast.skill.actions?.length ?? 0) && !cast.skill.projectileSpeed ? "active" : "recovery",
      remaining: Math.max(0, (cast.resolved ? cast.readyAt : cast.hitAt) - this.time),
      duration: cast.resolved ? cast.readyAt - cast.hitAt : cast.hitAt - cast.startedAt,
      origin: cast.origin, point: cast.point, area: cast.skill.area,
      playbackRate: cast.speed,
      elevation: cast.skill.motion?.kind === "jump" ? Math.sin(Math.PI * Math.max(0, Math.min(1, (this.time - cast.hitAt) * cast.speed / cast.skill.motion.duration))) * (cast.skill.motion.height ?? 160) : 0,
    }));
  }

  projectileSnapshots(): ProjectileSnapshot[] {
    return [...this.projectiles.values()].filter((projectile) => projectile.impactAt === undefined).map(({ cast, position }) => ({
      id: cast.id, sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id, x: position.x, y: position.y,
    }));
  }

  drainEvents(): CombatEvent[] { return this.events.splice(0); }
  drainSummons(): SummonRequest[] { return this.summons.splice(0); }

  resetEngagement(): void {
    this.casts.clear(); this.projectiles.clear(); this.summons.splice(0);
    this.cooldowns.clear(); this.publicCooldowns.clear(); this.combatTimes.clear(); this.events.splice(0);
    this.actors = []; this.move = undefined;
  }

  private launch(cast: Cast): void {
    cast.resolved = true;
    if (cast.skill.projectileSpeed && cast.skill.projectileSpeed > 0) {
      for (const id of cast.primaryIds) {
        const target = this.actors.find((actor) => actor.id === id);
        if (!target) continue;
        const projectileCast = { ...cast, targetId: id, primaryIds: [id], point: target.position };
        this.projectiles.set(this.nextProjectileId++, { cast: projectileCast, position: cast.origin, lastUpdate: cast.hitAt, actionIndex: 0,
          expiresAt: cast.hitAt + (cast.skill.projectileLifetime ?? Math.max(1, cast.skill.range / cast.skill.projectileSpeed * 3)) });
        this.events.push({ type: "projectile", sourceId: cast.source.id, targetId: id, skillId: cast.skill.id });
      }
    } else if (cast.skill.actions) this.advanceActions(cast);
    else this.resolveHit(cast, false);
    if (cast.source.alive) cast.source.setState(cast.readyAt > this.time ? "recovering" : "attacking");
  }

  private resolveHit(cast: Cast, projectile: boolean, action?: SkillAction): void {
    const { source, skill } = cast;
    if (skill.type === "summon") {
      if (!source.alive || !skill.summonEnemyId) return;
      this.summons.push({ sourceId: source.id, enemyId: skill.summonEnemyId, count: skill.maxTargets ?? 1, limit: skill.summonLimit ?? skill.maxTargets ?? 1,
        radius: skill.summonRadius ?? 0, position: source.position });
      this.events.push({ type: "summon", sourceId: source.id, targetId: source.id, value: skill.maxTargets ?? 1, skillId: skill.id });
      return;
    }
    const targets = action?.recipient === "self" ? [source] : action?.recipient === "enemies" ?
      this.actors.filter((actor) => actor.alive && actor.faction !== source.faction && source.position.distance(actor.position) <= skill.range)
        .sort((a, b) => source.position.distanceSquared(a.position) - source.position.distanceSquared(b.position) || a.id.localeCompare(b.id)).slice(0, action.targetCount ?? skill.targetCount ?? 1) : action?.recipient === "allies" ?
      this.actors.filter((actor) => actor.alive && actor.faction === source.faction && source.position.distance(actor.position) <= skill.range)
        .sort((a, b) => a.health / a.stats.maxHealth - b.health / b.stats.maxHealth || a.id.localeCompare(b.id)).slice(0, action.targetCount ?? 1) : this.hitTargets(cast, projectile);
    if (targets.length === 0) this.events.push({ type: "miss", sourceId: source.id, targetId: cast.targetId, skillId: skill.id });
    for (const target of targets) {
      if (!target.alive) continue;
      if (action?.type === "status") {
        if (action.status) { target.addStatus(action.status); this.events.push({ type: "status", sourceId: source.id, targetId: target.id, skillId: skill.id }); }
      } else if (skill.type === "shield" && !action) {
        const value = target.addShield(`${source.id}:${skill.id}`, source.attackPower * skill.power, skill.duration ?? 0);
        this.events.push({ type: "shield", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
      } else if (action?.type === "heal" || (!action && (skill.type === "heal" || (skill.target !== "enemy" && skill.type !== "damage")))) {
        const value = target.heal(source.attackPower * (action?.power ?? skill.power));
        this.events.push({ type: "heal", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
        if (action?.randomStatuses?.length) target.addStatus(action.randomStatuses[Math.min(action.randomStatuses.length - 1, Math.floor(this.random() * action.randomStatuses.length))]);
      } else {
        const previousShield = target.shield;
        const type = action?.damageType ?? skill.damageType ?? "physical";
        const chance = Math.max(0, Math.min(1, source.modifier("criticalChance")));
        const critical = Boolean(action?.forceCritical || skill.forceCritical || (chance > 0 && this.random() < chance));
        const multiplier = (1 + source.modifier("damageBonus")) * (1 + source.modifier("finalDamageBonus")) *
          (1 + source.modifier(type === "magic" ? "magicBonus" : "physicalBonus")) * (critical ? source.stats.criticalMultiplier ?? 1.5 : 1);
        const damage = target.receiveDamage(source.attackPower * (action?.power ?? skill.power) * multiplier, type);
        const absorbed = previousShield - target.shield;
        if (absorbed > 0) this.events.push({ type: "absorb", sourceId: source.id, targetId: target.id, value: absorbed, skillId: skill.id });
        this.events.push({ type: "damage", sourceId: source.id, targetId: target.id, value: damage, skillId: skill.id, critical, damageType: type });
        if (action?.healFromDamage && damage > 0) {
          const allies = this.actors.filter((actor) => actor.alive && actor.faction === source.faction);
          for (const ally of allies) { const value = ally.heal(damage * action.healFromDamage / allies.length); this.events.push({ type: "heal", sourceId: source.id, targetId: ally.id, value, skillId: skill.id }); }
        }
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
    const center = skill.areaAnchor === "caster" ? source.position : skill.target === "self" || area?.shape === "cone" || area?.shape === "line" ? cast.origin : cast.point;
    const forward = cast.point.subtract(cast.origin).normalized();
    const candidates = this.actors.filter((actor) => {
      if (!actor.alive || (skill.target === "enemy" ? actor.faction === source.faction : actor.faction !== source.faction)) return false;
      if (skill.targetCount && area?.shape === "circle" && area.radius <= 10) return cast.primaryIds.includes(actor.id) && (projectile || source.position.distance(actor.position) <= skill.range);
      if (!area) {
        if ((skill.maxTargets ?? 1) > 1 && skill.target === "ally") return source.position.distance(actor.position) <= skill.range;
        return actor.id === cast.targetId && (projectile || source.position.distance(actor.position) <= skill.range);
      }
      const delta = actor.position.subtract(center);
      const radius = actor.stats.collisionRadius ?? 0;
      if (area.shape === "circle") return delta.length() <= area.radius + radius;
      const along = delta.x * forward.x + delta.y * forward.y;
      const lineLength = skill.motion?.kind === "charge" ? Math.min(area.radius, source.position.distance(cast.origin)) : area.radius;
      if (area.shape === "line") return along >= -radius && along <= lineLength + radius &&
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
  private publicKey(actor: Actor, skill: SkillDefinition): string { return `${actor.id}:${skill.publicCooldownGroup ?? "shared"}`; }

  private primaryTargets(source: Actor, first: Actor, skill: SkillDefinition): Actor[] {
    if (!skill.targetCount || skill.target === "self") return [first];
    const pool = this.actors.filter((actor) => actor.alive && actor.faction === first.faction && source.position.distance(actor.position) <= skill.range &&
      (skill.type !== "heal" || actor.health / actor.stats.maxHealth < (skill.conditions?.targetHpBelow ?? 1)));
    pool.sort((a, b) => skill.targetRule === "lowest_hp" ? a.health / a.stats.maxHealth - b.health / b.stats.maxHealth || a.id.localeCompare(b.id) :
      source.position.distanceSquared(a.position) - source.position.distanceSquared(b.position) || a.id.localeCompare(b.id));
    return [first, ...pool.filter((actor) => actor !== first)].slice(0, skill.targetCount);
  }

  private advanceActions(cast: Cast): void {
    const actions = cast.skill.actions!;
    while (cast.actionIndex < actions.length && cast.startedAt + actions[cast.actionIndex].at / cast.speed <= this.time + 1e-9) {
      const action = actions[cast.actionIndex++];
      this.resolveHit(cast, false, action);
      if (!cast.source.alive) break;
    }
  }

  private updateMotion(cast: Cast): void {
    const motion = cast.skill.motion!;
    const fraction = Math.max(0, Math.min(1, (this.time - cast.hitAt) * cast.speed / motion.duration));
    const direction = cast.point.subtract(cast.origin).normalized();
    const destination = motion.kind === "charge" ? cast.origin.add(direction.scale((motion.distance ?? cast.skill.range) * fraction)) :
      cast.origin.add(cast.point.subtract(cast.origin).scale(fraction));
    if (this.move) this.move(cast.source, destination, motion.kind);
    else cast.source.position = destination;
  }
}
