import { DemoSnapshot } from "../core/demo/DemoSession";

type PoiState = DemoSnapshot["exploration"]["pois"][number];
export type OverviewAction = { kind: "close" } | { kind: "travel" | "navigate"; id: string };

export class WorldOverview {
    readonly node: cc.Node;
    private readonly frame: cc.Graphics;
    private readonly controls: cc.Graphics;
    private readonly viewport: cc.Node;
    private readonly mapSprite: cc.Sprite;
    private readonly mapGraphics: cc.Graphics;
    private readonly title: cc.Label;
    private readonly selection: cc.Label;
    private readonly details: cc.Label;
    private readonly command: cc.Label;
    private readonly hint: cc.Label;
    private readonly regionLabels: cc.Label[] = [];
    private snapshot: DemoSnapshot = null;
    private config: any = null;
    private center = cc.v2();
    private scale = 0.04;
    private depth = 0.6;
    private minScale = 0.01;
    private selectedId: string = null;
    private markers: Array<{ poi: PoiState; point: cc.Vec2 }> = [];
    private dragStart = cc.v2();

    constructor(host: cc.Node) {
        this.node = new cc.Node("WorldOverview");
        this.node.setContentSize(720, 1280);
        this.node.zIndex = 80;
        host.addChild(this.node);
        this.frame = this.node.addComponent(cc.Graphics);
        this.viewport = new cc.Node("OverviewViewport");
        this.viewport.setContentSize(720, 900);
        this.viewport.setPosition(0, 20);
        this.viewport.addComponent(cc.Mask).type = cc.Mask.Type.RECT;
        this.node.addChild(this.viewport);
        const map = new cc.Node("OverviewTerrain");
        this.mapSprite = map.addComponent(cc.Sprite);
        this.mapSprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.viewport.addChild(map);
        const graphics = new cc.Node("OverviewMarkers");
        this.mapGraphics = graphics.addComponent(cc.Graphics);
        this.viewport.addChild(graphics);
        const controls = new cc.Node("OverviewControls"); controls.zIndex = 10; this.node.addChild(controls); this.controls = controls.addComponent(cc.Graphics);
        this.title = this.label("OverviewTitle", 28, 0, 570, 540, 42);
        this.selection = this.label("SelectedDestination", 23, -55, -480, 550, 38);
        this.details = this.label("DestinationDetails", 19, -65, -538, 530, 66);
        this.command = this.label("TravelCommand", 22, 253, -552, 130, 46);
        this.title.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        this.command.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        this.hint = this.label("MapControlHint", 17, 0, 0, 140, 26);
        this.hint.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        this.hint.node.active = false;
        this.node.active = false;
    }

    get isOpen(): boolean { return this.node.active; }

    open(snapshot: DemoSnapshot, config: any): void {
        this.config = config;
        this.snapshot = snapshot;
        this.depth = config.presentation?.reference?.depth || 0.58;
        const bounds = snapshot.worldBounds;
        this.minScale = Math.min(640 / (bounds.maxX - bounds.minX), 840 / ((bounds.maxY - bounds.minY) * this.depth));
        this.scale = Math.max(this.minScale, config.presentation?.reference?.overviewScale || this.minScale);
        const leader = snapshot.actors.find((actor) => actor.id === snapshot.leaderId);
        this.center.set(leader ? cc.v2(leader.x, leader.y) : cc.v2(bounds.maxX / 2, bounds.maxY / 2));
        this.selectedId = null;
        this.clampCenter();
        this.node.active = true;
    }

    close(): void { this.node.active = false; this.hint.node.active = false; }
    destroy(): void { this.node.destroy(); }
    beginDrag(point: cc.Vec2): void { this.dragStart = point.clone(); }
    drag(point: cc.Vec2): void {
        const delta = point.sub(this.dragStart);
        this.dragStart = point.clone();
        this.center.x -= delta.x / this.scale;
        this.center.y -= delta.y / (this.scale * this.depth);
        this.clampCenter();
    }
    zoom(direction: number): void { this.scale = Math.max(this.minScale, Math.min(this.minScale * 12, this.scale * (direction > 0 ? 1.3 : 1 / 1.3))); this.clampCenter(); }

    hover(point: cc.Vec2 | null): void {
        const tools = [{ x: -300, y: -380, name: "\u5168\u56fe" }, { x: 230, y: -380, name: "\u7f29\u5c0f" },
            { x: 300, y: -380, name: "\u653e\u5927" }, { x: 312, y: 570, name: "\u5173\u95ed" }];
        const tool = point && tools.find((tool) => point.sub(cc.v2(tool.x, tool.y)).mag() <= 28);
        this.hint.node.active = Boolean(tool && this.isOpen);
        if (tool) { this.hint.string = tool.name; this.hint.node.setPosition(Math.max(-280, Math.min(280, tool.x)), tool.y + 42); }
    }

