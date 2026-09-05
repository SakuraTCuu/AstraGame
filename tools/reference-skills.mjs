export function splitSkillExpression(source, separator) {
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "[") depth++;
    if (character === "]") depth--;
    if (depth < 0) throw new Error("Unbalanced skill expression");
    if (depth === 0 && character === separator) { parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  if (depth) throw new Error("Unbalanced skill expression");
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

export function skillTuple(source) {
  source = source.trim();
  if (!source.startsWith("[") || !source.endsWith("]")) throw new Error(`Invalid skill tuple: ${source}`);
  return splitSkillExpression(source.slice(1, -1), ",").map((value) => value.startsWith("[") ? skillTuple(value) :
    /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value === "null" ? null : value);
}

export function skillFrames(source) {
  if (!source) return [];
  return splitSkillExpression(source, "&").map((block) => {
    if (!block.startsWith("[") || !block.endsWith("]")) throw new Error("Invalid skill frame");
    const fields = Object.fromEntries(splitSkillExpression(block.slice(1, -1), "_").map((field) => {
      const colon = field.indexOf(":");
      if (colon < 1) throw new Error("Invalid skill frame field");
      return [field.slice(0, colon), field.slice(colon + 1)];
    }));
    const damage = fields.dmgType ? splitSkillExpression(fields.dmgType, "|") : [];
    return { frame: Number(fields.key), damageType: damage.length ? skillTuple(damage[0])[0] : undefined,
      actions: [...splitSkillExpression(fields.action || "", "|"), ...damage.slice(1)].map(skillTuple) };
  });
}

const modifierNames = { atkRate: "attackRate", atkspeedRate: "attackSpeedRate", normalAtkSpeedRate: "normalAttackSpeedRate",
  movespeed: "movementBonus", damageBonus: "damageBonus", finalDmgBonus: "finalDamageBonus", damageReduction: "damageReduction",
  finalDmgReduction: "finalDamageReduction", ultraDmgBonus: "physicalBonus", magicDmgBonus: "magicBonus",
  ultraDmgReduction: "physicalReduction", magicDmgReduction: "magicReduction", skillCriticalRate: "criticalChance", healReduction: "healReduction",
  dotDmgBonus: "dotDamageBonus", dotDmgReduction: "dotDamageReduction", normalDmgBonus: "soulBonus", normalDmgReduction: "soulReduction",
  craftDmgBonus: "magicBonus", craftDmgReduction: "magicReduction", maxhpRate: "maxHealthRate", pveFinalDmgRecution: "pveDamageReduction", ultraEnegyRate: "energyGainRate" };
const list = (source) => source ? splitSkillExpression(source, "|").map(skillTuple) : [];
const skillId = (id) => `reference_skill_${id}`;

export function heroSkillAtStar(source, star = 0) {
  if (!Number.isSafeInteger(star) || star < 0) throw new Error("Invalid hero star");
  let selected, unlocked = -1;
  const thresholds = new Set();
  for (const value of String(source || "").split(",").filter(Boolean)) {
    const match = /^(\d+)_(\d+)(?:_\d+)?(?:\|\d+)?$/.exec(value.trim());
    if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) throw new Error("Invalid hero skill progression");
    const required = Number(match[2]);
    if (required <= star && thresholds.has(required)) throw new Error("Duplicate hero skill threshold");
    thresholds.add(required);
    if (required <= star && required > unlocked) { selected = Number(match[1]); unlocked = required; }
  }
  return selected;
}

