import type { Actor } from "../actor/Actor";

export interface SkillDefinition {
  readonly id: string;
  readonly range: number;
  readonly cooldown: number;
  readonly power: number;
  readonly target: "enemy" | "ally";
  readonly type?: "damage" | "heal" | "telegraph_damage";
  readonly telegraph?: number;
  readonly maxTargets?: number;
}

export interface CombatEvent {
  readonly type: "damage" | "heal" | "death" | "skill" | "telegraph";
  readonly sourceId: string;
  readonly targetId: string;
  readonly value?: number;
  readonly skillId?: string;
}

interface PendingTelegraph {
  readonly sourceId: string;
  readonly targetId: string;
  readonly skill: SkillDefinition;
  remaining: number;
}

export function selectNearestTarget(source: Actor, candidates: readonly Actor[], range: number): Actor | undefined {
  const rangeSquared = range * range;
  return candidates
    .filter((candidate) => candidate.alive && candidate.id !== source.id)
    .map((candidate) => ({ candidate, distance: source.position.distanceSquared(candidate.position) }))
    .filter(({ distance }) => distance <= rangeSquared)
    .sort((left, right) => left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id))[0]?.candidate;
}

export class CombatSystem {
  private readonly cooldowns = new Map<string, number>();
  private readonly pendingTelegraphs: PendingTelegraph[] = [];
  readonly events: CombatEvent[] = [];

  updateCooldowns(deltaSeconds: number): void {
    for (const [key, remaining] of this.cooldowns) {
      const next = remaining - deltaSeconds;
      if (next <= 0) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }
  }

  update(deltaSeconds: number, actors: readonly Actor[]): void {
    this.updateCooldowns(deltaSeconds);
    for (let index = this.pendingTelegraphs.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingTelegraphs[index]!;
      pending.remaining -= deltaSeconds;
      if (pending.remaining > 0) continue;
      this.pendingTelegraphs.splice(index, 1);
      const source = actors.find((actor) => actor.id === pending.sourceId);
      const target = actors.find((actor) => actor.id === pending.targetId);
      if (!source?.alive || !target?.alive) continue;
      this.applyDamage(source, target, pending.skill);
    }
  }

  canUse(actor: Actor, skill: SkillDefinition): boolean {
    return actor.alive && !this.cooldowns.has(this.cooldownKey(actor, skill));
  }

  use(actor: Actor, target: Actor, skill: SkillDefinition): boolean {
    if (!this.canUse(actor, skill) || !target.alive || actor.position.distance(target.position) > skill.range) return false;
    if (skill.target === "enemy" && actor.faction === target.faction) return false;
    if (skill.target === "ally" && actor.faction !== target.faction) return false;

    this.cooldowns.set(this.cooldownKey(actor, skill), skill.cooldown);
    this.events.push({ type: "skill", sourceId: actor.id, targetId: target.id, skillId: skill.id });
    if (skill.type === "telegraph_damage") {
      this.pendingTelegraphs.push({ sourceId: actor.id, targetId: target.id, skill, remaining: skill.telegraph ?? 0 });
      this.events.push({ type: "telegraph", sourceId: actor.id, targetId: target.id, value: skill.telegraph ?? 0, skillId: skill.id });
    } else if (skill.target === "enemy") {
      this.applyDamage(actor, target, skill);
    } else {
      const healing = target.heal(actor.stats.attack * skill.power);
      this.events.push({ type: "heal", sourceId: actor.id, targetId: target.id, value: healing, skillId: skill.id });
    }
    return true;
  }

  private applyDamage(actor: Actor, target: Actor, skill: SkillDefinition): void {
    const wasAlive = target.alive;
    const damage = target.receiveDamage(actor.stats.attack * skill.power);
    this.events.push({ type: "damage", sourceId: actor.id, targetId: target.id, value: damage, skillId: skill.id });
    if (wasAlive && !target.alive) this.events.push({ type: "death", sourceId: actor.id, targetId: target.id, skillId: skill.id });
  }

  drainEvents(): CombatEvent[] {
    return this.events.splice(0);
  }

  private cooldownKey(actor: Actor, skill: SkillDefinition): string {
    return `${actor.id}:${skill.id}`;
  }
}
