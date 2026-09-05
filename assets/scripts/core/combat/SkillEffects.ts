export type DamageType = "physical" | "magic";

export interface StatModifiers {
  readonly attackRate?: number;
  readonly attackSpeedRate?: number;
  readonly normalAttackSpeedRate?: number;
  readonly movementBonus?: number;
  readonly damageBonus?: number;
  readonly finalDamageBonus?: number;
  readonly damageReduction?: number;
  readonly finalDamageReduction?: number;
  readonly physicalBonus?: number;
  readonly magicBonus?: number;
  readonly physicalReduction?: number;
  readonly magicReduction?: number;
  readonly criticalChance?: number;
  readonly healReduction?: number;
}

export interface StatusDefinition {
  readonly id: string;
  readonly duration: number;
  readonly permanent?: boolean;
  readonly group?: string;
  readonly state?: string;
  readonly modifiers?: StatModifiers;
  readonly clearOnReturn?: boolean;
}

export interface SkillAction {
  readonly at: number;
  readonly type: "damage" | "heal" | "status";
  readonly power?: number;
  readonly damageType?: DamageType;
  readonly forceCritical?: boolean;
  readonly recipient?: "targets" | "self" | "allies" | "enemies";
  readonly targetCount?: number;
  readonly status?: StatusDefinition;
  readonly randomStatuses?: readonly StatusDefinition[];
  readonly healFromDamage?: number;
}

export interface SkillMotion {
  readonly kind: "charge" | "jump";
  readonly duration: number;
  readonly distance?: number;
  readonly height?: number;
}

export interface SkillConditions {
  readonly inCombat?: boolean;
  readonly casterHpAtMost?: number;
  readonly targetHpBelow?: number;
  readonly combatTimeAtLeast?: number;
  readonly requiredState?: string;
}
