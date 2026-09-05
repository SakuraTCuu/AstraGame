import type { Actor } from "../actor/Actor";
import type { CombatSystem, SkillDefinition } from "../combat/Combat";
import { EnemyAI } from "./EnemyAI";
import type { Vec2Like } from "../math/Vector2";

export type BossPhase = string;

export interface BossPhaseChange {
  readonly from: BossPhase;
  readonly to: BossPhase;
  readonly healthRatio: number;
}

export class BossAI {
  private phaseValue: BossPhase = "phase1";
  private readonly regularAI: EnemyAI;
  readonly phaseChanges: BossPhaseChange[] = [];
  private readonly thresholds: readonly number[];
  private readonly skills: readonly SkillDefinition[];
  private stage = 0;
  private readonly phaseNames?: readonly string[];

  constructor(skills: SkillDefinition | readonly SkillDefinition[], phaseThresholds: readonly number[] = [0.7, 0.3], phaseNames?: readonly string[]) {
    this.skills = Array.isArray(skills) ? skills : [skills as SkillDefinition];
    this.regularAI = new EnemyAI(this.skills);
    this.thresholds = [...phaseThresholds].sort((a, b) => b - a);
    this.phaseNames = phaseNames;
    if (phaseNames && phaseNames.length !== this.thresholds.length + 1) throw new Error("Boss phase names do not match thresholds");
    this.phaseValue = phaseNames?.[0] ?? "phase1";
    if (this.thresholds.some((value) => value <= 0 || value >= 1) || new Set(this.thresholds).size !== this.thresholds.length) {
      throw new Error("Boss phase thresholds must be unique ratios between zero and one");
    }
  }

  get phase(): BossPhase {
    return this.phaseValue;
  }

  reset(): void { this.stage = 0; this.phaseValue = this.phaseNames?.[0] ?? "phase1"; this.phaseChanges.splice(0); }

  update(boss: Actor, targets: readonly Actor[], combat: CombatSystem, deltaSeconds: number,
    move?: (actor: Actor, target: Vec2Like, deltaSeconds: number) => void): void {
    const ratio = boss.health / boss.stats.maxHealth;
    if (!boss.alive) {
      if (this.phaseValue !== "dead") this.changePhase("dead", ratio);
      return;
    }
    while (this.stage < this.thresholds.length && ratio <= this.thresholds[this.stage]) {
      this.stage += 1;
      this.changePhase(this.phaseNames?.[this.stage] ?? (this.stage === this.thresholds.length ? "enraged" : `phase${this.stage + 1}`), ratio);
    }
    if (boss.hasStatus("enraged") && this.phaseValue !== "enraged") this.changePhase("enraged", ratio);
    else if (this.phaseNames && !boss.hasStatus("enraged") && this.phaseValue === "enraged") this.changePhase(this.phaseNames[this.stage], ratio);
    this.regularAI.update(boss, targets, combat, deltaSeconds, move, this.skills.filter((skill) => (skill.minimumPhase ?? 1) <= this.stage + 1));
  }

  private changePhase(next: BossPhase, healthRatio: number): void {
    this.phaseChanges.push({ from: this.phaseValue, to: next, healthRatio });
    this.phaseValue = next;
  }
}
