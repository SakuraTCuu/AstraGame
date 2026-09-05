import { ActorSnapshot, DemoSnapshot } from "../core/demo/DemoSession";

interface WorldPoint {
    x: number;
    y: number;
}

interface FloatText {
    node: cc.Node;
    world: WorldPoint;
    age: number;
    duration: number;
    height: number;
}

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 1280;
const WORLD_SCALE = 0.82;
const DEPTH_SCALE = 0.58;

export class DemoRenderer {
    private readonly host: cc.Node;
    private readonly worldGraphics: cc.Graphics;
    private readonly overlayGraphics: cc.Graphics;
    private readonly minimapGraphics: cc.Graphics;
    private readonly resultGraphics: cc.Graphics;
    private readonly controlGraphics: cc.Graphics;
    private readonly resultLabel: cc.Label;
    private readonly tooltipLabel: cc.Label;
    private readonly bossLabel: cc.Label;
    private readonly ownedNodes: cc.Node[] = [];
    private readonly actorLabels = new Map<string, cc.Label>();
    private readonly floatTexts: FloatText[] = [];
    private readonly floatPool: cc.Label[] = [];
    private readonly statusLabel: cc.Label;
    private readonly objectiveLabel: cc.Label;
    private readonly loadingLabel: cc.Label;
    private camera = cc.v2(520, 520);
    private cameraTarget = cc.v2(520, 520);
    private config: any = null;
    private snapshot: DemoSnapshot = null;
    private joystick = cc.v2(0, 0);
    private joystickActive = false;
    private joystickCenter = cc.v2(0, -470);
    private hoveredControl: "pause" | "restart" | null = null;
    private feedbackLane = 0;
    private destination: WorldPoint = null;
    private navigationFeedback = 0;

    constructor(host: cc.Node) {
        this.host = host;
        this.worldGraphics = this.createGraphics("WorldGraphics", 0);
        this.overlayGraphics = this.createGraphics("OverlayGraphics", 10);
        this.minimapGraphics = this.createGraphics("MinimapGraphics", 20);
        this.resultGraphics = this.createGraphics("ResultGraphics", 35);
        this.controlGraphics = this.createGraphics("ControlGraphics", 40);
        this.statusLabel = this.createLabel("Status", 24, cc.color(226, 238, 232), cc.v2(0, 565), cc.Label.HorizontalAlign.LEFT);
        this.objectiveLabel = this.createLabel("Objective", 21, cc.color(246, 215, 133), cc.v2(0, 505), cc.Label.HorizontalAlign.CENTER);
        this.loadingLabel = this.createLabel("Loading", 28, cc.color(235, 228, 207), cc.v2(0, 0), cc.Label.HorizontalAlign.CENTER);
        this.loadingLabel.string = "ENTERING MIST VALLEY...";
        this.resultLabel = this.createLabel("Result", 34, cc.color(239, 222, 167), cc.v2(0, 80), cc.Label.HorizontalAlign.CENTER);
        this.resultLabel.node.zIndex = 45;
        this.resultLabel.node.active = false;
        this.tooltipLabel = this.createLabel("ControlTooltip", 18, cc.color(226, 231, 221), cc.v2(0, -605), cc.Label.HorizontalAlign.CENTER);
        this.tooltipLabel.node.zIndex = 45;
        this.tooltipLabel.node.active = false;
        this.bossLabel = this.createLabel("BossHealth", 19, cc.color(248, 181, 153), cc.v2(-100, 463), cc.Label.HorizontalAlign.LEFT);
        this.bossLabel.node.setContentSize(460, 32);
        this.bossLabel.node.active = false;
    }

    setLoading(message: string): void {
        this.loadingLabel.node.active = true;
        this.loadingLabel.string = message;
    }

