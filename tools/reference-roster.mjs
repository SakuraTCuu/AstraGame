import { compileReferenceCondition } from "./reference-rules.mjs";
import { referenceEnergy } from "./reference-development.mjs";

export function buildReferenceRoster(lookup, ids, config, skills, art, binding, assets, rewards, issues) {
  const initial = new Map([13, 1, 9, 8].map((id, index) => [id, config.squad.actors[index]]));
  const heroes = [], actors = [];
  const roles = { 1: "tank", 2: "melee", 3: "support", 4: "ranged" };
  for (const id of ids("Hero").map(Number)) {
    const hero = lookup("Hero", id);
    if (hero.close || /PlayerLevel\|minLevel:9999/.test(hero.showCondition || "")) continue;
    const avatar = lookup("Avatar", hero.display), level = lookup("HeroLevel", hero.levelType * 100000 + 1);
    if (!level?.attr?.maxhp || !hero.heroItemId) { issues.push({ owner: id, kind: "hero_profile" }); continue; }
    let actor = initial.get(id), compiled, deployCondition;
    if (!actor) {
      try {
        compiled = skills.heroSkills(hero, avatar?.fps || 12);
        if (!compiled.ids.some((key) => skills.definitions.get(Number(key.replace("reference_skill_", "")))?.actions.length)) throw new Error("No supported combat actions");
      } catch (error) { issues.push({ owner: id, kind: "hero_skills", message: error.message }); deployCondition = { kind: "flag", id: `external:hero_skills:${id}`, label: "\u6682\u4e0d\u53ef\u7528" }; }
      actor = { id: `reference_hero_${id}`, name: hero.name, kind: "hero", ...config.world.start,
        hp: level.attr.maxhp, maxHp: level.attr.maxhp, attack: level.attr.atk || 0, defense: level.attr.def || 0,
        moveSpeed: config.squad.actors[0].moveSpeed, attackRange: lookup("Skill", Number(String(hero.attack || "").split("_")[0]))?.firstSelector?.[0] || 50,
        aggroRange: hero.searchRange || 250, collisionRadius: hero.volume || 20, skillIds: compiled?.ids || [], modifiers: compiled?.modifiers || {},
        ...referenceEnergy(level.attr) };
      art.bindings[actor.id] = binding(hero.display);
      if (art.bindings[actor.id]) {
        const definitions = [...skills.definitions.values()].filter((skill) => actor.skillIds.includes(skill.id));
        art.bindings[actor.id].skillAnimations = Object.fromEntries(definitions.map((skill) => [skill.id, skill.presentation.release]));
        art.bindings[actor.id].skillPhases = Object.fromEntries(definitions.map((skill) => [skill.id, skill.presentation]));
      } else { issues.push({ owner: id, kind: "hero_art", avatar: hero.display }); deployCondition = { kind: "flag", id: `external:hero_art:${id}`, label: "\u6682\u4e0d\u53ef\u7528" }; }
    }
    actor.combatRole = roles[hero.job];
    if (!actor.combatRole) issues.push({ owner: id, kind: "hero_role", value: hero.job });
    let visibility;
    try { visibility = compileReferenceCondition(hero.showCondition, lookup); }
    catch { visibility = { kind: "flag", id: `external:hero_visibility:${id}`, label: "\u672a\u5f00\u653e" }; issues.push({ owner: id, kind: "hero_visibility", source: hero.showCondition }); }
    const portrait = avatar?.bigIcon?.replace(/^png_/, "");
    const image = assets.find((asset) => asset.type === "cc.SpriteFrame" && asset.path.endsWith(`/${portrait}`) && assets.some((texture) => texture.path === asset.path && texture.type === "cc.Texture2D" && texture.native));
    heroes.push({ id: actor.id, sourceId: id, initiallyOwned: initial.has(id), quality: hero.quality,
      cardResource: rewards.resource(hero.heroItemId), ownershipFlag: `hero:${id}`, visibility, deployCondition,
      icon: image ? { atlas: image.path, frame: "" } : undefined });
    actors.push(actor);
  }
  const slots = ids("HeroPlace").map((id) => lookup("HeroPlace", id)).sort((a, b) => a.num - b.num).map((row) => ({ condition: compileReferenceCondition(row.condition, lookup) }));
  const initialLineup = Array.from({ length: slots.length }, (_, index) => config.squad.actors[index]?.id || null);
  config.squad.formationOffsets = [...config.squad.formationOffsets, { x: -105, y: -115 }, { x: 105, y: -120 }, { x: -55, y: -175 }, { x: 55, y: -180 }].slice(0, slots.length);
  return { heroes, actors, slots, initialLineup };
}
