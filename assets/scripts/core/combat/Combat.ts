import type { Actor, CombatRole } from "../actor/Actor";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";
import { SeededRandom } from "../random/SeededRandom";
import type { AreaEffectDefinition, DamageType, SkillAction, SkillArea, SkillConditions, SkillMotion, SkillTrigger, SkillWarning, StatusDefinition } from "./SkillEffects";
export type { SkillArea } from "./SkillEffects";

export interface SkillDefinition {
  readonly id: string;
  readonly range: number;
  readonly cooldown: number;
  readonly power: number;
  readonly target: "enemy" | "ally" | "self";
  readonly targetRule?: "nearest" | "lowest_hp" | "cluster" | "random" | "role_priority" | "highest_attack";
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
  readonly directionalProjectile?: { readonly radius: number; readonly maxHits: number; readonly repeatInterval?: number };
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
  readonly skillEnergyCost?: number;
  readonly healthCost?: { readonly fraction: number; readonly basis: "maximum" | "current" };
  readonly disabled?: boolean;
  readonly trackTargetFor?: number;
  readonly channelMove?: { readonly speed: number; readonly start: number };
  readonly warnings?: readonly SkillWarning[];
  readonly blockEnergyGain?: boolean;
  readonly conditions?: SkillConditions;
  readonly maintainConditions?: SkillConditions;
  readonly completionState?: string;
  readonly returnHomeOnComplete?: boolean;
  readonly castCycles?: { readonly count: number; readonly interval: number };
  readonly linkedCooldowns?: readonly { readonly id: string; readonly duration: number }[];
  readonly motion?: SkillMotion;
  readonly damageType?: DamageType;
  readonly forceCritical?: boolean;
  readonly areaAnchor?: "caster" | "target";
  readonly group?: string;
  readonly onRelease?: readonly SkillTrigger[];
}

export interface CombatEvent {
  readonly type: "damage" | "heal" | "death" | "skill" | "telegraph" | "shield" | "absorb" | "summon" | "cast_cancelled" | "projectile" | "miss" | "status" | "cleanse" | "knockback" | "state_removed" | "resource_cost" | "skill_energy" | "area_created" | "shield_removed";
  readonly sourceId: string;
  readonly targetId: string;
  readonly value?: number;
  readonly skillId?: string;
  readonly x?: number;
  readonly y?: number;
  readonly critical?: boolean;
  readonly damageType?: DamageType;
  readonly periodic?: boolean;
  readonly statusId?: string;
  readonly triggered?: boolean;
  readonly immune?: boolean;
  readonly resource?: "health" | "energy" | "skill_energy";
}

interface Cast {
  readonly id: number;
  readonly source: Actor;
  readonly targetId: string;
  readonly skill: SkillDefinition;
  readonly origin: Vector2;
  point: Vector2;
  readonly direction?: Vector2;
  readonly warnings: readonly WarningPlacement[];
  readonly startedAt: number;
  readonly hitAt: number;
  readonly readyAt: number;
  resolved: boolean;
  actionIndex: number;
  readonly primaryIds: readonly string[];
  readonly speed: number;
  readonly energyAward: { readonly amount: number; awarded: boolean };
  readonly triggered: boolean;
  readonly triggerChain: readonly string[];
  readonly fromPlayer: boolean;
  readonly shieldBreakVersion: number;
}

interface WarningPlacement { readonly definition: SkillWarning; readonly anchorId: string; readonly offset: Vector2; readonly direction: Vector2; position: Vector2; }
export interface WarningSnapshot { readonly index: number; readonly position: Vec2Like; readonly direction: Vec2Like; readonly area: SkillArea; readonly remaining: number; readonly duration: number; }

interface Projectile { readonly cast: Cast; readonly expiresAt: number; position: Vector2; lastUpdate: number; impactAt?: number; impactCast?: Cast; actionIndex: number;
  directional?: { readonly direction: Vector2; readonly hits: Map<string, number>; remaining: number }; }
interface ProjectileImpact { readonly cast: Cast; readonly target: Actor; readonly at: number; readonly areaId?: number; actionIndex: number; }
interface AreaEffect { readonly id: number; readonly cast: Cast; readonly definition: AreaEffectDefinition; readonly startedAt: number; readonly expiresAt: number;
  readonly hits: Map<string, number>; nextTick: number; ticks: number; position: Vector2; direction: Vector2; lastUpdate: number; }
interface Displacement { readonly actor: Actor; readonly direction: Vector2; readonly distance: number; readonly duration: number; readonly startedAt: number; progress: number; }
type CombatMovement = SkillMotion["kind"] | "knockback" | "fear" | "channel";
export interface SummonRequest { readonly sourceId: string; readonly enemyId: string; readonly count: number; readonly limit: number; readonly radius: number; readonly position: Vec2Like; }
export interface CastSnapshot { readonly id: number; readonly sourceId: string; readonly targetId: string; readonly skillId: string; readonly phase: "windup" | "active" | "recovery"; readonly remaining: number; readonly duration: number; readonly origin: Vec2Like; readonly point: Vec2Like; readonly area?: SkillArea; readonly elevation?: number; readonly playbackRate?: number; readonly warnings?: readonly WarningSnapshot[]; readonly cycle?: number; }
export interface ProjectileSnapshot { readonly id: number; readonly sourceId: string; readonly targetId: string; readonly skillId: string; readonly x: number; readonly y: number;
  readonly age: number; readonly directionX: number; readonly directionY: number; readonly radius?: number; }
export interface AreaEffectSnapshot { readonly id: number; readonly sourceId: string; readonly skillId: string; readonly x: number; readonly y: number;
  readonly age: number; readonly remaining: number; readonly geometry: SkillArea; readonly directionX: number; readonly directionY: number; readonly effectKey?: string; readonly moving?: boolean; }

function circleContactInterval(from: Vector2, to: Vector2, center: Vector2, radius: number): [number, number] | undefined {
  const delta = to.subtract(from), offset = from.subtract(center), a = delta.lengthSquared();
  const c = offset.lengthSquared() - radius * radius;
  if (a < 1e-12) return c <= 1e-9 ? [0, 1] : undefined;
  const b = 2 * (offset.x * delta.x + offset.y * delta.y), discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9 * Math.max(1, b * b, Math.abs(4 * a * c))) return undefined;
  const root = Math.sqrt(Math.max(0, discriminant)), enter = Math.max(0, (-b - root) / (2 * a)), leave = Math.min(1, (-b + root) / (2 * a));
  return enter <= leave + 1e-9 ? [Math.min(1, enter), Math.max(0, leave)] : undefined;
}

export function selectNearestTarget(source: Actor, candidates: readonly Actor[], range: number): Actor | undefined {
  return candidates.filter((actor) => actor.targetable && actor.id !== source.id && source.position.distance(actor.position) <= range)
    .sort((left, right) => source.position.distanceSquared(left.position) - source.position.distanceSquared(right.position) || left.id.localeCompare(right.id))[0];
}

function validTarget(source: Actor, target: Actor): boolean { return target.alive && (source === target || target.targetable); }

function targetHealthAllowed(target: Actor, skill: SkillDefinition): boolean {
  const limit = skill.conditions?.targetHpBelow ?? (skill.type === "heal" ? 1 : undefined);
  return limit === undefined || target.health / target.stats.maxHealth < limit;
}

const ROLE_PRIORITY: Readonly<Record<CombatRole, number>> = { tank: 0, melee: 1, ranged: 2, support: 3 };

