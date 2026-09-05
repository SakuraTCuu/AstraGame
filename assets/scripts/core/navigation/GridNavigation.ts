import { Vector2 } from "../math/Vector2";
import type { Vec2Like } from "../math/Vector2";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

const DIRECTIONS: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

export class GridNavigation {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  private readonly blocked: Uint8Array;
  private readonly locked: Uint8Array;
  revision = 0;

  constructor(width: number, height: number, blocked: readonly GridPoint[] = [], cellSize = 1) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || cellSize <= 0) {
      throw new RangeError("Grid dimensions must be positive integers");
    }
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.blocked = new Uint8Array(width * height);
    this.locked = new Uint8Array(width * height);
    for (const point of blocked) this.setBlocked(point, true);
  }

  contains(point: GridPoint): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < this.width && point.y < this.height;
  }

  isBlocked(point: GridPoint, ignoreLocks = false): boolean {
    return !this.contains(point) || this.blocked[this.index(point)] === 1 || (!ignoreLocks && this.locked[this.index(point)] === 1);
  }

  setBlocked(point: GridPoint, value: boolean): void {
    if (!this.contains(point)) throw new RangeError("Point is outside navigation grid");
    const index = this.index(point);
    if (this.blocked[index] !== Number(value)) this.revision += 1;
    this.blocked[index] = Number(value);
  }

  setLocked(point: GridPoint, value: boolean): void {
    if (!this.contains(point)) throw new RangeError("Point is outside navigation grid");
    const index = this.index(point);
    if (this.locked[index] !== Number(value)) this.revision += 1;
    this.locked[index] = Number(value);
  }

  worldToGrid(position: Vec2Like): GridPoint {
    return { x: Math.floor(position.x / this.cellSize), y: Math.floor(position.y / this.cellSize) };
  }

  gridToWorld(point: GridPoint): Vector2 {
    return new Vector2((point.x + 0.5) * this.cellSize, (point.y + 0.5) * this.cellSize);
  }

  isWorldWalkable(position: Vec2Like): boolean {
    return !this.isBlocked(this.worldToGrid(position));
  }

  isSegmentWalkable(from: Vec2Like, to: Vec2Like, ignoreLocks = false): boolean {
    if (this.isBlocked(this.worldToGrid(from), ignoreLocks) || this.isBlocked(this.worldToGrid(to), ignoreLocks)) return false;
    let { x, y } = this.worldToGrid(from);
    const goal = this.worldToGrid(to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const deltaX = dx === 0 ? Infinity : this.cellSize / Math.abs(dx);
    const deltaY = dy === 0 ? Infinity : this.cellSize / Math.abs(dy);
    let nextX = dx === 0 ? Infinity : ((x + (stepX > 0 ? 1 : 0)) * this.cellSize - from.x) / dx;
    let nextY = dy === 0 ? Infinity : ((y + (stepY > 0 ? 1 : 0)) * this.cellSize - from.y) / dy;
    // Visit every crossed cell, including both sides of a grid corner.
    while (x !== goal.x || y !== goal.y) {
      if (Math.abs(nextX - nextY) < 1e-10) {
        if (this.isBlocked({ x: x + stepX, y }, ignoreLocks) || this.isBlocked({ x, y: y + stepY }, ignoreLocks)) return false;
        x += stepX;
        y += stepY;
        nextX += deltaX;
        nextY += deltaY;
      } else if (nextX < nextY) {
        x += stepX;
        nextX += deltaX;
      } else {
        y += stepY;
        nextY += deltaY;
      }
      if (this.isBlocked({ x, y }, ignoreLocks)) return false;
    }
    return true;
  }

  moveWithCollision(from: Vec2Like, displacement: Vec2Like): Vector2 {
    let result = Vector2.from(from);
    const steps = Math.max(1, Math.ceil(Vector2.from(displacement).length() / (this.cellSize / 2)));
    const step = Vector2.from(displacement).scale(1 / steps);
    for (let index = 0; index < steps; index += 1) {
      const next = result.add(step);
      if (this.isSegmentWalkable(result, next)) result = next;
      else {
        const horizontal = result.add({ x: step.x, y: 0 });
        if (this.isSegmentWalkable(result, horizontal)) result = horizontal;
        const vertical = result.add({ x: 0, y: step.y });
        if (this.isSegmentWalkable(result, vertical)) result = vertical;
      }
    }
    return result;
  }

  nearestWalkable(position: Vec2Like): Vector2 | undefined {
    if (this.isWorldWalkable(position)) return Vector2.from(position);
    let nearest: Vector2 | undefined;
    let distance = Infinity;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.isBlocked({ x, y })) continue;
        const candidate = this.gridToWorld({ x, y });
        const candidateDistance = candidate.distanceSquared(position);
        if (candidateDistance < distance) {
          nearest = candidate;
          distance = candidateDistance;
        }
      }
    }
    return nearest;
  }

  findWorldPath(from: Vec2Like, to: Vec2Like): Vector2[] {
    if (this.isSegmentWalkable(from, to)) return [Vector2.from(to)];
    const cells = this.findPath(this.worldToGrid(from), this.worldToGrid(to));
    if (cells.length === 0) return [];
    const points = cells.map((point) => this.gridToWorld(point));
    if (points.length > 1 && this.isSegmentWalkable(from, points[1])) points.shift();
    if (points.length > 1 && this.isSegmentWalkable(points[points.length - 2], to)) points.pop();
    points.push(Vector2.from(to));
    return points;
  }

  findPath(start: GridPoint, goal: GridPoint): GridPoint[] {
    if (this.isBlocked(start) || this.isBlocked(goal)) return [];
    const startKey = this.index(start);
    const goalKey = this.index(goal);
    const open: number[] = [startKey];
    const cameFrom = new Int32Array(this.width * this.height).fill(-1);
    const gScore = new Float64Array(this.width * this.height).fill(Number.POSITIVE_INFINITY);
    gScore[startKey] = 0;

    while (open.length > 0) {
      open.sort((a, b) => {
        const aPoint = this.point(a);
        const bPoint = this.point(b);
        const scoreDifference = gScore[a] + this.heuristic(aPoint, goal) - (gScore[b] + this.heuristic(bPoint, goal));
        return scoreDifference || a - b;
      });
      const current = open.shift()!;
      if (current === goalKey) return this.reconstruct(cameFrom, current);

      for (const direction of DIRECTIONS) {
        const currentPoint = this.point(current);
        const neighbor = { x: currentPoint.x + direction.x, y: currentPoint.y + direction.y };
        if (this.isBlocked(neighbor)) continue;
        const neighborKey = this.index(neighbor);
        const tentative = gScore[current] + 1;
        if (tentative >= gScore[neighborKey]) continue;
        cameFrom[neighborKey] = current;
        gScore[neighborKey] = tentative;
        if (!open.includes(neighborKey)) open.push(neighborKey);
      }
    }
    return [];
  }

  private reconstruct(cameFrom: Int32Array, current: number): GridPoint[] {
    const path = [this.point(current)];
    while (cameFrom[current] !== -1) {
      current = cameFrom[current]!;
      path.push(this.point(current));
    }
    return path.reverse();
  }

  private heuristic(a: GridPoint, b: GridPoint): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private index(point: GridPoint): number {
    return point.y * this.width + point.x;
  }

  private point(index: number): GridPoint {
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }
}

export class AutoPath {
  private waypoints: Vector2[] = [];
  private cursor = 0;

  setPath(points: readonly Vec2Like[]): void {
    this.waypoints = points.map(Vector2.from);
    this.cursor = 0;
  }

  clear(): void {
    this.waypoints = [];
    this.cursor = 0;
  }

  get complete(): boolean {
    return this.cursor >= this.waypoints.length;
  }

  remainingWaypoints(): readonly Vector2[] {
    return this.waypoints.slice(this.cursor);
  }

  update(position: Vec2Like, speed: number, deltaSeconds: number): Vector2 {
    let result = Vector2.from(position);
    let movement = Math.max(0, speed * deltaSeconds);
    while (!this.complete && movement > 0) {
      const target = this.waypoints[this.cursor]!;
      const distance = result.distance(target);
      if (distance <= movement) {
        result = target;
        movement -= distance;
        this.cursor += 1;
      } else {
        result = result.moveTowards(target, movement);
        movement = 0;
      }
    }
    return result;
  }
}
