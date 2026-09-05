import type { FogGrid } from "../fog/FogGrid";
import type { Vec2Like } from "../math/Vector2";
import type { GridNavigation } from "../navigation/GridNavigation";

export interface WorldRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export type WorldObstacle =
  | { readonly id: string; readonly shape: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly id: string; readonly shape: "circle"; readonly x: number; readonly y: number; readonly radius: number };
export interface WorldPoi extends Vec2Like { readonly id: string; readonly type: string; readonly discoverRadius: number; }
export interface WorldZone { readonly id: string; readonly rect: WorldRect; readonly unlock: string; }
export interface ExplorationEvent { readonly type: "poi_discovered" | "zone_unlocked" | "encounter_completed"; readonly id: string; }

function contains(rect: WorldRect, point: Vec2Like): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function overlapArea(left: WorldRect, right: WorldRect): number {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) *
    Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

export class WorldMap {
  private readonly navigation: GridNavigation;
  private readonly fog: FogGrid;
  private readonly bounds: WorldRect;
  readonly zones: readonly WorldZone[];
  readonly pois: readonly WorldPoi[];
  private readonly unlocked = new Set<string>();
  private readonly discovered = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly events: ExplorationEvent[] = [];

  constructor(
    navigation: GridNavigation,
    fog: FogGrid,
    bounds: WorldRect,
    zones: readonly WorldZone[] = [],
    pois: readonly WorldPoi[] = [],
    obstacles: readonly WorldObstacle[] = [],
  ) {
    this.navigation = navigation;
    this.fog = fog;
    this.bounds = bounds;
    this.zones = zones;
    this.pois = pois;
    const ids = new Set<string>();
    for (const poi of pois) {
      if (ids.has(poi.id) || !contains(bounds, poi) || !(poi.discoverRadius > 0)) throw new Error(`Invalid POI ${poi.id}`);
      ids.add(poi.id);
    }
    ids.clear();
    for (const zone of zones) {
      if (ids.has(zone.id) || !(zone.rect.width > 0 && zone.rect.height > 0) ||
          overlapArea(bounds, zone.rect) !== zone.rect.width * zone.rect.height) throw new Error(`Invalid zone ${zone.id}`);
      ids.add(zone.id);
      for (const other of zones) {
        if (other !== zone && overlapArea(zone.rect, other.rect) > 0) throw new Error(`Overlapping zones ${zone.id} and ${other.id}`);
      }
      if (zone.unlock === "initial") this.unlocked.add(zone.id);
      else {
        const [kind, id, extra] = zone.unlock.split(":");
        if (!id || extra || (kind !== "discover" && kind !== "clear")) throw new Error(`Invalid unlock condition for ${zone.id}`);
        if (kind === "discover" && !pois.some((poi) => poi.id === id)) throw new Error(`Unknown unlock POI ${id}`);
      }
    }
    for (const obstacle of obstacles) {
      if (obstacle.shape === "rect" ? !(obstacle.width > 0 && obstacle.height > 0) : !(obstacle.radius > 0)) {
        throw new Error(`Invalid obstacle ${obstacle.id}`);
      }
    }
    this.forEachCell(navigation.width, navigation.height, navigation.cellSize, (x, y, rect) => {
      const outside = overlapArea(bounds, rect) < rect.width * rect.height;
      if (outside || obstacles.some((obstacle) => this.intersectsObstacle(rect, obstacle))) navigation.setBlocked({ x, y }, true);
    });
    this.refreshLocks();
  }

  isZoneUnlocked(id: string): boolean { return this.unlocked.has(id); }
  isPoiDiscovered(id: string): boolean { return this.discovered.has(id); }
  isEncounterCompleted(id: string): boolean { return this.completed.has(id); }

  isPositionUnlocked(point: Vec2Like): boolean {
    if (!contains(this.bounds, point)) return false;
    return this.zones.length === 0 || this.zones.some((zone) => contains(zone.rect, point) && this.unlocked.has(zone.id));
  }

  discoverAt(position: Vec2Like): void {
    if (!this.navigation.isWorldWalkable(position)) return;
    for (const poi of this.pois) {
      if (this.discovered.has(poi.id) || !this.isPositionUnlocked(poi)) continue;
      const distance = Math.hypot(position.x - poi.x, position.y - poi.y);
      if (distance > poi.discoverRadius || !this.navigation.isSegmentWalkable(position, poi)) continue;
      this.discovered.add(poi.id);
      this.events.push({ type: "poi_discovered", id: poi.id });
      this.unlockFor(`discover:${poi.id}`);
    }
  }

  completeEncounter(id: string): void {
    if (this.completed.has(id)) return;
    this.completed.add(id);
    this.events.push({ type: "encounter_completed", id });
    this.unlockFor(`clear:${id}`);
  }

  drainEvents(): ExplorationEvent[] { return this.events.splice(0); }

  snapshot(): { zones: Array<WorldZone & { unlocked: boolean }>; discoveredPoiIds: string[]; completedEncounterIds: string[] } {
    return {
      zones: this.zones.map((zone) => ({ ...zone, unlocked: this.unlocked.has(zone.id) })),
      discoveredPoiIds: [...this.discovered],
      completedEncounterIds: [...this.completed],
    };
  }

  private unlockFor(condition: string): void {
    let changed = false;
    for (const zone of this.zones) {
      if (zone.unlock !== condition || this.unlocked.has(zone.id)) continue;
      this.unlocked.add(zone.id);
      this.events.push({ type: "zone_unlocked", id: zone.id });
      changed = true;
    }
    if (changed) this.refreshLocks();
  }

  private refreshLocks(): void {
    this.forEachCell(this.navigation.width, this.navigation.height, this.navigation.cellSize,
      (x, y, rect) => this.navigation.setLocked({ x, y }, !this.isAreaUnlocked(rect)));
    this.forEachCell(this.fog.width, this.fog.height, this.fog.cellSize,
      (x, y, rect) => this.fog.setLocked(x, y, !this.isAreaUnlocked(rect)));
  }

  private isAreaUnlocked(rect: WorldRect): boolean {
    const area = overlapArea(this.bounds, rect);
    if (area < rect.width * rect.height) return false;
    if (this.zones.length === 0) return true;
    let covered = 0;
    for (const zone of this.zones) {
      const overlap = overlapArea(zone.rect, rect);
      if (overlap > 0 && !this.unlocked.has(zone.id)) return false;
      covered += overlap;
    }
    return covered >= area;
  }

  private intersectsObstacle(cell: WorldRect, obstacle: WorldObstacle): boolean {
    if (obstacle.shape === "rect") {
      return overlapArea(cell, { x: obstacle.x - obstacle.width / 2, y: obstacle.y - obstacle.height / 2,
        width: obstacle.width, height: obstacle.height }) > 0;
    }
    const x = Math.max(cell.x, Math.min(cell.x + cell.width, obstacle.x));
    const y = Math.max(cell.y, Math.min(cell.y + cell.height, obstacle.y));
    return (x - obstacle.x) ** 2 + (y - obstacle.y) ** 2 < obstacle.radius ** 2;
  }

  private forEachCell(width: number, height: number, size: number, visit: (x: number, y: number, rect: WorldRect) => void): void {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) visit(x, y, { x: x * size, y: y * size, width: size, height: size });
    }
  }
}
