import { compileReferenceCondition, parseReferenceItem } from "./reference-rules.mjs";

export function buildReferenceRecruitment(lookup, ids, rewardCompiler, assets, issues) {
  const source = lookup("RecruitmentPool", 1);
  const cost = parseReferenceItem(source.cost);
  const heroes = ids("Hero").map((id) => lookup("Hero", id));
  const weights = ids("RecruitmentWeight").map((id) => lookup("RecruitmentWeight", id)).filter((row) => String(row.poolId).split(",").includes("1"));
  const entry = (row, weight) => {
    const rewards = rewardCompiler.compile(row.reward);
    const first = rewards.find((reward) => reward.resource?.startsWith("item:"));
    const itemId = first ? Number(first.resource.slice(5)) : 0, item = lookup("Item", itemId);
    const hero = heroes.find((hero) => hero.heroItemId === itemId || hero.chip === itemId);
    const avatar = hero && lookup("Avatar", hero.display), portrait = avatar?.bigIcon?.replace(/^png_/, "");
    const image = assets.find((asset) => asset.type === "cc.SpriteFrame" && asset.path.endsWith(`/${portrait}`) && assets.some((texture) => texture.path === asset.path && texture.type === "cc.Texture2D" && texture.native));
    return { id: `reference_recruit_${row.id}`, name: `${item?.name || "\u5956\u52b1"}${first?.amount > 1 ? ` x${first.amount}` : ""}`, weight,
      rewards, condition: compileReferenceCondition(row.unlockCondition, lookup), quality: item?.quality,
      icon: image ? { atlas: image.path, frame: "" } : undefined };
  };
  const groups = ["value1", "value2", "value3"].map((field) => weights.filter((row) => row[field] > 0).map((row) => entry(row, row[field])));
  const prizeEntries = weights.filter((row) => row.prizeValue > 0).map((row) => entry(row, row.prizeValue));
  if (!/^\{[\d:;]+\}$/.test(source.grandPrize)) throw new Error("Unsupported recruitment guarantee curve");
  const curve = source.grandPrize.slice(1, -1).split(";").map((value) => value.split(":").map(Number)).sort((a, b) => a[0] - b[0]);
  if (curve.some(([index], position) => index !== position)) throw new Error("Recruitment guarantee indices are not contiguous");
  const weightSteps = ids("RecruitmentWeightExtra").map((id) => lookup("RecruitmentWeightExtra", id)).filter((row) => row.weight === source.weight)
    .sort((a, b) => a.num - b.num).map((row) => ({ unlocked: row.num, weights: row.poolWeight.split(",").map(Number) }));
  const unlocks = [...new Set(weights.filter((row) => row.value1 > 0).map((row) => row.unlockCondition).filter(Boolean))].map((value) => compileReferenceCondition(value, lookup));
  issues.push({ owner: source.id, kind: "recruitment_parity", message: "Prize roll precedes normal group selection; combined rates, wishlist, duplicates and star conversion still require live comparison." });
  return { pools: [{ id: "reference_recruitment_1", name: source.name, cost: { [rewardCompiler.resource(cost.itemId)]: cost.amount },
    groups, weightSteps, unlocks, prize: { chances: curve.map(([, value]) => value / 10000), entries: prizeEntries } }] };
}