    initialize(config: any): void {
        this.config = config;
        const start = config.world && config.world.start ? config.world.start : { x: 520, y: 520 };
        this.camera.set(cc.v2(start.x, start.y));
        this.cameraTarget.set(cc.v2(start.x, start.y));
        this.loadingLabel.node.active = false;
        this.floatTexts.splice(0).forEach((entry) => this.recycleFloat(entry.node));
        this.actorLabels.forEach((label) => { label.node.active = false; });
        this.destination = null;
        this.setJoystick(cc.Vec2.ZERO, false);
    }

    setJoystick(value: cc.Vec2, active: boolean, center: cc.Vec2 = cc.v2(0, -470)): void {
        this.joystick = value;
        this.joystickActive = active;
        this.joystickCenter = center;
    }

    setHoveredControl(control: "pause" | "restart" | null): void { this.hoveredControl = control; }

    hitControl(point: cc.Vec2): "pause" | "restart" | null {
        if (point.sub(cc.v2(305, -555)).mag() <= 36) return "pause";
        if (point.sub(cc.v2(-305, -555)).mag() <= 36) return "restart";
        return null;
    }

    isMinimapPoint(screen: cc.Vec2): boolean { return screen.x >= 170 && screen.x <= 338 && screen.y >= 370 && screen.y <= 515; }

    setDestination(destination: WorldPoint): void {
        this.destination = destination;
    }

    screenToWorld(screen: cc.Vec2): WorldPoint {
        return {
            x: this.camera.x + screen.x / WORLD_SCALE,
            y: this.camera.y + (screen.y + 80) / (WORLD_SCALE * DEPTH_SCALE),
        };
    }

    navigationTarget(screen: cc.Vec2): WorldPoint {
        if (this.snapshot && this.isMinimapPoint(screen)) {
            const bounds = this.snapshot.worldBounds;
            return {
                x: bounds.minX + (screen.x - 170) / 168 * (bounds.maxX - bounds.minX),
                y: bounds.minY + (screen.y - 370) / 145 * (bounds.maxY - bounds.minY),
            };
        }
        return this.screenToWorld(screen);
    }

    rejectDestination(): void { this.navigationFeedback = 1.5; }

    update(snapshot: DemoSnapshot, deltaSeconds: number): void {
        if (!this.config) return;
        this.snapshot = snapshot;
        this.navigationFeedback = Math.max(0, this.navigationFeedback - deltaSeconds);
        this.destination = snapshot.autoNavigation.destination;
        const leader = snapshot.actors.find((actor) => actor.id === snapshot.leaderId);
        if (leader) {
            this.cameraTarget.set(cc.v2(leader.x, leader.y + 150));
            const follow = 1 - Math.pow(0.001, Math.min(deltaSeconds, 0.1));
            this.camera.x += (this.cameraTarget.x - this.camera.x) * follow;
            this.camera.y += (this.cameraTarget.y - this.camera.y) * follow;
        }
        this.updateFloatTexts(deltaSeconds);
        this.drawWorld(snapshot);
        this.drawOverlay(snapshot);
        this.updateActorLabels(snapshot);
        this.updateHud(snapshot);
        this.drawResultAndControls(snapshot);
    }

    pushCombatFeedback(snapshot: DemoSnapshot): void {
        const actors = new Map<string, ActorSnapshot>();
        snapshot.actors.forEach((actor) => actors.set(actor.id, actor));
        snapshot.events.forEach((event) => {
            if (!["damage", "heal", "absorb"].includes(event.type) || !(event.value > 0)) return;
            const actor = actors.get(event.targetId);
            if (!actor) return;
            const color = event.type === "heal" ? cc.color(100, 241, 148) : event.type === "absorb" ? cc.color(111, 210, 244) : cc.color(255, 104, 89);
            const label = this.floatPool.pop() || this.createLabel("FloatText", 23, color, cc.Vec2.ZERO, cc.Label.HorizontalAlign.CENTER);
            label.node.active = true;
            label.node.color = color;
            label.node.opacity = 255;
            label.node.setContentSize(140, 32);
            label.string = `${event.type === "heal" ? "+" : "-"}${Math.round(event.value || 0)}`;
            label.node.zIndex = 30;
            const lane = (this.feedbackLane++ % 3) - 1;
            this.floatTexts.push({ node: label.node, world: { x: actor.x + lane * 24, y: actor.y + Math.abs(lane) * 16 },
                age: 0, duration: 0.72, height: actor.kind === "boss" ? 110 : 80 });
        });
    }