    hit(point: cc.Vec2): OverviewAction | null {
        if (point.sub(cc.v2(312, 570)).mag() <= 30) return { kind: "close" };
        if (point.sub(cc.v2(300, -380)).mag() <= 28) { this.zoom(1); return null; }
        if (point.sub(cc.v2(230, -380)).mag() <= 28) { this.zoom(-1); return null; }
        if (point.sub(cc.v2(-300, -380)).mag() <= 28) {
            this.scale = this.minScale;
            this.center.set(cc.v2(this.snapshot.worldBounds.maxX / 2, this.snapshot.worldBounds.maxY / 2));
            return null;
        }
        const selected = this.snapshot.exploration.pois.find((poi) => poi.id === this.selectedId);
        if (selected && point.x >= 187 && point.x <= 320 && point.y >= -585 && point.y <= -525) {
            return { kind: selected.type === "portal" && selected.completed && selected.unlocked ? "travel" : "navigate", id: selected.id };
        }
        if (point.y < -425 || point.y > 470) return null;
        const position = point.sub(cc.v2(0, 20));
        const closest = this.markers.slice().sort((a, b) => a.point.sub(position).magSqr() - b.point.sub(position).magSqr())[0];
        if (!closest || closest.point.sub(position).mag() > 25) return null;
        this.selectedId = closest.poi.id;
        if (closest.poi.type === "portal" && closest.poi.completed && closest.poi.unlocked) return { kind: "travel", id: closest.poi.id };
        return null;
    }