function compareTargetPriority(left: Actor, right: Actor, rule: SkillDefinition["targetRule"]): number {
  if (rule === "lowest_hp") return left.health / left.stats.maxHealth - right.health / right.stats.maxHealth;
  if (rule === "highest_attack") return right.attackPower - left.attackPower;
  if (rule === "role_priority") return (left.combatRole ? ROLE_PRIORITY[left.combatRole] : 4) - (right.combatRole ? ROLE_PRIORITY[right.combatRole] : 4);
  return 0;
}

export function selectSkillTarget(source: Actor, candidates: readonly Actor[], skill: SkillDefinition, random: () => number = () => 0): Actor | undefined {
  if (skill.target === "self") return source.alive && targetHealthAllowed(source, skill) ? source : undefined;
  const eligible = candidates.filter((actor) => validTarget(source, actor) &&
    (skill.target === "enemy" ? actor.faction !== source.faction : actor.faction === source.faction) &&
    source.position.distance(actor.position) <= skill.range &&
    targetHealthAllowed(actor, skill));
  const clusterSize = (actor: Actor) => eligible.filter((candidate) => actor.position.distance(candidate.position) <= (skill.area?.radius ?? 0)).length;
  eligible.sort((left, right) => {
    const rule = skill.targetRule === "cluster" ? clusterSize(right) - clusterSize(left) : compareTargetPriority(left, right, skill.targetRule);
    return rule || source.position.distanceSquared(left.position) - source.position.distanceSquared(right.position) || left.id.localeCompare(right.id);
  });
  return eligible[skill.targetRule === "random" && eligible.length > 1 ? Math.min(eligible.length - 1, Math.floor(random() * eligible.length)) : 0];
}

export class CombatSystem {
  private readonly cooldowns = new Map<string, number>();
  private readonly casts = new Map<string, Cast>();
  private readonly triggeredCasts = new Map<number, Cast>();
  private readonly projectiles = new Map<number, Projectile>();
  private readonly projectileImpacts: ProjectileImpact[] = [];
  private readonly areas = new Map<number, AreaEffect>();
  private nextAreaId = 1;
  private readonly displacements = new Map<string, Displacement>();
  private readonly summons: SummonRequest[] = [];
  private actors: readonly Actor[] = [];
  private time = 0;
  private nextCastId = 1;
  private nextProjectileId = 1;
  private readonly publicCooldowns = new Map<string, number>();
  private readonly combatTimes = new Map<string, number>();
  private readonly random: () => number;
  private readonly mode: "pve" | "pvp";
  private readonly definitions: Readonly<Record<string, SkillDefinition>>;
  private move: ((actor: Actor, destination: Vec2Like, kind: CombatMovement) => void) | undefined;
  private navigate: ((actor: Actor, destination: Vec2Like, deltaSeconds: number) => boolean) | undefined;
  private readonly returningCasts = new Map<string, { readonly cast: Cast; lastUpdate: number }>();
  readonly events: CombatEvent[] = [];

  constructor(random?: () => number, mode: "pve" | "pvp" = "pve", definitions: Readonly<Record<string, SkillDefinition>> = {}) {
    const fallback = new SeededRandom(1); this.random = random ?? (() => fallback.next()); this.mode = mode; this.definitions = definitions;
  }

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

