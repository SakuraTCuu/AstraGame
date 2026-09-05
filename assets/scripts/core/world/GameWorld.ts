import type { Actor } from "../actor/Actor";
import { BossAI } from "../ai/BossAI";
import { EnemyAI } from "../ai/EnemyAI";
import { CombatSystem, selectNearestTarget } from "../combat/Combat";
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
}

export class GameWorld {
  readonly random: SeededRandom;
  readonly combat = new CombatSystem();
  readonly players: Actor[];
  readonly enemies: Actor[];
  readonly path = new AutoPath();
  readonly formation: SquadFormation;
  readonly bosses = new Map<string, BossAI>();
  elapsedSeconds = 0;
  leaderTravelActive = false;
  private readonly enemyAIs = new Map<string, EnemyAI>();
  private facing = new Vector2(0, 1);
  private readonly revealRadius: number;
  private readonly actorPaths = new Map<string, { goal: Vec2Like; position: Vector2; revision: number; path: AutoPath }>();
  readonly options: WorldOptions;

  constructor(options: WorldOptions) {
    this.options = options;
    this.random = new SeededRandom(options.seed);
    this.players = [...options.players];
    this.enemies = [...options.enemies].sort((a, b) => a.id.localeCompare(b.id));
    this.formation = new SquadFormation(this.players, options.formationOffsets);
    this.revealRadius = options.revealRadius ?? 3;
    for (const enemy of this.enemies) this.registerEnemyAI(enemy);
  }

  addEnemy(enemy: Actor, phaseThresholds?: readonly number[]): void {
    if (this.enemies.some((candidate) => candidate.id === enemy.id)) throw new Error(`Duplicate enemy id: ${enemy.id}`);
    this.enemies.push(enemy);
    this.enemies.sort((a, b) => a.id.localeCompare(b.id));
    this.registerEnemyAI(enemy, phaseThresholds);
  }

  navigateTo(destination: Vec2Like): boolean {
    const leader = this.players[0];
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

  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    this.elapsedSeconds += deltaSeconds;
    this.combat.update(deltaSeconds, [...this.players, ...this.enemies]);
    const leader = this.players[0];
    if (leader?.alive) {
      const previous = leader.position;
      leader.position = this.path.update(leader.position, leader.stats.moveSpeed, deltaSeconds);
      const movement = leader.position.subtract(previous);
      if (movement.lengthSquared() > 0) this.facing = movement.normalized();
      this.options.fog.reveal(leader.position, this.revealRadius);
      this.updatePlayers(deltaSeconds);
      this.formation.update(leader.position, this.facing, deltaSeconds, this.moveActor);
    }
    for (const enemy of this.enemies) {
      const bossAI = this.bosses.get(enemy.id);
      if (bossAI) bossAI.update(enemy, this.players, this.combat, deltaSeconds, this.moveActor);
      else this.enemyAIs.get(enemy.id)?.update(enemy, this.players, this.combat, deltaSeconds, this.moveActor);
    }
  }

  private updatePlayers(deltaSeconds: number): void {
    for (const player of this.players) {
      if (!player.alive) continue;
      const skills = this.skillsFor(player, this.options.playerSkill);
      let usedSkill = false;
      for (const skill of skills) {
        if (skill.target !== "ally" || !this.combat.canUse(player, skill)) continue;
        const ally = this.players
          .filter((candidate) => candidate.alive && candidate.health < candidate.stats.maxHealth && player.position.distance(candidate.position) <= skill.range)
          .sort((left, right) => left.health / left.stats.maxHealth - right.health / right.stats.maxHealth || left.id.localeCompare(right.id))[0];
        if (ally && this.combat.use(player, ally, skill)) {
          player.fsm.force("attacking");
          usedSkill = true;
          break;
        }
      }
      if (usedSkill) continue;
      const target = selectNearestTarget(player, this.enemies, player.stats.aggroRange);
      if (!target) {
        player.targetId = undefined;
        if (player.fsm.state === "chasing" || player.fsm.state === "attacking") player.fsm.force("idle");
        continue;
      }
      player.targetId = target.id;
      for (const skill of skills) {
        if (skill.target !== "enemy" || !this.combat.canUse(player, skill)) continue;
        if (player.position.distance(target.position) <= skill.range && this.combat.use(player, target, skill)) {
          player.fsm.force("attacking");
          usedSkill = true;
          break;
        }
      }
      if (!usedSkill) {
        const damageSkills = skills.filter((skill) => skill.target === "enemy");
        const maximumRange = damageSkills.reduce((maximum, skill) => Math.max(maximum, skill.range), player.stats.attackRange);
        if (player.position.distance(target.position) > maximumRange && !(player === this.players[0] && this.leaderTravelActive)) {
          player.fsm.force("chasing");
          this.moveActor(player, target.position, deltaSeconds);
        }
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
    actor.position = route.path.update(actor.position, actor.stats.moveSpeed, deltaSeconds);
    route.position = actor.position;
  };

  private registerEnemyAI(enemy: Actor, phaseThresholds?: readonly number[]): void {
    const skills = this.skillsFor(enemy, this.options.enemySkill).filter((skill) => skill.target === "enemy");
    if (enemy.tags.has("boss")) this.bosses.set(enemy.id, new BossAI(skills, phaseThresholds));
    else this.enemyAIs.set(enemy.id, new EnemyAI(skills));
  }

  private skillsFor(actor: Actor, fallback: SkillDefinition): SkillDefinition[] {
    const definitions = this.options.skillDefinitions;
    const skills: SkillDefinition[] = [];
    for (const id of actor.skillIds) {
      const skill = definitions?.[id];
      if (skill) skills.push(skill);
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