    destroy(): void {
        this.floatTexts.splice(0).forEach((entry) => entry.node.destroy());
        this.floatPool.splice(0).forEach((label) => label.node.destroy());
        this.ownedNodes.splice(0).forEach((node) => node.destroy());
        this.actorLabels.clear();
    }

    private createGraphics(name: string, zIndex: number): cc.Graphics {
        const node = new cc.Node(name);
        node.setContentSize(VIEW_WIDTH, VIEW_HEIGHT);
        node.zIndex = zIndex;
        this.host.addChild(node);
        this.ownedNodes.push(node);
        return node.addComponent(cc.Graphics);
    }

    private createLabel(name: string, size: number, color: cc.Color, position: cc.Vec2,
                        align: cc.Label.HorizontalAlign): cc.Label {
        const node = new cc.Node(name);
        node.setPosition(position);
        node.color = color;
        node.zIndex = 25;
        this.host.addChild(node);
        if (name !== "FloatText") this.ownedNodes.push(node);
        const label = node.addComponent(cc.Label);
        label.fontSize = size;
        label.lineHeight = size + 5;
        label.horizontalAlign = align;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        label.overflow = cc.Label.Overflow.SHRINK;
        node.setContentSize(660, 50);
        return label;
    }

    private project(point: WorldPoint): cc.Vec2 {
        return cc.v2(
            (point.x - this.camera.x) * WORLD_SCALE,
            (point.y - this.camera.y) * WORLD_SCALE * DEPTH_SCALE - 80,
        );
    }

    private drawWorld(snapshot: DemoSnapshot): void {
        const g = this.worldGraphics;
        g.clear();
        g.fillColor = cc.color(20, 36, 43);
        g.rect(-VIEW_WIDTH / 2, -VIEW_HEIGHT / 2, VIEW_WIDTH, VIEW_HEIGHT);
        g.fill();
        this.drawGround(g);
        this.drawObstacles(g);
        this.drawPathMarker(g);
        this.drawCastAreas(g, snapshot);
        this.drawActors(g, snapshot);
        this.drawProjectiles(g, snapshot);
        this.drawFog(g, snapshot);
    }

    private drawGround(g: cc.Graphics): void {
        const cell = 320;
        const minX = Math.floor((this.camera.x - 520) / cell) * cell;
        const maxX = this.camera.x + 520;
        const minY = Math.floor((this.camera.y - 1300) / cell) * cell;
        const maxY = this.camera.y + 1300;
        for (let x = minX; x <= maxX; x += cell) {
            for (let y = minY; y <= maxY; y += cell) {
                const p = this.project({ x, y });
                const alternate = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
                g.fillColor = alternate ? cc.color(35, 59, 63) : cc.color(31, 53, 58);
                g.moveTo(p.x, p.y);
                g.lineTo(p.x + cell * WORLD_SCALE, p.y);
                g.lineTo(p.x + cell * WORLD_SCALE, p.y + cell * WORLD_SCALE * DEPTH_SCALE);
                g.lineTo(p.x, p.y + cell * WORLD_SCALE * DEPTH_SCALE);
                g.close();
                g.fill();
            }
        }
        const poi = (this.config.world && this.config.world.pointsOfInterest) || [];
        poi.forEach((entry: any) => {
            const p = this.project(entry);
            if (!this.isVisible(p, 80)) return;
            const discovered = this.snapshot.exploration.discoveredPoiIds.includes(entry.id);
            g.fillColor = entry.type === "boss" ? cc.color(169, 62, 56) : discovered ? cc.color(102, 170, 132) : cc.color(218, 183, 80);
            g.circle(p.x, p.y, entry.type === "boss" ? 26 : 18);
            g.fill();
            g.strokeColor = cc.color(218, 204, 159, 180);
            g.lineWidth = 3;
            g.circle(p.x, p.y, entry.type === "boss" ? 36 : 27);
            g.stroke();
        });
    }

