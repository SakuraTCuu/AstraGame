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

  constructor(width: number, height: number, blocked: readonly GridPoint[] = [], cellSize = 1) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || cellSize <= 0) {
      throw new RangeError("Grid dimensions must be positive integers");
    }
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.blocked = new Uint8Array(width * height);
    for (const point of blocked) this.setBlocked(point, true);
  }

  contains(point: GridPoint): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < this.width && point.y < this.height;
  }

  isBlocked(point: GridPoint): boolean {
    return !this.contains(point) || this.blocked[this.index(point)] === 1;
  }

  setBlocked(point: GridPoint, value: boolean): void {
    if (!this.contains(point)) throw new RangeError("Point is outside navigation grid");
    this.blocked[this.index(point)] = value ? 1 : 0;
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
