export function createExplorationDriver(session) {
  const waypoints = [[720, 2320], [2080, 1640], [1500, 3000], [1850, 4000], [2420, 4860], [4000, 6240]];
  let waypoint = 0;
  let travelling = false;
  let dodging = false;
  let lastDirection = { x: 0, y: 0 };
  const usedSkills = new Set();
  const phases = new Set();
  let ticks = 0;
  let collisions = 0;
  let dodges = 0;
  const events = [];

  const clearance = (position, warning) => {
    const area = warning.area;
    if (area.shape === "circle") return Math.hypot(position.x - warning.point.x, position.y - warning.point.y) - area.radius;
    const x = position.x - warning.origin.x;
    const y = position.y - warning.origin.y;
    const facing = Math.atan2(warning.point.y - warning.origin.y, warning.point.x - warning.origin.x);
    const angle = Math.abs(Math.atan2(Math.sin(Math.atan2(y, x) - facing), Math.cos(Math.atan2(y, x) - facing)));
    return Math.max(Math.hypot(x, y) - area.radius, (angle - (area.angleDegrees ?? 90) * Math.PI / 360) * area.radius);
  };

  const chooseDodge = (snapshot, warning, leader) => {
    const party = snapshot.actors.filter((actor) => snapshot.partyIds.includes(actor.id) && actor.hp > 0);
    const candidates = [];
    for (let index = 0; index < 16; index += 1) {
      const angle = index * Math.PI / 8;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const distance = Math.max(20, Math.min(320, warning.remaining * session.world.leader.stats.moveSpeed));
      const goal = { x: leader.x + direction.x * distance, y: leader.y + direction.y * distance };
      if (!session.world.options.navigation.isSegmentWalkable(leader, goal)) continue;
      const score = Math.min(...party.map((actor) => clearance({ x: actor.x + direction.x * distance, y: actor.y + direction.y * distance }, warning)));
      candidates.push({ direction, score });
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.direction || lastDirection;
  };

  return {
    step() {
      if (session.runState !== "running") return session.getSnapshot();
      const before = session.getSnapshot();
      const leader = before.actors.find((actor) => actor.id === before.leaderId);
      const enemyIds = new Set(before.actors.filter((actor) => actor.team === "enemy").map((actor) => actor.id));
      const warning = before.casts.find((cast) => cast.phase === "windup" && cast.area && enemyIds.has(cast.sourceId) &&
        before.actors.some((actor) => before.partyIds.includes(actor.id) && actor.hp > 0 && clearance(actor, cast) < 20));
      if (warning && leader) {
        if (!dodging) { lastDirection = chooseDodge(before, warning, leader); session.setMoveIntent(lastDirection.x, lastDirection.y); dodges += 1; }
        dodging = true;
      } else if (dodging) {
        session.setMoveIntent(0, 0);
        dodging = false;
      }
      if (!travelling && waypoint < waypoints.length && !dodging) {
        if (!session.setAutoDestination(...waypoints[waypoint])) throw new Error(`Unreachable playthrough waypoint ${waypoint}`);
        travelling = true;
      }
      session.update(0.05);
      ticks += 1;
      const snapshot = session.getSnapshot();
      if (travelling && snapshot.autoNavigation.mode === "idle" && !dodging) { travelling = false; waypoint += 1; }
      for (const actor of session.world.allActors) {
        if (!session.world.options.navigation.isWorldWalkable(actor.position)) throw new Error(`Actor entered blocked ground: ${actor.id}`);
        collisions += 1;
      }
      for (const event of snapshot.events) if (event.type === "skill") usedSkills.add(event.skillId);
      for (const phase of Object.values(snapshot.bossPhases)) phases.add(phase);
      events.push(...snapshot.exploration.events);
      return snapshot;
    },
    report() {
      return { ticks, collisionChecks: collisions, dodges, waypoint, usedSkills: [...usedSkills], phases: [...phases],
        events, state: session.runState, result: session.getSnapshot().result, usedTeleport: false, modifiedCombatStats: false };
    },
  };
}
