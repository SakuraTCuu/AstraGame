import type { Vec2Like } from "../math/Vector2";
import type { WorldRect } from "./WorldMap";

export function pointInPolygon(point: Vec2Like, polygon: readonly Vec2Like[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonIntersectsRect(polygon: readonly Vec2Like[], rect: WorldRect): boolean {
  const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  polygon.forEach((point, index) => { const next = polygon[(index + 1) % polygon.length]; axes.push({ x: next.y - point.y, y: point.x - next.x }); });
  return axes.every((axis) => {
    const values = polygon.map((point) => point.x * axis.x + point.y * axis.y);
    const box = corners.map((point) => point.x * axis.x + point.y * axis.y);
    return Math.max(...values) > Math.min(...box) + 1e-7 && Math.max(...box) > Math.min(...values) + 1e-7;
  });
}

export function validateConvexPolygon(polygon: readonly Vec2Like[]): void {
  if (polygon.length < 3 || polygon.length > 16 || polygon.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error("Invalid zone polygon");
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length], c = polygon[(index + 2) % polygon.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-7) continue;
    if (sign && sign !== Math.sign(cross)) throw new Error("Zone polygons must be convex");
    sign = Math.sign(cross);
  }
  if (!sign) throw new Error("Zone polygon has no area");
}
