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
    move?: (actor: Actor, target: Vec2Like, deltaSeconds: number) => void): void {
    if (!enemy.alive) return;
    const current = targets.find((target) => target.id === enemy.targetId && target.alive);
    const target = current && enemy.position.distance(current.position) <= enemy.stats.aggroRange
      ? current
      : selectNearestTarget(enemy, targets, enemy.stats.aggroRange);

    if (!target) {
      enemy.targetId = undefined;
      enemy.fsm.force("idle");
      return;
    }

    enemy.targetId = target.id;
    for (const skill of this.skills) {
      if (enemy.position.distance(target.position) <= skill.range && combat.canUse(enemy, skill)) {
        enemy.fsm.force("attacking");
        combat.use(enemy, target, skill);
        return;
      }
    }

    enemy.fsm.force("chasing");
    if (move) move(enemy, target.position, deltaSeconds);
    else enemy.moveTowards(target.position, deltaSeconds);
  }
}
