import { StateMachine } from "../fsm/StateMachine";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";
import type { ControlKind, DamageType, StatModifiers, StatusDefinition, StatusState } from "../combat/SkillEffects";

export type Faction = "player" | "enemy";
export type ActorState = "idle" | "moving" | "acquiring" | "chasing" | "windup" | "attacking" | "recovering" | "displaced" | "controlled" | "returning" | "dead";

export interface ShieldLayer { readonly key: string; amount: number; remaining: number; }
interface AppliedStatus { definition: StatusDefinition; remaining: number; stacks: number; elapsed: number; source: Actor; skillId: string; fromPlayer: boolean; }
interface AppliedState { readonly definition: StatusState; readonly owner: AppliedStatus; readonly initialElevation: number; remaining: number; elapsed: number; direction?: Vector2; nextTurn?: number; }
export interface PeriodicDamageTick { readonly source: Actor; readonly skillId: string; readonly statusId: string; readonly power: number; readonly damageType: DamageType; }

const TRANSITIONS: Record<ActorState, readonly ActorState[]> = {
  idle: ["moving", "acquiring", "chasing", "windup", "attacking", "recovering", "returning", "dead"],
  moving: ["idle", "acquiring", "chasing", "windup", "attacking", "recovering", "returning", "dead"],
  acquiring: ["idle", "moving", "chasing", "windup", "attacking", "returning", "dead"],
  chasing: ["idle", "moving", "acquiring", "windup", "attacking", "recovering", "returning", "dead"],
  windup: ["idle", "attacking", "recovering", "returning", "dead"],
  attacking: ["idle", "moving", "acquiring", "chasing", "windup", "recovering", "returning", "dead"],
  recovering: ["idle", "moving", "acquiring", "chasing", "windup", "attacking", "returning", "dead"],
  returning: ["idle", "moving", "dead"],
  displaced: ["idle", "windup", "attacking", "recovering", "controlled", "returning", "dead"],
  controlled: ["idle", "displaced", "returning", "dead"],
  dead: ["idle"],
};

export interface ActorStats {
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
  readonly moveSpeed: number;
  readonly attackRange: number;
  readonly aggroRange: number;
  readonly leashRange?: number;
  readonly collisionRadius?: number;
  readonly modifiers?: StatModifiers;
  readonly maxEnergy?: number;
  readonly energyPerSecond?: number;
  readonly energyOnSkill?: number;
  readonly energyOnNormal?: number;
  readonly energyOnDamage?: number;
  readonly criticalMultiplier?: number;
}

export interface ActorOptions {
  readonly id: string;
  readonly faction: Faction;
  readonly position: Vec2Like;
  readonly stats: ActorStats;
  readonly tags?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly initialHealth?: number;
  readonly summonerId?: string;
  readonly kind?: string;
  readonly name?: string;
  readonly healthBars?: number;
  readonly initialEnergy?: number;
}

export function applyMaxHealthModifier(stats: ActorStats, rate = stats.modifiers?.maxHealthRate ?? 0): ActorStats {
  return rate === 0 ? stats : { ...stats, maxHealth: Math.max(1, Math.floor(stats.maxHealth * Math.max(0, 1 + rate))) };
}

export class Actor {
  readonly id: string;
  readonly faction: Faction;
  private currentStats: ActorStats;
  private modifiedStats: ActorStats;
  readonly tags: ReadonlySet<string>;
  readonly skillIds: readonly string[];
  readonly fsm: StateMachine<ActorState, Actor>;
  readonly homePosition: Vector2;
  readonly summonerId?: string;
  readonly kind: string;
  readonly displayName: string;
  readonly healthBars: number;
  private readonly shields: ShieldLayer[] = [];
  private readonly statuses: AppliedStatus[] = [];
  private readonly states: AppliedState[] = [];
  position: Vector2;
  health: number;
  energy: number;
  targetId?: string;

