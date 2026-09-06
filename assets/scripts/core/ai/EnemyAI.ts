import type { Actor } from "../actor/Actor";
import { selectNearestTarget } from "../combat/Combat";
import type { CombatSystem, SkillDefinition } from "../combat/Combat";
import type { Vec2Like } from "../math/Vector2";

export class EnemyAI {
  private readonly skills: readonly SkillDefinition[];

  constructor(skills: SkillDefinition | readonly SkillDefinition[]) {
    this.skills = Array.isArray(skills) ? skills : [skills as SkillDefinition];
  }

  update(enemy: Actor, targets: readonly Actor[], combat: CombatSystem, deltaSeconds: number,
    move?: (actor: Actor, target: Vec2Like, deltaSeconds: number) => void, skills: readonly SkillDefinition[] = this.skills): void {
    if (!enemy.alive || combat.isDisplaced(enemy) || enemy.hardControlled) return;
    const leash = enemy.stats.leashRange ?? Infinity;
    const eligible = targets.filter((actor) => actor.targetable && actor.position.distance(enemy.homePosition) <= leash);
    const busy = combat.isBusy(enemy);
    const castingTarget = busy && eligible.find((actor) => actor.id === combat.castingTargetId(enemy));
    const current = targets.find((target) => target.id === enemy.targetId && target.targetable);
    const target = current && eligible.includes(current) && enemy.position.distance(current.position) <= enemy.stats.aggroRange
      ? current
      : selectNearestTarget(enemy, eligible, enemy.stats.aggroRange);

    if (enemy.fsm.state === "returning" || enemy.position.distance(enemy.homePosition) > leash || (!target && !castingTarget)) {
      enemy.targetId = undefined;
      combat.cancelCaster(enemy.id);
      if (enemy.position.distance(enemy.homePosition) > 0.01) {
        enemy.setState("returning");
        if (move) move(enemy, enemy.homePosition, deltaSeconds);
        else enemy.moveTowards(enemy.homePosition, deltaSeconds);
      } else enemy.setState("idle");
      return;
    }

    if (target) enemy.targetId = target.id;
    if (busy) return;
    enemy.setState("acquiring");
    for (const skill of skills.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
      if (!combat.canUse(enemy, skill)) continue;
      const selected = combat.selectTarget(enemy, eligible, skill);
      if (selected && combat.use(enemy, selected, skill)) return;
    }

    const attackRange = Math.min(enemy.stats.attackRange, ...skills.filter((skill) => !skill.disabled && skill.target === "enemy").map((skill) => skill.range));
    if (enemy.position.distance(target.position) > attackRange) {
      enemy.setState("chasing");
      if (move) move(enemy, target.position, deltaSeconds);
      else enemy.moveTowards(target.position, deltaSeconds);
    } else enemy.setState("idle");
  }
}
