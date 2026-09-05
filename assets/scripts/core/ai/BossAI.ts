import type { Actor } from "../actor/Actor";
import type { CombatSystem, SkillDefinition } from "../combat/Combat";
import { EnemyAI } from "./EnemyAI";

export type BossPhase = "phase1" | "phase2" | "enraged" | "dead";

export interface BossPhaseChange {
  readonly from: BossPhase;
  readonly to: BossPhase;
  readonly healthRatio: number;
}

export class BossAI {
  private phaseValue: BossPhase = "phase1";
  private readonly regularAI: EnemyAI;
  readonly phaseChanges: BossPhaseChange[] = [];
  private readonly phase2Threshold: number;
  private readonly enragedThreshold: number;

  constructor(skills: SkillDefinition | readonly SkillDefinition[], phaseThresholds: readonly number[] = [0.7, 0.3]) {
    this.regularAI = new EnemyAI(skills);
    const sorted = [...phaseThresholds].sort((a, b) => b - a);
    this.phase2Threshold = sorted[0] ?? 0.7;
    this.enragedThreshold = sorted[1] ?? 0.3;
  }

  get phase(): BossPhase {
    return this.phaseValue;
  }

  update(boss: Actor, targets: readonly Actor[], combat: CombatSystem, deltaSeconds: number): void {
    const ratio = boss.health / boss.stats.maxHealth;
    const next: BossPhase = !boss.alive ? "dead" : ratio <= this.enragedThreshold ? "enraged" : ratio <= this.phase2Threshold ? "phase2" : "phase1";
    if (next !== this.phaseValue) {
      this.phaseChanges.push({ from: this.phaseValue, to: next, healthRatio: ratio });
      this.phaseValue = next;
    }
    if (boss.alive) this.regularAI.update(boss, targets, combat, deltaSeconds);
  }
}