  constructor(options: ActorOptions) {
    if (options.stats.maxHealth <= 0) throw new RangeError("Actor maxHealth must be positive");
    this.id = options.id;
    this.faction = options.faction;
    this.position = Vector2.from(options.position);
    this.homePosition = this.position;
    this.summonerId = options.summonerId;
    this.kind = options.kind ?? (options.tags?.includes("boss") ? "boss" : options.faction === "player" ? "hero" : "normal");
    this.displayName = options.name ?? options.id;
    this.healthBars = Math.max(1, Math.floor(options.healthBars ?? 1));
    this.currentStats = options.stats;
    this.modifiedStats = applyMaxHealthModifier(options.stats);
    this.tags = new Set(options.tags ?? []);
    this.skillIds = [...(options.skillIds ?? [])];
    this.health = Math.max(0, Math.min(this.stats.maxHealth, options.initialHealth ?? this.stats.maxHealth));
    this.energy = Math.max(0, Math.min(options.stats.maxEnergy ?? 0, options.initialEnergy ?? 0));
    this.fsm = new StateMachine<ActorState, Actor>(this.health > 0 ? "idle" : "dead");
    for (const from of Object.keys(TRANSITIONS) as ActorState[]) {
      for (const to of TRANSITIONS[from]) this.fsm.allow(from, to, (actor) => to === "dead" ? !actor.alive : actor.alive);
      if (from !== "dead" && from !== "returning" && from !== "displaced") this.fsm.allow(from, "displaced", (actor) => actor.alive);
      if (from !== "dead" && from !== "returning" && from !== "controlled") this.fsm.allow(from, "controlled", (actor) => actor.alive);
    }
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get stats(): ActorStats { return this.modifiedStats; }
  get baseStats(): ActorStats { return this.currentStats; }
  get persistentHealth(): number {
    return this.alive ? Math.max(1, Math.round(this.health / this.stats.maxHealth * applyMaxHealthModifier(this.currentStats).maxHealth)) : 0;
  }
  updateStats(stats: ActorStats): void {
    if (![stats.maxHealth, stats.attack, stats.defense, stats.moveSpeed, stats.attackRange, stats.aggroRange].every(Number.isFinite) ||
        stats.maxHealth <= 0 || Math.min(stats.attack, stats.defense, stats.moveSpeed, stats.attackRange, stats.aggroRange) < 0) throw new Error("Invalid actor growth stats");
    const ratio = this.health / this.stats.maxHealth;
    this.currentStats = stats;
    this.modifiedStats = applyMaxHealthModifier(stats, this.modifier("maxHealthRate"));
    this.health = this.alive ? Math.min(this.stats.maxHealth, Math.max(1, Math.round(ratio * this.stats.maxHealth))) : 0;
    this.energy = Math.min(this.energy, stats.maxEnergy ?? 0);
  }

  get shield(): number { return this.shields.reduce((sum, layer) => sum + layer.amount, 0); }
  get attackPower(): number { return Math.max(0, this.stats.attack * (1 + this.modifier("attackRate"))); }
  get movementSpeed(): number { return Math.max(0, this.stats.moveSpeed + this.modifier("movementBonus")); }
  modifier(key: keyof StatModifiers): number { return (this.currentStats.modifiers?.[key] ?? 0) + this.statuses.reduce((value, status) => value + (status.definition.modifiers?.[key] ?? 0) * status.stacks, 0); }
  hasStatus(state: string): boolean { return this.states.some((entry) => entry.definition.id === state) || this.statuses.some((entry) => entry.definition.id === state || entry.definition.group === state); }
  hasControl(kind: ControlKind): boolean { return this.states.some((entry) => entry.definition.control === kind); }
  get controlled(): boolean { return this.states.some((entry) => Boolean(entry.definition.control)); }
  get hardControlled(): boolean { return this.hasControl("stun") || this.hasControl("freeze") || this.hasControl("airborne") || this.hasControl("fear"); }
  get canMove(): boolean { return this.alive && this.fsm.state !== "displaced" && !this.hardControlled && !this.hasControl("root"); }
  blocksCasting(category = "skill"): boolean { return this.hardControlled || (category !== "normal" && this.hasControl("silence")); }
  get interruptionImmune(): boolean { return this.states.some((entry) => entry.definition.interruptionImmunity) || this.hasStatus("ignoreBreakSkill"); }
  get displacementImmune(): boolean { return this.states.some((entry) => entry.definition.displacementImmunity) || ["unForceMove", "ignoreControl", "notControl"].some((state) => this.hasStatus(state) || this.tags.has(state)); }
  private controlImmune(kind: ControlKind): boolean {
    return this.states.some((entry) => entry.definition.controlImmunity?.includes(kind)) || ["ignoreControl", "notControl"].some((state) => this.hasStatus(state) || this.tags.has(state));
  }
  controlSnapshots(): Array<{ kind: ControlKind; remaining: number }> { return this.states.filter((entry) => entry.definition.control).map((entry) => ({ kind: entry.definition.control!, remaining: entry.remaining })); }
  stateSnapshots(): Array<{ id: string; remaining: number }> { return this.states.map((entry) => ({ id: entry.definition.id, remaining: entry.remaining })); }
  get controlElevation(): number {
    return this.states.reduce((height, state) => {
      const lift = state.definition.lift;
      if (!lift) return height;
      const peak = Math.max(lift.height, state.initialElevation);
      const elevation = state.elapsed < lift.rise ? state.initialElevation + (peak - state.initialElevation) * (1 - Math.pow(1 - state.elapsed / lift.rise, 2)) :
        state.remaining < lift.fall ? peak * (1 - Math.pow(1 - Math.max(0, state.remaining) / lift.fall, 2)) : peak;
      return Math.max(height, Math.max(0, elevation));
    }, 0);
  }
  advanceControlMovement(deltaSeconds: number, random: () => number, move: (destination: Vec2Like) => void): void {
    if (!this.alive || this.fsm.state === "displaced" || ["stun", "freeze", "airborne", "root"].some((kind) => this.hasControl(kind as ControlKind))) return;
    const state = this.states.find((entry) => entry.definition.control === "fear" && entry.definition.wander);
    if (!state) return;
    const wander = state.definition.wander!;
    let age = state.elapsed, remaining = Math.min(deltaSeconds, state.remaining === -1 ? deltaSeconds : state.remaining);
    while (remaining > 1e-9) {
      if (!state.direction || age + 1e-9 >= state.nextTurn!) {
        const angle = random() * Math.PI * 2;
        state.direction = new Vector2(Math.cos(angle), Math.sin(angle)); state.nextTurn = age + wander.turnInterval;
      }
      const duration = Math.min(remaining, state.nextTurn! - age);
      move(this.position.add(state.direction.scale(wander.speed * duration)));
      age += duration; remaining -= duration;
    }
  }
  targetCountBonus(group: string): number { return this.statuses.reduce((total, entry) => total + (entry.definition.targetCountBonuses?.[group] ?? 0) * entry.stacks, 0); }
  statusSnapshots(): Array<{ id: string; remaining: number; stacks: number }> { return this.statuses.map((entry) => ({ id: entry.definition.id, remaining: entry.remaining, stacks: entry.stacks })); }
  addStatus(definition: StatusDefinition, source: Actor = this, skillId = definition.id, fromPlayer = source.faction === "player" || source.kind === "hero"): boolean {
    if (!this.alive || (!definition.permanent && definition.duration <= 0) || definition.blockedByStates?.some((state) => this.hasStatus(state) || this.tags.has(state))) return false;
    const requested = definition.states ?? (definition.state ? [{ id: definition.state, duration: definition.permanent ? -1 : definition.duration }] : []);
    const states = requested.filter((state) => !(state.excludeBoss && (this.kind === "boss" || this.tags.has("boss"))) && (!state.control || !this.controlImmune(state.control)));
    if (requested.length && !states.length && !Object.keys(definition.modifiers ?? {}).length && !definition.periodicDamage && !definition.targetCountBonuses) return false;
    const existing = this.statuses.find((entry) => (entry.definition.group ?? entry.definition.id) === (definition.group ?? definition.id));
    const remaining = definition.permanent ? -1 : definition.duration;
    if (existing) {
      existing.stacks = Math.min(definition.maxStacks ?? 1, existing.stacks + 1);
      existing.fromPlayer = (definition.maxStacks ?? 1) > 1 ? existing.fromPlayer || fromPlayer : fromPlayer;
      existing.definition = definition; existing.remaining = remaining; existing.source = source; existing.skillId = skillId;
    }
    const owner = existing ?? { definition, remaining, stacks: 1, elapsed: 0, source, skillId, fromPlayer };
    if (!existing) this.statuses.push(owner);
    const initialElevation = this.controlElevation;
    for (let index = this.states.length - 1; index >= 0; index--) if ((this.states[index].owner.definition.group ?? this.states[index].owner.definition.id) === (definition.group ?? definition.id)) this.states.splice(index, 1);
    for (const state of states) this.states.push({ definition: state, owner, remaining: state.duration, elapsed: 0, initialElevation });
    this.refreshHealthModifier();
    return true;
  }

  cleanse(count: number, npcOnly: boolean, random: () => number): string[] {
    const candidates = [...new Set([...this.statuses, ...this.states.map((entry) => entry.owner)])].filter((entry) => entry.definition.harmful && entry.definition.dispellable !== false && (!npcOnly || !entry.fromPlayer));
    const removed: string[] = [];
    while (removed.length < count && candidates.length) {
      const [entry] = candidates.splice(Math.min(candidates.length - 1, Math.floor(random() * candidates.length)), 1);
      const index = this.statuses.indexOf(entry); if (index >= 0) this.statuses.splice(index, 1);
      for (let state = this.states.length - 1; state >= 0; state--) if (this.states[state].owner === entry) this.states.splice(state, 1);
      removed.push(entry.definition.id);
    }
    this.refreshHealthModifier(); return removed;
  }

  settlePeriodicStatus(group: string, seconds: number): PeriodicDamageTick[] {
    const ticks: PeriodicDamageTick[] = [];
    for (const status of this.statuses) {
      if ((status.definition.group ?? status.definition.id) !== group || !status.definition.periodicDamage) continue;
      const count = Math.floor((seconds + 1e-9) / this.statusInterval(status));
      for (let index = 0; index < count; index++) ticks.push(this.statusTick(status));
    }
    return ticks;
  }
  gainEnergy(amount: number): void {
    if (this.alive) this.energy = Math.max(0, Math.min(this.stats.maxEnergy ?? 0, this.energy + (amount > 0 ? amount * Math.max(0, 1 + this.modifier("energyGainRate")) : amount)));
  }

  recoverAt(position: Vec2Like): void {
    if (![position.x, position.y].every(Number.isFinite)) throw new Error("Invalid recovery position");
    this.position = Vector2.from(position);
    this.energy = 0;
    this.targetId = undefined;
    this.shields.splice(0);
    this.statuses.splice(0);
    this.states.splice(0);
    this.modifiedStats = applyMaxHealthModifier(this.currentStats);
    this.health = this.stats.maxHealth;
    this.setState("idle");
  }

  setState(state: ActorState): void {
    if (this.fsm.state === state) return;
    if (!this.fsm.transition(state, this)) throw new Error(`Invalid actor transition ${this.id}: ${this.fsm.state} -> ${state}`);
    if (state === "returning") {
      for (let index = this.statuses.length - 1; index >= 0; index--) if (this.statuses[index].definition.clearOnReturn) this.statuses.splice(index, 1);
      for (let index = this.states.length - 1; index >= 0; index--) if (this.states[index].owner.definition.clearOnReturn) this.states.splice(index, 1);
      this.refreshHealthModifier();
    }
  }

  addShield(key: string, amount: number, duration: number): number {
    if (!this.alive || amount <= 0 || duration <= 0) return 0;
    const previous = this.shield;
    const layer = this.shields.find((entry) => entry.key === key);
    if (layer) { layer.amount = Math.max(layer.amount, Math.floor(amount)); layer.remaining = duration; }
    else this.shields.push({ key, amount: Math.floor(amount), remaining: duration });
    return this.shield - previous;
  }

  updateEffects(deltaSeconds: number): PeriodicDamageTick[] {
    const ticks: PeriodicDamageTick[] = [];
    this.gainEnergy((this.stats.energyPerSecond ?? 0) * deltaSeconds);
    for (let index = this.states.length - 1; index >= 0; index--) {
      this.states[index].elapsed += Math.min(deltaSeconds, this.states[index].remaining === -1 ? deltaSeconds : this.states[index].remaining);
      if (this.states[index].remaining === -1) continue;
      this.states[index].remaining -= deltaSeconds;
      if (this.states[index].remaining <= 1e-9) this.states.splice(index, 1);
    }
    for (let index = this.statuses.length - 1; index >= 0; index--) {
      const status = this.statuses[index];
      if (status.definition.periodicDamage) {
        status.elapsed += status.definition.permanent ? deltaSeconds : Math.min(deltaSeconds, status.remaining);
        const interval = this.statusInterval(status);
        while (status.elapsed + 1e-9 >= interval) { ticks.push(this.statusTick(status)); status.elapsed = Math.max(0, status.elapsed - interval); }
      }
      if (status.definition.permanent) continue;
      status.remaining -= deltaSeconds;
      if (status.remaining <= 1e-9) this.statuses.splice(index, 1);
    }
    for (let index = this.shields.length - 1; index >= 0; index -= 1) {
      this.shields[index].remaining -= deltaSeconds;
      if (this.shields[index].remaining <= 1e-9 || this.shields[index].amount <= 0) this.shields.splice(index, 1);
    }
    this.refreshHealthModifier();
    return ticks;
  }

  private refreshHealthModifier(): void {
    const next = applyMaxHealthModifier(this.currentStats, this.modifier("maxHealthRate"));
    if (next.maxHealth === this.stats.maxHealth) return;
    this.health = this.alive ? Math.max(1, Math.min(next.maxHealth, Math.round(this.health / this.stats.maxHealth * next.maxHealth))) : 0;
    this.modifiedStats = next;
  }

  private statusInterval(status: AppliedStatus): number { return Math.max(0.001, status.definition.periodicDamage!.interval + (status.definition.periodicDamage!.intervalPerStack ?? 0) * status.stacks); }
  private statusTick(status: AppliedStatus): PeriodicDamageTick {
    const effect = status.definition.periodicDamage!;
    return { source: status.source, skillId: status.skillId, statusId: status.definition.id, damageType: effect.damageType ?? "physical",
      power: effect.power * (effect.scaleWithStacks ? status.stacks : 1) };
  }

  moveTowards(target: Vec2Like, deltaSeconds: number): void {
    if (!this.canMove) return;
    this.position = this.position.moveTowards(target, this.movementSpeed * deltaSeconds);
  }

  receiveDamage(rawDamage: number, type: DamageType = "physical", periodic = false, pve = true): number {
    if (!this.alive || rawDamage <= 0) return 0;
    const elementReduction = type === "soul" ? this.modifier("soulReduction") : type === "magic" ? this.modifier("magicReduction") : type === "physical" ? this.modifier("physicalReduction") : 0;
    const reduction = (1 - this.modifier("damageReduction")) * (1 - this.modifier("finalDamageReduction")) *
      (1 - elementReduction) *
      (pve ? Math.max(0, 1 - this.modifier("pveDamageReduction")) : 1) *
      (periodic ? Math.max(0, 1 - this.modifier("dotDamageReduction")) : 1);
    if (reduction <= 0) return 0;
    let actualDamage = Math.max(1, Math.floor((rawDamage - this.stats.defense) * Math.max(0, reduction) + 1e-9));
    for (const layer of this.shields) {
      const absorbed = Math.min(layer.amount, actualDamage);
      layer.amount -= absorbed;
      actualDamage -= absorbed;
    }
    actualDamage = Math.min(this.health, actualDamage);
    this.health = Math.max(0, this.health - actualDamage);
    if (actualDamage > 0) this.gainEnergy(this.stats.energyOnDamage ?? 0);
    if (!this.alive) {
      this.setState("dead");
      this.shields.splice(0);
      this.statuses.splice(0);
      this.states.splice(0);
      this.refreshHealthModifier();
      this.targetId = undefined;
    }
    return actualDamage;
  }

  heal(amount: number): number {
    if (!this.alive || amount <= 0) return 0;
    const previous = this.health;
    this.health = Math.min(this.stats.maxHealth, this.health + Math.floor(amount * Math.max(0, 1 - this.modifier("healReduction"))));
    return this.health - previous;
  }
}