    update(snapshot: DemoSnapshot, texture?: cc.Texture2D): void {
        if (!this.isOpen) return;
        this.snapshot = snapshot;
        this.title.string = this.config.presentation?.reference ? "\u9547\u90aa\u5fd7" : "WORLD MAP";
        const bounds = snapshot.worldBounds;
        this.mapSprite.node.active = Boolean(texture);
        if (texture) {
            if (!this.mapSprite.spriteFrame || this.mapSprite.spriteFrame.getTexture() !== texture) this.mapSprite.spriteFrame = new cc.SpriteFrame(texture);
            this.mapSprite.node.setContentSize(bounds.maxX * this.scale, bounds.maxY * this.depth * this.scale);
            this.mapSprite.node.setPosition(this.project({ x: bounds.maxX / 2, y: bounds.maxY / 2 }));
        }
        const g = this.mapGraphics;
        g.clear();
        for (const zone of snapshot.exploration.zones) {
            const points = zone.polygon || [{ x: zone.rect.x, y: zone.rect.y }, { x: zone.rect.x + zone.rect.width, y: zone.rect.y },
                { x: zone.rect.x + zone.rect.width, y: zone.rect.y + zone.rect.height }, { x: zone.rect.x, y: zone.rect.y + zone.rect.height }];
            g.fillColor = zone.unlocked ? cc.color(77, 166, 122, texture ? 16 : 120) : cc.color(68, 75, 75, 220);
            g.strokeColor = zone.unlocked ? cc.color(98, 169, 133, 140) : cc.color(159, 161, 149, 120);
            points.forEach((point, index) => { const p = this.project(point); if (index === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
            g.close(); g.fill(); g.lineWidth = 1; g.stroke();
        }
        this.markers = [];
        const occupied: cc.Vec2[] = [];
        const priority = (type: string) => type === "portal" ? 3 : type === "fog_gate" ? 2 : type === "boss" ? 1 : 0;
        const pois = snapshot.exploration.pois.slice().sort((a, b) => Number(b.id === this.selectedId) - Number(a.id === this.selectedId) || priority(b.type) - priority(a.type));
        for (const poi of pois) {
            if (poi.type === "resource" || (poi.type === "chest" && !poi.discovered) || (poi.type === "fog_gate" && poi.completed)) continue;
            const point = this.project(poi);
            if (Math.abs(point.x) > 345 || Math.abs(point.y) > 435 || occupied.some((other) => other.sub(point).mag() < 25)) continue;
            occupied.push(point);
            this.markers.push({ poi, point });
            this.drawMarker(g, poi, point);
        }
        const leader = snapshot.actors.find((actor) => actor.id === snapshot.leaderId);
        if (leader) {
            const p = this.project(leader);
            g.fillColor = cc.color(251, 222, 113); g.moveTo(p.x, p.y + 13); g.lineTo(p.x - 8, p.y - 8); g.lineTo(p.x + 8, p.y - 8); g.close(); g.fill();
        }
        const regions = this.config.presentation?.reference?.regions || [];
        let count = 0;
        for (const region of regions) {
            const p = this.project(region);
            if (Math.abs(p.x) > 260 || Math.abs(p.y) > 395) continue;
            const label = this.regionLabels[count] || this.regionLabel(count);
            label.node.active = true; label.node.setPosition(p.x, p.y - 27); label.string = region.name; count++;
        }
        this.regionLabels.forEach((label, index) => { if (index >= count) label.node.active = false; });
        this.drawFrame();
    }

    project(point: { x: number; y: number }): cc.Vec2 { return cc.v2((point.x - this.center.x) * this.scale, (point.y - this.center.y) * this.scale * this.depth); }

    private drawFrame(): void {
        let g = this.frame;
        g.clear();
        g.fillColor = cc.color(17, 25, 27, 255); g.rect(-360, -640, 720, 1280); g.fill();
        g.fillColor = cc.color(31, 40, 41); g.rect(-360, 490, 720, 150); g.rect(-360, -640, 720, 210); g.fill();
        g = this.controls; g.clear();
        g.strokeColor = cc.color(190, 201, 192); g.lineWidth = 3;
        g.moveTo(300, 582); g.lineTo(324, 558); g.moveTo(324, 582); g.lineTo(300, 558); g.stroke();
        const selected = this.snapshot.exploration.pois.find((poi) => poi.id === this.selectedId);
        this.selection.string = selected ? selected.name || selected.id : this.config.world.name || "";
        const resources = this.snapshot.exploration.resources.map((resource) => `${resource.name} ${resource.amount}`).join("   ");
        const cost = selected?.interaction?.cost;
        const resourceName = cost && this.snapshot.exploration.resources.find((entry) => entry.id === cost.resource)?.name;
        this.details.string = selected ? selected.completed ? "\u5df2\u89e3\u9501" :
            `${cost ? `${resourceName || cost.resource} ${cost.amount}` : ""}${selected.requirements.length ? `\n${selected.requirements.join("\n")}` : ""}` : resources;
        this.command.node.active = Boolean(selected);
        if (selected) {
            this.command.string = selected.type === "portal" && selected.completed && selected.unlocked ? "\u4f20\u9001" : "\u524d\u5f80";
            g.fillColor = cc.color(56, 112, 95); g.rect(187, -585, 133, 60); g.fill();
        }
        for (const x of [230, 300, -300]) {
            g.fillColor = cc.color(30, 43, 45, 235); g.circle(x, -380, 26); g.fill();
            g.strokeColor = cc.color(203, 213, 199); g.lineWidth = 3;
            if (x === -300) { g.rect(x - 10, -390, 20, 20); g.stroke(); }
            else { g.moveTo(x - 10, -380); g.lineTo(x + 10, -380); if (x === 300) { g.moveTo(x, -390); g.lineTo(x, -370); } g.stroke(); }
        }
    }

    private drawMarker(g: cc.Graphics, poi: PoiState, point: cc.Vec2): void {
        const selected = poi.id === this.selectedId;
        g.fillColor = poi.type === "boss" ? cc.color(197, 70, 66) : poi.type === "portal" ? poi.completed ? cc.color(73, 180, 150) : cc.color(130, 143, 143) : cc.color(204, 185, 126);
        g.strokeColor = selected ? cc.color(255, 234, 140) : cc.color(31, 40, 39);
        g.lineWidth = selected ? 3 : 2;
        if (poi.type === "boss") { g.moveTo(point.x, point.y + 11); g.lineTo(point.x - 10, point.y); g.lineTo(point.x, point.y - 11); g.lineTo(point.x + 10, point.y); g.close(); }
        else g.circle(point.x, point.y, poi.type === "portal" ? 10 : 7);
        g.fill(); g.stroke();
        if (poi.type === "portal") { g.strokeColor = cc.color(230, 241, 219); g.lineWidth = 2; g.circle(point.x, point.y, 4); g.stroke(); }
    }

    private clampCenter(): void {
        const bounds = this.snapshot.worldBounds;
        const halfWidth = 360 / this.scale, halfHeight = 450 / (this.scale * this.depth);
        this.center.x = bounds.maxX - bounds.minX <= halfWidth * 2 ? (bounds.maxX + bounds.minX) / 2 : Math.max(bounds.minX + halfWidth, Math.min(bounds.maxX - halfWidth, this.center.x));
        this.center.y = bounds.maxY - bounds.minY <= halfHeight * 2 ? (bounds.maxY + bounds.minY) / 2 : Math.max(bounds.minY + halfHeight, Math.min(bounds.maxY - halfHeight, this.center.y));
    }

    private label(name: string, size: number, x: number, y: number, width: number, height: number): cc.Label {
        const node = new cc.Node(name); node.zIndex = 11; node.setPosition(x, y); node.color = cc.color(224, 230, 216); this.node.addChild(node);
        const label = node.addComponent(cc.Label); label.fontSize = size; label.lineHeight = size + 5; label.overflow = cc.Label.Overflow.SHRINK;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        node.setContentSize(width, height); return label;
    }

    private regionLabel(index: number): cc.Label {
        const label = this.label(`Region_${index}`, 18, 0, 0, 175, 30);
        label.node.parent = this.viewport; label.horizontalAlign = cc.Label.HorizontalAlign.CENTER; label.node.color = cc.color(239, 224, 166); this.regionLabels.push(label); return label;
    }
}
