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
  movespeed: "movementBonus", movespeedRate: "movementSpeedRate", damageBonus: "damageBonus", finalDmgBonus: "finalDamageBonus", damageReduction: "damageReduction",
  finalDmgReduction: "finalDamageReduction", ultraDmgBonus: "physicalBonus", magicDmgBonus: "magicBonus",
  ultraDmgReduction: "physicalReduction", magicDmgReduction: "magicReduction", skillCriticalRate: "criticalChance", healReduction: "healReduction",
  dotDmgBonus: "dotDamageBonus", dotDmgReduction: "dotDamageReduction", normalDmgBonus: "soulBonus", normalDmgReduction: "soulReduction",
  craftDmgBonus: "magicBonus", craftDmgReduction: "magicReduction", maxhpRate: "maxHealthRate", pveFinalDmgRecution: "pveDamageReduction", ultraEnegyRate: "energyGainRate" };
const list = (source) => source ? splitSkillExpression(source, "|").map(skillTuple) : [];
const skillId = (id) => `reference_skill_${id}`;
const controlKinds = ["stun", "freeze", "root", "silence", "airborne", "fear"];
const stateControls = { stun: "stun", stunned: "stun", stunNotBoss: "stun", stunAnim1: "stun", stunAnim2: "stun",
  frozen: "freeze", traditionFreeze: "freeze", twine: "root", immobilized: "root", silent: "silence", silence: "silence", knockUp: "airborne", flyUp: "airborne", upUp: "airborne", fear: "fear" };

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
  const definitions = new Map(), statuses = new Map(), heroProfiles = new Map(), issues = [];
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
  const bonusCondition = (source) => {
    if (source === null || source === undefined) return undefined;
    const match = /^3_(\d+)_([12])_0$/.exec(String(source));
    if (!match) throw new Error("Unsupported healing bonus condition");
    return match[2] === "1" ? { requiredState: match[1] } : { excludedState: match[1] };
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
      else if (action[0] === "addStateAction") {
        const reversed = typeof action[1] === "number" && typeof action[2] === "string";
        const stateId = String(reversed ? action[2] : action[1]), milliseconds = reversed ? action[1] : action[2] ?? (definition.permanent ? -1 : definition.duration * 1000);
        if (!Number.isFinite(milliseconds) || (milliseconds <= 0 && milliseconds !== -1)) { report(id, "state_duration", action); continue; }
        const state = { id: stateId, duration: milliseconds === -1 ? -1 : milliseconds / 1000 };
        if (stateControls[stateId]) { state.control = stateControls[stateId]; if (stateId === "stunNotBoss") state.excludeBoss = true; }
        else if (["ignoreControl", "notControl"].includes(stateId)) { state.controlImmunity = [...controlKinds]; state.displacementImmunity = true; }
        else if (stateId === "unForceMove") state.displacementImmunity = true;
        else if (stateId === "ignoreBreakSkill") state.interruptionImmunity = true;
        else if (stateId === "unForzen") state.controlImmunity = ["freeze"];
        else if (stateId === "unFlyUp") state.controlImmunity = ["airborne"];
        else if (stateId === "invincible") state.invulnerable = true;
        else if (stateId === "notDead") state.preventDeath = true;
        else if (stateId === "unselected") state.untargetable = true;
        else if (stateId === "unHeal") state.healingBlocked = true;
        else if (stateId === "fixOneDmg") state.damageCap = 1;
        else report(id, "state_behavior", stateId);
        if (state.control === "fear") {
          state.wander = { speed: action[3] ?? 350, turnInterval: (action[4] ?? 1000) / 1000 };
          report(id, "fear_motion_parity", { source: action, interpretation: "random heading at each configured interval; speed and default heading loop follow the source description; interval operand requires live comparison" });
        } else if (state.control === "airborne" && state.duration > 0) {
          const rising = stateId === "upUp" && action.length === 6;
          state.lift = rising ? { height: action[5], rise: action[3] / 1000, fall: action[4] / 1000 } :
            { height: 160, rise: state.duration / 2, fall: state.duration / 2 };
          report(id, "airborne_motion_parity", { source: action, interpretation: rising ? "configured rise/fall durations and height; easing requires live comparison" : "local jump-height default and symmetric arc; source height/options require live comparison" });
        } else if (action.length > 3) report(id, "state_options", action);
        definition.states ||= []; definition.states.push(state);
      }
      else if (action[0] === "healAction") immediate.push({ type: "heal", power: Number(action[2] ?? action[1]) / 10000 });
      else if (action[0] === "buffAddEnegyAction" && action[2] > 0 && action[3] >= action[2]) {
        if (action[1] === -1) immediate.push({ type: "skill_energy", skillEnergy: { minimum: action[2], maximum: action[2], cap: action[3] } });
        else if (action[1] > 0) definition.periodicSkillEnergy = { interval: action[1] / 1000, amount: action[2], cap: action[3] };
        else { report(id, "buff_action", action); continue; }
        report(id, "skill_energy_parity", { source: action, interpretation: "fixed gain with a ceiling; instant or periodic from the first operand; live timing and ceiling semantics require comparison" });
      }
      else if (action[0] === "addTargetAction" && Number.isSafeInteger(action[2])) {
        definition.targetCountBonuses ||= {};
        definition.targetCountBonuses[String(action[1])] = action[2];
      }
      else if (action[0] === "buffDamageAction" && action[1] > 0 && action[2] === 6 && !definition.periodicDamage) {
        definition.periodicDamage = { interval: action[1] / 1000, power: action[3] / 10000, damageType: damageType(effects.damageType, id),
          scaleWithStacks: action[4] === (row.group || row.id) };
        if (action[5]) report(id, "periodic_damage_option", action);
      }
      else if (!['buffBubbleAction', 'tickZXFlySwordAction'].includes(action[0])) report(id, "buff_action", action);
    }
    if ((row.name || "").includes("\u72c2\u66b4")) { definition.states ||= []; definition.states.push({ id: "enraged", duration: definition.permanent ? -1 : definition.duration }); }
    for (const tag of list(row.buffTagActions)) {
      if (tag[0] === "backHomeRemoveTag") definition.clearOnReturn = true;
      else if (tag[0] === "noStateTag" && typeof tag[1] === "string") { definition.blockedByStates ||= []; definition.blockedByStates.push(tag[1]); }
      else if (tag[0] === "tickSpanChangeByBuffTag" && tag[1] === 2 && tag[2] === `1_${row.group || row.id}` && definition.periodicDamage) definition.periodicDamage.intervalPerStack = tag[3] / 1000;
      else report(id, "buff_tag", tag);
    }
    if (definition.maxStacks > 1 && row.overlieRefreshFirst !== 1) report(id, "stack_expiry", "shared expiry currently refreshes on reapplication");
    definition.dispellable = row.dispel !== -1;
    definition.harmful = Boolean(definition.periodicDamage || Object.entries(definition.modifiers).some(([key, value]) => key === "healReduction" ? value > 0 : value < 0) ||
      Object.values(definition.targetCountBonuses || {}).some((value) => value < 0) || definition.states?.some((state) => state.control || state.healingBlocked));
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
    let unavailable = false;
    for (const condition of list(row.useCond)) {
      if (condition[0] === "inBattleCond") conditions.inCombat = true;
      else if (condition[0] === "hpRateCond") conditions.targetHpBelow = condition[1] / 10000;
      else if (condition[0] === "castHpRateCond") conditions.casterHpAtMost = condition[1] / 10000;
      else if (condition[0] === "fightingTimeCond" && condition[1] === ">") conditions.combatTimeAtLeast = condition[2] / 1000;
      else if (condition[0] === "castStateCond") conditions.requiredState = String(condition[2]);
      else if (condition[0] === "notControlCond") conditions.uncontrolled = true;
      else if (condition[0] === "enegyCond") {
        if (!Number.isSafeInteger(condition[2]) || condition[2] < 0) { report(id, "condition", condition); unavailable = true; continue; }
        const amount = condition[2];
        if ([">", ">=", "="].includes(condition[1])) conditions.skillEnergyAtLeast = Math.max(conditions.skillEnergyAtLeast || 0, amount + (condition[1] === ">" ? 1 : 0));
        if (["<", "<=", "="].includes(condition[1])) conditions.skillEnergyAtMost = Math.min(conditions.skillEnergyAtMost ?? Infinity, amount - (condition[1] === "<" ? 1 : 0));
        if (![">", ">=", "<", "<=", "="].includes(condition[1]) || conditions.skillEnergyAtMost < 0) { report(id, "condition", condition); unavailable = true; delete conditions.skillEnergyAtMost; }
      }
      else report(id, "condition", condition);
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
    const directional = tags.find((tag) => tag[0] === "dirProTag");
    const target = row.targetCamp === 1 ? "self" : row.targetCamp === 2 ? (row.targetSelectType === 1 ? "lowest_hp_ally" : "ally") : "enemy";
    const definition = { id: skillId(id), sourceId: id, group: String(row.skillgroup || id), name: row.name, coefficient: 0, type: "damage", range: row.firstSelector?.[0] || 50,
      cooldown: (row.cd || 0) / 1000, windup, castDuration: Math.max(windup, (row.postTime || 1000) / 1000),
      target, targetCount: target === "self" ? 1 : Math.max(1, row.firstSelector?.[1] || 1), maxTargets: Math.max(1, row.firstSelector?.[1] || 1),
      priority: row.skillOrder || 1000, category: row.skillType === 8 ? "ultimate" : (row.skillOrder || 1000) < 2000 ? "normal" : "skill",
      publicCooldown: (row.publicCd || 0) / 1000, publicCooldownGroup: row.publicCdGroup === null || row.publicCdGroup === undefined ? undefined : String(row.publicCdGroup),
      conditions, area, areaAnchor: area?.shape === "cone" ? "caster" : undefined, actions,
      forceCritical: tags.some((tag) => tag[0] === "criticalTag"), blockEnergyGain: tags.some((tag) => tag[0] === "blockUltraEnegyTag") };
    for (const cost of tags.filter((tag) => tag[0] === "castCostTag")) {
      if (cost.length % 2 !== 1) { report(id, "invalid_cost", cost); unavailable = true; continue; }
      for (let index = 1; index < cost.length; index += 2) {
        const resource = cost[index], amount = cost[index + 1];
        if (!Number.isSafeInteger(amount) || amount < 0 || (resource === "hp" && amount > 10000)) { report(id, "invalid_cost", cost); unavailable = true; continue; }
        if (amount === 0) continue;
        if (resource === "ultraEnegy") definition.energyCost = (definition.energyCost || 0) + amount;
        else if (resource === "enegy") definition.skillEnergyCost = (definition.skillEnergyCost || 0) + amount;
        else if (resource === "hp") {
          definition.healthCost = { fraction: (definition.healthCost?.fraction || 0) + amount / 10000, basis: "maximum" };
          report(id, "health_cost_parity", "maximum-health basis, rounded down and clamped to leave one HP; basis, rounding and nonlethal behavior require live comparison");
        } else { report(id, "unsupported_cost", { resource, amount }); unavailable = true; }
      }
    }
    if (definition.healthCost?.fraction > 1) { report(id, "invalid_cost", definition.healthCost); delete definition.healthCost; unavailable = true; }
    if (unavailable) definition.disabled = true;
    definition.linkedCooldowns = tags.filter((tag) => tag[0] === "castCdTag").map((tag) => ({ id: skillId(tag[2]), duration: (lookup("Skill", tag[2])?.cd || 0) / 1000 }));
    if (lockProjectile && row.projectEffect) { definition.projectileSpeed = lockProjectile[1]; definition.projectileLifetime = lockProjectile[2] / 1000; definition.projectileHoming = true; }
    if (directional && row.projectEffect && !lockProjectile) {
      const repeat = tags.find((tag) => tag[0] === "proClearDmgTag");
      definition.projectileSpeed = directional[1]; definition.projectileLifetime = directional[2] / 1000;
      definition.directionalProjectile = { radius: area?.shape === "circle" ? area.radius : (area?.width || 20) / 2,
        maxHits: directional[3] || 1, repeatInterval: repeat ? repeat[1] / 1000 : undefined };
      report(id, "directional_projectile_parity", "one shot; circular contact radius from source circle or half box width; hitbox, orientation, walls and special tags require live comparison");
      for (const tag of tags.filter((tag) => ["mulProTag", "proOffsetTag", "proCheckTypeTag"].includes(tag[0]))) report(id, "projectile_option", tag);
    }
    if (row.projectEffect) {
      try { definition.projectileEffectIds = skillTuple(row.projectEffect); }
      catch { report(id, "projectile_effect", row.projectEffect); }
    }
    const frames = skillFrames(row.projectKey || row.frameKey);
    const tracking = tags.find((tag) => tag[0] === "warnFollowBreakTag");
    if (tracking && Number.isFinite(tracking[1]) && tracking[1] >= 0) definition.trackTargetFor = tracking[1] / 1000;
    const motion = frames.flatMap((frame) => frame.actions).find((action) => action[0] === "chargeAction" || action[0] === "jumpAction");
    if (motion) {
      definition.motion = motion[0] === "chargeAction" ? { kind: "charge", distance: motion[1], duration: motion[1] / motion[2] } : { kind: "jump", duration: motion[2] / 1000, height: 160 };
      definition.areaAnchor = undefined;
    }
    const channelMove = row.isMove ? skillTuple(row.isMove) : null;
    if (!motion && channelMove?.[0] === 1 && channelMove[1] > 0 && channelMove[2] >= 0) {
      definition.channelMove = { speed: channelMove[1], start: channelMove[2] / 1000 };
      report(id, "channel_movement_parity", { source: channelMove, interpretation: "forward movement beginning at the configured offset; additional operands and exact steering require live comparison" });
    }
    const appendFrames = (frames, actions, insideArea = false) => {
      for (const frame of frames) {
        const at = insideArea || definition.projectileSpeed ? Math.max(0, frame.frame / fps) : motion ? windup + definition.motion.duration + frame.frame / fps : Math.max(windup, frame.frame / fps);
        let damageStep;
        for (const action of frame.actions) {
          if (action[0] === "damageAction" || action[0] === "healAction") {
          const step = { at, type: action[0] === "damageAction" ? "damage" : "heal", power: action[1] / 10000,
            damageType: damageType(frame.damageType, id), forceCritical: definition.forceCritical };
          if (insideArea && Number.isSafeInteger(action[2]) && action[2] > 0) step.targetCount = action[2];
            actions.push(step); if (step.type === "damage") damageStep = step;
          } else if (action[0] === "damageByBuffAction" && Number.isFinite(action[1]) && Number.isFinite(action[3])) {
            damageStep = { at, type: "damage", power: action[1] / 10000, damageType: damageType(frame.damageType, id), powerPerStack: { group: String(action[2]), amount: action[3] / 10000 } };
            actions.push(damageStep); report(id, "stacked_damage_parity", "base power plus per-stack power from the victim's current Buff count; requires live comparison");
        } else if (action[0] === "sceneSpriteAction" && !insideArea && action[1] > 0 && action[2] > 0 && row.sceneSpriteActions) {
          const unsupportedLayout = tags.filter((tag) => ["warnRandomLineTag", "warnRandomDirTag", "warnRandomBoxPosTag", "sceneSpriteSearchTag"].includes(tag[0]));
          if (unsupportedLayout.length) { report(id, "area_layout", unsupportedLayout); continue; }
            const geometry = action[3] === "circle" ? { shape: "circle", radius: action[4] } : action[3] === "box" ?
              { shape: "line", width: action[4], radius: action[5] } : action[3] === "sector" ? { shape: "cone", radius: action[4], angleDegrees: action[5] } : null;
            if (!geometry) { report(id, "area_shape", action); continue; }
            const effects = []; appendFrames(skillFrames(row.sceneSpriteActions), effects, true);
            if (!effects.length) { report(id, "area_actions", row.sceneSpriteActions); continue; }
            const effectIndex = action[3] === "circle" ? 5 : 6, effectId = action[effectIndex];
          const turn = tags.find((tag) => tag[0] === "sceneSpriteFaceTargetTag"), limit = tags.find((tag) => tag[0] === "sceneSpriteDmgTimesTag");
            const followCaster = action[effectIndex + 2] === 1 || tags.some((tag) => tag[0] === "sceneSpriteFaceDirTag");
          const areaEffect = { duration: action[1] / 1000, interval: action[2] / 1000, geometry, effects, followCaster,
              target: target === "self" ? effects.some((effect) => effect.type === "damage") ? "enemy" : "ally" : target === "enemy" ? "enemy" : "ally",
            turnSpeedDegrees: turn?.[1], hitsPerTarget: limit?.[1], effectKey: effectId > 0 ? `reference_effect_${effectId}` : undefined };
          const targetLimit = tags.find((tag) => tag[0] === "sceneSpriteTargetNumTag");
          if (targetLimit) { const values = String(targetLimit[1]).split("_").map(Number); if (values[0] === 1) { areaEffect.pvpMaxTargets = values[1]; areaEffect.maxTargets = values[2]; } else report(id, "area_target_limit", targetLimit); }
          const tickLimit = tags.find((tag) => tag[0] === "sceneSpriteTriggerLimitTag");
          if (tickLimit) areaEffect.maxTicks = tickLimit[1];
          const replacements = tags.find((tag) => tag[0] === "sceneSpriteReplaceBuffByNumTag");
          if (replacements) {
            areaEffect.phases = [];
            for (let index = 1; index + 1 < replacements.length; index += 2) {
              const replacementFrames = skillFrames(row.sceneSpriteActions).map((frame) => ({ ...frame, actions: frame.actions.map((action) => action[0] === "addBuffAction" ? [action[0], replacements[index + 1], ...action.slice(2)] : action) }));
              const phaseEffects = []; appendFrames(replacementFrames, phaseEffects, true);
              areaEffect.phases.push({ throughTick: replacements[index], effects: phaseEffects });
            }
          }
            actions.push({ at, type: "area", areaEffect });
            if (effectId > 0) { definition.areaEffectIds ||= []; definition.areaEffectIds.push(effectId); }
            report(id, "persistent_area_parity", { source: action, interpretation: "periodic contacts with an independent lifetime; follow/turn, first tick, extra effects and damage limits require live comparison" });
            for (const tag of tags.filter((tag) => ["sceneSpriteRangeAttrTag", "sceneSpriteTriggerPassiveTag"].includes(tag[0]))) report(id, "area_option", tag);
          } else if (action[0] === "repelAction" && damageStep && action.length === 3 && action[1] > 0 && action[2] > 0) {
            damageStep.knockback = { duration: action[1] / 1000, distance: action[2] };
            report(id, "knockback_parity", { durationMilliseconds: action[1], distance: action[2], interpretation: "linear displacement; timing, immunity and interruption require live comparison" });
          } else if (action[0] === "healByDmgAction" && damageStep && action.length === 2 && action[1] >= 0) {
            damageStep.healFromDamage = action[1] / 10000; damageStep.healFromDamageRecipient = "self";
          } else if (action[0] === "removeStateAction" && action[1] === 1 && action.length >= 3 && action.slice(2).every((id) => typeof id === "string")) {
            for (const stateId of action.slice(2)) actions.push({ at, type: "remove_state", stateId, recipient: "self" });
          } else if (action[0] === "addSkillEnegyAction" && Number.isSafeInteger(action[1]) && Number.isSafeInteger(action[2]) && action[1] >= 0 && action[2] >= action[1]) {
            actions.push({ at, type: "skill_energy", recipient: "self", skillEnergy: { minimum: action[1], maximum: action[2] } });
            report(id, "skill_energy_parity", { source: action, interpretation: "inclusive random gain range; equal bounds give a fixed refill; requires live comparison" });
          }
        else if (action[0] === "addBuffAction") {
          const buff = status(action[1]);
          const recipient = action[2] === 1 ? "self" : action[2] === 2 ? "allies" : "targets";
          const targetCount = action[3] > 0 ? action[3] : recipient === "targets" ? undefined : 1;
          actions.push(...buff.immediate.map((effect) => ({ ...effect, at, recipient, targetCount })));
          actions.push({ at, type: "status", status: buff.definition, recipient, targetCount });
          if (insideArea && action.length > 4) report(id, "area_buff_options", action);
          } else if (!['bubbleAction', 'chargeAction', 'jumpAction'].includes(action[0])) report(id, "action", action);
        }
      }
    };
    appendFrames(frames, actions);
    const presentations = row.presentationIds ? skillTuple(row.presentationIds) : [];
    definition.presentation = { release: presentations[presentations.length - 1] || "attack",
      prepare: presentations.length > 2 ? presentations[1] : undefined, hold: presentations.length > 3 ? presentations[2] : undefined };
    const effectiveActions = actions.flatMap((action) => action.areaEffect?.effects || [action]);
    definition.type = effectiveActions.some((action) => action.type === "damage") ? "damage" : effectiveActions.some((action) => action.type === "heal") ? "heal" : "buff";
    definition.coefficient = effectiveActions.find((action) => action.power !== undefined)?.power || 0;
    if (row.damageLimit) report(id, "damage_limit", row.damageLimit);
    if (!actions.length) report(id, "no_direct_actions", row.name || id);
    actions.sort((a, b) => a.at - b.at);
    definition.castDuration = Math.max(definition.castDuration, ...actions.map((action) => action.at));
    definitions.set(id, definition);
    return definition;
  };
  const heroSkills = (hero, fps) => {
    const profileKey = JSON.stringify([hero.id, hero.attack, hero.skill1, hero.skill2, hero.skill5, fps]);
    if (heroProfiles.has(profileKey)) return heroProfiles.get(profileKey);
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
        let conditions;
        try { conditions = bonusCondition(action[4]); } catch { report(hero.id, "healing_bonus_condition", action); continue; }
        const bonus = { conditions, chance: action[3] / 10000 };
        if (action[2] === 1 && encoded[0] === 1 && encoded.length === 2) bonus.powerBonus = encoded[1] / 10000;
        else if (action[2] === 2 && [2, 3].includes(encoded[0]) && encoded.length % 2 === 1) {
          bonus.selection = encoded[0] === 2 ? "all" : "weighted"; bonus.statuses = [];
          for (let index = 1; index < encoded.length; index += 2) {
            const value = status(encoded[index]);
            if (value.immediate.length) report(hero.id, "healing_bonus_immediate", action);
            if (encoded[index + 1] > 0) bonus.statuses.push({ status: value.definition, weight: encoded[index + 1] });
          }
        } else { report(hero.id, "healing_bonus_kind", action); continue; }
        for (const skill of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          for (const step of skill.actions) if (step.type === "heal") { step.healingBonuses ||= []; step.healingBonuses.push(bonus); }
        }
      } else if (action[0] === "skillCastSkillAction") {
        if (action[2] !== 1 || action[4] !== null) { report(hero.id, "triggered_skill_condition", action); continue; }
        const child = compile(action[5], fps);
        if (!child || child.motion || child.channelMove || child.energyCost || child.skillEnergyCost || child.healthCost || child.disabled) { report(hero.id, "triggered_skill_kind", action); continue; }
        for (const parent of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          parent.onRelease ||= []; parent.onRelease.push({ skillId: child.id, chance: action[3] / 10000 });
        }
      } else if (action[0] === "skillRemoveBuffAction") {
        const cleanse = /^2_(\d+)_(\d+)$/.exec(String(action[5]));
        if (!cleanse || action[2] !== 1 || action[3] !== 10000 || action[4] !== null) { report(hero.id, "cleanse_condition", action); continue; }
        for (const parent of skills.filter((skill) => lookup("Skill", skill.sourceId).skillgroup === action[1])) {
          parent.actions.unshift({ at: 0, type: "cleanse", recipient: "allies", globalTargets: true, targetCount: Number(cleanse[1]),
            cleanse: { count: Number(cleanse[2]), npcOnly: true } });
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
        if (!buff.definition.permanent || buff.definition.state || buff.definition.states?.length || buff.definition.periodicDamage || buff.definition.periodicSkillEnergy || buff.definition.targetCountBonuses || buff.immediate.length) { report(hero.id, "passive", action); continue; }
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
    const profile = { ids: skills.map((skill) => skill.id), modifiers };
    heroProfiles.set(profileKey, profile); return profile;
  };
  return { compile, heroSkills, definitions, issues };
}