    private drawObstacles(g: cc.Graphics): void {
        const obstacles = (this.config.world && this.config.world.obstacles) || [];
        obstacles.forEach((entry: any) => {
            const p = this.project(entry);
            if (!this.isVisible(p, 500)) return;
            g.fillColor = entry.shape === "circle" ? cc.color(29, 65, 72) : cc.color(27, 44, 45);
            if (entry.shape === "circle") {
                g.ellipse(p.x, p.y, entry.radius * WORLD_SCALE, entry.radius * WORLD_SCALE * DEPTH_SCALE);
            } else {
                g.rect(p.x - entry.width * WORLD_SCALE / 2, p.y - entry.height * WORLD_SCALE * DEPTH_SCALE / 2,
                    entry.width * WORLD_SCALE, entry.height * WORLD_SCALE * DEPTH_SCALE);
            }
            g.fill();
            g.strokeColor = cc.color(56, 85, 75);
            g.lineWidth = 4;
            g.stroke();
        });
    }

    private drawPathMarker(g: cc.Graphics): void {
        if (!this.destination) return;
        const p = this.project(this.destination);
        if (!this.isVisible(p, 100)) return;
        g.strokeColor = cc.color(244, 186, 82, 210);
        g.lineWidth = 4;
        g.circle(p.x, p.y, 24);
        g.stroke();
        g.moveTo(p.x, p.y - 34);
        g.lineTo(p.x, p.y + 34);
        g.moveTo(p.x - 34, p.y);
        g.lineTo(p.x + 34, p.y);
        g.stroke();
    }

    private drawActors(g: cc.Graphics, snapshot: DemoSnapshot): void {
        const actors = snapshot.actors.slice().sort((left, right) => right.y - left.y || left.id.localeCompare(right.id));
        actors.forEach((actor) => {
            const p = this.project(actor);
            if (!this.isVisible(p, 100)) return;
            const boss = actor.kind === "boss";
            const player = actor.team === "player";
            const alive = actor.hp > 0;
            g.fillColor = !alive ? cc.color(63, 65, 66) : boss ? cc.color(163, 55, 51) : player ? cc.color(76, 151, 142) : cc.color(132, 83, 96);
            g.ellipse(p.x, p.y - 13, boss ? 43 : 27, boss ? 18 : 12);
            g.fill();
            g.fillColor = !alive ? cc.color(82, 82, 82) : boss ? cc.color(183, 72, 61) : player ? cc.color(195, 203, 166) : cc.color(153, 105, 111);
            g.circle(p.x, p.y + (boss ? 20 : 12), boss ? 37 : 23);
            g.fill();
            if (player && alive) {
                g.strokeColor = cc.color(117, 218, 187);
                g.lineWidth = 3;
                g.circle(p.x, p.y + 12, 27);
                g.stroke();
            }
            if (actor.shield > 0 && alive) {
                g.fillColor = cc.color(91, 191, 234, 30);
                g.ellipse(p.x, p.y + 14, boss ? 49 : 33, boss ? 65 : 43);
                g.fill();
                g.strokeColor = cc.color(111, 210, 244, 190);
                g.lineWidth = 2;
                g.stroke();
            }
            const barWidth = boss ? 110 : 40;
            const hpRatio = Math.max(0, actor.hp / actor.maxHp);
            g.fillColor = cc.color(29, 28, 30, 220);
            g.rect(p.x - barWidth / 2, p.y + (boss ? 70 : 48), barWidth, 8);
            g.fill();
            g.fillColor = player ? cc.color(67, 205, 119) : cc.color(222, 73, 65);
            g.rect(p.x - barWidth / 2 + 1, p.y + (boss ? 71 : 49), (barWidth - 2) * hpRatio, 6);
            g.fill();
            if (actor.targetId && alive) {
                const target = snapshot.actors.find((candidate) => candidate.id === actor.targetId);
                if (target) {
                    const tp = this.project(target);
                    g.strokeColor = cc.color(242, 190, 92, 95);
                    g.lineWidth = 1;
                    g.moveTo(p.x, p.y + 12);
                    g.lineTo(tp.x, tp.y + 12);
                    g.stroke();
                }
            }
        });
    }

