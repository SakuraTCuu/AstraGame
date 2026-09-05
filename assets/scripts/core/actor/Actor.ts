import { StateMachine } from "../fsm/StateMachine";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";

export type Faction = "player" | "enemy";
export type ActorState = "idle" | "moving" | "chasing" | "attacking" | "dead";

export interface ActorStats {
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
  readonly moveSpeed: number;
  readonly attackRange: number;
  readonly aggroRange: number;
}

export interface ActorOptions {
  readonly id: string;
  readonly faction: Faction;
  readonly position: Vec2Like;
  readonly stats: ActorStats;
  readonly tags?: readonly string[];
  readonly skillIds?: readonly string[];
}

export class Actor {
  readonly id: string;
  readonly faction: Faction;
  readonly stats: ActorStats;
  readonly tags: ReadonlySet<string>;
  readonly skillIds: readonly string[];
  readonly fsm: StateMachine<ActorState, Actor>;
  position: Vector2;
  health: number;
  targetId?: string;

  constructor(options: ActorOptions) {
    if (options.stats.maxHealth <= 0) throw new RangeError("Actor maxHealth must be positive");
    this.id = options.id;
    this.faction = options.faction;
    this.position = Vector2.from(options.position);
    this.stats = options.stats;
    this.tags = new Set(options.tags ?? []);
    this.skillIds = [...(options.skillIds ?? [])];
    this.health = options.stats.maxHealth;
    this.fsm = new StateMachine<ActorState, Actor>("idle")
      .allow("idle", "moving")
      .allow("idle", "chasing")
      .allow("idle", "attacking")
      .allow("moving", "idle")
      .allow("moving", "chasing")
      .allow("moving", "attacking")
      .allow("chasing", "idle")
      .allow("chasing", "attacking")
      .allow("attacking", "idle")
      .allow("attacking", "chasing");
  }

  get alive(): boolean {
    return this.health > 0;
  }

  moveTowards(target: Vec2Like, deltaSeconds: number): void {
    if (!this.alive) return;
    this.position = this.position.moveTowards(target, this.stats.moveSpeed * deltaSeconds);
  }

  receiveDamage(rawDamage: number): number {
    if (!this.alive || rawDamage <= 0) return 0;
    const actualDamage = Math.max(1, Math.floor(rawDamage - this.stats.defense));
    this.health = Math.max(0, this.health - actualDamage);
    if (!this.alive) {
      this.fsm.force("dead");
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
