import type { Actor } from "../actor/Actor";
import { selectNearestTarget, selectSkillTarget } from "../combat/Combat";
import type { CombatSystem, SkillDefinition } from "../combat/Combat";
import type { Vec2Like } from "../math/Vector2";

export class PlayerAI {
  private readonly regrouping = new Set<string>();

  update(player: Actor, leader: Actor, allies: readonly Actor[], enemies: readonly Actor[], skills: readonly SkillDefinition[],
    combat: CombatSystem, deltaSeconds: number, leaderTravelling: boolean, manualControl: boolean, followLeash: number,
    move: (actor: Actor, target: Vec2Like, deltaSeconds: number) => void): void {
    if (!player.alive || combat.isDisplaced(player) || player.hardControlled) return;
    if (player !== leader && manualControl) {
      combat.cancelCaster(player.id);
      player.targetId = undefined;
      player.setState("idle");
      return;
    }
    const distanceToLeader = player.position.distance(leader.position);
    if (player !== leader && distanceToLeader > followLeash) this.regrouping.add(player.id);
    if (this.regrouping.has(player.id)) {
      if (distanceToLeader <= followLeash / 2) this.regrouping.delete(player.id);
      else {
        combat.cancelCaster(player.id);
        player.targetId = undefined;
        player.setState("idle");
        return;
      }
    }
    if (combat.isBusy(player)) return;
    const opponents = enemies.filter((enemy) => enemy.fsm.state !== "returning");
    const target = selectNearestTarget(player, opponents, player.stats.aggroRange);
    player.targetId = target?.id;
    for (const skill of skills.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
      if (!combat.canUse(player, skill)) continue;
      if ((skill.type === "shield" || skill.type === "summon") && !target) continue;
      const selected = selectSkillTarget(player, skill.target === "enemy" ? opponents : allies, skill);
      if (selected && combat.use(player, selected, skill)) return;
    }
    if (!target) { player.setState("idle"); return; }
    const attackingSkills = skills.filter((skill) => skill.target === "enemy");
    const preferredRange = Math.min(player.stats.attackRange, ...attackingSkills.map((skill) => skill.range));
    if (attackingSkills.length > 0 && player.position.distance(target.position) > preferredRange && !(player === leader && leaderTravelling)) {
      player.setState("chasing");
      move(player, target.position, deltaSeconds);
    } else player.setState("attacking");
  }
}
