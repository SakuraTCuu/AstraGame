import type { Actor } from "../actor/Actor";
import { BossAI } from "../ai/BossAI";
import { EnemyAI } from "../ai/EnemyAI";
import { PlayerAI } from "../ai/PlayerAI";
import { CombatSystem } from "../combat/Combat";
import type { SkillDefinition } from "../combat/Combat";
import type { FogGrid } from "../fog/FogGrid";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";
import { AutoPath } from "../navigation/GridNavigation";
import type { GridNavigation } from "../navigation/GridNavigation";
import { SeededRandom } from "../random/SeededRandom";
import { SquadFormation } from "../squad/SquadFormation";

export interface WorldOptions {
  readonly seed: number;
  readonly navigation: GridNavigation;
  readonly fog: FogGrid;
  readonly players: readonly Actor[];
  readonly enemies: readonly Actor[];
  readonly playerSkill: SkillDefinition;
  readonly enemySkill: SkillDefinition;
  readonly skillDefinitions?: Readonly<Record<string, SkillDefinition>>;
  readonly revealRadius?: number;
  readonly formationOffsets?: readonly Vec2Like[];
  readonly followLeashDistance?: number;
}

export class GameWorld {
  readonly random: SeededRandom;
  readonly combat: CombatSystem;
  readonly players: Actor[];
  readonly enemies: Actor[];
  readonly alliedSummons: Actor[] = [];
  readonly path = new AutoPath();
  readonly formation: SquadFormation;
  readonly bosses = new Map<string, BossAI>();
  elapsedSeconds = 0;
  leaderTravelActive = false;
  autoTravelPaused = false;
  manualControlActive = false;
  private readonly playerAI = new PlayerAI();
  private previousLeaderId?: string;
  private readonly enemyAIs = new Map<string, EnemyAI>();
  private facing = new Vector2(0, 1);
  private readonly revealRadius: number;
  private readonly actorPaths = new Map<string, { goal: Vec2Like; position: Vector2; revision: number; path: AutoPath }>();
  readonly options: WorldOptions;

  constructor(options: WorldOptions) {
    this.options = options;
    this.random = new SeededRandom(options.seed);
    this.combat = new CombatSystem(() => this.random.next());
    this.players = [...options.players];
    this.enemies = [...options.enemies].sort((a, b) => a.id.localeCompare(b.id));
    this.formation = new SquadFormation(this.players, options.formationOffsets);
    this.revealRadius = options.revealRadius ?? 3;
    this.previousLeaderId = this.leader?.id;
    for (const enemy of this.enemies) this.registerEnemyAI(enemy);
  }

  addEnemy(enemy: Actor, phaseThresholds?: readonly number[], phaseNames?: readonly string[]): void {
    if (this.enemies.some((candidate) => candidate.id === enemy.id)) throw new Error(`Duplicate enemy id: ${enemy.id}`);
    this.enemies.push(enemy);
    this.enemies.sort((a, b) => a.id.localeCompare(b.id));
    this.registerEnemyAI(enemy, phaseThresholds, phaseNames);
  }

  removeEnemy(id: string): void {
    const index = this.enemies.findIndex((actor) => actor.id === id);
    if (index >= 0) this.enemies.splice(index, 1);
    const summonIndex = this.alliedSummons.findIndex((actor) => actor.id === id);
    if (summonIndex >= 0) this.alliedSummons.splice(summonIndex, 1);
    this.enemyAIs.delete(id);
    this.bosses.delete(id);
    this.actorPaths.delete(id);
    this.combat.cancelCaster(id);
  }

  get leader(): Actor | undefined { return this.players.find((player) => player.alive); }
  get allActors(): readonly Actor[] { return [...this.players, ...this.alliedSummons, ...this.enemies]; }

  navigateTo(destination: Vec2Like): boolean {
    const leader = this.leader;
    if (!leader?.alive) return false;
    const path = this.options.navigation.findWorldPath(leader.position, destination);
    if (path.length === 0) return false;
    this.path.setPath(path);
    return true;
  }

  setFacing(direction: Vec2Like): void {
    if (Vector2.from(direction).lengthSquared() > 0) this.facing = Vector2.from(direction).normalized();
  }

  get facingDirection(): Vector2 { return this.facing; }

  clearTravel(): void {
    this.path.clear();
    this.actorPaths.clear();
    this.leaderTravelActive = this.autoTravelPaused = this.manualControlActive = false;
    for (const actor of this.allActors) {
      this.combat.cancelCaster(actor.id);
      actor.targetId = undefined;
      if (actor.alive) actor.setState("idle");
    }
  }

