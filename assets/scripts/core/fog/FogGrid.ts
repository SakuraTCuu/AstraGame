import type { Vec2Like } from "../math/Vector2";

export class FogGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  private readonly discovered: Uint8Array;

  constructor(width: number, height: number, cellSize = 1) {
    if (width <= 0 || height <= 0 || cellSize <= 0) throw new RangeError("Invalid fog grid dimensions");
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.discovered = new Uint8Array(width * height);
  }

  reveal(center: Vec2Like, radius: number): number {
    if (radius < 0) throw new RangeError("Reveal radius cannot be negative");
    const minX = Math.max(0, Math.floor((center.x - radius) / this.cellSize));
    const maxX = Math.min(this.width - 1, Math.floor((center.x + radius) / this.cellSize));
    const minY = Math.max(0, Math.floor((center.y - radius) / this.cellSize));
    const maxY = Math.min(this.height - 1, Math.floor((center.y + radius) / this.cellSize));
    let newlyDiscovered = 0;
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const cellCenterX = (x + 0.5) * this.cellSize;
        const cellCenterY = (y + 0.5) * this.cellSize;
        const dx = cellCenterX - center.x;
        const dy = cellCenterY - center.y;
        const index = y * this.width + x;
        if (dx * dx + dy * dy <= radiusSquared && this.discovered[index] === 0) {
          this.discovered[index] = 1;
          newlyDiscovered += 1;
        }
      }
    }
    return newlyDiscovered;
  }

  isDiscoveredAt(position: Vec2Like): boolean {
    const x = Math.floor(position.x / this.cellSize);
    const y = Math.floor(position.y / this.cellSize);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.discovered[y * this.width + x] === 1;
  }

  discoveredCount(): number {
    let total = 0;
    for (const value of this.discovered) total += value;
    return total;
  }

  snapshot(): readonly number[] {
    return Array.from(this.discovered);
  }

  discoveredCells(): ReadonlyArray<{ x: number; y: number }> {
    const cells: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < this.discovered.length; index += 1) {
      if (this.discovered[index] === 1) cells.push({ x: index % this.width, y: Math.floor(index / this.width) });
    }
    return cells;
  }
}
