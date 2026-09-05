import { DemoSnapshot } from "../core/demo/DemoSession";

export class FogRenderer {
    private readonly node: cc.Node;
    private readonly sprite: cc.Sprite;
    private readonly white = new cc.Texture2D();
    private readonly texture = new cc.Texture2D();
    private material: cc.Material = null;
    private baseMaterial: cc.Material = null;
    private effect: cc.EffectAsset = null;
    private pixels = new Uint8Array(0);
    private elapsed = 1;
    private dead = false;

    constructor(host: cc.Node) {
        this.node = new cc.Node("SoftExplorationFog");
        this.node.zIndex = 5;
        this.node.active = false;
        host.addChild(this.node);
        this.white.initWithData(new Uint8Array([255, 255, 255, 255]), cc.Texture2D.PixelFormat.RGBA8888, 1, 1);
        this.sprite = this.node.addComponent(cc.Sprite);
        this.sprite.spriteFrame = new cc.SpriteFrame(this.white);
        this.sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.node.setContentSize(720, 1280);
        cc.resources.load("auto_explore/exploration_fog", cc.EffectAsset, (error: Error, effect: cc.EffectAsset) => {
            if (this.dead) return;
            if (error) { cc.warn("Soft fog effect unavailable:", error.message); return; }
            this.effect = effect.addRef();
            const material = cc.Material.create(effect);
            this.baseMaterial = material;
            this.sprite.setMaterial(0, material);
            this.material = this.sprite.getMaterial(0);
        });
    }

    update(snapshot: DemoSnapshot, camera: cc.Vec2, scale: number, depth: number, radius: number, delta: number, directional = true): boolean {
        if (!this.material) return false;
        this.elapsed += delta;
        const { width, height, cellSize, states } = snapshot.fog;
        if (this.elapsed >= 0.1 || this.pixels.length !== width * height * 4) {
            this.elapsed = 0;
            if (this.pixels.length !== width * height * 4) this.pixels = new Uint8Array(width * height * 4);
            for (let index = 0; index < states.length; index++) {
                this.pixels[index * 4] = states[index] === "visible" || states[index] === "explored" ? 255 : 0;
                this.pixels[index * 4 + 1] = states[index] === "locked" ? 255 : 0;
                this.pixels[index * 4 + 3] = 255;
            }
            this.texture.initWithData(this.pixels, cc.Texture2D.PixelFormat.RGBA8888, width, height);
            this.texture.setFilters(cc.Texture2D.Filter.LINEAR, cc.Texture2D.Filter.LINEAR);
            this.texture.setWrapMode(cc.Texture2D.WrapMode.CLAMP_TO_EDGE, cc.Texture2D.WrapMode.CLAMP_TO_EDGE);
            this.material.setProperty("fogTexture", this.texture);
        }
        const light = snapshot.flashlight;
        this.material.setProperty("worldRect", new cc.Vec4(camera.x - 360 / scale, camera.y - 560 / (scale * depth), 720 / scale, 1280 / (scale * depth)));
        this.material.setProperty("grid", new cc.Vec4(width, height, cellSize, 0));
        this.material.setProperty("light", new cc.Vec4(light.x, light.y, radius, directional ? 1 : 0));
        this.material.setProperty("beam", new cc.Vec4(light.directionX, light.directionY, light.radius, Math.cos(light.coneAngleDegrees * Math.PI / 360)));
        this.node.active = true;
        return true;
    }

    destroy(): void {
        this.dead = true;
        this.node.destroy();
        this.white.destroy();
        this.texture.destroy();
        if (this.material) this.material.destroy();
        if (this.baseMaterial && this.baseMaterial !== this.material) this.baseMaterial.destroy();
        if (this.effect) this.effect.decRef();
    }
}