    private drawFog(g: cc.Graphics, snapshot: DemoSnapshot): void {
        this.drawFlashlight(g, snapshot);
        const size = snapshot.fog.cellSize;
        const minWorldX = this.camera.x - VIEW_WIDTH / (2 * WORLD_SCALE) - size;
        const maxWorldX = this.camera.x + VIEW_WIDTH / (2 * WORLD_SCALE) + size;
        const minWorldY = this.camera.y - VIEW_HEIGHT / (2 * WORLD_SCALE * DEPTH_SCALE) - size;
        const maxWorldY = this.camera.y + VIEW_HEIGHT / (2 * WORLD_SCALE * DEPTH_SCALE) + size;
        for (let x = Math.max(0, Math.floor(minWorldX / size)); x <= Math.min(snapshot.fog.width - 1, Math.ceil(maxWorldX / size)); x += 1) {
            for (let y = Math.max(0, Math.floor(minWorldY / size)); y <= Math.min(snapshot.fog.height - 1, Math.ceil(maxWorldY / size)); y += 1) {
                const world = { x: x * size, y: y * size };
                const p = this.project(world);
                const state = snapshot.fog.states[y * snapshot.fog.width + x];
                const alpha = state === "locked" ? 255 : state === "visible" ? 18 : state === "explored" ? 92 : 226;
                g.fillColor = cc.color(7, 14, 20, alpha);
                g.rect(p.x, p.y, size * WORLD_SCALE + 1, size * WORLD_SCALE * DEPTH_SCALE + 1);
                g.fill();
            }
        }
    }

