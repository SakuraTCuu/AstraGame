export type DamageType = "physical" | "magic" | "soul";

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
  readonly dotDamageBonus?: number;
  readonly dotDamageReduction?: number;
}

export interface StatusDefinition {
  readonly id: string;
  readonly duration: number;
  readonly permanent?: boolean;
  readonly group?: string;
  readonly state?: string;
  readonly modifiers?: StatModifiers;
  readonly clearOnReturn?: boolean;
  readonly maxStacks?: number;
  readonly periodicDamage?: {
    readonly interval: number;
    readonly power: number;
    readonly damageType?: DamageType;
    readonly scaleWithStacks?: boolean;
    readonly intervalPerStack?: number;
  };
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
  readonly settleStatus?: { readonly group: string; readonly seconds: number };
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
