import type { Actor } from "../actor/Actor";
import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";

export const DEFAULT_FORMATION_OFFSETS: readonly Vec2Like[] = [
  { x: 0, y: 0 },
  { x: -1.25, y: -1 },
  { x: 1.25, y: -1 },
  { x: 0, y: -2 },
  { x: -2.5, y: -2 },
  { x: 2.5, y: -2 },
  { x: -1.25, y: -3 },
  { x: 1.25, y: -3 },
];
export const DEFAULT_FORMATION_CATCH_UP_MULTIPLIER = 1.21;

export class SquadFormation {
  private readonly members: Actor[];
  private readonly offsets: readonly Vec2Like[];
  private readonly followStrength: number;
  private readonly catchUpMultiplier: number;

  constructor(members: readonly Actor[], offsets = DEFAULT_FORMATION_OFFSETS, followStrength = 6,
    catchUpMultiplier = DEFAULT_FORMATION_CATCH_UP_MULTIPLIER) {
    if (members.length > offsets.length) throw new RangeError("Not enough formation slots");
    if (!Number.isFinite(catchUpMultiplier) || catchUpMultiplier < 1) throw new RangeError("Formation catch-up multiplier must be finite and at least 1");
    this.members = [...members];
    this.offsets = offsets;
    this.followStrength = followStrength;
    this.catchUpMultiplier = catchUpMultiplier;
  }

  setMembers(members: readonly Actor[]): void {
    if (members.length > this.offsets.length || new Set(members.map((actor) => actor.id)).size !== members.length) throw new Error("Invalid formation members");
    this.members.splice(0, this.members.length, ...members);
  }

  slotPosition(index: number, anchor: Vec2Like, facing: Vec2Like = { x: 0, y: 1 }): Vector2 {
    const slot = this.offsets[index];
    if (!slot) throw new RangeError("Formation slot does not exist");
    const forward = Vector2.from(facing).normalized();
    const effectiveForward = forward.lengthSquared() === 0 ? new Vector2(0, 1) : forward;
    const right = new Vector2(effectiveForward.y, -effectiveForward.x);
    return Vector2.from(anchor).add(right.scale(slot.x)).add(effectiveForward.scale(slot.y));
  }

  update(anchor: Vec2Like, facing: Vec2Like, deltaSeconds: number,
    move?: (actor: Actor, target: Vec2Like, deltaSeconds: number, movementBudget?: number) => void, leader?: Actor): void {
    const members = leader ? [leader, ...this.members.filter((actor) => actor !== leader && actor.alive)] : this.members;
    for (let index = 0; index < members.length; index += 1) {
      const actor = members[index]!;
      if (move && index === 0) continue;
      if (!actor.canMove || !["idle", "moving"].includes(actor.fsm.state)) continue;
      const target = this.slotPosition(index, anchor, facing);
      const blend = Math.min(1, this.followStrength * deltaSeconds);
      // followStrength defines the local error correction; catch-up remains bounded by effective actor speed.
      const movementBudget = Math.min(actor.position.distance(target) * blend,
        actor.movementSpeed * deltaSeconds * this.catchUpMultiplier);
      if (move) move(actor, target, deltaSeconds, movementBudget);
      else actor.position = actor.position.moveTowards(target, movementBudget);
      actor.setState(actor.position.distanceSquared(target) < 0.0025 ? "idle" : "moving");
    }
  }
}