    private drawFlashlight(g: cc.Graphics, snapshot: DemoSnapshot): void {
        const light = snapshot.flashlight;
        const center = this.project(light);
        const baseAngle = Math.atan2(light.directionY * DEPTH_SCALE, light.directionX);
        const half = light.coneAngleDegrees * Math.PI / 360;
        const radius = light.radius * WORLD_SCALE;
        g.fillColor = cc.color(238, 218, 137, 25);
        g.moveTo(center.x, center.y);
        const segments = 18;
        for (let i = 0; i <= segments; i += 1) {
            const angle = baseAngle - half + (half * 2 * i / segments);
            g.lineTo(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
        }
        g.close();
        g.fill();
        g.strokeColor = cc.color(248, 222, 139, 80);
        g.lineWidth = 2;
        g.moveTo(center.x, center.y);
        g.lineTo(center.x + Math.cos(baseAngle - half) * radius, center.y + Math.sin(baseAngle - half) * radius);
        g.moveTo(center.x, center.y);
        g.lineTo(center.x + Math.cos(baseAngle + half) * radius, center.y + Math.sin(baseAngle + half) * radius);
        g.stroke();
    }

    private drawOverlay(snapshot: DemoSnapshot): void {
        const g = this.overlayGraphics;
        g.clear();
        g.fillColor = cc.color(9, 17, 22, 190);
        g.rect(-360, 548, 720, 92);
        g.fill();
        const center = this.joystickCenter;
        const boss = snapshot.actors.find((actor) => actor.kind === "boss" && actor.hp > 0);
        this.bossLabel.node.active = Boolean(boss);
        if (boss) {
            const segmentHp = boss.maxHp / boss.healthBars;
            const segments = Math.ceil(boss.hp / segmentHp);
            const fraction = (boss.hp - (segments - 1) * segmentHp) / segmentHp;
            this.bossLabel.string = `${boss.name}  x${segments}  ${Math.ceil(boss.hp / boss.maxHp * 100)}%`;
            g.fillColor = cc.color(48, 35, 39, 230); g.rect(-330, 433, 460, 12); g.fill();
            g.fillColor = cc.color(227, 91, 70); g.rect(-328, 435, 456 * fraction, 8); g.fill();
        }
        g.fillColor = cc.color(12, 23, 29, 145);
        g.circle(center.x, center.y, 92);
        g.fill();
        g.strokeColor = this.joystickActive ? cc.color(230, 178, 77) : cc.color(128, 148, 142, 190);
        g.lineWidth = 5;
        g.circle(center.x, center.y, 92);
        g.stroke();
        const knob = center.add(this.joystick.mul(58));
        g.fillColor = cc.color(205, 210, 192, 205);
        g.circle(knob.x, knob.y, 37);
        g.fill();
        this.drawMinimap(snapshot);
    }

    private drawMinimap(snapshot: DemoSnapshot): void {
        const g = this.minimapGraphics;
        g.clear();
        const left = 170;
        const bottom = 370;
        const width = 168;
        const height = 145;
        g.fillColor = cc.color(8, 17, 22, 218);
        g.rect(left, bottom, width, height);
        g.fill();
        g.strokeColor = cc.color(135, 153, 139);
        g.lineWidth = 3;
        g.rect(left, bottom, width, height);
        g.stroke();
        const bounds = snapshot.worldBounds;
        const scaleX = width / (bounds.maxX - bounds.minX);
        const scaleY = height / (bounds.maxY - bounds.minY);
        snapshot.exploration.zones.forEach((zone) => {
            g.fillColor = zone.unlocked ? cc.color(40, 67, 62) : cc.color(17, 21, 26);
            g.rect(left + zone.rect.x * scaleX, bottom + zone.rect.y * scaleY, zone.rect.width * scaleX, zone.rect.height * scaleY);
            g.fill();
            g.strokeColor = cc.color(100, 111, 106);
            g.lineWidth = 1;
            g.stroke();
        });
        const pois = this.config.world.pointsOfInterest || [];
        pois.forEach((poi: any) => {
            const discovered = snapshot.exploration.discoveredPoiIds.includes(poi.id);
            g.fillColor = discovered ? cc.color(115, 207, 161) : cc.color(228, 191, 82);
            g.circle(left + poi.x * scaleX, bottom + poi.y * scaleY, 3);
            g.fill();
        });
        snapshot.actors.forEach((actor) => {
            if (actor.hp <= 0) return;
            const x = left + (actor.x - bounds.minX) / (bounds.maxX - bounds.minX) * width;
            const y = bottom + (actor.y - bounds.minY) / (bounds.maxY - bounds.minY) * height;
            g.fillColor = actor.team === "player" ? cc.color(102, 235, 169) : actor.kind === "boss" ? cc.color(255, 80, 61) : cc.color(226, 135, 113);
            g.circle(x, y, actor.kind === "boss" ? 5 : 3);
            g.fill();
        });
    }

    private updateActorLabels(snapshot: DemoSnapshot): void {
        if (!this.config.debug || !this.config.debug.displayActorStates) {
            this.actorLabels.forEach((label) => { label.node.active = false; });
            return;
        }
        const active = new Set<string>();
        const leaderId = snapshot.leaderId;
        snapshot.actors.forEach((actor) => {
            const showState = actor.id === leaderId;
            if (!showState) {
                const existing = this.actorLabels.get(actor.id);
                if (existing) existing.node.active = false;
                return;
            }
            const p = this.project(actor);
            let label = this.actorLabels.get(actor.id);
            if (!label) {
                label = this.createLabel(`State_${actor.id}`, 16, cc.color(225, 226, 211), cc.Vec2.ZERO, cc.Label.HorizontalAlign.CENTER);
                label.node.setContentSize(150, 28);
                this.actorLabels.set(actor.id, label);
            }
            active.add(actor.id);
            label.node.active = this.isVisible(p, 90);
            label.node.setPosition(p.x, actor.kind === "boss" ? p.y + 90 : p.y - 42);
            label.string = actor.hp <= 0 ? "DEAD" : actor.state.toUpperCase();
            label.node.color = actor.state === "attacking" ? cc.color(255, 205, 103) : cc.color(207, 214, 204);
        });
        this.actorLabels.forEach((label, id) => { if (!active.has(id)) label.node.active = false; });
    }

    private updateHud(snapshot: DemoSnapshot): void {
        const players = snapshot.actors.filter((actor) => snapshot.partyIds.includes(actor.id));
        const enemies = snapshot.actors.filter((actor) => actor.team === "enemy" && actor.hp > 0);
        const leader = players.find((actor) => actor.id === snapshot.leaderId);
        const boss = enemies.find((actor) => actor.kind === "boss");
        const bossPhase = boss ? snapshot.bossPhases[boss.id] : null;
        const discovered = snapshot.discoveredFogCells.length;
        const total = snapshot.fog.width * snapshot.fog.height;
        this.statusLabel.string = `MIST VALLEY   ${Math.floor(snapshot.elapsedSeconds)}s\nSQUAD ${players.filter((actor) => actor.hp > 0).length}/${players.length}  HOSTILES ${enemies.length}  EXPLORED ${Math.round(discovered / total * 100)}%`;
        this.objectiveLabel.string = this.navigationFeedback > 0 ? "PATH BLOCKED" : bossPhase
            ? `BOSS - ${bossPhase.toUpperCase()}`
            : leader && leader.state === "attacking"
                ? "ENGAGING"
                : snapshot.autoNavigation.mode === "combat_hold" ? "ENGAGING"
                : snapshot.autoNavigation.mode === "resume_wait" ? "ROUTE PAUSED"
                : snapshot.autoNavigation.mode === "auto_path" ? "AUTO PATH ACTIVE" : "FREE EXPLORE";
    }

    private updateFloatTexts(deltaSeconds: number): void {
        for (let index = this.floatTexts.length - 1; index >= 0; index -= 1) {
            const entry = this.floatTexts[index];
            entry.age += deltaSeconds;
            if (entry.age >= entry.duration) {
                this.recycleFloat(entry.node);
                this.floatTexts.splice(index, 1);
                continue;
            }
            const p = this.project(entry.world);
            entry.node.setPosition(p.x, p.y + entry.height + entry.age * 65);
            entry.node.opacity = Math.round(255 * (1 - entry.age / entry.duration));
        }
    }

    private recycleFloat(node: cc.Node): void {
        node.active = false;
        if (this.floatPool.length < 80) this.floatPool.push(node.getComponent(cc.Label));
        else node.destroy();
    }

    private drawCastAreas(g: cc.Graphics, snapshot: DemoSnapshot): void {
        snapshot.casts.forEach((cast) => {
            if (cast.phase !== "windup" || !cast.area) return;
            const source = snapshot.actors.find((actor) => actor.id === cast.sourceId);
            if (!source) return;
            const enemy = source.team === "enemy";
            const progress = 1 - cast.remaining / Math.max(0.001, cast.duration);
            g.fillColor = enemy ? cc.color(222, 66, 62, 35 + Math.round(progress * 60)) : cc.color(100, 207, 178, 45);
            g.strokeColor = enemy ? cc.color(255, 120, 91, 220) : cc.color(153, 238, 195, 170);
            g.lineWidth = 3;
            const area = cast.area;
            if (area.shape === "circle") {
                const point = this.project(cast.point);
                g.ellipse(point.x, point.y, area.radius * WORLD_SCALE, area.radius * WORLD_SCALE * DEPTH_SCALE);
            } else {
                const angle = Math.atan2(cast.point.y - cast.origin.y, cast.point.x - cast.origin.x);
                const origin = this.project(cast.origin);
                if (area.shape === "cone") {
                    const half = (area.angleDegrees || 90) * Math.PI / 360;
                    g.moveTo(origin.x, origin.y);
                    for (let index = 0; index <= 20; index += 1) {
                        const current = angle - half + 2 * half * index / 20;
                        const point = this.project({ x: cast.origin.x + Math.cos(current) * area.radius, y: cast.origin.y + Math.sin(current) * area.radius });
                        g.lineTo(point.x, point.y);
                    }
                } else {
                    const halfWidth = (area.width || 1) / 2;
                    const offsets = [[0, -halfWidth], [area.radius, -halfWidth], [area.radius, halfWidth], [0, halfWidth]];
                    offsets.forEach(([along, side], index) => {
                        const point = this.project({ x: cast.origin.x + Math.cos(angle) * along - Math.sin(angle) * side,
                            y: cast.origin.y + Math.sin(angle) * along + Math.cos(angle) * side });
                        if (index === 0) g.moveTo(point.x, point.y); else g.lineTo(point.x, point.y);
                    });
                }
                g.close();
            }
            g.fill();
            g.stroke();
        });
    }

    private drawProjectiles(g: cc.Graphics, snapshot: DemoSnapshot): void {
        snapshot.projectiles.forEach((projectile) => {
            const point = this.project(projectile);
            if (!this.isVisible(point, 30)) return;
            const source = snapshot.actors.find((actor) => actor.id === projectile.sourceId);
            g.fillColor = source && source.team === "player" ? cc.color(233, 215, 119) : cc.color(245, 126, 89);
            g.circle(point.x, point.y + 14, 6);
            g.fill();
        });
    }

    private drawResultAndControls(snapshot: DemoSnapshot): void {
        const result = this.resultGraphics;
        result.clear();
        this.resultLabel.node.active = snapshot.runState !== "running";
        if (this.resultLabel.node.active) {
            result.fillColor = cc.color(5, 12, 15, 190);
            result.rect(-360, -640, 720, 1280);
            result.fill();
            this.resultLabel.string = snapshot.runState === "paused" ? "PAUSED" : snapshot.runState === "won" ? "AREA CLEARED" : "SQUAD DEFEATED";
        }
        const g = this.controlGraphics;
        g.clear();
        for (const control of ["restart", "pause"]) {
            const x = control === "pause" ? 305 : -305;
            g.fillColor = cc.color(18, 35, 39, 230);
            g.circle(x, -555, 31);
            g.fill();
            g.strokeColor = this.hoveredControl === control ? cc.color(240, 200, 118) : cc.color(133, 171, 160);
            g.lineWidth = 2;
            g.stroke();
            g.fillColor = cc.color(224, 229, 205);
            g.strokeColor = cc.color(224, 229, 205);
            if (control === "pause") {
                if (snapshot.runState === "paused") {
                    g.moveTo(x - 8, -569); g.lineTo(x - 8, -541); g.lineTo(x + 14, -555); g.close();
                } else { g.rect(x - 11, -568, 7, 26); g.rect(x + 4, -568, 7, 26); }
                g.fill();
            } else {
                g.lineWidth = 3;
                const end = Math.PI * 1.9;
                g.arc(x, -555, 14, Math.PI * 0.3, end, true);
                g.stroke();
                const px = x + Math.cos(end) * 14;
                const py = -555 + Math.sin(end) * 14;
                const tx = -Math.sin(end);
                const ty = Math.cos(end);
                g.moveTo(px + tx * 5, py + ty * 5);
                g.lineTo(px - tx * 4 + ty * 5, py - ty * 4 - tx * 5);
                g.lineTo(px - tx * 4 - ty * 5, py - ty * 4 + tx * 5);
                g.close(); g.fill();
            }
        }
        this.tooltipLabel.node.active = Boolean(this.hoveredControl);
        this.tooltipLabel.string = this.hoveredControl === "restart" ? "Restart" : snapshot.runState === "paused" ? "Resume" : "Pause";
    }

    private isVisible(point: cc.Vec2, margin: number): boolean {
        return point.x >= -VIEW_WIDTH / 2 - margin && point.x <= VIEW_WIDTH / 2 + margin &&
            point.y >= -VIEW_HEIGHT / 2 - margin && point.y <= VIEW_HEIGHT / 2 + margin;
    }
}