export function createReferenceSkillCompiler(lookup) {
  const definitions = new Map(), statuses = new Map(), issues = [];
  const report = (id, kind, value) => issues.push({ id: String(id), kind, value });
  const passiveActionsFor = (source, id) => {
    try { return list(source); } catch (error) {
      const extra = [...source].reduce((count, character) => count + (character === "]" ? 1 : character === "[" ? -1 : 0), 0);
      if (extra <= 0 || !source.endsWith("]".repeat(extra + 1))) throw error;
      const actions = list(source.slice(0, -extra));
      report(id, "source_expression_padding", { removedClosingBrackets: extra });
      return actions;
    }
  };
  const damageType = (value, id) => {
    const type = { 0: "skill", 1: "soul", 2: "magic", 3: "physical", 9: "holy", 20: "punishment" }[value];
    if (!type && value !== undefined) report(id, "damage_type", value);
    return type || "physical";
  };
  const changeModifier = (modifiers, action, id) => {
    if (action[1] === "RevertDmgTypeBonus1" && Number.isFinite(action[2])) { modifiers.soulReduction = (modifiers.soulReduction || 0) - action[2] / 10000; return; }
    const key = modifierNames[action[1]];
    if (!key || !Number.isFinite(action[2])) { report(id, "modifier", action); return; }
    modifiers[key] = (modifiers[key] || 0) + action[2] / (action[1] === "movespeed" ? 1 : 10000);
  };
  const status = (id) => {
    if (statuses.has(id)) return statuses.get(id);
    const row = lookup("Buff", id);
    if (!row) throw new Error(`Missing buff ${id}`);
    const definition = { id: `reference_buff_${id}`, group: String(row.group || id), duration: row.duration === -1 ? 0 : (row.duration || 1000) / 1000,
      permanent: row.duration === -1, maxStacks: row.overlieAddEffect || 1, modifiers: {} };
    const immediate = [];
    const effects = row.effects ? skillFrames(`[key:0_action:${row.effects}]`)[0] : { actions: [] };
    for (const action of effects.actions) {
      if (action[0] === "changeAttrAction") changeModifier(definition.modifiers, action, id);
      else if (action[0] === "addStateAction") definition.state = String(action[1]);
      else if (action[0] === "healAction") immediate.push({ type: "heal", power: Number(action[2] ?? action[1]) / 10000 });
      else if (action[0] === "buffDamageAction" && action[1] > 0 && action[2] === 6 && !definition.periodicDamage) {
        definition.periodicDamage = { interval: action[1] / 1000, power: action[3] / 10000, damageType: damageType(effects.damageType, id),
          scaleWithStacks: action[4] === (row.group || row.id) };
        if (action[5]) report(id, "periodic_damage_option", action);
      }
      else if (!['buffBubbleAction', 'tickZXFlySwordAction'].includes(action[0])) report(id, "buff_action", action);
    }
    if ((row.name || "").includes("\u72c2\u66b4")) definition.state = "enraged";
    for (const tag of list(row.buffTagActions)) {
      if (tag[0] === "backHomeRemoveTag") definition.clearOnReturn = true;
      else if (tag[0] === "tickSpanChangeByBuffTag" && tag[1] === 2 && tag[2] === `1_${row.group || row.id}` && definition.periodicDamage) definition.periodicDamage.intervalPerStack = tag[3] / 1000;
      else report(id, "buff_tag", tag);
    }
    if (definition.maxStacks > 1 && row.overlieRefreshFirst !== 1) report(id, "stack_expiry", "shared expiry currently refreshes on reapplication");
    const value = { definition, immediate, row };
    statuses.set(id, value);
    return value;
  };
  const compile = (id, fps = 12, stack = []) => {
    id = Number(id);
    if (definitions.has(id)) return definitions.get(id);
    if (stack.includes(id)) throw new Error(`Cyclic skill dependency ${id}`);
    const row = lookup("Skill", id);
    if (!row || row.skillType === 3) return null;
    const tags = list(row.skillTagActions), conditions = {}, actions = [];
    for (const condition of list(row.useCond)) {
      if (condition[0] === "inBattleCond") conditions.inCombat = true;
      else if (condition[0] === "hpRateCond") conditions.targetHpBelow = condition[1] / 10000;
      else if (condition[0] === "castHpRateCond") conditions.casterHpAtMost = condition[1] / 10000;
      else if (condition[0] === "fightingTimeCond" && condition[1] === ">") conditions.combatTimeAtLeast = condition[2] / 1000;
      else if (condition[0] === "castStateCond") conditions.requiredState = String(condition[2]);
      else if (condition[0] !== "notControlCond") report(id, "condition", condition);
    }
    const shape = row.selectShape ? skillTuple(row.selectShape) : null;
    const area = !shape ? undefined : shape[0] === "circle" ? { shape: "circle", radius: shape[1] } :
      shape[0] === "sector" ? { shape: "cone", radius: shape[1], angleDegrees: shape[2] } :
      shape[0] === "box" ? { shape: "line", radius: shape[2], width: shape[1] } : undefined;
    if (shape && !area) report(id, "shape", shape);
    const warnings = list(row.skillWarn);
    const warning = warnings[0];
    if (warnings.length > 1) report(id, "multiple_warnings", warnings);
    const windup = warning ? warning[3] / 1000 : (row.preTime || 0) / 1000;
    const lockProjectile = tags.find((tag) => tag[0] === "lockProTag");
    const target = row.targetCamp === 1 ? "self" : row.targetCamp === 2 ? (row.targetSelectType === 1 ? "lowest_hp_ally" : "ally") : "enemy";
    const definition = { id: skillId(id), sourceId: id, name: row.name, coefficient: 0, type: "damage", range: row.firstSelector?.[0] || 50,
      cooldown: (row.cd || 0) / 1000, windup, castDuration: Math.max(windup, (row.postTime || 1000) / 1000),
      target, targetCount: target === "self" ? 1 : Math.max(1, row.firstSelector?.[1] || 1), maxTargets: Math.max(1, row.firstSelector?.[1] || 1),
      priority: row.skillOrder || 1000, category: row.skillType === 8 ? "ultimate" : (row.skillOrder || 1000) < 2000 ? "normal" : "skill",
      publicCooldown: (row.publicCd || 0) / 1000, publicCooldownGroup: row.publicCdGroup === null || row.publicCdGroup === undefined ? undefined : String(row.publicCdGroup),
      conditions, area, areaAnchor: area?.shape === "cone" ? "caster" : undefined, actions,
      forceCritical: tags.some((tag) => tag[0] === "criticalTag"), blockEnergyGain: tags.some((tag) => tag[0] === "blockUltraEnegyTag") };
    const cost = tags.find((tag) => tag[0] === "castCostTag" && tag[1] === "ultraEnegy");
    if (cost) definition.energyCost = cost[2];
    definition.linkedCooldowns = tags.filter((tag) => tag[0] === "castCdTag").map((tag) => ({ id: skillId(tag[2]), duration: (lookup("Skill", tag[2])?.cd || 0) / 1000 }));
    if (lockProjectile && row.projectEffect) { definition.projectileSpeed = lockProjectile[1]; definition.projectileLifetime = lockProjectile[2] / 1000; definition.projectileHoming = true; }
    const frames = skillFrames(row.projectKey || row.frameKey);
    const motion = frames.flatMap((frame) => frame.actions).find((action) => action[0] === "chargeAction" || action[0] === "jumpAction");
    if (motion) {
      definition.motion = motion[0] === "chargeAction" ? { kind: "charge", distance: motion[1], duration: motion[1] / motion[2] } : { kind: "jump", duration: motion[2] / 1000, height: 160 };
      definition.areaAnchor = undefined;
    }
    for (const frame of frames) {
      const at = definition.projectileSpeed ? Math.max(0, frame.frame / fps) : motion ? windup + definition.motion.duration + frame.frame / fps : Math.max(windup, frame.frame / fps);
      for (const action of frame.actions) {
        if (action[0] === "damageAction" || action[0] === "healAction") actions.push({ at, type: action[0] === "damageAction" ? "damage" : "heal", power: action[1] / 10000,
          damageType: damageType(frame.damageType, id), forceCritical: definition.forceCritical });
        else if (action[0] === "addBuffAction") {
          const buff = status(action[1]);
          const recipient = action[2] === 1 ? "self" : action[2] === 2 ? "allies" : "targets";
          actions.push(...buff.immediate.map((effect) => ({ ...effect, at, recipient, targetCount: action[3] || 1 })));
          actions.push({ at, type: "status", status: buff.definition, recipient, targetCount: action[3] || 1 });
        } else if (!['bubbleAction', 'chargeAction', 'jumpAction'].includes(action[0])) report(id, "action", action);
      }
    }
    const presentations = row.presentationIds ? skillTuple(row.presentationIds) : [];
    definition.presentation = { release: presentations[presentations.length - 1] || "attack",
      prepare: presentations.length > 2 ? presentations[1] : undefined, hold: presentations.length > 3 ? presentations[2] : undefined };
    definition.type = actions.some((action) => action.type === "damage") ? "damage" : actions.some((action) => action.type === "heal") ? "heal" : "buff";
    definition.coefficient = actions.find((action) => action.power !== undefined)?.power || 0;
    if (row.damageLimit) report(id, "damage_limit", row.damageLimit);
    if (!actions.length) report(id, "no_direct_actions", row.name || id);
    actions.sort((a, b) => a.at - b.at);
    definition.castDuration = Math.max(definition.castDuration, ...actions.map((action) => action.at));
    definitions.set(id, definition);
    return definition;
  };
  const heroSkills = (hero, fps) => {
    for (const source of [hero.attack, hero.skill1, hero.skill2, hero.skill5].filter(Boolean)) {
      if (/[|]|\d+_\d+_\d+/.test(source)) report(hero.id, "hero_skill_variant", source);
    }
    const ids = [hero.attack, hero.skill1, hero.skill2].map((value) => heroSkillAtStar(value)).filter((id) => id !== undefined);
    const modifiers = {};
    const passiveActions = [];
    for (const group of (hero.skill5 || "").split(";").filter(Boolean)) {
      const id = heroSkillAtStar(group);
      if (id === undefined) continue;
      const passive = lookup("Skill", id);
      if (!passive) continue;
      if (passive.skillType !== 3) { ids.push(id); continue; }
      for (const action of passiveActionsFor(passive.triggerActions, id)) {
        if (action[0] === "changeAttrAction") changeModifier(modifiers, action, id);
        else passiveActions.push(action);
      }
    }
    const skills = ids.map((id) => compile(id, fps)).filter(Boolean);
    for (const action of passiveActions) {
      if (action[0] === "skillHealBonusAction") {
        const encoded = String(action[action.length - 1]).split("_").map(Number);
        const choices = [];
        for (let index = 1; index < encoded.length; index += 2) {
          if (encoded[index + 1] !== 1) report(hero.id, "weighted_heal_bonus", action);
          choices.push(status(encoded[index]).definition);
        }
        for (const skill of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          for (const step of skill.actions) if (step.type === "heal") step.randomStatuses = choices;
        }
      } else if (action[0] === "skillAddBuffAction") {
        const buffId = Number(String(action[6]).split("_")[0]);
        const tick = list(status(buffId).row.effects).find((entry) => entry[0] === "tickZXFlySwordAction");
        if (!tick) { report(hero.id, "passive_buff", action); continue; }
        const child = compile(tick[2], fps);
        for (const parent of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          parent.actions = child.actions.map((step) => ({ ...step, at: 0 }));
          parent.type = "damage"; parent.target = "enemy"; parent.targetCount = lookup("Skill", parent.sourceId).firstSelector[1]; parent.maxTargets = 1;
          parent.area = child.area; parent.projectileSpeed = child.projectileSpeed || 1000; parent.projectileLifetime = 3; parent.projectileHoming = true;
          parent.coefficient = child.coefficient;
          report(parent.sourceId, "sword_fan_timing", { tick, interpretation: "one projectile per selected target; projectile speed pending live comparison" });
        }
      } else if (action[0] === "enterFightAddBuff") {
        const entry = /^(\d+)_1$/.exec(String(action[4]));
        if (action[1] !== 10000 || action[2] !== null || action[3] !== 2 || !entry) { report(hero.id, "passive", action); continue; }
        const buff = status(Number(entry[1]));
        if (!buff.definition.permanent || buff.definition.state || buff.definition.periodicDamage || buff.immediate.length) { report(hero.id, "passive", action); continue; }
        for (const [key, value] of Object.entries(buff.definition.modifiers)) modifiers[key] = (modifiers[key] || 0) + value;
      } else if (action[0] === "hurtCalcBuffAction") {
        const settlement = /^4_(\d+)_(\d+)$/.exec(String(action[4]));
        if (!settlement || action[2] !== 10000 || action[3] !== `1_${settlement[1]}`) { report(hero.id, "passive", action); continue; }
        for (const parent of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          for (const step of parent.actions) if (step.type === "damage") step.settleStatus = { group: settlement[1], seconds: Number(settlement[2]) / 1000 };
        }
        report(hero.id, "periodic_settlement_parity", "full periodic ticks over the configured duration without consuming the status; rounding and attack snapshot require live comparison");
      } else report(hero.id, "passive", action);
    }
    return { ids: skills.map((skill) => skill.id), modifiers };
  };
  return { compile, heroSkills, definitions, issues };
}
