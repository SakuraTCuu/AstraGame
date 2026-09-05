export type ProgressCondition =
  | { readonly kind: "level"; readonly value: number; readonly label?: string }
  | { readonly kind: "rank"; readonly value: number; readonly label?: string }
  | { readonly kind: "flag"; readonly id: string; readonly label?: string }
  | { readonly kind: "all"; readonly conditions: readonly ProgressCondition[] }
  | { readonly kind: "any"; readonly conditions: readonly ProgressCondition[] };

export interface ConditionContext { readonly level: number; readonly rank: number; hasFlag(id: string): boolean; }

export function validateCondition(condition: ProgressCondition, depth = 0): void {
  if (!condition || depth > 12) throw new Error("Invalid progression condition");
  if (condition.kind === "all" || condition.kind === "any") {
    if (!Array.isArray(condition.conditions) || !condition.conditions.length) throw new Error("Empty progression condition");
    condition.conditions.forEach((entry) => validateCondition(entry, depth + 1));
  } else if (condition.kind === "flag") {
    if (typeof condition.id !== "string" || !condition.id) throw new Error("Invalid progression flag");
  } else if (condition.kind === "level" || condition.kind === "rank") {
    if (!Number.isSafeInteger(condition.value) || condition.value < 0) throw new Error("Invalid progression threshold");
  } else throw new Error("Unknown progression condition");
}

export function meetsCondition(condition: ProgressCondition | undefined, context: ConditionContext): boolean {
  if (!condition) return true;
  if (condition.kind === "all") return condition.conditions.every((entry) => meetsCondition(entry, context));
  if (condition.kind === "any") return condition.conditions.some((entry) => meetsCondition(entry, context));
  if (condition.kind === "flag") return context.hasFlag(condition.id);
  return context[condition.kind] >= condition.value;
}

export function unmetConditions(condition: ProgressCondition | undefined, context: ConditionContext): string[] {
  if (!condition || meetsCondition(condition, context)) return [];
  if (condition.kind === "all") return condition.conditions.reduce<string[]>((result, entry) => result.concat(unmetConditions(entry, context)), []);
  if (condition.kind === "any") return [condition.conditions.map((entry) => unmetConditions(entry, context).join(" + ")).join(" / ")];
  return [condition.label || (condition.kind === "flag" ? condition.id : `${condition.kind} ${condition.value}`)];
}
