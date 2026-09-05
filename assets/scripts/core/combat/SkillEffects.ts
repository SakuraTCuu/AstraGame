export type DamageType = "physical" | "magic" | "soul" | "holy" | "punishment" | "skill";
export type ControlKind = "stun" | "freeze" | "root" | "silence" | "airborne" | "fear";

export interface SkillArea {
  readonly shape: "circle" | "cone" | "line";
  readonly radius: number;
  readonly angleDegrees?: number;
  readonly width?: number;
}

export interface AreaEffectDefinition {
  readonly duration: number;
  readonly interval: number;
  readonly geometry: SkillArea;
  readonly effects: readonly SkillAction[];
  readonly target?: "enemy" | "ally";
  readonly followCaster?: boolean;
  readonly turnSpeedDegrees?: number;
  readonly hitsPerTarget?: number;
  readonly effectKey?: string;
  readonly maxTargets?: number;
  readonly pvpMaxTargets?: number;
  readonly maxTicks?: number;
  readonly phases?: readonly { readonly throughTick: number; readonly effects: readonly SkillAction[] }[];
}

export interface StatusState {
  readonly id: string;
  readonly duration: number;
  readonly control?: ControlKind;
  readonly excludeBoss?: boolean;
  readonly controlImmunity?: readonly ControlKind[];
  readonly displacementImmunity?: boolean;
  readonly interruptionImmunity?: boolean;
  readonly invulnerable?: boolean;
  readonly preventDeath?: boolean;
  readonly untargetable?: boolean;
  readonly healingBlocked?: boolean;
  readonly damageCap?: number;
  readonly lift?: { readonly height: number; readonly rise: number; readonly fall: number };
  readonly wander?: { readonly speed: number; readonly turnInterval: number };
}

export interface StatModifiers {
  readonly attackRate?: number;
  readonly attackSpeedRate?: number;
  readonly normalAttackSpeedRate?: number;
  readonly movementBonus?: number;
  readonly movementSpeedRate?: number;
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
  readonly soulBonus?: number;
  readonly soulReduction?: number;
  readonly maxHealthRate?: number;
  readonly pveDamageReduction?: number;
  readonly energyGainRate?: number;
}

export interface StatusDefinition {
  readonly id: string;
  readonly duration: number;
  readonly permanent?: boolean;
  readonly group?: string;
  readonly state?: string;
  readonly states?: readonly StatusState[];
  readonly blockedByStates?: readonly string[];
  readonly modifiers?: StatModifiers;
  readonly clearOnReturn?: boolean;
  readonly maxStacks?: number;
  readonly targetCountBonuses?: Readonly<Record<string, number>>;
  readonly harmful?: boolean;
  readonly dispellable?: boolean;
  readonly periodicDamage?: {
    readonly interval: number;
    readonly power: number;
    readonly damageType?: DamageType;
    readonly scaleWithStacks?: boolean;
    readonly intervalPerStack?: number;
  };
  readonly periodicSkillEnergy?: { readonly interval: number; readonly amount: number; readonly cap: number };
}

export interface HealingBonus {
  readonly conditions?: SkillConditions;
  readonly chance?: number;
  readonly powerBonus?: number;
  readonly statuses?: readonly { readonly status: StatusDefinition; readonly weight: number }[];
  readonly selection?: "weighted" | "all";
}

export interface SkillTrigger { readonly skillId: string; readonly chance?: number; readonly conditions?: SkillConditions; }

export interface SkillAction {
  readonly at: number;
  readonly type: "damage" | "heal" | "status" | "cleanse" | "remove_state" | "skill_energy" | "area";
  readonly power?: number;
  readonly damageType?: DamageType;
  readonly forceCritical?: boolean;
  readonly recipient?: "targets" | "self" | "allies" | "enemies";
  readonly targetCount?: number;
  readonly globalTargets?: boolean;
  readonly status?: StatusDefinition;
  readonly stateId?: string;
  readonly skillEnergy?: { readonly minimum: number; readonly maximum: number; readonly cap?: number };
  readonly areaEffect?: AreaEffectDefinition;
  readonly powerPerStack?: { readonly group: string; readonly amount: number };
  readonly randomStatuses?: readonly StatusDefinition[];
  readonly healFromDamage?: number;
  readonly healFromDamageRecipient?: "self" | "allies";
  readonly knockback?: { readonly distance: number; readonly duration: number };
  readonly settleStatus?: { readonly group: string; readonly seconds: number };
  readonly healingBonuses?: readonly HealingBonus[];
  readonly cleanse?: { readonly count: number; readonly npcOnly?: boolean };
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
  readonly excludedState?: string;
  readonly uncontrolled?: boolean;
  readonly skillEnergyAtLeast?: number;
  readonly skillEnergyAtMost?: number;
}
