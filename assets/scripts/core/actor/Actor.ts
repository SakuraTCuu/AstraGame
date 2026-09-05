import { StateMachine } from "../fsm/StateMachine";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";

export type Faction = "player" | "enemy";
export type ActorState = "idle" | "moving" | "acquiring" | "chasing" | "windup" | "attacking" | "recovering" | "returning" | "dead";

export interface ShieldLayer { readonly key: string; amount: number; remaining: number; }

const TRANSITIONS: Record<ActorState, readonly ActorState[]> = {
  idle: ["moving", "acquiring", "chasing", "windup", "attacking", "recovering", "returning", "dead"],
  moving: ["idle", "acquiring", "chasing", "windup", "attacking", "recovering", "returning", "dead"],
  acquiring: ["idle", "moving", "chasing", "windup", "attacking", "returning", "dead"],
  chasing: ["idle", "moving", "acquiring", "windup", "attacking", "recovering", "returning", "dead"],
  windup: ["idle", "attacking", "recovering", "returning", "dead"],
  attacking: ["idle", "moving", "acquiring", "chasing", "windup", "recovering", "returning", "dead"],
  recovering: ["idle", "moving", "acquiring", "chasing", "windup", "attacking", "returning", "dead"],
  returning: ["idle", "moving", "dead"],
  dead: [],
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
}

export class Actor {
  readonly id: string;
  readonly faction: Faction;
  readonly stats: ActorStats;
  readonly tags: ReadonlySet<string>;
  readonly skillIds: readonly string[];
  readonly fsm: StateMachine<ActorState, Actor>;
  readonly homePosition: Vector2;
  readonly summonerId?: string;
  readonly kind: string;
  readonly displayName: string;
  readonly healthBars: number;
  private readonly shields: ShieldLayer[] = [];
  position: Vector2;
  health: number;
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
    this.stats = options.stats;
    this.tags = new Set(options.tags ?? []);
    this.skillIds = [...(options.skillIds ?? [])];
    this.health = Math.max(0, Math.min(options.stats.maxHealth, options.initialHealth ?? options.stats.maxHealth));
    this.fsm = new StateMachine<ActorState, Actor>(this.health > 0 ? "idle" : "dead");
    for (const from of Object.keys(TRANSITIONS) as ActorState[]) {
      for (const to of TRANSITIONS[from]) this.fsm.allow(from, to, (actor) => to === "dead" ? !actor.alive : actor.alive);
    }
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get shield(): number { return this.shields.reduce((sum, layer) => sum + layer.amount, 0); }

  setState(state: ActorState): void {
    if (this.fsm.state === state) return;
    if (!this.fsm.transition(state, this)) throw new Error(`Invalid actor transition ${this.id}: ${this.fsm.state} -> ${state}`);
  }

  addShield(key: string, amount: number, duration: number): number {
    if (!this.alive || amount <= 0 || duration <= 0) return 0;
    const previous = this.shield;
    const layer = this.shields.find((entry) => entry.key === key);
    if (layer) { layer.amount = Math.max(layer.amount, Math.floor(amount)); layer.remaining = duration; }
    else this.shields.push({ key, amount: Math.floor(amount), remaining: duration });
    return this.shield - previous;
  }

  updateEffects(deltaSeconds: number): void {
    for (let index = this.shields.length - 1; index >= 0; index -= 1) {
      this.shields[index].remaining -= deltaSeconds;
      if (this.shields[index].remaining <= 1e-9 || this.shields[index].amount <= 0) this.shields.splice(index, 1);
    }
  }

  moveTowards(target: Vec2Like, deltaSeconds: number): void {
    if (!this.alive) return;
    this.position = this.position.moveTowards(target, this.stats.moveSpeed * deltaSeconds);
  }

  receiveDamage(rawDamage: number): number {
    if (!this.alive || rawDamage <= 0) return 0;
    let actualDamage = Math.max(1, Math.floor(rawDamage - this.stats.defense));
    for (const layer of this.shields) {
      const absorbed = Math.min(layer.amount, actualDamage);
      layer.amount -= absorbed;
      actualDamage -= absorbed;
    }
    actualDamage = Math.min(this.health, actualDamage);
    this.health = Math.max(0, this.health - actualDamage);
    if (!this.alive) {
      this.setState("dead");
      this.shields.splice(0);
      this.targetId = undefined;
    }
    return actualDamage;
  }

  heal(amount: number): number {
    if (!this.alive || amount <= 0) return 0;
    const previous = this.health;
    this.health = Math.min(this.stats.maxHealth, this.health + Math.floor(amount));
    return this.health - previous;
  }
}
