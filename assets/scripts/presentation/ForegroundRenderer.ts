import type { DemoSnapshot } from "../core/demo/DemoSession";
import { pointInPolygon } from "../core/world/WorldGeometry";

interface Point { x: number; y: number; }
interface Occluder { polygon: Point[]; minX: number; minY: number; maxX: number; maxY: number; }

export class ForegroundRenderer {
    private readonly cameraNode: cc.Node;
    private readonly camera: cc.Camera;
    private readonly maskNode: cc.Node;
    private readonly mask: cc.Graphics;
    private readonly overlay: cc.Node;
    private readonly groundTexture = new cc.RenderTexture();
    private readonly maskTexture = new cc.RenderTexture();
    private readonly frame: cc.SpriteFrame;
    private readonly occluders: Occluder[];
    private material: cc.Material = null;
    private baseMaterial: cc.Material = null;
    private effect: cc.EffectAsset = null;
    private destroyed = false;
    visiblePolygons = 0;

    constructor(host: cc.Node, polygons: Point[][]) {
        this.occluders = polygons.map((polygon) => ({ polygon, minX: Math.min(...polygon.map((point) => point.x)), maxX: Math.max(...polygon.map((point) => point.x)),
            minY: Math.min(...polygon.map((point) => point.y)), maxY: Math.max(...polygon.map((point) => point.y)) }));
        this.groundTexture.initWithSize(720, 1280);
        this.maskTexture.initWithSize(720, 1280);
        this.cameraNode = new cc.Node("ForegroundCaptureCamera");
        host.addChild(this.cameraNode);
        this.camera = this.cameraNode.addComponent(cc.Camera);
        this.camera.enabled = false;
        this.camera.alignWithScreen = false;
        this.camera.ortho = true;
        this.camera.orthoSize = 640;
        this.camera.backgroundColor = cc.color(0, 0, 0, 0);
        this.camera.clearFlags = cc.Camera.ClearFlags.COLOR | cc.Camera.ClearFlags.DEPTH | cc.Camera.ClearFlags.STENCIL;
        this.cameraNode.z = 1000;
        this.maskNode = new cc.Node("ForegroundMaskSource");
        host.addChild(this.maskNode);
        this.mask = this.maskNode.addComponent(cc.Graphics);
        this.maskNode.active = false;
        this.overlay = new cc.Node("ForegroundOverlay");
        this.overlay.zIndex = 3;
        host.addChild(this.overlay);
        const sprite = this.overlay.addComponent(cc.Sprite);
        this.frame = new cc.SpriteFrame(this.groundTexture);
        this.frame.setFlipY(true);
        sprite.spriteFrame = this.frame;
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.overlay.setContentSize(720, 1280);
        this.overlay.active = false;
        cc.resources.load("auto_explore/foreground", cc.EffectAsset, (error: Error, effect: cc.EffectAsset) => {
            if (this.destroyed) { if (effect) effect.addRef().decRef(); return; }
            if (error) { cc.warn("Foreground effect unavailable:", error.message); return; }
            this.effect = effect.addRef();
            this.baseMaterial = cc.Material.create(effect);
            sprite.setMaterial(0, this.baseMaterial);
            this.material = sprite.getMaterial(0);
            this.material.setProperty("maskTexture", this.maskTexture);
        });
    }

    update(ground: cc.Node, snapshot: DemoSnapshot, camera: cc.Vec2, scale: number, depth: number): void {
        if (!this.material) return;
        const marginX = 360 / scale, marginY = 720 / (scale * depth);
        const visible = this.occluders.filter((entry) => entry.maxX >= camera.x - marginX && entry.minX <= camera.x + marginX && entry.maxY >= camera.y - marginY && entry.minY <= camera.y + marginY);
        this.visiblePolygons = visible.length;
        this.overlay.active = visible.length > 0;
        if (!visible.length) return;
        this.maskNode.active = true;
        this.mask.clear();
        const heroes = snapshot.actors.filter((actor) => snapshot.partyIds.includes(actor.id) && actor.hp > 0);
        for (const entry of visible) {
            const behind = heroes.some((actor) => pointInPolygon(actor, entry.polygon) || pointInPolygon({ x: actor.x, y: actor.y + 100 / depth }, entry.polygon));
            this.mask.fillColor = cc.color(255, 255, 255, behind ? 155 : 255);
            entry.polygon.forEach((point, index) => {
                const x = (point.x - camera.x) * scale, y = (point.y - camera.y) * scale * depth - 80;
                if (index === 0) this.mask.moveTo(x, y); else this.mask.lineTo(x, y);
            });
            this.mask.close(); this.mask.fill();
        }
        this.camera.targetTexture = this.maskTexture;
        this.camera.render(this.maskNode);
        this.maskNode.active = false;
        this.camera.targetTexture = this.groundTexture;
        this.camera.render(ground);
    }

    destroy(): void {
        this.destroyed = true;
        this.cameraNode.destroy(); this.maskNode.destroy(); this.overlay.destroy();
        this.frame.destroy(); this.groundTexture.destroy(); this.maskTexture.destroy();
        if (this.material) this.material.destroy();
        if (this.baseMaterial && this.baseMaterial !== this.material) this.baseMaterial.destroy();
        if (this.effect) this.effect.decRef();
    }
}
