export interface Vec2Like {
  readonly x: number;
  readonly y: number;
}

export class Vector2 implements Vec2Like {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  static from(value: Vec2Like): Vector2 {
    return new Vector2(value.x, value.y);
  }

  add(other: Vec2Like): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vec2Like): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(value: number): Vector2 {
    return new Vector2(this.x * value, this.y * value);
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.sqrt(this.lengthSquared());
  }

  distanceSquared(other: Vec2Like): number {
    return this.subtract(other).lengthSquared();
  }

  distance(other: Vec2Like): number {
    return Math.sqrt(this.distanceSquared(other));
  }

  normalized(): Vector2 {
    const length = this.length();
    return length === 0 ? Vector2.ZERO : this.scale(1 / length);
  }

  moveTowards(target: Vec2Like, maxDistance: number): Vector2 {
    const delta = Vector2.from(target).subtract(this);
    const distance = delta.length();
    if (distance <= maxDistance || distance === 0) return Vector2.from(target);
    return this.add(delta.scale(maxDistance / distance));
  }

  equals(other: Vec2Like, epsilon = 1e-6): boolean {
    return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon;
  }

  static readonly ZERO = new Vector2(0, 0);
}