  update(deltaSeconds: number, actors: readonly Actor[], move?: (actor: Actor, destination: Vec2Like, kind: CombatMovement) => void,
    navigate?: (actor: Actor, destination: Vec2Like, deltaSeconds: number) => boolean): void {
    this.actors = actors;
    this.move = move;
    this.navigate = navigate;
    this.time += deltaSeconds;
    this.updateCooldowns(deltaSeconds);
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    for (const id of this.combatTimes.keys()) if (!byId.has(id)) this.combatTimes.delete(id);
    for (const actor of actors) {
      this.synchronizeControl(actor);
      actor.advanceControlMovement(deltaSeconds, this.random, (destination) => {
        if (this.move) this.move(actor, destination, "fear"); else actor.position = Vector2.from(destination);
      });
      for (const tick of actor.updateEffects(deltaSeconds)) this.applyDamage(tick.source, actor, tick.skillId, tick.power, tick.damageType, false, tick.statusId);
      this.synchronizeControl(actor);
      const target = actor.targetId && byId.get(actor.targetId);
      if (actor.alive && target?.targetable && target.faction !== actor.faction && actor.fsm.state !== "returning") this.combatTimes.set(actor.id, (this.combatTimes.get(actor.id) ?? 0) + deltaSeconds);
      else this.combatTimes.delete(actor.id);
    }
    for (const [id, displacement] of this.displacements) {
      const actor = displacement.actor;
      if (byId.get(id) !== actor || !actor.alive || actor.fsm.state !== "displaced" || this.displacementImmune(actor)) { this.cancelDisplacement(id); continue; }
      const progress = Math.min(1, (this.time - displacement.startedAt) / displacement.duration);
      const destination = actor.position.add(displacement.direction.scale(displacement.distance * (progress - displacement.progress)));
      displacement.progress = progress;
      if (this.move) this.move(actor, destination, "knockback"); else actor.position = destination;
      if (progress >= 1 - 1e-9) this.cancelDisplacement(id);
    }
    for (const [id, returning] of this.returningCasts) {
      const cast = returning.cast, actor = cast.source, duration = Math.max(0, this.time - returning.lastUpdate);
      returning.lastUpdate = this.time;
      if (!actor.alive || actor.fsm.state === "returning" || byId.get(id) !== actor || actor.shieldBreakVersion !== cast.shieldBreakVersion) { this.cancelCaster(id); continue; }
      if (!actor.canMove || this.isDisplaced(actor)) continue;
      actor.setState("moving");
      let arrived: boolean;
      if (this.navigate) arrived = this.navigate(actor, actor.homePosition, duration);
      else { actor.moveTowards(actor.homePosition, duration); arrived = actor.position.distance(actor.homePosition) <= 0.01; }
      if (arrived) { this.returningCasts.delete(id); actor.setState("idle"); this.grantCompletionState(cast); }
    }
    for (const [id, cast] of this.casts) {
      if (!cast.source.alive || cast.source.fsm.state === "returning") { this.cancelCaster(id); continue; }
      this.updateWarnings(cast, deltaSeconds);
      if (!cast.resolved && cast.skill.trackTargetFor !== undefined && this.time - deltaSeconds < cast.startedAt + cast.skill.trackTargetFor / cast.speed - 1e-9) {
        const target = actors.find((actor) => actor.id === cast.targetId && validTarget(cast.source, actor));
        if (target) cast.point = target.position;
      }
      if (cast.skill.motion && this.time >= cast.hitAt && cast.source.canMove) this.updateMotion(cast);
      if (!cast.resolved && this.time + 1e-9 >= cast.hitAt) this.launch(cast);
      if (this.casts.get(id) !== cast) continue;
      if (cast.resolved && cast.skill.actions && !cast.skill.projectileSpeed) this.advanceActions(cast);
      if (this.casts.get(id) !== cast) continue;
      if (cast.skill.channelMove && cast.source.canMove) this.updateChannelMovement(cast, deltaSeconds);
      if (this.time + 1e-9 >= cast.readyAt) {
        this.finishCast(cast);
      }
    }
    for (const [id, cast] of [...this.triggeredCasts]) {
      if (!this.triggeredCasts.has(id)) continue;
      if (!cast.source.alive || !byId.has(cast.source.id) || cast.source.fsm.state === "returning") { this.cancelCaster(cast.source.id); continue; }
      this.updateWarnings(cast, deltaSeconds);
      if (!cast.resolved && this.time + 1e-9 >= cast.hitAt) this.launch(cast);
      if (!this.triggeredCasts.has(id)) continue;
      if (cast.resolved && cast.skill.actions && !cast.skill.projectileSpeed) this.advanceActions(cast);
      if (this.time + 1e-9 >= cast.readyAt) this.finishCast(cast);
    }
    for (const [id, projectile] of this.projectiles) {
      if (projectile.directional) { this.advanceDirectionalProjectile(id, projectile); continue; }
      const target = actors.find((actor) => actor.id === projectile.cast.targetId && validTarget(projectile.cast.source, actor));
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
    this.updateAreas();
    for (let index = this.projectileImpacts.length - 1; index >= 0; index--) {
      const impact = this.projectileImpacts[index];
      this.advanceProjectileImpact(impact);
      if (!validTarget(impact.cast.source, impact.target) || !this.actors.includes(impact.target) || impact.actionIndex >= (impact.cast.skill.actions?.length ?? 1)) this.projectileImpacts.splice(index, 1);
    }
  }

  isBusy(actor: Actor): boolean { return this.casts.has(actor.id) || this.returningCasts.has(actor.id) || this.isDisplaced(actor) || actor.hardControlled; }
  selectTarget(actor: Actor, candidates: readonly Actor[], skill: SkillDefinition): Actor | undefined { return selectSkillTarget(actor, candidates, skill, this.random); }
  castingTargetId(actor: Actor): string | undefined { return this.casts.get(actor.id)?.targetId ?? this.returningCasts.get(actor.id)?.cast.targetId; }
  isDisplaced(actor: Actor): boolean { return this.displacements.has(actor.id); }
  isWindingUp(actor: Actor): boolean { const cast = this.casts.get(actor.id); return Boolean(cast && this.castTiming(cast).phase === "windup"); }
  cooldownRemaining(actor: Actor, skill: SkillDefinition): number { return this.cooldowns.get(this.cooldownKey(actor, skill)) ?? 0; }
  canUse(actor: Actor, skill: SkillDefinition): boolean {
    if (!Number.isFinite(skill.energyCost ?? 0) || (skill.energyCost ?? 0) < 0 || !Number.isSafeInteger(skill.skillEnergyCost ?? 0) || (skill.skillEnergyCost ?? 0) < 0 ||
        (skill.healthCost && (!Number.isFinite(skill.healthCost.fraction) || skill.healthCost.fraction <= 0 || skill.healthCost.fraction > 1 || !["maximum", "current"].includes(skill.healthCost.basis)))) return false;
    if (skill.disabled || actor.blocksCasting(skill.category) || (skill.motion && !actor.canMove)) return false;
    if (skill.type === "summon" && this.actors.filter((candidate) => candidate.alive && candidate.summonerId === actor.id).length >= (skill.summonLimit ?? skill.maxTargets ?? 1)) return false;
    if ((skill.energyCost ?? 0) > actor.energy || (skill.skillEnergyCost ?? 0) > actor.skillEnergy || this.publicCooldowns.has(this.publicKey(actor, skill))) return false;
    return actor.alive && actor.fsm.state !== "returning" && this.conditionsMet(actor, undefined, skill.conditions) && !this.isBusy(actor) && this.cooldownRemaining(actor, skill) === 0;
  }

  use(actor: Actor, target: Actor, skill: SkillDefinition, candidates: readonly Actor[] = this.actors): boolean {
    this.actors = [...new Map([...candidates, actor, target].map((entry) => [entry.id, entry])).values()];
    this.synchronizeControl(actor);
    if (!this.canUse(actor, skill) || !validTarget(actor, target) || !targetHealthAllowed(target, skill) || actor.position.distance(target.position) > skill.range) return false;
    if (skill.target === "enemy" ? actor.faction === target.faction : actor.faction !== target.faction) return false;
    if (skill.target === "self" && target !== actor) return false;
    const cast = this.makeCast(actor, target, skill);
    const windup = cast.hitAt - this.time;
    this.cooldowns.set(this.cooldownKey(actor, skill), skill.cooldown);
    if (skill.publicCooldown) this.publicCooldowns.set(this.publicKey(actor, skill), skill.publicCooldown);
    for (const linked of skill.linkedCooldowns ?? []) this.cooldowns.set(`${actor.id}:${linked.id}`, linked.duration);
    actor.gainEnergy(-(skill.energyCost ?? 0));
    actor.gainSkillEnergy(-(skill.skillEnergyCost ?? 0));
    const healthCost = skill.healthCost ? actor.spendHealth((skill.healthCost.basis === "maximum" ? actor.stats.maxHealth : actor.health) * skill.healthCost.fraction) : 0;
    for (const [resource, value] of [["health", healthCost], ["energy", skill.energyCost ?? 0], ["skill_energy", skill.skillEnergyCost ?? 0]] as const) {
      if (value > 0) this.events.push({ type: "resource_cost", sourceId: actor.id, targetId: actor.id, skillId: skill.id, resource, value });
    }
    this.casts.set(actor.id, cast);
    this.events.push({ type: "skill", sourceId: actor.id, targetId: target.id, skillId: skill.id });
    if (windup > 0) {
      actor.setState("windup");
      this.events.push({ type: "telegraph", sourceId: actor.id, targetId: target.id, value: windup, skillId: skill.id, x: cast.point.x, y: cast.point.y });
    } else this.launch(cast);
    if (cast.readyAt <= this.time) {
      if (cast.skill.completionState) this.finishCast(cast);
      else this.casts.delete(actor.id);
    }
    return true;
  }

  cancelCaster(id: string): void {
    const returning = this.returningCasts.get(id)?.cast, cast = this.casts.get(id) ?? returning;
    this.casts.delete(id);
    this.returningCasts.delete(id);
    const pending = [...(cast ? [cast] : []), ...[...this.triggeredCasts.values()].filter((entry) => entry.source.id === id)];
    for (const entry of pending) {
      if (entry.triggered) this.triggeredCasts.delete(entry.id);
      if (entry === returning || !entry.resolved || entry.actionIndex < (entry.skill.actions?.length ?? 0)) this.events.push({ type: "cast_cancelled", sourceId: id, targetId: entry.targetId, skillId: entry.skill.id });
    }
    if (cast?.source.alive && !["returning", "displaced", "controlled"].includes(cast.source.fsm.state)) cast.source.setState("idle");
  }

  cancelDisplacement(id: string): void {
    const displacement = this.displacements.get(id);
    this.displacements.delete(id);
    if (displacement?.actor.alive && displacement.actor.fsm.state === "displaced") {
      const cast = this.casts.get(id);
      displacement.actor.setState(cast ? cast.resolved ? "recovering" : "windup" : displacement.actor.hardControlled ? "controlled" : "idle");
    }
  }

  castSnapshots(): CastSnapshot[] {
    return [...this.casts.values()].map((cast) => ({
      id: cast.id, sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id,
      ...this.castTiming(cast),
      origin: !cast.resolved && cast.skill.directionalProjectile ? cast.source.position : cast.origin,
      point: !cast.resolved && cast.skill.directionalProjectile && cast.skill.trackTargetFor === undefined ? this.actors.find((actor) => actor.id === cast.targetId && validTarget(cast.source, actor))?.position ?? cast.point : cast.point, area: cast.skill.area,
      playbackRate: cast.speed,
      warnings: cast.skill.warnings ? cast.warnings.map((warning, index) => ({ index, warning }))
        .filter(({ warning }) => this.time + 1e-9 >= cast.startedAt + warning.definition.start / cast.speed && this.time < cast.startedAt + warning.definition.end / cast.speed - 1e-9)
        .map(({ warning, index }) => ({ index, position: warning.position, direction: warning.direction, area: warning.definition.geometry,
          remaining: Math.max(0, cast.startedAt + warning.definition.end / cast.speed - this.time), duration: (warning.definition.end - warning.definition.start) / cast.speed })) : undefined,
      elevation: cast.skill.motion?.kind === "jump" ? Math.sin(Math.PI * Math.max(0, Math.min(1, (this.time - cast.hitAt) * cast.speed / cast.skill.motion.duration))) * (cast.skill.motion.height ?? 160) : 0,
    }));
  }

  private castTiming(cast: Cast): Pick<CastSnapshot, "phase" | "remaining" | "duration" | "cycle"> {
    const cycles = cast.skill.castCycles;
    const cycle = cycles ? Math.min(cycles.count - 1, Math.floor(((this.time - cast.startedAt) * cast.speed + 1e-9) / cycles.interval)) : 0;
    const start = cast.startedAt + (cycles ? cycle * cycles.interval / cast.speed : 0), hit = start + cast.hitAt - cast.startedAt;
    const windup = cycles ? this.time + 1e-9 < hit : !cast.resolved;
    const end = cycles && cycle + 1 < cycles.count ? Math.min(cast.readyAt, start + cycles.interval / cast.speed) : cast.readyAt;
    return { phase: windup ? "windup" : cast.actionIndex < (cast.skill.actions?.length ?? 0) && !cast.skill.projectileSpeed ? "active" : "recovery",
      remaining: Math.max(0, (windup ? hit : end) - this.time), duration: Math.max(0, windup ? hit - start : end - hit), ...(cycles ? { cycle } : {}) };
  }

  private finishCast(cast: Cast): void {
    if (cast.triggered ? !this.triggeredCasts.has(cast.id) : this.casts.get(cast.source.id) !== cast) return;
    if (cast.triggered) this.triggeredCasts.delete(cast.id); else this.casts.delete(cast.source.id);
    if (!cast.source.alive || cast.source.fsm.state === "returning") return;
    if (!cast.triggered && !this.isDisplaced(cast.source)) cast.source.setState(cast.source.hardControlled ? "controlled" : "idle");
    if (!cast.skill.completionState) return;
    if (cast.skill.returnHomeOnComplete && cast.source.position.distance(cast.source.homePosition) > 0.01) this.returningCasts.set(cast.source.id, { cast, lastUpdate: this.time });
    else this.grantCompletionState(cast);
  }

  private grantCompletionState(cast: Cast): void {
    this.applyStatus(cast, cast.source, { id: `cast_completion:${cast.skill.id}`, duration: -1, permanent: true, clearOnReturn: true,
      states: [{ id: cast.skill.completionState!, duration: -1 }] });
  }

  projectileSnapshots(): ProjectileSnapshot[] {
    return [...this.projectiles].filter(([, projectile]) => projectile.impactAt === undefined).map(([id, { cast, position, directional }]) => {
      const direction = directional?.direction ?? cast.point.subtract(cast.origin).normalized();
      return { id, sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id, x: position.x, y: position.y,
        age: Math.max(0, this.time - cast.hitAt), directionX: direction.x, directionY: direction.y, radius: cast.skill.directionalProjectile?.radius };
    });
  }

  areaSnapshots(): AreaEffectSnapshot[] {
    return [...this.areas.values()].map((area) => ({ id: area.id, sourceId: area.cast.source.id, skillId: area.cast.skill.id, x: area.position.x, y: area.position.y,
      age: Math.max(0, this.time - area.startedAt), remaining: Math.max(0, area.expiresAt - this.time), geometry: area.definition.geometry,
      directionX: area.direction.x, directionY: area.direction.y, effectKey: area.definition.effectKey, moving: Boolean(area.definition.motion) }));
  }

  drainEvents(): CombatEvent[] { return this.events.splice(0); }
  drainSummons(): SummonRequest[] { return this.summons.splice(0); }

  resetEngagement(): void {
    for (const id of this.displacements.keys()) this.cancelDisplacement(id);
    for (const id of this.returningCasts.keys()) this.cancelCaster(id);
    this.casts.clear(); this.triggeredCasts.clear(); this.projectiles.clear(); this.projectileImpacts.splice(0); this.areas.clear(); this.summons.splice(0);
    this.cooldowns.clear(); this.publicCooldowns.clear(); this.combatTimes.clear(); this.events.splice(0);
    this.actors = []; this.move = undefined; this.navigate = undefined;
  }

  private conditionsMet(source: Actor, target: Actor | undefined, condition?: SkillConditions): boolean {
    if (condition?.hasShield !== undefined && (source.shield > 0) !== condition.hasShield) return false;
    if (condition?.skillEnergyAtLeast !== undefined && source.skillEnergy < condition.skillEnergyAtLeast) return false;
    if (condition?.skillEnergyAtMost !== undefined && source.skillEnergy > condition.skillEnergyAtMost) return false;
    if (condition?.uncontrolled && source.controlled) return false;
    if (condition?.requiredState && !source.hasStatus(condition.requiredState)) return false;
    if (condition?.excludedState && source.hasStatus(condition.excludedState)) return false;
    if (condition?.casterHpAtMost !== undefined && source.health / source.stats.maxHealth > condition.casterHpAtMost) return false;
    if (target && condition?.targetHpBelow !== undefined && target.health / target.stats.maxHealth >= condition.targetHpBelow) return false;
    if (condition?.combatTimeAtLeast && (this.combatTimes.get(source.id) ?? 0) < condition.combatTimeAtLeast) return false;
    if (condition?.inCombat && !this.actors.some((other) => other.targetable && other.faction !== source.faction &&
        (other.id === source.targetId || source.position.distance(other.position) <= source.stats.aggroRange))) return false;
    return true;
  }

  private makeCast(actor: Actor, target: Actor, definition: SkillDefinition, chain: readonly string[] = []): Cast {
    const bonus = actor.targetCountBonus(definition.group ?? definition.id);
    const skill = bonus ? { ...definition, targetCount: Math.max(1, (definition.targetCount ?? definition.maxTargets ?? 1) + bonus),
      maxTargets: Math.max(1, (definition.maxTargets ?? definition.targetCount ?? 1) + bonus) } : definition;
    const speed = Math.max(0.1, 1 + actor.modifier("attackSpeedRate") + (skill.category === "normal" ? actor.modifier("normalAttackSpeedRate") : 0));
    const windup = (skill.windup ?? (skill.type === "telegraph_damage" ? skill.telegraph ?? 0 : 0)) / speed;
    const end = Math.max(skill.castDuration ?? 0, (skill.windup ?? 0) + (skill.recovery ?? 0), ...(skill.actions ?? []).map((action) => action.at), ...(skill.warnings ?? []).map((warning) => warning.end));
    const facing = Math.atan2(target.position.y - actor.position.y, target.position.x - actor.position.x), used = new Set<string>([target.id]), usedPaths = new Set<string>(), usedAngles = new Map<string, Set<number>>();
    const warnings = (skill.warnings ?? []).map((definition) => {
      let anchor = definition.anchor === "caster" || definition.anchor === "home" ? actor : target;
      if (definition.anchor === "random_target") {
        const pool = this.actors.filter((candidate) => validTarget(actor, candidate) && candidate.faction === target.faction && actor.position.distance(candidate.position) <= skill.range);
        const unused = pool.filter((candidate) => !used.has(candidate.id));
        const choices = unused.length ? unused : pool;
        if (choices.length) anchor = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
      }
      used.add(anchor.id);
      const angle = facing + (definition.angleDegrees ?? 0) * Math.PI / 180;
      let direction = new Vector2(Math.cos(angle), Math.sin(angle)), offset = direction.scale(definition.distance ?? 0);
      if (definition.directionAngles?.length) {
        const group = definition.directionGroup ?? "default", selected = usedAngles.get(group) ?? new Set<number>();
        const unused = definition.directionAngles.filter((value) => !selected.has(value)), choices = unused.length ? unused : definition.directionAngles;
        const chosen = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
        selected.add(chosen); usedAngles.set(group, selected);
        direction = new Vector2(Math.cos(chosen * Math.PI / 180), Math.sin(chosen * Math.PI / 180)); offset = direction.scale(definition.distance ?? 0);
      }
      if (definition.paths?.length) {
        const candidates = definition.paths.map((path) => ({ path, key: [path.from.x, path.from.y, path.to.x, path.to.y].join(",") }));
        const unused = candidates.filter((entry) => !usedPaths.has(entry.key)), choices = unused.length ? unused : candidates;
        const chosen = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
        usedPaths.add(chosen.key); offset = Vector2.from(chosen.path.from); direction = Vector2.from(chosen.path.to).subtract(offset).normalized();
      }
      return { definition, anchorId: anchor.id, offset, direction, position: (definition.anchor === "home" ? actor.homePosition : anchor.position).add(offset) };
    });
    return { id: this.nextCastId++, source: actor, targetId: target.id, skill, origin: actor.position, point: target.position, startedAt: this.time,
      hitAt: this.time + windup, readyAt: this.time + (skill.actions || skill.castDuration ? end / speed : windup + (skill.recovery ?? 0)), resolved: false,
      actionIndex: 0, primaryIds: this.primaryTargets(actor, target, skill).map((entry) => entry.id), speed,
      energyAward: { amount: skill.blockEnergyGain || skill.energyCost || skill.category === "ultimate" ? 0 :
        skill.category === "normal" ? actor.stats.energyOnNormal ?? actor.stats.energyOnSkill ?? 0 : actor.stats.energyOnSkill ?? 0, awarded: false },
      triggered: chain.length > 0, triggerChain: [...chain, skill.id], fromPlayer: this.playerControlled(actor), shieldBreakVersion: actor.shieldBreakVersion, warnings };
  }

  private updateWarnings(cast: Cast, deltaSeconds: number): void {
    for (const warning of cast.warnings) {
      const cutoff = cast.startedAt + Math.min(cast.skill.trackTargetFor ?? warning.definition.end, warning.definition.end) / cast.speed;
      if (!warning.definition.follow || this.time - deltaSeconds >= cutoff - 1e-9) continue;
      const anchor = this.actors.find((actor) => actor.id === warning.anchorId && validTarget(cast.source, actor));
      if (anchor) warning.position = (warning.definition.anchor === "home" ? anchor.homePosition : anchor.position).add(warning.offset);
    }
  }

  private playerControlled(actor: Actor): boolean {
    const seen = new Set<string>();
    let current: Actor | undefined = actor;
    while (current && !seen.has(current.id)) {
      if (current.faction === "player" || current.kind === "hero") return true;
      seen.add(current.id);
      current = current.summonerId ? this.actors.find((entry) => entry.id === current!.summonerId) : undefined;
    }
    return false;
  }

  private releaseTriggers(parent: Cast): void {
    for (const trigger of parent.skill.onRelease ?? []) {
      const child = this.definitions[trigger.skillId];
      if (!child || child.motion || child.channelMove || child.returnHomeOnComplete) throw new Error(`Invalid triggered skill ${trigger.skillId}`);
      if (child.disabled || child.energyCost || child.skillEnergyCost || child.healthCost || !parent.source.alive || (this.isDisplaced(parent.source) && !parent.source.interruptionImmune) || parent.triggerChain.includes(child.id) || parent.triggerChain.length >= 8) continue;
      if (!this.conditionsMet(parent.source, this.actors.find((actor) => actor.id === parent.targetId), trigger.conditions)) continue;
      if ((trigger.chance ?? 1) < 1 && this.random() >= (trigger.chance ?? 1)) continue;
      const target = this.selectTarget(parent.source, this.actors, child);
      if (!target || parent.source.blocksCasting(child.category) || !this.conditionsMet(parent.source, target, child.conditions)) continue;
      const cast = this.makeCast(parent.source, target, child, parent.triggerChain);
      this.triggeredCasts.set(cast.id, cast);
      this.events.push({ type: "skill", sourceId: cast.source.id, targetId: target.id, skillId: child.id, triggered: true });
      if (cast.hitAt <= this.time + 1e-9) this.launch(cast);
      if (cast.readyAt <= this.time + 1e-9) this.finishCast(cast);
    }
  }

  private launch(cast: Cast): void {
    cast.resolved = true;
    if (cast.skill.projectileSpeed && cast.skill.projectileSpeed > 0) {
      const expiresAt = cast.hitAt + (cast.skill.projectileLifetime ?? Math.max(1, cast.skill.range / cast.skill.projectileSpeed * 3));
      if (cast.skill.directionalProjectile) {
        const target = this.actors.find((actor) => actor.id === cast.targetId && validTarget(cast.source, actor));
        const origin = cast.source.position, point = cast.skill.trackTargetFor === undefined ? target?.position ?? cast.point : cast.point;
        const heading = point.subtract(origin).normalized(), direction = heading.lengthSquared() > 0 ? heading : new Vector2(0, 1);
        this.projectiles.set(this.nextProjectileId++, { cast: { ...cast, origin, point }, position: origin, lastUpdate: cast.hitAt, actionIndex: 0,
          expiresAt, directional: { direction, hits: new Map(), remaining: cast.skill.directionalProjectile.maxHits } });
        this.events.push({ type: "projectile", sourceId: cast.source.id, targetId: cast.targetId, skillId: cast.skill.id });
      } else for (const id of cast.primaryIds) {
        const target = this.actors.find((actor) => actor.id === id);
        if (!target || !validTarget(cast.source, target)) continue;
        const projectileCast = { ...cast, targetId: id, primaryIds: [id], point: target.position };
        this.projectiles.set(this.nextProjectileId++, { cast: projectileCast, position: cast.origin, lastUpdate: cast.hitAt, actionIndex: 0,
          expiresAt });
        this.events.push({ type: "projectile", sourceId: cast.source.id, targetId: id, skillId: cast.skill.id });
      }
    } else if (cast.skill.actions) this.advanceActions(cast);
    else this.resolveHit(cast, false);
    const active = cast.triggered ? this.triggeredCasts.has(cast.id) : this.casts.get(cast.source.id) === cast;
    if (active && cast.source.alive && !cast.triggered && !this.isDisplaced(cast.source)) cast.source.setState(cast.readyAt > this.time ? "recovering" : "attacking");
    if (active && cast.source.alive) this.releaseTriggers(cast);
  }

  private resolveHit(cast: Cast, projectile: boolean, action?: SkillAction, contacts?: readonly Actor[]): void {
    if (action?.warningIndex !== undefined) {
      const warning = cast.warnings[action.warningIndex];
      if (!warning) throw new Error("Missing skill warning placement");
      cast = { ...cast, origin: warning.position, point: warning.position, direction: warning.direction,
        skill: { ...cast.skill, area: warning.definition.geometry, areaAnchor: "target", targetCount: undefined, motion: undefined } };
    }
    const { source, skill } = cast;
    if (action?.type === "area") {
      const definition = action.areaEffect!;
      if (!definition || definition.duration <= 0 || definition.interval <= 0 || definition.effects.some((effect) => effect.type === "area")) throw new Error("Invalid area effect");
      if (definition.followCaster && !source.alive) return;
      const position = definition.followCaster ? source.position : contacts?.[0]?.position ?? (definition.motion ? cast.origin : cast.point);
      const heading = cast.direction ?? cast.point.subtract(source.position).normalized();
      const id = this.nextAreaId++;
      const area = { id, cast, definition, position, direction: heading.lengthSquared() ? heading : new Vector2(0, 1),
        startedAt: this.time, expiresAt: this.time + definition.duration, nextTick: this.time, ticks: 0, hits: new Map(), lastUpdate: this.time };
      this.areas.set(id, area);
      this.events.push({ type: "area_created", sourceId: source.id, targetId: cast.targetId, skillId: skill.id, x: position.x, y: position.y });
      this.tickArea(area);
      return;
    }
    if (skill.type === "summon") {
      if (!source.alive || !skill.summonEnemyId) return;
      this.awardEnergy(cast);
      this.summons.push({ sourceId: source.id, enemyId: skill.summonEnemyId, count: skill.maxTargets ?? 1, limit: skill.summonLimit ?? skill.maxTargets ?? 1,
        radius: skill.summonRadius ?? 0, position: source.position });
      this.events.push({ type: "summon", sourceId: source.id, targetId: source.id, value: skill.maxTargets ?? 1, skillId: skill.id });
      return;
    }
    const targets = action?.recipient === "self" ? [source] : action?.recipient === "enemies" ?
      this.actors.filter((actor) => validTarget(source, actor) && actor.faction !== source.faction && (action.globalTargets || source.position.distance(actor.position) <= skill.range))
        .sort((a, b) => source.position.distanceSquared(a.position) - source.position.distanceSquared(b.position) || a.id.localeCompare(b.id)).slice(0, action.targetCount ?? skill.targetCount ?? 1) : action?.recipient === "allies" ?
      this.actors.filter((actor) => validTarget(source, actor) && actor.faction === source.faction && (action.globalTargets || source.position.distance(actor.position) <= skill.range))
        .sort((a, b) => a.health / a.stats.maxHealth - b.health / b.stats.maxHealth || a.id.localeCompare(b.id)).slice(0, action.targetCount ?? 1) : contacts ?? this.hitTargets(cast, projectile);
    if (targets.length === 0) this.events.push({ type: "miss", sourceId: source.id, targetId: cast.targetId, skillId: skill.id });
    for (const target of targets) {
      if (!validTarget(source, target)) continue;
      this.awardEnergy(cast);
      if (action?.type === "status") {
        if (action.status) this.applyStatus(cast, target, action.status);
      } else if (action?.type === "clear_shields" || action?.type === "shield_to_health") {
        const amount = target.clearShields();
        if (amount) this.events.push({ type: "shield_removed", sourceId: source.id, targetId: target.id, skillId: skill.id, value: amount });
        if (action.type === "shield_to_health") {
          const value = target.heal(amount * (action.power ?? 1)); this.events.push({ type: "heal", sourceId: source.id, targetId: target.id, skillId: skill.id, value });
        }
      } else if (action?.type === "clear_cooldowns") {
        for (const id of action.cooldownIds ?? []) this.cooldowns.delete(`${target.id}:${id}`);
      } else if (action?.type === "skill_energy") {
        const gain = action.skillEnergy!;
        const amount = gain.minimum === gain.maximum ? gain.minimum : gain.minimum + Math.floor(this.random() * (gain.maximum - gain.minimum + 1));
        const value = target.gainSkillEnergy(amount, gain.cap);
        if (value) this.events.push({ type: "skill_energy", sourceId: source.id, targetId: target.id, skillId: skill.id, value });
      } else if (action?.type === "remove_state") {
        const removed = target.removeState(action.stateId!); this.synchronizeControl(target);
        if (removed) this.events.push({ type: "state_removed", sourceId: source.id, targetId: target.id, skillId: skill.id, statusId: action.stateId, value: removed });
      } else if (action?.type === "cleanse") {
        const removed = target.cleanse(action.cleanse?.count ?? 1, action.cleanse?.npcOnly ?? false, this.random);
        this.synchronizeControl(target);
        if (removed.length) this.events.push({ type: "cleanse", sourceId: source.id, targetId: target.id, skillId: skill.id, value: removed.length });
      } else if (skill.type === "shield" && !action) {
        const value = target.addShield(`${source.id}:${skill.id}`, source.attackPower * skill.power, skill.duration ?? 0);
        this.events.push({ type: "shield", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
      } else if (action?.type === "heal" || (!action && (skill.type === "heal" || (skill.target !== "enemy" && skill.type !== "damage")))) {
        const bonuses = (action?.healingBonuses ?? []).filter((bonus) => this.conditionsMet(source, target, bonus.conditions) && ((bonus.chance ?? 1) >= 1 || this.random() < (bonus.chance ?? 1)));
        const powerBonus = bonuses.reduce((sum, bonus) => sum + (bonus.powerBonus ?? 0), 0);
        const value = target.heal(source.attackPower * (action?.power ?? skill.power) * Math.max(0, 1 + powerBonus));
        this.events.push({ type: "heal", sourceId: source.id, targetId: target.id, value, skillId: skill.id });
        if (action?.randomStatuses?.length) this.applyStatus(cast, target, action.randomStatuses[Math.min(action.randomStatuses.length - 1, Math.floor(this.random() * action.randomStatuses.length))]);
        for (const bonus of bonuses) if (bonus.statuses?.length) {
          let choices = [...bonus.statuses];
          if (bonus.selection !== "all") {
            let value = this.random() * choices.reduce((total, entry) => total + entry.weight, 0);
            choices = [choices.find((entry) => { value -= entry.weight; return value < 0; }) ?? choices[choices.length - 1]];
          }
          for (const choice of choices) this.applyStatus(cast, target, choice.status);
        }
      } else {
        const type = action?.damageType ?? skill.damageType ?? "physical";
        const chance = Math.max(0, Math.min(1, source.modifier("criticalChance")));
        const critical = !action?.healthDamage && Boolean(action?.forceCritical || skill.forceCritical || (chance > 0 && this.random() < chance));
        const power = (action?.power ?? skill.power) + (action?.powerPerStack ? target.statusStacks(action.powerPerStack.group) * action.powerPerStack.amount : 0);
        const damage = this.applyDamage(source, target, skill.id, power, type, critical, undefined, action?.healthDamage);
        if (action?.healFromDamage && damage > 0) {
          const allies = action.healFromDamageRecipient === "self" ? (source.alive ? [source] : []) : this.actors.filter((actor) => validTarget(source, actor) && actor.faction === source.faction);
          for (const ally of allies) { const value = ally.heal(damage * action.healFromDamage / allies.length); this.events.push({ type: "heal", sourceId: source.id, targetId: ally.id, value, skillId: skill.id }); }
        }
        if (action?.knockback) this.knockBack(cast, target, action.knockback);
        if (target.alive && action?.settleStatus) for (const tick of target.settlePeriodicStatus(action.settleStatus.group, action.settleStatus.seconds))
          this.applyDamage(tick.source, target, skill.id, tick.power, tick.damageType, false, tick.statusId);
      }
    }
  }

  private awardEnergy(cast: Cast): void {
    if (cast.energyAward.awarded) return;
    cast.energyAward.awarded = true;
    if (cast.source.alive && this.actors.includes(cast.source)) cast.source.gainEnergy(cast.energyAward.amount);
  }

  private advanceDirectionalProjectile(id: number, projectile: Projectile): void {
    const state = projectile.directional!, definition = projectile.cast.skill.directionalProjectile!;
    const start = projectile.lastUpdate, end = Math.min(this.time, projectile.expiresAt), span = Math.max(0, end - start);
    const origin = projectile.position, destination = origin.add(state.direction.scale(projectile.cast.skill.projectileSpeed! * span));
    const contacts: Array<{ target: Actor; at: number }> = [];
    for (const target of this.actors) {
      if (!validTarget(projectile.cast.source, target) || (projectile.cast.skill.target === "enemy" ? target.faction === projectile.cast.source.faction : target.faction !== projectile.cast.source.faction)) continue;
      const last = state.hits.get(target.id);
      if (last !== undefined && definition.repeatInterval === undefined) continue;
      const interval = circleContactInterval(origin, destination, target.position, definition.radius + (target.stats.collisionRadius ?? 0));
      if (!interval) continue;
      let at = Math.max(start + interval[0] * span, last === undefined ? -Infinity : last + definition.repeatInterval!);
      for (let count = 0; count < state.remaining && at <= start + interval[1] * span + 1e-9 && at < projectile.expiresAt - 1e-9; count++) {
        contacts.push({ target, at });
        if (definition.repeatInterval === undefined) break;
        at += definition.repeatInterval;
      }
    }
    contacts.sort((left, right) => left.at - right.at || left.target.id.localeCompare(right.target.id));
    for (const contact of contacts) {
      if (state.remaining <= 0) break;
      if (!validTarget(projectile.cast.source, contact.target)) continue;
      state.hits.set(contact.target.id, contact.at); state.remaining--;
      const impact = { cast: projectile.cast, target: contact.target, at: contact.at, actionIndex: 0 };
      this.advanceProjectileImpact(impact);
      if (impact.target.alive && impact.actionIndex < (impact.cast.skill.actions?.length ?? 1)) this.projectileImpacts.push(impact);
    }
    projectile.position = destination; projectile.lastUpdate = end;
    if (state.remaining <= 0 || this.time >= projectile.expiresAt - 1e-9) this.projectiles.delete(id);
  }

  private advanceProjectileImpact(impact: ProjectileImpact): void {
    if (!validTarget(impact.cast.source, impact.target) || !this.actors.includes(impact.target)) return;
    const actions = impact.cast.skill.actions;
    if (!actions) { if (!impact.actionIndex) this.resolveHit(impact.cast, true, undefined, [impact.target]); impact.actionIndex = 1; return; }
    while (impact.actionIndex < actions.length && impact.at + actions[impact.actionIndex].at / impact.cast.speed <= this.time + 1e-9) {
      this.resolveHit(impact.cast, true, actions[impact.actionIndex++], [impact.target]);
    }
  }

  private updateAreas(): void {
    for (const [id, area] of this.areas) {
      const source = area.cast.source, definition = area.definition;
      if (source.fsm.state === "returning" || (definition.followCaster && (!source.alive || !this.actors.includes(source)))) {
        this.areas.delete(id);
        for (let index = this.projectileImpacts.length - 1; index >= 0; index--) if (this.projectileImpacts[index].areaId === id) this.projectileImpacts.splice(index, 1);
        continue;
      }
      while (area.nextTick <= this.time + 1e-9 && area.nextTick < area.expiresAt - 1e-9 && area.ticks < (definition.maxTicks ?? Infinity)) {
        this.advanceArea(area, area.nextTick); this.tickArea(area);
      }
      this.advanceArea(area, Math.min(this.time, area.expiresAt));
      if (this.time >= area.expiresAt - 1e-9) this.areas.delete(id);
    }
  }

  private advanceArea(area: AreaEffect, time: number): void {
    const delta = Math.max(0, time - area.lastUpdate), definition = area.definition, source = area.cast.source;
    area.lastUpdate = Math.max(time, area.lastUpdate);
    if (definition.followCaster) area.position = source.position;
    const target = this.actors.find((actor) => actor.id === area.cast.targetId && validTarget(source, actor));
    if (definition.motion?.kind === "homing" && target) {
      const heading = target.position.subtract(area.position);
      if (heading.lengthSquared()) area.direction = heading.normalized();
      area.position = area.position.moveTowards(target.position, definition.motion.speed * delta);
      return;
    }
    if (target && definition.turnSpeedDegrees && !this.hitTargets(this.areaCast(area), true).includes(target)) {
      const desired = target.position.subtract(area.position), angle = Math.atan2(area.direction.y, area.direction.x);
      let difference = Math.atan2(desired.y, desired.x) - angle;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      const limit = definition.turnSpeedDegrees * Math.PI / 180 * delta;
      const next = angle + Math.max(-limit, Math.min(limit, difference)); area.direction = new Vector2(Math.cos(next), Math.sin(next));
    }
    if (definition.motion) area.position = area.position.add(area.direction.scale(definition.motion.speed * delta));
  }

  private tickArea(area: AreaEffect): void {
    const definition = area.definition;
    const cast = this.areaCast(area);
    const effects = definition.phases?.find((phase) => phase.throughTick >= area.ticks + 1)?.effects ?? definition.effects;
    const touched = new Set<string>();
    const selections = new Map<string, readonly Actor[]>();
    for (const effect of effects) {
      const self = effect.recipient === "self";
      const targetCamp = effect.recipient === "allies" ? "ally" : effect.recipient === "enemies" ? "enemy" : cast.skill.target;
      const limit = (this.mode === "pvp" ? definition.pvpMaxTargets : undefined) ?? definition.maxTargets ?? effect.targetCount ?? Number.MAX_SAFE_INTEGER;
      const selection = { ...cast, skill: { ...cast.skill, target: targetCamp, targetRule: targetCamp === "ally" ? "lowest_hp" as const : cast.skill.targetRule, maxTargets: limit } };
      const key = self ? "self" : `${targetCamp}:${limit}`;
      let targets = selections.get(key);
      if (!targets) { targets = self ? [cast.source] : this.hitTargets(selection, true); selections.set(key, targets); }
      for (const target of targets) {
        if (!validTarget(cast.source, target) || (area.hits.get(target.id) ?? 0) >= (definition.hitsPerTarget ?? Infinity)) continue;
        touched.add(target.id);
        const impact = { cast: { ...cast, skill: { ...cast.skill, actions: [{ ...effect, recipient: "targets" as const }] } }, target, at: area.nextTick, areaId: area.id, actionIndex: 0 };
        this.advanceProjectileImpact(impact);
        if (!impact.actionIndex && target.alive) this.projectileImpacts.push(impact);
      }
    }
    for (const id of touched) area.hits.set(id, (area.hits.get(id) ?? 0) + 1);
    area.ticks++;
    area.nextTick += definition.interval;
  }

  private areaCast(area: AreaEffect): Cast {
    const definition = area.definition;
    return { ...area.cast, origin: area.position, direction: area.direction,
      point: definition.geometry.shape === "circle" ? area.position : area.position.add(area.direction), speed: 1,
      skill: { ...area.cast.skill, target: definition.target ?? (area.cast.skill.target === "self" ? "ally" : area.cast.skill.target),
        area: definition.geometry, areaAnchor: "target", targetCount: undefined, maxTargets: Number.MAX_SAFE_INTEGER, motion: undefined, actions: definition.effects } };
  }

  private updateChannelMovement(cast: Cast, deltaSeconds: number): void {
    const movement = cast.skill.channelMove!, start = cast.startedAt + movement.start / cast.speed;
    const duration = Math.max(0, Math.min(this.time, cast.readyAt) - Math.max(this.time - deltaSeconds, start));
    if (!duration) return;
    const active = [...this.areas.values()].find((area) => area.cast.id === cast.id && area.definition.followCaster);
    const direction = active?.direction ?? cast.point.subtract(cast.origin).normalized();
    const destination = cast.source.position.add(direction.scale(movement.speed * duration));
    if (this.move) this.move(cast.source, destination, "channel"); else cast.source.position = destination;
  }

  private applyDamage(source: Actor, target: Actor, skillId: string, power: number, type: DamageType, critical = false, statusId?: string,
    healthDamage?: NonNullable<SkillAction["healthDamage"]>): number {
    if (!target.alive) return 0;
    const periodic = statusId !== undefined;
    const elementBonus = type === "soul" ? source.modifier("soulBonus") : type === "magic" ? source.modifier("magicBonus") : type === "physical" ? source.modifier("physicalBonus") : 0;
    const multiplier = (1 + source.modifier("damageBonus")) * (1 + source.modifier("finalDamageBonus")) *
      (1 + elementBonus) *
      (periodic ? Math.max(0, 1 + source.modifier("dotDamageBonus")) : 1) * (critical ? source.stats.criticalMultiplier ?? 1.5 : 1);
    const previousShield = target.shield;
    const raw = healthDamage ? (healthDamage.basis === "maximum" ? target.stats.maxHealth : target.health) * healthDamage.fraction : source.attackPower * power * multiplier;
    const damage = target.receiveDamage(raw, type, periodic, this.mode === "pve");
    const absorbed = previousShield - target.shield;
    if (absorbed > 0) this.events.push({ type: "absorb", sourceId: source.id, targetId: target.id, value: absorbed, skillId });
    this.events.push({ type: "damage", sourceId: source.id, targetId: target.id, value: damage, skillId, critical, damageType: type,
      ...(target.invulnerable && raw > 0 ? { immune: true } : {}), ...(periodic ? { periodic, statusId } : {}) });
    if (!target.alive) { this.cancelCaster(target.id); this.cancelDisplacement(target.id); this.events.push({ type: "death", sourceId: source.id, targetId: target.id, skillId }); }
    else this.synchronizeControl(target);
    return damage;
  }

  private displacementImmune(actor: Actor): boolean {
    return actor.displacementImmune;
  }

  private applyStatus(cast: Cast, target: Actor, status: StatusDefinition): void {
    const previousHealth = target.health, previousShield = target.shield;
    if (!target.addStatus(status, cast.source, cast.skill.id, cast.fromPlayer)) return;
    if (status.shields?.length) {
      if (target.shield > previousShield) this.events.push({ type: "shield", sourceId: cast.source.id, targetId: target.id, skillId: cast.skill.id, value: target.shield - previousShield });
      if (target.health < previousHealth) this.events.push({ type: "resource_cost", sourceId: cast.source.id, targetId: target.id, skillId: cast.skill.id, resource: "health", value: previousHealth - target.health });
    }
    this.synchronizeControl(target);
    this.events.push({ type: "status", sourceId: cast.source.id, targetId: target.id, skillId: cast.skill.id });
  }

  private synchronizeControl(actor: Actor): void {
    if (!actor.alive) return;
    const pending = [...(this.casts.has(actor.id) ? [this.casts.get(actor.id)!] : []), ...[...this.triggeredCasts.values()].filter((cast) => cast.source === actor)];
    if (pending.some((cast) => cast.shieldBreakVersion !== actor.shieldBreakVersion || (!actor.interruptionImmune &&
        (actor.blocksCasting(cast.skill.category) || (cast.skill.motion && !actor.canMove))))) this.cancelCaster(actor.id);
    else for (const cast of pending) if (!this.conditionsMet(actor, this.actors.find((target) => target.id === cast.targetId), cast.skill.maintainConditions)) {
      if (cast.skill.completionState) this.finishCast(cast); else this.cancelCaster(actor.id);
    }
    if (actor.hardControlled && !this.isDisplaced(actor) && !this.casts.has(actor.id) && actor.fsm.state !== "returning") actor.setState("controlled");
    else if (!actor.hardControlled && actor.fsm.state === "controlled") actor.setState("idle");
  }

  private knockBack(cast: Cast, target: Actor, motion: NonNullable<SkillAction["knockback"]>): void {
    if (!target.alive || target.fsm.state === "returning" || this.displacementImmune(target)) return;
    let direction = target.position.subtract(cast.source.position).normalized();
    if (direction.lengthSquared() === 0) direction = cast.point.subtract(cast.origin).normalized();
    if (direction.lengthSquared() === 0) direction = new Vector2(0, 1);
    if (!target.interruptionImmune) this.cancelCaster(target.id);
    this.displacements.set(target.id, { actor: target, direction, distance: motion.distance, duration: motion.duration, startedAt: this.time, progress: 0 });
    target.setState("displaced");
    this.events.push({ type: "knockback", sourceId: cast.source.id, targetId: target.id, skillId: cast.skill.id, value: motion.distance });
  }

  private hitTargets(cast: Cast, projectile: boolean): Actor[] {
    const { source, skill } = cast;
    const area = skill.area;
    const center = skill.areaAnchor === "caster" ? source.position : skill.target === "self" || area?.shape === "cone" || area?.shape === "line" ? cast.origin : cast.point;
    const forward = cast.direction ?? cast.point.subtract(cast.origin).normalized();
    const candidates = this.actors.filter((actor) => {
      if (!validTarget(source, actor) || (skill.target === "enemy" ? actor.faction === source.faction : actor.faction !== source.faction)) return false;
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
      if (skill.targetCount && area?.shape === "circle" && area.radius <= 10) return cast.primaryIds.indexOf(left.id) - cast.primaryIds.indexOf(right.id);
      return compareTargetPriority(left, right, skill.targetRule) || left.position.distanceSquared(center) - right.position.distanceSquared(center) || left.id.localeCompare(right.id);
    }).slice(0, skill.maxTargets ?? 1);
  }

  private cooldownKey(actor: Actor, skill: SkillDefinition): string { return `${actor.id}:${skill.id}`; }
  private publicKey(actor: Actor, skill: SkillDefinition): string { return `${actor.id}:${skill.publicCooldownGroup ?? "shared"}`; }

  private primaryTargets(source: Actor, first: Actor, skill: SkillDefinition): Actor[] {
    if (!skill.targetCount || skill.target === "self") return [first];
    const pool = this.actors.filter((actor) => validTarget(source, actor) && actor.faction === first.faction && source.position.distance(actor.position) <= skill.range &&
      targetHealthAllowed(actor, skill));
    pool.sort((a, b) => compareTargetPriority(a, b, skill.targetRule) || source.position.distanceSquared(a.position) - source.position.distanceSquared(b.position) || a.id.localeCompare(b.id));
    const rest = pool.filter((actor) => actor !== first), selected = [first];
    while (selected.length < skill.targetCount && rest.length) {
      const index = skill.targetRule === "random" && rest.length > 1 ? Math.min(rest.length - 1, Math.floor(this.random() * rest.length)) : 0;
      selected.push(rest.splice(index, 1)[0]);
    }
    return selected;
  }

  private advanceActions(cast: Cast): void {
    const actions = cast.skill.actions!;
    while (cast.actionIndex < actions.length && cast.startedAt + actions[cast.actionIndex].at / cast.speed <= this.time + 1e-9) {
      const action = actions[cast.actionIndex++];
      this.resolveHit(cast, false, action);
      if (!cast.source.alive || (this.isDisplaced(cast.source) && !cast.source.interruptionImmune) || (cast.triggered ? !this.triggeredCasts.has(cast.id) : this.casts.get(cast.source.id) !== cast)) break;
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