  recoverParty(positions: readonly Vec2Like[]): void {
    if (positions.length !== this.players.length || positions.some((point) => !this.options.navigation.isWorldWalkable(point))) throw new Error("Invalid party recovery positions");
    this.clearTravel();
    this.combat.resetEngagement();
    for (const actor of [...this.enemies, ...this.alliedSummons]) if (actor.summonerId) this.removeEnemy(actor.id);
    for (const enemy of this.enemies) if (enemy.alive) {
      enemy.recoverAt(enemy.homePosition);
      this.bosses.get(enemy.id)?.reset();
    }
    this.players.forEach((actor, index) => actor.recoverAt(positions[index]));
    this.previousLeaderId = this.leader?.id;
    if (this.leader) this.options.fog.reveal(this.leader.position, this.revealRadius);
  }

  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    this.elapsedSeconds += deltaSeconds;
    this.combat.update(deltaSeconds, this.allActors, (actor, destination, kind) => {
      actor.position = kind === "jump" ? Vector2.from(destination) :
        this.options.navigation.moveWithCollision(actor.position, Vector2.from(destination).subtract(actor.position));
    });
    const leader = this.leader;
    if (leader?.id !== this.previousLeaderId) {
      this.path.clear();
      this.previousLeaderId = leader?.id;
    }
    if (leader?.alive) {
      const previous = leader.position;
      if (!this.autoTravelPaused) leader.position = this.path.update(leader.position, leader.movementSpeed, deltaSeconds);
      const movement = leader.position.subtract(previous);
      if (movement.lengthSquared() > 0) this.facing = movement.normalized();
      this.options.fog.reveal(leader.position, this.revealRadius);
      this.updatePlayers(deltaSeconds);
      this.formation.update(leader.position, this.facing, deltaSeconds, this.moveActor, leader);
    }
    for (const enemy of this.enemies) {
      const bossAI = this.bosses.get(enemy.id);
      if (bossAI) bossAI.update(enemy, this.players, this.combat, deltaSeconds, this.moveActor);
      else this.enemyAIs.get(enemy.id)?.update(enemy, this.players, this.combat, deltaSeconds, this.moveActor);
    }
  }

  private updatePlayers(deltaSeconds: number): void {
    const leader = this.leader;
    if (!leader) return;
    const allies = [...this.players, ...this.alliedSummons];
    for (const player of allies) {
      this.playerAI.update(player, leader, allies, this.enemies, this.skillsFor(player, this.options.playerSkill),
        this.combat, deltaSeconds, this.leaderTravelActive, this.manualControlActive, this.options.followLeashDistance ?? Infinity, this.moveActor);
      if (player.summonerId && player.alive && player.fsm.state === "idle" && player.position.distance(leader.position) > player.stats.attackRange) {
        player.setState("moving");
        this.moveActor(player, leader.position, deltaSeconds);
      }
    }
  }

  private readonly moveActor = (actor: Actor, target: Vec2Like, deltaSeconds: number): void => {
    const navigation = this.options.navigation;
    const destination = navigation.nearestWalkable(target);
    if (!destination || !navigation.isWorldWalkable(actor.position)) return;
    if (navigation.isSegmentWalkable(actor.position, destination)) {
      this.actorPaths.delete(actor.id);
      actor.moveTowards(destination, deltaSeconds);
      return;
    }
    const goal = navigation.worldToGrid(destination);
    let route = this.actorPaths.get(actor.id);
    if (!route || route.goal.x !== goal.x || route.goal.y !== goal.y || route.revision !== navigation.revision ||
        !route.position.equals(actor.position) || route.path.complete) {
      const points = navigation.findWorldPath(actor.position, destination);
      const path = new AutoPath();
      path.setPath(points);
      route = { goal, position: actor.position, revision: navigation.revision, path };
      this.actorPaths.set(actor.id, route);
    }
    actor.position = route.path.update(actor.position, actor.movementSpeed, deltaSeconds);
    route.position = actor.position;
  };

  private registerEnemyAI(enemy: Actor, phaseThresholds?: readonly number[], phaseNames?: readonly string[]): void {
    const skills = this.skillsFor(enemy, this.options.enemySkill);
    if (enemy.tags.has("boss")) this.bosses.set(enemy.id, new BossAI(skills, phaseThresholds, phaseNames));
    else this.enemyAIs.set(enemy.id, new EnemyAI(skills));
  }

  private skillsFor(actor: Actor, fallback: SkillDefinition): SkillDefinition[] {
    const definitions = this.options.skillDefinitions;
    const skills: SkillDefinition[] = [];
    for (const id of actor.skillIds) {
      const skill = definitions?.[id];
      if (!skill) throw new Error(`Actor ${actor.id} references missing skill ${id}`);
      skills.push(skill);
    }
    return skills.length > 0 ? skills : [fallback];
  }
}

export class WorldSession {
  private accumulator = 0;
  private readonly fixedStep: number;
  readonly world: GameWorld;

  constructor(world: GameWorld, ticksPerSecond = 20) {
    if (ticksPerSecond <= 0) throw new RangeError("ticksPerSecond must be positive");
    this.world = world;
    this.fixedStep = 1 / ticksPerSecond;
  }

  update(realDeltaSeconds: number): number {
    this.accumulator += Math.max(0, realDeltaSeconds);
    let ticks = 0;
    while (this.accumulator + Number.EPSILON >= this.fixedStep) {
      this.world.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
      ticks += 1;
    }
    return ticks;
  }
}
